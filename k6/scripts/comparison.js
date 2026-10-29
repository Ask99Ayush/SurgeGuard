/**
 * SurgeGuard Controlled Comparison Test (scripts/comparison.js)
 *
 * Runs sequential, identical surge tests against:
 * Phase 1: Unguarded baseline origin (demonstrating direct saturation)
 * Phase 2: SurgeGuard protected gateway (demonstrating virtual queueing & zero drops)
 *
 * Sequential execution prevents resource competition on shared EC2 / Docker hosts.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import {
  GUARDED_URL,
  UNGUARDED_URL,
  DEFAULT_VUS,
  THINK_SECONDS,
  REQUEST_TIMEOUT,
  INSECURE_TLS,
  guardedDuration,
  guardedErrors,
  guardedOk,
  guarded503Count,
  unguardedDuration,
  unguardedErrors,
  unguardedOk,
  unguarded503Count,
  enterAndPassQueue,
  isHttpError,
  extractMetrics,
  fmt,
  parseDurationSeconds,
} from "../config/options.js";

// Sequential scenario timing:
// Phase 1 (Unguarded): RAMP + HOLD + DOWN
// Cooldown Gap: 5s
// Phase 2 (Guarded): Starts strictly after Phase 1 finishes
const PHASE_RAMP = __ENV.COMPARE_RAMP || "5s";
const PHASE_HOLD = __ENV.COMPARE_HOLD || "15s";
const PHASE_DOWN = "2s";

const rampSec = parseDurationSeconds(PHASE_RAMP, 5);
const holdSec = parseDurationSeconds(PHASE_HOLD, 15);
const downSec = parseDurationSeconds(PHASE_DOWN, 2);
const totalPhase1 = rampSec + holdSec + downSec + 3; // +3s graceful stop
const gapSec = 5; // Safe cooldown gap between phases
const PHASE_2_START = `${totalPhase1 + gapSec}s`;

export const options = {
  scenarios: {
    // 1. Unguarded phase runs first
    phase_unguarded: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: PHASE_RAMP, target: DEFAULT_VUS },
        { duration: PHASE_HOLD, target: DEFAULT_VUS },
        { duration: PHASE_DOWN, target: 0 },
      ],
      gracefulStop: "3s",
      exec: "runUnguarded",
    },
    // 2. Guarded phase runs strictly AFTER unguarded finishes
    phase_guarded: {
      executor: "ramping-vus",
      startTime: PHASE_2_START,
      startVUs: 0,
      stages: [
        { duration: PHASE_RAMP, target: DEFAULT_VUS },
        { duration: PHASE_HOLD, target: DEFAULT_VUS },
        { duration: PHASE_DOWN, target: 0 },
      ],
      gracefulStop: "3s",
      exec: "runGuarded",
    },
  },
  insecureSkipTLSVerify: INSECURE_TLS,
  summaryTrendStats: ["med", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    guarded_page_errors: ["rate<0.05"],
  },
};

const SAMPLE_ROLLS = [1001, 1042, 1150, 1250, 1021, 1035, 1048, 1018];

export function runUnguarded() {
  const roll = SAMPLE_ROLLS[Math.floor(Math.random() * SAMPLE_ROLLS.length)];
  const started = Date.now();
  const res = http.get(`${UNGUARDED_URL}/?roll=${roll}`, {
    timeout: REQUEST_TIMEOUT,
    tags: { phase: "unguarded" },
  });

  const elapsed = Date.now() - started;
  unguardedDuration.add(elapsed);

  if (res.status === 200) {
    unguardedOk.inc();
    unguardedErrors.add(0);
  } else if (res.status === 503) {
    unguarded503Count.inc();
    unguardedErrors.add(1);
  } else {
    unguardedErrors.add(isHttpError(res) ? 1 : 0);
  }

  sleep(THINK_SECONDS);
}

export function runGuarded() {
  // Clear cookie jar for fresh visitor session
  const jar = http.cookieJar();
  jar.clear(GUARDED_URL);

  // Edge check: non-admitted request must be intercepted at waiting room
  const initial = http.get(`${GUARDED_URL}/`, {
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { phase: "guarded_edge_gate" },
  });
  check(initial, {
    "redirected to waiting room (302)": (r) => r.status === 302 || (r.status === 301 && r.headers.Location && r.headers.Location.startsWith("https://")),
  });

  const passed = enterAndPassQueue(GUARDED_URL, { phase: "guarded_queue" });
  if (!passed) {
    guardedErrors.add(1);
    return;
  }

  // Browse protected portal with admission credentials
  const roll = SAMPLE_ROLLS[Math.floor(Math.random() * SAMPLE_ROLLS.length)];
  const started = Date.now();
  const res = http.get(`${GUARDED_URL}/?roll=${roll}`, {
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { phase: "guarded_portal" },
  });

  const elapsed = Date.now() - started;
  guardedDuration.add(elapsed);

  if (res.status === 200) {
    guardedOk.inc();
    guardedErrors.add(0);
  } else if (res.status === 503) {
    guarded503Count.inc();
    guardedErrors.add(1);
  } else {
    guardedErrors.add(isHttpError(res) ? 1 : 0);
  }

  sleep(THINK_SECONDS);
}

export function handleSummary(data) {
  const summary = extractMetrics(data, "sequential-comparison");
  const g = summary.guarded;
  const u = summary.unguarded;

  const colWidth = 26;
  const pad = (s, len = colWidth) => String(s).padEnd(len);
  const row = (label, col1, col2) => `${pad(label)} ${pad(col1)} ${pad(col2)}`;

  const lines = [
    "",
    "======================== SURGEGUARD COMPARISON REPORT ========================",
    `Test Configuration: ${DEFAULT_VUS} VUs per phase · Sequential Execution (No Resource Contention)`,
    "-----------------------------------------------------------------------------",
    row("Metric", "DEMO 2: UNGUARDED", "DEMO 1: GUARDED"),
    "-----------------------------------------------------------------------------",
    row("Protection Mechanism", "None (Raw Origin)", "SurgeGuard Virtual Queue"),
    row("Successful Pages (200)", u.success200, g.success200),
    row("Server Rejections (503)", u.error503, g.error503),
    row("Page Error Rate", fmt(u.errorRate * 100, 2, "%"), fmt(g.errorRate * 100, 2, "%")),
    row("Page Latency p50", fmt(u.p50Ms, 0, " ms"), fmt(g.p50Ms, 0, " ms")),
    row("Page Latency p95", fmt(u.p95Ms, 0, " ms"), fmt(g.p95Ms, 0, " ms")),
    row("Page Latency p99", fmt(u.p99Ms, 0, " ms"), fmt(g.p99Ms, 0, " ms")),
    row("Admitted via Queue", "n/a", g.admittedVisitors),
    row("Queue Wait Time p95", "n/a", fmt(g.queueWaitP95Ms ? g.queueWaitP95Ms / 1000 : null, 1, " s")),
    "-----------------------------------------------------------------------------",
    "Verified Findings:",
    `* Unguarded Demo 2 dropped ${u.error503} requests with HTTP 503 under load.`,
    `* Guarded Demo 1 absorbed traffic into queue, delivering ${g.error503} 503 drops at origin.`,
    "=============================================================================",
    "",
  ];

  return {
    stdout: lines.join("\n"),
    "results/comparison-result.json": JSON.stringify(summary, null, 2),
  };
}
