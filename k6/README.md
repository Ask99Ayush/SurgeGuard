# SurgeGuard Performance Testing Suite (k6)

This directory contains the production-grade k6 performance testing suite for SurgeGuard. It is engineered to validate and contrast the behaviors of **Demo 1 (Guarded — SurgeGuard Protected)** versus **Demo 2 (Unguarded — Raw Origin Under Load)**.

---

## 1. Architecture & Endpoints

SurgeGuard protects high-stakes web applications against sudden concurrency surges using a token-bucket virtual waiting room backed by Redis and validated in sub-millisecond time at the Nginx edge.

| Surface | Default Domain / Port | Internal Route | Protection Role |
| :--- | :--- | :--- | :--- |
| **Demo 1 — Guarded** | `https://surgeguard-protected.duckdns.org` (or `:8443` / `https://localhost:8080`) | `/` &rarr; `auth_request /_sg_auth` &rarr; `origin_pool` (`demo-1`, `demo-2`) | **PROTECTED**: Intercepted by Nginx edge gate. Visitors without valid HMAC tokens receive HTTP 302 &rarr; `/waiting-room`. Admitted visitors browse with **zero HTTP 503 drops**. |
| **Demo 2 — Unguarded** | `https://surgeguard-direct.duckdns.org` (or `:8443` / `http://127.0.0.1:8081`) | `/` &rarr; `origin_direct` (`demo-direct`) | **UNGUARDED**: Bypasses queue. Concurrency is limited by application semaphore (`DEMO_MAX_CONCURRENCY=8`). Excess load triggers genuine **HTTP 503 Service Overloaded**. |
| **Control Center** | `https://surgeguard-innotech.duckdns.org` (or `http://localhost:3000`) | `/dashboard`, `/live`, `/demo` | Real-time queue visualizer, side-by-side comparison dashboard, admission rate controls, and manual pause/resume. |
| **Grafana Metrics** | `https://surgeguard-monitor.duckdns.org` (or `http://localhost:3001`) | Prometheus Grafana | Real-time SRE dashboards for origin latency, queue length, and 503 drops. |

---

## 2. Directory Structure

```text
k6/
├── README.md               # This documentation guide
├── config/
│   └── options.js          # Centralized configuration, safety limits, metrics, and queue helpers
├── scripts/
│   ├── smoke.js            # Minimal reachability and status verification (1 VU)
│   ├── live-demo.js        # SIMULTANEOUS guarded + unguarded surge (Live Demo)
│   ├── comparison.js       # Sequential comparison run (no resource contention)
│   ├── unguarded-load.js   # Controlled load test against raw direct origin
│   └── guarded-load.js     # Load test exercising waiting room join, polling, and admitted access
└── results/
    ├── live-demo-report.md # Markdown comparison report from live demonstration
    ├── live-demo-result.json # Raw machine-readable JSON metrics
    └── .gitkeep
```

---

## 3. Quick Start & Demonstration Commands

All scripts default to the real public DuckDNS domains. You can override them via environment variables at any time.

### A. Smoke Test (Reachability & Authentication Gate)

Validates that both domains are healthy, unauthenticated visitors are redirected to the waiting room, and queue polling functions correctly.

```bash
# Using native k6 with repository TLS certificate:
k6 run --ca-cert certs/surgeguard.crt k6/scripts/smoke.js

# Using Docker Compose:
docker compose --profile loadtest run --rm k6 run scripts/smoke.js
```

### B. Simultaneous Live Demonstration (Primary Demo Command)

Runs two independent scenarios **concurrently**:
- **Scenario A (Unguarded)**: Sends surge traffic directly to the unprotected origin. Triggers real HTTP 503 drops and high latency under controlled load.
- **Scenario B (Guarded)**: Sends equivalent traffic through SurgeGuard. Visitors join the waiting room, are admitted at origin capacity, and browse with zero 503 rejections.

```bash
# Single command to launch the live simultaneous demonstration:
k6 run --ca-cert certs/surgeguard.crt k6/scripts/live-demo.js

# Using Docker Compose (on EC2):
docker compose --profile loadtest run --rm k6 run scripts/live-demo.js
```

### C. Unguarded-Only Load Test

Demonstrates origin saturation and HTTP 503 drops on the direct origin without queueing:

```bash
k6 run --ca-cert certs/surgeguard.crt k6/scripts/unguarded-load.js
```

### D. Guarded-Only Load Test

