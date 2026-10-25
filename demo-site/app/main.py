"""SurgeGuard Demo Website — University Examination Results Portal.

A realistic, institution-style results portal used to demonstrate SurgeGuard's virtual
waiting room and traffic surge protection.

Characteristics:
- Clean, institutional look & feel (National Examination Board · Senior Secondary Examination 2026).
- Strict reuse of SurgeGuard design tokens (no external assets, 375px responsive).
- Deliberately fragile: hard concurrency limit (MAX_CONCURRENCY) and simulated heavy query (WORK_MS).
- Unprotected port (:8081) visibly collapses under surge with a friendly 503 "Server Busy" page.
- Protected port (:8080) stays completely calm and responsive behind SurgeGuard's admission gate.
- Corner badge clearly identifies "Protected by SurgeGuard" vs "Unprotected (demo)".
- Live server load meter on the unprotected site displays active concurrency in real time.
- Deterministic test data for roll numbers 1001 through 1500 (and 20261001-20261500).
- "Served by backend: demo-1 / demo-2" footer makes load balancing obvious.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import html
import json
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

# ─── Prometheus Metrics ──────────────────────────────────────────────────────
REQUESTS = Counter(
    "demo_requests_total",
    "Requests handled by the demo origin",
    ["origin", "status", "mode"],
)
LATENCY = Histogram(
    "demo_request_duration_seconds",
    "End-to-end latency inside the demo origin",
    ["origin", "mode"],
    buckets=(0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10),
)
INFLIGHT = Gauge("demo_inflight_requests", "Requests currently doing work", ["origin"])
PENDING = Gauge("demo_pending_requests", "Requests waiting for a work slot", ["origin"])
OVERLOAD = Counter(
    "demo_overload_rejections_total",
    "Requests rejected because the origin was saturated",
    ["origin", "mode"],
)
FORBIDDEN = Counter(
    "demo_forbidden_total", "Requests without a valid origin key", ["origin"]
)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
slots = asyncio.Semaphore(MAX_CONCURRENCY)
OPEN_PATHS = {"/health", "/metrics", "/live-load"}


# ─── Deterministic Candidate Data (Roll numbers 1001 - 1500) ─────────────────
def get_candidate(roll_str: str) -> dict | None:
    raw = roll_str.strip()
    if not raw.isdigit():
        return None
    r_int = int(raw)
    # Support both 4-digit rolls (1001-1500) and year-prefixed rolls (20261001-20261500)
    if 20261000 <= r_int <= 20261500:
        seed_id = r_int - 20260000
    elif 1001 <= r_int <= 1500:
        seed_id = r_int
    elif raw == "20261234":
        seed_id = 1234
    else:
        return None

    rng = random.Random(seed_id)
    first_names = [
        "Aarav", "Diya", "Kabir", "Ananya", "Rohan", "Priya", "Siddharth",
        "Sneha", "Aditya", "Ishaan", "Meera", "Varun", "Kavya", "Aryan", "Tanvi"
    ]
    last_names = [
        "Sharma", "Patel", "Mehta", "Singh", "Verma", "Nair", "Joshi",
        "Gupta", "Kapoor", "Chopra", "Bose", "Reddy", "Kulkarni", "Deshmukh"
    ]
    parent_prefixes = [
        "Rajesh & Meera", "Vikram & Neha", "Anil & Sunita", "Suresh & Renu",
        "Manoj & Poonam", "Ramesh & Geeta", "Ashok & Vandana", "Dinesh & Ritu"
    ]
    schools = [
        "KIET Model Senior Secondary School, Delhi NCR",
        "Delhi Public Collegiate School, Sector 4",
        "St. Xavier's Academic Senior School",
        "Kendriya Vidyalaya No. 1, Central Campus",
        "National Model Public Institute"
    ]

    fn = rng.choice(first_names)
    ln = rng.choice(last_names)
    name = f"{fn} {ln}"
    parent = f"{rng.choice(parent_prefixes)} {ln}"
    school = schools[seed_id % len(schools)]
    center = f"Center {4100 + (seed_id % 50)} — National Examination Complex"

    subject_defs = [
        ("041", "Mathematics"),
        ("042", "Physics"),
        ("043", "Chemistry"),
        ("301", "English Core"),
        ("083", "Computer Science"),
    ]

    scores = []
    total = 0
    for code, subj in subject_defs:
        # Stable deterministic score between 65 and 98
        score_val = 60 + ((seed_id * 13 + rng.randint(5, 35)) % 38)
        score_val = min(98, max(60, score_val))
        th = int(score_val * 0.8)
        pr = score_val - th
        gr = "A1" if score_val >= 91 else "A2" if score_val >= 81 else "B1" if score_val >= 71 else "B2"
        scores.append((code, subj, th, pr, score_val, gr))
        total += score_val

    percentage = round((total / 500.0) * 100, 1)
    cgpa = round(percentage / 9.5, 2)
    distinction = percentage >= 75.0
    passed = percentage >= 33.0

    return {
        "roll": raw,
        "name": name,
        "parent": parent,
        "school": school,
        "center": center,
        "stream": "Senior Secondary Science (PCM + CS)",
        "scores": scores,
        "total": total,
        "max": 500,
        "pct": percentage,
        "cgpa": cgpa,
        "passed": passed,
        "distinction": distinction,
        "percentile": round(min(99.9, 70.0 + (percentage - 60.0) * 0.75), 1),
    }


# ─── Stylesheet using SurgeGuard Theme Tokens ────────────────────────────────
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
  --warning: #f2b84b;
  --danger: #ff626b;
  --radius-card: 16px;
  --radius-btn: 10px;
  --card-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.05) inset, 0 16px 36px -16px rgba(0, 0, 0, 0.85);
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
    --warning: #d97706;
    --danger: #dc2626;
    --card-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, 0 8px 24px -12px rgba(0, 0, 0, 0.12);
  }
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--bg);
  color: var(--fg);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  -webkit-font-smoothing: antialiased;
  line-height: 1.5;
}

/* Floating Corner Demo Mode Badge */
.demo-corner-badge {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 9999px;
  backdrop-filter: blur(12px);
  font-size: 11px;
  font-weight: 600;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.badge-protected {
  background: rgba(67, 201, 139, 0.12);
  border: 1px solid rgba(67, 201, 139, 0.35);
  color: var(--success);
}
.badge-unprotected {
  background: rgba(242, 184, 75, 0.14);
  border: 1px solid rgba(242, 184, 75, 0.4);
  color: var(--warning);
}
.badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.dot-success { background: var(--success); box-shadow: 0 0 8px var(--success); }
.dot-warning { background: var(--warning); box-shadow: 0 0 8px var(--warning); }
.dot-danger { background: var(--danger); box-shadow: 0 0 8px var(--danger); }

header {
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  padding: 16px 20px;
}
.header-wrap {
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.inst-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: var(--fg);
}
.inst-logo {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--surface-elevated);
  border: 1px solid var(--line-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  font-weight: 800;
  font-size: 18px;
}
.inst-title h1 {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.inst-title p {
  font-size: 12px;
  color: var(--muted);
}

main {
  max-width: 900px;
  width: 100%;
  margin: 28px auto;
  padding: 0 16px;
  flex: 1;
}

/* Institutional Live Announcement Banner */
.live-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-radius: var(--radius-card);
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  margin-bottom: 24px;
}
.live-banner-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 10px var(--success);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}
.banner-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
}
.banner-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(67, 201, 139, 0.15);
  color: var(--success);
  border: 1px solid rgba(67, 201, 139, 0.3);
}

/* Live Server Load Meter (Unprotected Site) */
.load-meter-box {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding: 14px 18px;
  margin-bottom: 24px;
}
.load-meter-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.load-meter-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.load-meter-count {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  font-weight: 700;
  color: var(--fg);
}
.load-bar-track {
  width: 100%;
  height: 8px;
  background: var(--surface-elevated);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 6px;
}
.load-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease, background 0.3s ease;
}
.load-note {
  font-size: 11px;
  color: var(--subtle);
}

/* Card Container */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding: 32px 28px;
  box-shadow: var(--card-shadow);
  margin-bottom: 24px;
}

/* Home Search Form */
.form-title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.03em;
  margin-bottom: 8px;
}
.form-desc {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 24px;
}
.search-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.input-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg);
}
.input-row {
  display: flex;
  gap: 12px;
}
.text-input {
  flex: 1;
  padding: 12px 16px;
  font-size: 15px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: var(--surface-elevated);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-btn);
  color: var(--fg);
  outline: none;
  transition: border-color 0.15s;
}
.text-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.btn-submit {
  padding: 12px 24px;
  background: var(--accent);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-btn);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s;
}
.btn-submit:hover {
  background: var(--accent-hover);
}

.chips-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.chips-label {
  font-size: 12px;
  color: var(--subtle);
}
.sample-chip {
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  color: var(--muted);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s;
}
.sample-chip:hover {
  color: var(--fg);
  border-color: var(--accent);
}

/* Result Card */
.res-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  padding-bottom: 20px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}
.res-name {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.res-meta {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}
.badge-grade {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
.grade-pass {
  background: rgba(67, 201, 139, 0.15);
  color: var(--success);
  border: 1px solid rgba(67, 201, 139, 0.3);
}

.bio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 24px;
}
.bio-item p:first-child {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--subtle);
  letter-spacing: 0.04em;
  font-weight: 600;
}
.bio-item p:last-child {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  margin-top: 2px;
}

.marks-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 24px;
}
.marks-table th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--subtle);
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-strong);
  background: var(--surface-elevated);
}
.marks-table td {
  padding: 12px 14px;
  font-size: 13px;
  border-bottom: 1px solid var(--line);
}
.marks-table tr:hover td {
  background: var(--surface-hover);
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.sum-box {
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  text-align: center;
}
.sum-label {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--subtle);
  font-weight: 600;
}
.sum-value {
  font-size: 20px;
  font-weight: 800;
  color: var(--fg);
  margin-top: 2px;
}

.actions-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.btn-outline {
  padding: 10px 18px;
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  color: var(--fg);
  border-radius: var(--radius-btn);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-outline:hover {
  background: var(--surface-hover);
  border-color: var(--line-strong);
}

/* Error 503 Card */
.error-card {
  border: 1px solid rgba(255, 98, 107, 0.4);
  background: rgba(255, 98, 107, 0.04);
}
.err-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(255, 98, 107, 0.15);
  color: var(--danger);
  border: 1px solid rgba(255, 98, 107, 0.3);
  margin-bottom: 12px;
}

footer {
  border-top: 1px solid var(--line);
  padding: 20px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--subtle);
  background: var(--surface);
  margin-top: auto;
}
"""


