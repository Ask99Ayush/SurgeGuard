"""Admission: rate enforcement, ordering, no double admission, fencing, restart recovery, health policy."""

import asyncio

import httpx
from redis.asyncio import Redis

from app.core.config import Settings
from app.core.security import new_visitor_id
from app.repositories.queue_repo import QueueRepository, now_ms
from app.services.backend_health import BackendHealthMonitor, effective_rate
from app.workers.admission_worker import AdmissionWorker
from tests.conftest import make_settings


async def fill(repo: QueueRepository, n: int, now: int | None = None) -> list[str]:
    ids = [new_visitor_id() for _ in range(n)]
    for vid in ids:
        await repo.join(vid, grace_ms=0, max_size=100_000, record_ttl_s=3600, now=now)
    return ids


def jtis(n: int, tag: str = "j") -> list[str]:
    return [f"{tag}{i}" for i in range(n)]


async def test_token_bucket_enforces_rate(repo: QueueRepository) -> None:
    lock = "L"
    await repo.acquire_leader(lock, 10_000)
    await fill(repo, 100)
    t0 = now_ms()
    kw = {"lock_token": lock, "rate": 5.0, "burst": 5, "max_active": 0, "ttl_ms": 60_000}
    first = await repo.admit(**kw, jtis=jtis(50, "a"), now=t0)
    assert len(first.admitted) == 5  # initial burst
    same_instant = await repo.admit(**kw, jtis=jtis(50, "b"), now=t0)
    assert len(same_instant.admitted) == 0  # bucket empty
    one_sec = await repo.admit(**kw, jtis=jtis(50, "c"), now=t0 + 1000)
    assert len(one_sec.admitted) == 5  # 5/s refill
    half = await repo.admit(**kw, jtis=jtis(50, "d"), now=t0 + 1400)
    assert len(half.admitted) == 2  # 0.4 s * 5/s = 2
    long_idle = await repo.admit(**kw, jtis=jtis(50, "e"), now=t0 + 60_000)
    assert len(long_idle.admitted) == 5  # capped at burst
    assert await repo.admissions_since(t0) == 17


async def test_admission_follows_queue_order(repo: QueueRepository) -> None:
    lock = "L"
    await repo.acquire_leader(lock, 10_000)
    ids = await fill(repo, 12)
    t0 = now_ms()
    order: list[str] = []
    for i in range(4):
        res = await repo.admit(
            lock_token=lock, rate=3, burst=3, max_active=0, ttl_ms=60_000, jtis=jtis(10, f"r{i}-"), now=t0 + i * 1000
        )
        order += [vid for vid, _ in res.admitted]
    assert order == ids


async def test_max_active_cap(repo: QueueRepository) -> None:
    lock = "L"
    await repo.acquire_leader(lock, 10_000)
    await fill(repo, 10)
    res = await repo.admit(lock_token=lock, rate=100, burst=100, max_active=3, ttl_ms=60_000, jtis=jtis(10))
    assert len(res.admitted) == 3


async def test_paused_admits_nobody(repo: QueueRepository) -> None:
    lock = "L"
    await repo.acquire_leader(lock, 10_000)
    await fill(repo, 3)
    await repo.set_paused(True, "maintenance", "test")
    res = await repo.admit(lock_token=lock, rate=10, burst=10, max_active=0, ttl_ms=60_000, jtis=jtis(10))
    assert res.status == "paused" and res.admitted == []
    await repo.set_paused(False, "", "test")
    res = await repo.admit(lock_token=lock, rate=10, burst=10, max_active=0, ttl_ms=60_000, jtis=jtis(10))
    assert len(res.admitted) == 3


async def test_fencing_blocks_non_leader(repo: QueueRepository) -> None:
    await fill(repo, 5)
    assert await repo.acquire_leader("A", 10_000)
    assert not await repo.acquire_leader("B", 10_000)
    res = await repo.admit(lock_token="B", rate=10, burst=10, max_active=0, ttl_ms=60_000, jtis=jtis(5))
    assert res.status == "not_leader" and await repo.queue_length() == 5


