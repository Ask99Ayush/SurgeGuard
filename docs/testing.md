# Testing

## Automated suites

| Suite | Command | Runs against | Last result (2026-10-17, this machine) |
|---|---|---|---|
| Backend: ruff, ruff format, mypy (strict), pytest | `make test-backend` | throwaway real Redis 7.4 in Docker | **63 passed**, lint/type clean |
| Frontend: Vitest + Testing Library | `make test-frontend` | jsdom / node | **38 passed** |
| Frontend: eslint, tsc, `next build` | `make lint`, `npm run build` | — | clean, build OK |
| Proxy / security boundaries | `make test-proxy` | running Compose stack | **22 passed** |
| Fail-closed (stops Redis, then API) | `bash scripts/fail-closed-check.sh` | running stack | **7 passed** |
| Redis alert (up → quiet, stopped → firing, restarted → resolved) | `make alert-check` | running stack | **3 passed** (2026-10-18) |
| End-to-end (Playwright, desktop + Pixel 7) | `make e2e` | running stack | **14 passed** |
| Terraform | `make terraform-validate` | offline | fmt + validate OK |
| Secret scan | Gitleaks 8.21.2 over files Git would track | working tree | no leaks |

Coverage of the brief's list:

- **Backend** — FIFO ordering; 200 concurrent registrations get unique, gap-free sequences and consistent ranks; duplicate joins are idempotent; heartbeat expiry; rejoin inside/outside the grace window; queue full; every state transition incl. invalid ones; token-bucket rate (burst, refill, cap); FIFO admission; `MAX_ACTIVE_ADMITTED`; pause; fencing (non-leader cannot admit); 4 concurrent workers never double-admit; restart recovery after lock TTL; health hysteresis; auto-pause and resume; tokens (valid, expired, tampered, wrong secret, issuer, audience, `alg=none`, missing claim, unknown kid, key rotation); visitor cookie tampering; unauthorized admin access on every admin route; Redis outage → 503 everywhere and the worker admits nobody; config fail-fast.
- **Proxy** — unadmitted → waiting room; POST without token never reaches origin; reusable token incl. form POST; forged/expired/wrong-aud/unknown-kid/`alg=none`/tampered/other-visitor/revoked tokens rejected; spoofed internal headers ignored; `/internal/*`, `/_sg_auth`, admin API and `/metrics` are 404 publicly; `/internal/auth` rejects callers without the proxy secret; direct origin access 403; static cache HIT without cookies, dynamic responses never cached; per-IP join rate limit returns 429. Retries/timeouts and backend failure are exercised by the k6 failure run below.
- **Frontend** — loading/empty/error/disconnected states, status updates by polling, paused/rejected/admitted/expired flows, fail-closed copy, same-site redirect only, login success/error/rate-limit, middleware redirects and 401s, forged sessions, accessible dialog/radiogroup. Playwright: join → wait → admitted → form submit, HttpOnly/SameSite cookies, admin route protection, login, dashboard/queue/backends/monitoring/settings, logout.

## Load test results (measured)

Setup: see `loadtest/README.md` (single laptop, k6 on the same machine as the stack). One run each;
numbers will vary between runs and machines.

### Surge: identical profile, 300 VUs, 60 s hold

| Metric | Unprotected (`:8081`) | With SurgeGuard (`:8080`) |
|---|---|---|
| Page requests | 8,964 | 2,427 |
| Successful pages (200) | 8,374 | 2,427 |
| Page error rate | 6.58 % | 0.00 % |
| Page latency p50 | 1,601 ms | 154 ms |
| Page latency p95 | 1,656 ms | 180 ms |
| Sessions completed | 2,948 | 785 |
| Visitors admitted via queue | n/a | 821 |
| Queue wait p50 / p95 | n/a | 24.0 s / 27.0 s |
| Still queued at end | n/a | 0 |

How to read this: with SurgeGuard, every page that reached the origin succeeded, at about a tenth of
the latency. The cost is waiting: visitors queued for ~24–27 s, and fewer sessions were served in the
same minute, because `ADMISSION_RATE=10/s` is deliberately below the origin's capacity. Raising the rate
toward capacity would serve more sessions; finding that point is a tuning exercise (TBD).
The unprotected origin did not collapse completely in this run; it degraded (≈1.6 s per page, 6.6 % 503s).

### Backend failure: protected, 150 VUs, demo-2 killed at 25 s, restarted at 55 s

| Phase | Page requests | Error rate | p95 latency |
|---|---|---|---|
| before | 669 | 0.00 % | 261 ms |
| during (one backend down) | 543 | 0.00 % | 691 ms |
| after | 874 | 0.00 % | 183 ms |

Active health checks marked demo-2 down **3.3 s** after the kill and healthy **5.8 s** after restart
(polled every 0.25 s, so ±0.25 s plus `docker exec` overhead). While it was down, Nginx retried
idempotent requests on the healthy instance; by design the worker also scales admission to healthy/total (half here), which this run did not measure separately.

### Fairness: 120 visitors joining 30 ms apart

120 admitted; 0 position regressions; **0 order inversions** beyond 1 s tolerance out of 7,021 ordered pairs.

### Not measured

| Metric | Status |
|---|---|
| Cloud test results and cost | TBD (nothing deployed) |
| Behaviour above 300 VUs / with distributed load generators | TBD |
| Optimal admission rate for this origin | TBD |