def render_page(title: str, body: str, is_protected: bool) -> str:
    # Corner Demo Mode Badge
    if is_protected:
        badge_html = """
        <div class="demo-corner-badge badge-protected" title="Protected by SurgeGuard Virtual Waiting Room">
          <span class="badge-dot dot-success"></span>
          <span>Protected by SurgeGuard</span>
        </div>"""
    else:
        badge_html = """
        <div class="demo-corner-badge badge-unprotected" title="Unprotected Direct Origin Ingress">
          <span class="badge-dot dot-danger"></span>
          <span>Unprotected (demo)</span>
        </div>"""

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)} · National Examination Board</title>
  <link rel="stylesheet" href="/static/site.css">
</head>
<body>
  {badge_html}
  <header>
    <div class="header-wrap">
      <a href="/" class="inst-brand" aria-label="National Examination Board Home">
        <div class="inst-logo">NEB</div>
        <div class="inst-title">
          <h1>National Examination Board</h1>
          <p>Senior Secondary Certificate Examination Results 2026</p>
        </div>
      </a>
      <div style="font-size:12px;color:var(--muted)">
        Official Examination Portal
      </div>
    </div>
  </header>

  <main>
    {body}
  </main>

  <footer>
    Served by backend: <strong>{html.escape(INSTANCE)}</strong> &middot; National Examination Board Digital Services
  </footer>
