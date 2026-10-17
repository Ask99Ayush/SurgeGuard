"""Redis outage: every path must fail closed (nobody admitted, explicit 503s)."""

import time

import httpx
from asgi_lifespan import LifespanManager
from redis.asyncio import Redis

from app.api.deps import ADMISSION_COOKIE, VISITOR_COOKIE
from app.core.security import new_visitor_id, sign_visitor_id
from app.main import create_app
from app.services.tokens import TokenService
from app.workers.admission_worker import AdmissionWorker
from tests.conftest import make_settings, proxy_headers

DEAD_REDIS = "redis://127.0.0.1:1/0"


async def test_api_fails_closed_when_redis_is_down() -> None:
    settings = make_settings(redis_url=DEAD_REDIS, redis_socket_timeout_seconds=0.3)
    dead = Redis.from_url(DEAD_REDIS, socket_connect_timeout=0.3, socket_timeout=0.3)
    app = create_app(settings, dead)
    vid = new_visitor_id()
    now = int(time.time())
    valid_token = TokenService(settings).mint(visitor_id=vid, jti="j", issued_at_s=now, expires_at_s=now + 60)
    async with LifespanManager(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            c.cookies.set(VISITOR_COOKIE, sign_visitor_id(vid, settings.visitor_cookie_secret.get_secret_value()))
            c.cookies.set(ADMISSION_COOKIE, valid_token)

            auth = await c.get("/internal/auth", headers=proxy_headers(settings))
            assert auth.status_code == 503  # a valid-looking token is NOT enough without Redis

            join = await c.post("/api/v1/queue/join")
            assert join.status_code == 503 and join.json()["error"]["code"] == "unavailable"
            assert "Retry-After" in join.headers

            assert (await c.get("/api/v1/queue/status")).status_code == 503
            assert (await c.get("/readyz")).status_code == 503
            assert (await c.get("/healthz")).status_code == 200
    await dead.aclose()


async def test_worker_admits_nobody_when_redis_is_down() -> None:
    settings = make_settings(redis_url=DEAD_REDIS, worker_tick_seconds=0.05)
    dead = Redis.from_url(DEAD_REDIS, socket_connect_timeout=0.2, socket_timeout=0.2)
    worker = AdmissionWorker(settings, dead)
    from app.observability import metrics as m

    before = m.ADMISSION_FAILURES.labels("redis")._value.get()
    import asyncio

    task = asyncio.create_task(worker.run())
    await asyncio.sleep(0.5)
    worker.stop()
    await task
    assert worker.is_leader is False
    assert m.ADMISSION_FAILURES.labels("redis")._value.get() > before
    assert m.REDIS_UP._value.get() == 0
    await dead.aclose()
