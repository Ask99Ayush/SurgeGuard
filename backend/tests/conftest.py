"""Shared fixtures. Tests run against a real Redis (TEST_REDIS_URL), isolated by a random key
prefix per test. `make test-backend` provides a throwaway Redis in Docker."""

from __future__ import annotations

import os
import secrets
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest
from asgi_lifespan import LifespanManager
from redis.asyncio import Redis

from app.core.config import Settings
from app.main import create_app
from app.repositories.queue_repo import QueueRepository

TEST_REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://127.0.0.1:6379/15")


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "app_env": "test",
        "redis_url": TEST_REDIS_URL,
        "redis_key_prefix": "t" + secrets.token_hex(6),
        "admission_rate": 5,
        "admission_burst": 5,
        "queue_poll_interval_seconds": 2,
        "heartbeat_timeout_seconds": 10,
        "rejoin_grace_seconds": 30,
        "backend_urls": "http://demo-1:8000,http://demo-2:8000",
        "token_ttl_seconds": 120,
        "token_signing_secret": "test-signing-secret-0123456789abcdef",
        "token_signing_kid": "k1",
        "token_issuer": "surgeguard-test",
        "token_audience": "surgeguard-protected-test",
        "visitor_cookie_secret": "test-visitor-secret-0123456789abcdef",
        "cookie_secure": False,
        "internal_auth_secret": "test-internal-secret-0123456789abcdef",
        "admin_api_key": "test-admin-key-0123456789abcdef0123",
        "rate_limit_requests": 1000,
        "rate_limit_window_seconds": 60,
        "wait_estimate_min_samples": 3,
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
async def redis(settings: Settings) -> AsyncIterator[Redis]:
    client = Redis.from_url(TEST_REDIS_URL)
    try:
        await client.ping()
    except Exception as exc:  # pragma: no cover - environment problem, not a test failure mode
        pytest.fail(f"Redis not reachable at {TEST_REDIS_URL}: {exc}. Run `make test-backend`.")
    yield client
    async for key in client.scan_iter(match=f"{settings.redis_key_prefix}:*", count=1000):
        await client.delete(key)
    await client.aclose()


@pytest.fixture
def repo(redis: Redis, settings: Settings) -> QueueRepository:
    return QueueRepository(redis, settings.redis_key_prefix)


ClientFactory = Callable[..., Any]


@pytest.fixture
async def client(settings: Settings, redis: Redis) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings, redis)
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


def admin_headers(settings: Settings) -> dict[str, str]:
    return {"X-Admin-Key": settings.admin_api_key.get_secret_value()}


def proxy_headers(settings: Settings) -> dict[str, str]:
    return {"X-SG-Proxy-Secret": settings.internal_auth_secret.get_secret_value()}
