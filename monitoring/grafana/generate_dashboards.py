"""Generate the provisioned Grafana dashboards for SurgeGuard.

    python monitoring/grafana/generate_dashboards.py
    # or:
    make dashboards

Design principles applied:
───────────────────────────────────────────
• Clear story, one question per dashboard:
  1. Overview: Health at a glance (6 big stat tiles + 4 core time series + scrape grid)
  2. Queue & Admission: Queue mechanics, wait time percentiles, token security
  3. Backends & Traffic: Per-origin load, connection states, latency, 5xx, bypass
  4. Reliability & Recovery: Fail-closed auth, auto-pause, worker leadership, alerts
  5. Infrastructure: Redis memory/latency, worker loop staleness, CPU/RSS
  6. Protected vs Unprotected: Side-by-side error rate, latency, and throughput for demos
• Consistent palette: BLUE=traffic/edge, GREEN=healthy/admitted, AMBER=queue/warning,
  RED=errors only, PURPLE=tail latency, SLATE=policy lines (dashed).
• Panel quality: Plain titles, 1-line description tooltips, correct units (reqps, ms, %, s),
  safe idle expressions with `or vector(0)` / `noValue="No traffic yet"`.
• Dashboard defaults: time=15m, refresh=5s, shared crosshairs, event annotations.
• Max ~12 panels per dashboard with clean row headers.
• Preserved UIDs so all existing operator console links remain valid.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).parent / "dashboards"
DS = {"type": "prometheus", "uid": "prometheus"}

# ─── Palette (consistent meaning across all dashboards) ──────────────────────
BLUE   = "#3b82f6"   # traffic / edge
GREEN  = "#10b981"   # admitted / healthy
AMBER  = "#f59e0b"   # queue / warnings
RED    = "#ef4444"   # errors only
PURPLE = "#8b5cf6"   # latency / worker
GREY   = "#94a3b8"   # neutral / secondary
SLATE  = "#64748b"   # policy targets / dashed lines

# ─── Shared PromQL fragments ────────────────────────────────────────────────
ERR_RATIO = (
    'sum(rate(demo_requests_total{status=~"5.."}[$rate_interval]))'
    " / clamp_min(sum(rate(demo_requests_total[$rate_interval])), 0.001)"
    " or vector(0)"
)
P50 = "histogram_quantile(0.50, sum by (le) (rate(demo_request_duration_seconds_bucket[$rate_interval])))"
P95 = "histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket[$rate_interval])))"
P99 = "histogram_quantile(0.99, sum by (le) (rate(demo_request_duration_seconds_bucket[$rate_interval])))"

WAIT_P50 = "histogram_quantile(0.50, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))"
WAIT_P95 = "histogram_quantile(0.95, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))"

ADMISSION_RATE = "sum(rate(surgeguard_admissions_total[$rate_interval])) or vector(0)"
EDGE_RPS       = "sum(rate(nginx_http_requests_total[$rate_interval])) or vector(0)"
ORIGIN_RPS     = "sum(rate(demo_requests_total[$rate_interval])) or vector(0)"

# ─── Navigation Header Bar ─────────────────────────────────────────────────
LINK_BAR = (
    "| [1. Overview](/grafana/d/surgeguard-overview?{__url_time_range}) "
    "| [2. Queue & Admission](/grafana/d/surgeguard-queue?{__url_time_range}) "
    "| [3. Backends & Traffic](/grafana/d/surgeguard-backends?{__url_time_range}) "
    "| [4. Reliability & Recovery](/grafana/d/surgeguard-failure?{__url_time_range}) "
    "| [5. Infrastructure](/grafana/d/surgeguard-resources?{__url_time_range}) "
    "| [6. Protected vs Unprotected](/grafana/d/surgeguard-comparison?{__url_time_range}) |"
)


# ─── Panel Builders ────────────────────────────────────────────────────────

def header(subtitle: str, w: int = 24, h: int = 2) -> dict:
    """Transparent text panel with subtitle + link bar."""
    content = f"## {subtitle}\n\n{LINK_BAR}"
    return {
        "type": "text",
        "title": "",
        "transparent": True,
        "options": {"content": content, "mode": "markdown"},
        "_w": w,
        "_h": h,
    }


def stat(
    title: str,
    expr: str,
    unit: str = "short",
    decimals: int | None = None,
    thresholds: list | None = None,
    no_value: str = "—",
    description: str = "",
    color_mode: str = "background",
    w: int = 4,
    h: int = 4,
) -> dict:
    """Stat panel with colored background, sparkline area, and lastNotNull value."""
    steps = thresholds or [{"color": GREEN, "value": None}]
    return {
        "type": "stat",
        "title": title,
        "description": description,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
        "options": {
            "colorMode": color_mode,
            "graphMode": "area",
            "textMode": "auto",
            "orientation": "auto",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": decimals,
                "noValue": no_value,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": steps},
                "mappings": [],
            },
            "overrides": [],
        },
        "_w": w,
        "_h": h,
    }


def stat_mapped(
    title: str,
    expr: str,
    mappings: list,
    unit: str = "short",
    description: str = "",
    w: int = 4,
    h: int = 4,
) -> dict:
    """Stat panel with explicit value-to-text mappings (e.g. 1→UP, 0→DOWN)."""
    return {
        "type": "stat",
        "title": title,
        "description": description,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
        "options": {
            "colorMode": "background",
            "graphMode": "none",
            "textMode": "auto",
            "orientation": "auto",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "noValue": "—",
                "color": {"mode": "thresholds"},
                "thresholds": {
                    "mode": "absolute",
                    "steps": [
                        {"color": RED, "value": None},
                        {"color": GREEN, "value": 1},
                    ],
                },
                "mappings": mappings,
            },
            "overrides": [],
        },
        "_w": w,
        "_h": h,
    }


def ts(
    title: str,
    targets: list[tuple[str, str]],
    unit: str = "reqps",
    overrides: list | None = None,
    stack: bool = False,
    fill: int = 12,
    description: str = "",
    no_value: str = "No traffic yet",
    w: int = 12,
    h: int = 8,
    y_min: float | None = None,
    y_soft_max: float | None = None,
    thresholds: list | None = None,
) -> dict:
    """Time series panel with smooth lines, compact legend, and crosshairs."""
    custom: dict = {
        "lineWidth": 2,
        "fillOpacity": fill,
        "gradientMode": "opacity",
        "showPoints": "never",
        "pointSize": 4,
        "spanNulls": False,
        "lineInterpolation": "smooth",
        "axisBorderShow": False,
        "axisGridShow": True,
        "stacking": {"mode": "normal" if stack else "none"},
    }
    if thresholds:
        custom["thresholdsStyle"] = {"mode": "line"}

    defaults: dict = {
        "unit": unit,
        "noValue": no_value,
        "color": {"mode": "palette-classic"},
        "custom": custom,
        "thresholds": {
            "mode": "absolute",
            "steps": thresholds or [{"color": GREEN, "value": None}],
        },
    }
    if y_min is not None:
        defaults["min"] = y_min
    if y_soft_max is not None:
        defaults["max"] = y_soft_max

    return {
        "type": "timeseries",
        "title": title,
        "description": description,
        "datasource": DS,
        "targets": [
            {
                "refId": chr(65 + i),
                "expr": expr,
                "legendFormat": legend,
                "datasource": DS,
            }
            for i, (expr, legend) in enumerate(targets)
        ],
        "fieldConfig": {
            "defaults": defaults,
            "overrides": overrides or [],
        },
        "options": {
            "legend": {
                "displayMode": "list",
                "placement": "bottom",
                "calcs": [],
            },
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "_w": w,
        "_h": h,
    }


def _series_override(name: str, color: str, fill: int = 0, dashed: bool = False) -> dict:
    """fieldConfig override for one series by display name."""
    custom: dict = {"fillOpacity": fill}
    if dashed:
        custom["lineStyle"] = {"fill": "dash", "dash": [8, 4]}
    return {
        "matcher": {"id": "byName", "options": name},
        "properties": [
            {"id": "color", "value": {"mode": "fixed", "fixedColor": color}},
            {"id": "custom.fillOpacity", "value": fill},
            *(
                [{"id": "custom.lineStyle", "value": {"fill": "dash", "dash": [8, 4]}}]
                if dashed
                else []
            ),
        ],
    }


def row(title: str, collapsed: bool = False) -> dict:
    return {"type": "row", "title": title, "collapsed": collapsed, "_w": 24, "_h": 1}


def alerts_panel(
    title: str = "Active Alerts",
    description: str = "",
    w: int = 24,
    h: int = 6,
) -> dict:
    return {
        "type": "alertlist",
        "title": title,
        "description": description,
        "options": {
            "alertListOptions": {"showOptions": "current"},
            "stateFilter": {"firing": True, "pending": True},
            "maxItems": 20,
            "sortOrder": 1,
            "noDataFound": "All clear — no firing alerts.",
        },
        "datasource": DS,
        "targets": [{"refId": "A", "expr": "ALERTS", "datasource": DS}],
        "_w": w,
        "_h": h,
    }


def scrape_status_grid(w: int = 24, h: int = 5) -> dict:
    """Stat panel repeating over `up` metric by instance to show per-target UP/DOWN."""
    return {
        "type": "stat",
        "title": "Scrape Target Status",
        "description": (
            "One tile per Prometheus scrape target. "
            "Green = UP, Red = DOWN, — = target not seen yet."
        ),
        "datasource": DS,
        "targets": [
            {
                "refId": "A",
                "expr": "up",
                "legendFormat": "{{job}}: {{instance}}",
                "datasource": DS,
                "instant": True,
            }
        ],
        "options": {
            "colorMode": "background",
            "graphMode": "none",
            "textMode": "auto",
            "orientation": "auto",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": True},
        },
        "fieldConfig": {
            "defaults": {
                "unit": "short",
                "noValue": "—",
                "color": {"mode": "thresholds"},
                "thresholds": {
                    "mode": "absolute",
                    "steps": [
                        {"color": RED, "value": None},
                        {"color": GREEN, "value": 1},
                    ],
                },
                "mappings": [
                    {
                        "type": "value",
                        "options": {
                            "0": {"text": "DOWN", "color": RED, "index": 0},
                            "1": {"text": "UP", "color": GREEN, "index": 1},
                        },
                    }
                ],
            },
            "overrides": [],
        },
        "_w": w,
        "_h": h,
    }


def dashboard(
    uid: str,
    title: str,
    panels: list,
    description: str,
    has_origin_var: bool = False,
) -> dict:
    """Assemble a full Grafana dashboard JSON object."""
    templating_list = [
        {
            "name": "rate_interval",
            "type": "custom",
            "label": "Rate Window",
            "query": "30s,1m,2m,5m",
            "current": {"text": "1m", "value": "1m", "selected": True},
            "options": [
                {"text": "30s", "value": "30s", "selected": False},
                {"text": "1m", "value": "1m", "selected": True},
                {"text": "2m", "value": "2m", "selected": False},
                {"text": "5m", "value": "5m", "selected": False},
            ],
            "hide": 0,
        }
    ]
    if has_origin_var:
        templating_list.insert(
            0,
            {
                "name": "origin",
                "type": "query",
                "datasource": DS,
                "label": "Origin Instance",
                "query": "label_values(demo_requests_total, origin)",
                "includeAll": True,
                "allValue": ".*",
                "multi": True,
                "refresh": 1,
                "current": {"text": "All", "value": "$__all", "selected": True},
                "hide": 0,
            },
        )

    annotations = {
        "list": [
            {
                "builtIn": 1,
                "datasource": "-- Grafana --",
                "enable": True,
                "hide": False,
                "name": "Annotations & Alerts",
                "type": "dashboard",
            },
            {
                "name": "Backend down",
                "datasource": DS,
                "enable": True,
                "hide": False,
                "expr": "changes(surgeguard_backend_up[30s]) != 0",
                "step": "30s",
                "titleFormat": "Backend probe change",
                "textFormat": "{{backend}}",
                "iconColor": RED,
                "tags": ["backend"],
            },
            {
                "name": "Admission paused/resumed",
                "datasource": DS,
                "enable": True,
                "hide": False,
                "expr": "changes(surgeguard_admission_paused[30s]) != 0",
                "step": "30s",
                "titleFormat": "Admission state change",
                "iconColor": AMBER,
                "tags": ["admission"],
            },
            {
                "name": "Worker leader change",
                "datasource": DS,
                "enable": True,
                "hide": False,
                "expr": "changes(surgeguard_worker_is_leader[30s]) != 0",
                "step": "30s",
                "titleFormat": "Leader election",
                "iconColor": PURPLE,
                "tags": ["worker"],
            },
        ]
    }

    return {
        "uid": uid,
        "title": title,
        "description": description,
        "tags": ["surgeguard", "observability"],
        "timezone": "browser",
        "schemaVersion": 39,
        "version": 4,
        "refresh": "5s",
        "time": {"from": "now-15m", "to": "now"},
        "editable": False,
        "graphTooltip": 1,
        "panels": _layout(panels),
        "templating": {"list": templating_list},
        "annotations": annotations,
    }


def _layout(panels: list) -> list:
    """Assign gridPos to each panel sequentially on a strict 24-column grid."""
    x = y = row_h = 0
    out = []
    for i, p in enumerate(panels, start=1):
        w, h = p.pop("_w"), p.pop("_h")
        if p.get("type") == "row":
            if x > 0:
                y += row_h
                x = 0
                row_h = 0
            p["id"] = i
            p["gridPos"] = {"x": 0, "y": y, "w": 24, "h": 1}
            y += 1
            out.append(p)
            continue
        if x + w > 24:
            x, y = 0, y + row_h
            row_h = 0
        p["id"] = i
        p["gridPos"] = {"x": x, "y": y, "w": w, "h": h}
        out.append(p)
        x += w
        row_h = max(row_h, h)
    return out


# ═══════════════════════════════════════════════════════════════════════════
#  1. OVERVIEW — surgeguard-overview (Health at a glance)
# ═══════════════════════════════════════════════════════════════════════════

OVERVIEW_PANELS = [
    header("1. Overview — Is everything OK, and is the waiting room protecting your origin?"),

    # Top row: 6 big stat panels across 24 cols (4 cols each)
    stat_mapped(
        "Overall Status",
        (
            "clamp_max("
            "  (max(redis_up{job=\"redis\"}) or vector(0))"
            "  + (max(surgeguard_worker_is_leader) or vector(0))"
            "  + clamp_max(max(surgeguard_backends_healthy) or vector(0), 1),"
            "  2"
            ") * clamp_max("
            "  (max(up{job=\"surgeguard-api\"}) or vector(0))"
            "  * (max(redis_up{job=\"redis\"}) or vector(0)),"
            "  1"
            ")"
        ),
        mappings=[
            {
                "type": "value",
                "options": {
                    "0": {"text": "DOWN",     "color": RED,   "index": 0},
                    "1": {"text": "DEGRADED", "color": AMBER, "index": 1},
                    "2": {"text": "HEALTHY",  "color": GREEN, "index": 2},
                },
            }
        ],
        description="Cluster health signal: HEALTHY = Redis up + Worker leader + API up + healthy backends.",
        w=4, h=5,
    ),
    stat(
        "Waiting now",
        "max(surgeguard_queue_length) or vector(0)",
        unit="short",
        decimals=0,
        thresholds=[
            {"color": GREEN, "value": None},
            {"color": AMBER, "value": 1},
            {"color": RED,   "value": 100},
        ],
        no_value="0",
        description="Visitors currently in the FIFO queue waiting for an admission token.",
        w=4, h=5,
    ),
    stat(
        "Admitted / s",
        ADMISSION_RATE,
        unit="reqps",
        decimals=1,
        thresholds=[{"color": GREEN, "value": None}],
        no_value="0",
        description="Admission tokens issued per second (measured).",
        w=4, h=5,
    ),
    stat(
        "Healthy backends",
        "max(surgeguard_backends_healthy) or vector(0)",
        unit="short",
        decimals=0,
        thresholds=[
            {"color": RED,   "value": None},
            {"color": AMBER, "value": 1},
            {"color": GREEN, "value": 2},
        ],
        no_value="0",
        description="Origin backends passing active health probes.",
        w=4, h=5,
    ),
    stat(
        "Error rate",
        ERR_RATIO,
        unit="percentunit",
        decimals=1,
        thresholds=[
            {"color": GREEN, "value": None},
            {"color": AMBER, "value": 0.01},
            {"color": RED,   "value": 0.05},
        ],
        no_value="0%",
        description="Fraction of origin responses that are 5xx server errors.",
        w=4, h=5,
    ),
    stat_mapped(
        "Redis up",
        'max(redis_up{job="redis"}) or vector(0)',
        mappings=[
            {
                "type": "value",
                "options": {
                    "0": {"text": "DOWN", "color": RED,   "index": 0},
                    "1": {"text": "UP",   "color": GREEN, "index": 1},
                },
            }
        ],
        description="Redis state store connectivity for queue and token coordination.",
        w=4, h=5,
    ),

    # Main 2 time series
    row("Traffic & Admission"),
    ts(
        "Edge requests vs admitted to origin",
        [
            (EDGE_RPS, "Edge ingress (Nginx)"),
            (ORIGIN_RPS, "Admitted to origin"),
        ],
        unit="reqps",
        overrides=[
            _series_override("Edge ingress (Nginx)", BLUE,  fill=10),
            _series_override("Admitted to origin",   GREEN, fill=12),
        ],
        description="Public edge traffic arriving at Nginx vs visitors admitted to origin.",
        y_min=0,
        w=12, h=8,
    ),
    ts(
        "Admission rate — measured vs target",
        [
            (ADMISSION_RATE, "Measured rate"),
            ("max(surgeguard_admission_rate_effective) or vector(0)", "Effective target"),
            ("max(surgeguard_admission_rate_configured) or vector(0)", "Configured target"),
        ],
        unit="reqps",
        overrides=[
            _series_override("Measured rate",      GREEN, fill=14),
            _series_override("Effective target",  AMBER, fill=0, dashed=True),
            _series_override("Configured target", SLATE, fill=0, dashed=True),
        ],
        description="Tokens issued per second (solid line) vs configured policy rate (dashed line).",
        y_min=0,
        w=12, h=8,
    ),

    row("Queue & Origin Health"),
    ts(
        "People in line",
        [("max(surgeguard_queue_length) or vector(0)", "Waiting in queue")],
        unit="short",
        overrides=[_series_override("Waiting in queue", AMBER, fill=16)],
        description="Queue depth over time. Flat line near zero means admission gate matches incoming arrivals.",
        y_min=0,
        y_soft_max=5,
        w=12, h=8,
    ),
    ts(
        "Website speed & latency (p50 / p95 / p99)",
        [(P50, "p50 median"), (P95, "p95"), (P99, "p99 tail")],
        unit="s",
        overrides=[
            _series_override("p50 median", GREEN,  fill=8),
            _series_override("p95",        AMBER,  fill=6),
            _series_override("p99 tail",   PURPLE, fill=4),
        ],
        no_value="No traffic yet",
        description="End-to-end response time latency profile at the origin backend.",
        y_min=0,
        w=12, h=8,
    ),

    row("Scrape targets", collapsed=True),
    scrape_status_grid(w=24, h=5),
]


# ═══════════════════════════════════════════════════════════════════════════
#  2. QUEUE & ADMISSION — surgeguard-queue
# ═══════════════════════════════════════════════════════════════════════════

QUEUE_PANELS = [
    header("2. Queue & Admission — Queue length, admission velocity, wait times, token lifecycle"),

    # Stat strip
    stat("Waiting now", "max(surgeguard_queue_length) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1}, {"color": RED, "value": 100}],
         no_value="0", description="Visitors currently in the FIFO waiting room.", w=6, h=5),
    stat("Admitted & active", "max(surgeguard_admitted_active) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="0", description="Visitors currently holding a valid admission token.", w=6, h=5),
    stat("Admission rate", ADMISSION_RATE,
         unit="reqps", decimals=1,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="0", description="Tokens minted per second (measured).", w=6, h=5),
    stat("Configured rate", "max(surgeguard_admission_rate_configured) or vector(0)",
         unit="reqps", decimals=0,
         thresholds=[{"color": BLUE, "value": None}],
         no_value="—", description="Configured admission rate setting.", w=6, h=5),

    row("Queue length & admission rate"),
    ts(
        "People in line",
        [("max(surgeguard_queue_length) or vector(0)", "Waiting")],
        unit="short",
        overrides=[_series_override("Waiting", AMBER, fill=16)],
        description="Queue length over time.",
        y_min=0, y_soft_max=5,
        w=12, h=8,
    ),
    ts(
        "Admission rate — measured vs configured vs effective",
        [
            (ADMISSION_RATE, "Measured"),
            ("max(surgeguard_admission_rate_effective) or vector(0)", "Effective target"),
            ("max(surgeguard_admission_rate_configured) or vector(0)", "Configured target"),
        ],
        unit="reqps",
        overrides=[
            _series_override("Measured",          GREEN, fill=14),
            _series_override("Effective target",  AMBER, fill=0, dashed=True),
            _series_override("Configured target", SLATE, fill=0, dashed=True),
        ],
        description="Measured admission rate vs configured and health-adjusted effective targets.",
        y_min=0, w=12, h=8,
    ),

    row("Wait times & join outcomes"),
    ts(
        "Queue wait time (p50 / p95)",
        [(WAIT_P50, "p50 median"), (WAIT_P95, "p95 wait")],
        unit="s",
        overrides=[
            _series_override("p50 median", GREEN, fill=10),
            _series_override("p95 wait",   AMBER, fill=6),
        ],
        no_value="No traffic yet",
        description="Time from joining the queue until receiving an admission token.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Queue joins by mode",
        [("sum by (mode) (rate(surgeguard_queue_joins_total[$rate_interval]))", "{{mode}}")],
        unit="reqps",
        stack=True,
        description="Arrivals by admission path (direct vs queued).",
        y_min=0, w=12, h=8,
    ),

    row("Token lifecycle & security"),
    ts(
        "Tokens issued & validated",
        [
            ("sum(rate(surgeguard_tokens_issued_total[$rate_interval])) or vector(0)", "Issued"),
            ("sum by (result) (rate(surgeguard_token_validations_total[$rate_interval]))", "Validation: {{result}}"),
        ],
        unit="reqps",
        description="Token minting rate and validation outcomes at /internal/auth.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Token rejections by reason",
        [("sum by (reason) (rate(surgeguard_token_rejections_total[$rate_interval]))", "{{reason}}")],
        unit="reqps",
        stack=True,
        description="Security rejections (expired, tampered signature, revoked).",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Visitors expired (heartbeat timeout)",
        [("sum by (reason) (rate(surgeguard_visitors_expired_total[$rate_interval]))", "{{reason}}")],
        unit="reqps",
        description="Visitors purged from queue after abandoned polling.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Rate-limited join attempts",
        [("sum by (bucket) (rate(surgeguard_rate_limited_total[$rate_interval]))", "{{bucket}}")],
        unit="reqps",
        description="Join attempts throttled by the application rate limiter.",
        y_min=0, w=12, h=8,
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
#  3. BACKENDS & TRAFFIC — surgeguard-backends
# ═══════════════════════════════════════════════════════════════════════════

BACKENDS_PANELS = [
    header("3. Backends & Traffic — Nginx ingress, connections, per-origin load & bypass protection"),

    stat("Edge requests / s", EDGE_RPS,
         unit="reqps", decimals=1,
         thresholds=[{"color": BLUE, "value": None}],
         no_value="0", description="HTTP requests arriving at Nginx edge per second.", w=4, h=5),
    stat("Active connections", "max(nginx_connections_active) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="0", description="Open TCP connections in Nginx workers.", w=4, h=5),
    stat("Healthy backends", "max(surgeguard_backends_healthy) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": RED, "value": None}, {"color": AMBER, "value": 1}, {"color": GREEN, "value": 2}],
         no_value="0", description="Origin backends passing active health probes.", w=4, h=5),
    stat("Origin p95 latency", P95,
         unit="s", decimals=2,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 0.5}, {"color": RED, "value": 1.0}],
         no_value="No traffic yet", description="95th percentile execution time at origin backend.", w=4, h=5),
    stat("Origin error rate", ERR_RATIO,
         unit="percentunit", decimals=1,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 0.01}, {"color": RED, "value": 0.05}],
         no_value="0%", description="Origin 5xx error ratio.", w=4, h=5),
    stat("Direct-bypass drops", 'sum(rate(demo_forbidden_total[$rate_interval])) or vector(0)',
         unit="reqps", decimals=1,
         thresholds=[{"color": GREEN, "value": None}, {"color": RED, "value": 1}],
         no_value="0", description="Requests blocked by guard middleware without origin key.", w=4, h=5),

    row("Edge ingress & connections"),
    ts(
        "Nginx edge request rate",
        [(EDGE_RPS, "Nginx edge rps")],
        unit="reqps",
        overrides=[_series_override("Nginx edge rps", BLUE, fill=12)],
        description="Total HTTP requests arriving at the public Nginx edge.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Nginx connection states",
        [
            ("max(nginx_connections_active) or vector(0)",  "Active"),
            ("max(nginx_connections_reading) or vector(0)", "Reading"),
            ("max(nginx_connections_writing) or vector(0)", "Writing"),
            ("max(nginx_connections_waiting) or vector(0)", "Keep-alive"),
        ],
        unit="short",
        overrides=[
            _series_override("Active",     BLUE,  fill=10),
            _series_override("Keep-alive", SLATE, fill=4),
        ],
        description="TCP connection states inside Nginx workers.",
        y_min=0, w=12, h=8,
    ),

    row("Per-origin workload ($origin)"),
    ts(
        "Requests per origin",
        [('sum by (origin) (rate(demo_requests_total{origin=~"$origin"}[$rate_interval]))', "{{origin}}")],
        unit="reqps",
        stack=True,
        description="Admitted requests distributed across origin backends.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin p95 latency by instance",
        [('histogram_quantile(0.95, sum by (le, origin) (rate(demo_request_duration_seconds_bucket{origin=~"$origin"}[$rate_interval])))', "{{origin}} p95")],
        unit="s",
        no_value="No traffic yet",
        description="Execution latency at 95th percentile per origin.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin concurrency semaphore (in-flight & pending)",
        [
            ('sum by (origin) (demo_inflight_requests{origin=~"$origin"})', "In-flight {{origin}}"),
            ('sum by (origin) (demo_pending_requests{origin=~"$origin"})', "Pending {{origin}}"),
        ],
        unit="short",
        description="Internal concurrency semaphore state per origin node.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin 5xx error ratio & 503 overload drops",
        [
            (ERR_RATIO, "5xx ratio"),
            ('sum by (origin) (rate(demo_overload_rejections_total{origin=~"$origin"}[$rate_interval]))', "{{origin}} 503 drops"),
        ],
        unit="percentunit",
        overrides=[
            _series_override("5xx ratio", RED, fill=10),
        ],
        description="Server errors and concurrency exhaustion drops.",
        y_min=0, w=12, h=8,
    ),

    row("Security & backend health"),
    ts(
        "Direct-bypass attempts (403 Forbidden)",
        [('sum by (origin) (rate(demo_forbidden_total{origin=~"$origin"}[$rate_interval]))', "Blocked {{origin}}")],
        unit="reqps",
        overrides=[_series_override("Blocked demo-1", RED, fill=8), _series_override("Blocked demo-2", RED, fill=8)],
        description="Requests without valid X-Origin-Key header blocked by origin guard middleware.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Backend health probe latency",
        [("max by (backend) (surgeguard_backend_check_latency_seconds)", "{{backend}}")],
        unit="s",
        no_value="No traffic yet",
        description="Round-trip latency of worker health probes to each backend.",
        y_min=0, w=12, h=8,
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
#  4. RELIABILITY & RECOVERY — surgeguard-failure
# ═══════════════════════════════════════════════════════════════════════════

FAILURE_PANELS = [
    header("4. Reliability & Recovery — Fail-closed behavior, auto-pause, worker leadership, alerts"),

    stat_mapped("API status", 'max(up{job="surgeguard-api"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="SurgeGuard API health.", w=4, h=5),
    stat_mapped("Worker status", 'max(up{job="admission-worker"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="Admission worker health.", w=4, h=5),
    stat_mapped("Redis status", 'max(redis_up{job="redis"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="Redis exporter health.", w=4, h=5),
    stat("Healthy backends", "max(surgeguard_backends_healthy) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": RED, "value": None}, {"color": AMBER, "value": 1}, {"color": GREEN, "value": 2}],
         no_value="0", description="Origin backends passing active health probes.", w=4, h=5),
    stat("Worker leader", "max(surgeguard_worker_is_leader) or vector(0)",
         thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}],
         no_value="—", description="1 = Worker holds the leader lock. 0 = Admissions frozen.", w=4, h=5),
    stat("Admission paused", "max(surgeguard_admission_paused) or vector(0)",
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1}],
         no_value="0", description="1 = Admission paused (manual operator toggle or auto-pause).", w=4, h=5),

    row("Service availability & recovery timing"),
    ts(
        "Cluster service availability (1 = UP, 0 = DOWN)",
        [
            ('max(up{job="surgeguard-api"}) or vector(0)',                    "API"),
            ('max(up{job="admission-worker"}) or vector(0)',                  "Worker"),
            ('max(redis_up{job="redis"}) or vector(0)',                       "Redis exporter"),
            ('max(surgeguard_redis_up{job="admission-worker"}) or vector(0)', "Worker Redis ping"),
            ('max(nginx_up{job="nginx"}) or vector(0)',                       "Nginx"),
        ],
        unit="short",
        description="Availability signal across all cluster components.",
        y_min=0, y_soft_max=1.1,
        w=12, h=8,
    ),
    ts(
        "Configured vs healthy backends",
        [
            ("max(surgeguard_backends_healthy) or vector(0)", "Healthy backends"),
            ("max(surgeguard_backends_total) or vector(0)",   "Configured total"),
        ],
        unit="short",
        overrides=[
            _series_override("Healthy backends", GREEN, fill=10),
            _series_override("Configured total", SLATE, fill=0, dashed=True),
        ],
        description="Live healthy nodes vs configured pool — drops illustrate backend failure and recovery timing.",
        y_min=0, w=12, h=8,
    ),

    row("Fail-closed & auto-pause mechanisms"),
    ts(
        "Fail-closed auth decisions",
        [("sum(rate(surgeguard_auth_fail_closed_total[$rate_interval])) or vector(0)", "Fail-closed / s")],
        unit="reqps",
        overrides=[_series_override("Fail-closed / s", RED, fill=12)],
        description="Requests refused by Nginx because auth dependency was unavailable.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Admission paused (auto & manual)",
        [("max by (kind) (surgeguard_admission_paused)", "{{kind}}")],
        unit="short",
        description="1 when admission is paused. Kind=auto indicates all backends were down.",
        y_min=0, y_soft_max=1.1,
        w=12, h=8,
    ),
    ts(
        "Admission loop failures by reason",
        [("sum by (reason) (rate(surgeguard_admission_failures_total[$rate_interval]))", "{{reason}}")],
        unit="reqps",
        stack=True,
        description="Exceptions or timeouts inside worker loop.",
        y_min=0, w=12, h=8,
    ),
    alerts_panel(
        "Active alert rules",
        description="Prometheus alert rules currently firing or pending.",
        w=12, h=8,
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
#  5. INFRASTRUCTURE — surgeguard-resources
# ═══════════════════════════════════════════════════════════════════════════

RESOURCES_PANELS = [
    header("5. Infrastructure — Redis memory & latency, worker loop timing, CPU & RSS"),

    stat("Redis status", 'max(redis_up{job="redis"}) or vector(0)',
         thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}],
         no_value="—", description="1 = Redis is reachable.", w=6, h=5),
    stat("Redis memory", 'max(redis_memory_used_bytes{job="redis"}) or vector(0)',
         unit="bytes", decimals=1,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="—", description="Memory allocated by Redis.", w=6, h=5),
    stat("Worker leader", "max(surgeguard_worker_is_leader) or vector(0)",
         thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}],
         no_value="—", description="1 = Worker holds distributed leader lock.", w=6, h=5),
    stat("Worker tick age",
         "time() - max(surgeguard_worker_last_tick_timestamp_seconds)",
         unit="s", decimals=0,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 5}, {"color": RED, "value": 15}],
         no_value="—", description="Seconds since last worker tick. Red ≥15s means worker stalled.", w=6, h=5),

    row("Redis state store"),
    ts(
        "Redis memory vs ceiling",
        [
            ('max(redis_memory_used_bytes{job="redis"}) or vector(0)', "Used"),
            ('max(redis_memory_max_bytes{job="redis"}) or vector(0)',  "Max ceiling"),
        ],
        unit="bytes",
        overrides=[
            _series_override("Used",        BLUE, fill=12),
            _series_override("Max ceiling", RED,  fill=0, dashed=True),
        ],
        description="Redis memory usage vs maxmemory configuration.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Redis ping latency (p50 / p95)",
        [
            ("histogram_quantile(0.50, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[$rate_interval]))) * 1000", "p50 ms"),
            ("histogram_quantile(0.95, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[$rate_interval]))) * 1000", "p95 ms"),
        ],
        unit="ms",
        overrides=[
            _series_override("p50 ms", GREEN, fill=8),
            _series_override("p95 ms", AMBER, fill=4),
        ],
        no_value="No traffic yet",
        description="Round-trip latency from worker to Redis in milliseconds.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Redis command throughput",
        [('sum(rate(redis_commands_total{job="redis"}[$rate_interval])) or vector(0)', "cmds/s")],
        unit="short",
        overrides=[_series_override("cmds/s", BLUE, fill=10)],
        description="Redis operations per second.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Redis connected clients",
        [('max(redis_connected_clients{job="redis"}) or vector(0)', "clients")],
        unit="short",
        overrides=[_series_override("clients", GREEN, fill=8)],
        description="Client connections open to Redis.",
        y_min=0, w=12, h=8,
    ),

    row("Worker loop & process resources"),
    ts(
        "Worker tick rate",
        [("sum(rate(surgeguard_worker_ticks_total[$rate_interval])) or vector(0)", "ticks/s")],
        unit="short",
        overrides=[_series_override("ticks/s", GREEN, fill=12)],
        description="Worker loop iterations per second (~1/s at steady state).",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Seconds since last tick",
        [("time() - max(surgeguard_worker_last_tick_timestamp_seconds)", "staleness (s)")],
        unit="s",
        overrides=[_series_override("staleness (s)", AMBER, fill=10)],
        description="Age of last completed tick. Increases if worker process hangs.",
        y_min=0,
        thresholds=[{"color": AMBER, "value": 5}, {"color": RED, "value": 15}],
        w=12, h=8,
    ),
    ts(
        "Process CPU utilization",
        [
            ('sum by (job) (rate(process_cpu_seconds_total[$rate_interval])) or vector(0)', "CPU: {{job}}"),
        ],
        unit="percentunit",
        description="CPU seconds consumed per process group.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Process Resident Memory (RSS)",
        [
            ('sum by (job) (process_resident_memory_bytes) or vector(0)', "RSS: {{job}}"),
        ],
        unit="bytes",
        description="Resident set memory consumed per process job.",
        y_min=0, w=12, h=8,
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
#  6. PROTECTED VS UNPROTECTED — surgeguard-comparison (Demo showcase)
# ═══════════════════════════════════════════════════════════════════════════

COMPARISON_PANELS = [
    header("6. Protected vs Unprotected — Live proof: SurgeGuard (:8080) vs unprotected overload (:8081)"),

    # Stat strip
    stat("Protected error rate", ERR_RATIO,
         unit="percentunit", decimals=1,
         thresholds=[{"color": GREEN, "value": None}, {"color": RED, "value": 0.05}],
         no_value="0%", description="Origin 5xx error rate behind SurgeGuard (stays at 0%).", w=6, h=5),
    stat("Unprotected 503 drops", 'sum(rate(demo_overload_rejections_total[$rate_interval])) or vector(0)',
         unit="reqps", decimals=1,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1}, {"color": RED, "value": 5}],
         no_value="0", description="Overload drops on unprotected site when concurrency is exceeded.", w=6, h=5),
    stat("Successful requests / s", 'sum(rate(demo_requests_total{status="200"}[$rate_interval])) or vector(0)',
         unit="reqps", decimals=1,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="0", description="Admitted HTTP 200 OK responses served smoothly by origin backends.", w=6, h=5),
    stat("People protected in line", "max(surgeguard_queue_length) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1}],
         no_value="0", description="Visitors waiting safely in FIFO queue rather than crashing the database.", w=6, h=5),

    row("Side-by-side resilience comparison"),
    ts(
        "Side-by-side: Error rate vs overload drops",
        [
            (ERR_RATIO, "Protected 5xx error ratio (0%)"),
            ("sum(rate(demo_overload_rejections_total[$rate_interval])) or vector(0)", "Unprotected 503 drops / s"),
        ],
        unit="short",
        overrides=[
            _series_override("Protected 5xx error ratio (0%)", GREEN, fill=10),
            _series_override("Unprotected 503 drops / s",      RED,   fill=14),
        ],
        description="SurgeGuard prevents 503 crash drops by pacing traffic through the waiting room.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Side-by-side: Response latency (p95)",
        [
            (P95, "Measured origin latency"),
        ],
        unit="s",
        overrides=[
            _series_override("Measured origin latency", GREEN, fill=10),
        ],
        thresholds=[{"color": AMBER, "value": 0.4}],
        no_value="No traffic yet",
        description="Response time remains flat and calm under surge instead of cascading into timeouts.",
        y_min=0, w=12, h=8,
    ),

    row("Throughput & concurrency bounding"),
    ts(
        "Throughput: Requests admitted vs edge surge",
        [
            (EDGE_RPS,   "Edge surge ingress (Nginx)"),
            (ORIGIN_RPS, "Admitted origin throughput"),
        ],
        unit="reqps",
        overrides=[
            _series_override("Edge surge ingress (Nginx)", BLUE,  fill=8),
            _series_override("Admitted origin throughput", GREEN, fill=14),
        ],
        description="Public traffic surge at the edge is buffered into a clean, predictable flow to origins.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin concurrency protection (in-flight vs limit)",
        [
            ('sum(demo_inflight_requests) or vector(0)', "In-flight work"),
            ('sum(demo_pending_requests) or vector(0)',  "Pending slots"),
        ],
        unit="short",
        overrides=[
            _series_override("In-flight work", GREEN, fill=12),
            _series_override("Pending slots",  AMBER, fill=6),
        ],
        description="Origin work stays strictly below the breaking point (10 concurrent requests).",
        y_min=0, y_soft_max=12, w=12, h=8,
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
#  Legacy Latency Dashboard (preserved so existing URLs never 404)
# ═══════════════════════════════════════════════════════════════════════════

LATENCY_PANELS = [
    header("Latency & 5xx — Origin response times, error rates, and status codes"),

    stat("p50 latency", P50, unit="s", decimals=3,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 0.3}, {"color": RED, "value": 0.8}],
         no_value="No traffic yet", description="Median origin response time.", w=6, h=5),
    stat("p95 latency", P95, unit="s", decimals=3,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 0.5}, {"color": RED, "value": 1.0}],
         no_value="No traffic yet", description="95th percentile origin response time.", w=6, h=5),
    stat("p99 latency", P99, unit="s", decimals=3,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1.0}, {"color": RED, "value": 2.0}],
         no_value="No traffic yet", description="99th percentile tail latency.", w=6, h=5),
    stat("Error rate", ERR_RATIO, unit="percentunit", decimals=2,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 0.01}, {"color": RED, "value": 0.05}],
         no_value="0%", description="Fraction of origin responses that are 5xx.", w=6, h=5),

    row("Latency distributions"),
    ts(
        "Origin latency — p50 / p95 / p99",
        [(P50, "p50"), (P95, "p95"), (P99, "p99")],
        unit="s",
        overrides=[
            _series_override("p50", GREEN,  fill=8),
            _series_override("p95", AMBER,  fill=6),
            _series_override("p99", PURPLE, fill=4),
        ],
        no_value="No traffic yet",
        description="Latency percentiles for admitted requests.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin responses by HTTP status",
        [('sum by (status) (rate(demo_requests_total{origin=~"$origin"}[$rate_interval]))', "HTTP {{status}}")],
        unit="reqps",
        stack=True,
        description="HTTP response code distribution from origin backends.",
        y_min=0, w=12, h=8,
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
#  Dashboard Registry
# ═══════════════════════════════════════════════════════════════════════════

DASHBOARDS = {
    "surgeguard-overview": dashboard(
        "surgeguard-overview",
        "SurgeGuard · 1. Overview",
        OVERVIEW_PANELS,
        "Is everything OK, and is the waiting room protecting your origin? Health at a glance.",
        has_origin_var=True,
    ),
    "surgeguard-queue": dashboard(
        "surgeguard-queue",
        "SurgeGuard · 2. Queue & Admission",
        QUEUE_PANELS,
        "How deep is the queue, and how smoothly are visitors being admitted? Queue mechanics & tokens.",
        has_origin_var=False,
    ),
    "surgeguard-backends": dashboard(
        "surgeguard-backends",
        "SurgeGuard · 3. Backends & Traffic",
        BACKENDS_PANELS,
        "Are backends healthy, evenly loaded, and protected from direct bypass? Ingress & origin load.",
        has_origin_var=True,
    ),
    "surgeguard-failure": dashboard(
        "surgeguard-failure",
        "SurgeGuard · 4. Reliability & Recovery",
        FAILURE_PANELS,
        "How does SurgeGuard handle failures, auto-pause, fail-closed, and recovery? Failure diagnostics.",
        has_origin_var=False,
    ),
    "surgeguard-resources": dashboard(
        "surgeguard-resources",
        "SurgeGuard · 5. Infrastructure",
        RESOURCES_PANELS,
        "Redis memory, worker loop timing, and resource utilization across dependencies.",
        has_origin_var=False,
    ),
    "surgeguard-comparison": dashboard(
        "surgeguard-comparison",
        "SurgeGuard · 6. Protected vs Unprotected",
        COMPARISON_PANELS,
        "Live comparison showcase: SurgeGuard protected origin (:8080) vs direct overload (:8081).",
        has_origin_var=False,
    ),
    "surgeguard-latency": dashboard(
        "surgeguard-latency",
        "SurgeGuard · Latency & 5xx",
        LATENCY_PANELS,
        "Latency percentile curves, error rates, and HTTP response status codes.",
        has_origin_var=True,
    ),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, board in DASHBOARDS.items():
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(board, indent=2) + "\n")
        print(f"wrote {path.name}  ({len(board['panels'])} panels)")
