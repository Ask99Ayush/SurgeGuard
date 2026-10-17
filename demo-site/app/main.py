"""Deliberately fragile demo origin ("Exam Results Portal").

It has a hard concurrency limit and simulated slow work. Requests beyond the limit wait in an
internal line; if they wait longer than DEMO_QUEUE_TIMEOUT_MS they get a 503. Under a surge
this produces exactly the failure mode SurgeGuard is meant to prevent.

Only the proxy may call it: every route except /health and /metrics requires the
X-Origin-Key header that Nginx injects (ORIGIN_SHARED_SECRET).
"""

from __future__ import annotations

import asyncio
import hmac
import html
import os
import random
import time

from fastapi import FastAPI, Form, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest


def _env_int(name: str) -> int:
    value = os.environ.get(name)
    if value is None or not value.strip().isdigit() or int(value) <= 0:
        raise SystemExit(f"demo-site: {name} must be a positive integer")
    return int(value)


INSTANCE = os.environ.get("INSTANCE_NAME") or os.environ.get("HOSTNAME", "demo")
MAX_CONCURRENCY = _env_int("DEMO_MAX_CONCURRENCY")
WORK_MS = _env_int("DEMO_WORK_MS")
QUEUE_TIMEOUT_MS = _env_int("DEMO_QUEUE_TIMEOUT_MS")
ORIGIN_KEY = os.environ.get("ORIGIN_SHARED_SECRET", "")
if len(ORIGIN_KEY) < 16:
    raise SystemExit("demo-site: ORIGIN_SHARED_SECRET must be set (>= 16 chars)")

REQUESTS = Counter("demo_requests_total", "Requests handled by the demo origin", ["origin", "status"])
LATENCY = Histogram(
    "demo_request_duration_seconds", "End-to-end latency inside the demo origin", ["origin"],
    buckets=(0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10),
)
INFLIGHT = Gauge("demo_inflight_requests", "Requests currently doing work", ["origin"])
PENDING = Gauge("demo_pending_requests", "Requests waiting for a work slot", ["origin"])
OVERLOAD = Counter("demo_overload_rejections_total", "Requests rejected because the origin was saturated", ["origin"])
FORBIDDEN = Counter("demo_forbidden_total", "Requests without a valid origin key", ["origin"])

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
slots = asyncio.Semaphore(MAX_CONCURRENCY)
OPEN_PATHS = {"/health", "/metrics"}

STYLE = """
:root{--bg:#f7f7f8;--fg:#1d1d22;--muted:#666a73;--line:#dcdde1;--brand:#2453a6}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{background:var(--brand);color:#fff;padding:16px 24px}main{max-width:720px;margin:32px auto;padding:0 16px}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:24px;margin-bottom:16px}
label{display:block;margin-bottom:8px;font-weight:600}input{width:100%;padding:10px;border:1px solid var(--line);border-radius:6px;font:inherit}
button{margin-top:12px;padding:10px 16px;border:0;border-radius:6px;background:var(--brand);color:#fff;font:inherit;cursor:pointer}
small{color:var(--muted)}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid var(--line)}
"""


def page(title: str, body: str) -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<link rel="stylesheet" href="/static/site.css"></head><body>
<header><strong>State Examination Board</strong> &middot; Results Portal (demo origin)</header>
<main>{body}<small>Served by {html.escape(INSTANCE)}. This is a deliberately fragile demo application.</small></main>
</body></html>"""


@app.middleware("http")
async def guard(request: Request, call_next):  # type: ignore[no-untyped-def]
    if request.url.path in OPEN_PATHS:
        return await call_next(request)
    provided = request.headers.get("x-origin-key", "")
    if not hmac.compare_digest(provided.encode(), ORIGIN_KEY.encode()):
        FORBIDDEN.labels(INSTANCE).inc()
        return PlainTextResponse("Direct access to the origin is not allowed.", status_code=403)
    if request.url.path.startswith("/static/"):
        return await call_next(request)

    started = time.perf_counter()
    PENDING.labels(INSTANCE).inc()
    try:
        await asyncio.wait_for(slots.acquire(), timeout=QUEUE_TIMEOUT_MS / 1000)
    except TimeoutError:
        PENDING.labels(INSTANCE).dec()
        OVERLOAD.labels(INSTANCE).inc()
        REQUESTS.labels(INSTANCE, "503").inc()
        LATENCY.labels(INSTANCE).observe(time.perf_counter() - started)
        return PlainTextResponse("Service overloaded. Please try again.", status_code=503,
                                 headers={"X-Served-By": INSTANCE})
    PENDING.labels(INSTANCE).dec()
    INFLIGHT.labels(INSTANCE).inc()
    try:
        # Simulated slow work (e.g. a heavy database query), +-20% jitter.
        await asyncio.sleep(WORK_MS / 1000 * random.uniform(0.8, 1.2))  # noqa: S311
        response = await call_next(request)
    finally:
        INFLIGHT.labels(INSTANCE).dec()
        slots.release()
    response.headers["X-Served-By"] = INSTANCE
    REQUESTS.labels(INSTANCE, str(response.status_code)).inc()
    LATENCY.labels(INSTANCE).observe(time.perf_counter() - started)
    return response


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "instance": INSTANCE}


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/static/site.css")
async def stylesheet() -> Response:
    return Response(STYLE, media_type="text/css", headers={"Cache-Control": "public, max-age=300"})


@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    visitor = request.headers.get("x-sg-visitor", "")
    note = f"<p><small>Admitted by SurgeGuard (visitor {html.escape(visitor[:8])}…)</small></p>" if visitor else ""
    body = f"""<div class="card"><h1>Class XII Results 2026</h1>{note}
<form method="post" action="/results"><label for="roll">Roll number</label>
<input id="roll" name="roll" inputmode="numeric" pattern="[0-9]{{6,10}}" required placeholder="e.g. 20261234">
<button type="submit">View result</button></form></div>"""
    return HTMLResponse(page("Results Portal", body), headers={"Cache-Control": "private, no-store"})


@app.post("/results", response_class=HTMLResponse)
async def results(roll: str = Form(..., min_length=6, max_length=10, pattern=r"^[0-9]+$")) -> HTMLResponse:
    # Clearly synthetic: the "result" is derived from the roll number so it is repeatable.
    seed = sum(int(c) for c in roll)
    rows = "".join(
        f"<tr><td>{subject}</td><td>{60 + (seed * (i + 3)) % 40}</td></tr>"
        for i, subject in enumerate(["Mathematics", "Physics", "Chemistry", "English", "Computer Science"])
    )
    body = f"""<div class="card"><h1>Result for roll {html.escape(roll)}</h1>
<p><small>Synthetic demo data.</small></p><table>{rows}</table>
<p><a href="/">Check another</a></p></div>"""
    return HTMLResponse(page("Your result", body), headers={"Cache-Control": "private, no-store"})
