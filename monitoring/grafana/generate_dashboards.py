"""Generate the provisioned Grafana dashboards from a rich, production-grade spec.

    python monitoring/grafana/generate_dashboards.py

Generates 6 comprehensive, beautifully styled Grafana dashboards matching the
Raycast/Cloud Security theme, with live Prometheus queries, interactive templating
variables ($origin, $rate_interval), sparklines, bar gauges, and detailed metric panels.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).parent / "dashboards"
DS = {"type": "prometheus", "uid": "prometheus"}

# Modern, harmonious palette
CYAN = "#06b6d4"
VIOLET = "#8b5cf6"
BLUE = "#3b82f6"
EMERALD = "#10b981"
AMBER = "#f59e0b"
RED = "#ef4444"
ROSE = "#f43f5e"
GREY = "#94a3b8"
SLATE = "#64748b"
ORANGE = "#f97316"
INDIGO = "#6366f1"


def stat(
    title,
    expr,
    unit="short",
    color=GREY,
    decimals=None,
    thresholds=None,
    description="",
    w=6,
    h=4,
):
    return {
        "type": "stat",
        "title": title,
        "description": description,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
        "options": {
            "colorMode": "value",
            "graphMode": "area",
            "textMode": "auto",
            "orientation": "auto",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": decimals,
                "noValue": "no data",
                "color": {
                    "mode": "thresholds" if thresholds else "fixed",
                    "fixedColor": color,
                },
                "thresholds": {
                    "mode": "absolute",
                    "steps": thresholds or [{"color": color, "value": None}],
                },
            },
            "overrides": [],
        },
        "_w": w,
        "_h": h,
    }


def gauge(
    title,
    expr,
    unit="percentunit",
    min_val=0,
    max_val=1,
    thresholds=None,
    description="",
    w=6,
    h=4,
):
    return {
        "type": "gauge",
        "title": title,
        "description": description,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
        "options": {
            "orientation": "auto",
            "showThresholdLabels": False,
            "showThresholdMarkers": True,
            "reduceOptions": {"calcs": ["lastNotNull"], "values": False},
        },
        "fieldConfig": {
            "defaults": {
                "min": min_val,
                "max": max_val,
                "unit": unit,
                "noValue": "no data",
                "color": {"mode": "thresholds"},
                "thresholds": {
                    "mode": "absolute",
                    "steps": thresholds
                    or [
                        {"color": EMERALD, "value": None},
                        {"color": AMBER, "value": 0.05},
                        {"color": RED, "value": 0.10},
                    ],
                },
            },
            "overrides": [],
        },
        "_w": w,
        "_h": h,
    }


def bar_gauge(
    title,
    targets,
    unit="short",
    orientation="horizontal",
    thresholds=None,
    description="",
    w=12,
    h=6,
):
    return {
        "type": "bargauge",
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
        "options": {
            "displayMode": "gradient",
            "orientation": orientation,
            "showUnfilled": True,
            "reduceOptions": {"calcs": ["lastNotNull"], "values": False},
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "noValue": "no data",
                "color": {"mode": "thresholds"},
                "thresholds": {
                    "mode": "absolute",
                    "steps": thresholds
                    or [
                        {"color": RED, "value": None},
                        {"color": AMBER, "value": 1},
                        {"color": EMERALD, "value": 2},
                    ],
                },
            },
            "overrides": [],
        },
        "_w": w,
        "_h": h,
    }


def ts(
    title,
    targets,
    unit="short",
    color=CYAN,
    w=12,
    h=8,
    stack=False,
    description="",
    thresholds=None,
    legend_table=True,
):
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
            "defaults": {
                "unit": unit,
                "noValue": "no data",
                "color": {"mode": "fixed", "fixedColor": color}
                if len(targets) == 1
                else {"mode": "palette-classic"},
                "custom": {
                    "lineWidth": 2,
                    "fillOpacity": 16,
                    "gradientMode": "opacity",
                    "showPoints": "auto",
                    "pointSize": 4,
                    "spanNulls": False,
                    "lineInterpolation": "smooth",
                    "axisBorderShow": False,
                    "axisGridShow": True,
                    "stacking": {"mode": "normal" if stack else "none"},
                    "thresholdsStyle": {"mode": "line"}
                    if thresholds
                    else {"mode": "off"},
                },
                "thresholds": {
                    "mode": "absolute",
                    "steps": thresholds or [{"color": color, "value": None}],
                },
            },
            "overrides": [],
        },
        "options": {
            "legend": {
                "displayMode": "table"
                if (legend_table and len(targets) > 1)
                else "list",
                "placement": "bottom",
                "calcs": ["mean", "max", "lastNotNull"]
                if (legend_table and len(targets) > 1)
                else [],
            },
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "_w": w,
        "_h": h,
    }


def row(title, collapsed=False):
    return {
        "type": "row",
        "title": title,
        "collapsed": collapsed,
        "_w": 24,
        "_h": 1,
    }


def alerts_panel(title="Active Alerts (Prometheus)", description="", w=24, h=6):
    return {
        "type": "alertlist",
        "title": title,
        "description": description,
        "options": {
            "alertListOptions": {"showOptions": "current"},
            "stateFilter": {"firing": True, "pending": True},
        },
        "datasource": DS,
        "targets": [{"refId": "A", "expr": "ALERTS", "datasource": DS}],
        "_w": w,
        "_h": h,
    }


def table(title, expr, description="", w=24, h=6):
    return {
        "type": "table",
        "title": title,
        "description": description,
        "datasource": DS,
        "targets": [
            {
                "refId": "A",
                "expr": expr,
                "format": "table",
                "instant": True,
                "datasource": DS,
            }
        ],
        "fieldConfig": {"defaults": {"noValue": "no data"}, "overrides": []},
        "_w": w,
        "_h": h,
    }


def layout(panels):
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


def dashboard(uid, title, panels, description, has_origin_var=True):
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

    return {
        "uid": uid,
        "title": title,
        "description": description,
        "tags": ["surgeguard", "observability", "production", "cloud-security"],
        "timezone": "browser",
        "schemaVersion": 39,
        "version": 2,
        "refresh": "5s",
        "time": {"from": "now-15m", "to": "now"},
        "editable": False,
        "graphTooltip": 1,
        "panels": layout(panels),
        "templating": {"list": templating_list},
        "annotations": {
            "list": [
                {
                    "builtIn": 1,
                    "datasource": "-- Grafana --",
                    "enable": True,
                    "hide": False,
                    "name": "Annotations & Alerts",
                    "type": "dashboard",
                }
            ]
        },
    }


# Standard PromQL Snippets
ERR_RATIO = 'sum(rate(demo_requests_total{status=~"5.."}[$rate_interval])) / clamp_min(sum(rate(demo_requests_total[$rate_interval])), 0.001)'
P95 = "histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket[$rate_interval])))"
P50 = "histogram_quantile(0.50, sum by (le) (rate(demo_request_duration_seconds_bucket[$rate_interval])))"
P99 = "histogram_quantile(0.99, sum by (le) (rate(demo_request_duration_seconds_bucket[$rate_interval])))"

DASHBOARDS = {
    # -----------------------------------------------------------------------
    # 1. SurgeGuard Overview & System Health
    # -----------------------------------------------------------------------
    "surgeguard-overview": dashboard(
        "surgeguard-overview",
        "SurgeGuard · Overview & System Health",
        [
            row("System Vital Health & Capacity KPIs"),
            stat(
                "Queue Depth",
                "max(surgeguard_queue_length)",
                color=ORANGE,
                description="Visitors actively waiting in FIFO queue sequence",
            ),
            stat(
                "Admitted Active",
                "max(surgeguard_admitted_active)",
                color=EMERALD,
                description="Visitors currently holding valid admission tokens",
            ),
            stat(
                "Admission Velocity",
                "sum(rate(surgeguard_admissions_total[$rate_interval]))",
                "short",
                EMERALD,
                2,
                description="Rate of visitors admitted per second",
            ),
            gauge(
                "Origin Error Ratio",
                ERR_RATIO,
                "percentunit",
                0,
                0.25,
                [
                    {"color": EMERALD, "value": None},
                    {"color": AMBER, "value": 0.02},
                    {"color": RED, "value": 0.05},
                ],
                description="Percentage of 5xx server overload responses",
                w=6,
                h=4,
            ),
            stat(
                "Healthy Backends",
                "max(surgeguard_backends_healthy)",
                color=EMERALD,
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": AMBER, "value": 1},
                    {"color": EMERALD, "value": 2},
                ],
                description="Origins passing active health check probing",
            ),
            stat(
                "Edge Ingress / s",
                "sum(rate(nginx_http_requests_total[$rate_interval]))",
                color=CYAN,
                description="Nginx public entry requests handled per second",
            ),
            stat(
                "Origin p95 Latency",
                P95,
                "s",
                AMBER,
                2,
                description="95th percentile execution duration inside origin",
            ),
            stat(
                "Redis Operational",
                'max(redis_up{job="redis"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": EMERALD, "value": 1},
                ],
                description="1 = Redis responsive, 0 = Redis unavailable",
            ),
            row("Traffic Throughput & Admissions"),
            ts(
                "Edge Ingress vs Origin Admitted Throughput",
                [
                    (
                        "sum(rate(nginx_http_requests_total[$rate_interval]))",
                        "edge requests (nginx)",
                    ),
                    (
                        "sum(rate(demo_requests_total[$rate_interval]))",
                        "admitted origin requests",
                    ),
                ],
                color=CYAN,
                description="Comparison of total edge traffic arriving vs requests admitted to origins",
                w=12,
                h=8,
            ),
            ts(
                "Admission Velocity vs Target Policy",
                [
                    (
                        "sum(rate(surgeguard_admissions_total[$rate_interval]))",
                        "measured admitted/s",
                    ),
                    ("max(surgeguard_admission_rate_effective)", "effective target/s"),
                    (
                        "max(surgeguard_admission_rate_configured)",
                        "configured target/s",
                    ),
                ],
                color=EMERALD,
                description="Measured admission rate compared with configured and health-adjusted targets",
                w=12,
                h=8,
            ),
            ts(
                "Queue Depth (Waiting Visitors)",
                [("max(surgeguard_queue_length)", "visitors in line")],
                color=ORANGE,
                description="Total visitors currently queued awaiting admission tokens",
                w=12,
                h=8,
            ),
            ts(
                "Active Admitted (Holding Tokens)",
                [("max(surgeguard_admitted_active)", "active tokens")],
                color=EMERALD,
                description="Number of visitors currently browsing the protected origin with valid tokens",
                w=12,
                h=8,
            ),
            row("Latency Distribution & Error Tracking"),
            ts(
                "Origin Latency Percentiles",
                [
                    (P50, "p50 median"),
                    (P95, "p95"),
                    (P99, "p99 tail"),
                ],
                "s",
                AMBER,
                description="Response latency percentiles for admitted requests reaching origins",
                thresholds=[
                    {"color": AMBER, "value": 0.5},
                    {"color": RED, "value": 1.0},
                ],
                w=12,
                h=8,
            ),
            ts(
                "Queue Wait Time (Join → Admission)",
                [
                    (
                        "histogram_quantile(0.5, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))",
                        "p50 wait time",
                    ),
                    (
                        "histogram_quantile(0.95, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))",
                        "p95 wait time",
                    ),
                ],
                "s",
                INDIGO,
                description="Elapsed time spent waiting from queue entry until token release",
                w=12,
                h=8,
            ),
            row("Scrape Targets & Alert States"),
            table(
                "Scrape Targets Health & Latency",
                "up",
                description="Prometheus container scrape target health matrix",
                w=12,
                h=7,
            ),
            alerts_panel(
                "Active Operational Alerts",
                description="Real-time alert evaluation status across the cluster",
                w=12,
                h=7,
            ),
        ],
        "Top-level operational overview of the SurgeGuard virtual waiting room, edge proxy, and backend origins.",
    ),
    # -----------------------------------------------------------------------
    # 2. Nginx Edge & Traffic
    # -----------------------------------------------------------------------
    "surgeguard-backends": dashboard(
        "surgeguard-backends",
        "SurgeGuard · Nginx Edge & Traffic",
        [
            row("Nginx Edge Ingestion & Connections"),
            stat(
                "Nginx Edge Requests / s",
                "sum(rate(nginx_http_requests_total[$rate_interval]))",
                color=CYAN,
                description="Public ingress request rate at reverse proxy",
            ),
            stat(
                "Active TCP Connections",
                "max(nginx_connections_active)",
                color=EMERALD,
                description="Currently open client connections",
            ),
            stat(
                "Connections Waiting",
                "max(nginx_connections_waiting)",
                color=GREY,
                description="Keep-alive connections waiting for next request",
            ),
            stat(
                "Nginx Health",
                'max(nginx_up{job="nginx"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": EMERALD, "value": 1},
                ],
                description="1 = Nginx reverse proxy healthy and scraping",
            ),
            ts(
                "Edge Request Volume (Requests / s)",
                [("sum(rate(nginx_http_requests_total[$rate_interval]))", "nginx rps")],
                color=CYAN,
                description="Total HTTP traffic ingested across public edge endpoints",
                w=12,
                h=8,
            ),
            ts(
                "Connection States Breakdown",
                [
                    ("max(nginx_connections_active)", "active"),
                    ("max(nginx_connections_reading)", "reading request"),
                    ("max(nginx_connections_writing)", "writing response"),
                    ("max(nginx_connections_waiting)", "waiting / keep-alive"),
                ],
                description="Distribution of TCP connection states inside Nginx worker processes",
                w=12,
                h=8,
            ),
            row("Origin Workload Distribution ($origin)"),
            ts(
                "Origin Requests / s by Instance",
                [
                    (
                        'sum by (origin) (rate(demo_requests_total{origin=~"$origin"}[$rate_interval]))',
                        "{{origin}} rps",
                    )
                ],
                stack=True,
                description="Admitted traffic volume distributed across demo origin instances",
                w=12,
                h=8,
            ),
            ts(
                "Origin Concurrency Slots (In-flight & Pending)",
                [
                    (
                        'sum by (origin) (demo_inflight_requests{origin=~"$origin"})',
                        "in-flight {{origin}}",
                    ),
                    (
                        'sum by (origin) (demo_pending_requests{origin=~"$origin"})',
                        "pending queue {{origin}}",
                    ),
                ],
                description="Internal concurrency semaphore utilization inside Python origin instances",
                w=12,
                h=8,
            ),
            ts(
                "Origin p95 Latency by Instance",
                [
                    (
                        'histogram_quantile(0.95, sum by (le, origin) (rate(demo_request_duration_seconds_bucket{origin=~"$origin"}[$rate_interval])))',
                        "{{origin}} p95",
                    )
                ],
                "s",
                AMBER,
                description="Execution latency percentiles grouped by backend instance",
                w=12,
                h=8,
            ),
            ts(
                "Overload Rejections (503) by Instance",
                [
                    (
                        'sum by (origin) (rate(demo_overload_rejections_total{origin=~"$origin"}[$rate_interval]))',
                        "{{origin}} 503 drops",
                    )
                ],
                color=RED,
                description="Overload rejection events triggered when internal origin concurrency is exceeded",
                w=12,
                h=8,
            ),
            row("Security & Edge Enforcement"),
            ts(
                "Direct-Origin Bypass Attempts (403 Forbidden)",
                [
                    (
                        'sum by (origin) (rate(demo_forbidden_total{origin=~"$origin"}[$rate_interval]))',
                        "blocked bypass: {{origin}}",
                    )
                ],
                color=RED,
                description="Requests blocked by guard middleware because they lacked valid X-Origin-Key",
                w=12,
                h=8,
            ),
            ts(
                "Backend Health Check Probing Latency",
                [
                    (
                        "max by (backend) (surgeguard_backend_check_latency_seconds)",
                        "probe latency: {{backend}}",
                    )
                ],
                "s",
                EMERALD,
                description="Roundtrip latency for worker probing origin health endpoints",
                w=12,
                h=8,
            ),
        ],
        "Edge traffic handling, connection pools, and per-instance origin health.",
    ),
    # -----------------------------------------------------------------------
    # 3. API & Queue Mechanics
    # -----------------------------------------------------------------------
    "surgeguard-queue": dashboard(
        "surgeguard-queue",
        "SurgeGuard · API & Queue Mechanics",
        [
            row("Queue Progression & Admission Velocity"),
            stat(
                "Visitors Waiting",
                "max(surgeguard_queue_length)",
                color=ORANGE,
                description="Queue depth awaiting admission tokens",
            ),
            stat(
                "Admitted Active Tokens",
                "max(surgeguard_admitted_active)",
                color=EMERALD,
                description="Non-expired JWT admission tokens currently valid",
            ),
            stat(
                "Measured Admission Rate",
                "sum(rate(surgeguard_admissions_total[$rate_interval]))",
                "short",
                EMERALD,
                2,
                description="Admissions minted and released per second",
            ),
            stat(
                "Configured Rate",
                "max(surgeguard_admission_rate_configured)",
                "short",
                BLUE,
                description="Configured admission rate setting in SurgeGuard",
            ),
            ts(
                "Queue Depth over Time",
                [("max(surgeguard_queue_length)", "waiting visitors")],
                color=ORANGE,
                description="Live waiting room queue depth over time",
                w=12,
                h=8,
            ),
            ts(
                "Admission Rate (Measured vs Effective vs Configured)",
                [
                    (
                        "sum(rate(surgeguard_admissions_total[$rate_interval]))",
                        "measured admission rate",
                    ),
                    ("max(surgeguard_admission_rate_effective)", "effective target"),
                    ("max(surgeguard_admission_rate_configured)", "configured target"),
                ],
                description="Realized admission rate compared against policy target rate limits",
                w=12,
                h=8,
            ),
            row("Wait Duration & Ingress Outcomes"),
            ts(
                "Queue Wait Time (Join → Admission)",
                [
                    (
                        "histogram_quantile(0.5, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))",
                        "p50 median wait",
                    ),
                    (
                        "histogram_quantile(0.95, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))",
                        "p95 wait percentile",
                    ),
                ],
                "s",
                AMBER,
                description="Time spent by visitors from initial join until receiving admission token",
                w=12,
                h=8,
            ),
            ts(
                "Queue Joins by Mode / Outcome",
                [
                    (
                        "sum by (mode) (rate(surgeguard_queue_joins_total[$rate_interval]))",
                        "join: {{mode}}",
                    )
                ],
                stack=True,
                description="Incoming visitor arrivals categorized by queue mode (queued vs direct)",
                w=12,
                h=8,
            ),
            row("Token Lifecycle & Heartbeats"),
            ts(
                "Tokens Minted & Validations",
                [
                    (
                        "sum(rate(surgeguard_tokens_issued_total[$rate_interval]))",
                        "issued tokens",
                    ),
                    (
                        "sum by (result) (rate(surgeguard_token_validations_total[$rate_interval]))",
                        "validation: {{result}}",
                    ),
                ],
                description="Rate of HMAC-SHA256 tokens minted and validated at /internal/auth",
                w=12,
                h=8,
            ),
            ts(
                "Token Rejections & Revocations",
                [
                    (
                        "sum by (reason) (rate(surgeguard_token_rejections_total[$rate_interval]))",
                        "rejected: {{reason}}",
                    ),
                    (
                        "sum(rate(surgeguard_tokens_revoked_total[$rate_interval]))",
                        "admin revoked",
                    ),
                ],
                color=RED,
                description="Security rejections (expired, tampered signature, or revoked tokens)",
                w=12,
                h=8,
            ),
            ts(
                "Expired Visitors (Heartbeat Timeout)",
                [
                    (
                        "sum by (reason) (rate(surgeguard_visitors_expired_total[$rate_interval]))",
                        "expired: {{reason}}",
                    )
                ],
                color=GREY,
                description="Inactive visitors purged from Redis ZSET because their polling heartbeat stopped",
                w=12,
                h=8,
            ),
            ts(
                "Rate-Limited Join Attempts",
                [
                    (
                        "sum by (bucket) (rate(surgeguard_rate_limited_total[$rate_interval]))",
                        "rate-limited: {{bucket}}",
                    )
                ],
                color=AMBER,
                description="Excessive API calls throttled by the application-level rate limiter",
                w=12,
                h=8,
            ),
        ],
        "Queue progression, token bucket releases, wait times, and token security validations.",
        has_origin_var=False,
    ),
    # -----------------------------------------------------------------------
    # 4. Infrastructure & Resources
    # -----------------------------------------------------------------------
    "surgeguard-resources": dashboard(
        "surgeguard-resources",
        "SurgeGuard · Infrastructure & Resources",
        [
            row("Redis Key-Value Telemetry & Memory"),
            stat(
                "Redis Available",
                'max(redis_up{job="redis"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": EMERALD, "value": 1},
                ],
                description="Operational status of Redis cluster instance",
            ),
            stat(
                "Redis Memory Used",
                'max(redis_memory_used_bytes{job="redis"})',
                "bytes",
                color=BLUE,
                description="Total memory allocated to Redis data structures",
            ),
            stat(
                "Connected Clients",
                'max(redis_connected_clients{job="redis"})',
                color=EMERALD,
                description="Active client socket connections to Redis",
            ),
            stat(
                "Commands / s",
                'sum(rate(redis_commands_total{job="redis"}[$rate_interval]))',
                color=ORANGE,
                description="Operations executed per second against Redis",
            ),
            ts(
                "Redis Memory Utilization vs Ceiling",
                [
                    ('max(redis_memory_used_bytes{job="redis"})', "memory used"),
                    ('max(redis_memory_max_bytes{job="redis"})', "maxmemory ceiling"),
                ],
                "bytes",
                BLUE,
                description="Memory usage compared with maxmemory configuration threshold",
                w=12,
                h=8,
            ),
            ts(
                "Redis Command Throughput",
                [
                    (
                        'sum(rate(redis_commands_total{job="redis"}[$rate_interval]))',
                        "commands / s",
                    )
                ],
                color=ORANGE,
                description="Throughput of Redis reads, writes, and ZSET rank queries",
                w=12,
                h=8,
            ),
            ts(
                "Redis Roundtrip PING Latency",
                [
                    (
                        "histogram_quantile(0.5, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[$rate_interval])))",
                        "p50 ping latency",
                    ),
                    (
                        "histogram_quantile(0.95, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[$rate_interval])))",
                        "p95 ping latency",
                    ),
                ],
                "s",
                AMBER,
                description="Roundtrip network and command latency from worker to Redis",
                w=12,
                h=8,
            ),
            ts(
                "Connected Redis Clients",
                [('max(redis_connected_clients{job="redis"})', "connected clients")],
                color=EMERALD,
                description="Socket connections maintained across API and worker instances",
                w=12,
                h=8,
            ),
            row("Admission Worker & Probing Engine"),
            stat(
                "Worker Leader",
                "max(surgeguard_worker_is_leader)",
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": EMERALD, "value": 1},
                ],
                description="1 = Worker currently holds distributed leader lock in Redis",
            ),
            stat(
                "Worker Iterations / s",
                "sum(rate(surgeguard_worker_ticks_total[$rate_interval]))",
                color=EMERALD,
                description="Cadence of admission evaluation ticks per second",
            ),
            stat(
                "Seconds Since Last Tick",
                "time() - max(surgeguard_worker_last_tick_timestamp_seconds)",
                "s",
                AMBER,
                thresholds=[
                    {"color": EMERALD, "value": None},
                    {"color": AMBER, "value": 5},
                    {"color": RED, "value": 15},
                ],
                description="Elapsed time since worker completed its last loop iteration",
            ),
            stat(
                "Healthy Backends",
                "max(surgeguard_backends_healthy)",
                color=EMERALD,
                description="Count of backend instances responding successfully to health checks",
            ),
            ts(
                "Worker Liveness & Heartbeat Age",
                [
                    (
                        "time() - max(surgeguard_worker_last_tick_timestamp_seconds)",
                        "seconds since last tick",
                    )
                ],
                "s",
                AMBER,
                description="Staleness of worker loop; increases if worker process hangs or crashes",
                thresholds=[{"color": AMBER, "value": 5}, {"color": RED, "value": 15}],
                w=12,
                h=8,
            ),
            ts(
                "Active Probing Latency to Backends",
                [
                    (
                        "max by (backend) (surgeguard_backend_check_latency_seconds)",
                        "probe latency {{backend}}",
                    )
                ],
                "s",
                EMERALD,
                description="Health probe latency measured across configured upstream origins",
                w=12,
                h=8,
            ),
        ],
        "Redis memory utilization, command throughput, worker loop cadence, and container infrastructure health.",
        has_origin_var=False,
    ),
    # -----------------------------------------------------------------------
    # 5. Latency & Response Codes
    # -----------------------------------------------------------------------
    "surgeguard-latency": dashboard(
        "surgeguard-latency",
        "SurgeGuard · Latency & Error Distribution",
        [
            row("Origin Execution Duration & Percentile Curves"),
            stat(
                "Median Latency (p50)",
                P50,
                "s",
                EMERALD,
                3,
                description="50% of origin requests complete faster than this",
            ),
            stat(
                "p95 Latency",
                P95,
                "s",
                AMBER,
                3,
                description="95th percentile latency of backend origin execution",
            ),
            stat(
                "Tail Latency (p99)",
                P99,
                "s",
                RED,
                3,
                description="99th percentile worst-case execution duration",
            ),
            gauge(
                "Origin Error Ratio",
                ERR_RATIO,
                "percentunit",
                0,
                0.20,
                [
                    {"color": EMERALD, "value": None},
                    {"color": AMBER, "value": 0.02},
                    {"color": RED, "value": 0.05},
                ],
                description="Percentage of origin responses returning 5xx status codes",
                w=6,
                h=4,
            ),
            ts(
                "Origin Latency Distributions (p50, p95, p99)",
                [
                    (P50, "p50 median"),
                    (P95, "p95 percentile"),
                    (P99, "p99 tail latency"),
                ],
                "s",
                AMBER,
                description="Complete percentile latency profile of backend request handling",
                thresholds=[
                    {"color": AMBER, "value": 0.5},
                    {"color": RED, "value": 1.0},
                ],
                w=12,
                h=8,
            ),
            ts(
                "Origin Responses by Status Class",
                [
                    (
                        'sum by (status) (rate(demo_requests_total{origin=~"$origin"}[$rate_interval]))',
                        "HTTP {{status}}",
                    )
                ],
                stack=True,
                description="HTTP status response codes emitted by backend origin instances",
                w=12,
                h=8,
            ),
            row("SurgeGuard API Latency & Health"),
            ts(
                "SurgeGuard API Latency (p95 by Route)",
                [
                    (
                        "histogram_quantile(0.95, sum by (le, route) (rate(surgeguard_http_request_duration_seconds_bucket[$rate_interval])))",
                        "route: {{route}}",
                    )
                ],
                "s",
                CYAN,
                description="Internal API endpoint processing duration at 95th percentile",
                w=12,
                h=8,
            ),
            ts(
                "SurgeGuard API Responses by Status Code",
                [
                    (
                        "sum by (status) (rate(surgeguard_http_requests_total[$rate_interval]))",
                        "status: {{status}}",
                    )
                ],
                stack=True,
                description="Status code distribution for SurgeGuard internal API endpoints",
                w=12,
                h=8,
            ),
        ],
        "Latency distributions, percentile curves, and response status codes.",
    ),
    # -----------------------------------------------------------------------
    # 6. Reliability & Failure Testing
    # -----------------------------------------------------------------------
    "surgeguard-failure": dashboard(
        "surgeguard-failure",
        "SurgeGuard · Reliability & Failure Testing",
        [
            row("Dependency Availability & Chaos Matrix"),
            stat(
                "API Availability",
                'max(up{job="surgeguard-api"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": EMERALD, "value": 1},
                ],
                description="Health check response of SurgeGuard API server",
            ),
            stat(
                "Worker Availability",
                'max(up{job="admission-worker"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": EMERALD, "value": 1},
                ],
                description="Health check response of admission worker daemon",
            ),
            stat(
                "Redis Availability",
                'max(redis_up{job="redis"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": EMERALD, "value": 1},
                ],
                description="Ping reachability of Redis state store",
            ),
            bar_gauge(
                "Origin Health State (Probing Matrix)",
                [
                    ("max(surgeguard_backends_healthy)", "healthy origins"),
                    ("max(surgeguard_backends_total)", "configured total"),
                ],
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": AMBER, "value": 1},
                    {"color": EMERALD, "value": 2},
                ],
                description="Probed health status of upstream origin instances",
                w=6,
                h=4,
            ),
            ts(
                "Service Availability Grid (1 = Up, 0 = Down)",
                [
                    ('max(up{job="surgeguard-api"})', "surgeguard api"),
                    ('max(up{job="admission-worker"})', "admission worker"),
                    ('max(redis_up{job="redis"})', "redis (exporter)"),
                    (
                        'max(surgeguard_redis_up{job="admission-worker"})',
                        "redis (worker ping)",
                    ),
                    ('max(nginx_up{job="nginx"})', "nginx edge"),
                ],
                color=EMERALD,
                description="Discrete liveness signal across every cluster service",
                w=12,
                h=8,
            ),
            ts(
                "Configured vs Healthy Backends",
                [
                    ("max(surgeguard_backends_healthy)", "healthy origins"),
                    ("max(surgeguard_backends_total)", "configured origins"),
                ],
                color=EMERALD,
                description="Comparison of total configured backends vs actively passing health checks",
                w=12,
                h=8,
            ),
            row("Fail-Closed Security & Degradation"),
            ts(
                "Fail-Closed Auth Interceptions",
                [
                    (
                        "sum(rate(surgeguard_auth_fail_closed_total[$rate_interval]))",
                        "fail-closed decisions/s",
                    )
                ],
                color=RED,
                description="Requests refused at Nginx because an internal auth dependency was down (fail-closed security)",
                w=12,
                h=8,
            ),
            ts(
                "Admission Paused States (Auto & Manual)",
                [("max by (kind) (surgeguard_admission_paused)", "paused: {{kind}}")],
                color=AMBER,
                description="1 when admission loop is paused (either manually by admin or automatically due to unhealthy backends)",
                w=12,
                h=8,
            ),
            ts(
                "Admission Loop Failures by Reason",
                [
                    (
                        "sum by (reason) (rate(surgeguard_admission_failures_total[$rate_interval]))",
                        "failure: {{reason}}",
                    )
                ],
                color=RED,
                description="Exceptions or network timeouts encountered during worker admission loop",
                w=12,
                h=8,
            ),
            ts(
                "Origin 5xx Overload Ratio",
                [(ERR_RATIO, "5xx error ratio")],
                "percentunit",
                RED,
                description="Percentage of requests resulting in 503 Service Unavailable",
                w=12,
                h=8,
            ),
            row("Alerting Rules & Status"),
            alerts_panel(
                "Firing & Pending Alert Rules",
                description="Prometheus alert evaluation state for operational threshold breaches",
                w=24,
                h=6,
            ),
        ],
        "What happens when dependencies fail, fail-closed enforcement behavior, and recovery speed.",
        has_origin_var=False,
    ),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, board in DASHBOARDS.items():
        (OUT / f"{name}.json").write_text(json.dumps(board, indent=2) + "\n")
        print(f"wrote {name}.json ({len(board['panels'])} panels)")
