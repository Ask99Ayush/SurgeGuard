"""Generate the provisioned Grafana dashboards from a compact spec.

    python monitoring/grafana/generate_dashboards.py

Every panel is a live Prometheus query; there is no static or sample data in any dashboard.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).parent / "dashboards"
DS = {"type": "prometheus", "uid": "prometheus"}
CORAL, GREEN, AMBER, RED, GREY = "#ff5c65", "#43c98b", "#f2b84b", "#ff626b", "#96979d"


def stat(title, expr, unit="short", color=GREY, decimals=None, thresholds=None):
    return {
        "type": "stat",
        "title": title,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "datasource": DS}],
        "options": {"colorMode": "value", "graphMode": "area", "reduceOptions": {"calcs": ["lastNotNull"]}},
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": decimals,
                "noValue": "no data",
                "color": {"mode": "thresholds" if thresholds else "fixed", "fixedColor": color},
                "thresholds": {"mode": "absolute", "steps": thresholds or [{"color": color, "value": None}]},
            },
            "overrides": [],
        },
        "_w": 6,
        "_h": 4,
    }


def ts(title, targets, unit="short", color=CORAL, w=12, stack=False):
    return {
        "type": "timeseries",
        "title": title,
        "datasource": DS,
        "targets": [
            {"refId": chr(65 + i), "expr": expr, "legendFormat": legend, "datasource": DS}
            for i, (expr, legend) in enumerate(targets)
        ],
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "noValue": "no data",
                "color": {"mode": "fixed", "fixedColor": color} if len(targets) == 1 else {"mode": "palette-classic"},
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
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}},
        "_w": w,
        "_h": 8,
    }


def alerts_panel():
    return {
        "type": "alertlist",
        "title": "Alert rules (Prometheus)",
        "options": {"alertListOptions": {"showOptions": "current"}, "stateFilter": {"firing": True, "pending": True}},
        "datasource": DS,
        "targets": [{"refId": "A", "expr": "ALERTS", "datasource": DS}],
        "_w": 24,
        "_h": 6,
    }


def table(title, expr, w=24):
    return {
        "type": "table",
        "title": title,
        "datasource": DS,
        "targets": [{"refId": "A", "expr": expr, "format": "table", "instant": True, "datasource": DS}],
        "fieldConfig": {"defaults": {"noValue": "no data"}, "overrides": []},
        "_w": w,
        "_h": 6,
    }


def layout(panels):
    x = y = row_h = 0
    out = []
    for i, p in enumerate(panels, start=1):
        w, h = p.pop("_w"), p.pop("_h")
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
        "tags": ["surgeguard"],
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

DASHBOARDS = {
    "surgeguard-overview": dashboard(
        "surgeguard-overview",
        "SurgeGuard · System health",
        [
            stat("Queue length", "max(surgeguard_queue_length)", color=CORAL),
            stat("Admissions / s", "sum(rate(surgeguard_admissions_total[1m]))", "short", GREEN, 2),
            stat("Healthy backends", "max(surgeguard_backends_healthy)", color=GREEN,
                 thresholds=[{"color": RED, "value": None}, {"color": AMBER, "value": 1}, {"color": GREEN, "value": 2}]),
            stat("Redis", 'max(redis_up{job="redis"})',
                 thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}]),
            stat("Origin error ratio", ERR_RATIO, "percentunit", RED, 1),
            stat("Origin p95 latency", P95, "s", AMBER, 2),
            stat("Worker is leader", "max(surgeguard_worker_is_leader)",
                 thresholds=[{"color": RED, "value": None}, {"color": GREEN, "value": 1}]),
            stat("Scrape targets up", "sum(up)", color=GREEN),
            ts("Queue length", [("max(surgeguard_queue_length)", "waiting")]),
            ts("Admission rate", [("sum(rate(surgeguard_admissions_total[1m]))", "admitted/s"),
                                  ("max(surgeguard_admission_rate_effective)", "effective target/s")], color=GREEN),
            table("Scrape targets", "up"),
            alerts_panel(),
        ],
        "Top-level health of the queue, admission, backends and dependencies.",
    ),
    "surgeguard-queue": dashboard(
        "surgeguard-queue",
        "SurgeGuard · Queue and admission",
        [
            ts("Queue length", [("max(surgeguard_queue_length)", "waiting")]),
            ts("Active admitted (valid tokens)", [("max(surgeguard_admitted_active)", "active")], color=GREEN),
            ts("Admissions per second", [("sum(rate(surgeguard_admissions_total[1m]))", "measured"),
                                         ("max(surgeguard_admission_rate_configured)", "configured"),
                                         ("max(surgeguard_admission_rate_effective)", "effective")]),
            ts("Queue wait (join → admission)", [
                ("histogram_quantile(0.5, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))", "p50"),
                ("histogram_quantile(0.95, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))", "p95"),
            ], "s", AMBER),
            ts("Joins by outcome", [("sum by (mode) (rate(surgeguard_queue_joins_total[1m]))", "{{mode}}")], stack=True),
            ts("Expired visitors", [("sum by (reason) (rate(surgeguard_visitors_expired_total[1m]))", "{{reason}}")], color=GREY),
            ts("Tokens issued / validated", [
                ("sum(rate(surgeguard_tokens_issued_total[1m]))", "issued"),
                ("sum by (result) (rate(surgeguard_token_validations_total[1m]))", "validate: {{result}}"),
            ]),
            ts("Token rejections and revocations", [
                ("sum by (reason) (rate(surgeguard_token_rejections_total[1m]))", "rejected: {{reason}}"),
                ("sum(rate(surgeguard_tokens_revoked_total[1m]))", "revoked"),
            ], color=RED),
            ts("Paused", [("max by (kind) (surgeguard_admission_paused)", "{{kind}}")], color=AMBER),
            ts("Rate-limited join attempts", [("sum by (bucket) (rate(surgeguard_rate_limited_total[1m]))", "{{bucket}}")], color=AMBER),
        ],
        "Queue size, measured admission throughput, wait time and token decisions.",
    ),
    "surgeguard-backends": dashboard(
        "surgeguard-backends",
        "SurgeGuard · Backend performance",
        [
            ts("Origin requests / s by instance", [("sum by (origin) (rate(demo_requests_total[1m]))", "{{origin}}")], stack=True),
            ts("Origin in-flight / pending", [("sum by (origin) (demo_inflight_requests)", "in-flight {{origin}}"),
                                              ("sum by (origin) (demo_pending_requests)", "pending {{origin}}")]),
            ts("Origin p95 latency by instance", [
                ("histogram_quantile(0.95, sum by (le, origin) (rate(demo_request_duration_seconds_bucket[1m])))", "{{origin}}"),
            ], "s", AMBER),
            ts("Overload rejections (503) by instance",
               [("sum by (origin) (rate(demo_overload_rejections_total[1m]))", "{{origin}}")], color=RED),
            ts("Active health check result", [("max by (backend) (surgeguard_backend_up)", "{{backend}}")], color=GREEN),
            ts("Active health check latency", [("max by (backend) (surgeguard_backend_check_latency_seconds)", "{{backend}}")], "s"),
            ts("Direct-origin bypass attempts (403)", [("sum by (origin) (rate(demo_forbidden_total[1m]))", "{{origin}}")], color=RED),
            ts("Edge (Nginx) requests / s", [("sum(rate(nginx_http_requests_total[1m]))", "requests/s"),
                                             ("max(nginx_connections_active)", "active connections")], color=GREY),
        ],
        "Load and health of each protected origin instance.",
    ),
    "surgeguard-latency": dashboard(
        "surgeguard-latency",
        "SurgeGuard · Latency and errors",
        [
            ts("Origin latency percentiles", [
                ("histogram_quantile(0.5, sum by (le) (rate(demo_request_duration_seconds_bucket[1m])))", "p50"),
                ("histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket[1m])))", "p95"),
                ("histogram_quantile(0.99, sum by (le) (rate(demo_request_duration_seconds_bucket[1m])))", "p99"),
            ], "s", AMBER),
            ts("Origin responses by status", [("sum by (status) (rate(demo_requests_total[1m]))", "{{status}}")], stack=True),
            ts("Origin error ratio", [(ERR_RATIO, "5xx share")], "percentunit", RED),
            ts("SurgeGuard API latency p95 by route", [
                ("histogram_quantile(0.95, sum by (le, route) (rate(surgeguard_http_request_duration_seconds_bucket[1m])))", "{{route}}"),
            ], "s"),
            ts("SurgeGuard API responses by status", [("sum by (status) (rate(surgeguard_http_requests_total[1m]))", "{{status}}")], stack=True),
            ts("Redis PING latency p95 (worker)", [
                ("histogram_quantile(0.95, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[1m])))", "p95"),
            ], "s", GREY),
        ],
        "Latency distributions and error rates at the origin and in SurgeGuard itself.",
    ),
    "surgeguard-failure": dashboard(
        "surgeguard-failure",
        "SurgeGuard · Failure and recovery",
        [
            ts("Healthy backends", [("max(surgeguard_backends_healthy)", "healthy"), ("max(surgeguard_backends_total)", "configured")], color=GREEN),
            ts("Admission paused", [("max by (kind) (surgeguard_admission_paused)", "{{kind}}")], color=AMBER),
            ts("Admission failures", [("sum by (reason) (rate(surgeguard_admission_failures_total[1m]))", "{{reason}}")], color=RED),
            ts("Fail-closed auth decisions", [("sum(rate(surgeguard_auth_fail_closed_total[1m]))", "fail-closed/s")], color=RED),
            ts("Dependency up", [('max(redis_up{job="redis"})', "redis (exporter)"),
                                 ('max(surgeguard_redis_up{job="admission-worker"})', "redis (worker)"),
                                 ('max(up{job="surgeguard-api"})', "api"), ('max(up{job="admission-worker"})', "worker")], color=GREEN),
            ts("Seconds since last worker tick", [("time() - max(surgeguard_worker_last_tick_timestamp_seconds)", "seconds")], "s", AMBER),
            alerts_panel(),
        ],
        "What happens when a backend, Redis or the worker fails, and how fast it recovers.",
    ),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, board in DASHBOARDS.items():
        (OUT / f"{name}.json").write_text(json.dumps(board, indent=2) + "\n")
        print(f"wrote {name}.json ({len(board['panels'])} panels)")
