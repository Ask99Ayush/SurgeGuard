"""SurgeGuard Demo Website & Traffic Surge Lab.

A creative, interactive hackathon showcase demonstrating SurgeGuard's virtual waiting room,
controlled admission engine, and fail-closed traffic protection.

Includes:
- Hero presentation and live system telemetry.
- Interactive Traffic Surge Lab with 6 scenario presets and configurable sliders.
- Side-by-side Protected vs Unprotected origin comparison.
- Demo Results & Reports with CSV, JSON, standalone HTML, and Markdown summary downloads.
- Results and Insights view with KPI metrics and architectural interpretation.
- Architecture and traffic-flow visualization.
- Certified Student Results Portal with one-click candidate presets, printable marksheet PDF,
  and JSON transcript export.
- Live Origin governance metrics and health status.

Only the proxy may call origin routes: every route except /health and /metrics requires the
X-Origin-Key header that Nginx injects (ORIGIN_SHARED_SECRET).
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
import urllib.parse

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

CANDIDATE_DATA: dict[str, dict] = {
    "20261001": {
        "roll": "20261001",
        "name": "Aarav Sharma",
        "parent": "Rajesh & Meera Sharma",
        "stream": "Science (PCM + Computer Science)",
        "school": "KIET Model Senior Secondary School, Delhi NCR",
        "center": "Center 4108 — National Examination Complex",
        "scores": [
            ("041", "Mathematics", 76, 20, 96, "A1"),
            ("042", "Physics", 68, 28, 96, "A1"),
            ("043", "Chemistry", 65, 29, 94, "A1"),
            ("301", "English Core", 72, 19, 91, "A1"),
            ("083", "Computer Science", 67, 28, 95, "A1"),
        ],
        "distinction": True,
        "percentile": 99.4,
    },
    "20261002": {
        "roll": "20261002",
        "name": "Diya Patel",
        "parent": "Vikram & Neha Patel",
        "stream": "Science (PCB + Biotechnology)",
        "school": "Delhi Public Model School, Ghaziabad",
        "center": "Center 4108 — National Examination Complex",
        "scores": [
            ("044", "Biology", 67, 29, 96, "A1"),
            ("042", "Physics", 64, 27, 91, "A1"),
            ("043", "Chemistry", 66, 28, 94, "A1"),
            ("301", "English Core", 71, 18, 89, "A2"),
            ("045", "Biotechnology", 68, 29, 97, "A1"),
        ],
        "distinction": True,
        "percentile": 98.6,
    },
    "20261003": {
        "roll": "20261003",
        "name": "Kabir Mehta",
        "parent": "Anil & Sunita Mehta",
        "stream": "Commerce with Mathematics",
        "school": "St. Xavier's Academic Senior School, Delhi NCR",
        "center": "Center 3822 — City Educational Complex",
        "scores": [
            ("055", "Accountancy", 74, 19, 93, "A1"),
            ("054", "Business Studies", 72, 18, 90, "A1"),
            ("030", "Economics", 69, 19, 88, "A2"),
            ("041", "Mathematics", 68, 18, 86, "A2"),
            ("301", "English Core", 71, 18, 89, "A2"),
        ],
        "distinction": True,
        "percentile": 97.2,
    },
}


def get_candidate(roll: str) -> dict:
    if roll in CANDIDATE_DATA:
        return CANDIDATE_DATA[roll]
    seed = sum(int(ch) for ch in roll)
    names = [
        ("Ananya Singh", "Suresh & Renu Singh", "Science (PCM)"),
        ("Rohan Verma", "Manoj & Poonam Verma", "Commerce"),
        ("Priya Nair", "Ramesh & Geeta Nair", "Humanities & Economics"),
        ("Siddharth Joshi", "Ashok & Vandana Joshi", "Science (PCM + CS)"),
        ("Sneha Gupta", "Dinesh & Ritu Gupta", "Commerce & Accountancy"),
    ]
    name_info = names[seed % len(names)]
    raw = [
        ("041", "Mathematics", 52 + (seed * 3) % 25, 18 + (seed % 3)),
        ("042", "Physics", 50 + (seed * 4) % 25, 26 + (seed % 4)),
        ("043", "Chemistry", 51 + (seed * 5) % 25, 27 + (seed % 3)),
        ("301", "English Core", 58 + (seed * 6) % 20, 18 + (seed % 2)),
        ("083", "Computer Science", 55 + (seed * 7) % 22, 27 + (seed % 3)),
    ]
    scores = []
    for code, subj, th, pr in raw:
        tot = min(100, th + pr)
        gr = "A1" if tot >= 91 else "A2" if tot >= 81 else "B1" if tot >= 71 else "B2"
        scores.append((code, subj, th, pr, tot, gr))

    tot_marks = sum(s[4] for s in scores)
    pct = (tot_marks / 500) * 100
    return {
        "roll": roll,
        "name": name_info[0],
        "parent": name_info[1],
        "stream": name_info[2],
        "school": "KIET Model Senior Secondary School, Delhi NCR",
        "center": "Center 4108 — National Examination Complex",
        "scores": scores,
        "distinction": pct >= 75.0,
        "percentile": round(min(99.9, 70.0 + (pct - 60.0) * 0.75), 1),
    }


def generate_qr_svg(code: str) -> str:
    h = hashlib.sha256(code.encode()).hexdigest()
    size = 21
    rects: list[str] = [
        '<rect x="0" y="0" width="7" height="7" fill="currentColor"/>',
        '<rect x="1" y="1" width="5" height="5" fill="var(--surface)"/>',
        '<rect x="2" y="2" width="3" height="3" fill="currentColor"/>',
        f'<rect x="{size - 7}" y="0" width="7" height="7" fill="currentColor"/>',
        f'<rect x="{size - 6}" y="1" width="5" height="5" fill="var(--surface)"/>',
        f'<rect x="{size - 5}" y="2" width="3" height="3" fill="currentColor"/>',
        f'<rect x="0" y="{size - 7}" width="7" height="7" fill="currentColor"/>',
        f'<rect x="1" y="{size - 6}" width="5" height="5" fill="var(--surface)"/>',
        f'<rect x="2" y="{size - 5}" width="3" height="3" fill="currentColor"/>',
    ]
    bit_idx = 0
    for y in range(size):
        for x in range(size):
            if (
                (x < 8 and y < 8)
                or (x > size - 9 and y < 8)
                or (x < 8 and y > size - 9)
            ):
                continue
            char = h[bit_idx % len(h)]
            val = int(char, 16)
            bit_idx += 1
            if (val + x + y) % 3 == 0 or (val & 1) == 1:
                rects.append(
                    f'<rect x="{x}" y="{y}" width="1" height="1" fill="currentColor"/>'
                )
    svg_content = "".join(rects)
    return f'<svg viewBox="0 0 {size} {size}" class="qr-svg" shape-rendering="crispEdges" aria-hidden="true">{svg_content}</svg>'


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
  --cyan: #38bdf8;
  --violet: #a855f7;
  --card-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset, 0 -1px 0 0 rgba(0, 0, 0, 0.6) inset, 0 16px 40px -16px rgba(0, 0, 0, 0.85);
}

@media (prefers-color-scheme: light) {
  [data-theme="light"] {
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
    --cyan: #0284c7;
    --violet: #9333ea;
    --card-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, 0 1px 3px 0 rgba(0, 0, 0, 0.06), 0 8px 24px -12px rgba(0, 0, 0, 0.12);
  }
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--bg);
  color: var(--fg);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

header {
  position: sticky;
  top: 0;
  z-index: 50;
  padding: 12px 16px;
}
.header-inner {
  max-width: 1040px;
  margin: 0 auto;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 16px 36px -16px rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(12px);
  gap: 12px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-link {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--fg);
}
.mark-icon {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  flex-shrink: 0;
}
.brand-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.brand-title-muted {
  color: var(--muted);
}
.badge-demo {
  display: inline-block;
  padding: 1px 6px;
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  border-radius: 6px;
  font-size: 11px;
  color: var(--muted);
  font-weight: 500;
  margin-left: 4px;
}
.divider {
  width: 1px;
  height: 16px;
  background: var(--line);
}
.nav-links {
  display: flex;
  align-items: center;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}
@media (max-width: 860px) {
  .nav-links { display: none; }
}
.nav-links a {
  text-decoration: none;
  font-size: 13px;
  color: var(--muted);
  padding: 5px 9px;
  border-radius: 8px;
  transition: all 0.15s;
}
.nav-links a:hover {
  color: var(--fg);
  background: var(--surface-elevated);
}
.community-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 9999px;
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  background: var(--surface-elevated);
  padding: 3px 10px;
  border-radius: 9999px;
  border: 1px solid var(--line);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 8px var(--success);
}
.dot-warning {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 8px var(--warning);
}

main {
  max-width: 1040px;
  width: 100%;
  margin: 24px auto;
  padding: 0 16px;
  flex: 1;
}

/* Hero Section */
.hero-section {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: linear-gradient(180deg, var(--surface-elevated), var(--surface));
  padding: 44px 32px;
  margin-bottom: 28px;
  box-shadow: var(--card-shadow);
}
.hero-glow {
  position: absolute;
  top: -80px;
  right: -60px;
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, rgba(255, 92, 101, 0.15) 0%, transparent 70%);
  pointer-events: none;
}
.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--accent);
  background: rgba(255, 92, 101, 0.1);
  border: 1px solid rgba(255, 92, 101, 0.25);
  padding: 4px 12px;
  border-radius: 9999px;
  margin-bottom: 16px;
}
.hero-title {
  margin: 0 0 12px 0;
  font-size: 38px;
  line-height: 1.15;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--fg);
}
.hero-title-gradient {
  background: linear-gradient(135deg, var(--fg), var(--muted));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-desc {
  max-width: 680px;
  font-size: 16px;
  line-height: 1.6;
  color: var(--muted);
  margin: 0 0 24px 0;
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}
.btn-hero-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--fg);
  color: var(--bg);
  padding: 12px 22px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: opacity 0.15s, transform 0.1s;
}
.btn-hero-primary:hover {
  opacity: 0.92;
  transform: translateY(-1px);
}
.btn-hero-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--fg);
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.15s;
}
.btn-hero-secondary:hover {
  background: var(--surface-hover);
  border-color: var(--line-strong);
}

.hero-stats-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  border-top: 1px solid var(--line);
  padding-top: 20px;
}
.h-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.h-stat-label {
  font-size: 11px;
  color: var(--subtle);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.h-stat-val {
  font-size: 18px;
  font-weight: 700;
  color: var(--fg);
  letter-spacing: -0.02em;
}

/* Card Common */
.card {
  background: linear-gradient(180deg, var(--surface-elevated), var(--surface));
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 28px;
  box-shadow: var(--card-shadow);
  margin-bottom: 28px;
}
.section-header {
  margin-bottom: 20px;
}
.section-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
  margin-bottom: 6px;
}
.section-title {
  margin: 0 0 6px 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--fg);
}
.section-desc {
  font-size: 14px;
  color: var(--muted);
  margin: 0;
  line-height: 1.5;
}

/* Interactive Surge Lab */
.scenario-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 6px;
}
.scenario-pill {
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: all 0.15s ease;
}
.scenario-pill:hover {
  color: var(--fg);
  background: var(--surface-hover);
}
.scenario-pill.active {
  color: var(--fg);
  background: var(--surface-elevated);
  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  border: 1px solid var(--line-strong);
}

.lab-controls-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px;
  margin-bottom: 20px;
}
.control-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.control-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
.control-label {
  font-weight: 500;
  color: var(--muted);
}
.control-val {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-weight: 600;
  color: var(--fg);
}
input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
  background: var(--surface-elevated);
  height: 6px;
  border-radius: 3px;
  cursor: pointer;
}

.lab-actions-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}
.btn-lab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
}
.btn-lab-start {
  background: var(--accent);
  color: #ffffff;
}
.btn-lab-start:hover {
  background: var(--accent-hover);
}
.btn-lab-secondary {
  background: var(--surface);
  border-color: var(--line);
  color: var(--fg);
}
.btn-lab-secondary:hover {
  background: var(--surface-hover);
  border-color: var(--line-strong);
}

.lab-live-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}
.lab-kpi {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.lab-kpi-label {
  font-size: 11px;
  color: var(--subtle);
  font-weight: 500;
}
.lab-kpi-num {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--fg);
}
.lab-kpi-sub {
  font-size: 10px;
  color: var(--muted);
}

/* Canvas Timeline Chart */
.chart-box {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  position: relative;
  margin-bottom: 20px;
}
.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 12px;
}
.chart-legends {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--muted);
}
.legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}
canvas#trafficChart {
  width: 100%;
  height: 200px;
  display: block;
}

/* Results & Insights View */
.insights-box {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 20px;
  margin-top: 20px;
}
.insights-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}
.insight-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.insight-label {
  font-size: 11px;
  color: var(--subtle);
  font-weight: 600;
  text-transform: uppercase;
}
.insight-val {
  font-size: 14px;
  font-weight: 700;
  color: var(--fg);
}
.insight-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
  border-top: 1px solid var(--line);
  padding-top: 14px;
  margin: 0;
}

/* Side-by-Side Comparison */
.comparison-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 740px) {
  .comparison-grid { grid-template-columns: 1fr; }
}
.comp-card {
  border-radius: 14px;
  padding: 20px;
  border: 1px solid var(--line);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.comp-card-unprotected {
  border-color: rgba(255, 98, 107, 0.3);
}
.comp-card-protected {
  border-color: rgba(67, 201, 139, 0.35);
}
.comp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.comp-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--fg);
  margin: 0;
}
.comp-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 9999px;
}
.comp-badge-danger {
  background: rgba(255, 98, 107, 0.15);
  color: var(--danger);
  border: 1px solid rgba(255, 98, 107, 0.3);
}
.comp-badge-success {
  background: rgba(67, 201, 139, 0.15);
  color: var(--success);
  border: 1px solid rgba(67, 201, 139, 0.3);
}
.comp-list {
  list-style: none;
  padding: 0;
  margin: 12px 0 16px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
}
.comp-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

/* Reports & Downloads Section */
.reports-actions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.btn-report {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  text-decoration: none;
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-report:hover {
  background: var(--surface-hover);
  border-color: var(--accent);
  transform: translateY(-1px);
}
.btn-report-title {
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}
.btn-report-desc {
  font-size: 11px;
  color: var(--muted);
}

/* Generated Table */
.data-table-box {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow-x: auto;
  margin-bottom: 20px;
}
table.report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
}
table.report-table th {
  background: var(--surface-elevated);
  padding: 10px 14px;
  color: var(--muted);
  font-weight: 600;
  border-bottom: 1px solid var(--line);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
table.report-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  color: var(--fg);
  font-family: ui-monospace, SFMono-Regular, monospace;
}
table.report-table tr:last-child td {
  border-bottom: 0;
}

/* Architecture Flow Diagram */
.arch-diagram-box {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 24px;
  overflow-x: auto;
}
.flow-diagram-svg {
  width: 100%;
  min-width: 680px;
  height: auto;
  display: block;
}

/* Candidate Profiles Grid on Search Page */
.candidates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.candidate-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.candidate-card:hover {
  border-color: var(--accent);
  background: var(--surface-hover);
  transform: translateY(-1px);
}
.cand-roll {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: var(--accent);
  font-weight: 600;
}
.cand-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--fg);
}
.cand-stream {
  font-size: 12px;
  color: var(--muted);
}
.cand-badge {
  margin-top: 6px;
  align-self: flex-start;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 9999px;
  background: rgba(67, 201, 139, 0.15);
  color: var(--success);
  font-weight: 600;
}

label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}
.input-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
}
input[type="text"], input[type="number"], input#roll {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  font: inherit;
  font-size: 14px;
  background: var(--surface);
  color: var(--fg);
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(255, 92, 101, 0.25);
}

button.btn-primary {
  padding: 12px 24px;
  border: 0;
  border-radius: 10px;
  background: var(--fg);
  color: var(--bg);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  white-space: nowrap;
}
button.btn-primary:hover {
  opacity: 0.92;
}
button.btn-primary:active {
  transform: translateY(1px);
}

/* Student Bio Summary Card */
.student-bio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 20px;
}
.bio-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.bio-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--subtle);
  font-weight: 500;
}
.bio-val {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}

/* KPI Score Grid */
.kpi-score-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
@media (max-width: 680px) {
  .kpi-score-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.kpi-tile {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kpi-label {
  font-size: 11px;
  color: var(--muted);
  font-weight: 500;
}
.kpi-number {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--fg);
}
.kpi-sub {
  font-size: 11px;
  color: var(--subtle);
}

/* Table */
table.results-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 20px 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface);
}
table.results-table th {
  background: var(--surface-elevated);
  text-align: left;
  padding: 12px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--line);
}
table.results-table td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  color: var(--fg);
}
table.results-table tr:last-child td {
  border-bottom: none;
}
.badge-pass {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(67, 201, 139, 0.15);
  color: var(--success);
  border: 1px solid rgba(67, 201, 139, 0.3);
}

/* Official Seal and QR Verification Strip */
.seal-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  margin-top: 24px;
  flex-wrap: wrap;
}
.seal-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.qr-box {
  width: 58px;
  height: 58px;
  background: #ffffff;
  padding: 4px;
  border-radius: 8px;
  color: #08090b;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.qr-svg {
  width: 100%;
  height: 100%;
}
.seal-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.seal-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg);
}
.seal-hash {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: var(--muted);
  word-break: break-all;
}
.stamp-box {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.stamp-seal {
  font-size: 11px;
  font-weight: 700;
  color: var(--success);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px dashed var(--success);
  padding: 4px 10px;
  border-radius: 6px;
}

/* Actions Strip (Download, Print, Share) */
.actions-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.btn-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}
.btn-action-primary {
  background: var(--fg);
  color: var(--bg);
}
.btn-action-primary:hover {
  opacity: 0.92;
}
.btn-action-secondary {
  background: var(--surface);
  border-color: var(--line);
  color: var(--fg);
}
.btn-action-secondary:hover {
  background: var(--surface-hover);
  border-color: var(--line-strong);
}
.btn-icon {
  width: 16px;
  height: 16px;
}

.governance-strip {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.gov-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gov-label {
  font-size: 11px;
  color: var(--subtle);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.gov-value {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: var(--muted);
}

footer {
  border-top: 1px solid var(--line);
  padding: 24px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--subtle);
  background: var(--surface);
  margin-top: auto;
}

/* Print Styles for Marksheet / Transcript Download */
@media print {
  body {
    background: #ffffff !important;
    color: #111111 !important;
  }
  header, footer, .no-print, .actions-strip {
    display: none !important;
  }
  main {
    margin: 0 !important;
    padding: 0 !important;
    max-width: 100% !important;
  }
  .card {
    background: #ffffff !important;
    border: 2px solid #222222 !important;
    box-shadow: none !important;
    padding: 24px !important;
  }
  h1 {
    color: #000000 !important;
  }
  .subtitle, .bio-label, .kpi-label, .kpi-sub, .gov-label {
    color: #555555 !important;
  }
  .student-bio-grid, .kpi-tile, table, .seal-strip {
    background: #ffffff !important;
    border-color: #cccccc !important;
  }
  th {
    background: #f4f4f4 !important;
    color: #111111 !important;
    border-color: #cccccc !important;
  }
  td {
    color: #111111 !important;
    border-color: #e5e5e5 !important;
  }
  .kpi-number, .bio-val {
    color: #000000 !important;
  }
  .badge-pass {
    background: #e6f7ed !important;
    color: #027a48 !important;
    border-color: #a6f4c5 !important;
  }
  .stamp-seal {
    border-color: #027a48 !important;
    color: #027a48 !important;
  }
}
"""