async def test_concurrent_workers_never_double_admit(redis: Redis, settings: Settings) -> None:
    repo = QueueRepository(redis, settings.redis_key_prefix)
    await fill(repo, 300)

    async def worker(token: str) -> list[str]:
        got: list[str] = []
        for i in range(40):
            if await repo.acquire_leader(token, 200):
                res = await repo.admit(
                    lock_token=token, rate=1000, burst=20, max_active=0, ttl_ms=60_000, jtis=jtis(20, f"{token}-{i}-")
                )
                got += [vid for vid, _ in res.admitted]
                if i % 7 == 0:
                    await repo.release_leader(token)  # hand leadership around
            await asyncio.sleep(0.005)
        return got

    results = await asyncio.gather(*(worker(f"W{n}") for n in range(4)))
    admitted = [vid for batch in results for vid in batch]
    assert len(admitted) == len(set(admitted))  # nobody admitted twice
    total_admitted = int((await repo.totals()).get("admitted", 0))
    assert total_admitted == len(admitted)
    assert await repo.queue_length() == 300 - len(admitted)


async def test_restart_recovery_continues_in_order(repo: QueueRepository) -> None:
    ids = await fill(repo, 6)
    assert await repo.acquire_leader("old", 300)
    first = await repo.admit(lock_token="old", rate=2, burst=2, max_active=0, ttl_ms=60_000, jtis=jtis(5, "o"))
    # "crash": the old worker never releases; a new worker waits for the lock TTL.
    assert not await repo.acquire_leader("new", 300)
    await asyncio.sleep(0.4)
    assert await repo.acquire_leader("new", 300)
    second = await repo.admit(
        lock_token="new", rate=2, burst=2, max_active=0, ttl_ms=60_000, jtis=jtis(5, "n"), now=now_ms() + 2000
    )
    stale_old = await repo.admit(lock_token="old", rate=2, burst=2, max_active=0, ttl_ms=60_000, jtis=jtis(5, "x"))
    assert stale_old.status == "not_leader"
    order = [v for v, _ in first.admitted] + [v for v, _ in second.admitted]
    assert order == ids[: len(order)] and len(order) == 4


def test_effective_rate_policy() -> None:
    assert effective_rate(10, 2, 2) == 10
    assert effective_rate(10, 1, 2) == 5
    assert effective_rate(10, 0, 2) == 0


def _monitor(redis: Redis, settings: Settings, handler) -> BackendHealthMonitor:  # type: ignore[no-untyped-def]
    return BackendHealthMonitor(
        redis,
        settings.redis_key_prefix,
        settings.backend_urls,
        path="/health",
        timeout_s=1,
        failure_threshold=2,
        recovery_threshold=2,
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


async def test_health_hysteresis(redis: Redis, settings: Settings) -> None:
    down = {"demo-2"}
    monitor = _monitor(redis, settings, lambda req: httpx.Response(503 if req.url.host in down else 200))
    await monitor.check_all()
    assert monitor.healthy_count == 1  # first observation sets the state directly
    down.clear()
    assert await monitor.check_all() == []  # one success is not enough to recover
    assert await monitor.check_all() == [("demo-2", True)]
    down.add("demo-1")
    assert await monitor.check_all() == []
    assert await monitor.check_all() == [("demo-1", False)]
    await monitor.close()


async def test_worker_auto_pauses_without_healthy_backends(redis: Redis) -> None:
    settings = make_settings(worker_tick_seconds=0.05, backend_health_interval_seconds=0.01)
    repo = QueueRepository(redis, settings.redis_key_prefix)
    try:
        healthy = {"ok": False}
        monitor = _monitor(redis, settings, lambda req: httpx.Response(200 if healthy["ok"] else 503))
        worker = AdmissionWorker(settings, redis, monitor)
        await fill(repo, 5)
        await worker.tick()
        assert await repo.queue_length() == 5  # all backends down -> nobody admitted
        assert await redis.exists(repo.key("auto_paused"))
        healthy["ok"] = True
        for _ in range(3):
            await asyncio.sleep(0.02)
            await worker.tick()
        assert await repo.queue_length() == 0  # recovered after hysteresis, burst of 5 admitted
        assert not await redis.exists(repo.key("auto_paused"))
        kinds = [e["kind"] for e in await worker.events.recent(20)]
        assert "admission_auto_paused" in kinds and "admission_auto_resumed" in kinds
        await worker.shutdown()
    finally:
        async for key in redis.scan_iter(match=f"{settings.redis_key_prefix}:*"):
            await redis.delete(key)
