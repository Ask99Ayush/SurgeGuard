from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from redis.exceptions import RedisError

from app.api.deps import AppContext, get_ctx

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness: the process is running. Does not check dependencies."""
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(ctx: AppContext = Depends(get_ctx)) -> JSONResponse:
    """Readiness: Redis must answer. Returns 503 otherwise so traffic is not routed here."""
    try:
        await ctx.redis.ping()
    except RedisError:
        return JSONResponse({"status": "unavailable", "checks": {"redis": "down"}}, status_code=503)
    return JSONResponse({"status": "ok", "checks": {"redis": "ok"}})


@router.get("/metrics", include_in_schema=False)
async def metrics(ctx: AppContext = Depends(get_ctx)) -> Response:
    if not ctx.settings.metrics_enabled:
        return Response(status_code=404)
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
