"""Queue semantics against real Redis: ordering, concurrency, idempotency, expiry, transitions."""

import asyncio

from app.core.security import new_visitor_id
from app.repositories.queue_repo import QueueRepository, now_ms

GRACE_MS = 30_000
TTL_S = 3600


async def join(repo: QueueRepository, vid: str, now: int | None = None, max_size: int = 100_000):  # type: ignore[no-untyped-def]
    return await repo.join(vid, grace_ms=GRACE_MS, max_size=max_size, record_ttl_s=TTL_S, now=now)


async def test_fifo_ordering_by_server_sequence(repo: QueueRepository) -> None:
    ids = [new_visitor_id() for _ in range(5)]
    for vid in ids:
        await join(repo, vid)
    positions = [(await repo.status(vid)).rank for vid in ids]
    assert positions == [0, 1, 2, 3, 4]


async def test_concurrent_registration_gets_unique_consistent_positions(repo: QueueRepository) -> None:
    ids = [new_visitor_id() for _ in range(200)]
    results = await asyncio.gather(*(join(repo, vid) for vid in ids))
    seqs = sorted(r.seq for r in results)
    assert seqs == list(range(1, 201))  # INCR is the only ordering source: no gaps, no duplicates
    statuses = await asyncio.gather(*(repo.status(vid) for vid in ids))
    ranks = sorted(s.rank for s in statuses if s.rank is not None)
    assert ranks == list(range(200))
    by_seq = sorted(zip(results, statuses, strict=True), key=lambda pair: pair[0].seq)
    assert [s.rank for _, s in by_seq] == list(range(200))


async def test_duplicate_join_is_idempotent(repo: QueueRepository) -> None:
    vid = new_visitor_id()
    first = await join(repo, vid)
    again = await asyncio.gather(*(join(repo, vid) for _ in range(20)))
    assert first.mode == "new"
    assert {r.seq for r in again} == {first.seq}
    assert {r.mode for r in again} == {"existing"}
    assert await repo.queue_length() == 1


async def test_heartbeat_expiry_removes_abandoned_visitors(repo: QueueRepository) -> None:
    t0 = now_ms()
    stale, alive = new_visitor_id(), new_visitor_id()
    await join(repo, stale, now=t0)
    await join(repo, alive, now=t0)
    await repo.status(alive, now=t0 + 9_000)  # heartbeat
    hb, tok = await repo.expire_stale(heartbeat_timeout_ms=10_000, limit=100, keep=1000, now=t0 + 15_000)
    assert (hb, tok) == (1, 0)
    assert (await repo.status(stale)).state == "expired"
    alive_status = await repo.status(alive)
    assert alive_status.state == "waiting" and alive_status.rank == 0  # position not distorted


async def test_rejoin_within_grace_keeps_place(repo: QueueRepository) -> None:
    t0 = now_ms()
    a, b = new_visitor_id(), new_visitor_id()
    first = await join(repo, a, now=t0)
    await join(repo, b, now=t0 + 1)
    await repo.status(b, now=t0 + 14_000)
    await repo.expire_stale(heartbeat_timeout_ms=10_000, limit=100, keep=1000, now=t0 + 15_000)
    back = await join(repo, a, now=t0 + 20_000)  # 5 s after expiry, inside the 30 s grace
    assert back.mode == "resumed" and back.seq == first.seq
    assert (await repo.status(a)).rank == 0


async def test_rejoin_after_grace_goes_to_back(repo: QueueRepository) -> None:
    t0 = now_ms()
    a, b = new_visitor_id(), new_visitor_id()
    first = await join(repo, a, now=t0)
    await join(repo, b, now=t0 + 1)
    await repo.status(b, now=t0 + 50_000)
    await repo.expire_stale(heartbeat_timeout_ms=10_000, limit=100, keep=1000, now=t0 + 15_000)
    back = await join(repo, a, now=t0 + 15_000 + GRACE_MS + 1)
    assert back.mode == "rejoined" and back.seq > first.seq
    assert (await repo.status(a)).rank == 1


async def test_queue_full_is_reported(repo: QueueRepository) -> None:
    await join(repo, new_visitor_id(), max_size=1)
    result = await join(repo, new_visitor_id(), max_size=1)
    assert result.state == "full"
    assert await repo.queue_length() == 1


