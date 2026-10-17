"""Public visitor queue API, reachable through Nginx under /api/v1/queue."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import ADMISSION_COOKIE, VISITOR_COOKIE, AppContext, client_ip, get_ctx
from app.core.errors import ApiError
from app.core.security import new_visitor_id, sign_visitor_id, verify_visitor_cookie
from app.observability.metrics import QUEUE_JOINS, RATE_LIMITED, TOKENS_ISSUED
from app.repositories.queue_repo import now_ms
from app.schemas.queue import ERROR_RESPONSES, QueueStatus
from app.services.wait_estimator import estimate_wait

router = APIRouter(prefix="/api/v1/queue", tags=["queue"])


def _set_visitor_cookie(response: Response, ctx: AppContext, visitor_id: str) -> None:
    s = ctx.settings
    response.set_cookie(
        VISITOR_COOKIE,
        sign_visitor_id(visitor_id, s.visitor_cookie_secret.get_secret_value()),
        max_age=s.visitor_record_ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=s.cookie_secure,
        path="/",
    )


def _visitor_from_cookie(request: Request, ctx: AppContext) -> str | None:
    return verify_visitor_cookie(
        request.cookies.get(VISITOR_COOKIE), ctx.settings.visitor_cookie_secret.get_secret_value()
    )


async def _build_status(ctx: AppContext, visitor_id: str, response: Response) -> QueueStatus:
    s = ctx.settings
    status = await ctx.repo.status(visitor_id)
    poll = s.queue_poll_interval_seconds
    if status.state == "unknown":
        raise ApiError(404, "not_in_queue", "This visitor is not in the queue. Join first.")

    if status.state == "waiting":
        now = now_ms()
        pipe = ctx.redis.pipeline(transaction=False)
        pipe.zcount(ctx.repo.key("admit_log"), now - s.wait_estimate_window_seconds * 1000, "+inf")
        pipe.exists(ctx.repo.key("paused"))
        pipe.exists(ctx.repo.key("auto_paused"))
        admissions, manual, auto = await pipe.execute()
        paused = bool(manual or auto)
        position = (status.rank or 0) + 1
        est = estimate_wait(
            position=position,
            admissions_in_window=int(admissions),
            window_seconds=s.wait_estimate_window_seconds,
            min_samples=s.wait_estimate_min_samples,
            paused=paused,
        )
        return QueueStatus(
            state="waiting",
            position=position,
            queue_length=status.queue_length,
            estimated_wait_seconds=est.seconds,
            estimate_status=est.status,
            measured_admission_rate=est.measured_rate_per_s,
            paused=paused,
            poll_after_seconds=poll,
        )

    if status.state == "admitted" and status.jti and status.admitted_at_ms and status.exp_ms:
        exp_s = status.exp_ms // 1000
        remaining = exp_s - int(time.time())
        if remaining > 0:
            token = ctx.tokens.mint(
                visitor_id=visitor_id, jti=status.jti, issued_at_s=status.admitted_at_ms // 1000, expires_at_s=exp_s
            )
            TOKENS_ISSUED.inc()
            response.set_cookie(
                ADMISSION_COOKIE,
                token,
                max_age=remaining,
                httponly=True,
                samesite="lax",
                secure=s.cookie_secure,
                path="/",
            )
            return QueueStatus(
                state="admitted",
                estimate_status="not_applicable",
                poll_after_seconds=poll,
                admitted_until=exp_s,
                redirect_to="/",
            )
        # Token lifetime ended but cleanup has not run yet: report it as expired.
        return QueueStatus(state="expired", estimate_status="not_applicable", poll_after_seconds=poll)

    if status.state == "rejected":
        return QueueStatus(state="rejected", estimate_status="not_applicable", poll_after_seconds=poll)
    return QueueStatus(state="expired", estimate_status="not_applicable", poll_after_seconds=poll)


@router.post("/join", response_model=QueueStatus, responses=ERROR_RESPONSES)
async def join_queue(request: Request, response: Response, ctx: AppContext = Depends(get_ctx)) -> QueueStatus:
    """Join the queue, or resume an existing place. Idempotent for the same visitor cookie."""
    allowed, retry_after = await ctx.limiter.hit("join", client_ip(request))
    if not allowed:
        RATE_LIMITED.labels("join").inc()
        raise ApiError(429, "rate_limited", "Too many join attempts. Please wait.", {"Retry-After": str(retry_after)})

    s = ctx.settings
    visitor_id = _visitor_from_cookie(request, ctx) or new_visitor_id()
    result = await ctx.repo.join(
        visitor_id,
        grace_ms=s.rejoin_grace_seconds * 1000,
        max_size=s.queue_max_size,
        record_ttl_s=s.visitor_record_ttl_seconds,
    )
    QUEUE_JOINS.labels(result.mode if result.state != "full" else "full").inc()
    if result.state == "full":
        raise ApiError(
            503, "queue_full", "The queue is full right now. Please try again shortly.", {"Retry-After": "30"}
        )
    _set_visitor_cookie(response, ctx, visitor_id)
    return await _build_status(ctx, visitor_id, response)


@router.get("/status", response_model=QueueStatus, responses=ERROR_RESPONSES)
async def queue_status(request: Request, response: Response, ctx: AppContext = Depends(get_ctx)) -> QueueStatus:
    """Current status. For waiting visitors, each call is a heartbeat."""
    visitor_id = _visitor_from_cookie(request, ctx)
    if visitor_id is None:
        raise ApiError(404, "not_in_queue", "No valid visitor cookie. Join first.")
    response.headers["Cache-Control"] = "no-store"
    return await _build_status(ctx, visitor_id, response)
