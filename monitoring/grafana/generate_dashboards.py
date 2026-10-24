"""Generate the six provisioned Grafana dashboards for SurgeGuard.

    python monitoring/grafana/generate_dashboards.py
    # or:
    make dashboards

Design principles applied in this revision
───────────────────────────────────────────
• Consistent palette: blue=traffic/edge, green=admitted & healthy,
  amber=queue & warnings, red=errors only, purple=latency.
• All time series: lineWidth 2, fillOpacity 12, smooth, no point markers,
  legend list (bottom), no Mean/Max/Last table, shared crosshair tooltip desc.
• Stat panels: colorMode=background, graphMode=area, sparkline on.
• Idle-safe queries: ratio metrics wrapped with `or vector(0)`;
  latency percentiles use noValue="No traffic" so they show a label not blank.
• Every panel has a title, description, and correct unit.
• Rows: detail rows COLLAPSED by default; at most ~10 panels visible per page.
• Dashboard defaults: time=30m, refresh=10s.
• UIDs are unchanged so all existing console deep-links keep working.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).parent / "dashboards"
DS = {"type": "prometheus", "uid": "prometheus"}

# ─── Palette (same meaning across all dashboards) ─────────────────────────
BLUE   = "#3b82f6"   # traffic / edge
GREEN  = "#10b981"   # admitted / healthy
AMBER  = "#f59e0b"   # queue / warnings
RED    = "#ef4444"   # errors only
PURPLE = "#8b5cf6"   # latency
GREY   = "#94a3b8"   # neutral / secondary
SLATE  = "#64748b"   # dim / annotation text

# Kept for backwards compat with older per-series names
CYAN   = "#06b6d4"
EMERALD = GREEN
ORANGE  = AMBER
INDIGO  = PURPLE
VIOLET  = PURPLE
ROSE    = RED

# ─── PromQL shared fragments ──────────────────────────────────────────────
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

# Scrape targets (one target per job in prometheus.yml)
SCRAPE_JOBS = [
    "surgeguard-api",
    "admission-worker",
    "demo-origin",
    "redis",
    "nginx",
    "prometheus",
]

# ─── HEADER text panel (link bar) ─────────────────────────────────────────
LINK_BAR = (
    "| [Edge & Traffic](/grafana/d/surgeguard-backends?{__url_time_range}) "
    "| [Queue & Tokens](/grafana/d/surgeguard-queue?{__url_time_range}) "
    "| [Infrastructure](/grafana/d/surgeguard-resources?{__url_time_range}) "
    "| [Latency & 5xx](/grafana/d/surgeguard-latency?{__url_time_range}) "
    "| [Reliability & Chaos](/grafana/d/surgeguard-failure?{__url_time_range}) "
    "| [Overview](/grafana/d/surgeguard-overview?{__url_time_range}) |"
)


# ─── Panel builders ───────────────────────────────────────────────────────

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
    """Stat panel: color background, sparkline area, lastNotNull."""
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
    no_value: str = "—",
    w: int = 12,
    h: int = 8,
    y_min: float | None = None,
    y_soft_max: float | None = None,
    thresholds: list | None = None,
) -> dict:
    """Time series panel.
    Legend: list, bottom, NO Mean/Max/Last table.
    Tooltip: multi, sorted descending (shared crosshair set at dashboard level).
    """
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

    axis: dict = {}
    if y_min is not None:
        axis["axisPlacement"] = "auto"
        axis["scaleDistribution"] = {"type": "linear"}
        # Grafana field min/max
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

    panel: dict = {
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
    return panel


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
            "sortOrder": 1,  # severity
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


# ─── Dashboard wrapper ─────────────────────────────────────────────────────

def dashboard(
    uid: str,
    title: str,
    panels: list,
    description: str,
    has_origin_var: bool = True,
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
        "version": 3,
        "refresh": "10s",
        "time": {"from": "now-30m", "to": "now"},
        "editable": False,
        "graphTooltip": 1,  # shared crosshair
        "panels": _layout(panels),
        "templating": {"list": templating_list},
        "annotations": annotations,
    }


def _layout(panels: list) -> list:
    """Assign gridPos to each panel sequentially, respecting 24-col grid."""
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
#  1. OVERVIEW — surgeguard-overview
# ═══════════════════════════════════════════════════════════════════════════

OVERVIEW_PANELS = [
    # ── Header strip ────────────────────────────────────────────────────────
    header("SurgeGuard Overview — is the waiting room protecting your site?"),

    # ── Health strip (7 stat tiles, identical height 5) ─────────────────────
    #
    # Overall status: derived from a compound expression that yields 2/1/0.
    # 2 = Healthy  (all targets up, Redis up, worker leader, ≥1 healthy backend)
    # 1 = Degraded (any target down or <N backends healthy)
    # 0 = Down     (Redis down or no leader or 0 healthy backends)
    stat_mapped(
        "Overall Status",
        # healthy=2, degraded=1, down=0
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
        description=(
            "Compound health signal. HEALTHY = Redis up + worker leader + ≥1 backend + API up. "
            "DEGRADED = some backends failing. DOWN = Redis unavailable or no leader."
        ),
        w=4, h=5,
    ),
    stat(
        "People waiting",
        "max(surgeguard_queue_length) or vector(0)",
        unit="short",
        decimals=0,
        thresholds=[
            {"color": GREEN, "value": None},
            {"color": AMBER, "value": 1},
            {"color": RED,   "value": 100},   # QueueGrowing alert threshold
        ],
        no_value="0",
        description="Visitors currently in the FIFO queue waiting for an admission token.",
        w=4, h=5,
    ),
    stat(
        "Admitted & active",
        "max(surgeguard_admitted_active) or vector(0)",
        unit="short",
        decimals=0,
        thresholds=[{"color": GREEN, "value": None}],
        no_value="0",
        description="Visitors currently holding a valid admission token and browsing the site.",
        w=4, h=5,
    ),
    stat(
        "Admission rate",
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
        description="Origin backends passing active health checks. Red = 0, amber = partial.",
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
        description="Fraction of origin responses that are 5xx. Green <1%, amber <5%, red ≥5%.",
        w=4, h=5,
    ),
    stat(
        "Origin p95 latency",
        P95,
        unit="s",
        decimals=2,
        thresholds=[
            {"color": GREEN, "value": None},
            {"color": AMBER, "value": 0.5},
            {"color": RED,   "value": 1.0},
        ],
        no_value="No traffic",
        description="95th percentile response time at the origin. No traffic = idle (normal).",
        w=4, h=5,
    ),

    # ── Traffic & admission charts ───────────────────────────────────────────
    row("Traffic and admission"),
    ts(
        "Edge requests vs admitted to origin",
        [
            (EDGE_RPS, "Edge (nginx)"),
            (ORIGIN_RPS, "Admitted to origin"),
        ],
        unit="reqps",
        overrides=[
            _series_override("Edge (nginx)",       BLUE,  fill=10),
            _series_override("Admitted to origin", GREEN, fill=10),
        ],
        description="Total public edge traffic arriving at Nginx vs the subset admitted to origins.",
        y_min=0,
        w=12, h=8,
    ),
    ts(
        "Admission rate — measured vs target",
        [
            (ADMISSION_RATE, "Measured"),
            ("max(surgeguard_admission_rate_effective) or vector(0)", "Effective target"),
            ("max(surgeguard_admission_rate_configured) or vector(0)", "Configured target"),
        ],
        unit="reqps",
        overrides=[
            _series_override("Measured",           GREEN,  fill=14),
            _series_override("Effective target",   AMBER,  fill=0, dashed=True),
            _series_override("Configured target",  SLATE,  fill=0, dashed=True),
        ],
        description=(
            "How many tokens are being issued per second (solid line) vs the policy rate "
            "(dashed). Effective target drops when backends are unhealthy."
        ),
        y_min=0,
        w=12, h=8,
    ),

    # ── Queue charts ─────────────────────────────────────────────────────────
    row("Queue"),
    ts(
        "People waiting",
        [("max(surgeguard_queue_length) or vector(0)", "Waiting")],
        unit="short",
        overrides=[_series_override("Waiting", AMBER, fill=16)],
        description="Queue depth over time. A flat line near zero means the gate is keeping up.",
        y_min=0,
        y_soft_max=5,   # shows a calm flat line when idle; auto-scales under load
        w=12, h=8,
    ),
    ts(
        "Wait time (join → admission)",
        [
            (WAIT_P50, "p50 median"),
            (WAIT_P95, "p95"),
        ],
        unit="s",
        overrides=[
            _series_override("p50 median", GREEN, fill=10),
            _series_override("p95",        AMBER, fill=6),
        ],
        no_value="Not enough data yet",
        description="How long visitors wait from entering the queue until receiving a token.",
        y_min=0,
        w=12, h=8,
    ),

    # ── Latency & errors (COLLAPSED) ─────────────────────────────────────────
    row("Latency and errors", collapsed=True),
    ts(
        "Origin latency (p50 / p95 / p99)",
        [(P50, "p50"), (P95, "p95"), (P99, "p99")],
        unit="s",
        overrides=[
            _series_override("p50", GREEN,  fill=8),
            _series_override("p95", AMBER,  fill=6),
            _series_override("p99", PURPLE, fill=4),
        ],
        no_value="No traffic",
        description="Latency percentile curves for admitted origin requests.",
        y_min=0,
        w=12, h=8,
    ),
    ts(
        "5xx error ratio vs overload rejections",
        [
            (ERR_RATIO, "5xx ratio"),
            ("sum(rate(demo_overload_rejections_total[$rate_interval])) or vector(0)", "503 overload drops"),
        ],
        unit="percentunit",
        overrides=[
            _series_override("5xx ratio",         RED,  fill=10),
            _series_override("503 overload drops", AMBER, fill=6),
        ],
        description="Error fraction and explicit 503 overload drop rate side by side.",
        y_min=0,
        w=12, h=8,
    ),
    ts(
        "Token rejections by reason",
        [("sum by (reason) (rate(surgeguard_token_rejections_total[$rate_interval]))", "{{reason}}")],
        unit="reqps",
        stack=True,
        description="Security rejections at /internal/auth broken down by reason (expired, tampered, revoked).",
        y_min=0,
        w=12, h=8,
    ),
    ts(
        "Direct-bypass attempts (403 Forbidden)",
        [("sum(rate(demo_forbidden_total[$rate_interval])) or vector(0)", "403 blocked")],
        unit="reqps",
        overrides=[_series_override("403 blocked", RED, fill=8)],
        description="Requests without a valid X-Origin-Key header hitting origin directly, blocked by guard middleware.",
        y_min=0,
        w=12, h=8,
    ),

    # ── Platform health (COLLAPSED) ───────────────────────────────────────────
    row("Platform health", collapsed=True),
    scrape_status_grid(w=24, h=5),
    ts(
        "Redis ping latency (p50 / p95)",
        [
            ("histogram_quantile(0.50, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[$rate_interval])))", "p50"),
            ("histogram_quantile(0.95, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[$rate_interval])))", "p95"),
        ],
        unit="ms",
        overrides=[
            _series_override("p50", GREEN, fill=8),
            _series_override("p95", AMBER, fill=4),
        ],
        no_value="No data",
        description="Round-trip latency from worker to Redis in milliseconds.",
        y_min=0,
        w=12, h=8,
    ),
    ts(
        "Redis command throughput",
        [('sum(rate(redis_commands_total{job="redis"}[$rate_interval])) or vector(0)', "cmds/s")],
        unit="short",
        overrides=[_series_override("cmds/s", BLUE, fill=10)],
        description="Total Redis commands executed per second (reads, writes, ZSET ops).",
        y_min=0,
        w=12, h=8,
    ),
    ts(
        "Worker tick rate",
        [("sum(rate(surgeguard_worker_ticks_total[$rate_interval])) or vector(0)", "ticks/s")],
        unit="short",
        overrides=[_series_override("ticks/s", GREEN, fill=10)],
        description="How fast the admission worker is looping. Should be ~1/s at steady state.",
        y_min=0,
        w=12, h=8,
    ),
    alerts_panel(
        "Active alerts",
        description="Prometheus alert rules currently in firing or pending state.",
        w=12, h=8,
    ),
]

# ═══════════════════════════════════════════════════════════════════════════
#  2. EDGE & TRAFFIC — surgeguard-backends
# ═══════════════════════════════════════════════════════════════════════════

BACKENDS_PANELS = [
    header("Edge & Traffic — Nginx ingress, connection pools, and per-origin workload"),

    # Health strip (5 stats)
    stat(
        "Edge requests/s",
        EDGE_RPS,
        unit="reqps", decimals=1,
        thresholds=[{"color": BLUE, "value": None}],
        no_value="0",
        description="HTTP requests arriving at Nginx edge per second.",
        w=4, h=5,
    ),
    stat(
        "Active connections",
        "max(nginx_connections_active) or vector(0)",
        unit="short", decimals=0,
        thresholds=[{"color": GREEN, "value": None}],
        no_value="0",
        description="Currently open TCP connections in Nginx worker processes.",
        w=4, h=5,
    ),
    stat(
        "Nginx status",
        'max(nginx_up{job="nginx"}) or vector(0)',
        thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}],
        no_value="—",
        description="1 = Nginx is up and the exporter is reachable.",
        w=4, h=5,
    ),
    stat(
        "Healthy backends",
        "max(surgeguard_backends_healthy) or vector(0)",
        unit="short", decimals=0,
        thresholds=[
            {"color": RED, "value": None},
            {"color": AMBER, "value": 1},
            {"color": GREEN, "value": 2},
        ],
        no_value="0",
        description="Origin backends currently passing health probes.",
        w=4, h=5,
    ),
    stat(
        "Origin p95 latency",
        P95,
        unit="s", decimals=2,
        thresholds=[
            {"color": GREEN, "value": None},
            {"color": AMBER, "value": 0.5},
            {"color": RED,   "value": 1.0},
        ],
        no_value="No traffic",
        description="95th percentile execution time at the origin backend.",
        w=4, h=5,
    ),

    # Main charts
    row("Edge traffic"),
    ts(
        "Edge request rate",
        [(EDGE_RPS, "nginx rps")],
        unit="reqps",
        overrides=[_series_override("nginx rps", BLUE, fill=12)],
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
        description="Breakdown of TCP connection states inside Nginx workers.",
        y_min=0, w=12, h=8,
    ),

    row("Per-origin workload ($origin)"),
    ts(
        "Requests per origin",
        [('sum by (origin) (rate(demo_requests_total{origin=~"$origin"}[$rate_interval]))', "{{origin}}")],
        unit="reqps",
        stack=True,
        description="Admitted request load distributed across demo origin instances.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin p95 latency by instance",
        [('histogram_quantile(0.95, sum by (le, origin) (rate(demo_request_duration_seconds_bucket{origin=~"$origin"}[$rate_interval])))', "{{origin}} p95")],
        unit="s",
        no_value="No traffic",
        description="Execution latency at 95th percentile per origin. No traffic = idle.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "In-flight & pending requests by origin",
        [
            ('sum by (origin) (demo_inflight_requests{origin=~"$origin"})', "In-flight {{origin}}"),
            ('sum by (origin) (demo_pending_requests{origin=~"$origin"})', "Pending {{origin}}"),
        ],
        unit="short",
        description="Internal concurrency semaphore utilization per origin instance.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Overload rejections (503) by origin",
        [('sum by (origin) (rate(demo_overload_rejections_total{origin=~"$origin"}[$rate_interval]))', "{{origin}} 503 drops")],
        unit="reqps",
        overrides=[],
        description="503 drops when the origin concurrency semaphore is full.",
        y_min=0, w=12, h=8,
    ),

    row("Security", collapsed=True),
    ts(
        "Direct-bypass attempts (403)",
        [('sum by (origin) (rate(demo_forbidden_total{origin=~"$origin"}[$rate_interval]))', "blocked {{origin}}")],
        unit="reqps",
        overrides=[],
        description="Requests blocked by origin guard middleware (missing or invalid X-Origin-Key).",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Backend probe latency",
        [("max by (backend) (surgeguard_backend_check_latency_seconds)", "{{backend}}")],
        unit="s",
        no_value="No data",
        description="Round-trip latency of worker health probes to each origin.",
        y_min=0, w=12, h=8,
    ),
]

# ═══════════════════════════════════════════════════════════════════════════
#  3. QUEUE & TOKENS — surgeguard-queue
# ═══════════════════════════════════════════════════════════════════════════

QUEUE_PANELS = [
    header("Queue & Tokens — queue depth, admission velocity, token lifecycle"),

    stat("People waiting",    "max(surgeguard_queue_length) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1}, {"color": RED, "value": 100}],
         no_value="0", description="Visitors in the FIFO queue waiting for a token.", w=6, h=5),
    stat("Admitted & active", "max(surgeguard_admitted_active) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="0", description="Visitors with a valid token currently browsing.", w=6, h=5),
    stat("Admission rate",    ADMISSION_RATE,
         unit="reqps", decimals=1,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="0", description="Tokens issued per second (measured).", w=6, h=5),
    stat("Configured rate",   "max(surgeguard_admission_rate_configured) or vector(0)",
         unit="reqps", decimals=0,
         thresholds=[{"color": BLUE, "value": None}],
         no_value="—", description="Admission rate as configured in SurgeGuard settings.", w=6, h=5),

    row("Queue depth and admission velocity"),
    ts(
        "People waiting",
        [("max(surgeguard_queue_length) or vector(0)", "Waiting")],
        unit="short",
        overrides=[_series_override("Waiting", AMBER, fill=16)],
        description="Queue depth over time.",
        y_min=0, y_soft_max=5,
        w=12, h=8,
    ),
    ts(
        "Admission rate — measured vs target",
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
        y_min=0, w=12, h=8,
        description="Measured rate (solid) vs policy targets (dashed).",
    ),

    row("Wait time and join outcomes"),
    ts(
        "Queue wait time",
        [(WAIT_P50, "p50 median"), (WAIT_P95, "p95")],
        unit="s",
        overrides=[
            _series_override("p50 median", GREEN, fill=10),
            _series_override("p95",        AMBER, fill=6),
        ],
        no_value="Not enough data yet",
        description="Time from entering the queue until receiving a token.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Queue joins by mode",
        [("sum by (mode) (rate(surgeguard_queue_joins_total[$rate_interval]))", "{{mode}}")],
        unit="reqps",
        stack=True,
        description="Incoming visitor arrivals categorised by queue mode (queued vs direct).",
        y_min=0, w=12, h=8,
    ),

    row("Token lifecycle", collapsed=True),
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
        description="Visitors purged from queue because their heartbeat polling stopped.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Rate-limited join attempts",
        [("sum by (bucket) (rate(surgeguard_rate_limited_total[$rate_interval]))", "{{bucket}}")],
        unit="reqps",
        overrides=[],
        description="Join requests throttled by the application-level rate limiter.",
        y_min=0, w=12, h=8,
    ),
]

# ═══════════════════════════════════════════════════════════════════════════
#  4. INFRASTRUCTURE — surgeguard-resources
# ═══════════════════════════════════════════════════════════════════════════

RESOURCES_PANELS = [
    header("Infrastructure — Redis, admission worker, and platform dependencies"),

    stat("Redis status",    'max(redis_up{job="redis"}) or vector(0)',
         thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}],
         no_value="—", description="1 = Redis is up and the exporter is reachable.", w=6, h=5),
    stat("Redis memory",    'max(redis_memory_used_bytes{job="redis"}) or vector(0)',
         unit="bytes", decimals=1,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="—", description="Memory allocated by Redis for data structures.", w=6, h=5),
    stat("Worker leader",   "max(surgeguard_worker_is_leader) or vector(0)",
         thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}],
         no_value="—", description="1 = A worker holds the distributed leader lock.", w=6, h=5),
    stat("Seconds since tick",
         "time() - max(surgeguard_worker_last_tick_timestamp_seconds)",
         unit="s", decimals=0,
         thresholds=[
             {"color": GREEN, "value": None},
             {"color": AMBER, "value": 5},
             {"color": RED,   "value": 15},
         ],
         no_value="—", description="Age of last worker tick. Red ≥15 s = worker may be stuck.", w=6, h=5),

    row("Redis"),
    ts(
        "Redis memory vs ceiling",
        [
            ('max(redis_memory_used_bytes{job="redis"}) or vector(0)',     "Used"),
            ('max(redis_memory_max_bytes{job="redis"}) or vector(0)',      "Max (maxmemory)"),
        ],
        unit="bytes",
        overrides=[
            _series_override("Used",            BLUE,  fill=12),
            _series_override("Max (maxmemory)", RED,   fill=0, dashed=True),
        ],
        description="Redis memory usage vs maxmemory ceiling.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Redis command throughput",
        [('sum(rate(redis_commands_total{job="redis"}[$rate_interval])) or vector(0)', "cmds/s")],
        unit="short",
        overrides=[_series_override("cmds/s", BLUE, fill=12)],
        description="Redis operations per second (all command types).",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Redis ping latency (p50 / p95)",
        [
            ("histogram_quantile(0.50, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[$rate_interval])))", "p50"),
            ("histogram_quantile(0.95, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[$rate_interval])))", "p95"),
        ],
        unit="ms",
        overrides=[
            _series_override("p50", GREEN, fill=8),
            _series_override("p95", AMBER, fill=4),
        ],
        no_value="No data",
        description="Round-trip latency from admission worker to Redis.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Redis connected clients",
        [('max(redis_connected_clients{job="redis"}) or vector(0)', "clients")],
        unit="short",
        overrides=[_series_override("clients", GREEN, fill=8)],
        description="Open client connections to Redis.",
        y_min=0, w=12, h=8,
    ),

    row("Admission worker"),
    ts(
        "Worker tick rate",
        [("sum(rate(surgeguard_worker_ticks_total[$rate_interval])) or vector(0)", "ticks/s")],
        unit="short",
        overrides=[_series_override("ticks/s", GREEN, fill=12)],
        description="Worker loop iterations per second. Should be ~1/s at steady state.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Seconds since last tick",
        [("time() - max(surgeguard_worker_last_tick_timestamp_seconds)", "staleness (s)")],
        unit="s",
        overrides=[_series_override("staleness (s)", AMBER, fill=10)],
        description="Increases if the worker loop is stuck or the worker process is down.",
        y_min=0,
        thresholds=[{"color": AMBER, "value": 5}, {"color": RED, "value": 15}],
        w=12, h=8,
    ),
    ts(
        "Backend probe latency",
        [("max by (backend) (surgeguard_backend_check_latency_seconds)", "{{backend}}")],
        unit="s",
        no_value="No data",
        description="Health probe round-trip latency per configured origin.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Healthy vs total backends",
        [
            ("max(surgeguard_backends_healthy) or vector(0)", "Healthy"),
            ("max(surgeguard_backends_total) or vector(0)",   "Total"),
        ],
        unit="short",
        overrides=[
            _series_override("Healthy", GREEN, fill=10),
            _series_override("Total",   SLATE, fill=0, dashed=True),
        ],
        description="Count of healthy backends vs total configured backends.",
        y_min=0, w=12, h=8,
    ),
]

# ═══════════════════════════════════════════════════════════════════════════
#  5. LATENCY & 5xx — surgeguard-latency
# ═══════════════════════════════════════════════════════════════════════════

LATENCY_PANELS = [
    header("Latency & 5xx — origin response times, error rates, and status codes"),

    stat("p50 latency", P50, unit="s", decimals=3,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 0.3}, {"color": RED, "value": 0.8}],
         no_value="No traffic", description="Median origin response time.", w=6, h=5),
    stat("p95 latency", P95, unit="s", decimals=3,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 0.5}, {"color": RED, "value": 1.0}],
         no_value="No traffic", description="95th percentile origin response time.", w=6, h=5),
    stat("p99 latency", P99, unit="s", decimals=3,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1.0}, {"color": RED, "value": 2.0}],
         no_value="No traffic", description="99th percentile (tail) latency.", w=6, h=5),
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
        no_value="No traffic",
        description="Full latency percentile profile for admitted origin requests.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin responses by HTTP status",
        [('sum by (status) (rate(demo_requests_total{origin=~"$origin"}[$rate_interval]))', "HTTP {{status}}")],
        unit="reqps",
        stack=True,
        description="HTTP response code distribution from origin instances.",
        y_min=0, w=12, h=8,
    ),

    row("5xx and errors"),
    ts(
        "5xx error ratio",
        [(ERR_RATIO, "5xx ratio")],
        unit="percentunit",
        overrides=[_series_override("5xx ratio", RED, fill=12)],
        description="Fraction of origin requests returning server errors.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Overload rejections (503)",
        [('sum by (origin) (rate(demo_overload_rejections_total{origin=~"$origin"}[$rate_interval]))', "{{origin}} 503 drops")],
        unit="reqps",
        description="503 drops when origin concurrency semaphore is exhausted.",
        y_min=0, w=12, h=8,
    ),

    row("API latency", collapsed=True),
    ts(
        "SurgeGuard API p95 latency by route",
        [("histogram_quantile(0.95, sum by (le, route) (rate(surgeguard_http_request_duration_seconds_bucket[$rate_interval])))", "{{route}}")],
        unit="s",
        no_value="No data",
        description="95th percentile processing time per SurgeGuard API endpoint.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "SurgeGuard API responses by status",
        [("sum by (status) (rate(surgeguard_http_requests_total[$rate_interval]))", "{{status}}")],
        unit="reqps",
        stack=True,
        description="Response status code mix for SurgeGuard internal API routes.",
        y_min=0, w=12, h=8,
    ),
]

# ═══════════════════════════════════════════════════════════════════════════
#  6. RELIABILITY & CHAOS — surgeguard-failure
# ═══════════════════════════════════════════════════════════════════════════

FAILURE_PANELS = [
    header("Reliability & Chaos — fail-closed behavior, service availability, degradation"),

    stat_mapped("API",     'max(up{job="surgeguard-api"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="SurgeGuard API scrape health.", w=4, h=5),
    stat_mapped("Worker",  'max(up{job="admission-worker"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="Admission worker scrape health.", w=4, h=5),
    stat_mapped("Redis",   'max(redis_up{job="redis"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="Redis exporter health.", w=4, h=5),
    stat_mapped("Nginx",   'max(nginx_up{job="nginx"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="Nginx exporter health.", w=4, h=5),
    stat("Healthy backends", "max(surgeguard_backends_healthy) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": RED, "value": None}, {"color": AMBER, "value": 1}, {"color": GREEN, "value": 2}],
         no_value="0", description="Origin backends passing active health probes.", w=4, h=5),
    stat("Worker leader", "max(surgeguard_worker_is_leader) or vector(0)",
         thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}],
         no_value="—", description="1 = A worker holds the leader lock. 0 = No admissions.", w=4, h=5),

    row("Service availability"),
    ts(
        "Service availability (1 = up, 0 = down)",
        [
            ('max(up{job="surgeguard-api"}) or vector(0)',                "SurgeGuard API"),
            ('max(up{job="admission-worker"}) or vector(0)',              "Admission worker"),
            ('max(redis_up{job="redis"}) or vector(0)',                   "Redis (exporter)"),
            ('max(surgeguard_redis_up{job="admission-worker"}) or vector(0)', "Redis (worker ping)"),
            ('max(nginx_up{job="nginx"}) or vector(0)',                   "Nginx"),
        ],
        unit="short",
        description="Binary up/down signal for every cluster service.",
        y_min=0, y_soft_max=1.1,
        w=12, h=8,
    ),
    ts(
        "Configured vs healthy backends",
        [
            ("max(surgeguard_backends_healthy) or vector(0)", "Healthy"),
            ("max(surgeguard_backends_total) or vector(0)",   "Total"),
        ],
        unit="short",
        overrides=[
            _series_override("Healthy", GREEN, fill=10),
            _series_override("Total",   SLATE, fill=0, dashed=True),
        ],
        description="Live vs configured backend count — gap indicates backend failures.",
        y_min=0, w=12, h=8,
    ),

    row("Fail-closed and degradation"),
    ts(
        "Fail-closed auth decisions",
        [("sum(rate(surgeguard_auth_fail_closed_total[$rate_interval])) or vector(0)", "fail-closed/s")],
        unit="reqps",
        overrides=[_series_override("fail-closed/s", RED, fill=12)],
        description="Requests refused by Nginx because the auth endpoint was unreachable (fail-closed security).",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Admission paused (auto & manual)",
        [("max by (kind) (surgeguard_admission_paused)", "{{kind}}")],
        unit="short",
        description="1 when admission is paused. Kind=auto means all backends were down.",
        y_min=0, y_soft_max=1.1,
        w=12, h=8,
    ),
    ts(
        "Admission loop failures by reason",
        [("sum by (reason) (rate(surgeguard_admission_failures_total[$rate_interval]))", "{{reason}}")],
        unit="reqps",
        stack=True,
        description="Exceptions or timeouts inside the worker admission loop.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin 5xx error ratio",
        [(ERR_RATIO, "5xx ratio")],
        unit="percentunit",
        overrides=[_series_override("5xx ratio", RED, fill=12)],
        description="Fraction of admitted origin requests returning server errors.",
        y_min=0, w=12, h=8,
    ),

    row("Active alerts", collapsed=True),
    alerts_panel(
        "Firing & pending alert rules",
        description="Prometheus alert rules currently in firing or pending state.",
        w=24, h=8,
    ),
]

# ═══════════════════════════════════════════════════════════════════════════
#  Dashboard registry (UIDs unchanged)
# ═══════════════════════════════════════════════════════════════════════════

DASHBOARDS = {
    "surgeguard-overview": dashboard(
        "surgeguard-overview",
        "SurgeGuard · Overview",
        OVERVIEW_PANELS,
        "Top-level health overview of SurgeGuard: queue, admission, backends, and platform.",
        has_origin_var=True,
    ),
    "surgeguard-backends": dashboard(
        "surgeguard-backends",
        "SurgeGuard · Edge & Traffic",
        BACKENDS_PANELS,
        "Nginx edge traffic, connection pools, and per-origin request workload.",
        has_origin_var=True,
    ),
    "surgeguard-queue": dashboard(
        "surgeguard-queue",
        "SurgeGuard · Queue & Tokens",
        QUEUE_PANELS,
        "Queue depth, admission velocity, wait times, and token lifecycle.",
        has_origin_var=False,
    ),
    "surgeguard-resources": dashboard(
        "surgeguard-resources",
        "SurgeGuard · Infrastructure",
        RESOURCES_PANELS,
        "Redis memory and throughput, worker heartbeat, and backend probe latency.",
        has_origin_var=False,
    ),
    "surgeguard-latency": dashboard(
        "surgeguard-latency",
        "SurgeGuard · Latency & 5xx",
        LATENCY_PANELS,
        "Latency percentile curves, error rates, and HTTP response status codes.",
        has_origin_var=True,
    ),
    "surgeguard-failure": dashboard(
        "surgeguard-failure",
        "SurgeGuard · Reliability & Chaos",
        FAILURE_PANELS,
        "Fail-closed behavior, service availability grid, and degradation signals.",
        has_origin_var=False,
    ),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, board in DASHBOARDS.items():
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(board, indent=2) + "\n")
        print(f"wrote {path.name}  ({len(board['panels'])} panels)")
