"""Redis-backed queue state. All multi-step mutations go through the Lua scripts in ./lua.

Key layout (prefix ``P``, standalone Redis only because scripts build keys dynamically):

    P:seq             INCR counter, the only ordering source
    P:queue           ZSET waiting visitors, score = seq
    P:hb              ZSET waiting visitors, score = last heartbeat (ms)
    P:v:<id>          HASH visitor record (state, seq, joined_at, jti, exp, ...)
    P:admitted        ZSET admitted visitors, score = token exp (ms)
    P:idx:<state>     ZSET admitted/expired/rejected index for the admin console
    P:admit_log       ZSET admissions, score = admitted_at (ms), for measured throughput
    P:revoked:<jti>   revocation marker with TTL = remaining token lifetime
    P:bucket          HASH token bucket state for the admission rate
    P:paused          manual pause flag (value = JSON reason)
    P:worker:leader   leader lock (value = worker token)
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from redis.asyncio import Redis

VisitorState = Literal["waiting", "admitted", "expired", "rejected"]
STATES: tuple[VisitorState, ...] = ("waiting", "admitted", "expired", "rejected")
LUA_DIR = Path(__file__).parent / "lua"


def now_ms() -> int:
    return int(time.time() * 1000)


def _s(value: Any) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


@dataclass(frozen=True)
class JoinResult:
    state: str  # waiting | admitted | rejected | full
    seq: int
    mode: str  # new | existing | resumed | rejoined | none


@dataclass(frozen=True)
class VisitorStatus:
    state: str  # waiting | admitted | expired | rejected | unknown
    seq: int | None = None
    rank: int | None = None
    queue_length: int = 0
    jti: str | None = None
    admitted_at_ms: int | None = None
    exp_ms: int | None = None
    joined_at_ms: int | None = None


@dataclass(frozen=True)
class AdmitResult:
    status: Literal["ok", "not_leader", "paused"]
    admitted: list[tuple[str, int]]  # (visitor_id, joined_at_ms)


@dataclass(frozen=True)
class RejectResult:
    ok: bool
    previous_state: str
    jti: str | None = None


def _int_or_none(value: str) -> int | None:
    return int(float(value)) if value not in ("", None) else None


class QueueRepository:
    def __init__(self, redis: Redis, prefix: str) -> None:
        self.redis = redis
        self.p = prefix
        self._join = redis.register_script((LUA_DIR / "join.lua").read_text())
        self._status = redis.register_script((LUA_DIR / "status.lua").read_text())
        self._admit = redis.register_script((LUA_DIR / "admit.lua").read_text())
        self._expire = redis.register_script((LUA_DIR / "expire.lua").read_text())
        self._reject = redis.register_script((LUA_DIR / "reject.lua").read_text())
        self._lock = redis.register_script((LUA_DIR / "lock.lua").read_text())
        self._unlock = redis.register_script((LUA_DIR / "unlock.lua").read_text())

    def key(self, *parts: str) -> str:
        return ":".join((self.p, *parts))

    # ------------------------------------------------------------------ visitor flow
    async def join(
        self, visitor_id: str, *, grace_ms: int, max_size: int, record_ttl_s: int, now: int | None = None
    ) -> JoinResult:
        raw = await self._join(args=[self.p, visitor_id, now or now_ms(), grace_ms, max_size, record_ttl_s])
        state, seq, mode = (_s(x) for x in raw)
        return JoinResult(state=state, seq=int(seq), mode=mode)

    async def status(self, visitor_id: str, now: int | None = None) -> VisitorStatus:
        raw = [_s(x) for x in await self._status(args=[self.p, visitor_id, now or now_ms()])]
        if raw[0] == "unknown":
            return VisitorStatus(state="unknown")
        rank = int(raw[2])
        return VisitorStatus(
            state=raw[0],
            seq=_int_or_none(raw[1]),
            rank=rank if rank >= 0 else None,
            queue_length=int(raw[3]),
            jti=raw[4] or None,
            admitted_at_ms=_int_or_none(raw[5]),
            exp_ms=_int_or_none(raw[6]),
            joined_at_ms=_int_or_none(raw[7]),
        )

    async def is_revoked(self, jti: str) -> bool:
        return bool(await self.redis.exists(self.key("revoked", jti)))

    # ------------------------------------------------------------------ worker
    async def acquire_leader(self, token: str, ttl_ms: int) -> bool:
        return bool(await self._lock(keys=[self.key("worker", "leader")], args=[token, ttl_ms]))

    async def release_leader(self, token: str) -> None:
        await self._unlock(keys=[self.key("worker", "leader")], args=[token])

    async def admit(
        self,
        *,
        lock_token: str,
        rate: float,
        burst: int,
        max_active: int,
        ttl_ms: int,
        jtis: list[str],
        now: int | None = None,
    ) -> AdmitResult:
        raw = await self._admit(args=[self.p, lock_token, now or now_ms(), rate, burst, max_active, ttl_ms, *jtis])
        count = int(raw[0])
        if count == -1:
            return AdmitResult("not_leader", [])
        if count == -2:
            return AdmitResult("paused", [])
        pairs = [(_s(raw[i]), int(float(_s(raw[i + 1])))) for i in range(1, len(raw), 2)]
        return AdmitResult("ok", pairs)

    async def expire_stale(
        self, *, heartbeat_timeout_ms: int, limit: int, keep: int, now: int | None = None
    ) -> tuple[int, int]:
        raw = await self._expire(args=[self.p, now or now_ms(), heartbeat_timeout_ms, limit, keep])
        return int(raw[0]), int(raw[1])

    # ------------------------------------------------------------------ admin
    async def reject(self, visitor_id: str, reason: str, now: int | None = None) -> RejectResult:
        raw = [_s(x) for x in await self._reject(args=[self.p, visitor_id, now or now_ms(), reason])]
        if raw[0] != "ok":
            return RejectResult(ok=False, previous_state=raw[1])
        return RejectResult(ok=True, previous_state=raw[1], jti=raw[2] or None)

    async def set_paused(self, paused: bool, reason: str, actor: str) -> None:
        if paused:
            payload = json.dumps({"reason": reason, "actor": actor, "since_ms": now_ms()})
            await self.redis.set(self.key("paused"), payload)
        else:
            await self.redis.delete(self.key("paused"))

    async def paused_info(self) -> dict[str, Any] | None:
        raw = await self.redis.get(self.key("paused"))
        return json.loads(raw) if raw else None

    async def queue_length(self) -> int:
        return int(await self.redis.zcard(self.key("queue")))

    async def active_admitted(self, now: int | None = None) -> int:
        return int(await self.redis.zcount(self.key("admitted"), f"({now or now_ms()}", "+inf"))

    async def admissions_since(self, since_ms: int) -> int:
        return int(await self.redis.zcount(self.key("admit_log"), since_ms, "+inf"))

    async def state_counts(self) -> dict[str, int]:
        pipe = self.redis.pipeline(transaction=False)
        pipe.zcard(self.key("queue"))
        pipe.zcard(self.key("idx", "admitted"))
        pipe.zcard(self.key("idx", "expired"))
        pipe.zcard(self.key("idx", "rejected"))
        waiting, admitted, expired, rejected = await pipe.execute()
        return {"waiting": waiting, "admitted": admitted, "expired": expired, "rejected": rejected}

    async def totals(self) -> dict[str, int]:
        raw = await self.redis.hgetall(self.key("stats"))  # type: ignore[misc]
        return {_s(k): int(_s(v)) for k, v in raw.items()}

    def _index_key(self, state: VisitorState) -> str:
        return self.key("queue") if state == "waiting" else self.key("idx", state)

    async def _segment_ids(
        self, state: VisitorState, *, offset: int, limit: int, search: str | None
    ) -> tuple[int, list[str]]:
        """(total, ids) for one state. Waiting is ordered by position, others newest first."""
        index = self._index_key(state)
        if search:
            matched: list[str] = []
            async for member, _score in self.redis.zscan_iter(index, match=f"*{_glob_escape(search)}*", count=500):
                matched.append(_s(member))
            scores = {}
            if matched:
                pipe = self.redis.pipeline(transaction=False)
                for vid in matched:
                    pipe.zscore(index, vid)
                scores = dict(zip(matched, await pipe.execute(), strict=True))
            ordered = sorted(matched, key=lambda v: scores.get(v) or 0, reverse=state != "waiting")
            return len(ordered), ordered[offset : offset + limit]
        total = int(await self.redis.zcard(index))
        if limit <= 0 or offset >= total:
            return total, []
        if state == "waiting":
            raw = await self.redis.zrange(index, offset, offset + limit - 1)
        else:
            raw = await self.redis.zrevrange(index, offset, offset + limit - 1)
        return total, [_s(x) for x in raw]

    async def list_visitors(
        self, state: VisitorState | Literal["all"], *, offset: int, limit: int, search: str | None = None
    ) -> tuple[int, list[dict[str, Any]]]:
        """Return (total, page). "all" concatenates waiting (by position), then admitted, expired and
        rejected (newest first), paginating across segment boundaries."""
        segments: tuple[VisitorState, ...] = STATES if state == "all" else (state,)
        total = 0
        ids: list[str] = []
        for seg in segments:
            seg_offset = max(0, offset - total)
            seg_total, seg_ids = await self._segment_ids(seg, offset=seg_offset, limit=limit - len(ids), search=search)
            ids += seg_ids
            total += seg_total
        if not ids:
            return total, []
        pipe = self.redis.pipeline(transaction=False)
        for vid in ids:
            pipe.hgetall(self.key("v", vid))
            pipe.zrank(self.key("queue"), vid)
        raw = await pipe.execute()
        rows = []
        for i, vid in enumerate(ids):
            record = {_s(k): _s(v) for k, v in raw[2 * i].items()}
            rank = raw[2 * i + 1]
            rows.append({"visitor_id": vid, "record": record, "position": rank + 1 if rank is not None else None})
        return total, rows


def _glob_escape(value: str) -> str:
    return "".join(f"\\{c}" if c in "*?[]\\" else c for c in value)
