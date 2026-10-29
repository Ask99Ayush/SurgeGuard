# SurgeGuard Performance Testing Suite (k6)

This directory contains the production-grade k6 performance testing suite for SurgeGuard. It is engineered to validate and contrast the behaviors of **Demo 1 (Guarded — SurgeGuard Protected)** versus **Demo 2 (Unguarded — Raw Origin Under Load)**.

---

## 1. Architecture & Endpoints

SurgeGuard protects high-stakes web applications against sudden concurrency surges using a token-bucket virtual waiting room backed by Redis and validated in sub-millisecond time at Nginx edge.

| Surface | Port / Hostname | Path / Routing | Architecture Role |
| :--- | :--- | :--- | :--- |
| **Demo 1 — Guarded** | `https://localhost:8080` (or `https://surgeguard-protected.duckdns.org:8443`) | `/` &rarr; `auth_request /_sg_auth` &rarr; `origin_pool` (`demo-1`, `demo-2`) | Intercepted by Nginx edge. Unauthenticated visitors enter virtual waiting room (`/waiting-room`), receive cryptographic admission tokens, and access protected origins with **zero HTTP 503 drops**. |
| **Demo 2 — Unguarded** | `http://localhost:8081` (or `https://surgeguard-direct.duckdns.org:8443`) | `/` &rarr; `origin_direct` (`demo-direct`) | Bypasses admission gate. Concurrency is capped at `DEMO_MAX_CONCURRENCY` (default 8). Excess concurrent requests wait up to `DEMO_QUEUE_TIMEOUT_MS` (default 1500ms) before returning **HTTP 503 Service Overloaded**. |
| **Admin Console** | `http://localhost:3000/dashboard` | Next.js operator UI | Real-time queue visualizer, rate adjustment, and manual pause/resume. |
| **Grafana Metrics** | `http://localhost:3001` | Prometheus Grafana | Real-time SRE dashboards for origin latency, queue length, and 503 drops. |

---

## 2. Directory Structure

```text
k6/
├── README.md               # This documentation guide
├── config/
│   └── options.js          # Centralized configuration, safety limits, metrics, and queue helpers
├── scripts/
│   ├── smoke.js            # Minimal reachability and status verification (1 VU)
│   ├── unguarded-load.js   # Controlled load test against the raw direct origin
│   ├── guarded-load.js     # Load test exercising waiting room join, polling, and admitted access
│   └── comparison.js       # Sequential comparison run avoiding host resource contention
└── results/
    └── .gitkeep            # Directory for non-sensitive JSON test summaries
```

---

## 3. Prerequisites & Execution Methods

### Option A: Via Docker Compose (Recommended on EC2 / Linux)

The `docker-compose.yml` stack includes an isolated `k6` container service attached to the `edge` network with `./certs:/certs:ro` mounted for seamless CA verification:

```bash
# Ensure services are up
docker compose up -d

# Run Smoke Test
docker compose --profile loadtest run --rm k6 run scripts/smoke.js

# Run Unguarded Load Test
docker compose --profile loadtest run --rm k6 run scripts/unguarded-load.js

# Run Guarded Load Test
docker compose --profile loadtest run --rm k6 run scripts/guarded-load.js

# Run Sequential Comparison Test
docker compose --profile loadtest run --rm k6 run scripts/comparison.js
```

### Option B: Via Native k6 CLI (Local Machine)

If `k6` is installed on your local workstation:

```bash
cd k6

# 1. Smoke test (validates both endpoints)
k6 run --ca-cert ../certs/surgeguard.crt scripts/smoke.js

# 2. Unguarded load test (targets direct origin :8081)
k6 run scripts/unguarded-load.js

# 3. Guarded load test (targets protected gateway :8080)
k6 run --ca-cert ../certs/surgeguard.crt scripts/guarded-load.js

# 4. Sequential comparison test
k6 run --ca-cert ../certs/surgeguard.crt scripts/comparison.js
```

---

