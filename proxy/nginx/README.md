<div align="center">

# 🛡️ SurgeGuard — Nginx Reverse Proxy Edge

### <i>auth_request Gatekeeper, Rate Limiting, Fail-Closed Security & TLS Termination</i>

**Deep dive into the edge reverse proxy architecture, dynamic template rendering, unprivileged container security, and subrequest authentication.**

[![Nginx](https://img.shields.io/badge/Nginx-1.28_Alpine-009639?style=for-the-badge&logo=nginx&logoColor=white)](https://nginx.org/)
[![Security](https://img.shields.io/badge/Security-Unprivileged_UID_101-blue?style=for-the-badge)](../../docs/security.md)
[![TLS](https://img.shields.io/badge/TLS-1.2_%7C_1.3-success?style=for-the-badge)](../../terraform.md)

<br/>

[🛡️ Main README](../../README.md) • [📐 Architecture](../../docs/architecture.md) • [🔒 Security](../../docs/security.md) • [☁️ Terraform](../../terraform.md)

</div>

---

<div align="center">

### <i>"Every protected request validated against private endpoints. Unverified traffic strictly fails closed."</i>

</div>

---

## 📑 Clickable Table of Contents

- [🌟 Overview & Core Responsibilities](#overview-core-responsibilities)
- [🔒 Unprivileged Container Security](#unprivileged-container-security)
- [⚙️ Dynamic Upstream & Template Rendering](#dynamic-upstream-template-rendering)
- [🌐 Server Blocks & Port Layout](#server-blocks-port-layout)
- [🔑 Subrequest Authentication Gate (uth_request)](#subrequest-authentication-gate-auth_request)
- [🚫 Fail-Closed Security & Error Pages](#fail-closed-security-error-pages)
- [⚡ Edge Caching Strategy](#edge-caching-strategy)
- [🚦 Per-IP Rate Limiting Zones](#per-ip-rate-limiting-zones)
- [🎯 Upstream Passive Health Checks & Retries](#upstream-passive-health-checks-retries)
- [🛡️ Header Sanitization & Security Snippets](#header-sanitization-security-snippets)
- [🧪 Verification & Proxy Test Suite](#verification-proxy-test-suite)

---

## 🌟 Overview & Core Responsibilities

The Nginx reverse proxy represents SurgeGuard's frontline defense. Positioned at the edge of the network, it executes token verification, serves static assets from cache, strips spoofed internal headers, limits request burst rates, and forwards authorized requests to backend origins.

---

## 🔒 Unprivileged Container Security

SurgeGuard uses the official `nginxinc/nginx-unprivileged:1.28.0-alpine` image:
* **Non-Root Execution:** Runs under UID `101` (`nginx`), preventing container breakout vulnerabilities.
* **Privileged Port Mapping:** Nginx listens internally on ports `8080` (HTTP redirect) and `8443` (HTTPS TLS termination), mapped by Docker Compose to host ports `80` and `443`.
* **Read-Only Compatibility:** Temporary buffering paths (`client_temp`, `proxy_temp`) use isolated tmpfs mount points.

---

## ⚙️ Dynamic Upstream & Template Rendering

Nginx configuration is rendered dynamically at container startup before traffic begins:

| Script / Template | Executed By | Resulting Configuration |
| :--- | :--- | :--- |
| `render-upstreams.sh` | `/docker-entrypoint.d/15-render-upstreams.sh` | Generates `conf.d/sg-upstreams.conf` based on `BACKEND_URLS`, `NGINX_API_UPSTREAM`, and `NGINX_FRONTEND_UPSTREAM`. |
| `templates/sg-site.conf.template` | Image default `envsubst` entrypoint | Generates `conf.d/sg-site.conf` substituting environment variables (`COOKIE_SECURE`, timeouts, cache TTLs). |

---

## 🌐 Server Blocks & Port Layout

SurgeGuard exposes three distinct Nginx server profiles:

| Port | Surface Profile | Behavior & Target |
| :--- | :--- | :--- |
| **`8080`** | **HTTP Redirection** | Listens on port 8080 (bound to host `:80`). Permanently returns `301 https://$host$request_uri`. Health probe `/healthz` returns `200 ok`. |
| **`8443`** | **Protected HTTPS Edge** | Terminates TLS with self-signed SAN certificates. Executes `auth_request` on all protected routes; proxies unadmitted users to waiting room. |
| **`8081`** | **Unprotected Baseline** | Direct proxy to origin pool bypassing waiting room and auth. Used strictly for local side-by-side performance benchmarking. |
| **`8090`** | **Internal Telemetry** | Unexposed internal server providing `/stub_status` for `nginx-prometheus-exporter`. |

---

## 🔑 Subrequest Authentication Gate (`auth_request`)

Every incoming request to protected routes triggers an internal subrequest to the Queue API:

```nginx
location / {
    auth_request /_sg_auth;
    auth_request_set $sg_visitor $upstream_http_x_sg_visitor;

    # Forward to origin pool with injected authorization
    proxy_pass http://sg_origin_pool;
    proxy_set_header X-Origin-Key "$sg_origin_key";
    proxy_set_header X-SG-Visitor "$sg_visitor";
}

location = /_sg_auth {
    internal;
    proxy_pass http://sg_api/internal/auth;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header X-SG-Proxy-Secret "$sg_proxy_secret";
    proxy_set_header Cookie $http_cookie;
}
```

* **HTTP 204:** Token verified → request proceeds to origin pool.
* **HTTP 401:** Token absent, expired, or invalid → redirected (302) to `/waiting-room`.
* **HTTP 5xx:** API or Redis unreachable → **fails closed** to `/unavailable.html` (HTTP 503).

---

## 🚫 Fail-Closed Security & Error Pages

If SurgeGuard cannot cryptographically confirm a visitor's right to enter, it **never forwards the request to the origin backend**:

* **`unavailable.html` (503):** Rendered when the auth subrequest fails or the Queue API is down.
* **`no-backend.html` (503):** Rendered when all upstream backends fail passive health checks.
* **No Cache on Errors:** Error pages are strictly served with `Cache-Control: no-store`.

---

## ⚡ Edge Caching Strategy

To minimize origin hits during traffic spikes, Nginx implements aggressive public static caching:

* **Cached Routes:** Only `/static/*` and `/_next/static/*` are cached in `sg_static_cache`.
* **Cookie Stripping:** Client `Cookie` headers are stripped before upstream caching, and `Set-Cookie` is stripped before storage.
* **Dynamic Routes:** Dynamic endpoints have `proxy_cache off` and `proxy_no_cache 1` explicitly enforced.

---

## 🚦 Per-IP Rate Limiting Zones

Nginx guards against rogue bots and connection floods using memory-efficient leaky-bucket zones:

```nginx
# General public rate limit
limit_req_zone $binary_remote_addr zone=sg_public_limit:10m rate=500r/s;

# Tightened queue join rate limit (prevents registration flooding)
limit_req_zone $binary_remote_addr zone=sg_join_limit:10m rate=50r/s;
```

When exceeded, Nginx returns `HTTP 429 Too Many Requests` with structured JSON errors.

---

## 🎯 Upstream Passive Health Checks & Retries

* **Passive Eviction:** `max_fails=2 fail_timeout=10s` temporarily removes unhealthy backend containers from rotation.
* **Bounded Retries:** Idempotent requests (`GET`, `HEAD`) retry once on the alternative backend container (`proxy_next_upstream error timeout http_502 http_504`).
* **Non-Idempotent Protection:** Mutation requests (`POST`, `PUT`, `DELETE`) are **never retried** across nodes to prevent duplicate database commits.

---

## 🛡️ Header Sanitization & Security Snippets

Imported from `proxy/nginx/snippets/`:

1. **`proxy-headers.conf`:** Overwrites spoofable client headers (`X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`).
2. **`security-headers.conf`:** Enforces standard web security headers:
   * `X-Frame-Options: SAMEORIGIN`
   * `X-Content-Type-Options: nosniff`
   * `Referrer-Policy: strict-origin-when-cross-origin`
   * `X-XSS-Protection: 1; mode=block`

---

## 🧪 Verification & Proxy Test Suite

Run the dedicated automated proxy test suite against the running stack:

```bash
make test-proxy
```

*Validates token enforcement, header spoofing protection, static caching, rate limits, and fail-closed behaviors.*

---

<div align="center">

### 🛡️ SurgeGuard Edge Proxy

[Back to Main README](../../README.md) • [Back to Top ⬆️](#surgeguard-nginx-reverse-proxy-edge)

</div>
