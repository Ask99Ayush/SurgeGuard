"""Active health checks of protected backends, run by the admission worker (leader only).

Nginx Open Source only has passive health checks; these active checks feed the admission
policy (pause / reduce rate) and the admin console. They do not change Nginx routing.

Hysteresis: a backend turns unhealthy after ``failure_threshold`` consecutive failures and
healthy again after ``recovery_threshold`` consecutive successes.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import asdict, dataclass
from urllib.parse import urlparse

import httpx
from redis.asyncio import Redis


@dataclass
class BackendState:
    name: str
    url: str
    healthy: bool | None = None  # None until the first check completes
    consecutive_failures: int = 0
    consecutive_successes: int = 0
    last_check_ms: int | None = None
    last_latency_ms: float | None = None
    last_status_code: int | None = None
    last_error: str | None = None
    last_change_ms: int | None = None


def backend_name(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname or url


class BackendHealthMonitor:
    def __init__(
        self,
        redis: Redis,
        prefix: str,
        urls: list[str],
        *,
        path: str,
        timeout_s: float,
        failure_threshold: int,
        recovery_threshold: int,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.redis = redis
        self.key = f"{prefix}:backends"
        self.path = path
        self.failure_threshold = failure_threshold
        self.recovery_threshold = recovery_threshold
        self.client = client or httpx.AsyncClient(timeout=timeout_s)
        self.states = {backend_name(u): BackendState(name=backend_name(u), url=u) for u in urls}

    async def close(self) -> None:
        await self.client.aclose()

    async def _probe(self, state: BackendState) -> tuple[bool, float | None, int | None, str | None]:
        started = time.perf_counter()
        try:
            resp = await self.client.get(state.url.rstrip("/") + self.path)
            latency = (time.perf_counter() - started) * 1000
            return (
                resp.status_code == 200,
                latency,
                resp.status_code,
                None if resp.status_code == 200 else f"HTTP {resp.status_code}",
            )
        except httpx.HTTPError as exc:
            return False, None, None, type(exc).__name__

    async def check_all(self) -> list[tuple[str, bool]]:
        """Probe every backend; return the list of (name, healthy) transitions that occurred."""
        states = list(self.states.values())
        results = await asyncio.gather(*(self._probe(s) for s in states))
        now = int(time.time() * 1000)
        changes: list[tuple[str, bool]] = []
        for state, (ok, latency, code, error) in zip(states, results, strict=True):
            state.last_check_ms = now
            state.last_latency_ms = round(latency, 2) if latency is not None else None
            state.last_status_code = code
            state.last_error = error
            if ok:
                state.consecutive_successes += 1
                state.consecutive_failures = 0
            else:
                state.consecutive_failures += 1
                state.consecutive_successes = 0
            previous = state.healthy
            if previous is None:
                state.healthy = ok
            elif previous and state.consecutive_failures >= self.failure_threshold:
                state.healthy = False
            elif not previous and state.consecutive_successes >= self.recovery_threshold:
                state.healthy = True
            if previous is not None and state.healthy != previous:
                state.last_change_ms = now
                changes.append((state.name, bool(state.healthy)))
        await self.publish()
        return changes

    async def publish(self) -> None:
        mapping = {s.name: json.dumps(asdict(s)) for s in self.states.values()}
        await self.redis.hset(self.key, mapping=mapping)  # type: ignore[misc]
        await self.redis.expire(self.key, 300)

    @property
    def healthy_count(self) -> int:
        return sum(1 for s in self.states.values() if s.healthy)

    @property
    def known(self) -> bool:
        return all(s.healthy is not None for s in self.states.values())


async def read_backend_states(redis: Redis, prefix: str) -> list[dict[str, object]]:
    raw = await redis.hgetall(f"{prefix}:backends")  # type: ignore[misc]
    rows = [json.loads(v) for v in raw.values()]
    return sorted(rows, key=lambda r: str(r["name"]))


def effective_rate(configured: float, healthy: int, total: int) -> float:
    """Admission policy under degraded health: scale the rate by the healthy fraction."""
    if total <= 0 or healthy <= 0:
        return 0.0
    return configured * healthy / total