</body>
</html>"""


def render_503_page(instance: str, max_slots: int) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Server Busy (503) · National Examination Board</title>
  <link rel="stylesheet" href="/static/site.css">
</head>
<body>
  <div class="demo-corner-badge badge-unprotected">
    <span class="badge-dot dot-danger"></span>
    <span>Unprotected (demo)</span>
  </div>
  <header>
    <div class="header-wrap">
      <div class="inst-brand">
        <div class="inst-logo" style="color:var(--danger)">!</div>
        <div class="inst-title">
          <h1>National Examination Board</h1>
          <p>Server Capacity Exceeded</p>
        </div>
      </div>
    </div>
  </header>

  <main>
    <div class="card error-card">
      <span class="err-badge">HTTP 503 · Service Overloaded</span>
      <h2 style="font-size:24px;font-weight:800;margin-bottom:8px;color:var(--danger)">
        Server Busy — High Traffic Volume
      </h2>
      <p style="font-size:14px;color:var(--fg);margin-bottom:16px;line-height:1.6">
        The examination results server is currently experiencing an overwhelming surge of visitors.
        Origin concurrency capacity (hard limit: <strong>{max_slots} slots</strong>) is fully saturated.
      </p>
      <div style="background:var(--surface-elevated);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:20px;font-size:12px;color:var(--muted)">
        <p><strong>Node:</strong> {html.escape(instance)}</p>
        <p><strong>Status:</strong> Request rejected by origin concurrency guard to prevent database crash.</p>
        <p><strong>Next Step:</strong> Please wait a few seconds and refresh this page, or access via the SurgeGuard protected gate (:8080).</p>
      </div>
      <div class="actions-row">
        <button onclick="window.location.reload()" class="btn-submit" style="background:var(--accent)">
          Retry Now
        </button>
        <a href="/" class="btn-outline">Return to Home</a>
      </div>
    </div>
  </main>

  <footer>
    Served by backend: <strong>{html.escape(instance)}</strong> &middot; Failure generated by origin capacity saturation
  </footer>
</body>
</html>"""


