"""Per-request metrics and one structured log line per request (no query strings, no cookies)."""

from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Match

from app.observability.metrics import HTTP_LATENCY, HTTP_REQUESTS

log = logging.getLogger("surgeguard.access")


def _route_template(request: Request) -> str:
    for route in request.app.router.routes:
        match, _ = route.matches(request.scope)
        if match == Match.FULL:
            return getattr(route, "path", "unmatched")
    return "unmatched"


class RequestMetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            elapsed = time.perf_counter() - started
            route = _route_template(request)
            HTTP_REQUESTS.labels(route, request.method, str(status)).inc()
            HTTP_LATENCY.labels(route).observe(elapsed)
            if route not in ("/internal/auth", "/metrics", "/healthz"):
                log.info(
                    "request",
                    extra={
                        "route": route,
                        "method": request.method,
                        "status": status,
                        "duration_ms": round(elapsed * 1000, 2),
                    },
                )
