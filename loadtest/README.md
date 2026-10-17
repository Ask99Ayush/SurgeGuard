# Load tests (k6)

All scenarios run in the `grafana/k6:1.0.0` container on the Compose `edge` network
(`docker compose --profile loadtest run k6 …`), so no local k6 install is needed. `make demo` runs them
in order and prints a side-by-side summary; results land in `loadtest/results/` (git-ignored).

| Script | What it does |
|---|---|
| `surge.js` | One iteration = one visitor session of `PAGES` (3) page views with `THINK` (1 s) between them. Ramp to `VUS` (300) over `RAMP` (15 s), hold `HOLD` (60 s). Run unchanged against `:8081` (unprotected) and `:8080` (protected). On the protected path the first request is redirected to the waiting room; the VU joins, polls at the server's interval until admitted, then does its page views. k6 resets cookies per iteration, so every session is a new visitor. |
| `backend-failure.js` | Protected path, `VUS` (150) constant for 85 s; `scripts/demo.sh` SIGKILLs `demo-2` at 25 s and starts it at 55 s. Requests are tagged `before/during/after`. The script also times how long the worker's active checks take to mark the backend down and healthy again (polling Redis every 0.25 s). |
| `queue-fairness.js` | 120 visitors join 30 ms apart and poll every 0.5 s. Counts position regressions (position going up) and, in `compare.js`, order inversions: a visitor who joined >50 ms earlier but was admitted >1 s later than someone behind them. The tolerance covers poll and worker-tick granularity. |
| `compare.js` | Reads `results/*.json` and prints the comparison. Sends no traffic. |

Metrics: `page_errors` (status 0 / 5xx / 429 on page views), `page_duration`, `page_ok`, `queue_wait`,
`admitted_visitors`, `still_queued_at_end`, `sessions_completed`. Redirects to the waiting room are not
counted as page views.

## Recorded run configuration (2026-10-17)

| | |
|---|---|
| Host | Intel Core i5-12500H (12 cores / 16 threads), 15.6 GB RAM, Windows 11 Home |
| Docker | Docker Desktop, engine 29.8.2, VM with 16 CPUs / 7.6 GB |
| k6 | grafana/k6:1.0.0 (same machine as the stack, so load generator and system under test share CPU) |
| Origin | 2 × demo-site, `DEMO_MAX_CONCURRENCY=8`, `DEMO_WORK_MS=150` (±20 %), `DEMO_QUEUE_TIMEOUT_MS=1500`, 0.5 CPU each |
| SurgeGuard | `ADMISSION_RATE=10`, `ADMISSION_BURST=10`, `TOKEN_TTL_SECONDS=300`, poll 3 s, tick 0.5 s |
| Profile | 300 VUs, 15 s ramp, 60 s hold, 3 pages/session, 1 s think time |

Results: see `docs/testing.md`. Re-run with `make demo`; tune with `VUS=… HOLD=… make demo`.