## 4. Configurable Environment Variables

All scripts are conservative by default and configurable through environment variables:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `GUARDED_URL` | `https://localhost:8080` | Entry point for SurgeGuard protected gateway. |
| `UNGUARDED_URL` | `http://127.0.0.1:8081` | Entry point for raw unprotected demo origin. |
| `VUS` | `10` | Concurrency (virtual users) during test hold phases. |
| `MAX_VUS` | `100` | Hard safety ceiling to avoid exhausting EC2 or host memory. |
| `RAMP` | `10s` | Ramp-up duration to target VUs. |
| `HOLD` | `25s` | Hold duration at peak concurrency. |
| `THINK` | `0.5` | Pacing delay between page views per VU in seconds. |
| `MAX_QUEUE_WAIT` | `60` | Maximum seconds a VU will wait in queue before timing out. |
| `INSECURE_TLS` | `false` | Set to `true` only if self-signed CA cannot be passed. |
| `SSL_CERT_FILE` | `/certs/surgeguard.crt` | Path to repository test CA cert for TLS verification. |

### Example Custom Execution

```bash
# Conservative test with 15 VUs and 30s hold targeting DuckDNS domain with test CA:
k6 run \
  --ca-cert certs/surgeguard.crt \
  -e GUARDED_URL=https://surgeguard-protected.duckdns.org:8443 \
  -e UNGUARDED_URL=https://surgeguard-direct.duckdns.org:8443 \
  -e VUS=15 \
  -e HOLD=30s \
  scripts/comparison.js
```

---

## 5. Expected Behaviors & Observability

### Demo 1 (Guarded)
- **Edge Authentication**: Initial visit without valid admission credentials receives an HTTP `302 Found` redirecting to `/waiting-room`.
- **Deterministic Queueing**: The visitor calls `POST /api/v1/queue/join` and begins heartbeat polling at `GET /api/v1/queue/status`.
- **Admission Outcome**: The background worker admits visitors at `ADMISSION_RATE` (default 10/s) using an atomic Redis Lua token bucket.
- **Origin Performance**: Once admitted, requests receive an HTTP `200 OK` statement of examination marks. **Zero HTTP 503 errors occur at the origin.**

### Demo 2 (Unguarded)
- **Direct Entry**: Requests pass straight through Nginx without token verification.
- **Controlled Saturation**: Concurrency ceiling `DEMO_MAX_CONCURRENCY=8` limits simultaneous database simulation tasks.
- **Rejection Behavior**: When concurrency exceeds 8, queued requests time out after `DEMO_QUEUE_TIMEOUT_MS` (1.5s), triggering intentional `HTTP 503 Service Overloaded` responses.
- **Immediate Recovery**: Once test load ceases, semaphore slots free up and origin response times immediately recover back to baseline (~150ms).

---

## 6. Safety, Isolation, and Troubleshooting

1. **Independent Upstreams**:
   - Guarded traffic routes to `origin_pool` (`demo-1`, `demo-2`).
   - Unguarded traffic routes to `origin_direct` (`demo-direct`).
   - Saturating Demo 2 does not exhaust Demo 1's work slots or trigger admission auto-pausing.
2. **Sequential Comparison Phases**:
   - `scripts/comparison.js` automatically computes sequential execution timing so Phase 1 (Unguarded) completes entirely before Phase 2 (Guarded) starts.
   - A 5-second cooldown gap ensures host CPU and memory return to baseline before Phase 2 begins.
3. **Stopping a Test**:
   - Interrupt test execution at any time using `Ctrl + C`.
   - The origin semaphore releases in-flight slots gracefully.
4. **Resetting Queue State**:
   If needed, reset the SurgeGuard queue in Redis:
   ```bash
   make reset-queue
   ```
5. **Verifying Health**:
   ```bash
   curl -k -s https://localhost:8080/healthz   # Nginx edge health
   curl -s http://127.0.0.1:8081/health      # Unguarded demo health
   ```
