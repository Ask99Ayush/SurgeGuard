/**
 * SurgeGuard Unguarded Baseline Load Test (scripts/unguarded-load.js)
 *
 * Targets ONLY the direct demo origin without virtual waiting room protection.
 * Demonstrates origin saturation, semaphore queue timeouts, HTTP 503 rejections,
 * and degraded response latency under surge conditions.
 */

import http from "k6/http";
import { sleep } from "k6";
import {
  UNGUARDED_URL,
  DEFAULT_VUS,
  RAMP_DURATION,
  HOLD_DURATION,
  COOLDOWN_DURATION,
  THINK_SECONDS,
  REQUEST_TIMEOUT,
  INSECURE_TLS,
  unguardedDuration,
  unguardedErrors,
  unguardedOk,
  unguarded503Count,
  isHttpError,
  extractMetrics,
  fmt,
} from "../config/options.js";

export const options = {
  scenarios: {
    unguarded_surge: {
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
    // Informational threshold: Track error rate without aborting execution
    unguarded_page_errors: ["rate>=0"],
    unguarded_page_duration: ["p(95)>=0"],
  },
};

const SAMPLE_ROLLS = [1001, 1042, 1150, 1250, 1021, 1035, 1048, 1018];

export default function () {
  const roll = SAMPLE_ROLLS[Math.floor(Math.random() * SAMPLE_ROLLS.length)];
  const url = `${UNGUARDED_URL}/?roll=${roll}`;

  const started = Date.now();
  const res = http.get(url, {
    timeout: REQUEST_TIMEOUT,
    tags: { endpoint: "unguarded_portal" },
  });

  const durationMs = Date.now() - started;
  unguardedDuration.add(durationMs);

  if (res.status === 200) {
    unguardedOk.add(1);
    unguardedErrors.add(0);
  } else if (res.status === 503) {
    unguarded503Count.add(1);
    unguardedErrors.add(1);
  } else if (res.status === 0) {
    // Connection failure (timeout, refused, etc.)
    unguardedErrors.add(1);
  } else {
    unguardedErrors.add(isHttpError(res) ? 1 : 0);
  }

  sleep(THINK_SECONDS);
}

export function handleSummary(data) {
  const summary = extractMetrics(data, "unguarded-load");
  const u = summary.unguarded;

  const report = [
    "",
    "================ UNGUARDED LOAD TEST RESULTS ================",
    `Target:               ${UNGUARDED_URL}`,
    `Configured VUs:       ${DEFAULT_VUS} (Ramp: ${RAMP_DURATION}, Hold: ${HOLD_DURATION})`,
    `Total HTTP Requests:  ${summary.totalHttpRequests}`,
    `Measured Requests:    ${u.requests}`,
    `200 OK Responses:     ${u.success200}`,
    `503 Saturated Drops:  ${u.error503}`,
    `Error Percentage:     ${u.errorRate !== null ? fmt(u.errorRate * 100, 2, "%") : "n/a"}`,
    `Latency p50:          ${fmt(u.p50Ms, 0, " ms")}`,
    `Latency p95:          ${fmt(u.p95Ms, 0, " ms")}`,
    `Latency p99:          ${fmt(u.p99Ms, 0, " ms")}`,
    "-------------------------------------------------------------",
    "Outcome: Demonstrates origin saturation and 503 drops without queue.",
    "=============================================================",
    "",
  ].join("\n");

  return {
    stdout: report,
    "results/unguarded-result.json": JSON.stringify(summary, null, 2),
  };
}
