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
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)


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

REQUESTS = Counter(
    "demo_requests_total", "Requests handled by the demo origin", ["origin", "status"]
)
LATENCY = Histogram(
    "demo_request_duration_seconds",
    "End-to-end latency inside the demo origin",
    ["origin"],
    buckets=(0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10),
)
INFLIGHT = Gauge("demo_inflight_requests", "Requests currently doing work", ["origin"])
PENDING = Gauge("demo_pending_requests", "Requests waiting for a work slot", ["origin"])
OVERLOAD = Counter(
    "demo_overload_rejections_total",
    "Requests rejected because the origin was saturated",
    ["origin"],
)
FORBIDDEN = Counter(
    "demo_forbidden_total", "Requests without a valid origin key", ["origin"]
)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
slots = asyncio.Semaphore(MAX_CONCURRENCY)
OPEN_PATHS = {"/health", "/metrics"}

STYLE = """
:root {
  --bg: #08090b;
  --surface: #101113;
  --surface-elevated: #17181b;
  --surface-hover: #1c1d21;
  --line: #292a2e;
  --line-strong: #3a3b41;
  --fg: #f5f5f6;
  --muted: #a3a4aa;
  --subtle: #8a8b91;
  --accent: #ff5c65;
  --accent-hover: #ff4752;
  --success: #43c98b;
  --card-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f4f4f6;
    --surface: #ffffff;
    --surface-elevated: #ededf0;
    --surface-hover: #e4e4e8;
    --line: #e1e1e6;
    --line-strong: #ceced6;
    --fg: #111215;
    --muted: #5e6068;
    --subtle: #82848e;
    --accent: #ff5c65;
    --accent-hover: #ff4752;
    --success: #2ea069;
    --card-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
  }
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  background: var(--bg);
  color: var(--fg);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  background: var(--surface);
  color: var(--fg);
  border-bottom: 2px solid var(--accent);
  padding: 16px 24px;
}
.header-inner {
  max-width: 840px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 17px;
  letter-spacing: -0.02em;
}
.cloud-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 92, 101, 0.15);
  color: var(--accent);
  border: 1px solid rgba(255, 92, 101, 0.3);
  padding: 3px 9px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #94a3b8;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
}

main {
  max-width: 840px;
  width: 100%;
  margin: 36px auto;
  padding: 0 20px;
  flex: 1;
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 32px;
  box-shadow: var(--card-shadow);
  margin-bottom: 24px;
}

h1 {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.subtitle {
  color: var(--muted);
  font-size: 14px;
  margin: 0 0 24px 0;
}

.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--success);
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 20px;
}

label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}
input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font: inherit;
  background: var(--surface-elevated);
  color: var(--fg);
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(255, 153, 0, 0.2);
}

button {
  margin-top: 16px;
  padding: 12px 20px;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: #111;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s, transform 0.1s;
}
button:hover {
  background: var(--accent-hover);
}
button:active {
  transform: translateY(1px);
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 20px 0;
}
th {
  text-align: left;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  border-bottom: 1px solid var(--line);
}
td {
  padding: 12px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
tr:last-child td {
  border-bottom: none;
}
.badge-pass {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(16, 185, 129, 0.15);
  color: var(--success);
}

a.action-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  font-size: 14px;
  margin-top: 12px;
}
a.action-link:hover {
  text-decoration: underline;
}

footer {
  border-top: 1px solid var(--line);
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--subtle);
  background: var(--surface);
}
"""


def page(title: str, body: str) -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} &middot; Exam Results Portal</title>
<link rel="stylesheet" href="/static/site.css"></head><body>
<header>
  <div class="header-inner">
    <div class="brand">
      <span>State Examination Board</span>
      <span class="cloud-badge">Cloud Results</span>
    </div>
    <div class="status-pill">
      <span class="dot"></span>
      <span>Origin Node: <strong>{html.escape(INSTANCE)}</strong></span>
    </div>
  </div>
</header>
<main>{body}</main>
<footer>
  Served by <strong>{html.escape(INSTANCE)}</strong> &middot; Deliberately fragile origin under concurrency governance.
</footer>
</body></html>"""


@app.middleware("http")
async def guard(request: Request, call_next):  # type: ignore[no-untyped-def]
    if request.url.path in OPEN_PATHS:
        return await call_next(request)
    provided = request.headers.get("x-origin-key", "")
    if not hmac.compare_digest(provided.encode(), ORIGIN_KEY.encode()):
        FORBIDDEN.labels(INSTANCE).inc()
        return PlainTextResponse(
            "Direct access to the origin is not allowed.", status_code=403
        )
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
        return PlainTextResponse(
            "Service overloaded. Please try again.",
            status_code=503,
            headers={"X-Served-By": INSTANCE},
        )
    PENDING.labels(INSTANCE).dec()
    INFLIGHT.labels(INSTANCE).inc()
    try:
        # Simulated slow work (e.g. a heavy database query), +-20% jitter.
        await asyncio.sleep(WORK_MS / 1000 * random.uniform(0.8, 1.2))
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
    return Response(
        STYLE, media_type="text/css", headers={"Cache-Control": "public, max-age=300"}
    )


@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    visitor = request.headers.get("x-sg-visitor", "")
    note = (
        f"""<div class="banner">
      <span>Admitted by SurgeGuard &middot; Verified Visitor Token <code>{html.escape(visitor[:8])}&hellip;</code></span>
    </div>"""
        if visitor
        else ""
    )
    body = f"""<div class="card">
      <h1>Class XII Results 2026</h1>
      <p class="subtitle">Higher Secondary Certification Board &middot; Public Results Portal</p>
      {note}
      <form method="post" action="/results">
        <label for="roll">Student Roll number</label>
        <input id="roll" name="roll" inputmode="numeric" pattern="[0-9]{{6,10}}" required placeholder="Enter 6-10 digit roll number, e.g. 20261234">
        <button type="submit">View result</button>
      </form>
    </div>"""
    return HTMLResponse(
        page("Results Portal", body), headers={"Cache-Control": "private, no-store"}
    )


@app.post("/results", response_class=HTMLResponse)
async def results(
    roll: str = Form(..., min_length=6, max_length=10, pattern=r"^[0-9]+$"),
) -> HTMLResponse:
    # Clearly synthetic: the "result" is derived from the roll number so it is repeatable.
    seed = sum(int(c) for c in roll)
    rows = "".join(
        f"<tr><td><strong>{subject}</strong></td><td>{60 + (seed * (i + 3)) % 40} / 100</td><td><span class='badge-pass'>PASS</span></td></tr>"
        for i, subject in enumerate(
            ["Mathematics", "Physics", "Chemistry", "English", "Computer Science"]
        )
    )
    body = f"""<div class="card">
      <h1>Result for roll {html.escape(roll)}</h1>
      <p class="subtitle">Official Statement of Marks &middot; Certified Record</p>
      <div class="banner">
        <span>Synthetic demo data generated deterministically for testing and verification.</span>
      </div>
      <table>
        <thead>
          <tr><th>Subject</th><th>Marks Obtained</th><th>Grade Status</th></tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p><a href="/" class="action-link">&larr; Check another roll number</a></p>
    </div>"""
    return HTMLResponse(
        page("Your result", body), headers={"Cache-Control": "private, no-store"}
    )
