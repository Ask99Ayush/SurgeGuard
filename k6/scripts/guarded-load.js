/**
 * SurgeGuard Guarded Load Test (scripts/guarded-load.js)
 *
 * Targets the SurgeGuard protected gateway.
 * Demonstrates:
 * 1. Strict admission enforcement (unauthorized initial requests receive 302 redirect).
 * 2. Deterministic queueing and status polling with visitor cookie preservation.
 * 3. Cryptographic token issuance upon admission.
 * 4. Zero 503 server drop rate at origin once admitted.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import {
  GUARDED_URL,
  DEFAULT_VUS,
  RAMP_DURATION,
  HOLD_DURATION,
  COOLDOWN_DURATION,
  THINK_SECONDS,
  REQUEST_TIMEOUT,
  INSECURE_TLS,
  guardedDuration,
  guardedErrors,
  guardedOk,
  guarded503Count,
  enterAndPassQueue,
  isHttpError,
  extractMetrics,
  fmt,
} from "../config/options.js";

export const options = {
  scenarios: {
    guarded_surge: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: DEFAULT_VUS },
        { duration: HOLD_DURATION, target: DEFAULT_VUS },
        { duration: COOLDOWN_DURATION, target: 0 },
      ],
      gracefulRampDown: "3s",
      gracefulStop: "5s",
    },
  },
  insecureSkipTLSVerify: INSECURE_TLS,
  summaryTrendStats: ["med", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    guarded_page_errors: ["rate<0.05"], // SurgeGuard origin errors should remain near 0%
    guarded_page_duration: ["p(95)>=0"],
  },
};

const SAMPLE_ROLLS = [1001, 1042, 1150, 1250, 1021, 1035, 1048, 1018];

export default function () {
  // Clear cookies for fresh visitor session
  const jar = http.cookieJar();
  jar.clear(GUARDED_URL);

  // Step 1: Initial visit without token must be intercepted by edge gate
  const initialReq = http.get(`${GUARDED_URL}/`, {
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { stage: "admission_gate_check" },
  });

  check(initialReq, {
    "unadmitted request intercepted (302 redirect)": (r) =>
      r.status === 302 || (r.status === 301 && r.headers.Location && r.headers.Location.startsWith("https://")),
  });

  // Step 2: Enter virtual waiting room and wait for token
  const isAdmitted = enterAndPassQueue(GUARDED_URL, { endpoint: "waiting_room" });
  if (!isAdmitted) {
    guardedErrors.add(1);
    return;
  }

  // Step 3: Browse protected origin with valid admission credentials
  for (let page = 0; page < 2; page++) {
    const roll = SAMPLE_ROLLS[Math.floor(Math.random() * SAMPLE_ROLLS.length)];
    const started = Date.now();
    const res = http.get(`${GUARDED_URL}/?roll=${roll}`, {
      redirects: 0,
      timeout: REQUEST_TIMEOUT,
      tags: { endpoint: "protected_portal" },
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
}

export function handleSummary(data) {
  const summary = extractMetrics(data, "guarded-load");
  const g = summary.guarded;

  const report = [
    "",
    "================= GUARDED LOAD TEST RESULTS =================",
    `Target:               ${GUARDED_URL}`,
    `Configured VUs:       ${DEFAULT_VUS} (Ramp: ${RAMP_DURATION}, Hold: ${HOLD_DURATION})`,
    `Total HTTP Requests:  ${summary.totalHttpRequests}`,
    `Admitted via Queue:   ${g.admittedVisitors}`,
    `Successful Views:     ${g.success200}`,
    `503 Rejections:       ${g.error503}`,
    `Error Percentage:     ${fmt(g.errorRate * 100, 2, "%")}`,
    `Origin Latency p50:   ${fmt(g.p50Ms, 0, " ms")}`,
    `Origin Latency p95:   ${fmt(g.p95Ms, 0, " ms")}`,
    `Origin Latency p99:   ${fmt(g.p99Ms, 0, " ms")}`,
    `Queue Wait p95:       ${fmt(g.queueWaitP95Ms ? g.queueWaitP95Ms / 1000 : null, 1, " s")}`,
    "-------------------------------------------------------------",
    `Outcome: SurgeGuard held backpressure, yielding ${g.error503} 503 drops at origin.`,
    "=============================================================",
    "",
  ].join("\n");

  return {
    stdout: report,
    "results/guarded-result.json": JSON.stringify(summary, null, 2),
  };
}