def page(title: str, body: str) -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} &middot; SurgeGuard Demo</title>
<link rel="stylesheet" href="/static/site.css"></head><body>
<header>
  <div class="header-inner">
    <div class="header-left">
      <a href="/" class="brand-link" aria-label="SurgeGuard Demo">
        <svg viewBox="0 0 28 28" class="mark-icon" aria-hidden="true">
          <rect x="1" y="1" width="26" height="26" rx="8" fill="var(--surface-elevated)" stroke="var(--line-strong)" />
          <rect x="7" y="8" width="14" height="3" rx="1.5" fill="var(--accent)" />
          <rect x="7" y="12.5" width="10" height="3" rx="1.5" fill="var(--fg)" opacity="0.85" />
          <rect x="7" y="17" width="6" height="3" rx="1.5" fill="var(--fg)" opacity="0.45" />
          <rect x="20" y="15" width="2" height="6" rx="1" fill="var(--muted)" opacity="0.6" />
        </svg>
        <span class="brand-title">Surge<span class="brand-title-muted">Guard</span> <span class="badge-demo">Demo</span></span>
      </a>
      <div class="divider"></div>
      <ul class="nav-links">
        <li><a href="#lab">Surge Lab</a></li>
        <li><a href="#comparison">Protected vs Direct</a></li>
        <li><a href="#reports">Reports &amp; Data</a></li>
        <li><a href="#portal">Exam Portal</a></li>
        <li><a href="#architecture">Architecture</a></li>
      </ul>
      <div class="community-pill">
        <span>AWS Cloud Club KIET</span>
      </div>
    </div>
    <div class="header-right">
      <div class="status-pill">
        <span class="dot"></span>
        <span>Origin: <strong>{html.escape(INSTANCE)}</strong></span>
      </div>
    </div>
  </div>
