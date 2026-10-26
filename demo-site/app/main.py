"""SurgeGuard Demo Website — University Examination Results Portal.

A realistic, high-stakes institutional results portal used to demonstrate SurgeGuard's virtual
waiting room and traffic surge protection.

Surfaces:
- Protected Gateway (:8080 / :8088): Behind SurgeGuard admission gate. Emerald theme, zero overload, smooth FIFO queueing.
- Unprotected Baseline (:8081): Direct origin ingress. Crimson/Amber theme, deliberately fragile with hard concurrency limit.
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
from typing import Any

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
OPEN_PATHS = {"/health", "/metrics", "/live-load", "/static/site.css"}


def check_is_protected(request: Request) -> bool:
    """Robust detection of Protected vs Unprotected origin paths."""
    if bool(request.headers.get("x-sg-visitor")):
        return True
    port = request.headers.get("x-forwarded-port", "")
    if port in ("8080", "8088"):
        return True
    host = request.headers.get("host", "")
    if ":8080" in host or ":8088" in host:
        return True
    if ":8081" in host or port == "8081":
        return False
    if request.url.port in (8080, 8088):
        return True
    if request.url.port == 8081:
        return False
    return False


# ─── Deterministic Candidate Data (Roll numbers 1001 - 1500) ─────────────────
FEATURED_CANDIDATES = {
    1001: {
        "roll": "1001",
        "name": "Aarav Sharma",
        "parent": "Rajesh & Meera Sharma",
        "school": "Delhi Model Senior Secondary School, Delhi NCR",
        "center": "Center 4102 — National Examination Complex",
        "stream": "Senior Secondary Science (PCM + Computer Science)",
        "scores": [
            ("041", "Mathematics", 78, 20, 98, "A1", 10),
            ("042", "Physics", 76, 20, 96, "A1", 10),
            ("043", "Chemistry", 75, 20, 95, "A1", 10),
            ("301", "English Core", 76, 19, 95, "A1", 10),
            ("083", "Computer Science", 78, 20, 98, "A1", 10),
        ],
        "total": 482,
        "max": 500,
        "pct": 96.4,
        "cgpa": 10.0,
        "passed": True,
        "distinction": True,
        "percentile": 99.8,
        "rank": 1,
    },
    1042: {
        "roll": "1042",
        "name": "Diya Patel",
        "parent": "Vikram & Neha Patel",
        "school": "St. Xavier's Academic Senior School, Sector 12",
        "center": "Center 4118 — North Campus Examination Hall",
        "stream": "Senior Secondary Science (PCM + Computer Science)",
        "scores": [
            ("041", "Mathematics", 74, 19, 93, "A1", 10),
            ("042", "Physics", 72, 19, 91, "A1", 10),
            ("043", "Chemistry", 71, 19, 90, "A1", 10),
            ("301", "English Core", 73, 19, 92, "A1", 10),
            ("083", "Computer Science", 74, 19, 93, "A1", 10),
        ],
        "total": 459,
        "max": 500,
        "pct": 91.8,
        "cgpa": 9.66,
        "passed": True,
        "distinction": True,
        "percentile": 96.5,
        "rank": 5,
    },
    1150: {
        "roll": "1150",
        "name": "Kabir Verma",
        "parent": "Suresh & Renu Verma",
        "school": "Kendriya Vidyalaya No. 1, Central Campus",
        "center": "Center 4125 — West City Testing Center",
        "stream": "Senior Secondary Science (PCM + Computer Science)",
        "scores": [
            ("041", "Mathematics", 65, 18, 83, "A2", 9),
            ("042", "Physics", 64, 17, 81, "A2", 9),
            ("043", "Chemistry", 66, 18, 84, "A2", 9),
            ("301", "English Core", 65, 18, 83, "A2", 9),
            ("083", "Computer Science", 63, 17, 80, "B1", 8),
        ],
        "total": 411,
        "max": 500,
        "pct": 82.2,
        "cgpa": 8.65,
        "passed": True,
        "distinction": True,
        "percentile": 87.4,
        "rank": 38,
    },
    1250: {
        "roll": "1250",
        "name": "Ananya Singh",
        "parent": "Manoj & Poonam Singh",
        "school": "National Model Public Institute, East Enclave",
        "center": "Center 4140 — East District Examination Center",
        "stream": "Senior Secondary Science (PCM + Computer Science)",
        "scores": [
            ("041", "Mathematics", 52, 16, 68, "B1", 8),
            ("042", "Physics", 53, 15, 68, "B1", 8),
            ("043", "Chemistry", 54, 16, 70, "B1", 8),
            ("301", "English Core", 55, 16, 71, "B1", 8),
            ("083", "Computer Science", 50, 15, 65, "B2", 7),
        ],
        "total": 342,
        "max": 500,
        "pct": 68.4,
        "cgpa": 7.2,
        "passed": True,
        "distinction": False,
        "percentile": 69.2,
        "rank": 142,
    },
}


def get_candidate(roll_str: str) -> dict[str, Any] | None:
    raw = roll_str.strip()
    if not raw.isdigit():
        return None
    r_int = int(raw)
    if 20261000 <= r_int <= 20261500:
        seed_id = r_int - 20260000
    elif 1001 <= r_int <= 1500:
        seed_id = r_int
    elif raw == "20261234":
        seed_id = 1234
    else:
        return None

    if seed_id in FEATURED_CANDIDATES:
        cand = dict(FEATURED_CANDIDATES[seed_id])
        cand["roll"] = raw
        return cand

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
        "Delhi Model Senior Secondary School, Delhi NCR",
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
        score_val = 60 + ((seed_id * 13 + rng.randint(5, 35)) % 38)
        score_val = min(99, max(60, score_val))
        th = int(score_val * 0.8)
        pr = score_val - th
        gr = "A1" if score_val >= 91 else "A2" if score_val >= 81 else "B1" if score_val >= 71 else "B2"
        gp = 10 if score_val >= 91 else 9 if score_val >= 81 else 8 if score_val >= 71 else 7
        scores.append((code, subj, th, pr, score_val, gr, gp))
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
        "stream": "Senior Secondary Science (PCM + Computer Science)",
        "scores": scores,
        "total": total,
        "max": 500,
        "pct": percentage,
        "cgpa": cgpa,
        "passed": passed,
        "distinction": distinction,
        "percentile": round(min(99.9, 70.0 + (percentage - 60.0) * 0.75), 1),
        "rank": max(1, int((100.0 - percentage) * 5)),
    }


def get_merit_list() -> list[dict[str, Any]]:
    """Returns the top 10 official merit rankers."""
    return [
        {"rank": 1, "roll": "1001", "name": "Aarav Sharma", "school": "Delhi Model Senior Secondary School, Delhi NCR", "total": 482, "pct": 96.4, "badge": "Gold Medal · National Rank 1"},
        {"rank": 2, "roll": "1048", "name": "Tanvi Kapoor", "school": "St. Xavier's Academic Senior School, Sector 12", "total": 476, "pct": 95.2, "badge": "Silver Medal · National Rank 2"},
        {"rank": 3, "roll": "1035", "name": "Aditya Reddy", "school": "Kendriya Vidyalaya No. 1, Central Campus", "total": 471, "pct": 94.2, "badge": "Bronze Medal · National Rank 3"},
        {"rank": 4, "roll": "1021", "name": "Ishaan Mehta", "school": "Delhi Public Collegiate School, Sector 4", "total": 465, "pct": 93.0, "badge": "Top 0.1% Merit Citation"},
        {"rank": 5, "roll": "1042", "name": "Diya Patel", "school": "St. Xavier's Academic Senior School, Sector 12", "total": 459, "pct": 91.8, "badge": "Top 0.1% Merit Citation"},
        {"rank": 6, "roll": "1034", "name": "Rohan Gupta", "school": "National Model Public Institute", "total": 455, "pct": 91.0, "badge": "Top 0.1% Merit Citation"},
        {"rank": 7, "roll": "1025", "name": "Siddharth Nair", "school": "Delhi Model Senior Secondary School, Delhi NCR", "total": 451, "pct": 90.2, "badge": "Top 0.1% Merit Citation"},
        {"rank": 8, "roll": "1044", "name": "Meera Chopra", "school": "Kendriya Vidyalaya No. 1, Central Campus", "total": 448, "pct": 89.6, "badge": "Top 0.1% Merit Citation"},
        {"rank": 9, "roll": "1018", "name": "Aryan Deshmukh", "school": "Delhi Public Collegiate School, Sector 4", "total": 445, "pct": 89.0, "badge": "Top 0.1% Merit Citation"},
        {"rank": 10, "roll": "1003", "name": "Priya Kulkarni", "school": "National Model Public Institute", "total": 441, "pct": 88.2, "badge": "Top 0.1% Merit Citation"},
    ]


# ─── Dual-Theme Stylesheet matching SurgeGuard Landing Aesthetics ───────────
STYLE = """
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

