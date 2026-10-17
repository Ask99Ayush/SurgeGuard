from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, Request
from redis.asyncio import Redis

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.security import constant_time_equals
from app.repositories.queue_repo import QueueRepository
from app.services.events import EventLog
from app.services.rate_limit import RateLimiter
from app.services.tokens import TokenService

VISITOR_COOKIE = "sg_vid"
ADMISSION_COOKIE = "sg_admission"


@dataclass
class AppContext:
    settings: Settings
    redis: Redis
    repo: QueueRepository
    tokens: TokenService
    events: EventLog
    limiter: RateLimiter


def get_ctx(request: Request) -> AppContext:
    ctx: AppContext = request.app.state.ctx
    return ctx


def client_ip(request: Request) -> str:
    # The API is only reachable through Nginx, which overwrites X-Real-IP with $remote_addr.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


async def require_admin_key(request: Request, x_admin_key: str | None = Header(None)) -> None:
    ctx = get_ctx(request)
    if not constant_time_equals(x_admin_key, ctx.settings.admin_api_key.get_secret_value()):
        raise ApiError(401, "unauthorized", "Admin API key required.")
