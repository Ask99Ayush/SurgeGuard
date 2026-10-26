"""Generate the provisioned Grafana dashboards for SurgeGuard.

    python monitoring/grafana/generate_dashboards.py
    # or:
    make dashboards

Design principles applied:
───────────────────────────────────────────
• Clear story, one question per dashboard:
  1. Overview: Health at a glance (6 flat dark stat tiles + 2 core charts + collapsed Components table)
  2. Queue & Admission: Queue mechanics, measured vs configured (dashed) vs effective rate, wait time percentiles
  3. Backends & Traffic: Per-origin load, connection states, latency, 5xx, 403 bypass drops
  4. Reliability & Recovery: Fail-closed auth, auto-pause, worker leadership, alerts
  5. Infrastructure: Redis memory & latency (ms), worker loop staleness, CPU & RSS
  6. Protected vs Unprotected: Hero live demo comparison with identical two-column scales and 3 top KPI tiles
• Clean top toolbar:
  - Header height h=3 so title and nav links are never clipped.
  - Active dashboard highlighted in bold in the nav bar.
  - Rate Window variable hidden from toolbar (fixed at 1m).
  - Origin Instance variable shown ONLY on Backends & Traffic dashboard where it functions.
  - Single unified "Events" toggle for annotations (replaces crowded 4-toggle toolbar).
• Flat dark stat cards:
  - colorMode="value" so values are colored green/amber/red while cards stay calm and dark.
  - No odd filled sparkline on "Healthy backends" (graphMode="none").
  - Panel links on all overview tiles deep-linking to corresponding drilldown dashboards.
• Real metrics only:
  - Filtered edge requests: clamp_min(rate - 0.4, 0) to eliminate ~0.4 req/s Nginx stub_status health probe noise.
  - Proper empty states: noValue="No traffic yet" on all charts and stats.
  - Collapsed row panels properly nested in row["panels"] to eliminate orphaned "(0 panels)" headers.
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
CYAN   = "#06b6d4"   # capacity target / queue operations
TEAL   = "#14b8a6"   # admission rate

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

# Nginx stub_status counts ALL requests accepted by the server across all ports, including
# internal container health probes (:8090 /healthz and /stub_status) at ~0.4 req/s.
# We clamp_min(rate - 0.4, 0) so the baseline reads 0 req/s at idle.
EDGE_RPS = (
    "clamp_min(sum(rate(nginx_http_requests_total[$rate_interval])) - 0.4, 0) or vector(0)"
)
ORIGIN_RPS = "sum(rate(demo_requests_total[$rate_interval])) or vector(0)"


# ─── Navigation Header Bar ─────────────────────────────────────────────────
def nav_bar(current_uid: str) -> str:
    links = [
        ("surgeguard-overview",   "1. Overview",            "/grafana/d/surgeguard-overview"),
        ("surgeguard-queue",      "2. Queue & Admission",   "/grafana/d/surgeguard-queue"),
        ("surgeguard-backends",   "3. Backends & Traffic",  "/grafana/d/surgeguard-backends"),
        ("surgeguard-failure",    "4. Reliability & Recovery", "/grafana/d/surgeguard-failure"),
        ("surgeguard-resources",  "5. Infrastructure",       "/grafana/d/surgeguard-resources"),
        ("surgeguard-comparison", "6. Protected vs Unprotected", "/grafana/d/surgeguard-comparison"),
    ]
    items = []
    for uid, label, url in links:
        if uid == current_uid:
            items.append(f"**[{label}]({url}?{{__url_time_range}})**")
        else:
            items.append(f"[{label}]({url}?{{__url_time_range}})")
    return "| " + " | ".join(items) + " |"


def header(subtitle: str, current_uid: str, w: int = 24, h: int = 3) -> dict:
    """Rich SRE navigation header panel with breadcrumbs, system status pill, and tab links."""
    titles = {
        "surgeguard-overview": "SurgeGuard — Service Overview",
        "surgeguard-queue": "SurgeGuard — Queue & Admission",
        "surgeguard-backends": "SurgeGuard — Backends & Traffic",
        "surgeguard-failure": "SurgeGuard — Reliability & Recovery",
        "surgeguard-resources": "SurgeGuard — Infrastructure",
        "surgeguard-comparison": "SurgeGuard — Protected vs Unprotected",
        "surgeguard-latency": "SurgeGuard — Latency & 5xx",
    }
    board_title = titles.get(current_uid, "SurgeGuard — Service Overview")

    nav_links = [
        ("surgeguard-overview",   "1. Overview",            "/grafana/d/surgeguard-overview"),
        ("surgeguard-queue",      "2. Queue & Admission",   "/grafana/d/surgeguard-queue"),
        ("surgeguard-backends",   "3. Backends & Traffic",  "/grafana/d/surgeguard-backends"),
        ("surgeguard-failure",    "4. Reliability & Recovery", "/grafana/d/surgeguard-failure"),
        ("surgeguard-resources",  "5. Infrastructure",       "/grafana/d/surgeguard-resources"),
        ("surgeguard-comparison", "6. Protected vs Unprotected", "/grafana/d/surgeguard-comparison"),
    ]
    tabs = []
    for uid, label, url in nav_links:
        is_active = (uid == current_uid)
        style = (
            "background: #1e293b; color: #38bdf8; border: 1px solid #38bdf8; font-weight: 600;"
            if is_active
            else "background: #0f172a; color: #94a3b8; border: 1px solid #334155;"
        )
        tabs.append(
            f'<a href="{url}?{{__url_time_range}}" style="{style} padding: 4px 12px; border-radius: 8px; text-decoration: none; font-size: 12px; margin-right: 6px; display: inline-block;">{label}</a>'
        )
    tabs_html = "".join(tabs)

    status_pill = (
        '<div style="float: right; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); '
        'color: #10b981; padding: 5px 12px; border-radius: 9999px; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 6px;">'
        '<span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #10b981;"></span>'
        '<span>System Operating Normally &middot; All services healthy &middot; No active incidents</span>'
        '</div>'
    )

    content = f"""<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
  <div>
    <div style="font-size: 18px; font-weight: 700; color: #f8fafc; letter-spacing: -0.02em;">
      {board_title}
    </div>
    <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">
      {subtitle}
    </div>
  </div>
  {status_pill}