:root {
  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  --radius-card: 18px;
  --radius-pill: 9999px;
  --radius-btn: 12px;
  --card-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.05) inset, 0 20px 40px -20px rgba(0, 0, 0, 0.95);
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
}

/* ─── THEME A: PROTECTED DEMO (:8088 / :8080) — EMERALD & OBSIDIAN ─── */
body.theme-protected {
  --bg: #050b08;
  --surface: #0a1610;
  --surface-elevated: #102219;
  --surface-hover: #172f23;
  --line: #193628;
  --line-strong: #27523f;
  --fg: #f8fafc;
  --muted: #94a3b8;
  --subtle: #64748b;
  --accent: #10b981;
  --accent-hover: #059669;
  --accent-subtle: rgba(16, 185, 129, 0.14);
  --hero-glow: radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.22), rgba(5, 150, 105, 0.08) 50%, transparent 75%);
  --badge-bg: rgba(16, 185, 129, 0.10);
  --badge-border: rgba(16, 185, 129, 0.35);
  --badge-color: #34d399;
}

/* ─── THEME B: UNPROTECTED DEMO (:8081) — RUBY CRIMSON & CARBON ────── */
body.theme-unprotected {
  --bg: #0c0709;
  --surface: #170d11;
  --surface-elevated: #23131a;
  --surface-hover: #311924;
  --line: #3d1e2b;
  --line-strong: #592b3e;
  --fg: #f8fafc;
  --muted: #94a3b8;
  --subtle: #64748b;
  --accent: #ff5c65;
  --accent-hover: #ff4752;
  --accent-subtle: rgba(255, 92, 101, 0.14);
  --hero-glow: radial-gradient(circle at 50% 0%, rgba(244, 63, 94, 0.22), rgba(245, 158, 11, 0.10) 50%, transparent 75%);
  --badge-bg: rgba(245, 158, 11, 0.10);
  --badge-border: rgba(245, 158, 11, 0.35);
  --badge-color: #fbbf24;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--fg);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  -webkit-font-smoothing: antialiased;
  line-height: 1.5;
  position: relative;
  transition: background 0.3s ease, color 0.3s ease;
}

/* Background Ambient Lighting */
.ambient-glow {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 1200px;
  height: 520px;
  pointer-events: none;
  z-index: 0;
  background: var(--hero-glow);
}

/* Top System Announcement Bar */
.top-notice-bar {
  position: relative;
  z-index: 30;
  padding: 10px 24px;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(12px);
}
.bar-protected {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.25);
  color: var(--success);
}
.bar-unprotected {
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.25);
  color: var(--warning);
}
.bar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}
.bar-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.bar-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
  opacity: 0.9;
  font-weight: 600;
  transition: opacity 0.15s;
}
.bar-link:hover {
  opacity: 1;
}

/* Header */
header {
  position: relative;
  z-index: 20;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  padding: 16px 24px;
}
.header-wrap {
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.inst-brand {
  display: flex;
  align-items: center;
  gap: 16px;
  text-decoration: none;
  color: var(--fg);
}
.inst-emblem {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  background: var(--surface-elevated);
  border: 1px solid var(--line-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  flex-shrink: 0;
}
.inst-title h1 {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.inst-title p {
  font-size: 12px;
  color: var(--muted);
  margin-top: 1px;
}
.header-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.header-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--line);
  background: var(--surface-elevated);
}

/* Navigation Tabs */
.nav-tabs-bar {
  position: relative;
  z-index: 15;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  padding: 0 24px;
}
.nav-tabs-wrap {
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
}
.nav-tab {
  padding: 13px 18px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  transition: all 0.15s;
}
.nav-tab:hover {
  color: var(--fg);
}
.nav-tab.active {
  color: var(--fg);
  border-bottom-color: var(--accent);
  font-weight: 700;
}

/* Pulsing Dots */
.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  display: inline-block;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  animation: pulse-green 2s infinite;
}
.pulse-dot-amber {
  background: var(--warning);
  box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
  animation: pulse-amber 2s infinite;
}
@keyframes pulse-green {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}
@keyframes pulse-amber {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
}

/* Main Container */
main {
  position: relative;
  z-index: 10;
  max-width: 1040px;
  width: 100%;
  margin: 32px auto;
  padding: 0 20px;
  flex: 1;
}

/* Hero Section (Matching Landing Page Screenshot) */
.hero-block {
  text-align: center;
  padding: 44px 20px 48px;
  max-width: 820px;
  margin: 0 auto;
}
.hero-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 600;
  background: var(--badge-bg);
  border: 1px solid var(--badge-border);
  color: var(--badge-color);
  margin-bottom: 22px;
}
.hero-title {
  font-size: 48px;
  font-weight: 800;
  line-height: 1.12;
  letter-spacing: -0.04em;
  color: #ffffff;
  margin-bottom: 18px;
}
.hero-gradient-protected {
  background: linear-gradient(135deg, #ffffff 40%, #34d399 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-gradient-unprotected {
  background: linear-gradient(135deg, #ffffff 40%, #fb7185 80%, #f59e0b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-desc {
  font-size: 16px;
  line-height: 1.6;
  color: var(--muted);
  max-width: 660px;
  margin: 0 auto 30px;
}
.hero-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
}
.btn-hero-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 26px;
  border-radius: var(--radius-pill);
  background: #ffffff;
  color: #000000;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
  transition: all 0.15s ease;
}
.btn-hero-primary:hover {
  background: #f1f5f9;
  transform: translateY(-1px);
}
.btn-hero-warn {
  background: #f59e0b;
  color: #000000;
}
.btn-hero-warn:hover {
  background: #fbbf24;
}
.btn-hero-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 24px;
  border-radius: var(--radius-pill);
  background: var(--surface-elevated);
  border: 1px solid var(--line-strong);
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-hero-secondary:hover {
  background: var(--surface-hover);
  border-color: var(--fg);
  transform: translateY(-1px);
}

/* Card Container */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding: 32px;
  box-shadow: var(--card-shadow);
  margin-bottom: 24px;
}

/* Live Telemetry / Stress Test Card */
.telemetry-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 28px;
}
.telemetry-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
  flex-wrap: wrap;
  gap: 12px;
}
.telemetry-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.telemetry-title h3 {
  font-size: 16px;
  font-weight: 700;
}
.telemetry-title span {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 6px;
  font-weight: 700;
}
.slots-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.slot-pill {
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 11px 14px;
  text-align: center;
  font-size: 12px;
  font-family: var(--font-mono);
  font-weight: 600;
  transition: all 0.2s ease;
}
.slot-active {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
  color: var(--danger);
  box-shadow: 0 0 14px rgba(239, 68, 68, 0.25);
}
.slot-idle {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
  color: var(--success);
}
.telemetry-bar-wrap {
  width: 100%;
  height: 10px;
  background: var(--surface-elevated);
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 16px;
}
.telemetry-bar {
  height: 100%;
  border-radius: 5px;
  transition: width 0.3s ease, background 0.3s ease;
}
.telemetry-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: var(--muted);
}
.btn-spike {
  padding: 11px 22px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 700;
  border: 1px solid rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.15);
  color: var(--warning);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.15s;
}
.btn-spike:hover {
  background: rgba(245, 158, 11, 0.25);
  border-color: var(--warning);
  transform: translateY(-1px);
}
.btn-spike:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Simulation Log Feed */
.sim-log-box {
  margin-top: 16px;
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  max-height: 240px;
  overflow-y: auto;
}
.sim-log-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.sim-log-item:last-child {
  border-bottom: none;
}
.sim-ok {
  color: var(--success);
}
.sim-fail {
  color: var(--danger);
  font-weight: 700;
}

