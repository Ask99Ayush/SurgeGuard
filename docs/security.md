<div align="center">

# 🔒 SurgeGuard — Security Architecture & Threat Model

### <i>Cryptographic Tokens, Subrequest Validation, Fail-Closed Defense & Secret Hygiene</i>

**Comprehensive security specification covering trust boundaries, cryptographic token verification, anti-spoofing measures, and defense-in-depth isolation.**

[![JWT](https://img.shields.io/badge/JWT-HS256_with_kid-000000?style=for-the-badge&logo=json-web-tokens&logoColor=white)](https://jwt.io/)
[![Security](https://img.shields.io/badge/Security-Fail--Closed_503-red?style=for-the-badge)](architecture.md)
[![Secrets](https://img.shields.io/badge/Secrets-Zero_Git_Leaks-success?style=for-the-badge)](../README.md)
[![Bcrypt](https://img.shields.io/badge/Auth-Bcrypt_Cost_12-blue?style=for-the-badge)](configuration.md)

<br/>

[🛡️ Main README](../README.md) • [📐 Architecture](architecture.md) • [⚙️ Configuration](configuration.md) • [🚀 Deployment](deployment.md)

</div>

---

<div align="center">

### <i>"Every visitor authenticated. Every internal subrequest verified in constant time. Outages fail closed."</i>

</div>

---

## 📑 Clickable Table of Contents

- [🌟 1. Security Philosophy & Threat Boundaries](#1-security-philosophy-threat-boundaries)
- [🛡️ 2. Trust Boundaries & Verification Matrix](#2-trust-boundaries-verification-matrix)
- [🔑 3. Cryptographic Tokens & Visitor Cookie Binding](#3-cryptographic-tokens-visitor-cookie-binding)
- [🚫 4. Subrequest Validation & Header Sanitization](#4-subrequest-validation-header-sanitization)
- [⚡ 5. Fail-Closed Security Posture](#5-fail-closed-security-posture)
- [👥 6. Role-Based Access Control (RBAC)](#6-role-based-access-control-rbac)
  - [Administrator Role](#administrator-role)
  - [Reviewer Role (Full Access in Dev/Test)](#reviewer-role-full-access-in-devtest)
  - [Demo Role (Public Presentation Credentials)](#demo-role-public-presentation-credentials)
- [🔐 7. Secret Hygiene & Key Rotation](#7-secret-hygiene-key-rotation)
- [🐳 8. Container & Network Hardening (Docker Compose)](#8-container-network-hardening-docker-compose)
- [⚠️ 9. Known Operational Limitations](#9-known-operational-limitations)

---

## 🌟 1. Security Philosophy & Threat Boundaries

SurgeGuard is an **application-layer admission and traffic-management proxy**. 

> [!IMPORTANT]
> **Scope Clarification:** SurgeGuard is designed to protect backend compute resources, connection pools, and databases from concurrency exhaustion during legitimate or accidental traffic surges. It is **not a volumetric DDoS mitigation system**. High-volume Layer 3 and Layer 4 attacks (e.g. SYN floods, UDP amplification) must be absorbed upstream by cloud provider edge shields (such as AWS Shield, Cloudflare, or edge packet filters).

---

## 🛡️ 2. Trust Boundaries & Verification Matrix

SurgeGuard enforces strict zero-trust boundaries between visitors, the edge proxy, internal queue APIs, and origin backends:

| Boundary | Threat Vector | Enforcement Mechanism | Automated Verification |
| :--- | :--- | :--- | :--- |
| **Visitor → Origin** | Unadmitted bypass, expired tokens, forged tokens | Nginx `auth_request` executes cryptographic subrequest check on every call. | `proxy/tests/test_proxy.py` (22 boundary tests verifying bad signatures, expired, wrong audience, unknown `kid`, `alg=none`, tampered payload). |
| **Client Headers** | Header injection & spoofing | Nginx explicitly overwrites client-supplied `X-SG-Proxy-Secret`, `X-Origin-Key`, `X-SG-Visitor`, and `X-Admin-Key`. | `test_client_supplied_internal_headers_do_not_bypass_auth` |
| **Proxy → API** | Direct internal auth invocation | Shared secret header (`X-SG-Proxy-Secret`) compared in constant time; path `/internal/*` returns 404 publicly. | `test_internal_auth_rejects_missing_or_wrong_secret` |
| **Public → Origin** | Direct origin container access | Origins reside on isolated internal Docker bridge **and** require `X-Origin-Key` verified in constant time. | `test_direct_origin_access_is_blocked` (Returns HTTP 403 Forbidden). |
| **Console → Admin API**| Unauthorized queue manipulation | Console communicates server-side using `X-Admin-Key`; admin endpoints return 404 on the public proxy. | `test_admin_routes_reject_missing_or_wrong_key` |
| **Operator → Console** | Brute force, session hijacking | Bcrypt cost-12 password hashing, signed HttpOnly SameSite=Lax session cookies, sliding-window rate limit. | `lib.test.ts`, `LoginForm.test.tsx`, Playwright `admin.spec.ts`. |

---

## 🔑 3. Cryptographic Tokens & Visitor Cookie Binding

SurgeGuard eliminates token theft, sharing, and forgery by cryptographically pairing admission tokens to an HMAC-signed visitor cookie:

```
┌──────────────────────────────────────┐        ┌──────────────────────────────────────┐
│  Visitor Cookie: sg_vid              │        │  Admission Token: sg_admission       │
├──────────────────────────────────────┤        ├──────────────────────────────────────┤
│  Value:   <128-bit Random Hex>       │        │  Header:  {"alg": "HS256", "kid":...}│
│  Sig:     HMAC-SHA256(Value, Secret) │◄───────┼─ Claims:  "sub": "<Matches sg_vid>"  │
│  Flags:   HttpOnly; SameSite=Lax     │        │           "iss": "surgeguard"        │
└──────────────────────────────────────┘        │           "jti": "<Unique UUID>"     │
                                                │           "exp": <Timestamp + TTL>   │
                                                │  Flags:   HttpOnly; SameSite=Lax     │
                                                └──────────────────────────────────────┘
```

* **Algorithm Enforcement:** Signed via `HS256`. Pydantic and PyJWT enforce explicit algorithm allowlists; requests using `alg=none` are immediately rejected.
* **Key Identification (`kid`):** Every token header includes a `kid` property referencing the active key identifier, enabling seamless cryptographic key rotation.
* **Two-Factor Visitor Binding:** An admission token stolen without the corresponding HMAC-signed `sg_vid` cookie is rejected because the subrequest verifies that `token.sub == cookie.sg_vid`.
* **Instant Redis Revocation:** If an operator rejects an admitted visitor, the token's unique ID (`jti`) is written to a Redis revocation set with a TTL matching the token's remaining validity.

---

## 🚫 4. Subrequest Validation & Header Sanitization

All incoming traffic to protected routes triggers an internal subrequest to `/internal/auth`:

1. Nginx strips any existing `X-SG-Proxy-Secret` or `X-Origin-Key` from the client.
2. Nginx calls `/internal/auth`, forwarding the client's cookies and injecting the trusted `X-SG-Proxy-Secret`.
3. The API validates the proxy secret in constant time (`hmac.compare_digest`), inspects the JWT signature, verifies claims, checks Redis for revocation, and validates visitor binding.
4. If valid, the API returns `HTTP 204 No Content` with header `X-SG-Visitor: <vid>`.
5. Nginx forwards the original request to the backend upstream pool, appending `X-Origin-Key` and `X-SG-Visitor`.

---

## ⚡ 5. Fail-Closed Security Posture

In high-concurrency environments, traffic management proxies must never fail open:

* **Redis Outage:** If Redis becomes unreachable, `/internal/auth` returns `HTTP 503`. Nginx serves the branded fail-closed page (`unavailable.html`), blocking all traffic from reaching origins.
* **FastAPI Service Crash:** If the Queue API container crashes, Nginx `auth_request` subrequest encounters a 502/504 error, triggering the fail-closed error block.
* **Verified by Automation:** Validated during CI via `scripts/fail-closed-check.sh`, which halts the Redis and API containers and proves 100% of origin requests are denied.

---

## 👥 6. Role-Based Access Control (RBAC)

The operator console (`/admin`) provides multi-tier role-based access control:

### Administrator Role
* **Permissions:** Full operational access (pause queue, resume queue, evict/reject visitors, modify admission rate, view telemetry).
* **Authentication:** Single operator account authenticated via Bcrypt cost-12 password hashing.

### Reviewer Role (Full Access in Dev/Test)
* **Configuration:** Enabled via `REVIEWER_LOGIN_ENABLED=true`.
* **Credentials:** Username `reviewer` with a cryptographically generated 16-character password in `.env`.
* **Scope:** Exclusively active when `APP_ENV` is `development` or `test`. The backend and frontend crash on startup if enabled in `production`.

### Demo Role (Public Presentation Credentials)
* **Configuration:** Enabled via `DEMO_LOGIN_ENABLED=true` with one-click login button.
* **Scope:** Permits presentation juries to test controls. Enforces server-side checks (`requireAdmin()`); unauthorized calls return `HTTP 403 read_only`. Refused in `production`.

---

## 🔐 7. Secret Hygiene & Key Rotation

* **Git Exclusion:** All `.env`, `.env.*`, `*.pem`, `*.key`, and `*.crt` files are explicitly ignored in `.gitignore`.
* **No Leaks in Terraform:** Secrets are never written to Terraform state or declared in `.tfvars`.
* **Automated Key Rotation:** Execute `scripts/rotate-token-key.sh` to rotate admission signing keys. The script appends the retiring key to `TOKEN_VERIFY_KEYS`, ensuring existing visitors are not logged out while new visitors receive tokens signed by the new key.
* **Log Redaction:** All application logs are emitted as structured JSON. Sensitive keys (`password`, `secret`, `token`, `cookie`, `authorization`, `api_key`) and JWT-formatted strings are automatically masked.

---

## 🐳 8. Container & Network Hardening (Docker Compose)

All container services are built following Docker CIS benchmarks:

* **Non-Root Execution:** All services execute as dedicated non-root users (e.g. Nginx runs as UID `101`).
* **Security Options:** Containers enforce `no-new-privileges:true`.
* **Capability Dropping:** Unnecessary Linux kernel capabilities are dropped (`cap_drop: ALL`).
* **Read-Only Root Filesystems:** API, worker, frontend, and origins mount root filesystems in read-only mode (`read_only: true`), with ephemeral tmpfs mounts for temporary buffers.
* **Resource Limits:** CPU and memory limits are strictly bounded to prevent noisy-neighbor container exhaustion.

---

## ⚠️ 9. Known Operational Limitations

1. **In-Memory Console Limiter:** The operator login rate limiter operates in memory on the Next.js instance. Multi-replica console deployments require a shared Redis rate limiter.
2. **Symmetric Token Cryptography:** The current implementation uses symmetric HMAC (`HS256`), meaning the API holds the signing secret. Future Phase 5 roadmap introduces asymmetric RSA/EdDSA (`RS256`) public-key verification at the Nginx edge.
3. **Volumetric DDoS Out of Scope:** Large volumetric floods must be mitigated at upstream ISP or CDN layers.

---

<div align="center">

### 🔒 SurgeGuard Security

[Back to Main README](../README.md) • [Back to Top ⬆️](#surgeguard-security-architecture-threat-model)

</div>