async def test_state_transitions(repo: QueueRepository) -> None:
    lock = "lock-token"
    assert await repo.acquire_leader(lock, 5000)
    waiting, admitted = new_visitor_id(), new_visitor_id()
    await join(repo, admitted)
    await join(repo, waiting)
    res = await repo.admit(lock_token=lock, rate=1, burst=1, max_active=0, ttl_ms=60_000, jtis=["j1", "j2"])
    assert [vid for vid, _ in res.admitted] == [admitted]

    # admitted visitors are not re-queued by a duplicate join
    assert (await join(repo, admitted)).state == "admitted"

    # waiting -> rejected
    r = await repo.reject(waiting, "test")
    assert r.ok and r.previous_state == "waiting"
    assert await repo.queue_length() == 0
    # rejected -> rejected is invalid, and rejected visitors cannot rejoin
    assert not (await repo.reject(waiting, "again")).ok
    assert (await join(repo, waiting)).state == "rejected"

    # admitted -> rejected revokes the token
    r = await repo.reject(admitted, "abuse")
    assert r.ok and r.previous_state == "admitted" and r.jti == "j1"
    assert await repo.is_revoked("j1")

    # unknown visitor
    assert (await repo.reject(new_visitor_id(), "x")).previous_state == "unknown"


async def test_admitted_expire_when_token_lifetime_ends(repo: QueueRepository) -> None:
    lock = "lock-token"
    await repo.acquire_leader(lock, 5000)
    vid = new_visitor_id()
    t0 = now_ms()
    await join(repo, vid, now=t0)
    await repo.admit(lock_token=lock, rate=1, burst=1, max_active=0, ttl_ms=1000, jtis=["j"], now=t0)
    assert await repo.active_admitted(now=t0) == 1
    hb, tok = await repo.expire_stale(heartbeat_timeout_ms=10_000, limit=100, keep=1000, now=t0 + 2000)
    assert tok == 1
    assert (await repo.status(vid)).state == "expired"
    # token-expired visitors start over at the back of the line
    assert (await join(repo, vid)).mode == "rejoined"


async def test_admin_listing_pagination_and_search(repo: QueueRepository) -> None:
    ids = [new_visitor_id() for _ in range(30)]
    for vid in ids:
        await join(repo, vid)
    total, page1 = await repo.list_visitors("waiting", offset=0, limit=10)
    _, page3 = await repo.list_visitors("waiting", offset=20, limit=10)
    assert total == 30
    assert [r["visitor_id"] for r in page1] == ids[:10]
    assert [r["position"] for r in page3] == list(range(21, 31))
    total, found = await repo.list_visitors("waiting", offset=0, limit=10, search=ids[7][:10])
    assert total >= 1 and found[0]["visitor_id"] == ids[7]


async def test_admin_listing_all_states_paginates_across_segments(repo: QueueRepository) -> None:
    lock = "L"
    await repo.acquire_leader(lock, 5000)
    ids = [new_visitor_id() for _ in range(6)]
    for vid in ids:
        await join(repo, vid)
    await repo.admit(lock_token=lock, rate=10, burst=2, max_active=0, ttl_ms=60_000, jtis=["a", "b"])
    await repo.reject(ids[5], "test")
    # waiting: ids[2..4] (3), admitted: ids[0..1] (2), rejected: ids[5] (1)
    total, everything = await repo.list_visitors("all", offset=0, limit=50)
    assert total == 6
    assert [r["record"]["state"] for r in everything] == ["waiting"] * 3 + ["admitted"] * 2 + ["rejected"]
    _, page2 = await repo.list_visitors("all", offset=2, limit=2)  # spans waiting -> admitted
    assert [r["visitor_id"] for r in page2] == [everything[2]["visitor_id"], everything[3]["visitor_id"]]
    _, page3 = await repo.list_visitors("all", offset=4, limit=2)
    assert [r["visitor_id"] for r in page3] == [everything[4]["visitor_id"], everything[5]["visitor_id"]]
    total, found = await repo.list_visitors("all", offset=0, limit=10, search=ids[5][:12])
    assert total == 1 and found[0]["record"]["state"] == "rejected"