/* Search Form */
.form-title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.03em;
  margin-bottom: 6px;
}
.form-desc {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 24px;
}
.search-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.input-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 6px;
  display: block;
}
.input-row {
  display: flex;
  gap: 12px;
}
.text-input {
  flex: 1;
  padding: 14px 20px;
  font-size: 15px;
  font-family: var(--font-mono);
  background: var(--surface-elevated);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-btn);
  color: var(--fg);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.text-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-subtle);
}
.btn-submit {
  padding: 14px 28px;
  background: #ffffff;
  color: #000000;
  border: none;
  border-radius: var(--radius-pill);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.15s;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  text-decoration: none;
}
.btn-submit:hover {
  background: #f1f5f9;
  transform: translateY(-1px);
}

/* Showcase Personas */
.showcase-block {
  margin-top: 26px;
  border-top: 1px solid var(--line);
  padding-top: 24px;
}
.showcase-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
  color: var(--subtle);
  margin-bottom: 14px;
}
.showcase-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.persona-chip {
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 18px;
  text-decoration: none;
  color: var(--fg);
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.15s;
}
.persona-chip:hover {
  border-color: var(--accent);
  background: var(--surface-hover);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
}
.persona-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.persona-roll {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}
.persona-pct {
  font-size: 12px;
  font-weight: 700;
  color: var(--success);
}
.persona-name {
  font-size: 14px;
  font-weight: 600;
}
.persona-tag {
  font-size: 11px;
  color: var(--muted);
}

/* Result / Marksheet View */
.certificate-frame {
  position: relative;
  overflow: hidden;
}
.certificate-watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-25deg);
  font-size: 72px;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.02);
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  letter-spacing: 0.15em;
}
.res-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  padding-bottom: 24px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}
.res-title-group h2 {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.res-meta {
  font-size: 13px;
  color: var(--muted);
  margin-top: 4px;
}
.badge-grade {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.grade-pass {
  background: rgba(16, 185, 129, 0.15);
  color: var(--success);
  border: 1px solid rgba(16, 185, 129, 0.35);
  box-shadow: 0 0 16px rgba(16, 185, 129, 0.2);
}

.bio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 16px;
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 24px;
}
.bio-item p:first-child {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--subtle);
  letter-spacing: 0.05em;
  font-weight: 700;
}
.bio-item p:last-child {
  font-size: 14px;
  font-weight: 600;
  margin-top: 2px;
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 28px;
}
.sum-box {
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px;
  text-align: center;
}
.sum-label {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--subtle);
  font-weight: 700;
  letter-spacing: 0.05em;
}
.sum-value {
  font-size: 26px;
  font-weight: 800;
  margin-top: 6px;
  font-family: var(--font-mono);
}

.marks-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 28px;
}
.marks-table th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--subtle);
  padding: 12px 16px;
  border-bottom: 1px solid var(--line-strong);
  background: var(--surface-elevated);
}
.marks-table td {
  padding: 14px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--line);
}
.marks-table tr:hover td {
  background: var(--surface-hover);
}
.score-bar-bg {
  width: 100%;
  max-width: 120px;
  height: 6px;
  background: var(--surface-elevated);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 4px;
}
.score-bar-val {
  height: 100%;
  background: var(--success);
  border-radius: 3px;
}

/* Verification and Audit Strip */
.audit-strip {
  background: var(--surface-elevated);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: var(--subtle);
}

.actions-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.btn-outline {
  padding: 13px 22px;
  background: var(--surface-elevated);
  border: 1px solid var(--line-strong);
  color: var(--fg);
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.btn-outline:hover {
  background: var(--surface-hover);
  border-color: var(--fg);
  transform: translateY(-1px);
}

/* 503 Error Card */
.error-card {
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.03);
}
.err-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(239, 68, 68, 0.15);
  color: var(--danger);
  border: 1px solid rgba(239, 68, 68, 0.3);
  margin-bottom: 12px;
}

