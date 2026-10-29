<div align="center">

# 📐 SurgeGuard — System Architecture

### <i>End-to-End Traffic Control, Atomic State Machine & Fenced Worker Admission</i>

**In-depth architectural specification covering network topologies, visitor state machines, Lua queue algorithms, and reverse-proxy subrequest enforcement.**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Redis](https://img.shields.io/badge/Redis-7.4_AOF-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Nginx](https://img.shields.io/badge/Nginx-1.28-009639?style=for-the-badge&logo=nginx&logoColor=white)](https://nginx.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)

<br/>

[🛡️ Main README](../README.md) • [🔒 Security](security.md) • [⚙️ Configuration](configuration.md) • [🚀 Deployment](deployment.md)

</div>

---

<div align="center">

### <i>"Decoupled ingress, atomic queue mutations, and dynamic health-aware admission rates."</i>

</div>

---

## 📑 Clickable Table of Contents

- [📐 1. Architectural Topology](#1-architectural-topology)
- [🌐 2. Isolated Docker Network Segmentation](#2-isolated-docker-network-segmentation)
- [🔄 3. Detailed Request Lifecycle](#3-detailed-request-lifecycle)
- [🔀 4. Visitor State Machine & Atomic Lua Transitions](#4-visitor-state-machine-atomic-lua-transitions)
- [⚙️ 5. Autonomous Admission Worker & Fenced Leader Lock](#5-autonomous-admission-worker-fenced-leader-lock)
- [🛡️ 6. Proxy Behavior Matrix (Nginx Open Source 1.28)](#6-proxy-behavior-matrix-nginx-open-source-128)
- [📈 7. Observability & Telemetry Architecture](#7-observability-telemetry-architecture)
- [🔄 8. Failure Modes & Self-Healing Guarantees](#8-failure-modes-self-healing-guarantees)

---

## 📐 1. Architectural Topology

SurgeGuard decouples network edge routing, queue state management, backend execution, and observability into independent, horizontally scalable subsystems:

```mermaid
flowchart LR
    V["👤 Visitors"] -->|:8080 protected| N["🛡️ Nginx Edge Gateway"]
    V -.->|:8081 unprotected (local)| N
    A["👨‍💻 SRE Operator"] -->|:3000| F["🖥️ Next.js Console"]

    N -->|auth_request /internal/auth| API["⚡ FastAPI Queue API"]
    N -->|/waiting-room, /_next| F
    N -->|/api/v1/queue/*| API
    N -->|valid token + X-Origin-Key| O1["🎯 demo-1 Backend"]
    N -->|valid token + X-Origin-Key| O2["🎯 demo-2 Backend"]

    API <-->|atomic Lua scripts| R[("💾 Redis 7.4 (AOF)")]
    W["⚙️ Admission Worker"] <-->|leader lock + admit.lua| R
    W -->|active health checks (2s)| O1 & O2

    F -->|X-Admin-Key (server-side only)| API
    F -->|named PromQL queries| P["📊 Prometheus"]
    P --> G["📈 Grafana Dashboards"]
```

---

## 🌐 2. Isolated Docker Network Segmentation

SurgeGuard enforces strict boundary isolation using four isolated Docker bridge networks:

| Docker Network | Attached Services | Ingress / Exposure Rules |
| :--- | :--- | :--- |
| **`edge`** | `nginx`, `frontend` | Publishes public ports `80`, `443`, `8088`, and `3000`. Direct entry point for Internet visitors. |
| **`app`** | `nginx`, `api`, `frontend`, `worker`, `prometheus` | Internal application communications; routes subrequests from Nginx to FastAPI `/internal/auth`. |
| **`data`** | `api`, `worker`, `redis`, `redis_exporter` | **STRICTLY PRIVATE**. Redis is completely unexposed to the host and proxy; only API and Worker can connect. |
| **`origin`** | `nginx`, `demo-1`, `demo-2`, `worker`, `prometheus` | **STRICTLY PRIVATE**. Origin backends accept traffic solely through Nginx with the verified `X-Origin-Key`. |

---

## 🔄 3. Detailed Request Lifecycle

```
[ Visitor Request ]
        │
        ▼
   1. Nginx checks auth_request /_sg_auth
        ├── (Token Valid: 204) ───────────────────────────┐
        └── (No Token: 401) ─┐                            │
                             ▼                            ▼
                 2. Redirect /waiting-room    8. Nginx injects X-Origin-Key
                             │                            │
                             ▼                            ▼
                 3. POST /api/v1/queue/join   9. Origin serves application
                    - Monotonic sequence                  │
                    - Issues sg_vid cookie                ▼
                             │                 10. Visitor completes session
                             ▼
                 4. GET /api/v1/queue/status (poll)
                    - Refreshes heartbeat
                    - Calculates exact ZRANK
                             │
                             ▼
                 5. Worker admit.lua promotes visitor
                             │
                             ▼
                 6. Status poll mints JWT token (sg_admission)
                             │
                             ▼
                 7. Browser redirected to / (Origin page)
```

1. **Gatekeeper Interception:** Visitor requests protected route. Nginx invokes `auth_request /_sg_auth`.
2. **Waiting Room Redirection:** Missing or invalid token returns `401 Unauthorized`. Nginx responds with `302 /waiting-room`.
3. **Queue Entry:** Waiting room calls `POST /api/v1/queue/join`. API issues an HMAC-signed visitor cookie (`sg_vid`) and executes `join.lua`, adding the user to the Redis sorted set (`ZSET`) keyed by server sequence (`INCR`).
4. **Heartbeat & Status Polling:** Browser polls `/api/v1/queue/status` every 3s. Each poll updates the heartbeat score in Redis and calculates exact queue rank (`ZRANK + 1`).
5. **Worker Promotion:** Admission worker executes `admit.lua`, drawing from the token bucket to promote the next $N$ visitors and marking them admitted with a unique `jti`.
6. **Token Issuance:** Next status poll recognizes the admission state, mints a signed JWT (`HS256`, `kid` header), and sets it as `sg_admission` (`HttpOnly`, `SameSite=Lax`).
7. **Protected Origin Access:** Browser redirects to `/`. Nginx verifies the token and forwards request to the backend with injected `X-Origin-Key` and `X-SG-Visitor`.

---

## 🔀 4. Visitor State Machine & Atomic Lua Transitions

Every state transition is wrapped in a dedicated, atomic Redis Lua script, eliminating race conditions under massive concurrent operations:

| Initial State | Target State | Triggering Action | Lua Script | State Guarantees |
| :--- | :--- | :--- | :--- | :--- |
| *(unregistered)* | **`waiting`** | User calls `/join` | `join.lua` | Monotonic server-side `INCR`; duplicate calls return identical sequence (idempotent). |
| **`waiting`** | **`waiting`** | Status poll heartbeat | `status.lua` | Updates heartbeat score; refreshes position estimate. |
| **`waiting`** | **`admitted`** | Worker promotion | `admit.lua` | Atomic `ZPOPMIN`; assigns unique `jti` and sets admission TTL. |
| **`waiting`** | **`expired`** | Inactivity timeout | `expire.lua` | Heartbeat silence > `HEARTBEAT_TIMEOUT_SECONDS` (30s) drops user. |
| **`expired`** | **`waiting`** | Re-join within grace | `join.lua` | User returning within `REJOIN_GRACE_SECONDS` (60s) preserves sequence. |
| **`admitted`** | **`expired`** | Token lifetime ends | `expire.lua` | User must re-join queue to start a new browsing session. |
| **Any** | **`rejected`** | Admin operator ban | `reject.lua` | Token `jti` added to Redis revocation set; terminal state. |

---

## ⚙️ 5. Autonomous Admission Worker & Fenced Leader Lock

The admission worker runs as an independent daemon (`python -m app.workers.admission_worker`):

* **Distributed Leader Lock:** Acquires `P:worker:leader` via Redis `SET NX PX` with a 5-second TTL. Renewed on every tick.
* **Cryptographic Fencing:** When calling `admit.lua`, the worker passes its unique lock ownership token. The Lua script evaluates lock ownership before executing any promotions. A stalled former leader is mathematically incapable of admitting visitors.
* **Persistent Token Bucket:** The admission token bucket is stored in Redis state (`ADMISSION_RATE` refill, `ADMISSION_BURST` capacity), surviving worker restarts without rate spikes.
* **Dynamic Health Policy:** Worker performs active `GET /health` probes on backend containers every 2 seconds with hysteresis (2 failures down, 2 successes up):
  $$\text{Effective Rate} = \text{Configured Rate} \times \frac{\text{Healthy Backends}}{\text{Total Backends}}$$
  If all backends fail, admission automatically pauses (`P:auto_paused`).

---

## 🛡️ 6. Proxy Behavior Matrix (Nginx Open Source 1.28)

| Functional Concern | Architectural Implementation |
| :--- | :--- |
| **Token Verification** | `auth_request /_sg_auth` → FastAPI `/internal/auth`. HTTP 204 proceeds; 401 redirects to `/waiting-room`; 5xx fails closed to 503 page. |
| **Header Stripping** | Nginx explicitly overwrites client-supplied `X-SG-Proxy-Secret`, `X-Origin-Key`, `X-SG-Visitor`, and `X-Admin-Key`. |
| **Internal Isolation** | Endpoints `/internal/*`, `/api/v1/admin*`, and `/metrics` return `404 Not Found` to public clients. |
| **Per-IP Rate Limiting** | General public zone (`500r/s`), tightened queue join zone (`50r/s`) returning HTTP 429 when breached. |
| **Edge Caching** | Public static assets (`/static/*`, `/_next/static/*`) cached with cookies stripped. Dynamic routes explicitly uncached. |
| **Upstream Retries** | Bounded retries (2 tries, 10s budget) on `error`, `timeout`, `502`, `504` for idempotent requests only (`GET`, `HEAD`). |
| **Fail-Closed Handling** | Internal connection failure renders `/unavailable.html` (503). Zero traffic leaks to origin. |

---

## 📈 7. Observability & Telemetry Architecture

Telemetry is gathered continuously across all application layers and exported in standard Prometheus format:

* **FastAPI Metrics (`:8000/metrics`):** HTTP request rates, token minting/validation counters, join counts, and fail-closed events.
* **Worker Metrics (`:9100/metrics`):** Queue length, active admitted count, effective admission rate, worker loop latency, and backend health status.
* **Redis Metrics (`:9121`):** Memory usage, connected clients, operations per second, and command latencies via `redis_exporter`.
* **Nginx Metrics (`:9113`):** Active connections, reading/writing/waiting connections, and request rates via `nginx-prometheus-exporter`.
* **Origin Metrics (`:8000/metrics`):** Handled requests, concurrency slots in use, synthetic work duration, and overload rejections.

---

## 🔄 8. Failure Modes & Self-Healing Guarantees

```
┌──────────────────────────┬──────────────────────────┬────────────────────────────────────────────────────────┐
│ Outage Scenario          │ Detection Mechanism      │ Automated System Response                              │
├──────────────────────────┼──────────────────────────┼────────────────────────────────────────────────────────┤
│ Redis Service Down       │ Connection timeout (1s)  │ Proxy fails closed (503); zero traffic reaches backend.│
│ Admission API Down       │ auth_request fails (500) │ Proxy fails closed (503); user sees maintenance page.  │
│ Admission Worker Crashes │ Leader lock TTL expires  │ Standby worker claims lock; rate bucket preserved.    │
│ 1 of 2 Backends Down     │ Active health check (2s) │ Admission rate halves (50%); Nginx evicts instance.    │
│ All Backends Down        │ Active health check (2s) │ Auto-pause activated; queue preserves all visitors.    │
└──────────────────────────┴──────────────────────────┴────────────────────────────────────────────────────────┘
```

---

<div align="center">

### 📐 SurgeGuard Architecture

[Back to Main README](../README.md) • [Back to Top ⬆️](#surgeguard-system-architecture)

</div>
