"""Generate the provisioned Grafana dashboards from a compact spec.

    python monitoring/grafana/generate_dashboards.py

Every panel is a live Prometheus query; there is no static or sample data in any dashboard.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).parent / "dashboards"
DS = {"type": "prometheus", "uid": "prometheus"}
ORANGE, BLUE, GREEN, AMBER, RED, GREY = (
    "#ff9900",
    "#38bdf8",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#94a3b8",
)


def stat(
    title, expr, unit="short", color=GREY, decimals=None, thresholds=None, w=6, h=4
):
    return {
        "type": "stat",
        "title": title,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
        "options": {
            "colorMode": "value",
            "graphMode": "area",
            "reduceOptions": {"calcs": ["lastNotNull"]},
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


def ts(title, targets, unit="short", color=ORANGE, w=12, h=8, stack=False):
    return {
        "type": "timeseries",
        "title": title,
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
                    "fillOpacity": 12,
                    "gradientMode": "opacity",
                    "showPoints": "never",
                    "spanNulls": False,
                    "stacking": {"mode": "normal" if stack else "none"},
                },
            },
            "overrides": [],
        },
        "options": {
            "legend": {"displayMode": "list", "placement": "bottom"},
            "tooltip": {"mode": "multi"},
        },
        "_w": w,
        "_h": h,
    }


def row(title):
    return {
        "type": "row",
        "title": title,
        "collapsed": False,
        "_w": 24,
        "_h": 1,
    }


def alerts_panel(title="Active Alerts (Prometheus)", w=24, h=6):
    return {
        "type": "alertlist",
        "title": title,
        "options": {
            "alertListOptions": {"showOptions": "current"},
            "stateFilter": {"firing": True, "pending": True},
        },
        "datasource": DS,
        "targets": [{"refId": "A", "expr": "ALERTS", "datasource": DS}],
        "_w": w,
        "_h": h,
    }


def table(title, expr, w=24, h=6):
    return {
        "type": "table",
        "title": title,
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


def dashboard(uid, title, panels, description):
    return {
        "uid": uid,
        "title": title,
        "description": description,
        "tags": ["surgeguard", "observability"],
        "timezone": "browser",
        "schemaVersion": 39,
        "version": 1,
        "refresh": "5s",
        "time": {"from": "now-30m", "to": "now"},
        "editable": False,
        "graphTooltip": 1,
        "panels": layout(panels),
        "templating": {"list": []},
        "annotations": {"list": []},
    }


ERR_RATIO = 'sum(rate(demo_requests_total{status=~"5.."}[1m])) / sum(rate(demo_requests_total[1m]))'
P95 = "histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket[1m])))"
P50 = "histogram_quantile(0.50, sum by (le) (rate(demo_request_duration_seconds_bucket[1m])))"
P99 = "histogram_quantile(0.99, sum by (le) (rate(demo_request_duration_seconds_bucket[1m])))"

DASHBOARDS = {
    # 1. SurgeGuard Overview
    "surgeguard-overview": dashboard(
        "surgeguard-overview",
        "SurgeGuard · Overview & System Health",
        [
            row("System Health & Capacity KPIs"),
            stat("Queue Depth", "max(surgeguard_queue_length)", color=ORANGE),
            stat("Admitted Active", "max(surgeguard_admitted_active)", color=GREEN),
            stat(
                "Admissions / s",
                "sum(rate(surgeguard_admissions_total[1m]))",
                "short",
                GREEN,
                2,
            ),
            stat(
                "Healthy Backends",
                "max(surgeguard_backends_healthy)",
                color=GREEN,
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": AMBER, "value": 1},
                    {"color": GREEN, "value": 2},
                ],
            ),
            stat("Origin Error Ratio", ERR_RATIO, "percentunit", RED, 1),
            stat("Origin p95 Latency", P95, "s", AMBER, 2),
            stat(
                "Redis Operational",
                'max(redis_up{job="redis"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": GREEN, "value": 1},
                ],
            ),
            stat(
                "Edge Requests / s",
                "sum(rate(nginx_http_requests_total[1m]))",
                color=BLUE,
            ),
            row("Traffic Throughput & Admissions"),
            ts(
                "Edge vs Origin Throughput",
                [
                    (
                        "sum(rate(nginx_http_requests_total[1m]))",
                        "edge requests (nginx)",
                    ),
                    ("sum(rate(demo_requests_total[1m]))", "admitted origin requests"),
                ],
            ),
            ts(
                "Admission Rate vs Target",
                [
                    (
                        "sum(rate(surgeguard_admissions_total[1m]))",
                        "measured admitted/s",
                    ),
                    ("max(surgeguard_admission_rate_effective)", "effective target/s"),
                    (
                        "max(surgeguard_admission_rate_configured)",
                        "configured target/s",
                    ),
                ],
                color=GREEN,
            ),
            ts(
                "Queue Depth (Waiting Visitors)",
                [("max(surgeguard_queue_length)", "visitors in line")],
                color=ORANGE,
            ),
            ts(
                "Active Admitted (Holding Tokens)",
                [("max(surgeguard_admitted_active)", "active tokens")],
                color=GREEN,
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
            ),
            ts(
                "Queue Wait Time (Join → Admission)",
                [
                    (
                        "histogram_quantile(0.5, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))",
                        "p50",
                    ),
                    (
                        "histogram_quantile(0.95, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))",
                        "p95",
                    ),
                ],
                "s",
                AMBER,
            ),
            row("Scrape Targets & Alert States"),
            table("Scrape Targets Health", "up", w=12, h=6),
            alerts_panel("Active Operational Alerts", w=12, h=6),
        ],
        "Top-level operational overview of the SurgeGuard virtual waiting room, edge proxy, and backend origins.",
    ),
    # 2. Nginx & Traffic
    "surgeguard-backends": dashboard(
        "surgeguard-backends",
        "SurgeGuard · Nginx Edge & Traffic",
        [
            row("Nginx Edge Ingestion"),
            stat(
                "Nginx Edge Requests / s",
                "sum(rate(nginx_http_requests_total[1m]))",
                color=BLUE,
            ),
            stat(
                "Active TCP Connections", "max(nginx_connections_active)", color=GREEN
            ),
            stat("Connections Waiting", "max(nginx_connections_waiting)", color=GREY),
            stat(
                "Nginx Health",
                'max(nginx_up{job="nginx"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": GREEN, "value": 1},
                ],
            ),
            ts(
                "Edge Request Volume (Requests / s)",
                [("sum(rate(nginx_http_requests_total[1m]))", "nginx rps")],
                color=BLUE,
            ),
            ts(
                "Connection States",
                [
                    ("max(nginx_connections_active)", "active"),
                    ("max(nginx_connections_reading)", "reading"),
                    ("max(nginx_connections_writing)", "writing"),
                    ("max(nginx_connections_waiting)", "waiting / idle"),
                ],
            ),
            row("Origin Workload Distribution"),
            ts(
                "Origin Requests / s by Instance",
                [("sum by (origin) (rate(demo_requests_total[1m]))", "{{origin}}")],
                stack=True,
            ),
            ts(
                "Origin Concurrency Slots (In-flight & Pending)",
                [
                    (
                        "sum by (origin) (demo_inflight_requests)",
                        "in-flight {{origin}}",
                    ),
                    (
                        "sum by (origin) (demo_pending_requests)",
                        "pending queue {{origin}}",
                    ),
                ],
            ),
            ts(
                "Origin p95 Latency by Instance",
                [
                    (
                        "histogram_quantile(0.95, sum by (le, origin) (rate(demo_request_duration_seconds_bucket[1m])))",
                        "{{origin}}",
                    ),
                ],
                "s",
                AMBER,
            ),
            ts(
                "Overload Rejections (503) by Instance",
                [
                    (
                        "sum by (origin) (rate(demo_overload_rejections_total[1m]))",
                        "{{origin}}",
                    )
                ],
                color=RED,
            ),
            row("Security & Edge Enforcement"),
            ts(
                "Direct-Origin Bypass Attempts (403)",
                [("sum by (origin) (rate(demo_forbidden_total[1m]))", "{{origin}}")],
                color=RED,
            ),
            ts(
                "Backend Health Check Probing Latency",
                [
                    (
                        "max by (backend) (surgeguard_backend_check_latency_seconds)",
                        "{{backend}}",
                    )
                ],
                "s",
                GREEN,
            ),
        ],
        "Edge traffic handling, connection pools, and per-instance origin health.",
    ),
    # 3. API & Queue
    "surgeguard-queue": dashboard(
        "surgeguard-queue",
        "SurgeGuard · API & Queue Mechanics",
        [
            row("Queue Progression & Admission Velocity"),
            stat("Visitors Waiting", "max(surgeguard_queue_length)", color=ORANGE),
            stat(
                "Admitted Active Tokens", "max(surgeguard_admitted_active)", color=GREEN
            ),
            stat(
                "Measured Admission Rate",
                "sum(rate(surgeguard_admissions_total[1m]))",
                "short",
                GREEN,
                2,
            ),
            stat(
                "Configured Rate",
                "max(surgeguard_admission_rate_configured)",
                "short",
                BLUE,
            ),
            ts(
                "Queue Depth over Time",
                [("max(surgeguard_queue_length)", "waiting visitors")],
                color=ORANGE,
            ),
            ts(
                "Admission Rate (Measured vs Target)",
                [
                    ("sum(rate(surgeguard_admissions_total[1m]))", "measured"),
                    ("max(surgeguard_admission_rate_effective)", "effective"),
                    ("max(surgeguard_admission_rate_configured)", "configured"),
                ],
            ),
            row("Wait Duration & Joins"),
            ts(
                "Queue Wait Time (Join → Admission)",
                [
                    (
                        "histogram_quantile(0.5, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))",
                        "p50 median",
                    ),
                    (
                        "histogram_quantile(0.95, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))",
                        "p95 percentile",
                    ),
                ],
                "s",
                AMBER,
            ),
            ts(
                "Joins by Outcome",
                [
                    (
                        "sum by (mode) (rate(surgeguard_queue_joins_total[1m]))",
                        "{{mode}}",
                    )
                ],
                stack=True,
            ),
            row("Token Lifecycle & Heartbeats"),
            ts(
                "Tokens Minted & Validations",
                [
                    ("sum(rate(surgeguard_tokens_issued_total[1m]))", "issued tokens"),
                    (
                        "sum by (result) (rate(surgeguard_token_validations_total[1m]))",
                        "validation: {{result}}",
                    ),
                ],
            ),
            ts(
                "Token Rejections & Revocations",
                [
                    (
                        "sum by (reason) (rate(surgeguard_token_rejections_total[1m]))",
                        "rejected: {{reason}}",
                    ),
                    ("sum(rate(surgeguard_tokens_revoked_total[1m]))", "revoked"),
                ],
                color=RED,
            ),
            ts(
                "Expired Visitors (Heartbeat Timeout)",
                [
                    (
                        "sum by (reason) (rate(surgeguard_visitors_expired_total[1m]))",
                        "{{reason}}",
                    )
                ],
                color=GREY,
            ),
            ts(
                "Rate-Limited Join Attempts",
                [
                    (
                        "sum by (bucket) (rate(surgeguard_rate_limited_total[1m]))",
                        "{{bucket}}",
                    )
                ],
                color=AMBER,
            ),
        ],
        "Queue progression, token bucket releases, wait times, and token security validations.",
    ),
    # 4. Infrastructure & Resources
    "surgeguard-resources": dashboard(
        "surgeguard-resources",
        "SurgeGuard · Infrastructure & Resources",
        [
            row("Redis Key-Value Telemetry"),
            stat(
                "Redis Available",
                'max(redis_up{job="redis"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": GREEN, "value": 1},
                ],
            ),
            stat(
                "Redis Memory Used",
                'max(redis_memory_used_bytes{job="redis"})',
                "bytes",
                color=BLUE,
            ),
            stat(
                "Connected Clients",
                'max(redis_connected_clients{job="redis"})',
                color=GREEN,
            ),
            stat(
                "Commands / s",
                'sum(rate(redis_commands_total{job="redis"}[1m]))',
                color=ORANGE,
            ),
            ts(
                "Redis Memory Utilization",
                [
                    ('max(redis_memory_used_bytes{job="redis"})', "memory used"),
                    ('max(redis_memory_max_bytes{job="redis"})', "maxmemory ceiling"),
                ],
                "bytes",
                BLUE,
            ),
            ts(
                "Redis Command Throughput",
                [('sum(rate(redis_commands_total{job="redis"}[1m]))', "commands/s")],
                color=ORANGE,
            ),
            ts(
                "Redis Roundtrip PING Latency",
                [
                    (
                        "histogram_quantile(0.5, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[1m])))",
                        "p50",
                    ),
                    (
                        "histogram_quantile(0.95, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[1m])))",
                        "p95",
                    ),
                ],
                "s",
                AMBER,
            ),
            ts(
                "Connected Redis Clients",
                [('max(redis_connected_clients{job="redis"})', "clients")],
                color=GREEN,
            ),
            row("Admission Worker & Probing Engine"),
            stat(
                "Worker Leader",
                "max(surgeguard_worker_is_leader)",
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": GREEN, "value": 1},
                ],
            ),
            stat(
                "Worker Iterations / s",
                "sum(rate(surgeguard_worker_ticks_total[1m]))",
                color=GREEN,
            ),
            stat(
                "Seconds Since Last Tick",
                "time() - max(surgeguard_worker_last_tick_timestamp_seconds)",
                "s",
                AMBER,
            ),
            stat("Healthy Backends", "max(surgeguard_backends_healthy)", color=GREEN),
            ts(
                "Worker Liveness & Heartbeat Age",
                [
                    (
                        "time() - max(surgeguard_worker_last_tick_timestamp_seconds)",
                        "seconds since last tick",
                    ),
                ],
                "s",
                AMBER,
            ),
            ts(
                "Active Probing Latency to Backends",
                [
                    (
                        "max by (backend) (surgeguard_backend_check_latency_seconds)",
                        "{{backend}}",
                    ),
                ],
                "s",
                GREEN,
            ),
        ],
        "Redis memory utilization, command throughput, worker loop cadence, and container infrastructure health.",
    ),
    # 5. Latency & Response Codes
    "surgeguard-latency": dashboard(
        "surgeguard-latency",
        "SurgeGuard · Latency & Error Distribution",
        [
            row("Origin Execution Duration"),
            stat("Median Latency (p50)", P50, "s", GREEN, 3),
            stat("p95 Latency", P95, "s", AMBER, 3),
            stat("Tail Latency (p99)", P99, "s", RED, 3),
            stat("Origin Error Ratio", ERR_RATIO, "percentunit", RED, 1),
            ts(
                "Origin Latency Distributions",
                [
                    (P50, "p50 median"),
                    (P95, "p95 percentile"),
                    (P99, "p99 tail latency"),
                ],
                "s",
                AMBER,
            ),
            ts(
                "Origin Responses by Status Class",
                [
                    (
                        "sum by (status) (rate(demo_requests_total[1m]))",
                        "status {{status}}",
                    ),
                ],
                stack=True,
            ),
            row("API Latency & Response Profiles"),
            ts(
                "SurgeGuard API Latency (p95 by Route)",
                [
                    (
                        "histogram_quantile(0.95, sum by (le, route) (rate(surgeguard_http_request_duration_seconds_bucket[1m])))",
                        "{{route}}",
                    ),
                ],
                "s",
            ),
            ts(
                "SurgeGuard API Responses by Status",
                [
                    (
                        "sum by (status) (rate(surgeguard_http_requests_total[1m]))",
                        "{{status}}",
                    ),
                ],
                stack=True,
            ),
        ],
        "Latency distributions, percentile curves, and response status codes.",
    ),
    # 6. Reliability & Failure Testing
    "surgeguard-failure": dashboard(
        "surgeguard-failure",
        "SurgeGuard · Reliability & Failure Testing",
        [
            row("Dependency Availability Matrix"),
            stat(
                "API Availability",
                'max(up{job="surgeguard-api"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": GREEN, "value": 1},
                ],
            ),
            stat(
                "Worker Availability",
                'max(up{job="admission-worker"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": GREEN, "value": 1},
                ],
            ),
            stat(
                "Redis Availability",
                'max(redis_up{job="redis"})',
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": GREEN, "value": 1},
                ],
            ),
            stat(
                "Healthy Backends",
                "max(surgeguard_backends_healthy)",
                thresholds=[
                    {"color": RED, "value": None},
                    {"color": AMBER, "value": 1},
                    {"color": GREEN, "value": 2},
                ],
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
                color=GREEN,
            ),
            ts(
                "Configured vs Healthy Backends",
                [
                    ("max(surgeguard_backends_healthy)", "healthy origins"),
                    ("max(surgeguard_backends_total)", "configured origins"),
                ],
                color=GREEN,
            ),
            row("Fail-Closed Security & Degradation"),
            ts(
                "Fail-Closed Auth Interceptions",
                [
                    (
                        "sum(rate(surgeguard_auth_fail_closed_total[1m]))",
                        "fail-closed decisions/s",
                    ),
                ],
                color=RED,
            ),
            ts(
                "Admission Paused States (Auto & Manual)",
                [
                    ("max by (kind) (surgeguard_admission_paused)", "paused: {{kind}}"),
                ],
                color=AMBER,
            ),
            ts(
                "Admission Loop Failures by Reason",
                [
                    (
                        "sum by (reason) (rate(surgeguard_admission_failures_total[1m]))",
                        "failure: {{reason}}",
                    ),
                ],
                color=RED,
            ),
            ts(
                "Origin 5xx Overload Ratio",
                [(ERR_RATIO, "5xx error ratio")],
                "percentunit",
                RED,
            ),
            row("Alerting Rules"),
            alerts_panel("Firing & Pending Alert Rules", w=24, h=6),
        ],
        "What happens when dependencies fail, fail-closed enforcement behavior, and recovery speed.",
    ),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, board in DASHBOARDS.items():
        (OUT / f"{name}.json").write_text(json.dumps(board, indent=2) + "\n")
        print(f"wrote {name}.json ({len(board['panels'])} panels)")