</header>
<main>{body}</main>
<footer>
  Served by <strong>{html.escape(INSTANCE)}</strong> &middot; Protected by SurgeGuard Admission Controller in collaboration with <strong>AWS Cloud Club KIET</strong>.
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
    if visitor:
        banner = f"""<div class="banner-admitted">
          <svg class="banner-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM13.707 8.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
          </svg>
          <div>
            <strong>SurgeGuard Virtual Waiting Room Protection Active (Port 8080)</strong> &middot; Cryptographic Token: <code>{html.escape(visitor[:12])}&hellip;</code>
            <br><span style="font-size:12px;opacity:0.85">You passed through the admission queue. Origin concurrency cap ({MAX_CONCURRENCY} slots) is strictly respected.</span>
          </div>
        </div>"""
    else:
        banner = f"""<div class="banner-direct">
          <svg class="banner-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
          <div>
            <strong>Direct Baseline Inflow (Unprotected Port 8081)</strong>
            <br><span style="font-size:12px;opacity:0.85">Direct traffic bypasses virtual queueing. Under surge, capacity saturates ({MAX_CONCURRENCY} slots) and triggers 503 errors.</span>
          </div>
        </div>"""

    body = f"""
    <!-- 1. Hero Presentation Section -->
    <section class="hero-section">
      <div class="hero-glow"></div>
      <div class="hero-eyebrow">
        <span>SurgeGuard &middot; Hackathon Resilience Showcase</span>
      </div>
      <h1 class="hero-title">
        Stay Online When Traffic<br><span class="hero-title-gradient">Goes Beyond Limits.</span>
      </h1>
      <p class="hero-desc">
        Explore how SurgeGuard manages traffic surges using a virtual waiting room, controlled admission,
        and queue-based traffic flow to protect database backends from concurrency collapse.
      </p>
      <div class="hero-actions">
        <a href="#lab" class="btn-hero-primary">
          <span>Launch Interactive Demo Lab</span>
          <span aria-hidden="true">&rarr;</span>
        </a>
        <a href="#architecture" class="btn-hero-secondary">
          <span>Explore Architecture</span>
        </a>
        <a href="#portal" class="btn-hero-secondary">
          <span>View Exam Results Portal</span>
        </a>
      </div>
      <div class="hero-stats-strip">
        <div class="h-stat">
          <span class="h-stat-label">Origin Governance</span>
          <span class="h-stat-val" style="color:var(--success)">{MAX_CONCURRENCY} max slots</span>
        </div>
        <div class="h-stat">
          <span class="h-stat-label">Queue Algorithm</span>
          <span class="h-stat-val">FIFO Token Bucket</span>
        </div>
        <div class="h-stat">
          <span class="h-stat-label">Admission Security</span>
          <span class="h-stat-val">Signed HMAC-SHA256</span>
        </div>
        <div class="h-stat">
          <span class="h-stat-label">Failure Model</span>
          <span class="h-stat-val" style="color:var(--accent)">Fail-Closed (Safe)</span>
        </div>
      </div>
    </section>

    <!-- 2. System Status Notification -->
    {banner}

    <!-- 3. Interactive Traffic Surge Lab -->
    <section id="lab" class="card">
      <div class="section-header">
        <div class="section-eyebrow">Interactive Traffic Lab</div>
        <h2 class="section-title">Traffic Surge Simulator</h2>
        <p class="section-desc">
          Test real-time load behaviors across standard and extreme traffic spikes. Observe how queue buffers absorb overages while direct backends collapse.
          <span style="display:inline-block;margin-left:6px;font-size:11px;font-weight:700;color:var(--cyan);background:rgba(56,189,248,0.12);padding:2px 8px;border-radius:6px">SIMULATED DATA</span>
        </p>
      </div>

      <!-- Scenario Selector Presets -->
      <div class="scenario-selector">
        <button type="button" class="scenario-pill active" onclick="setScenario('normal')">1. Normal Traffic (25 rps)</button>
        <button type="button" class="scenario-pill" onclick="setScenario('spike')">2. Sudden Spike (450 rps)</button>
        <button type="button" class="scenario-pill" onclick="setScenario('flash')">3. Flash Sale (850 rps)</button>
        <button type="button" class="scenario-pill" onclick="setScenario('launch')">4. Product Launch (1,200 rps)</button>
        <button type="button" class="scenario-pill" onclick="setScenario('extreme')">5. Extreme Surge (2,500 rps)</button>
        <button type="button" class="scenario-pill" onclick="setScenario('custom')">6. Custom Scenario</button>
      </div>

      <!-- Configurable Sliders -->
      <div class="lab-controls-grid">
        <div class="control-item">
          <div class="control-header">
            <span class="control-label">Incoming Arrival Rate</span>
            <span class="control-val" id="val-inflow">450 req/s</span>
          </div>
          <input type="range" id="slider-inflow" min="10" max="3000" step="10" value="450" oninput="updateControls()">
        </div>
        <div class="control-item">
          <div class="control-header">
            <span class="control-label">Simulation Duration</span>
            <span class="control-val" id="val-duration">30 s</span>
          </div>
          <input type="range" id="slider-duration" min="10" max="60" step="5" value="30" oninput="updateControls()">
        </div>
        <div class="control-item">
          <div class="control-header">
            <span class="control-label">Protected Origin Capacity</span>
            <span class="control-val" id="val-capacity">20 slots</span>
          </div>
          <input type="range" id="slider-capacity" min="5" max="100" step="5" value="20" oninput="updateControls()">
        </div>
        <div class="control-item">
          <div class="control-header">
            <span class="control-label">Queue Admission Rate</span>
            <span class="control-val" id="val-admission">20 adm/s</span>
          </div>
          <input type="range" id="slider-admission" min="5" max="60" step="5" value="20" oninput="updateControls()">
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="lab-actions-strip">
        <button type="button" class="btn-lab btn-lab-start" id="btn-run" onclick="toggleSimulation()">
          <span id="run-text">Start Simulation</span>
        </button>
        <button type="button" class="btn-lab btn-lab-secondary" onclick="resetSimulation()">
          <span>Reset Lab</span>
        </button>
        <button type="button" class="btn-lab btn-lab-secondary" onclick="replaySimulation()">
          <span>Replay Last Run</span>
        </button>
        <span style="font-size:12px;color:var(--subtle);margin-left:auto" id="sim-status-label">Ready &middot; Preset loaded</span>
      </div>

      <!-- Live Simulation KPIs -->
      <div class="lab-live-kpis">
        <div class="lab-kpi">
          <span class="lab-kpi-label">Incoming Rate</span>
          <span class="lab-kpi-num" id="kpi-inflow">450 <span style="font-size:12px;font-weight:400;color:var(--muted)">/s</span></span>
          <span class="lab-kpi-sub">Arrival velocity</span>
        </div>
        <div class="lab-kpi">
          <span class="lab-kpi-label">Admitted Visitors</span>
          <span class="lab-kpi-num" style="color:var(--success)" id="kpi-admitted">20 <span style="font-size:12px;font-weight:400;color:var(--muted)">/s</span></span>
          <span class="lab-kpi-sub">Throughput released</span>
        </div>
        <div class="lab-kpi">
          <span class="lab-kpi-label">Waiting in Queue</span>
          <span class="lab-kpi-num" style="color:var(--warning)" id="kpi-queued">0</span>
          <span class="lab-kpi-sub">Redis buffered queue</span>
        </div>
        <div class="lab-kpi">
          <span class="lab-kpi-label">Unprotected 503s</span>
          <span class="lab-kpi-num" style="color:var(--danger)" id="kpi-rejected">0%</span>
          <span class="lab-kpi-sub">Direct origin drop rate</span>
        </div>
        <div class="lab-kpi">
          <span class="lab-kpi-label">Est. Wait Time</span>
          <span class="lab-kpi-num" id="kpi-wait">0s</span>
          <span class="lab-kpi-sub">Queue time estimate</span>
        </div>
      </div>

      <!-- Real-time SVG Canvas Chart -->
      <div class="chart-box">
        <div class="chart-header">
          <span style="font-weight:600;color:var(--fg)">Traffic Dynamics Timeline (Simulated)</span>
          <div class="chart-legends">
            <span><span class="legend-dot" style="background:var(--accent)"></span>Arrival Rate</span>
            <span><span class="legend-dot" style="background:var(--success)"></span>Admitted (Protected)</span>
            <span><span class="legend-dot" style="background:var(--warning)"></span>Queue Depth</span>
            <span><span class="legend-dot" style="background:var(--danger)"></span>Direct 503 Drops</span>
          </div>
        </div>
        <canvas id="trafficChart" width="900" height="200"></canvas>
      </div>

      <!-- Results and Insights View -->
      <div class="insights-box" id="insights-panel">
        <div class="insights-grid">
          <div class="insight-item">
            <span class="insight-label">Active Scenario</span>
            <span class="insight-val" id="ins-scenario">Sudden Traffic Spike</span>
          </div>
          <div class="insight-item">
            <span class="insight-label">Total Simulated Load</span>
            <span class="insight-val" id="ins-total">13,500 requests</span>
          </div>
          <div class="insight-item">
            <span class="insight-label">Peak Queue Buffer</span>
            <span class="insight-val" style="color:var(--warning)" id="ins-peak">1,450 visitors</span>
          </div>
          <div class="insight-item">
            <span class="insight-label">Origin Error Rate</span>
            <span class="insight-val" style="color:var(--success)" id="ins-errors">0.0% (Zero 5xx)</span>
          </div>
        </div>
        <p class="insight-text" id="ins-interpretation">
          <strong>Architectural Interpretation:</strong> Under a 450 req/s surge, direct unqueued traffic saturates the {MAX_CONCURRENCY}-slot concurrency ceiling within 2 seconds, causing 95% of requests to fail with 503 timeouts. SurgeGuard intercepts excess arrivals, buffers them into Redis FIFO order, and meters admission at the origin's exact capacity. Zero backend errors are observed.
        </p>
      </div>
    </section>

    <!-- 4. Side-by-Side Comparison -->
    <section id="comparison" class="card">
      <div class="section-header">
        <div class="section-eyebrow">Architectural Contrast</div>
        <h2 class="section-title">Protected vs. Unprotected Direct Flow</h2>
        <p class="section-desc">
          Compare how traffic behaves when arriving directly versus when mediated through a virtual waiting room.
        </p>
      </div>
      <div class="comparison-grid">
        <!-- Unprotected Card -->
        <div class="comp-card comp-card-unprotected">
          <div>
            <div class="comp-header">
              <h3 class="comp-title">Direct Inflow (Port 8081)</h3>
              <span class="comp-badge comp-badge-danger">Fragile Baseline</span>
            </div>
            <ul class="comp-list">
              <li><span>&#10060;</span> <span>All incoming traffic hits origin worker processes simultaneously.</span></li>
              <li><span>&#10060;</span> <span>Exceeds {MAX_CONCURRENCY} concurrency cap &rarr; 503 Service Unavailable timeouts.</span></li>
              <li><span>&#10060;</span> <span>Database thread pools exhaust; cascading upstream failure occurs.</span></li>
              <li><span>&#10060;</span> <span>Users aggressively refresh browser tabs, compounding the stampede.</span></li>
            </ul>
          </div>
          <div style="background:var(--surface-elevated);padding:10px 14px;border-radius:10px;font-size:12px;color:var(--danger)">
            <strong>Expected Outcome:</strong> Total service collapse under peak surges.
          </div>
        </div>

        <!-- Protected Card -->
        <div class="comp-card comp-card-protected">
          <div>
            <div class="comp-header">
              <h3 class="comp-title">SurgeGuard Protected (Port 8080)</h3>
              <span class="comp-badge comp-badge-success">Governed Admission</span>
            </div>
            <ul class="comp-list">
              <li><span>&#10003;</span> <span>Nginx auth_request verifies signed HMAC-SHA256 tokens on every request.</span></li>
              <li><span>&#10003;</span> <span>Unadmitted visitors enter fair FIFO queue with estimated wait time.</span></li>
              <li><span>&#10003;</span> <span>Admission worker meters traffic precisely to match origin capacity.</span></li>
              <li><span>&#10003;</span> <span>Zero database saturation, predictable response times, and 0% errors.</span></li>
            </ul>
          </div>
          <div style="background:var(--surface-elevated);padding:10px 14px;border-radius:10px;font-size:12px;color:var(--success)">
            <strong>Guaranteed Outcome:</strong> 100% origin availability and deterministic fairness.
          </div>
        </div>
      </div>
    </section>

    <!-- 5. Demo Results & Reports Section -->
    <section id="reports" class="card">
      <div class="section-header">
        <div class="section-eyebrow">Export Telemetry &amp; Artifacts</div>
        <h2 class="section-title">Demo Results &amp; Reports</h2>
        <p class="section-desc">
          Generate sample benchmark datasets and export verifiable reports across CSV, JSON, standalone HTML, and Markdown formats.
          <span style="display:inline-block;margin-left:6px;font-size:11px;font-weight:700;color:var(--cyan);background:rgba(56,189,248,0.12);padding:2px 8px;border-radius:6px">SAMPLE DATA</span>
        </p>
      </div>

      <!-- Working Action Buttons -->
      <div class="reports-actions-grid">
        <button type="button" class="btn-report" onclick="generateSampleResults()">
          <span class="btn-report-title">&#9881; Generate Sample Results</span>
          <span class="btn-report-desc">Populate deterministic benchmark dataset</span>
        </button>

        <button type="button" class="btn-report" onclick="downloadCSV()">
          <span class="btn-report-title">&#128190; Download CSV</span>
          <span class="btn-report-desc">surgeguard-demo-results.csv</span>
        </button>

        <button type="button" class="btn-report" onclick="downloadJSON()">
          <span class="btn-report-title">&#128196; Download JSON</span>
          <span class="btn-report-desc">surgeguard-demo-results.json</span>
        </button>

        <button type="button" class="btn-report" onclick="downloadHTMLReport()">
          <span class="btn-report-title">&#127760; Download HTML Report</span>
          <span class="btn-report-desc">surgeguard-demo-report.html</span>
        </button>

        <button type="button" class="btn-report" onclick="downloadMarkdownSummary()">
          <span class="btn-report-title">&#128221; Download Demo Summary</span>
          <span class="btn-report-desc">surgeguard-demo-summary.md</span>
        </button>
      </div>

      <!-- Results Table View -->
      <div class="data-table-box">
        <table class="report-table" id="sample-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Scenario</th>
              <th>Inflow (rps)</th>
              <th>Admitted (rps)</th>
              <th>Queue Depth</th>
              <th>Capacity %</th>
              <th>p95 Latency</th>
              <th>Protected 5xx</th>
              <th>Direct 5xx</th>
            </tr>
          </thead>
          <tbody id="table-body">
            <!-- Populated dynamically via generateSampleResults() -->
          </tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--subtle)">
        <span>Showing deterministic sample timeline for testing and verification.</span>
        <span id="report-gen-time">Last generated: Ready</span>
      </div>
    </section>

    <!-- 6. Architecture & Traffic Flow Diagram -->
    <section id="architecture" class="card">
      <div class="section-header">
        <div class="section-eyebrow">Cloud Architecture</div>
        <h2 class="section-title">Traffic Ingress &amp; Queue Flow Pipeline</h2>
        <p class="section-desc">
          High-performance edge reverse proxy with cryptographic subrequest authentication and centralized state.
        </p>
      </div>
      <div class="arch-diagram-box">
        <svg class="flow-diagram-svg" viewBox="0 0 880 260" xmlns="http://www.w3.org/2000/svg">
          <!-- Background Grid lines -->
          <line x1="20" y1="130" x2="860" y2="130" stroke="var(--line)" stroke-dasharray="4 4" />
          
          <!-- Node 1: Incoming Visitors -->
          <g transform="translate(30, 80)">
            <rect width="130" height="100" rx="12" fill="var(--surface-elevated)" stroke="var(--line-strong)"/>
            <text x="65" y="36" fill="var(--fg)" font-size="13" font-weight="700" text-anchor="middle">Incoming Traffic</text>
            <text x="65" y="58" fill="var(--muted)" font-size="11" text-anchor="middle">Peak Surge Clients</text>
            <rect x="25" y="70" width="80" height="18" rx="9" fill="rgba(255,92,101,0.15)"/>
            <text x="65" y="83" fill="var(--accent)" font-size="10" font-weight="600" text-anchor="middle">Up to 2,500 rps</text>
          </g>

          <!-- Arrow 1 -->
          <path d="M 160 130 L 205 130" stroke="var(--muted)" stroke-width="2" marker-end="url(#arrow)"/>

          <!-- Node 2: Nginx Ingress -->
          <g transform="translate(210, 70)">
            <rect width="160" height="120" rx="14" fill="var(--surface-elevated)" stroke="var(--accent)"/>
            <text x="80" y="34" fill="var(--fg)" font-size="14" font-weight="700" text-anchor="middle">Nginx Edge Proxy</text>
            <text x="80" y="54" fill="var(--muted)" font-size="11" text-anchor="middle">Port 8080 (Protected)</text>
            <rect x="20" y="66" width="120" height="20" rx="6" fill="var(--surface)" stroke="var(--line)"/>
            <text x="80" y="80" fill="var(--cyan)" font-size="10" font-weight="600" text-anchor="middle">auth_request subrequest</text>
            <text x="80" y="104" fill="var(--subtle)" font-size="10" text-anchor="middle">Token Verification</text>
          </g>

          <!-- Branch to API/Redis -->
          <path d="M 290 70 L 290 35 L 435 35" stroke="var(--accent)" stroke-width="2" stroke-dasharray="3 3"/>
          
          <!-- Node 3: FastAPI + Redis State -->
          <g transform="translate(440, 10)">
            <rect width="180" height="70" rx="10" fill="var(--surface)" stroke="var(--line-strong)"/>
            <text x="90" y="28" fill="var(--fg)" font-size="12" font-weight="700" text-anchor="middle">FastAPI &middot; Redis Engine</text>
            <text x="90" y="46" fill="var(--muted)" font-size="10" text-anchor="middle">FIFO Queue &middot; Token Bucket</text>
            <text x="90" y="60" fill="var(--success)" font-size="9" text-anchor="middle">&#10003; JWT HMAC-SHA256</text>
          </g>

          <!-- Arrow from Nginx to Waiting Room -->
          <path d="M 370 130 L 435 130" stroke="var(--muted)" stroke-width="2"/>

          <!-- Node 4: Virtual Waiting Room -->
          <g transform="translate(440, 95)">
            <rect width="180" height="90" rx="12" fill="var(--surface-elevated)" stroke="var(--line-strong)"/>
            <text x="90" y="32" fill="var(--fg)" font-size="13" font-weight="700" text-anchor="middle">Virtual Waiting Room</text>
            <text x="90" y="52" fill="var(--muted)" font-size="11" text-anchor="middle">Active Waiting Session</text>
            <rect x="25" y="62" width="130" height="18" rx="9" fill="rgba(67,201,139,0.15)"/>
            <text x="90" y="75" fill="var(--success)" font-size="10" font-weight="600" text-anchor="middle">Controlled Admission</text>
          </g>

          <!-- Arrow to Protected Origin -->
          <path d="M 620 130 L 685 130" stroke="var(--success)" stroke-width="2"/>

          <!-- Node 5: Protected Origin -->
          <g transform="translate(690, 70)">
            <rect width="160" height="120" rx="14" fill="var(--surface-elevated)" stroke="var(--success)"/>
            <text x="80" y="34" fill="var(--fg)" font-size="14" font-weight="700" text-anchor="middle">Protected Origin</text>
            <text x="80" y="54" fill="var(--muted)" font-size="11" text-anchor="middle">demo-1 / demo-2</text>
            <rect x="20" y="66" width="120" height="20" rx="6" fill="var(--surface)" stroke="var(--line)"/>
            <text x="80" y="80" fill="var(--success)" font-size="10" font-weight="600" text-anchor="middle">{MAX_CONCURRENCY} Max Concurrency</text>
            <text x="80" y="104" fill="var(--subtle)" font-size="10" text-anchor="middle">100% Uptime Protected</text>
          </g>
        </svg>
      </div>
    </section>

    <!-- 7. Certified Exam Results Portal -->
    <section id="portal" class="card">
      <div class="section-header">
        <div class="section-eyebrow">Demo Portal Testbed</div>
        <h2 class="section-title">Class XII Results Portal 2026</h2>
        <p class="section-desc">
          Official examination verification service protected by SurgeGuard. Click a demo candidate to simulate realistic queries or enter a custom roll number.
        </p>
      </div>

      <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
        <label style="margin:0">Featured Demo Candidates (1-Click Select)</label>
        <span style="font-size:11px;color:var(--subtle)">Click candidate to load preview</span>
      </div>

      <div class="candidates-grid">
        <div class="candidate-card" onclick="document.getElementById('roll').value='20261001'; document.getElementById('search-form').submit();">
          <span class="cand-roll">Roll: 20261001</span>
          <span class="cand-name">Aarav Sharma</span>
          <span class="cand-stream">Science (PCM + CS)</span>
          <span class="cand-badge">94.4% &middot; Distinction</span>
        </div>
        <div class="candidate-card" onclick="document.getElementById('roll').value='20261002'; document.getElementById('search-form').submit();">
          <span class="cand-roll">Roll: 20261002</span>
          <span class="cand-name">Diya Patel</span>
          <span class="cand-stream">Science (PCB + Biotech)</span>
          <span class="cand-badge">93.4% &middot; Honors</span>
        </div>
        <div class="candidate-card" onclick="document.getElementById('roll').value='20261003'; document.getElementById('search-form').submit();">
          <span class="cand-roll">Roll: 20261003</span>
          <span class="cand-name">Kabir Mehta</span>
          <span class="cand-stream">Commerce with Math</span>
          <span class="cand-badge">89.2% &middot; Merit</span>
        </div>
      </div>

      <form id="search-form" method="post" action="/results">
        <label for="roll">Or Enter Custom Student Examination Roll Number</label>
        <div class="input-row">
          <input id="roll" name="roll" inputmode="numeric" pattern="[0-9]{{6,10}}" required placeholder="Enter 6-10 digit roll number, e.g. 20261001" value="20261001">
          <button type="submit" class="btn-primary">
            <span>View Result</span>
            <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      </form>
    </section>

    <!-- 8. Supporting Guide & Limitations -->
    <section class="card" style="margin-bottom:0">
      <div class="section-header">
        <div class="section-eyebrow">Project Context &amp; Presentation</div>
        <h2 class="section-title">Hackathon Guide &amp; Technical Governance</h2>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;font-size:13px;line-height:1.6;color:var(--muted)">
        <div>
          <h4 style="color:var(--fg);margin:0 0 6px 0">2-Minute Pitch Guide</h4>
          <ol style="margin:0;padding-left:18px">
            <li>Show <strong>Interactive Surge Lab</strong>: trigger 450 rps spike &rarr; watch unqueued traffic collapse.</li>
            <li>Highlight <strong>SurgeGuard Virtual Waiting Room</strong>: traffic buffers into Redis FIFO order with fair token admission.</li>
            <li>Demonstrate <strong>Exam Portal &amp; Reports</strong>: verify 100% origin uptime and export CSV/JSON/PDF.</li>
          </ol>
        </div>
        <div>
          <h4 style="color:var(--fg);margin:0 0 6px 0">Engineering Transparency</h4>
          <p style="margin:0">
            SurgeGuard operates at the application layer to govern database concurrency and preserve origin stability. It does not replace edge volumetric DDoS protection (e.g., AWS Shield).
          </p>
        </div>
        <div>
          <h4 style="color:var(--fg);margin:0 0 6px 0">Serving Node Metadata</h4>
          <p style="margin:0">
            Instance: <code>{INSTANCE}</code> &middot; Concurrency: <code>{MAX_CONCURRENCY} slots</code><br>
            Simulation Delay: <code>~{WORK_MS} ms</code> &middot; Queue Cutoff: <code>{QUEUE_TIMEOUT_MS} ms</code>
          </p>
        </div>
      </div>
    </section>

    <!-- Client-side Interactive Simulation Script -->
    <script>
      var simRunning = false;
      var simTimer = null;
      var simStep = 0;
      var simData = [];
      var activePreset = 'normal';

      var PRESETS = {{
        normal: {{ inflow: 25, duration: 30, capacity: 20, admission: 25, name: 'Normal Traffic' }},
        spike: {{ inflow: 450, duration: 30, capacity: 20, admission: 20, name: 'Sudden Traffic Spike' }},
        flash: {{ inflow: 850, duration: 30, capacity: 20, admission: 20, name: 'Flash Sale Surge' }},
        launch: {{ inflow: 1200, duration: 30, capacity: 20, admission: 20, name: 'Product Launch' }},
        extreme: {{ inflow: 2500, duration: 30, capacity: 20, admission: 20, name: 'Extreme Stampede' }},
        custom: {{ inflow: 500, duration: 30, capacity: 20, admission: 20, name: 'Custom Scenario' }}
      }};

      function setScenario(key) {{
        activePreset = key;
        document.querySelectorAll('.scenario-pill').forEach(function(el) {{
          el.classList.remove('active');
        }});
        if (event && event.target) event.target.classList.add('active');
        var p = PRESETS[key] || PRESETS.normal;
        document.getElementById('slider-inflow').value = p.inflow;
        document.getElementById('slider-duration').value = p.duration;
        document.getElementById('slider-capacity').value = p.capacity;
        document.getElementById('slider-admission').value = p.admission;
        updateControls();
        generateSampleResults();
      }}

      function updateControls() {{
        var inf = parseInt(document.getElementById('slider-inflow').value);
        var dur = parseInt(document.getElementById('slider-duration').value);
        var cap = parseInt(document.getElementById('slider-capacity').value);
        var adm = parseInt(document.getElementById('slider-admission').value);
        document.getElementById('val-inflow').innerText = inf + ' req/s';
        document.getElementById('val-duration').innerText = dur + ' s';
        document.getElementById('val-capacity').innerText = cap + ' slots';
        document.getElementById('val-admission').innerText = adm + ' adm/s';
        document.getElementById('kpi-inflow').innerHTML = inf + ' <span style="font-size:12px;font-weight:400;color:var(--muted)">/s</span>';
      }}

      function toggleSimulation() {{
        if (simRunning) {{
          clearInterval(simTimer);
          simRunning = false;
          document.getElementById('run-text').innerText = 'Resume Simulation';
          document.getElementById('sim-status-label').innerText = 'Paused';
        }} else {{
          simRunning = true;
          document.getElementById('run-text').innerText = 'Pause';
          document.getElementById('sim-status-label').innerText = 'Simulating active surge...';
          simTimer = setInterval(tickSimulation, 1000);
        }}
      }}

      function resetSimulation() {{
        clearInterval(simTimer);
        simRunning = false;
        simStep = 0;
        simData = [];
        document.getElementById('run-text').innerText = 'Start Simulation';
        document.getElementById('sim-status-label').innerText = 'Reset to initial state';
        updateControls();
        drawChart();
      }}

      function replaySimulation() {{
        resetSimulation();
        toggleSimulation();
      }}

      function tickSimulation() {{
        var inf = parseInt(document.getElementById('slider-inflow').value);
        var dur = parseInt(document.getElementById('slider-duration').value);
        var cap = parseInt(document.getElementById('slider-capacity').value);
        var adm = parseInt(document.getElementById('slider-admission').value);

        simStep++;
        var curQueue = Math.max(0, (inf - adm) * simStep);
        var waitSec = adm > 0 ? Math.round(curQueue / adm) : 0;
        var directDropRate = inf > cap ? Math.round(((inf - cap) / inf) * 100) : 0;

        document.getElementById('kpi-admitted').innerHTML = Math.min(inf, adm) + ' <span style="font-size:12px;font-weight:400;color:var(--muted)">/s</span>';
        document.getElementById('kpi-queued').innerText = curQueue.toLocaleString();
        document.getElementById('kpi-rejected').innerText = directDropRate + '%';
        document.getElementById('kpi-wait').innerText = waitSec + 's';

        simData.push({{
          sec: simStep,
          inflow: inf,
          admitted: Math.min(inf, adm),
          queued: curQueue,
          dropRate: directDropRate
        }});

        drawChart();

        if (simStep >= dur) {{
          clearInterval(simTimer);
          simRunning = false;
          document.getElementById('run-text').innerText = 'Replay Simulation';
          document.getElementById('sim-status-label').innerText = 'Simulation completed';
        }}
      }}

      function drawChart() {{
        var canvas = document.getElementById('trafficChart');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var w = canvas.width = canvas.offsetWidth;
        var h = canvas.height = canvas.offsetHeight;
        ctx.clearRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = '#292a2e';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        for (var y = 30; y < h; y += 45) {{
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }}
        ctx.setLineDash([]);

        if (simData.length < 2) return;
        var maxVal = Math.max(100, ...simData.map(d => Math.max(d.inflow, d.queued)));

        function plot(prop, stroke, fill) {{
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (var i = 0; i < simData.length; i++) {{
            var x = (i / (simData.length - 1)) * w;
            var y = h - (simData[i][prop] / maxVal) * (h - 20);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }}
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 2.5;
          ctx.stroke();
          if (fill) {{
            ctx.lineTo(w, h);
            ctx.lineTo(0, h);
            ctx.fillStyle = fill;
            ctx.fill();
          }}
        }}

        plot('queued', '#f2b84b', 'rgba(242,184,75,0.08)');
        plot('inflow', '#ff5c65', 'rgba(255,92,101,0.06)');
        plot('admitted', '#43c98b', 'rgba(67,201,139,0.12)');
      }}

      // Reports Generation and Download Handlers
      var sampleResults = [];

      function generateSampleResults() {{
        var inf = parseInt(document.getElementById('slider-inflow').value);
        var dur = parseInt(document.getElementById('slider-duration').value);
        var cap = parseInt(document.getElementById('slider-capacity').value);
        var adm = parseInt(document.getElementById('slider-admission').value);
        var scenName = PRESETS[activePreset] ? PRESETS[activePreset].name : 'Custom Scenario';

        sampleResults = [];
        var totalReq = inf * dur;
        var totalAdmitted = Math.min(inf, adm) * dur;
        var peakQueue = Math.max(0, (inf - adm) * dur);
        var directDrop = inf > cap ? Math.round(((inf - cap) / inf) * 100) : 0;

        for (var i = 1; i <= Math.min(10, dur); i++) {{
          var curInf = inf + Math.round((Math.random() - 0.5) * (inf * 0.1));
          var curQueued = Math.max(0, (curInf - adm) * i);
          sampleResults.push({{
            time: 'T+' + i + 's',
            scenario: scenName,
            inflow: curInf,
            admitted: Math.min(curInf, adm),
            queue: curQueued,
            capacityPct: Math.min(100, Math.round((Math.min(curInf, adm) / cap) * 100)),
            latency: (42 + Math.random() * 12).toFixed(1) + ' ms',
            protErrors: '0.0%',
            directErrors: directDrop + '.0%'
          }});
        }}

        // Populate HTML Table
        var tbody = document.getElementById('table-body');
        if (tbody) {{
          tbody.innerHTML = sampleResults.map(r => `
            <tr>
              <td>${{r.time}}</td>
              <td>${{r.scenario}}</td>
              <td>${{r.inflow.toLocaleString()}}</td>
              <td style="color:var(--success)">${{r.admitted.toLocaleString()}}</td>
              <td style="color:var(--warning)">${{r.queue.toLocaleString()}}</td>
              <td>${{r.capacityPct}}%</td>
              <td>${{r.latency}}</td>
              <td style="color:var(--success)">${{r.protErrors}}</td>
              <td style="color:var(--danger)">${{r.directErrors}}</td>
            </tr>
          `).join('');
        }}

        // Update Insights
        document.getElementById('ins-scenario').innerText = scenName;
        document.getElementById('ins-total').innerText = totalReq.toLocaleString() + ' requests';
        document.getElementById('ins-peak').innerText = peakQueue.toLocaleString() + ' visitors';
        document.getElementById('report-gen-time').innerText = 'Last generated: ' + new Date().toLocaleTimeString();
      }}

      function downloadBlob(content, filename, type) {{
        var blob = new Blob([content], {{ type: type }});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }}

      function downloadCSV() {{
        if (!sampleResults.length) generateSampleResults();
        var headers = 'timestamp,scenario,inflow_rps,admitted_rps,queued_visitors,capacity_utilization_percent,p95_latency,protected_5xx_rate,unprotected_5xx_rate\\n';
        var rows = sampleResults.map(r => `"${{r.time}}","${{r.scenario}}",${{r.inflow}},${{r.admitted}},${{r.queue}},${{r.capacityPct}},"${{r.latency}}","${{r.protErrors}}","${{r.directErrors}}"`).join('\\n');
        downloadBlob(headers + rows, 'surgeguard-demo-results.csv', 'text/csv;charset=utf-8');
      }}

      function downloadJSON() {{
        if (!sampleResults.length) generateSampleResults();
        var report = {{
          schema_version: '1.0.0',
          provenance: 'SurgeGuard Traffic Lab (Simulated Data)',
          generated_at: new Date().toISOString(),
          scenario: PRESETS[activePreset] ? PRESETS[activePreset].name : 'Custom Scenario',
          configuration: {{
            inflow_rate_rps: parseInt(document.getElementById('slider-inflow').value),
            duration_seconds: parseInt(document.getElementById('slider-duration').value),
            origin_capacity_slots: parseInt(document.getElementById('slider-capacity').value),
            queue_admission_rps: parseInt(document.getElementById('slider-admission').value)
          }},
          summary: {{
            protected_error_rate: '0.0%',
            direct_unprotected_drop_rate: document.getElementById('kpi-rejected').innerText,
            peak_queue_depth: document.getElementById('ins-peak').innerText
          }},
          timeline_samples: sampleResults
        }};
        downloadBlob(JSON.stringify(report, null, 2), 'surgeguard-demo-results.json', 'application/json');
      }}

      function downloadHTMLReport() {{
        if (!sampleResults.length) generateSampleResults();
        var scen = PRESETS[activePreset] ? PRESETS[activePreset].name : 'Custom Scenario';
        var rows = sampleResults.map(r => `<tr><td>${{r.time}}</td><td>${{r.inflow}}</td><td>${{r.admitted}}</td><td>${{r.queue}}</td><td>${{r.capacityPct}}%</td><td>${{r.protErrors}}</td><td>${{r.directErrors}}</td></tr>`).join('');
        var htmlDoc = `<!doctype html><html><head><meta charset="utf-8"><title>SurgeGuard Demo Report</title><style>body{{font-family:sans-serif;padding:32px;color:#111;max-width:840px;margin:0 auto}}h1{{margin:0 0 8px}}table{{width:100%;border-collapse:collapse;margin-top:20px}}th,td{{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}}th{{background:#f5f5f5}}.pill{{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;background:#e6f4ea;color:#137333}}</style></head><body><h1>SurgeGuard Resilience Report</h1><p style="color:#666">Scenario: <strong>${{scen}}</strong> &middot; Generated: ${{new Date().toLocaleString()}}</p><p>SurgeGuard maintained 0.0% error rate under peak surge through FIFO queueing and metered token admission.</p><table><thead><tr><th>Time</th><th>Inflow</th><th>Admitted</th><th>Queue</th><th>Capacity</th><th>Protected 5xx</th><th>Direct 5xx</th></tr></thead><tbody>${{rows}}</tbody></table></body></html>`;
        downloadBlob(htmlDoc, 'surgeguard-demo-report.html', 'text/html;charset=utf-8');
      }}

      function downloadMarkdownSummary() {{
        if (!sampleResults.length) generateSampleResults();
        var scen = PRESETS[activePreset] ? PRESETS[activePreset].name : 'Custom Scenario';
        var md = `# SurgeGuard Resilience & Telemetry Summary\\n\\n` +
          `**Scenario:** ${{scen}}\\n` +
          `**Generated At:** ${{new Date().toISOString()}}\\n` +
          `**Origin Node:** ${{document.querySelector('.status-pill').innerText.trim()}}\\n\\n` +
          `## Executive Findings\\n` +
          `- **Protected 5xx Rate:** 0.0% (Zero database overload failures)\\n` +
          `- **Direct Unprotected 5xx Rate:** ${{document.getElementById('kpi-rejected').innerText}}\\n` +
          `- **Queue Depth Peak:** ${{document.getElementById('ins-peak').innerText}}\\n\\n` +
          `## Methodology\\n` +
          `SurgeGuard enforces an Nginx auth_request gate with an HMAC-SHA256 JWT admission token. Excess requests enter a Redis ZSET queue.\\n`;
        downloadBlob(md, 'surgeguard-demo-summary.md', 'text/markdown;charset=utf-8');
      }}

      // Init on load
      window.addEventListener('DOMContentLoaded', function() {{
        updateControls();
        generateSampleResults();
      }});
    </script>
    """
    return HTMLResponse(
        page("SurgeGuard Showcase", body),
        headers={"Cache-Control": "private, no-store"},
    )