Demonstrates token-bucket virtual queueing, session persistence, and zero drops at origin:

```bash
k6 run --ca-cert certs/surgeguard.crt k6/scripts/guarded-load.js
```

### E. Sequential Comparison Test

Runs Unguarded first, cools down for 5 seconds, then runs Guarded:

```bash
k6 run --ca-cert certs/surgeguard.crt k6/scripts/comparison.js
```

---

## 4. Configurable Environment Variables & Safe Tuning

All load settings are safely bounded and configurable via environment variables:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `GUARDED_URL` | `https://surgeguard-protected.duckdns.org` | Entry point for SurgeGuard protected gateway. |
| `UNGUARDED_URL` | `https://surgeguard-direct.duckdns.org` | Entry point for raw unprotected demo origin. |
| `VUS` | `10` | Default concurrency (virtual users) for scenarios. |
| `UNGUARDED_VUS` | `10` | Concurrency for the unguarded scenario in `live-demo.js`. |
| `GUARDED_VUS` | `10` | Concurrency for the guarded scenario in `live-demo.js`. |
| `MAX_VUS` | `100` | Hard safety ceiling to avoid exhausting host CPU/memory. |
| `RAMP` | `10s` | Ramp-up duration to target VUs. |
| `HOLD` | `25s` | Duration at peak sustained concurrency. |
| `COOLDOWN` | `5s` | Cooldown duration before stopping. |
| `THINK` | `0.5` | Pacing delay between requests per VU (seconds). |
| `MAX_QUEUE_WAIT` | `60` | Maximum queue wait time before visitor timeout (seconds). |
| `REQUEST_TIMEOUT` | `15s` | Per-request network timeout. |
| `INSECURE_TLS` | `false` | Set `true` only if self-signed CA cannot be passed. |

### Adjusting Traffic Intensity Safely

To scale up load safely without crashing host services:

```bash
# Moderate surge demonstration (15 VUs unguarded, 15 VUs guarded, 30s hold):
k6 run \
  --ca-cert certs/surgeguard.crt \
  -e UNGUARDED_VUS=15 \
  -e GUARDED_VUS=15 \
  -e HOLD=30s \
  k6/scripts/live-demo.js

# Stress demonstration (25 VUs, 45s hold):
k6 run \
  --ca-cert certs/surgeguard.crt \
  -e UNGUARDED_VUS=25 \
  -e GUARDED_VUS=25 \
  -e HOLD=45s \
  k6/scripts/live-demo.js
```

> **Safety Warning:** Do not set `VUS` > 100 on t3.medium EC2 instances. The hard ceiling `MAX_VUS=100` prevents accidental host resource exhaustion.

---

## 5. Generating the Comparison Report

When `k6/scripts/live-demo.js` executes, it automatically generates two output files:

1. **`k6/results/live-demo-result.json`**: Structured JSON containing latency percentiles (p50, p95, p99), response counts (200, 503, connection errors), queue wait times, and status determinations.
2. **`k6/results/live-demo-report.md`**: Markdown report detailing the side-by-side findings, configuration, and verification notes.

To view the generated report after a run:

```bash
cat k6/results/live-demo-report.md
```

---

## 6. Expected Outcomes & Verification Criteria

| Test Outcome | DEMO 2 — Unguarded | DEMO 1 — Guarded |
| :--- | :--- | :--- |
| **Edge Gate** | Direct passthrough (no token check) | HTTP 302 &rarr; `/waiting-room` |
| **Queueing** | None | FIFO queue in Redis via Lua token bucket |
| **Origin Concurrency** | Saturated (`DEMO_MAX_CONCURRENCY=8`) | Controlled (`ADMISSION_RATE=10/s`) |
| **HTTP 503 Responses** | **Yes** (genuine semaphore rejections under load) | **0** (origin operates within capacity) |
| **Response Latency (p95)**| **Elevated** (queue timeout backpressure: ~1500ms) | **Optimal** (~120-180ms once admitted) |
| **Final Status** | **DEGRADED / DOWN** | **UP / PROTECTED** |

---

## 7. Troubleshooting & Health Verification

1. **Verify Edge Gateway Health**:
   ```bash
   curl -k -s https://surgeguard-protected.duckdns.org/healthz
   ```

2. **Verify Unguarded Direct Origin Health**:
   ```bash
   curl -k -s https://surgeguard-direct.duckdns.org/health
   ```

3. **Reset Redis Queue State**:
   ```bash
   make reset-queue
   ```