# ─── Middleware: Guard & Concurrency Limit ──────────────────────────────────
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

    is_protected = bool(request.headers.get("x-sg-visitor")) or request.headers.get("x-forwarded-port") == "8080"
    mode = "protected" if is_protected else "unprotected"

    started = time.perf_counter()
    PENDING.labels(INSTANCE).inc()
    try:
        await asyncio.wait_for(slots.acquire(), timeout=QUEUE_TIMEOUT_MS / 1000)
    except TimeoutError:
        PENDING.labels(INSTANCE).dec()
        OVERLOAD.labels(INSTANCE, mode).inc()
        REQUESTS.labels(INSTANCE, "503", mode).inc()
        LATENCY.labels(INSTANCE, mode).observe(time.perf_counter() - started)
        # Return realistic, friendly 503 HTML error page
        return HTMLResponse(
            render_503_page(INSTANCE, MAX_CONCURRENCY),
            status_code=503,
            headers={"X-Served-By": INSTANCE, "Retry-After": "5"},
        )

    PENDING.labels(INSTANCE).dec()
    INFLIGHT.labels(INSTANCE).inc()
    try:
        # Simulated slow work (e.g. database query for student marksheet), +-20% jitter
        await asyncio.sleep(WORK_MS / 1000 * random.uniform(0.8, 1.2))
        response = await call_next(request)
    finally:
        INFLIGHT.labels(INSTANCE).dec()
        slots.release()

    response.headers["X-Served-By"] = INSTANCE
    REQUESTS.labels(INSTANCE, str(response.status_code), mode).inc()
    LATENCY.labels(INSTANCE, mode).observe(time.perf_counter() - started)
    return response


# ─── Public Endpoints ────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "instance": INSTANCE}


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/live-load")
async def live_load() -> dict[str, int]:
    """Lightweight real-time load check for the live server load meter."""
    active = MAX_CONCURRENCY - slots._value
    return {"active": max(0, active), "max": MAX_CONCURRENCY}


@app.get("/static/site.css")
async def stylesheet() -> Response:
    return Response(
        STYLE, media_type="text/css", headers={"Cache-Control": "public, max-age=300"}
    )


