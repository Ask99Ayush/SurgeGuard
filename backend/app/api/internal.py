"""Private token check used by Nginx ``auth_request``. Never routed publicly.

Responses: 204 admitted, 401 not admitted (no/invalid/expired/revoked token),
403 caller is not the trusted proxy, 503 dependency unavailable (Nginx turns any
non-2xx/401/403 into a 500 and serves the fail-closed page).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, Response
from redis.exceptions import RedisError

from app.api.deps import ADMISSION_COOKIE, VISITOR_COOKIE, AppContext, get_ctx
from app.core.security import constant_time_equals, verify_visitor_cookie
from app.observability.metrics import AUTH_FAILCLOSED, TOKEN_REJECTIONS, TOKEN_VALIDATIONS
from app.services.tokens import TokenError

router = APIRouter(include_in_schema=False)
log = logging.getLogger(__name__)

PROXY_SECRET_HEADER = "x-sg-proxy-secret"  # noqa: S105 - header name, not a secret


def _reject(reason: str) -> Response:
    TOKEN_VALIDATIONS.labels("rejected").inc()
    TOKEN_REJECTIONS.labels(reason).inc()
    return Response(status_code=401, headers={"Cache-Control": "no-store"})


@router.get("/internal/auth")
async def internal_auth(request: Request, ctx: AppContext = Depends(get_ctx)) -> Response:
    s = ctx.settings
    if not constant_time_equals(request.headers.get(PROXY_SECRET_HEADER), s.internal_auth_secret.get_secret_value()):
        TOKEN_VALIDATIONS.labels("forbidden").inc()
        log.warning("internal auth called without valid proxy secret")
        return Response(status_code=403)

    token = request.cookies.get(ADMISSION_COOKIE)
    if not token:
        TOKEN_VALIDATIONS.labels("missing").inc()
        return Response(status_code=401, headers={"Cache-Control": "no-store"})
    try:
        claims = ctx.tokens.verify(token)
    except TokenError as exc:
        return _reject(exc.reason)

    visitor_id = verify_visitor_cookie(request.cookies.get(VISITOR_COOKIE), s.visitor_cookie_secret.get_secret_value())
    if visitor_id != claims.sub:
        return _reject("visitor_mismatch")

    try:
        revoked = await ctx.repo.is_revoked(claims.jti)
    except RedisError:
        AUTH_FAILCLOSED.inc()
        log.error("redis unavailable during auth; failing closed")
        return Response(status_code=503)
    if revoked:
        return _reject("revoked")

    TOKEN_VALIDATIONS.labels("valid").inc()
    return Response(status_code=204, headers={"X-SG-Visitor": visitor_id, "Cache-Control": "no-store"})