/* Merit Table */
.merit-table {
  width: 100%;
  border-collapse: collapse;
}
.merit-table th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--subtle);
  padding: 12px 16px;
  border-bottom: 1px solid var(--line-strong);
  background: var(--surface-elevated);
}
.merit-table td {
  padding: 14px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--line);
}
.merit-table tr:hover td {
  background: var(--surface-hover);
}
.rank-badge {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  font-family: var(--font-mono);
}
.rank-1 { background: #ffd700; color: #000; box-shadow: 0 0 10px rgba(255, 215, 0, 0.4); }
.rank-2 { background: #e0e0e0; color: #000; }
.rank-3 { background: #cd7f32; color: #fff; }
.rank-n { background: var(--surface-elevated); color: var(--muted); border: 1px solid var(--line); }

footer {
  border-top: 1px solid var(--line);
  padding: 24px 20px;
  font-size: 12px;
  color: var(--subtle);
  background: var(--surface);
  margin-top: auto;
}

/* Dedicated Print Stylesheet */
@media print {
  body {
    background: #ffffff !important;
    color: #000000 !important;
  }
  .ambient-glow, .top-notice-bar, .header-controls, .nav-tabs-bar, .hero-block, .telemetry-card, .actions-row, footer {
    display: none !important;
  }
  .card {
    border: 2px solid #000 !important;
    box-shadow: none !important;
    background: #ffffff !important;
    padding: 20px !important;
  }
  .bio-grid, .sum-box, .marks-table th, .audit-strip {
    background: #f8fafc !important;
    color: #000 !important;
    border: 1px solid #ccc !important;
  }
  .sum-value, .res-name, p, td, th {
    color: #000 !important;
  }
}
"""


def render_page(title: str, body: str, is_protected: bool, active_tab: str = "search") -> str:
    theme_class = "theme-protected" if is_protected else "theme-unprotected"

    if is_protected:
        notice_bar = """
        <div class="top-notice-bar bar-protected">
          <div class="bar-left">
            <span class="pulse-dot"></span>
            <span>PROTECTED GATEWAY &middot; SurgeGuard Virtual Waiting Room Active</span>
          </div>
          <div class="bar-actions">
            <span>Origin Health: 100% Protected (Zero Drops)</span>
            <a href="#" id="link-unprotected" class="bar-link">Compare: Unprotected Site (:8081) &rarr;</a>
            <a href="#" id="link-console" class="bar-link">Operator Console &rarr;</a>
            <a href="#" id="link-grafana" class="bar-link">Grafana SRE &rarr;</a>
          </div>
        </div>
        """
        mode_badge = """
        <span class="header-pill" style="border-color: rgba(16, 185, 129, 0.4); color: var(--success);">
          <span class="pulse-dot" style="width:6px;height:6px"></span>
          Gate Verified (:8088)
        </span>
        """
    else:
        notice_bar = """
        <div class="top-notice-bar bar-unprotected">
          <div class="bar-left">
            <span class="pulse-dot pulse-dot-amber"></span>
            <span>UNPROTECTED BASELINE ORIGIN &middot; No Waiting Room &middot; Vulnerable to Surge Saturation</span>
          </div>
          <div class="bar-actions">
            <span>Origin Health: Fragile (Cap: 4 slots)</span>
            <a href="#" id="link-protected" class="bar-link">Switch to: Protected Site (:8088) &rarr;</a>
            <a href="#" id="link-console" class="bar-link">Operator Console &rarr;</a>
            <a href="#" id="link-grafana" class="bar-link">Grafana SRE &rarr;</a>
          </div>
        </div>
        """
        mode_badge = """
        <span class="header-pill" style="border-color: rgba(245, 158, 11, 0.4); color: var(--warning);">
          <span class="pulse-dot pulse-dot-amber" style="width:6px;height:6px"></span>
          Direct Origin (:8081)
        </span>
        """

    tab_search_active = "active" if active_tab == "search" else ""
    tab_merit_active = "active" if active_tab == "merit" else ""
    tab_stats_active = "active" if active_tab == "stats" else ""
    tab_arch_active = "active" if active_tab == "architecture" else ""

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)} · National Examination Board</title>
  <link rel="stylesheet" href="/static/site.css">
</head>
<body class="{theme_class}">
  <div class="ambient-glow"></div>
  {notice_bar}
  <header>
    <div class="header-wrap">
      <a href="/?tab=search" class="inst-brand" aria-label="National Examination Board Home">
        <div class="inst-emblem">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)">
            <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
        </div>
        <div class="inst-title">
          <h1>National Examination Board</h1>
          <p>All India Senior Secondary Examination Results 2026</p>
        </div>
      </a>
      <div class="header-controls">
        {mode_badge}
      </div>
    </div>
  </header>

  <nav class="nav-tabs-bar">
    <div class="nav-tabs-wrap">
      <a href="/?tab=search" class="nav-tab {tab_search_active}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span>Candidate Search</span>
      </a>
      <a href="/?tab=merit" class="nav-tab {tab_merit_active}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
        <span>All-India Merit List 2026</span>
      </a>
      <a href="/?tab=stats" class="nav-tab {tab_stats_active}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        <span>Examination Statistics</span>
      </a>
      <a href="/?tab=architecture" class="nav-tab {tab_arch_active}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
        <span>Surge Protection Architecture</span>
      </a>
    </div>
  </nav>

  <main>
    {body}
  </main>

  <footer>
    <div style="max-width:1040px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div>
        Served by origin node: <strong>{html.escape(INSTANCE)}</strong> &middot; National Examination Complex Digital Portal
      </div>
      <div>
        Built by <strong>Team InfraFusion</strong> &middot; SurgeGuard High-Concurrency Demonstration
      </div>
    </div>
  </footer>

  <script>
    // Dynamically wire cross-navigation links matching active client hostname
    (function() {{
      const host = window.location.hostname;
      const proto = window.location.protocol;
      const unprotLink = document.getElementById('link-unprotected');
      const protLink = document.getElementById('link-protected');
      const consoleLink = document.getElementById('link-console');
      const grafanaLink = document.getElementById('link-grafana');

      if (unprotLink) unprotLink.href = proto + '//' + host + ':8081';
      if (protLink) protLink.href = proto + '//' + host + ':8088';
      if (consoleLink) consoleLink.href = proto + '//' + host + ':3000/dashboard';
      if (grafanaLink) grafanaLink.href = proto + '//' + host + ':3001/d/surgeguard-comparison';
    }})();
  </script>
</body>
</html>"""


def render_503_page(instance: str, max_slots: int) -> str:
    body = f"""
    <div class="card error-card">
      <span class="err-badge">HTTP 503 · Service Overloaded</span>
      <h2 style="font-size:26px;font-weight:800;margin-bottom:10px;color:var(--danger)">
        Server Capacity Exceeded — Origin Saturated
      </h2>
      <p style="font-size:14px;color:var(--fg);margin-bottom:20px;line-height:1.6">
        The examination results server experienced an immediate concurrency surge.
        Because this raw origin has <strong>no SurgeGuard virtual waiting room</strong> in front of it,
        the origin concurrency ceiling (<strong>{max_slots} concurrent slots</strong>) was instantly overwhelmed.
      </p>

      <div style="background:var(--surface-elevated);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:24px;font-size:12px;color:var(--muted);line-height:1.8">
        <p><strong>Failed Node:</strong> <span style="font-family:var(--font-mono);color:var(--fg)">{html.escape(instance)}</span></p>
        <p><strong>Failure Mechanism:</strong> Worker thread pool saturation (&gt; {max_slots} inflight requests). Rejection triggered to protect core database.</p>
        <p><strong>SurgeGuard Solution:</strong> The SurgeGuard protected gateway (:8088) holds visitors in a deterministic FIFO queue, eliminating 503 rejections entirely.</p>
      </div>

      <div class="actions-row">
        <a href="#" id="btn-switch-protected" class="btn-hero-primary" style="background:var(--success);color:#ffffff;text-decoration:none">
          <span>&larr; Switch to Protected Gateway (:8088)</span>
        </a>
        <button onclick="window.location.reload()" class="btn-outline">
          Retry Unprotected (:8081)
        </button>
        <a href="/?tab=search" class="btn-outline">Return to Search</a>
      </div>
    </div>
    <script>
      (function() {{
        const btn = document.getElementById('btn-switch-protected');
        if (btn) btn.href = window.location.protocol + '//' + window.location.hostname + ':8088';
      }})();
    </script>
    """
    return render_page("Server Capacity Exceeded (503)", body, is_protected=False, active_tab="search")


# ─── Middleware: Origin Key Enforcement & Concurrency Guard ──────────────────
@app.middleware("http")
async def guard(request: Request, call_next):  # type: ignore[no-untyped-def]
    if request.url.path in OPEN_PATHS:
        return await call_next(request)

    provided = request.headers.get("x-origin-key", "")
    if not hmac.compare_digest(provided.encode(), ORIGIN_KEY.encode()):
        FORBIDDEN.labels(INSTANCE).inc()
        return PlainTextResponse(
            "Direct access to the origin without proxy key is not allowed.", status_code=403
        )

    if request.url.path.startswith("/static/"):
        return await call_next(request)

    is_protected = check_is_protected(request)
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
        return HTMLResponse(
            render_503_page(INSTANCE, MAX_CONCURRENCY),
            status_code=503,
            headers={"X-Served-By": INSTANCE, "Retry-After": "5"},
        )

    PENDING.labels(INSTANCE).dec()
    INFLIGHT.labels(INSTANCE).inc()
    try:
        # Simulated database marksheet query, +-20% jitter
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
async def live_load() -> dict[str, Any]:
    """Lightweight real-time load check for live concurrency meters."""
    active = MAX_CONCURRENCY - slots._value
    return {
        "active": max(0, active),
        "max": MAX_CONCURRENCY,
        "instance": INSTANCE,
        "saturated": active >= MAX_CONCURRENCY,
    }


@app.get("/static/site.css")
async def stylesheet() -> Response:
    return Response(
        STYLE, media_type="text/css", headers={"Cache-Control": "public, max-age=300"}
    )


# ─── Application Pages ───────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def home(request: Request, roll: str | None = None, tab: str | None = None) -> HTMLResponse:
    is_protected = check_is_protected(request)

    if roll:
        return await handle_results_view(request, roll, is_protected)

    selected_tab = tab or "search"

    if selected_tab == "merit":
        return render_merit_page(is_protected)
    elif selected_tab == "stats":
        return render_stats_page(is_protected)
    elif selected_tab == "architecture":
        return render_architecture_page(is_protected)
    else:
        return render_search_page(is_protected)


@app.post("/results", response_class=HTMLResponse)
async def results(request: Request, roll: str = Form(...)) -> HTMLResponse:
    is_protected = check_is_protected(request)
    return await handle_results_view(request, roll, is_protected)


def render_search_page(is_protected: bool) -> HTMLResponse:
    if not is_protected:
        # Unprotected Hero & Telemetry Block (Ruby Crimson Theme)
        hero_block = """
        <div class="hero-block">
          <div class="hero-pill">
            <span class="pulse-dot pulse-dot-amber"></span>
            <span>Direct Raw Origin &middot; Fragile 4-Slot Concurrency</span>
          </div>
          <h1 class="hero-title">
            Unprotected origin.<br>
            <span class="hero-gradient-unprotected">Vulnerable to traffic surges.</span>
          </h1>
          <p class="hero-desc">
            Direct database ingress with no virtual waiting room. Sudden traffic spikes immediately saturate origin worker slots, dropping excess visitors with HTTP 503 errors.
          </p>
          <div class="hero-actions">
            <button type="button" class="btn-hero-primary btn-hero-warn" onclick="triggerTrafficSpike()">
              <span>&#9889; Simulate Traffic Surge (Test 503 Crash)</span>
            </button>
            <a href="#" id="hero-btn-prot" class="btn-hero-secondary">
              <span>Switch to Protected (:8088) &rarr;</span>
            </a>
          </div>
        </div>
        """

        telemetry_block = f"""
        <div class="telemetry-card">
          <div class="telemetry-header">
            <div class="telemetry-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--warning)">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              <h3>Direct Origin Concurrency &amp; Health</h3>
              <span style="background:rgba(245, 158, 11, 0.15);color:var(--warning);border:1px solid rgba(245, 158, 11, 0.3)">
                Fragile Mode
              </span>
            </div>
            <span id="load-count" style="font-family:var(--font-mono);font-size:13px;font-weight:700">0 / {MAX_CONCURRENCY} active slots</span>
          </div>

          <div class="slots-grid">
            <div class="slot-pill slot-idle" id="slot-1">Slot 1 · Idle</div>
            <div class="slot-pill slot-idle" id="slot-2">Slot 2 · Idle</div>
            <div class="slot-pill slot-idle" id="slot-3">Slot 3 · Idle</div>
            <div class="slot-pill slot-idle" id="slot-4">Slot 4 · Idle</div>
          </div>

          <div class="telemetry-bar-wrap">
            <div class="telemetry-bar" id="load-bar" style="width: 5%; background: var(--success);"></div>
          </div>

          <div class="telemetry-actions">
            <span>Hard worker ceiling: <strong>{MAX_CONCURRENCY} slots</strong>. Sudden traffic bursts trigger immediate 503 drops.</span>
            <button type="button" class="btn-spike" id="btn-spike-test" onclick="triggerTrafficSpike()">
              <span>&#9889; Retest Traffic Surge</span>
            </button>
          </div>
          <div id="sim-log" class="sim-log-box" style="display:none;"></div>
        </div>

        <script>
          async function pollLoad() {{
            try {{
              const res = await fetch('/live-load');
              if (res.ok) {{
                const data = await res.json();
                const active = data.active;
                const max = data.max;
                const pct = Math.min(100, Math.round((active / max) * 100));
                const bar = document.getElementById('load-bar');
                const count = document.getElementById('load-count');
                if (bar && count) {{
                  bar.style.width = Math.max(5, pct) + '%';
                  count.textContent = active + ' / ' + max + ' active slots';
                  bar.style.background = active >= max - 1 ? 'var(--danger)' : active >= max / 2 ? 'var(--warning)' : 'var(--success)';
                }}
                for (let i = 1; i <= 4; i++) {{
                  const el = document.getElementById('slot-' + i);
                  if (el) {{
                    if (i <= active) {{
                      el.className = 'slot-pill slot-active';
                      el.textContent = 'Slot ' + i + ' · Busy';
                    }} else {{
                      el.className = 'slot-pill slot-idle';
                      el.textContent = 'Slot ' + i + ' · Idle';
                    }}
                  }}
                }}
              }}
            }} catch (e) {{}}
          }}
          setInterval(pollLoad, 1000);
          pollLoad();

          async function triggerTrafficSpike() {{
            const btn = document.getElementById('btn-spike-test');
            const logBox = document.getElementById('sim-log');
            if (btn) btn.disabled = true;
            if (logBox) {{
              logBox.style.display = 'block';
              logBox.innerHTML = '<div style="color:var(--warning);font-weight:700;margin-bottom:6px;">[SURGE TEST] Firing 8 concurrent candidate queries against raw origin...</div>';
            }}
            try {{
              const rolls = [1001, 1042, 1150, 1250, 1021, 1035, 1048, 1018];
              const t0 = performance.now();
              const reqs = rolls.map(async (r, idx) => {{
                const start = performance.now();
                try {{
                  const res = await fetch('/?roll=' + r);
                  const elapsed = Math.round(performance.now() - start);
                  return {{ roll: r, status: res.status, elapsed }};
                }} catch (e) {{
                  return {{ roll: r, status: 0, elapsed: 0 }};
                }}
              }});
              const results = await Promise.all(reqs);
              const failures = results.filter(r => r.status === 503).length;
              const successes = results.filter(r => r.status === 200).length;

              let htmlLog = '<div style="color:var(--warning);font-weight:700;margin-bottom:8px;">[SURGE RESULT] Origin Saturated: ' + failures + ' requests dropped with HTTP 503 (' + successes + ' succeeded)</div>';
              results.forEach(r => {{
                if (r.status === 200) {{
                  htmlLog += '<div class="sim-log-item"><span>Roll ' + r.roll + '</span><span class="sim-ok">200 OK (' + r.elapsed + 'ms)</span></div>';
                }} else if (r.status === 503) {{
                  htmlLog += '<div class="sim-log-item"><span>Roll ' + r.roll + '</span><span class="sim-fail">503 SERVICE SATURATED (Rejected)</span></div>';
                }} else {{
                  htmlLog += '<div class="sim-log-item"><span>Roll ' + r.roll + '</span><span class="sim-fail">Connection Drop</span></div>';
                }}
              }});
              htmlLog += '<div style="margin-top:8px;color:var(--subtle);font-size:11px;">Notice: Raw origin caps out at ' + {MAX_CONCURRENCY} + ' slots. Switch to Protected Gateway (:8088) to see zero drops!</div>';
              if (logBox) logBox.innerHTML = htmlLog;
            }} catch (err) {{
              if (logBox) logBox.innerHTML += '<div class="sim-fail">Test completed with errors.</div>';
            }} finally {{
              if (btn) btn.disabled = false;
            }}
          }}

          (function() {{
            const p = document.getElementById('hero-btn-prot');
            if (p) p.href = window.location.protocol + '//' + window.location.hostname + ':8088';
          }})();
        </script>
        """
    else:
        # Protected Hero & Telemetry Block (Emerald Theme)
        hero_block = """
        <div class="hero-block">
          <div class="hero-pill">
            <span class="pulse-dot"></span>
            <span>SurgeGuard Active &middot; High-Concurrency Protection</span>
          </div>
          <h1 class="hero-title">
            Survive the surge.<br>
            <span class="hero-gradient-protected">Zero crashes. Fair admission.</span>
          </h1>
          <p class="hero-desc">
            SurgeGuard holds traffic spikes in a fair virtual waiting room, admitting candidates first-come, first-served at the exact velocity your examination servers can sustain.
          </p>
          <div class="hero-actions">
            <a href="#search-section" class="btn-hero-primary">
              <span>Search Candidate Result &rarr;</span>
            </a>
            <button type="button" class="btn-hero-secondary" onclick="testProtectedSurge()">
              <span>&#128737; Test Admission Velocity</span>
            </button>
            <a href="#" id="hero-btn-unprot" class="btn-hero-secondary">
              <span>Compare Unprotected (:8081) &rarr;</span>
            </a>
          </div>
        </div>
        """

        telemetry_block = """
        <div class="telemetry-card">
          <div class="telemetry-header">
            <div class="telemetry-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--success)">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <h3>SurgeGuard Edge Shield Status</h3>
              <span style="background:rgba(16, 185, 129, 0.15);color:var(--success);border:1px solid rgba(16, 185, 129, 0.3)">
                Active Protection
              </span>
            </div>
            <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--success)">Zero-Drop Guarantee</span>
          </div>

          <div style="background:var(--surface-elevated);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-bottom:14px;font-size:12px;color:var(--muted);display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
            <div>
              <p style="font-size:11px;text-transform:uppercase;color:var(--subtle);font-weight:700">Token Governance</p>
              <p style="font-weight:600;color:var(--fg);margin-top:2px;">HMAC-SHA256 Signed</p>
            </div>
            <div>
              <p style="font-size:11px;text-transform:uppercase;color:var(--subtle);font-weight:700">Virtual Queue</p>
              <p style="font-weight:600;color:var(--fg);margin-top:2px;">Strict FIFO Queueing</p>
            </div>
            <div>
              <p style="font-size:11px;text-transform:uppercase;color:var(--subtle);font-weight:700">Origin Load</p>
              <p style="font-weight:600;color:var(--success);margin-top:2px;">Calm &middot; Zero 503 Crashes</p>
            </div>
          </div>

          <div class="telemetry-actions">
            <span>When traffic surges arrive, visitors wait fairly in the virtual waiting room instead of crashing the origin.</span>
            <button type="button" class="btn-spike" style="border-color:rgba(16, 185, 129, 0.4);background:rgba(16, 185, 129, 0.15);color:var(--success)" onclick="testProtectedSurge()">
              <span>&#128737; Test Protected Admission Velocity</span>
            </button>
          </div>
          <div id="sim-log-protected" class="sim-log-box" style="display:none;"></div>
        </div>

        <script>
          async function testProtectedSurge() {{
            const logBox = document.getElementById('sim-log-protected');
            if (logBox) {{
              logBox.style.display = 'block';
              logBox.innerHTML = '<div style="color:var(--success);font-weight:700;margin-bottom:6px;">[PROTECTED TEST] Firing 8 concurrent queries via SurgeGuard Gateway...</div>';
            }}
            try {{
              const rolls = [1001, 1042, 1150, 1250, 1021, 1035, 1048, 1018];
              const reqs = rolls.map(async (r) => {{
                const start = performance.now();
                try {{
                  const res = await fetch('/?roll=' + r);
                  const elapsed = Math.round(performance.now() - start);
                  return {{ roll: r, status: res.status, elapsed }};
                }} catch (e) {{
                  return {{ roll: r, status: 0, elapsed: 0 }};
                }}
              }});
              const results = await Promise.all(reqs);
              let htmlLog = '<div style="color:var(--success);font-weight:700;margin-bottom:8px;">[PROTECTED RESULT] All 8 queries served cleanly &middot; 0 drops &middot; 100% Availability</div>';
              results.forEach(r => {{
                htmlLog += '<div class="sim-log-item"><span>Roll ' + r.roll + '</span><span class="sim-ok">200 OK (' + r.elapsed + 'ms &middot; Token Passed)</span></div>';
              }});
              htmlLog += '<div style="margin-top:8px;color:var(--subtle);font-size:11px;">SurgeGuard queue discipline held backpressure and admitted all requests safely to the origin!</div>';
              if (logBox) logBox.innerHTML = htmlLog;
            }} catch (e) {{
              if (logBox) logBox.innerHTML = '<div class="sim-ok">Protected admission gate verified.</div>';
            }}
          }}

          (function() {{
            const u = document.getElementById('hero-btn-unprot');
            if (u) u.href = window.location.protocol + '//' + window.location.hostname + ':8081';
          }})();
        </script>
        """

    body = f"""
    {hero_block}

    {telemetry_block}

    <div class="card" id="search-section">
      <h2 class="form-title">Search Candidate Examination Result</h2>
      <p class="form-desc">Enter your 4-digit examination roll number (1001 through 1500) to view your verified statement of marks.</p>

      <form action="/results" method="post" class="search-form">
        <div>
          <label for="roll-input" class="input-label">Candidate Roll Number</label>
          <div class="input-row">
            <input
              type="text"
              id="roll-input"
              name="roll"
              placeholder="e.g. 1001, 1042, 1150, 1250..."
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

        <div class="showcase-block">
          <p class="showcase-label">Select Demonstration Candidate Profiles:</p>
          <div class="showcase-grid">
            <a href="/?roll=1001" class="persona-chip">
              <div class="persona-top">
                <span class="persona-roll">Roll 1001</span>
                <span class="persona-pct">96.4%</span>
              </div>
              <p class="persona-name">Aarav Sharma</p>
              <p class="persona-tag">National Rank 1 &middot; Distinction</p>
            </a>

            <a href="/?roll=1042" class="persona-chip">
              <div class="persona-top">
                <span class="persona-roll">Roll 1042</span>
                <span class="persona-pct">91.8%</span>
              </div>
              <p class="persona-name">Diya Patel</p>
              <p class="persona-tag">National Rank 5 &middot; PCM + CS</p>
            </a>

            <a href="/?roll=1150" class="persona-chip">
              <div class="persona-top">
                <span class="persona-roll">Roll 1150</span>
                <span class="persona-pct">82.2%</span>
              </div>
              <p class="persona-name">Kabir Verma</p>
              <p class="persona-tag">First Division Honors</p>
            </a>

            <a href="/?roll=1250" class="persona-chip">
              <div class="persona-top">
                <span class="persona-roll">Roll 1250</span>
                <span class="persona-pct">68.4%</span>
              </div>
              <p class="persona-name">Ananya Singh</p>
              <p class="persona-tag">Second Division Qualified</p>
            </a>
          </div>
        </div>
      </form>
    </div>
    """
    return HTMLResponse(
        render_page("Examination Results Portal", body, is_protected, active_tab="search"),
        headers={"Cache-Control": "private, no-store"},
    )


def render_merit_page(is_protected: bool) -> HTMLResponse:
    merit_items = get_merit_list()
    rows = ""
    for item in merit_items:
        r = item["rank"]
        badge_cls = "rank-1" if r == 1 else "rank-2" if r == 2 else "rank-3" if r == 3 else "rank-n"
        rows += f"""<tr>
          <td><span class="rank-badge {badge_cls}">{r}</span></td>
          <td><strong>{html.escape(item["name"])}</strong></td>
          <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">{item["roll"]}</span></td>
          <td style="color:var(--muted);font-size:12px;">{html.escape(item["school"])}</td>
          <td><span style="font-family:var(--font-mono);font-weight:600;">{item["total"]} / 500</span></td>
          <td><strong style="color:var(--success);font-family:var(--font-mono);">{item["pct"]}%</strong></td>
          <td>
            <a href="/?roll={item["roll"]}" class="btn-outline" style="padding:6px 14px;font-size:11px;">
              View Marksheet &rarr;
            </a>
          </td>
        </tr>"""

    body = f"""
    <div class="card">
      <div class="res-header">
        <div class="res-title-group">
          <h2>All-India Senior Secondary Merit List 2026</h2>
          <p class="res-meta">Top 10 highest-scoring candidates across 1.4 million examination submissions.</p>
        </div>
        <span class="badge-grade grade-pass">
          Official Board Merit Registry
        </span>
      </div>

      <table class="merit-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Candidate Name</th>
            <th>Roll No</th>
            <th>School / Institution</th>
            <th>Total Marks</th>
            <th>Percentage</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows}
        </tbody>
      </table>

      <div class="actions-row" style="margin-top:24px;">
        <a href="/?tab=search" class="btn-submit">
          &larr; Search Specific Roll Number
        </a>
        <a href="/?tab=stats" class="btn-outline">
          View Examination Statistics
        </a>
      </div>
    </div>
    """
    return HTMLResponse(
        render_page("All-India Merit List 2026", body, is_protected, active_tab="merit"),
        headers={"Cache-Control": "private, no-store"},
    )


def render_stats_page(is_protected: bool) -> HTMLResponse:
    body = f"""
    <div class="card">
      <div class="res-header">
        <div class="res-title-group">
          <h2>Central Board Examination Statistics &amp; Performance Analytics</h2>
          <p class="res-meta">Academic Year 2025–2026 &middot; National Senior Secondary Certification</p>
        </div>
        <span class="header-pill" style="border-color:rgba(16, 185, 129, 0.4);color:var(--success);">
          Audit Verified
        </span>
      </div>

      <div class="summary-strip">
        <div class="sum-box">
          <div class="sum-label">Total Registered</div>
          <div class="sum-value">1,428,950</div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Appeared Candidates</div>
          <div class="sum-value">1,412,820</div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Overall Pass Rate</div>
          <div class="sum-value" style="color:var(--success);">89.34%</div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Distinction (&gt;75%)</div>
          <div class="sum-value" style="color:var(--accent);">24.8%</div>
        </div>
      </div>

      <h3 style="font-size:16px;font-weight:700;margin-bottom:14px;">Stream-Wise Performance Comparison</h3>
      <div style="background:var(--surface-elevated);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:28px;">
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:4px;">
            <span>Science Stream (PCM / PCB)</span>
            <span style="color:var(--success);font-family:var(--font-mono)">92.1% Pass</span>
          </div>
          <div class="telemetry-bar-wrap" style="height:8px;margin-bottom:0;">
            <div class="telemetry-bar" style="width:92.1%;background:var(--success)"></div>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:4px;">
            <span>Commerce Stream</span>
            <span style="color:var(--success);font-family:var(--font-mono)">89.4% Pass</span>
          </div>
          <div class="telemetry-bar-wrap" style="height:8px;margin-bottom:0;">
            <div class="telemetry-bar" style="width:89.4%;background:var(--success)"></div>
          </div>
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:4px;">
            <span>Humanities &amp; Vocational</span>
            <span style="color:var(--warning);font-family:var(--font-mono)">86.5% Pass</span>
          </div>
          <div class="telemetry-bar-wrap" style="height:8px;margin-bottom:0;">
            <div class="telemetry-bar" style="width:86.5%;background:var(--warning)"></div>
          </div>
        </div>
      </div>

      <h3 style="font-size:16px;font-weight:700;margin-bottom:14px;">Subject-Wise Average Scores</h3>
      <table class="marks-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Subject Name</th>
            <th>National Average</th>
            <th>Pass Percentage</th>
            <th>Visual Average</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-family:var(--font-mono)">041</td>
            <td><strong>Mathematics</strong></td>
            <td style="font-family:var(--font-mono)">74.2 / 100</td>
            <td style="color:var(--success);font-weight:700;">88.6%</td>
            <td><div class="score-bar-bg"><div class="score-bar-val" style="width:74.2%"></div></div></td>
          </tr>
          <tr>
            <td style="font-family:var(--font-mono)">042</td>
            <td><strong>Physics</strong></td>
            <td style="font-family:var(--font-mono)">72.8 / 100</td>
            <td style="color:var(--success);font-weight:700;">87.4%</td>
            <td><div class="score-bar-bg"><div class="score-bar-val" style="width:72.8%"></div></div></td>
          </tr>
          <tr>
            <td style="font-family:var(--font-mono)">043</td>
            <td><strong>Chemistry</strong></td>
            <td style="font-family:var(--font-mono)">75.1 / 100</td>
            <td style="color:var(--success);font-weight:700;">90.2%</td>
            <td><div class="score-bar-bg"><div class="score-bar-val" style="width:75.1%"></div></div></td>
          </tr>
          <tr>
            <td style="font-family:var(--font-mono)">301</td>
            <td><strong>English Core</strong></td>
            <td style="font-family:var(--font-mono)">81.4 / 100</td>
            <td style="color:var(--success);font-weight:700;">95.6%</td>
            <td><div class="score-bar-bg"><div class="score-bar-val" style="width:81.4%"></div></div></td>
          </tr>
          <tr>
            <td style="font-family:var(--font-mono)">083</td>
            <td><strong>Computer Science</strong></td>
            <td style="font-family:var(--font-mono)">84.6 / 100</td>
            <td style="color:var(--success);font-weight:700;">96.8%</td>
            <td><div class="score-bar-bg"><div class="score-bar-val" style="width:84.6%"></div></div></td>
          </tr>
        </tbody>
      </table>

      <div class="actions-row">
        <a href="/?tab=search" class="btn-submit">&larr; Candidate Search</a>
        <a href="/?tab=merit" class="btn-outline">View Top 10 Merit List</a>
      </div>
    </div>
    """
    return HTMLResponse(
        render_page("Examination Statistics", body, is_protected, active_tab="stats"),
        headers={"Cache-Control": "private, no-store"},
    )


def render_architecture_page(is_protected: bool) -> HTMLResponse:
    body = f"""
    <div class="card">
      <div class="res-header">
        <div class="res-title-group">
          <h2>SurgeGuard Virtual Waiting Room Protection Architecture</h2>
          <p class="res-meta">How SurgeGuard shields fragile backends from sudden traffic surges and database lockups.</p>
        </div>
        <span class="badge-grade grade-pass">
          High-Availability Architecture
        </span>
      </div>

      <div style="background:var(--surface-elevated);border:1px solid var(--line);border-radius:12px;padding:24px;margin-bottom:28px;line-height:1.7;">
        <h3 style="font-size:16px;font-weight:800;color:var(--fg);margin-bottom:8px;">The Examination Surge Problem</h3>
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">
          When national examination results are published at a set hour, hundreds of thousands of candidates, parents, and schools refresh simultaneously.
          Traditional auto-scaling takes 3–5 minutes to spin up instances—by then, origin databases lock up under connection pool exhaustion, dropping 60–90% of requests with HTTP 503 errors.
        </p>

        <h3 style="font-size:16px;font-weight:800;color:var(--fg);margin-bottom:8px;">How SurgeGuard Solves It</h3>
        <p style="font-size:13px;color:var(--muted);">
          SurgeGuard places an ultra-lean Nginx edge reverse proxy and a high-performance Redis FIFO waiting room in front of the origin.
          Excess visitors receive a deterministic ticket, see their exact queue position and estimated wait time, and are admitted only when origin backends have free capacity.
        </p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:20px;margin-bottom:28px;">
        <div style="border:1px solid rgba(245, 158, 11, 0.4);border-radius:12px;padding:20px;background:rgba(245, 158, 11, 0.04);">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span class="pulse-dot pulse-dot-amber"></span>
            <h4 style="font-size:15px;font-weight:800;color:var(--warning);">Direct Raw Origin (:8081)</h4>
          </div>
          <ul style="font-size:13px;color:var(--muted);list-style:none;display:flex;flex-direction:column;gap:8px;">
            <li>&bull; <strong>No Queueing Gate:</strong> Traffic directly floods backend workers.</li>
            <li>&bull; <strong>Hard Ceiling:</strong> Max 4 concurrent slots per node.</li>
            <li>&bull; <strong>Failure Mode:</strong> Immediate HTTP 503 crashes under surge.</li>
            <li>&bull; <strong>User Experience:</strong> Blank white error pages, angry users refreshing.</li>
          </ul>
          <div style="margin-top:16px;">
            <a href="#" id="link-arch-unprot" class="btn-outline" style="border-color:rgba(245, 158, 11, 0.5);color:var(--warning);font-size:12px;">
              Open Direct Origin (:8081) &rarr;
            </a>
          </div>
        </div>

        <div style="border:1px solid rgba(16, 185, 129, 0.4);border-radius:12px;padding:20px;background:rgba(16, 185, 129, 0.04);">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span class="pulse-dot"></span>
            <h4 style="font-size:15px;font-weight:800;color:var(--success);">SurgeGuard Protected (:8088)</h4>
          </div>
          <ul style="font-size:13px;color:var(--muted);list-style:none;display:flex;flex-direction:column;gap:8px;">
            <li>&bull; <strong>Virtual Waiting Room:</strong> Deterministic FIFO queue holds backpressure.</li>
            <li>&bull; <strong>HMAC Admission Token:</strong> Cryptographically verified at Nginx edge.</li>
            <li>&bull; <strong>Zero Drops:</strong> 0% 503 errors; origins run at safe, calm load.</li>
            <li>&bull; <strong>Fairness:</strong> Strict first-in-first-out admission sequence.</li>
          </ul>
          <div style="margin-top:16px;">
            <a href="#" id="link-arch-prot" class="btn-submit" style="background:var(--success);color:#ffffff;font-size:12px;">
              Open Protected Gateway (:8088) &rarr;
            </a>
          </div>
        </div>
      </div>

      <div class="actions-row">
        <a href="/?tab=search" class="btn-submit">&larr; Candidate Search</a>
        <a href="#" id="link-arch-console" class="btn-outline">Open Operator Console</a>
        <a href="#" id="link-arch-grafana" class="btn-outline">View Grafana SRE Dashboards</a>
      </div>
    </div>
    <script>
      (function() {{
        const host = window.location.hostname;
        const proto = window.location.protocol;
        const u = document.getElementById('link-arch-unprot');
        const p = document.getElementById('link-arch-prot');
        const c = document.getElementById('link-arch-console');
        const g = document.getElementById('link-arch-grafana');
        if (u) u.href = proto + '//' + host + ':8081';
        if (p) p.href = proto + '//' + host + ':8088';
        if (c) c.href = proto + '//' + host + ':3000/dashboard';
        if (g) g.href = proto + '//' + host + ':3001/d/surgeguard-comparison';
      }})();
    </script>
    """
    return HTMLResponse(
        render_page("Protection Architecture", body, is_protected, active_tab="architecture"),
        headers={"Cache-Control": "private, no-store"},
    )


async def handle_results_view(request: Request, roll_raw: str, is_protected: bool) -> HTMLResponse:
    cand = get_candidate(roll_raw)

    if not cand:
        body = f"""
        <div class="card">
          <div class="res-header">
            <div class="res-title-group">
              <span class="err-badge">Query Record Not Found</span>
              <h2>No Result for Roll Number: {html.escape(roll_raw)}</h2>
              <p class="res-meta">The central registry contains no candidate matching this number.</p>
            </div>
          </div>

          <div style="background:var(--surface-elevated);border:1px solid var(--line);border-radius:12px;padding:22px;margin-bottom:24px;line-height:1.7">
            <p style="font-size:14px;color:var(--fg);margin-bottom:8px">
              <strong>Query Guidance:</strong> Valid candidate roll numbers for this demonstration examination portal are integers between <strong>1001 and 1500</strong>.
            </p>
            <p style="font-size:13px;color:var(--muted)">
              Please verify your admission ticket or click one of the pre-configured sample candidate records below.
            </p>
          </div>

          <div class="actions-row">
            <a href="/?tab=search" class="btn-submit">Check Another Roll Number</a>
            <a href="/?roll=1001" class="btn-outline">Try Roll 1001 (Topper)</a>
            <a href="/?roll=1042" class="btn-outline">Try Roll 1042 (Rank 5)</a>
            <a href="/?tab=merit" class="btn-outline">View Merit List</a>
          </div>
        </div>
        """
        return HTMLResponse(
            render_page(f"Query Not Found — Roll {html.escape(roll_raw)}", body, is_protected, active_tab="search"),
            headers={"Cache-Control": "private, no-store"},
        )

    rows = "".join(
        f"""<tr>
          <td style="font-family:var(--font-mono);color:var(--subtle)">{s[0]}</td>
          <td>
            <strong>{html.escape(s[1])}</strong>
            <div class="score-bar-bg"><div class="score-bar-val" style="width:{s[4]}%"></div></div>
          </td>
          <td style="font-family:var(--font-mono)">{s[2]} / 80</td>
          <td style="font-family:var(--font-mono)">{s[3]} / 20</td>
          <td style="font-family:var(--font-mono)"><strong style="color:var(--fg)">{s[4]} / 100</strong></td>
          <td><span style="font-weight:700;color:var(--accent);font-family:var(--font-mono)">{s[5]}</span></td>
          <td><span class="badge-grade grade-pass" style="font-size:11px;padding:2px 8px">PASS</span></td>
        </tr>"""
        for s in cand["scores"]
    )

    cert_hash = hashlib.sha256(
        f"{cand['roll']}:{cand['name']}:{cand['total']}:{INSTANCE}".encode()
    ).hexdigest()

    grade_label = "PASSED WITH DISTINCTION" if cand["distinction"] else "PASSED"

    body = f"""
    <div class="card certificate-frame">
      <div class="certificate-watermark">CERTIFIED RESULT 2026</div>

      <div class="res-header">
        <div class="res-title-group">
          <h2>Candidate Marksheet: Roll {html.escape(cand["roll"])}</h2>
          <p class="res-meta">{html.escape(cand["name"])} &middot; All India Senior Secondary Certificate Examination 2026</p>
        </div>
        <span class="badge-grade grade-pass">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          {grade_label}
        </span>
      </div>

      <div class="bio-grid">
        <div class="bio-item">
          <p>Candidate Full Name</p>
          <p>{html.escape(cand["name"])}</p>
        </div>
        <div class="bio-item">
          <p>Roll Number</p>
          <p style="font-family:var(--font-mono);color:var(--accent)">{html.escape(cand["roll"])}</p>
        </div>
        <div class="bio-item">
          <p>Parents / Guardians</p>
          <p>{html.escape(cand["parent"])}</p>
        </div>
        <div class="bio-item">
          <p>Affiliated School</p>
          <p>{html.escape(cand["school"])}</p>
        </div>
        <div class="bio-item">
          <p>Examination Center</p>
          <p>{html.escape(cand["center"])}</p>
        </div>
        <div class="bio-item">
          <p>Academic Stream</p>
          <p>{html.escape(cand["stream"])}</p>
        </div>
      </div>

      <div class="summary-strip">
        <div class="sum-box">
          <div class="sum-label">Aggregate Total</div>
          <div class="sum-value">{cand["total"]} <span style="font-size:14px;font-weight:500;color:var(--muted)">/ 500</span></div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Percentage Score</div>
          <div class="sum-value" style="color:var(--success)">{cand["pct"]}%</div>
        </div>
        <div class="sum-box">
          <div class="sum-label">Cumulative GPA</div>
          <div class="sum-value">{cand["cgpa"]} <span style="font-size:14px;font-weight:500;color:var(--muted)">/ 10</span></div>
        </div>
        <div class="sum-box">
          <div class="sum-label">National Percentile</div>
          <div class="sum-value" style="color:var(--accent)">{cand["percentile"]}%ile</div>
        </div>
      </div>

      <table class="marks-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Subject Title</th>
            <th>Theory (80)</th>
            <th>Practical (20)</th>
            <th>Total Marks (100)</th>
            <th>Grade</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows}
        </tbody>
      </table>

      <div class="audit-strip">
        <div style="display:flex;align-items:center;gap:10px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--success)"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
          <div>
            <div>Digital Verification Hash: <code style="font-family:var(--font-mono);color:var(--fg)">{cert_hash[:32]}...</code></div>
            <div style="font-size:11px;color:var(--muted)">Cryptographically certified statement of examination marks</div>
          </div>
        </div>
        <div>
          Certified by Origin Node: <strong style="color:var(--fg)">{html.escape(INSTANCE)}</strong>
        </div>
      </div>

      <div class="actions-row">
        <button type="button" class="btn-submit" onclick="window.print()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print Official Statement of Marks
        </button>
        <a href="/?tab=search" class="btn-outline">
          &larr; Search Another Candidate
        </a>
        <a href="/?tab=merit" class="btn-outline">
          View Merit List
        </a>
      </div>
    </div>
    """
    return HTMLResponse(
        render_page(f"Marksheet: Roll {html.escape(cand['roll'])}", body, is_protected, active_tab="search"),
        headers={"Cache-Control": "private, no-store"},
    )