# ─── Application Pages ───────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def home(request: Request, roll: str | None = None) -> HTMLResponse:
    is_protected = bool(request.headers.get("x-sg-visitor")) or request.headers.get("x-forwarded-port") == "8080"

    # If roll query param is supplied, render result view directly
    if roll:
        return await handle_results_view(request, roll, is_protected)

    # Server Load Meter script and HTML (on unprotected site)
    load_meter_html = ""
    if not is_protected:
        load_meter_html = f"""
        <div class="load-meter-box" id="load-meter-section">
          <div class="load-meter-top">
            <span class="load-meter-label">Live Origin Concurrency</span>
            <span class="load-meter-count" id="load-count">0 / {MAX_CONCURRENCY} active slots</span>
          </div>
          <div class="load-bar-track">
            <div class="load-bar-fill" id="load-bar" style="width: 5%; background: var(--success);"></div>
          </div>
          <p class="load-note">
            Hard origin concurrency ceiling: <strong>{MAX_CONCURRENCY} slots</strong>. Direct traffic spikes trigger immediate HTTP 503 drops.
          </p>
        </div>
        <script>
          async function pollLoad() {{
            try {{
              const res = await fetch('/live-load');
              if (res.ok) {{
                const data = await res.json();
                const pct = Math.min(100, Math.round((data.active / data.max) * 100));
                const bar = document.getElementById('load-bar');
                const count = document.getElementById('load-count');
                if (bar && count) {{
                  bar.style.width = Math.max(5, pct) + '%';
                  count.textContent = data.active + ' / ' + data.max + ' active slots';
                  if (data.active >= data.max - 1) {{
                    bar.style.background = 'var(--danger)';
                  }} else if (data.active >= data.max / 2) {{
                    bar.style.background = 'var(--warning)';
                  }} else {{
                    bar.style.background = 'var(--success)';
                  }}
                }}
              }}
            }} catch (e) {{}}
          }}
          setInterval(pollLoad, 1000);
          pollLoad();
        </script>
        """

    body = f"""
    <div class="live-banner">
      <div class="live-banner-left">
        <span class="pulse-dot"></span>
        <span class="banner-text">Senior Secondary Examination 2026 Results are officially published and live.</span>
      </div>
      <span class="banner-badge">RESULTS LIVE</span>
    </div>

    {load_meter_html}

    <div class="card">
      <h2 class="form-title">Check Examination Result</h2>
      <p class="form-desc">Enter your 4-digit roll number (1001 to 1500) to retrieve your certified statement of marks.</p>

      <form action="/results" method="post" class="search-form">
        <div class="input-group">
          <label for="roll-input" class="input-label">Candidate Roll Number</label>
          <div class="input-row">
            <input
              type="text"
              id="roll-input"
              name="roll"
              placeholder="e.g. 1001, 1002, 1042..."
              required
              class="text-input"
              pattern="^[0-9]+$"
              autocomplete="off"
            >
            <button type="submit" class="btn-submit">
              <span>View Result</span>
              <span>&rarr;</span>
            </button>
          </div>
        </div>

        <div class="chips-row">
          <span class="chips-label">Sample Roll Numbers:</span>
          <a href="/?roll=1001" class="sample-chip">1001</a>
          <a href="/?roll=1002" class="sample-chip">1002</a>
          <a href="/?roll=1042" class="sample-chip">1042</a>
          <a href="/?roll=1250" class="sample-chip">1250</a>
          <a href="/?roll=1500" class="sample-chip">1500</a>
        </div>
      </form>
    </div>
    """
    return HTMLResponse(
        render_page("Examination Results Portal", body, is_protected),
        headers={"Cache-Control": "private, no-store"},
    )


@app.post("/results", response_class=HTMLResponse)
async def results(request: Request, roll: str = Form(...)) -> HTMLResponse:
    is_protected = bool(request.headers.get("x-sg-visitor")) or request.headers.get("x-forwarded-port") == "8080"
    return await handle_results_view(request, roll, is_protected)


