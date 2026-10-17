"""Prometheus metrics. The API and the worker run in separate processes, each with its own
/metrics endpoint; metric names do not overlap between them."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10)

# --------------------------------------------------------------------------- API process
HTTP_REQUESTS = Counter("surgeguard_http_requests_total", "API requests", ["route", "method", "status"])
HTTP_LATENCY = Histogram(
    "surgeguard_http_request_duration_seconds", "API request latency", ["route"], buckets=LATENCY_BUCKETS
)
QUEUE_JOINS = Counter("surgeguard_queue_joins_total", "Queue join calls by outcome", ["mode"])
TOKENS_ISSUED = Counter("surgeguard_tokens_issued_total", "Admission tokens minted for visitors")
TOKEN_VALIDATIONS = Counter("surgeguard_token_validations_total", "Token checks at /internal/auth", ["result"])
TOKEN_REJECTIONS = Counter("surgeguard_token_rejections_total", "Rejected tokens by reason", ["reason"])
TOKENS_REVOKED = Counter("surgeguard_tokens_revoked_total", "Tokens revoked by admin action")
AUTH_FAILCLOSED = Counter(
    "surgeguard_auth_fail_closed_total", "Auth checks refused because a dependency was unavailable"
)
RATE_LIMITED = Counter("surgeguard_rate_limited_total", "Requests refused by the app rate limiter", ["bucket"])

# --------------------------------------------------------------------------- worker process
QUEUE_LENGTH = Gauge("surgeguard_queue_length", "Visitors currently waiting")
ADMITTED_ACTIVE = Gauge("surgeguard_admitted_active", "Visitors holding a non-expired admission token")
ADMISSIONS = Counter("surgeguard_admissions_total", "Visitors admitted")
ADMISSION_FAILURES = Counter("surgeguard_admission_failures_total", "Admission ticks that failed", ["reason"])
EXPIRED = Counter("surgeguard_visitors_expired_total", "Visitors expired by cleanup", ["reason"])
WAIT_TIME = Histogram(
    "surgeguard_queue_wait_seconds",
    "Time from joining to admission",
    buckets=(1, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600),
)
CONFIGURED_RATE = Gauge("surgeguard_admission_rate_configured", "Configured admissions per second")
EFFECTIVE_RATE = Gauge("surgeguard_admission_rate_effective", "Admissions per second after health policy")
PAUSED = Gauge("surgeguard_admission_paused", "1 if admission is paused", ["kind"])
WORKER_LEADER = Gauge("surgeguard_worker_is_leader", "1 if this worker holds the leader lock")
WORKER_TICKS = Counter("surgeguard_worker_ticks_total", "Worker loop iterations")
WORKER_LAST_TICK = Gauge("surgeguard_worker_last_tick_timestamp_seconds", "Unix time of the last completed tick")
REDIS_UP = Gauge("surgeguard_redis_up", "1 if the worker reached Redis on the last tick")
REDIS_LATENCY = Histogram(
    "surgeguard_redis_ping_seconds",
    "Redis PING latency from the worker",
    buckets=(0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25),
)
BACKEND_UP = Gauge("surgeguard_backend_up", "1 if the backend passed active health checks", ["backend"])
BACKEND_CHECK_LATENCY = Gauge(
    "surgeguard_backend_check_latency_seconds", "Latency of the last active health check", ["backend"]
)
BACKENDS_HEALTHY = Gauge("surgeguard_backends_healthy", "Number of healthy backends")
BACKENDS_TOTAL = Gauge("surgeguard_backends_total", "Number of configured backends")
