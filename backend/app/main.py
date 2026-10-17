"""FastAPI application factory for the SurgeGuard API."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from app.api import admin, health, internal, public
from app.api.deps import AppContext
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.observability.middleware import RequestMetricsMiddleware
from app.repositories.queue_repo import QueueRepository
from app.services.events import EventLog
from app.services.rate_limit import RateLimiter
from app.services.tokens import TokenService


def build_context(settings: Settings, redis: Redis) -> AppContext:
    return AppContext(
        settings=settings,
        redis=redis,
        repo=QueueRepository(redis, settings.redis_key_prefix),
        tokens=TokenService(settings),
        events=EventLog(redis, settings.redis_key_prefix, settings.event_log_size),
        limiter=RateLimiter(
            redis, settings.redis_key_prefix, settings.rate_limit_requests, settings.rate_limit_window_seconds
        ),
    )


def create_app(settings: Settings | None = None, redis: Redis | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        client = redis or Redis.from_url(settings.redis_url, health_check_interval=10, **settings.redis_kwargs())
        app.state.ctx = build_context(settings, client)
        try:
            yield
        finally:
            if redis is None:
                await client.aclose()

    app = FastAPI(
        title="SurgeGuard API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.app_env in ("development", "test") else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.app_env in ("development", "test") else None,
    )
    install_error_handlers(app)
    app.add_middleware(RequestMetricsMiddleware)
    app.include_router(health.router)
    app.include_router(public.router)
    app.include_router(internal.router)
    app.include_router(admin.router)
    return app


def app_factory() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, "api")
    return create_app(settings)
