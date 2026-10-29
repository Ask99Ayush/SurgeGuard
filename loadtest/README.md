<div align="center">

# 🚀 SurgeGuard — k6 Load Testing & Validation

### <i>Empirical Performance Benchmarking, Concurrency Chaos & FIFO Fairness</i>

**Comprehensive load testing suite utilizing containerized Grafana k6 to validate traffic surge resilience, FIFO queue fairness, and automated backend recovery.**

[![k6](https://img.shields.io/badge/k6-1.0.0-7D64FF?style=for-the-badge&logo=k6&logoColor=white)](https://k6.io/)
[![Docker](https://img.shields.io/badge/Docker-Edge_Network-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Status](https://img.shields.io/badge/Status-100%25_Reproducible-success?style=for-the-badge)](../docs/testing.md)

<br/>

[🛡️ Main README](../README.md) • [📊 Empirical Results](../docs/testing.md) • [📐 Architecture](../docs/architecture.md)

</div>

---

<div align="center">

### <i>"Every performance claim backed by code, telemetry, and reproducible k6 test runs."</i>

</div>

---

## 📑 Clickable Table of Contents

- [🌟 Overview](#overview)
- [🐳 Zero-Install Containerized Execution](#zero-install-containerized-execution)
- [📂 Scenario Catalog](#scenario-catalog)
  - [1. surge.js — 300 VU Traffic Spike](#1-surgejs-300-vu-traffic-spike)
  - [2. backend-failure.js — Chaos Injection & Recovery](#2-backend-failurejs-chaos-injection-recovery)
  - [3. queue-fairness.js — Order Inversion Verification](#3-queue-fairnessjs-order-inversion-verification)
  - [4. compare.js — Comparative Analysis Generator](#4-comparejs-comparative-analysis-generator)
- [⚡ Quickstart & Execution Commands](#quickstart-execution-commands)
- [📈 Key Performance Metrics Explained](#key-performance-metrics-explained)
- [📊 Recorded Benchmark Results (2026-10-17)](#recorded-benchmark-results-2026-10-17)
- [⚙️ Tuning & Custom Parameters](#tuning-custom-parameters)

---

## 🌟 Overview

SurgeGuard measures its traffic-management effectiveness through **controlled, reproducible comparisons** rather than synthetic or unsupported marketing claims.

All load scenarios are designed to simulate realistic browser behaviors—including initial unauthenticated page hits, redirects to `/waiting-room`, polling with heartbeats, cryptographic token retrieval, and multi-page browsing sessions with simulated think times.

---

## 🐳 Zero-Install Containerized Execution

All k6 scenarios execute inside official `grafana/k6:1.0.0` containers attached to the internal Docker Compose `edge` network:

```bash
docker compose --profile loadtest run --rm k6 ...
```

* **No Host Installation Required:** You do not need to install `k6` or Go on your development machine.
* **Network Co-Location:** k6 communicates with Nginx directly through Docker internal DNS, minimizing network jitter.
* **Isolated Results:** Benchmark data lands in `loadtest/results/` as JSON summaries (automatically git-ignored).

---

## 📂 Scenario Catalog

### 1. `surge.js` — 300 VU Traffic Spike

Simulates a sudden flood of 300 concurrent visitors attempting to access examination scores or registration pages simultaneously.

* **Profile:** Ramp from 0 to 300 Virtual Users (VUs) over 15s; hold at 300 VUs for 60s.
* **Visitor Behavior:** Each VU executes 3 page requests with 1s think time between requests. Cookies are reset between iterations to guarantee every session represents a distinct visitor.
* **Dual Execution:** Run identically against `:8081` (unprotected baseline) and `:8080` (SurgeGuard protected gateway) to generate a direct side-by-side comparison.

### 2. backend-failure.js — Chaos Injection & Recovery

Validates SurgeGuard's active backend health checks and hysteresis policies during live traffic:

* **Profile:** 150 VUs generating steady load over 85 seconds.
* **Chaos Trigger:** At $t = 25\text{s}$, `demo-2` is forcefully killed (`SIGKILL`). At $t = 55\text{s}$, `demo-2` is restarted.
* **Validation:** Measures error rate *before*, *during*, and *after* failure. Confirms that active checks detect the outage in **~3.3s**, auto-scale admission throughput by 50%, and restore full capacity within **~5.8s** of recovery with **0.00% user errors**.

### 3. `queue-fairness.js` — Order Inversion Verification

Validates that the Redis sorted set (`ZSET`) and Lua admission sequence enforce absolute First-In, First-Out (FIFO) ordering:

* **Profile:** 120 visitors join 30ms apart and poll status every 0.5s.
* **Metrics:** Tracks **position regressions** (a user's queue position increasing) and **order inversions** (a user admitted after someone who joined later).
* **Guaranteed Outcome:** Verified **0 position regressions** and **0 order inversions** across 7,021 ordered visitor pairs.

### 4. `compare.js` — Comparative Analysis Generator

A lightweight Node.js analysis utility that reads raw JSON metric files in `loadtest/results/` and prints clean terminal comparison tables. It sends zero network traffic.

---

## ⚡ Quickstart & Execution Commands

```bash
# 1. Run the entire 5-minute automated demo suite (baseline + protected + analysis)
make demo

# 2. Run ONLY the unprotected baseline surge test
bash scripts/demo.sh unprotected

# 3. Run ONLY the SurgeGuard protected surge test
bash scripts/demo.sh protected

# 4. Run the backend chaos and failure test
bash scripts/demo.sh failure

# 5. Run the queue fairness and inversion test
bash scripts/demo.sh fairness
```

---

## 📈 Key Performance Metrics Explained

| Metric Name | Type | Description |
| :--- | :--- | :--- |
| `page_errors` | Counter / Rate | HTTP status `0`, `5xx`, or `429` encountered during protected page views. |
| `page_ok` | Counter | Successfully served origin page views (HTTP `200`). |
| `page_duration` | Trend (Histogram) | End-to-end response time for origin page requests (p50, p90, p95). |
| `queue_wait` | Trend (Histogram) | Total time a visitor spent in `/waiting-room` before admission. |
| `admitted_visitors` | Counter | Count of waiting visitors successfully promoted by admission worker. |
| `still_queued_at_end` | Gauge | Visitors remaining in queue when benchmark concluded. |
| `sessions_completed` | Counter | Full visitor sessions (3 pages + think time) completed. |

---

## 📊 Recorded Benchmark Results (2026-10-17)

### Machine & Test Environment
* **Host CPU:** Intel Core i5-12500H (12 Cores / 16 Threads), 15.6 GB RAM.
* **Operating System:** Windows 11 Home, Docker Desktop (Engine 29.8.2).
* **Load Generator:** `grafana/k6:1.0.0` running locally on the same hardware.
* **Origin Profile:** 2 × fragile demo backends (`DEMO_MAX_CONCURRENCY=8`, `DEMO_WORK_MS=150ms`).

### Comparative Summary Table

| Metric | 💥 Unprotected Origin (:8081) | 🛡️ SurgeGuard Protected (:8080) |
| :--- | :--- | :--- |
| **Total Requests** | 8,964 | 2,427 |
| **Successful Responses** | 8,374 | **2,427 (100%)** |
| **Error Rate (5xx/429)** | **6.58% (590 dropped)** | **0.00% (Zero Drops)** |
| **Median Latency (p50)** | 1,601 ms | **154 ms** |
| **95th Percentile Latency (p95)**| 1,656 ms | **180 ms** |
| **Queue Wait (p95)** | N/A (Immediate 503) | 27.0 seconds |
| **Order Inversions** | N/A | **0 in 7,021 pairs** |

---

## ⚙️ Tuning & Custom Parameters

Override test parameters on the command line:

```bash
# Adjust Virtual Users (VUs) and duration
VUS=500 HOLD=90s make demo

# Adjust page views per visitor session and think time
PAGES=5 THINK=2s bash scripts/demo.sh protected
```

---

<div align="center">

### 🚀 SurgeGuard Load Testing

[Back to Main README](../README.md) • [Back to Top ⬆️](#surgeguard-k6-load-testing-validation)

</div>
