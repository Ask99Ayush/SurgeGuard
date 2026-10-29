<div align="center">

# 🏛️ SurgeGuard — Architecture Decision Records (ADRs)

### <i>Design Rationales, Trade-Offs & Structural Choices</i>

**Chronological record of key architectural decisions, engineering trade-offs, and design choices made during the conception, build, and deployment of SurgeGuard.**

[![Decisions](https://img.shields.io/badge/ADRs-26_Documented-blue?style=for-the-badge)](../README.md)
[![Status](https://img.shields.io/badge/Status-Fully_Implemented-success?style=for-the-badge)](../README.md)
[![Standard](https://img.shields.io/badge/Architecture-Immutable_Log-lightgrey?style=for-the-badge)](architecture.md)

<br/>

[🛡️ Main README](../README.md) • [📐 Architecture](architecture.md) • [🔒 Security](security.md) • [🚀 Deployment](deployment.md)

</div>

---

<div align="center">

### <i>"Every architectural constraint is documented with context, alternatives considered, and explicit reasoning."</i>

</div>

---

## 📑 Clickable Table of Contents

- [🌟 Architectural Decision Framework](#architectural-decision-framework)
- [🖥️ Category 1: Frontend & UI Design](#category-1-frontend-ui-design)
- [🛡️ Category 2: Proxy, Edge & Routing](#category-2-proxy-edge-routing)
- [💾 Category 3: Queue State & Admission Algorithms](#category-3-queue-state-admission-algorithms)
- [🔒 Category 4: Security, Secrets & Access Control](#category-4-security-secrets-access-control)
- [📊 Category 5: Observability & Testing Environments](#category-5-observability-testing-environments)
- [☁️ Category 6: Cloud Infrastructure & AWS Architecture](#category-6-cloud-infrastructure-aws-architecture)
- [📋 Complete ADR Master Matrix](#complete-adr-master-matrix)

---

## 🌟 Architectural Decision Framework

Each Architectural Decision Record (ADR) captures an intentional architectural choice, the problem or requirement context, the alternative designs considered, and the rationale for the final selection.

---

## 🖥️ Category 1: Frontend & UI Design

### ADR 1: Design Reference & Visual Aesthetic
* **Context:** The brief requested a premium developer-tool feel inspired by Raycast.
* **Decision:** Used Raycast as a **design-language reference only** (dark charcoal surfaces, subtle borders, coral-red accents). No Raycast logos, names, or copyrighted assets are committed to the repository.
* **Rationale:** Preserves intellectual property while delivering a state-of-the-art operator experience.

### ADR 2: Pinned Next.js 15.5 App Router
* **Context:** Choosing the frontend framework version for the operator console and waiting room.
* **Decision:** Standardized strictly on **Next.js 15.5** rather than experimental Next.js 16 releases.
* **Rationale:** Next.js 16 altered middleware conventions and runtime defaults; 15.5 provides rock-solid App Router stability, strict TypeScript support, and zero breaking changes.

### ADR 3: Co-Location of Waiting Room on Edge Port
* **Context:** How visitors transition between `/waiting-room` and protected origin routes without cookie or CORS issues.
* **Decision:** Nginx proxies `/waiting-room`, `/_next/*`, and `/api/v1/queue/*` on the protected port (`:8080` / `:443`); all other paths proxy to the origin backend.
* **Rationale:** Waiting-room cookies (`sg_vid`, `sg_admission`) must be strictly same-origin with the protected application to allow seamless browser redirects without cross-domain cookie complications.

---

## 🛡️ Category 2: Proxy, Edge & Routing

### ADR 4: Unprotected Direct Comparison Port
* **Context:** Demonstrating SurgeGuard's value requires empirical proof of origin failure under load.
* **Decision:** Provisioned an auxiliary Nginx server on port `8081` proxying to the *exact same backends* with zero queueing, auth, or rate limits.
* **Rationale:** Guarantees load tests compare apples to apples: identical hardware, identical backend code, identical network links.

### ADR 5: Two-Tier Origin Lockdown
* **Context:** Preventing malicious actors from bypassing the waiting room to hit backend backends directly.
* **Decision:** Network isolation (origins reside on an internal Docker bridge) **plus** a cryptographically random shared secret header (`X-Origin-Key`) injected by Nginx and verified in constant time by origins.
* **Rationale:** Defense in depth: even if an attacker gains access to the container network, requests are immediately dropped without the secret header.

### ADR 6: Constant-Time Subrequest Proxy Secret
* **Context:** Protecting the private FastAPI `/internal/auth` token validation route.
* **Decision:** Nginx injects `X-SG-Proxy-Secret` on every subrequest; the API validates the secret using `hmac.compare_digest()`. Public requests directly to `/internal/*` return `HTTP 404`.
* **Rationale:** Prevents unauthorized parties from spoofing internal subrequest validation calls.

### ADR 14: Passive vs Active Health Responsibilities
* **Context:** Nginx Open Source does not include active upstream health checking modules.
* **Decision:** Nginx handles passive eviction (`max_fails=2 fail_timeout=10s`), while the admission worker handles active HTTP probes (`/health`) to adjust admission throughput.
* **Rationale:** Honest engineering: we do not pretend Nginx OSS possesses commercial Nginx Plus active checks; instead, our worker adjusts admission dynamically based on origin capacity.

### ADR 15: Relative URL Redirects
* **Context:** Nginx default redirects generated absolute URLs containing internal container ports.
* **Decision:** Configured `absolute_redirect off;` in the protected Nginx server block.
* **Rationale:** Prevents redirection bugs when host ports are remapped (e.g. host `:8088` mapped to container `:8443`) or behind cloud load balancers.

### ADR 20: Development Port Conflict Mitigation
* **Context:** On development hosts, port `8080` is frequently occupied by legacy developer services.
* **Decision:** Defaulted `.env.example` to `8080`, but configured `PROTECTED_PORT` as a first-class variable allowing immediate remapping to `8088` without breaking internal links.
* **Rationale:** Zero friction for developers with pre-existing port allocations.

---

## 💾 Category 3: Queue State & Admission Algorithms

### ADR 7: Abandonment Grace Period Window
* **Context:** Mobile users experiencing temporary signal loss or closing laptop lids.
* **Decision:** Implemented a two-tier timeout: visitors without a heartbeat for `HEARTBEAT_TIMEOUT_SECONDS` (30s) are marked expired, but if they return within `REJOIN_GRACE_SECONDS` (60s), they keep their original sequence number.
* **Rationale:** Flaky WiFi and mobile lock screens do not unfairly penalize genuine human visitors, while genuine dropouts are promptly purged from line.

### ADR 8: Terminal Rejection Semantics
* **Context:** How to treat visitors explicitly rejected or evicted by an operator.
* **Decision:** Rejection is a terminal state for that `sg_vid`. If the visitor already holds an active token, its `jti` is added to a Redis revocation index with a TTL matching the token's remaining lifespan.
* **Rationale:** Administrative evictions are permanent and un-bypassable.

### ADR 9: Redis-Backed Token Bucket & Fencing
* **Context:** Guaranteeing strict admission rates across worker crashes and restarts.
* **Decision:** The token bucket is persisted in Redis state, and `admit.lua` re-evaluates the worker's leader lock token on every single tick.
* **Rationale:** Eliminates admission bursts following worker failovers. Non-leader workers are mathematically blocked from admitting anyone.

### ADR 10: Concurrency Cap Default
* **Context:** Limiting active concurrent users vs admitting at a steady rate.
* **Decision:** `MAX_ACTIVE_ADMITTED` is fully implemented but defaults to `0` (disabled), making `ADMISSION_RATE` the primary control.
* **Rationale:** In burst events, visitors browse for minutes; an aggressive active-token cap would stall admission for everyone. Rate-based admission provides smoother throughput.

### ADR 11: Conservative Adaptive Admission Rule
* **Context:** How to adjust admission when backends degrade.
* **Decision:** Single, battle-tested adaptive rule: $\text{Rate} \times \frac{\text{Healthy}}{\text{Total}}$. When healthy backends reach zero, admission auto-pauses (`P:auto_paused`). Latency-based throttling is deferred.
* **Rationale:** Avoids chaotic feedback loops where transient latency spikes cause wild rate swings.

### ADR 12: Empirical Wait Estimates
* **Context:** Estimating wait times for queued visitors.
* **Decision:** Wait estimates are calculated exclusively from measured admissions over the past 60 seconds. If fewer than 5 samples exist, the UI explicitly shows *"Estimate unavailable"*.
* **Rationale:** Adheres to honesty rules: never fabricate or extrapolate estimates from hypothetical theoretical rates.

### ADR 13: Three-Tier Rate Limiting
* **Context:** Distinguishing between malicious flooders and college students sharing a campus NAT.
* **Decision:** Nginx per-IP general limit (500 rps), tightened Nginx join limit (50 rps), and an application-level Redis join limiter.
* **Rationale:** IP address is treated as a coarse rate signal, not a visitor identity.

### ADR 18: Redis Eviction Safety
* **Context:** Choosing Redis memory management behavior.
* **Decision:** Enforced `maxmemory-policy noeviction` with AOF persistence.
* **Rationale:** Silent key eviction would corrupt queue ordering. It is far better to fail closed visibly than lose a visitor's place in line.

---

## 🔒 Category 4: Security, Secrets & Access Control

### ADR 16: Pure-JavaScript Bcrypt Authentication
* **Context:** Verifying operator passwords in Next.js App Router route handlers.
* **Decision:** Used `bcryptjs` with cost factor 12 in Next.js, and generated password hashes via Python `bcrypt` in `setup.sh`. Passwords in `.env` are single-quoted to prevent Docker Compose `$` variable interpolation.
* **Rationale:** Eliminates native C++ compilation dependencies while ensuring industry-standard password protection.

### ADR 17: In-Memory Operator Rate Limiting
* **Context:** Preventing brute-force attacks against the operator login page.
* **Decision:** Implemented an in-memory sliding window rate limiter directly inside Next.js server route handlers.
* **Rationale:** Lightweight, zero external dependencies, perfectly sized for single-host deployments.

### ADR 24: Development Demo Account
* **Context:** Allowing evaluators to test administrative controls during live demonstrations without sharing personal passwords.
* **Decision:** Created a one-click `demo` login (`DEMO_ROLE=admin` or `viewer`). Refused at startup if `APP_ENV=production`.
* **Rationale:** Perfect for conference demos while remaining completely safeguarded against production leakage.

### ADR 25: Isolated Reviewer Account
* **Context:** Providing external code auditors and hackathon judges with full administrative access.
* **Decision:** Added a secondary `reviewer` login with a randomly generated password stored exclusively in `.env` and never displayed in the UI. Development/test only.
* **Rationale:** Reviewers can inspect the system without altering the primary administrator's credentials.

---

## 📊 Category 5: Observability & Testing Environments

### ADR 19: Topology-Defined Prometheus Targets
* **Context:** Defining Prometheus scrape configurations.
* **Decision:** Hardcoded internal Docker Compose service names (`api`, `worker`, `redis-exporter`, `nginx-exporter`) directly in `prometheus.yml`.
* **Rationale:** The internal container topology is static and defined by this repository; abstracting into dynamic environment variables adds unnecessary complexity.

### ADR 21: Isolated Test Compose Project Namespace
* **Context:** Running `make test-backend` was inadvertently wiping named volumes from the development stack.
* **Decision:** Pinned `-p surgeguard-test` to all test commands in `Makefile`.
* **Rationale:** Complete isolation between active development state and automated test executions.

### ADR 23: Prometheus Instance Label Disambiguation
* **Context:** Custom metrics emitted by demo backends collided with Prometheus' internal `instance` label.
* **Decision:** Renamed the application metric label to `origin`.
* **Rationale:** Eliminates label collision and ensures clean Grafana dashboard queries.

---

## ☁️ Category 6: Cloud Infrastructure & AWS Architecture

### ADR 22: Single-Host AWS Architecture
* **Context:** Designing the cloud infrastructure footprint for AWS deployment.
* **Decision:** Deployed as a single EC2 host running the Docker Compose stack behind security groups. Horizontal multi-host scaling requires a shared Redis cluster (e.g. AWS ElastiCache), which is deferred to Phase 7.
* **Rationale:** Avoids running multiple independent Redis queues that would violate FIFO fairness.

### ADR 26: Direct EC2, DuckDNS & Self-Signed HTTPS (SSM Removal)
* **Context:** Removing AWS SSM complexity, avoiding costly Application Load Balancers, and enabling direct HTTPS access for live demonstrations.
* **Decision:**
  1. Removed AWS Systems Manager (SSM) and Parameter Store dependencies entirely; secrets reside in an EC2-local `.env` file (`chmod 600`).
  2. Replaced costly ALB with direct Nginx TLS termination on port `443` using a 2048-bit self-signed certificate with Subject Alternative Names (SAN) matching `surgeguard-innotech.duckdns.org` and IP `3.109.184.177`.
  3. Administration is handled via manual SSH public-key authentication (`SurgeGuard.pem`) on port 22.
* **Rationale:** Achieves zero monthly AWS overhead ($0 ALB/NAT fees), zero vendor lock-in, and instant DNS resolution via DuckDNS.

---

## 📋 Complete ADR Master Matrix

| ADR # | Subject Matter | Decision Summary | Primary Benefit |
| :--- | :--- | :--- | :--- |
| **01** | UI Aesthetic | Raycast-inspired dark theme without third-party assets | Clean, professional operator UI |
| **02** | Frontend Stack | Next.js 15.5 App Router pinned strictly | Stable App Router and SSR performance |
| **03** | Waiting Room Ingress | Proxied on edge port under `/waiting-room` | Same-origin cookie security |
| **04** | Benchmark Baseline | Auxiliary direct server on `:8081` | Apples-to-apples performance comparisons |
| **05** | Origin Isolation | Docker network bridge + `X-Origin-Key` header | Defense-in-depth origin protection |
| **06** | Internal Auth | `X-SG-Proxy-Secret` verified in constant time | Subrequest spoofing prevention |
| **07** | Abandonment Grace | 60s rejoin grace window preserves place in line | Fair to mobile and flaky WiFi users |
| **08** | Eviction Semantics | Rejection is terminal; active JWT `jti` revoked | Immediate administrative enforcement |
| **09** | Rate Enforcement | Redis token bucket with fenced Lua validation | Burst prevention across worker restarts |
| **10** | Active Cap | `MAX_ACTIVE_ADMITTED` defaults to 0 (disabled) | Steady, predictable visitor flow |
| **11** | Health Policy | Dynamic rate scaling + auto-pause on 0 healthy | Eliminates origin overload cascades |
| **12** | Wait Estimates | Derived only from measured admissions | 100% honest and accurate telemetry |
| **13** | Rate Limiting | 3-tier architecture: Nginx global, Nginx join, Redis join | Shared NAT compatibility |
| **14** | Health Checking | Nginx passive eviction + Worker active probes | True reflection of OSS capabilities |
| **15** | URL Redirection | `absolute_redirect off;` in Nginx | Port-mapping and proxy resilience |
| **16** | Password Hashing | Bcrypt cost-12 via pure JavaScript (`bcryptjs`) | Zero native C++ dependency friction |
| **17** | Login Security | In-memory sliding window rate limiter | Brute-force protection on operator login |
| **18** | Redis Persistence | `noeviction` policy with Append-Only File (AOF) | Zero silent queue corruption |
| **19** | Metrics Discovery | Static service naming in `prometheus.yml` | Simple, reliable telemetry topology |
| **20** | Port Flexibility | Configurable `PROTECTED_PORT` (default 8080/8088) | Eliminates host port collision issues |
| **21** | Test Isolation | `-p surgeguard-test` pinned in Makefile | Prevents volume wipe of dev data |
| **22** | AWS Topology | Single EC2 host running Compose stack | Avoids split-brain uncoordinated queues |
| **23** | Labeling | Demo metrics use `origin` instead of `instance` | Prevents Prometheus label collisions |
| **24** | Demo Login | Dev-only public demo credentials | Seamless hackathon and jury demos |
| **25** | Reviewer Login | Dev-only reviewer credentials in `.env` | Isolated access for security auditors |
| **26** | Cloud Modernization| Direct EC2 + DuckDNS + SAN TLS + SSM removal | $0 paid cloud overhead and clean SSH access |

---

<div align="center">

### 🏛️ SurgeGuard ADRs

[Back to Main README](../README.md) • [Back to Top ⬆️](#surgeguard-architecture-decision-records-adrs)

</div>