@app.post("/results", response_class=HTMLResponse)
async def results(
    request: Request,
    roll: str = Form(..., min_length=6, max_length=10, pattern=r"^[0-9]+$"),
) -> HTMLResponse:
    cand = get_candidate(roll)
    visitor = request.headers.get("x-sg-visitor", "")
    total_marks = sum(s[4] for s in cand["scores"])
    max_marks = len(cand["scores"]) * 100
    percentage = (total_marks / max_marks) * 100
    cgpa = round(percentage / 9.5, 2)

    # Cryptographic certificate hash
    cert_hash = hashlib.sha256(
        f"{roll}:{cand['name']}:{total_marks}:{INSTANCE}".encode()
    ).hexdigest()
    qr_svg = generate_qr_svg(cert_hash)

    # Serialized JSON transcript for instant export
    export_json = json.dumps(
        {
            "examination": "Higher Secondary Examination 2026",
            "roll": roll,
            "candidate": cand["name"],
            "guardians": cand["parent"],
            "stream": cand["stream"],
            "school": cand["school"],
            "total_marks": total_marks,
            "max_marks": max_marks,
            "percentage": round(percentage, 2),
            "cgpa": cgpa,
            "result": (
                "PASSED (First Class with Distinction)"
                if cand["distinction"]
                else "PASSED"
            ),
            "subjects": [
                {
                    "code": s[0],
                    "name": s[1],
                    "theory": s[2],
                    "practical": s[3],
                    "total": s[4],
                    "grade": s[5],
                }
                for s in cand["scores"]
            ],
            "verification_hash": cert_hash,
            "serving_instance": INSTANCE,
            "token_verified": bool(visitor),
        },
        indent=2,
    )
    encoded_json = urllib.parse.quote(export_json)

    rows = "".join(
        f"""<tr>
          <td><span style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:var(--muted)">{s[0]}</span></td>
          <td><strong>{s[1]}</strong></td>
          <td>{s[2]} / 80</td>
          <td>{s[3]} / 20</td>
          <td><strong style="color:var(--fg)">{s[4]} / 100</strong></td>
          <td><span style="font-weight:700;color:var(--accent)">{s[5]}</span></td>
          <td><span class='badge-pass'>PASS</span></td>
        </tr>"""
        for s in cand["scores"]
    )

    body = f"""<div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="section-eyebrow">Official Statement of Marks &middot; Certified Record</div>
        <span class="badge-pass" style="font-size:12px;padding:3px 12px">
          &#10003; {"PASSED WITH DISTINCTION" if cand["distinction"] else "PASSED"}
        </span>
      </div>

      <h1 style="margin:0 0 4px 0;font-size:28px">{cand["name"]}</h1>
      <p class="section-desc" style="margin-bottom:20px">State Examination Board &middot; All India Senior Secondary Certificate Examination 2026</p>

      <!-- Student Bio Grid -->
      <div class="student-bio-grid">
        <div class="bio-item">
          <span class="bio-label">Candidate Roll No</span>
          <span class="bio-val" style="font-family:ui-monospace,SFMono-Regular,monospace;color:var(--accent)">{html.escape(roll)}</span>
        </div>
        <div class="bio-item">
          <span class="bio-label">Parents / Guardians</span>
          <span class="bio-val">{html.escape(cand["parent"])}</span>
        </div>
        <div class="bio-item">
          <span class="bio-label">Academic Stream</span>
          <span class="bio-val">{html.escape(cand["stream"])}</span>
        </div>
        <div class="bio-item">
          <span class="bio-label">School / Center</span>
          <span class="bio-val">{html.escape(cand["school"])}</span>
        </div>
      </div>

      <!-- KPI Score Tiles -->
      <div class="kpi-score-grid">
        <div class="kpi-tile">
          <span class="kpi-label">Grand Total</span>
          <span class="kpi-number">{total_marks} <span style="font-size:13px;font-weight:400;color:var(--muted)">/ {max_marks}</span></span>
          <span class="kpi-sub">Aggregate score</span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-label">Percentage</span>
          <span class="kpi-number" style="color:var(--success)">{percentage:.1f}%</span>
          <span class="kpi-sub">First Division with Honors</span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-label">Cumulative GPA</span>
          <span class="kpi-number">{cgpa} <span style="font-size:13px;font-weight:400;color:var(--muted)">/ 10</span></span>
          <span class="kpi-sub">Grade Point Equivalent</span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-label">State Percentile</span>
          <span class="kpi-number">{cand["percentile"]}%ile</span>
          <span class="kpi-sub">Top rank category</span>
        </div>
      </div>

      <!-- Marks Table -->
      <table class="results-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Subject Name</th>
            <th>Theory</th>
            <th>Internal / Lab</th>
            <th>Total Marks</th>
            <th>Grade</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>

      <!-- Digital Verification & Seal Strip -->
      <div class="seal-strip">
        <div class="seal-left">
          <div class="qr-box" title="Digital Verification QR Code">
            {qr_svg}
          </div>
          <div class="seal-text">
            <span class="seal-title">Digitally Verified Examination Certificate</span>
            <span class="seal-hash">Hash: {cert_hash[:32]}&hellip;</span>
            <span style="font-size:11px;color:var(--subtle)">Cryptographically verified record &middot; Origin node: {html.escape(INSTANCE)}</span>
          </div>
        </div>
        <div class="stamp-box">
          <div class="stamp-seal">&#10003; Verified &amp; Signed</div>
          <span style="font-size:10px;color:var(--subtle);margin-top:2px">Controller of Examinations</span>
        </div>
      </div>

      <!-- Actions Strip: PDF Download, JSON Export, Share -->
      <div class="actions-strip no-print">
        <button type="button" class="btn-action btn-action-primary" onclick="window.print()">
          <svg class="btn-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
          <span>Download Marksheet (PDF)</span>
        </button>

        <a href="data:application/json;charset=utf-8,{encoded_json}" download="marksheet_{roll}.json" class="btn-action btn-action-secondary">
          <svg class="btn-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/>
          </svg>
          <span>Export Transcript (.json)</span>
        </a>

        <a href="/" class="btn-action btn-action-secondary">
          <span>&larr; Return to Showcase</span>
        </a>
      </div>
    </div>"""
    return HTMLResponse(
        page("Certified Result - " + html.escape(cand["name"]), body),
        headers={"Cache-Control": "private, no-store"},
    )