async def handle_results_view(request: Request, roll_raw: str, is_protected: bool) -> HTMLResponse:
    cand = get_candidate(roll_raw)

    # If roll number is not found
    if not cand:
        body = f"""
        <div class="card">
          <div class="res-header">
            <div>
              <span class="err-badge">Query Not Found</span>
              <h2 class="res-name">Result for roll {html.escape(roll_raw)}</h2>
              <p class="res-meta">No candidate record found in the central examination registry.</p>
            </div>
          </div>

          <div style="background:var(--surface-elevated);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:24px">
            <p style="font-size:13px;color:var(--fg);margin-bottom:8px">
              <strong>Record Search Notice:</strong> Valid candidate roll numbers for this demonstration portal are integers between <strong>1001 and 1500</strong>.
            </p>
            <p style="font-size:12px;color:var(--muted)">
              Please check your roll number and try again.
            </p>
          </div>

          <div class="actions-row">
            <a href="/" class="btn-submit" style="text-decoration:none">Check Another Roll Number</a>
            <a href="/?roll=1001" class="sample-chip">Try Roll 1001</a>
            <a href="/?roll=1042" class="sample-chip">Try Roll 1042</a>
          </div>
        </div>
        """
        return HTMLResponse(
            render_page(f"Result for roll {html.escape(roll_raw)}", body, is_protected),
            headers={"Cache-Control": "private, no-store"},
        )

    # Format Marks Table
    rows = "".join(
        f"""<tr>
          <td style="font-family:ui-monospace,SFMono-Regular,monospace;color:var(--muted)">{s[0]}</td>
          <td><strong>{html.escape(s[1])}</strong></td>
          <td>{s[2]} / 80</td>
          <td>{s[3]} / 20</td>
          <td><strong style="color:var(--fg)">{s[4]} / 100</strong></td>
          <td><span style="font-weight:700;color:var(--accent)">{s[5]}</span></td>
          <td><span class="badge-grade grade-pass">PASS</span></td>
        </tr>"""
        for s in cand["scores"]
    )

    cert_hash = hashlib.sha256(
        f"{cand['roll']}:{cand['name']}:{cand['total']}:{INSTANCE}".encode()
    ).hexdigest()

    body = f"""
    <div class="card">
      <div class="res-header">
        <div>
          <h2 class="res-name">Result for roll {html.escape(cand["roll"])}</h2>
          <p class="res-meta">{html.escape(cand["name"])} &middot; All India Senior Secondary Examination 2026</p>
        </div>
        <span class="badge-grade grade-pass">
          {"PASSED WITH DISTINCTION" if cand["distinction"] else "PASSED"}
        </span>
      </div>

      <div class="bio-grid">
        <div class="bio-item">
          <p>Candidate Name</p>
          <p>{html.escape(cand["name"])}</p>
        </div>
        <div class="bio-item">
          <p>Roll Number</p>
          <p style="font-family:ui-monospace,SFMono-Regular,monospace;color:var(--accent)">{html.escape(cand["roll"])}</p>
        </div>
        <div class="bio-item">
          <p>Parents / Guardians</p>
          <p>{html.escape(cand["parent"])}</p>
        </div>
        <div class="bio-item">
          <p>School &amp; Center</p>
          <p>{html.escape(cand["school"])}</p>
        </div>
      </div>

      <div class="summary-strip">
        <div class="sum-box">
          <div class="sum-label">Grand Total</div>
          <div class="sum-value">{cand["total"]} <span style="font-size:13px;font-weight:400;color:var(--muted)">/ 500</span></div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Percentage</div>
          <div class="sum-value" style="color:var(--success)">{cand["pct"]}%</div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Cumulative GPA</div>
          <div class="sum-value">{cand["cgpa"]} <span style="font-size:13px;font-weight:400;color:var(--muted)">/ 10</span></div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Percentile</div>
          <div class="sum-value">{cand["percentile"]}%ile</div>
        </div>
      </div>

      <table class="marks-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Subject Name</th>
            <th>Theory</th>
            <th>Practical</th>
            <th>Total Marks</th>
            <th>Grade</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows}
        </tbody>
      </table>

      <div style="background:var(--surface-elevated);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:gap;font-size:11px;color:var(--subtle)">
        <span>Digital Verification Hash: <code style="font-family:ui-monospace,SFMono-Regular,monospace;color:var(--muted)">{cert_hash[:32]}...</code></span>
        <span>Verified by Origin Node: <strong>{html.escape(INSTANCE)}</strong></span>
      </div>

      <div class="actions-row">
        <button type="button" class="btn-submit" onclick="window.print()">
          Print Marksheet
        </button>
        <a href="/" class="btn-outline">
          &larr; Check Another Result
        </a>
      </div>
    </div>
    """
    return HTMLResponse(
        render_page(f"Result for roll {html.escape(cand['roll'])}", body, is_protected),
        headers={"Cache-Control": "private, no-store"},
    )
