"""Admin API. Requires X-Admin-Key; only the frontend's server-side route handlers call it.
Nginx does not route /api/v1/admin publicly."""

from __future__ import annotations

import json
import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, Path, Query
from redis.exceptions import RedisError

from app.api.deps import AppContext, get_ctx, require_admin_key
from app.core.errors import ApiError
from app.core.security import VISITOR_ID_PATTERN
from app.observability.metrics import TOKENS_REVOKED
from app.repositories.queue_repo import now_ms
from app.schemas.admin import EventItem, PauseRequest, PauseState, RejectRequest, VisitorPage, VisitorRow
from app.services.backend_health import backend_name, read_backend_states

router = APIRouter(prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_admin_key)])


def _int(record: dict[str, str], key: str) -> int | None:
    value = record.get(key)
    return int(float(value)) if value else None


async def _worker_status(ctx: AppContext) -> dict[str, Any]:
    raw = await ctx.redis.get(ctx.repo.key("worker", "status"))
    if not raw:
        return {"alive": False}
    data: dict[str, Any] = json.loads(raw)
    data["alive"] = True
    return data


@router.get("/overview")
async def overview(ctx: AppContext = Depends(get_ctx)) -> dict[str, Any]:
    s = ctx.settings
    started = time.perf_counter()
    await ctx.redis.ping()
    redis_latency_ms = round((time.perf_counter() - started) * 1000, 2)
    now = now_ms()
    window = s.wait_estimate_window_seconds
    counts = await ctx.repo.state_counts()
    admitted_window = await ctx.repo.admissions_since(now - window * 1000)
    auto_raw = await ctx.redis.get(ctx.repo.key("auto_paused"))
    backends = await read_backend_states(ctx.redis, s.redis_key_prefix)
    return {
        "generated_at_ms": now,
        "queue": {
            "waiting": counts["waiting"],
            "admitted_active": await ctx.repo.active_admitted(now),
            "counts": counts,
            "totals": await ctx.repo.totals(),
        },
        "admission": {
            "configured_rate": s.admission_rate,
            "measured_rate_per_s": round(admitted_window / window, 3),
            "admitted_in_window": admitted_window,
            "window_seconds": window,
            "paused": await ctx.repo.paused_info(),
            "auto_paused": json.loads(auto_raw) if auto_raw else None,
        },
        "worker": await _worker_status(ctx),
        "redis": {"ok": True, "latency_ms": redis_latency_ms},
        "backends": {
            "total": len(s.backend_urls),
            "healthy": sum(1 for b in backends if b.get("healthy")),
            "reporting": len(backends),
        },
    }


@router.get("/visitors", response_model=VisitorPage)
async def list_visitors(
    ctx: AppContext = Depends(get_ctx),
    state: Literal["all", "waiting", "admitted", "expired", "rejected"] = "all",
    q: str | None = Query(None, max_length=32, pattern=r"^[A-Za-z0-9_-]*$"),
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(25, ge=1, le=100),
) -> VisitorPage:
    total, rows = await ctx.repo.list_visitors(state, offset=(page - 1) * page_size, limit=page_size, search=q or None)
    items = []
    for row in rows:
        rec = row["record"]
        items.append(
            VisitorRow(
                visitor_id=row["visitor_id"],
                state=rec.get("state", "unknown"),
                position=row["position"],
                seq=_int(rec, "seq"),
                joined_at_ms=_int(rec, "joined_at"),
                updated_at_ms=_int(rec, "updated_at"),
                admitted_at_ms=_int(rec, "admitted_at"),
                token_expires_at_ms=_int(rec, "exp"),
                expired_reason=rec.get("expired_reason"),
                reject_reason=rec.get("reject_reason"),
            )
        )
    return VisitorPage(state=state, total=total, page=page, page_size=page_size, items=items)


@router.post("/visitors/{visitor_id}/reject")
async def reject_visitor(
    body: RejectRequest,
    visitor_id: str = Path(..., min_length=22, max_length=22),
    ctx: AppContext = Depends(get_ctx),
) -> dict[str, Any]:
    if not VISITOR_ID_PATTERN.match(visitor_id):
        raise ApiError(422, "validation_error", "invalid visitor id")
    result = await ctx.repo.reject(visitor_id, body.reason)
    if not result.ok:
        if result.previous_state == "unknown":
            raise ApiError(404, "not_found", "Visitor not found.")
        raise ApiError(409, "invalid_transition", f"Cannot reject a visitor in state '{result.previous_state}'.")
    if result.jti:
        TOKENS_REVOKED.inc()
    await ctx.events.record(
        "visitor_rejected",
        f"Visitor {visitor_id[:8]}… rejected ({body.reason})",
        "warning",
        previous_state=result.previous_state,
        token_revoked=bool(result.jti),
    )
    return {"visitor_id": visitor_id, "previous_state": result.previous_state, "token_revoked": bool(result.jti)}


@router.get("/queue/pause", response_model=PauseState)
async def pause_state(ctx: AppContext = Depends(get_ctx)) -> PauseState:
    info = await ctx.repo.paused_info()
    return PauseState(paused=info is not None, **(info or {}))


@router.post("/queue/pause", response_model=PauseState)
async def pause(body: PauseRequest, ctx: AppContext = Depends(get_ctx)) -> PauseState:
    await ctx.repo.set_paused(True, body.reason, actor="admin")
    await ctx.events.record("admission_paused", f"Admission paused by admin: {body.reason}", "warning")
    return await pause_state(ctx)


@router.post("/queue/resume", response_model=PauseState)
async def resume(ctx: AppContext = Depends(get_ctx)) -> PauseState:
    await ctx.repo.set_paused(False, "", actor="admin")
    await ctx.events.record("admission_resumed", "Admission resumed by admin")
    return await pause_state(ctx)


@router.get("/backends")
async def backends(ctx: AppContext = Depends(get_ctx)) -> dict[str, Any]:
    states = {str(b["name"]): b for b in await read_backend_states(ctx.redis, ctx.settings.redis_key_prefix)}
    items = []
    for url in ctx.settings.backend_urls:
        name = backend_name(url)
        items.append(states.get(name, {"name": name, "url": url, "healthy": None, "last_check_ms": None}))
    worker = await _worker_status(ctx)
    return {
        "items": items,
        "checks_running": worker.get("alive", False),
        "interval_seconds": ctx.settings.backend_health_interval_seconds,
    }


@router.get("/events", response_model=list[EventItem])
async def events(ctx: AppContext = Depends(get_ctx), limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
    return await ctx.events.recent(limit)


@router.get("/config")
async def config(ctx: AppContext = Depends(get_ctx)) -> dict[str, Any]:
    summary = ctx.settings.public_summary()
    summary["backends"] = [backend_name(u) for u in ctx.settings.backend_urls]
    defaults = type(ctx.settings).public_defaults()
    summary["defaults"] = {k: defaults[k] for k in ctx.settings.public_summary() if k in defaults}
    try:
        info = await ctx.redis.info("server")
        summary["redis_version"] = info.get("redis_version")
    except RedisError:
        summary["redis_version"] = None
    return summary