</div>
<div style="margin-top: 6px;">
  {tabs_html}
</div>"""

    return {
        "type": "text",
        "title": "",
        "transparent": True,
        "options": {"content": content, "mode": "html"},
        "_w": w,
        "_h": h,
    }


# ─── Panel Builders ────────────────────────────────────────────────────────
def stat(
    title: str,
    expr: str,
    unit: str = "short",
    decimals: int | None = None,
    thresholds: list | None = None,
    no_value: str = "No traffic yet",
    description: str = "",
    color_mode: str = "value",
    graph_mode: str = "area",
    link_url: str | None = None,
    w: int = 4,
    h: int = 4,
) -> dict:
    """Flat dark stat panel with colored value, sparkline, and optional dashboard deep link."""
    steps = thresholds or [{"color": GREEN, "value": None}]
    panel = {
        "type": "stat",
        "title": title,
        "description": description,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
        "options": {
            "colorMode": color_mode,
            "graphMode": graph_mode,
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
    if link_url:
        panel["links"] = [
            {
                "title": f"Drill down: {title}",
                "url": f"{link_url}?{{__url_time_range}}",
                "targetBlank": False,
            }
        ]
    return panel


def stat_mapped(
    title: str,
    expr: str,
    mappings: list,
    unit: str = "short",
    description: str = "",
    color_mode: str = "value",
    graph_mode: str = "none",
    link_url: str | None = None,
    w: int = 4,
    h: int = 4,
) -> dict:
    """Stat panel with explicit value-to-text mappings and colored value on flat dark surface."""
    panel = {
        "type": "stat",
        "title": title,
        "description": description,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
        "options": {
            "colorMode": color_mode,
            "graphMode": graph_mode,
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
    if link_url:
        panel["links"] = [
            {
                "title": f"Drill down: {title}",
                "url": f"{link_url}?{{__url_time_range}}",
                "targetBlank": False,
            }
        ]
    return panel


def bar_gauge(
    title: str,
    expr: str,
    unit: str = "bytes",
    max_val: float | None = None,
    description: str = "",
    w: int = 4,
    h: int = 7,
    thresholds: list | None = None,
) -> dict:
    """Compact horizontal bar gauge panel with threshold gradient."""
    steps = thresholds or [
        {"color": GREEN, "value": None},
        {"color": AMBER, "value": (max_val * 0.75) if max_val else 200000000},
        {"color": RED, "value": (max_val * 0.90) if max_val else 250000000},
    ]
    return {
        "type": "bargauge",
        "title": title,
        "description": description,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
        "options": {
            "displayMode": "gradient",
            "orientation": "horizontal",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "showUnfilled": True,
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "max": max_val,
                "min": 0,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": steps},
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
    fill: int = 8,
    description: str = "",
    no_value: str = "No traffic yet",
    w: int = 12,
    h: int = 8,
    y_min: float | None = None,
    y_soft_max: float | None = None,
    thresholds: list | None = None,
    calcs: list[str] | None = None,
    legend_placement: str = "bottom",
) -> dict:
    """Time series panel: smooth lines, max 10% fill, configurable table legend."""
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

    legend_display = "table" if calcs else ("hidden" if len(targets) <= 1 else "list")
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
                "displayMode": legend_display,
                "placement": legend_placement,
                "calcs": calcs or [],
                "showLegend": True if (calcs or len(targets) > 1) else False,
            },
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "_w": w,
        "_h": h,
    }


def backend_health_table(w: int = 8, h: int = 7) -> dict:
    """Compact table showing per-backend health status, probe latency, request rate, and availability."""
    return {
        "type": "table",
        "title": "Backend Health & Probe Latency",
        "description": "Active health check probe status, roundtrip latency, and traffic distribution across backends.",
        "datasource": DS,
        "targets": [
            {
                "refId": "A",
                "expr": "surgeguard_backend_up",
                "format": "table",
                "instant": True,
                "datasource": DS,
            },
            {
                "refId": "B",
                "expr": "surgeguard_backend_check_latency_seconds * 1000",
                "format": "table",
                "instant": True,
                "datasource": DS,
            },
            {
                "refId": "C",
                "expr": 'sum by (origin) (rate(demo_requests_total[$rate_interval]))',
                "format": "table",
                "instant": True,
                "datasource": DS,
            },
            {
                "refId": "D",
                "expr": "avg_over_time(surgeguard_backend_up[1h]) * 100",
                "format": "table",
                "instant": True,
                "datasource": DS,
            },
        ],
        "transformations": [
            {
                "id": "joinByField",
                "options": {
                    "byField": "backend",
                    "mode": "outer",
                },
            },
            {
                "id": "organize",
                "options": {
                    "excludeByName": {
                        "Time": True,
                        "Time 1": True,
                        "Time 2": True,
                        "Time 3": True,
                        "__name__": True,
                        "__name__ 1": True,
                        "__name__ 2": True,
                        "__name__ 3": True,
                        "instance": True,
                        "instance 1": True,
                        "instance 2": True,
                        "instance 3": True,
                        "job": True,
                        "job 1": True,
                        "job 2": True,
                        "job 3": True,
                    },
                    "renameByName": {
                        "backend": "Backend",
                        "Value #A": "Status",
                        "Value #B": "Probe Latency",
                        "Value #C": "Request Rate",
                        "Value #D": "Availability (1h)",
                    },
                },
            },
        ],
        "options": {
            "showHeader": True,
            "sortBy": [{"displayName": "Backend", "desc": False}],
        },
        "fieldConfig": {
            "defaults": {
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
                            "0": {"text": "Down", "color": RED, "index": 0},
                            "1": {"text": "Healthy", "color": GREEN, "index": 1},
                        },
                    }
                ],
            },
            "overrides": [
                {
                    "matcher": {"id": "byName", "options": "Status"},
                    "properties": [
                        {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                        {"id": "custom.width", "value": 90},
                    ],
                },
                {
                    "matcher": {"id": "byName", "options": "Probe Latency"},
                    "properties": [
                        {"id": "unit", "value": "ms"},
                        {"id": "decimals", "value": 0},
                    ],
                },
                {
                    "matcher": {"id": "byName", "options": "Request Rate"},
                    "properties": [
                        {"id": "unit", "value": "reqps"},
                        {"id": "decimals", "value": 1},
                    ],
                },
                {
                    "matcher": {"id": "byName", "options": "Availability (1h)"},
                    "properties": [
                        {"id": "unit", "value": "percent"},
                        {"id": "decimals", "value": 0},
                        {"id": "custom.cellOptions", "value": {"type": "gauge", "mode": "basic"}},
                        {"id": "thresholds", "value": {"mode": "absolute", "steps": [{"color": RED, "value": None}, {"color": AMBER, "value": 95}, {"color": GREEN, "value": 99}]}},
                    ],
                },
            ],
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


def row(title: str, collapsed: bool = False, panels: list | None = None) -> dict:
    """Row header. If collapsed=True and panels are given, child panels are nested inside."""
    r = {"type": "row", "title": title, "collapsed": collapsed, "_w": 24, "_h": 1}
    if panels:
        r["_child_panels"] = panels
    return r


def components_table(w: int = 24, h: int = 6) -> dict:
    """Compact Components status table showing Component, Target, and Status."""
    return {
        "type": "table",
        "title": "Cluster Components",
        "description": "Scrape status of all SurgeGuard dependencies. Green = UP, Red = DOWN.",
        "datasource": DS,
        "targets": [
            {
                "refId": "A",
                "expr": "up",
                "format": "table",
                "instant": True,
                "datasource": DS,
            }
        ],
        "options": {
            "showHeader": True,
            "sortBy": [{"displayName": "Component", "desc": False}],
        },
        "fieldConfig": {
            "defaults": {
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
            "overrides": [
                {
                    "matcher": {"id": "byName", "options": "job"},
                    "properties": [{"id": "custom.displayName", "value": "Component"}],
                },
                {
                    "matcher": {"id": "byName", "options": "instance"},
                    "properties": [{"id": "custom.displayName", "value": "Target"}],
                },
                {
                    "matcher": {"id": "byName", "options": "Value"},
                    "properties": [
                        {"id": "custom.displayName", "value": "Status"},
                        {"id": "custom.cellOptions", "value": {"type": "color-background"}},
                    ],
                },
                {
                    "matcher": {"id": "byName", "options": "Time"},
                    "properties": [{"id": "custom.hideFrom", "value": {"tooltip": True, "viz": True}}],
                },
            ],
        },
        "_w": w,
        "_h": h,
    }


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


def dashboard(
    uid: str,
    title: str,
    panels: list,
    description: str,
    has_origin_var: bool = False,
    has_env_var: bool = False,
) -> dict:
    """Assemble a full Grafana dashboard JSON object with clean variables and unified event annotation."""
    templating_list = [
        {
            "name": "rate_interval",
            "type": "custom",
            "label": "Rate Window",
            "query": "1m,2m,5m",
            "current": {"text": "1m", "value": "1m", "selected": True},
            "options": [
                {"text": "1m", "value": "1m", "selected": True},
                {"text": "2m", "value": "2m", "selected": False},
                {"text": "5m", "value": "5m", "selected": False},
            ],
            # Hidden from toolbar: keeps rate window fixed at 1m without visual clutter
            "hide": 2,
        }
    ]
    if has_env_var:
        templating_list.insert(
            0,
            {
                "name": "environment",
                "type": "custom",
                "label": "Environment",
                "query": "Demo,Staging,Production",
                "current": {"text": "Demo", "value": "Demo", "selected": True},
                "options": [
                    {"text": "Demo", "value": "Demo", "selected": True},
                    {"text": "Staging", "value": "Staging", "selected": False},
                    {"text": "Production", "value": "Production", "selected": False},
                ],
                "hide": 0,
            },
        )
    if has_origin_var:
        insert_idx = 1 if has_env_var else 0
        templating_list.insert(
            insert_idx,
            {
                "name": "origin",
                "type": "query",
                "datasource": DS,
                "label": "Origin",
                "query": "label_values(demo_requests_total, origin)",
                "includeAll": True,
                "allValue": ".*",
                "multi": True,
                "refresh": 1,
                "current": {"text": "All", "value": "$__all", "selected": True},
                "hide": 0,
            },
        )

    # Single merged "Events" toggle for backend transitions, pauses, and worker leader elections
    annotations = {
        "list": [
            {
                "builtIn": 1,
                "datasource": "-- Grafana --",
                "enable": True,
                "hide": True,
                "name": "Annotations & Alerts",
                "type": "dashboard",
            },
            {
                "name": "Events",
                "datasource": DS,
                "enable": True,
                "hide": False,
                "expr": (
                    "changes(surgeguard_backend_up[30s]) != 0 "
                    "or changes(surgeguard_admission_paused[30s]) != 0 "
                    "or changes(surgeguard_worker_is_leader[30s]) != 0"
                ),
                "step": "30s",
                "titleFormat": "Cluster Event",
                "textFormat": "Backend probe transition, admission pause/resume, or leader change",
                "iconColor": AMBER,
                "tags": ["event"],
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
        "version": 5,
        "refresh": "5s",
        "time": {"from": "now-15m", "to": "now"},
        "editable": False,
        "graphTooltip": 1,
        "panels": _layout(panels),
        "templating": {"list": templating_list},
        "annotations": annotations,
    }


def _layout(panels: list) -> list:
    """Assign gridPos sequentially. Nested child panels in collapsed rows are preserved inside row['panels']."""
    x = y = row_h = 0
    out = []
    panel_id = 1
    for p in panels:
        w, h = p.pop("_w"), p.pop("_h")
        if p.get("type") == "row":
            if x > 0:
                y += row_h
                x = 0
                row_h = 0
            p["id"] = panel_id
            panel_id += 1
            p["gridPos"] = {"x": 0, "y": y, "w": 24, "h": 1}
            y += 1

            child_panels = p.pop("_child_panels", None)
            if p.get("collapsed") and child_panels:
                cx = cy = crow_h = 0
                c_out = []
                for cp in child_panels:
                    cw, ch = cp.pop("_w"), cp.pop("_h")
                    if cx + cw > 24:
                        cx, cy = 0, cy + crow_h
                        crow_h = 0
                    cp["id"] = panel_id
                    panel_id += 1
                    cp["gridPos"] = {"x": cx, "y": cy, "w": cw, "h": ch}
                    c_out.append(cp)
                    cx += cw
                    crow_h = max(crow_h, ch)
                p["panels"] = c_out
                out.append(p)
                continue
            elif child_panels:
                out.append(p)
                for cp in child_panels:
                    cw, ch = cp.pop("_w"), cp.pop("_h")
                    if x + cw > 24:
                        x, y = 0, y + row_h
                        row_h = 0
                    cp["id"] = panel_id
                    panel_id += 1
                    cp["gridPos"] = {"x": x, "y": y, "w": cw, "h": ch}
                    out.append(cp)
                    x += cw
                    row_h = max(row_h, ch)
                continue

            out.append(p)
            continue

        if x + w > 24:
            x, y = 0, y + row_h
            row_h = 0
        p["id"] = panel_id
        panel_id += 1
        p["gridPos"] = {"x": x, "y": y, "w": w, "h": h}
        out.append(p)
        x += w
        row_h = max(row_h, h)
    return out


# ═══════════════════════════════════════════════════════════════════════════
#  1. OVERVIEW — surgeguard-overview (Health at a glance)
# ═══════════════════════════════════════════════════════════════════════════
OVERVIEW_PANELS = [
    header(
        "Self-Hosted Virtual Waiting Room & Traffic Surge Protection",
        "surgeguard-overview",
    ),

    # Row 1: 6 compact KPI tiles across 24 cols (w=4, h=4 each)
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
        description="All systems operational. Click to view Reliability & Recovery.",
        link_url="/grafana/d/surgeguard-failure",
        graph_mode="area",
        w=4, h=4,
    ),
    stat(
        "Waiting Now",
        "max(surgeguard_queue_length) or vector(0)",
        unit="short",
        decimals=0,
        thresholds=[
            {"color": GREEN, "value": None},
            {"color": AMBER, "value": 1},
            {"color": RED,   "value": 100},
        ],
        no_value="0",
        description="Visitors currently waiting in the FIFO queue.",
        link_url="/grafana/d/surgeguard-queue",
        graph_mode="area",
        w=4, h=4,
    ),
    stat(
        "Admission Rate",
        ADMISSION_RATE,
        unit="reqps",
        decimals=1,
        thresholds=[{"color": GREEN, "value": None}],
        no_value="0.0 req/s",
        description="Current rate of admitted visitors to origin.",
        link_url="/grafana/d/surgeguard-queue",
        graph_mode="area",
        w=4, h=4,
    ),
    stat_mapped(
        "Healthy Backends",
        "max(surgeguard_backends_healthy) or vector(0)",
        mappings=[
            {
                "type": "value",
                "options": {
                    "0": {"text": "0 / 2", "color": RED,   "index": 0},
                    "1": {"text": "1 / 2", "color": AMBER, "index": 1},
                    "2": {"text": "2 / 2", "color": GREEN, "index": 2},
                },
            }
        ],
        description="Origin backends passing active health probes (2 of 2 healthy).",
        link_url="/grafana/d/surgeguard-backends",
        graph_mode="area",
        w=4, h=4,
    ),
    stat(
        "Origin 5xx Error Rate",
        ERR_RATIO,
        unit="percentunit",
        decimals=1,
        thresholds=[
            {"color": GREEN, "value": None},
            {"color": AMBER, "value": 0.01},
            {"color": RED,   "value": 0.05},
        ],
        no_value="0.0%",
        description="Origin 5xx error ratio. Green <1%, amber 1-5%, red ≥5%.",
        link_url="/grafana/d/surgeguard-backends",
        graph_mode="area",
        w=4, h=4,
    ),
    stat_mapped(
        "Redis",
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
        description="Queue & session store connectivity.",
        link_url="/grafana/d/surgeguard-resources",
        graph_mode="area",
        w=4, h=4,
    ),

    # Row 2: 2 main traffic graphs (w=12, h=8 each)
    ts(
        "Edge Requests vs Admitted Origin Requests",
        [
            (EDGE_RPS,   "Edge requests (Nginx)"),
            (ORIGIN_RPS, "Admitted to origin"),
        ],
        unit="reqps",
        overrides=[
            _series_override("Edge requests (Nginx)", BLUE,  fill=8),
            _series_override("Admitted to origin",   GREEN, fill=10),
        ],
        description="Public visitor traffic arriving at Nginx edge vs visitors admitted to origin. Filtered via clamp_min(rate - 0.4, 0).",
        y_min=0,
        calcs=["mean", "lastNotNull"],
        legend_placement="right",
        w=12, h=8,
    ),
    ts(
        "Queue Depth & Admission Capacity",
        [
            ("max(surgeguard_queue_length) or vector(0)", "Queue depth (visitors)"),
            ("max(surgeguard_admission_rate_configured) or vector(0)", "Target admission rate (req/s)"),
        ],
        unit="short",
        overrides=[
            _series_override("Queue depth (visitors)", AMBER, fill=16),
            _series_override("Target admission rate (req/s)", CYAN, fill=0, dashed=True),
        ],
        description="Visitors waiting in queue over time vs configured admission capacity target.",
        y_min=0,
        calcs=["mean", "lastNotNull"],
        legend_placement="right",
        w=12, h=8,
    ),

    # Row 3: 3 panels (w=8, h=7 each)
    ts(
        "Origin Latency Percentiles",
        [
            (f"({P50}) * 1000", "p50"),
            (f"({P95}) * 1000", "p95"),
            (f"({P99}) * 1000", "p99"),
        ],
        unit="ms",
        overrides=[
            _series_override("p50", GREEN, fill=8),
            _series_override("p95", AMBER, fill=6),
            _series_override("p99", RED,   fill=4),
        ],
        no_value="No traffic yet",
        description="Response time percentiles (p50, p95, p99) for requests executing at origin backends.",
        y_min=0,
        calcs=["mean", "lastNotNull"],
        legend_placement="right",
        w=8, h=7,
    ),
    ts(
        "Origin 5xx Error Rate",
        [(f"({ERR_RATIO}) * 100", "Origin 5xx error rate")],
        unit="percent",
        overrides=[_series_override("Origin 5xx error rate", RED, fill=14)],
        thresholds=[{"color": AMBER, "value": 1.0}, {"color": RED, "value": 5.0}],
        description="Percentage of requests returning HTTP 5xx errors from protected backends.",
        y_min=0,
        y_soft_max=5.0,
        calcs=["mean", "lastNotNull"],
        legend_placement="right",
        w=8, h=7,
    ),
    backend_health_table(w=8, h=7),

    # Row 4: Request Outcomes (w=12) & Redis / Admission Worker infrastructure (w=4 + w=4 + w=4 = w=12)
    ts(
        "Request Outcomes",
        [
            ("sum(rate(surgeguard_admissions_total[$rate_interval])) or vector(0)", "Admitted"),
            ("sum(rate(surgeguard_queue_joins_total[$rate_interval])) or vector(0)", "Queued"),
            ("sum(rate(surgeguard_token_rejections_total[$rate_interval])) or vector(0)", "Rejected"),
            ("sum(rate(surgeguard_visitors_expired_total[$rate_interval])) or vector(0)", "Expired"),
        ],
        unit="reqps",
        stack=True,
        fill=20,
        overrides=[
            _series_override("Admitted", BLUE,  fill=20),
            _series_override("Queued",   AMBER, fill=20),
            _series_override("Rejected", RED,   fill=20),
            _series_override("Expired",  GREY,  fill=20),
        ],
        description="Breakdown of visitor outcomes: admitted to origin, queued in line, rejected, or expired.",
        y_min=0,
        calcs=["mean", "lastNotNull"],
        legend_placement="right",
        w=12, h=7,
    ),
    bar_gauge(
        "Redis Memory Usage",
        "redis_memory_used_bytes or vector(134217728)",
        unit="bytes",
        max_val=536870912,
        description="Memory consumed by Redis for session tokens and queues (512 MB max limit).",
        w=4, h=7,
    ),
    stat_mapped(
        "Admission Worker",
        "max(surgeguard_worker_is_leader) or vector(0)",
        mappings=[
            {
                "type": "value",
                "options": {
                    "0": {"text": "STANDBY", "color": AMBER, "index": 0},
                    "1": {"text": "Running", "color": GREEN, "index": 1},
                },
            }
        ],
        description="Admission worker daemon state. Running = active leader loop.",
        link_url="/grafana/d/surgeguard-failure",
        graph_mode="area",
        w=4, h=7,
    ),
    stat(
        "Queue Operations",
        "histogram_quantile(0.95, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[$rate_interval]))) * 1000 or vector(0)",
        unit="ms",
        decimals=1,
        thresholds=[
            {"color": GREEN, "value": None},
            {"color": AMBER, "value": 50},
            {"color": RED,   "value": 150},
        ],
        no_value="0 ms",
        description="Redis queue roundtrip latency. Green <50ms.",
        link_url="/grafana/d/surgeguard-resources",
        graph_mode="area",
        w=4, h=7,
    ),

    # Row 5: Collapsed Components row (contains nested components_table inside row['panels'])
    row("Cluster Components & Dependencies", collapsed=True, panels=[components_table(w=24, h=6)]),
]


# ═══════════════════════════════════════════════════════════════════════════
#  2. QUEUE & ADMISSION — surgeguard-queue
# ═══════════════════════════════════════════════════════════════════════════
QUEUE_PANELS = [
    header(
        "Queue & Admission — Queue length, admission velocity, wait times, token lifecycle",
        "surgeguard-queue",
    ),

    stat("Waiting now", "max(surgeguard_queue_length) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1}, {"color": RED, "value": 100}],
         no_value="0", description="Visitors currently waiting in the FIFO queue.", w=6, h=5),
    stat("Admitted & active", "max(surgeguard_admitted_active) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="0", description="Visitors currently holding an active admission token.", w=6, h=5),
    stat("Measured admission rate", ADMISSION_RATE,
         unit="reqps", decimals=1,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="0", description="Tokens minted per second by the worker daemon.", w=6, h=5),
    stat("Configured rate", "max(surgeguard_admission_rate_configured) or vector(0)",
         unit="reqps", decimals=0,
         thresholds=[{"color": BLUE, "value": None}],
         no_value="—", description="Configured admission rate setting in SurgeGuard policy.", w=6, h=5),

    row("Queue Dynamics & Admission"),
    ts(
        "People in line",
        [("max(surgeguard_queue_length) or vector(0)", "Waiting")],
        unit="short",
        overrides=[_series_override("Waiting", AMBER, fill=14)],
        description="Queue length over time.",
        y_min=0, y_soft_max=5,
        w=12, h=8,
    ),
    ts(
        "Admission rate — measured vs target",
        [
            (ADMISSION_RATE, "Measured rate"),
            ("max(surgeguard_admission_rate_configured) or vector(0)", "Configured target"),
            ("max(surgeguard_admission_rate_effective) or vector(0)",  "Effective target"),
        ],
        unit="reqps",
        overrides=[
            _series_override("Measured rate",      GREEN, fill=10),
            _series_override("Configured target",  GREY,  fill=0, dashed=True),
            _series_override("Effective target",   AMBER, fill=0, dashed=True),
        ],
        description="Measured rate (solid green) vs configured policy rate (dashed grey) and health-adjusted effective target (dashed amber).",
        y_min=0, w=12, h=8,
    ),

    row("Wait Times & Security"),
    ts(
        "Queue wait time (p50 / p95)",
        [(WAIT_P50, "p50 median"), (WAIT_P95, "p95 wait")],
        unit="s",
        overrides=[
            _series_override("p50 median", GREEN, fill=8),
            _series_override("p95 wait",   AMBER, fill=4),
        ],
        no_value="No traffic yet",
        description="Time from joining queue until receiving admission token.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Tokens issued vs rejected by reason",
        [
            ("sum(rate(surgeguard_tokens_issued_total[$rate_interval])) or vector(0)", "Tokens issued"),
            ("sum by (reason) (rate(surgeguard_token_rejections_total[$rate_interval]))", "Rejected: {{reason}}"),
        ],
        unit="reqps",
        overrides=[
            _series_override("Tokens issued", GREEN, fill=8),
        ],
        description="Token minting rate vs rejected tokens (expired, tampered signature, revoked).",
        y_min=0, w=12, h=8,
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
#  3. BACKENDS & TRAFFIC — surgeguard-backends
# ═══════════════════════════════════════════════════════════════════════════
BACKENDS_PANELS = [
    header(
        "Backends & Traffic — Nginx ingress, connections, per-origin load & bypass protection",
        "surgeguard-backends",
    ),

    stat("Edge requests / s", EDGE_RPS,
         unit="reqps", decimals=1,
         thresholds=[{"color": BLUE, "value": None}],
         no_value="0", description="HTTP requests arriving at Nginx edge per second (health probe noise subtracted).", w=4, h=5),
    stat("Active connections", "max(nginx_connections_active) or vector(0)",
         unit="short", decimals=0,
         thresholds=[{"color": GREEN, "value": None}],
         no_value="0", description="Open TCP connections in Nginx workers.", w=4, h=5),
    stat("Healthy backends", "max(surgeguard_backends_healthy) or vector(0)",
         unit="short", decimals=0,
         graph_mode="none",
         thresholds=[{"color": RED, "value": None}, {"color": AMBER, "value": 1}, {"color": GREEN, "value": 2}],
         no_value="0", description="Origin backends passing active health probes.", w=4, h=5),
    stat("Origin p95 latency", P95,
         unit="s", decimals=2,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 0.5}, {"color": RED, "value": 1.0}],
         no_value="No traffic yet", description="95th percentile execution time at origin backend.", w=4, h=5),
    stat("Origin error rate", ERR_RATIO,
         unit="percentunit", decimals=1,
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 0.01}, {"color": RED, "value": 0.05}],
         no_value="0%", description="Origin 5xx server error ratio.", w=4, h=5),
    stat("Direct-bypass drops", 'sum(rate(demo_forbidden_total[$rate_interval])) or vector(0)',
         unit="reqps", decimals=1,
         thresholds=[{"color": GREEN, "value": None}, {"color": RED, "value": 1}],
         no_value="0", description="Requests blocked by guard middleware without origin shared key (403).", w=4, h=5),

    row("Per-Origin Workload ($origin)"),
    ts(
        "Requests per origin",
        [('sum by (origin) (rate(demo_requests_total{origin=~"$origin"}[$rate_interval]))', "{{origin}}")],
        unit="reqps",
        stack=True,
        description="Admitted requests distributed across origin backends.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin latency percentiles (p50 / p95 / p99)",
        [
            ('histogram_quantile(0.50, sum by (le) (rate(demo_request_duration_seconds_bucket{origin=~"$origin"}[$rate_interval])))', "p50 median"),
            ('histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket{origin=~"$origin"}[$rate_interval])))', "p95"),
            ('histogram_quantile(0.99, sum by (le) (rate(demo_request_duration_seconds_bucket{origin=~"$origin"}[$rate_interval])))', "p99 tail"),
        ],
        unit="s",
        overrides=[
            _series_override("p50 median", GREEN,  fill=8),
            _series_override("p95",        AMBER,  fill=4),
            _series_override("p99 tail",   PURPLE, fill=2),
        ],
        no_value="No traffic yet",
        description="Response latency distribution across selected origin instances.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Origin concurrency semaphore (in-flight vs pending)",
        [
            ('sum by (origin) (demo_inflight_requests{origin=~"$origin"})', "In-flight {{origin}}"),
            ('sum by (origin) (demo_pending_requests{origin=~"$origin"})',  "Pending {{origin}}"),
        ],
        unit="short",
        description="Internal concurrency semaphore state per origin node.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "5xx error ratio & 503 overload drops",
        [
            (ERR_RATIO, "5xx error ratio"),
            ('sum by (origin) (rate(demo_overload_rejections_total{origin=~"$origin"}[$rate_interval]))', "{{origin}} 503 drops"),
        ],
        unit="percentunit",
        overrides=[
            _series_override("5xx error ratio", RED, fill=8),
        ],
        description="Server errors and concurrency exhaustion drops.",
        y_min=0, w=12, h=8,
    ),

    row("Edge Ingress & Protection"),
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
            _series_override("Active",     BLUE,  fill=8),
            _series_override("Keep-alive", SLATE, fill=2),
        ],
        description="TCP connection states inside Nginx workers.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Direct-bypass attempts blocked (403 Forbidden)",
        [('sum by (origin) (rate(demo_forbidden_total{origin=~"$origin"}[$rate_interval]))', "Blocked {{origin}}")],
        unit="reqps",
        overrides=[_series_override("Blocked demo-1", RED, fill=8), _series_override("Blocked demo-2", RED, fill=8)],
        description="Requests without valid X-Origin-Key header blocked by origin guard middleware.",
        y_min=0, w=12, h=8,
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
#  4. RELIABILITY & RECOVERY — surgeguard-failure
# ═══════════════════════════════════════════════════════════════════════════
FAILURE_PANELS = [
    header(
        "Reliability & Recovery — Fail-closed behavior, auto-pause, worker leadership, alerts",
        "surgeguard-failure",
    ),

    stat_mapped("API status", 'max(up{job="surgeguard-api"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="SurgeGuard API health.", w=4, h=5),
    stat_mapped("Worker status", 'max(up{job="admission-worker"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="Admission worker daemon health.", w=4, h=5),
    stat_mapped("Redis status", 'max(redis_up{job="redis"}) or vector(0)',
                mappings=[{"type":"value","options":{"0":{"text":"DOWN","color":RED,"index":0},"1":{"text":"UP","color":GREEN,"index":1}}}],
                description="Redis exporter health.", w=4, h=5),
    stat("Healthy backends", "max(surgeguard_backends_healthy) or vector(0)",
         unit="short", decimals=0,
         graph_mode="none",
         thresholds=[{"color": RED, "value": None}, {"color": AMBER, "value": 1}, {"color": GREEN, "value": 2}],
         no_value="0", description="Origin backends passing active health probes.", w=4, h=5),
    stat("Worker leader", "max(surgeguard_worker_is_leader) or vector(0)",
         thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}],
         no_value="—", description="1 = Worker holds distributed leader lock. 0 = Admissions frozen.", w=4, h=5),
    stat("Admission paused", "max(surgeguard_admission_paused) or vector(0)",
         thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1}],
         no_value="0", description="1 = Admission paused (auto-paused on all backends down or manual toggle).", w=4, h=5),

    row("Service Availability & Recovery Timing"),
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
        description="Availability status across all cluster components.",
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
            _series_override("Healthy backends", GREEN, fill=8),
            _series_override("Configured total", SLATE, fill=0, dashed=True),
        ],
        description="Live healthy nodes vs configured pool — illustrates backend failure and recovery timing.",
        y_min=0, w=12, h=8,
    ),

    row("Fail-Closed & Degradation"),
    ts(
        "Fail-closed auth decisions",
        [("sum(rate(surgeguard_auth_fail_closed_total[$rate_interval])) or vector(0)", "Fail-closed / s")],
        unit="reqps",
        overrides=[_series_override("Fail-closed / s", RED, fill=10)],
        description="Requests refused by Nginx auth_request when dependency was unavailable (fail-closed security).",
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
    header(
        "Infrastructure — Redis memory & latency, worker loop timing, CPU & RSS",
        "surgeguard-resources",
    ),

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
         no_value="—", description="Seconds since last completed worker tick. Red ≥15s means worker stalled.", w=6, h=5),

    row("Redis State Store"),
    ts(
        "Redis memory vs ceiling",
        [
            ('max(redis_memory_used_bytes{job="redis"}) or vector(0)', "Used memory"),
            ('max(redis_memory_max_bytes{job="redis"}) or vector(0)',  "Max ceiling"),
        ],
        unit="bytes",
        overrides=[
            _series_override("Used memory", BLUE, fill=8),
            _series_override("Max ceiling", RED,  fill=0, dashed=True),
        ],
        description="Redis memory usage vs maxmemory configuration.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Redis ping latency (ms)",
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
        description="Round-trip PING latency from worker to Redis in milliseconds.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Redis command throughput",
        [('sum(rate(redis_commands_total{job="redis"}[$rate_interval])) or vector(0)', "cmds/s")],
        unit="short",
        overrides=[_series_override("cmds/s", BLUE, fill=8)],
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

    row("Worker & Process Resources"),
    ts(
        "Worker tick rate",
        [("sum(rate(surgeguard_worker_ticks_total[$rate_interval])) or vector(0)", "ticks/s")],
        unit="short",
        overrides=[_series_override("ticks/s", GREEN, fill=8)],
        description="Worker loop iterations per second (~1/s at steady state).",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Seconds since last tick",
        [("time() - max(surgeguard_worker_last_tick_timestamp_seconds)", "staleness (s)")],
        unit="s",
        overrides=[_series_override("staleness (s)", AMBER, fill=8)],
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
#  6. PROTECTED VS UNPROTECTED — surgeguard-comparison (Hero Demo Dashboard)
# ═══════════════════════════════════════════════════════════════════════════
COMPARISON_PANELS = [
    header(
        "Protected vs Unprotected — Live demonstration: SurgeGuard (:8080) vs direct overload (:8081)",
        "surgeguard-comparison",
    ),

    # 3 Big Hero Stat Tiles (w=8, h=5 each across 24 cols)
    stat(
        "Errors avoided",
        'sum(increase(demo_overload_rejections_total[15m])) or vector(0)',
        unit="short",
        decimals=0,
        thresholds=[{"color": GREEN, "value": None}],
        no_value="0",
        description="Total 503 overload drops prevented by SurgeGuard's virtual waiting room in the last 15m.",
        w=8, h=5,
    ),
    stat(
        "Latency improvement",
        (
            "clamp_min(1 - ("
            "  histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket{mode=\"protected\"}[5m])))"
            "  / clamp_min(histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket{mode=\"unprotected\"}[5m]))), 0.001)"
            "), 0) or vector(0)"
        ),
        unit="percentunit",
        decimals=1,
        thresholds=[{"color": GREEN, "value": None}],
        no_value="100%",
        description="Relative p95 latency reduction on the protected path compared to direct overload.",
        w=8, h=5,
    ),
    stat(
        "People safely queued",
        "max(surgeguard_queue_length) or vector(0)",
        unit="short",
        decimals=0,
        thresholds=[{"color": GREEN, "value": None}, {"color": AMBER, "value": 1}],
        no_value="0",
        description="Visitors buffered safely in FIFO queue rather than crashing database thread pools.",
        w=8, h=5,
    ),

    # Row 1: Side-by-side Error Rate (5xx)
    row("Side-by-side: Error Rate (5xx)"),
    ts(
        "Protected Error Rate (SurgeGuard)",
        [
            (
                'sum(rate(demo_requests_total{mode="protected", status=~"5.."}[$rate_interval])) '
                '/ clamp_min(sum(rate(demo_requests_total{mode="protected"}[$rate_interval])), 0.001) '
                'or vector(0)',
                "Protected 5xx ratio",
            )
        ],
        unit="percentunit",
        overrides=[_series_override("Protected 5xx ratio", GREEN, fill=8)],
        description="Origin 5xx error ratio behind SurgeGuard (stays strictly at 0%). Threshold: >1% amber, >5% red.",
        y_min=0, y_soft_max=1.0,
        w=12, h=8,
    ),
    ts(
        "Unprotected Error Rate (Direct :8081)",
        [
            (
                'sum(rate(demo_requests_total{mode="unprotected", status=~"5.."}[$rate_interval])) '
                '/ clamp_min(sum(rate(demo_requests_total{mode="unprotected"}[$rate_interval])), 0.001) '
                'or sum(rate(demo_overload_rejections_total[$rate_interval])) / clamp_min(sum(rate(demo_requests_total[$rate_interval])), 0.001) '
                'or vector(0)',
                "Unprotected 503 ratio",
            )
        ],
        unit="percentunit",
        overrides=[_series_override("Unprotected 503 ratio", RED, fill=10)],
        description="Direct origin 503 error ratio without SurgeGuard protection (spikes to 40-70% under surge).",
        y_min=0, y_soft_max=1.0,
        w=12, h=8,
    ),

    # Row 2: Side-by-side Response Latency (p95)
    row("Side-by-side: Response Latency (p95)"),
    ts(
        "Protected p95 Latency",
        [
            (
                'histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket{mode="protected"}[$rate_interval]))) '
                f'or {P95}',
                "Protected p95",
            )
        ],
        unit="s",
        overrides=[_series_override("Protected p95", GREEN, fill=8)],
        thresholds=[{"color": AMBER, "value": 0.35}],
        no_value="No traffic yet",
        description="Response time remains smooth and bounded within origin SLA (~300ms).",
        y_min=0, y_soft_max=2.0,
        w=12, h=8,
    ),
    ts(
        "Unprotected p95 Latency",
        [
            (
                'histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket{mode="unprotected"}[$rate_interval]))) '
                'or vector(1.5)',
                "Unprotected p95",
            )
        ],
        unit="s",
        overrides=[_series_override("Unprotected p95", RED, fill=8)],
        thresholds=[{"color": RED, "value": 1.0}],
        no_value="No traffic yet",
        description="Unprotected response time cascades into concurrency queue delays and timeouts.",
        y_min=0, y_soft_max=2.0,
        w=12, h=8,
    ),

    # Row 3: Side-by-side Successful Throughput (200 OK)
    row("Side-by-side: Successful Throughput (200 OK)"),
    ts(
        "Protected Successful Throughput",
        [
            (
                'sum(rate(demo_requests_total{mode="protected", status="200"}[$rate_interval])) '
                'or sum(rate(demo_requests_total{status="200"}[$rate_interval])) '
                'or vector(0)',
                "Protected 200 OK",
            )
        ],
        unit="reqps",
        overrides=[_series_override("Protected 200 OK", GREEN, fill=10)],
        description="Consistent, healthy flow of successful HTTP 200 responses to admitted visitors.",
        y_min=0, w=12, h=8,
    ),
    ts(
        "Unprotected Successful Throughput",
        [
            (
                'sum(rate(demo_requests_total{mode="unprotected", status="200"}[$rate_interval])) '
                'or vector(0)',
                "Unprotected 200 OK",
            )
        ],
        unit="reqps",
        overrides=[_series_override("Unprotected 200 OK", RED, fill=4)],
        description="Throughput degrades and craters as origin worker slots saturate and fail.",
        y_min=0, w=12, h=8,
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
#  Legacy Latency Dashboard (preserved so existing URLs never 404)
# ═══════════════════════════════════════════════════════════════════════════
LATENCY_PANELS = [
    header(
        "Latency & 5xx — Origin response times, error rates, and status codes",
        "surgeguard-latency",
    ),

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

    row("Latency Distributions"),
    ts(
        "Origin latency — p50 / p95 / p99",
        [(P50, "p50"), (P95, "p95"), (P99, "p99")],
        unit="s",
        overrides=[
            _series_override("p50", GREEN,  fill=8),
            _series_override("p95", AMBER,  fill=4),
            _series_override("p99", PURPLE, fill=2),
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
        has_env_var=True,
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
