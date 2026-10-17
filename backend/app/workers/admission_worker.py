"""Admission worker: a separate process that admits waiting visitors at the configured rate.

Correctness does not rest on the leader lock alone:
  * the lock (SET NX PX, renewed each tick) keeps one worker active at a time;
  * admit.lua re-checks lock ownership atomically (fencing), so a stalled ex-leader cannot admit;
  * the token bucket lives in Redis and is updated in the same script, so the rate holds across
    restarts and leader changes;
  * ZPOPMIN + state check in one script means a visitor can never be admitted twice.

Health policy (documented in docs/architecture.md):
  * healthy == 0 backends            -> auto-pause, no admissions
  * 0 < healthy < total              -> rate scaled by healthy/total
  * backend health uses hysteresis (failure / recovery thresholds) as the cooldown.

Run with:  python -m app.workers.admission_worker
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import secrets
import signal
import socket
import time

from prometheus_client import start_http_server
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.observability import metrics as m
from app.repositories.queue_repo import QueueRepository, now_ms
from app.services.backend_health import BackendHealthMonitor, effective_rate
from app.services.events import EventLog

log = logging.getLogger("surgeguard.worker")


class AdmissionWorker:
    def __init__(self, settings: Settings, redis: Redis, monitor: BackendHealthMonitor | None = None) -> None:
        self.s = settings
        self.redis = redis
        self.repo = QueueRepository(redis, settings.redis_key_prefix)
        self.events = EventLog(redis, settings.redis_key_prefix, settings.event_log_size)
        self.monitor = monitor or BackendHealthMonitor(
            redis,
            settings.redis_key_prefix,
            settings.backend_urls,
            path=settings.backend_health_path,
            timeout_s=settings.backend_health_timeout_seconds,
            failure_threshold=settings.backend_health_failure_threshold,
            recovery_threshold=settings.backend_health_recovery_threshold,
        )
        self.worker_id = f"{socket.gethostname()}-{os.getpid()}-{secrets.token_hex(3)}"
        self.lock_token = secrets.token_hex(16)
        self.is_leader = False
        self._last_health_check = 0.0
        self._auto_paused = False
        self._stopping = asyncio.Event()
        m.CONFIGURED_RATE.set(settings.admission_rate)
        m.BACKENDS_TOTAL.set(len(settings.backend_urls))

    def stop(self) -> None:
        self._stopping.set()

    @property
    def per_tick_cap(self) -> int:
        """Upper bound of admissions one tick may request (the script enforces the real rate)."""
        return max(1, math.ceil(self.s.admission_rate * self.s.worker_tick_seconds) + self.s.admission_burst)

    async def _ensure_leadership(self) -> None:
        held = await self.repo.acquire_leader(self.lock_token, self.s.worker_lock_ttl_seconds * 1000)
        if held != self.is_leader:
            self.is_leader = held
            if held:
                log.info("acquired leader lock", extra={"worker_id": self.worker_id})
                await self.events.record("worker_leader", f"Worker {self.worker_id} became admission leader")
            else:
                log.warning("lost leader lock", extra={"worker_id": self.worker_id})
        m.WORKER_LEADER.set(1 if self.is_leader else 0)

    async def _check_backends(self) -> None:
        now = time.monotonic()
        if now - self._last_health_check < self.s.backend_health_interval_seconds:
            return
        self._last_health_check = now
        changes = await self.monitor.check_all()
        for name, healthy in changes:
            if healthy:
                await self.events.record("backend_recovered", f"Backend {name} recovered", "info", backend=name)
            else:
                await self.events.record("backend_down", f"Backend {name} failed health checks", "error", backend=name)
        for state in self.monitor.states.values():
            m.BACKEND_UP.labels(state.name).set(1 if state.healthy else 0)
            if state.last_latency_ms is not None:
                m.BACKEND_CHECK_LATENCY.labels(state.name).set(state.last_latency_ms / 1000)
        m.BACKENDS_HEALTHY.set(self.monitor.healthy_count)

    async def _apply_health_policy(self) -> float:
        total = len(self.monitor.states)
        healthy = self.monitor.healthy_count
        rate = effective_rate(self.s.admission_rate, healthy, total) if self.monitor.known else 0.0
        should_pause = self.monitor.known and healthy == 0
        auto_key = self.repo.key("auto_paused")
        if should_pause:
            payload = json.dumps({"reason": "no healthy backends", "since_ms": now_ms()})
            await self.redis.set(auto_key, payload, ex=self.s.worker_lock_ttl_seconds * 3, nx=True)
            await self.redis.expire(auto_key, self.s.worker_lock_ttl_seconds * 3)
        if should_pause != self._auto_paused:
            self._auto_paused = should_pause
            if should_pause:
                await self.events.record("admission_auto_paused", "Admission auto-paused: no healthy backends", "error")
            else:
                await self.redis.delete(auto_key)
                await self.events.record("admission_auto_resumed", "Admission resumed: a backend is healthy again")
        m.PAUSED.labels("auto").set(1 if should_pause else 0)
        m.EFFECTIVE_RATE.set(rate)
        return rate

    async def _admit(self, rate: float) -> None:
        if rate <= 0:
            return
        jtis = [secrets.token_urlsafe(16) for _ in range(self.per_tick_cap)]
        result = await self.repo.admit(
            lock_token=self.lock_token,
            rate=rate,
            burst=self.s.admission_burst,
            max_active=self.s.max_active_admitted,
            ttl_ms=self.s.token_ttl_seconds * 1000,
            jtis=jtis,
        )
        m.PAUSED.labels("manual").set(1 if result.status == "paused" else 0)
        if result.status == "not_leader":
            self.is_leader = False
            m.WORKER_LEADER.set(0)
            return
        now = now_ms()
        for _vid, joined_at in result.admitted:
            m.WAIT_TIME.observe(max(0.0, (now - joined_at) / 1000))
        m.ADMISSIONS.inc(len(result.admitted))

    async def _publish_status(self, rate: float) -> None:
        status = {
            "worker_id": self.worker_id,
            "last_tick_ms": now_ms(),
            "effective_rate": rate,
            "backends_healthy": self.monitor.healthy_count,
            "backends_total": len(self.monitor.states),
            "auto_paused": self._auto_paused,
        }
        await self.redis.set(
            self.repo.key("worker", "status"), json.dumps(status), ex=self.s.worker_lock_ttl_seconds * 3
        )

    async def tick(self) -> None:
        started = time.perf_counter()
        await self.redis.ping()
        m.REDIS_LATENCY.observe(time.perf_counter() - started)
        m.REDIS_UP.set(1)

        await self._ensure_leadership()
        if not self.is_leader:
            return
        hb, tok = await self.repo.expire_stale(
            heartbeat_timeout_ms=self.s.heartbeat_timeout_seconds * 1000, limit=1000, keep=self.s.terminal_index_size
        )
        if hb:
            m.EXPIRED.labels("heartbeat").inc(hb)
        if tok:
            m.EXPIRED.labels("token_expired").inc(tok)
        await self._check_backends()
        rate = await self._apply_health_policy()
        await self._admit(rate)
        await self._publish_status(rate)
        m.QUEUE_LENGTH.set(await self.repo.queue_length())
        m.ADMITTED_ACTIVE.set(await self.repo.active_admitted())

    async def run(self) -> None:
        log.info("admission worker starting", extra={"worker_id": self.worker_id, "rate": self.s.admission_rate})
        while not self._stopping.is_set():
            try:
                await self.tick()
                m.WORKER_TICKS.inc()
                m.WORKER_LAST_TICK.set(time.time())
            except RedisError as exc:
                # Nothing is admitted while Redis is unreachable (fail closed). Retry next tick.
                m.REDIS_UP.set(0)
                m.ADMISSION_FAILURES.labels("redis").inc()
                self.is_leader = False
                m.WORKER_LEADER.set(0)
                log.error("redis error in worker tick", extra={"error_type": type(exc).__name__})
            except Exception:
                m.ADMISSION_FAILURES.labels("unexpected").inc()
                log.exception("unexpected error in worker tick")
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=self.s.worker_tick_seconds)
            except TimeoutError:
                pass
        await self.shutdown()

    async def shutdown(self) -> None:
        try:
            await self.repo.release_leader(self.lock_token)
        except RedisError:
            pass
        await self.monitor.close()
        log.info("admission worker stopped", extra={"worker_id": self.worker_id})


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level, "worker")
    if settings.metrics_enabled:
        start_http_server(settings.worker_metrics_port)
    redis = Redis.from_url(settings.redis_url, **settings.redis_kwargs())
    worker = AdmissionWorker(settings, redis)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, worker.stop)
        except NotImplementedError:  # pragma: no cover - Windows dev shells
            pass
    try:
        await worker.run()
    finally:
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())
