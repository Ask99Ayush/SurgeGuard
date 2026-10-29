<div align="center">

# ⚙️ SurgeGuard — Configuration Reference

### <i>Environment Variables, Pydantic Validation, Rate Limits & Cryptographic Secrets</i>

**Complete dictionary of all configuration parameters across Docker Compose, FastAPI Pydantic settings, Nginx edge templates, and Terraform cloud variables.**

[![Pydantic](https://img.shields.io/badge/Pydantic-v2-E92063?style=for-the-badge&logo=pydantic&logoColor=white)](https://docs.pydantic.dev/)
[![Security](https://img.shields.io/badge/Security-256--bit_Secrets-blue?style=for-the-badge)](security.md)
[![Environment](https://img.shields.io/badge/Environment-Validated_at_Boot-success?style=for-the-badge)](../README.md)

<br/>

[🛡️ Main README](../README.md) • [📐 Architecture](architecture.md) • [🔒 Security](security.md) • [🚀 Deployment](deployment.md)

</div>

---

<div align="center">

### <i>"Validated at startup. Refuses to boot with insecure defaults, missing keys, or placeholder secrets."</i>

</div>

---

## 📑 Clickable Table of Contents

- [🌟 Overview & Validation Architecture](#overview-validation-architecture)
- [⚡ Setup & Secret Generation](#setup-secret-generation)
- [📋 Root Environment Variables (.env)](#root-environment-variables-env)
  - [1. Core Runtime & Network Bindings](#1-core-runtime-network-bindings)
  - [2. Queue Mechanics & Timing Parameters](#2-queue-mechanics-timing-parameters)
  - [3. Admission Worker & Token Bucket](#3-admission-worker-token-bucket)
  - [4. Upstream Backends & Health Checks](#4-upstream-backends-health-checks)
  - [5. Cryptographic Secrets & Token Signing](#5-cryptographic-secrets-token-signing)
  - [6. Operator Console & Authentication](#6-operator-console-authentication)
  - [7. Nginx Proxy, Caching & Rate Limiting](#7-nginx-proxy-caching-rate-limiting)
  - [8. Observability & Telemetry](#8-observability-telemetry)
- [☁️ Terraform Cloud Environment Variables](#terraform-cloud-environment-variables)
- [✅ Production Hardening Checklist](#production-hardening-checklist)

---

## 🌟 Overview & Validation Architecture

SurgeGuard manages 100% of its runtime parameters through environment variables, adhering strictly to **Twelve-Factor App** principles:

* **Two Tracked Templates:** `.env.example` (for local and production Docker Compose stacks) and `infra/terraform/.env.example` (for Terraform cloud provisioning).
* **Startup Pydantic Validation:** The FastAPI backend validates all variables at boot. The process crashes immediately with a clear error message if secrets are shorter than 32 bytes (16 in dev/test), placeholder strings (`<generated>`) are present, `COOKIE_SECURE=false` in production, or backend URLs are malformed.
* **Frontend Runtime Validation:** The Next.js 15 App Router validates server-side secrets upon boot in `src/lib/env.ts`.

---

## ⚡ Setup & Secret Generation

Generate a production-grade `.env` populated with fresh, cryptographically secure 256-bit random secrets using the automated setup script:

```bash
make setup
```

To rotate the operator password or admission keys at any time:

```bash
# Reset administrator password
bash scripts/setup.sh --reset-admin-password

# Rotate active JWT token signing secret without logging out current visitors
bash scripts/rotate-token-key.sh
```

---

## 📋 Root Environment Variables (`.env`)

### 1. Core Runtime & Network Bindings

| Variable Name | Default Value | Production Recommendation | Description & Purpose |
| :--- | :--- | :--- | :--- |
| `APP_ENV` | `development` | `production` | Deployment mode (`development`, `test`, `staging`, `production`). In production, demo accounts and HTTP cookies are blocked. |
| `LOG_LEVEL` | `INFO` | `INFO` | Logging verbosity for structured JSON logs (`DEBUG`, `INFO`, `WARNING`, `ERROR`). |
| `BIND_ADDRESS` | `127.0.0.1` | `0.0.0.0` | Host interface IP bound by published container ports. In local dev, defaults to loopback. |
| `PROTECTED_PORT` | `8080` | `8088` / `443` | Host port for accessing the SurgeGuard-protected edge proxy. |
| `DIRECT_PORT` | `8081` | *(Disabled in Prod)* | Host port for direct access to fragile demo backend (local benchmark comparison only). |
| `FRONTEND_PORT` | `3000` | `3000` | Host port for the Next.js 15 Operator Console and Landing Page. |
| `GRAFANA_PORT` | `3001` | `3001` | Host port for Grafana SRE Observability dashboards. |
| `PROMETHEUS_PORT` | `9090` | *(Unexposed in Prod)* | Host port for Prometheus time-series metrics engine. |

### 2. Queue Mechanics & Timing Parameters

| Variable Name | Default Value | Description & Constraints |
| :--- | :--- | :--- |
| `QUEUE_POLL_INTERVAL_SECONDS` | `3` | Frequency (in seconds) at which visitor waiting-room browsers poll `/api/v1/queue/status`. |
| `HEARTBEAT_TIMEOUT_SECONDS` | `30` | Inactivity window before an unpolling visitor is evicted from the queue as abandoned. Must be $\ge 2\times$ the poll interval. |
| `REJOIN_GRACE_SECONDS` | `60` | Grace duration during which an abandoned visitor returning preserves their original queue position. |
| `QUEUE_MAX_SIZE` | `100000` | Maximum waiting queue capacity. Joins beyond this receive `HTTP 503 queue_full`. |
| `VISITOR_RECORD_TTL_SECONDS` | `86400` | Lifetime (24 hours) of visitor metadata records and signed `sg_vid` cookies in Redis. |
| `WAIT_ESTIMATE_WINDOW_SECONDS` | `60` | Sliding window of measured admissions used by `wait_estimator.py` to calculate wait times. |
| `WAIT_ESTIMATE_MIN_SAMPLES` | `5` | Minimum number of admitted visitors required before displaying numerical wait estimates. |

### 3. Admission Worker & Token Bucket

| Variable Name | Default Value | Description & Operational Impact |
| :--- | :--- | :--- |
| `ADMISSION_RATE` | `10` | Visitors admitted per second (token bucket refill rate). Governed by worker leader. |
| `ADMISSION_BURST` | `10` | Maximum burst capacity for the Redis token bucket. |
| `MAX_ACTIVE_ADMITTED` | `0` | Global concurrency cap on simultaneous valid admission tokens (`0` = unlimited). |
| `WORKER_TICK_SECONDS` | `0.5` | Interval between admission worker evaluation ticks. |
| `WORKER_LOCK_TTL_SECONDS` | `5` | Redis distributed leader lock TTL (`SET NX PX`). Renewed each tick. |

### 4. Upstream Backends & Health Checks

| Variable Name | Default Value | Description & Operational Impact |
| :--- | :--- | :--- |
| `BACKEND_URLS` | `http://demo-1:8000,http://demo-2:8000` | Comma-delimited list of origin backend targets rendered into Nginx upstreams and health checks. |
| `BACKEND_HEALTH_PATH` | `/health` | HTTP probe endpoint queried by the admission worker on each backend. |
| `BACKEND_HEALTH_INTERVAL_SECONDS` | `2` | Interval between worker active health check probes. |
| `BACKEND_HEALTH_TIMEOUT_SECONDS` | `1` | Maximum response timeout for health probes before marking a tick failed. |
| `BACKEND_HEALTH_FAILURE_THRESHOLD` | `2` | Consecutive probe failures required before a backend is marked down (hysteresis). |
| `BACKEND_HEALTH_RECOVERY_THRESHOLD` | `2` | Consecutive probe successes required before a backend is restored to healthy rotation. |

### 5. Cryptographic Secrets & Token Signing

> [!CAUTION]
> Secrets must be at least 32 cryptographically random bytes (64 hex characters) generated via `openssl rand -hex 32`. Never commit secrets to Git.

| Variable Name | Generation | Description & Scope |
| :--- | :--- | :--- |
| `TOKEN_SIGNING_SECRET` | 32-byte hex | Active cryptographic secret for signing admission JWTs (`HS256`). |
| `TOKEN_SIGNING_KID` | `k1` | Active Key ID header placed in JWTs to enable zero-downtime key rotation. |
| `TOKEN_VERIFY_KEYS` | `kid:secret,...` | Retired keys kept active during rotation windows to validate previously issued tokens. |
| `TOKEN_TTL_SECONDS` | `300` | Validity lifespan of an admission token (5 minutes reusable across all origin routes). |
| `TOKEN_ISSUER` / `TOKEN_AUDIENCE` | `surgeguard` | Registered JWT claims (`iss` and `aud`) checked on every subrequest. |
| `VISITOR_COOKIE_SECRET` | 32-byte hex | HMAC secret for signing and verifying the `sg_vid` visitor ID cookie. |
| `INTERNAL_AUTH_SECRET` | 32-byte hex | Shared authorization secret passed from Nginx to `/internal/auth` in `X-SG-Proxy-Secret`. |
| `ORIGIN_SHARED_SECRET` | 32-byte hex | Shared secret injected by Nginx in `X-Origin-Key` to verify proxy authenticity at origin. |
| `COOKIE_SECURE` | `false` / `true` | Enforces the `Secure` attribute on cookies. **Must be `true` in production and HTTPS.** |

### 6. Operator Console & Authentication

| Variable Name | Default Value | Description & Operational Impact |
| :--- | :--- | :--- |
| `ADMIN_USERNAME` | `admin` | Operator username for console login. |
| `ADMIN_PASSWORD_HASH` | *(Bcrypt hash)* | Bcrypt cost-12 hash of operator password. Set by `setup.sh`. |
| `ADMIN_API_KEY` | 32-byte hex | Secret key passed by Next.js server-side route handlers to control the Queue API. |
| `SESSION_SECRET` | 32-byte hex | Cryptographic secret for signing Next.js session cookies. |
| `SESSION_TTL_SECONDS` | `28800` | Console operator session lifetime (8 hours). |
| `LOGIN_RATE_LIMIT_ATTEMPTS` | `5` | Maximum failed login attempts allowed per IP before temporary lockout. |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS`| `300` | Rate limiting lockout window (5 minutes). |
| `REVIEWER_LOGIN_ENABLED` | `true` *(dev)* | Enables the secondary `reviewer` login with full permissions. Blocked in production. |
| `DEMO_LOGIN_ENABLED` | `true` *(dev)* | Enables public demo credentials on login page. **Strictly blocked in production.** |
| `DEMO_ROLE` | `admin` | Permission level assigned to demo account (`admin` or `viewer`). |

### 7. Nginx Proxy, Caching & Rate Limiting

| Variable Name | Default Value | Description & Operational Impact |
| :--- | :--- | :--- |
| `PROXY_RATE_LIMIT_RPS` | `500` | Maximum requests per second allowed per client IP across all public routes. |
| `PROXY_RATE_LIMIT_BURST` | `1000` | Burst allowance for general public rate limit. |
| `PROXY_JOIN_RATE_LIMIT_RPS` | `50` | Tightened rate limit per client IP for queue join calls (`POST /api/v1/queue/join`). |
| `PROXY_JOIN_RATE_LIMIT_BURST` | `300` | Burst allowance for queue registration endpoint. |
| `CACHE_TTL_SECONDS` | `60` | Edge cache duration for public static assets (`/static/*`, `/_next/static/*`). |
| `PROXY_CONNECT_TIMEOUT_SECONDS` | `2` | Nginx upstream connection timeout. |
| `PROXY_READ_TIMEOUT_SECONDS` | `15` | Nginx upstream read response timeout. |
| `PROXY_AUTH_TIMEOUT_SECONDS` | `2` | Maximum timeout for subrequest token verification call to Queue API. |

### 8. Observability & Telemetry

| Variable Name | Default Value | Description & Operational Impact |
| :--- | :--- | :--- |
| `METRICS_ENABLED` | `true` | Enables `/metrics` Prometheus scraping endpoints. |
| `PROMETHEUS_URL` | `http://prometheus:9090` | Internal URL used by the Next.js console to fetch live metrics. |
| `PUBLIC_GRAFANA_URL` | `http://localhost:3001` | External URL link to Grafana displayed in the operator console. |
| `GRAFANA_ADMIN_USER` | `admin` | Administrator username for Grafana. |
| `GRAFANA_ADMIN_PASSWORD` | *(Generated)* | Randomly generated password for Grafana, initialized by `setup.sh`. |

---

## ☁️ Terraform Cloud Environment Variables

Stored separately in `infra/terraform/.env` to configure AWS cloud provisioning:

| Variable Name | Purpose | Example Value |
| :--- | :--- | :--- |
| `AWS_REGION` | Target AWS deployment region. | `ap-south-1` |
| `TF_VAR_environment` | Deployment environment tier. | `production` |
| `TF_VAR_ec2_instance_id` | Existing EC2 instance ID for security group attachment. | `i-0d9a4f57ebcff0048` |
| `TF_VAR_allowed_ingress_cidrs`| IP ranges permitted to access SSH port 22. | `["0.0.0.0/0"]` *(or office IP)* |
| `TF_VAR_enable_alb` | Toggle Application Load Balancer provisioning. | `false` |
| `TF_VAR_enable_asg` | Toggle Auto Scaling Group provisioning. | `false` |

---

## ✅ Production Hardening Checklist

Before exposing SurgeGuard to public Internet traffic:

- [ ] Set `APP_ENV=production` in `.env`.
- [ ] Set `COOKIE_SECURE=true` in `.env`.
- [ ] Set `DEMO_LOGIN_ENABLED=false` and `REVIEWER_LOGIN_ENABLED=false`.
- [ ] Verify that all secrets were generated using `openssl rand -hex 32`.
- [ ] Set restrictive file permissions on host: `chmod 600 .env`.
- [ ] Verify that ports `8000` (API) and `6379` (Redis) have zero public firewall ingress.
- [ ] Restrict SSH port `22` ingress in Terraform to trusted administrator CIDRs.

---

<div align="center">

### ⚙️ SurgeGuard Configuration

[Back to Main README](../README.md) • [Back to Top ⬆️](#surgeguard-configuration-reference)

</div>
