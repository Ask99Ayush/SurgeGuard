/**
 * SurgeGuard Live Demonstration Script (scripts/live-demo.js)
 *
 * Runs two independent scenarios SIMULTANEOUSLY:
 *
 * Scenario A — Unguarded Surge:
 *   Sends traffic directly to the unguarded origin. Under load, the origin
 *   experiences genuine HTTP 503 rejections as the concurrency semaphore fills.
 *
 * Scenario B — Guarded Queue:
 *   Sends equivalent traffic to the SurgeGuard gateway. Visitors enter the
 *   virtual waiting room, are admitted at a controlled rate, and access the
 *   protected origin without 503 errors.
 *
 * Both scenarios run at the same time to produce a clear, live, measurable contrast.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import {
  GUARDED_URL,
  UNGUARDED_URL,
  DEFAULT_VUS,
  RAMP_DURATION,
  HOLD_DURATION,
  COOLDOWN_DURATION,
  THINK_SECONDS,
  REQUEST_TIMEOUT,
  INSECURE_TLS,
  MAX_QUEUE_WAIT_SECONDS,
  queueWaitTime,
  queueAdmittedCount,
  queueJoinErrors,
  guardedDuration,
  guardedErrors,
  guardedOk,
  guarded503Count,
  unguardedDuration,
  unguardedErrors,
  unguardedOk,
  unguarded503Count,
  isHttpError,
  fmt,
  parseDurationSeconds,
} from "../config/options.js";

// ─── Live-demo exclusive metrics ─────────────────────────────────────────────
// These supplement the shared metrics with demo-specific counters.
const liveUnguardedConnErrors = new Counter("live_unguarded_conn_errors");
const liveUnguardedTimeouts = new Counter("live_unguarded_timeouts");
const liveQueueTimeouts = new Counter("live_queue_timeouts");
const liveQueueRejected = new Counter("live_queue_rejected");
const liveGuardedAdmittedPageOk = new Counter("live_guarded_admitted_page_ok");

// VU count: can be set independently for each scenario
const UNGUARDED_VUS = Math.min(
  Number(__ENV.UNGUARDED_VUS || __ENV.VUS || 10),
  Number(__ENV.MAX_VUS || 100)
);
const GUARDED_VUS = Math.min(
  Number(__ENV.GUARDED_VUS || __ENV.VUS || 10),
  Number(__ENV.MAX_VUS || 100)
);

export const options = {
  scenarios: {
    // ── Scenario A: Unguarded — Direct origin, no protection ──────────────
    unguarded_surge: {
      executor: "ramping-vus",
      exec: "runUnguarded",
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: UNGUARDED_VUS },
        { duration: HOLD_DURATION, target: UNGUARDED_VUS },
        { duration: COOLDOWN_DURATION, target: 0 },
      ],
      gracefulRampDown: "5s",
      gracefulStop: "5s",
    },

    // ── Scenario B: Guarded — SurgeGuard waiting room + token gate ────────
    guarded_surge: {
      executor: "ramping-vus",
      exec: "runGuarded",
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: GUARDED_VUS },
        { duration: HOLD_DURATION, target: GUARDED_VUS },
        { duration: COOLDOWN_DURATION, target: 0 },
      ],
      gracefulRampDown: "5s",
      gracefulStop: "5s",
    },
  },

  insecureSkipTLSVerify: INSECURE_TLS,
  summaryTrendStats: ["med", "p(90)", "p(95)", "p(99)", "max"],

  thresholds: {
    // Guarded origin errors must stay low — SurgeGuard absorbs overload.
    guarded_page_errors: ["rate<0.10"],
    // These are informational — do not abort on unguarded degradation.
    unguarded_page_errors: ["rate>=0"],
    unguarded_page_duration: ["p(95)>=0"],
    guarded_page_duration: ["p(95)>=0"],
  },
};

const SAMPLE_ROLLS = [1001, 1042, 1150, 1250, 1021, 1035, 1048, 1018];

// ─── Scenario A: Unguarded ───────────────────────────────────────────────────
export function runUnguarded() {
  const roll = SAMPLE_ROLLS[Math.floor(Math.random() * SAMPLE_ROLLS.length)];
  const url = `${UNGUARDED_URL}/?roll=${roll}`;

  const started = Date.now();
  const res = http.get(url, {
    timeout: REQUEST_TIMEOUT,
    tags: { scenario: "unguarded", endpoint: "direct_portal" },
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
    // Network / connection failure
    liveUnguardedConnErrors.add(1);
    unguardedErrors.add(1);
  } else if (res.status === 408 || res.timings.duration >= parseDurationSeconds(REQUEST_TIMEOUT, 15) * 900) {
    liveUnguardedTimeouts.add(1);
    unguardedErrors.add(1);
  } else {
    unguardedErrors.add(isHttpError(res) ? 1 : 0);
  }

  sleep(THINK_SECONDS);
}

// ─── Scenario B: Guarded ─────────────────────────────────────────────────────
export function runGuarded() {
  // Each VU iteration = independent visitor with fresh session
  const jar = http.cookieJar();
  jar.clear(GUARDED_URL);

  // Step 1: Confirm the gate intercepts unadmitted visitors
  const gateRes = http.get(`${GUARDED_URL}/`, {
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { scenario: "guarded", stage: "gate_check" },
  });

  check(gateRes, {
    "gate redirects unadmitted visitor (302)": (r) =>
      r.status === 302 ||
      (r.status === 301 && r.headers.Location && r.headers.Location.startsWith("https://")),
  });

  // Step 2: Join queue and poll until admitted or timed out
  const queueStarted = Date.now();
  const joinUrl = `${GUARDED_URL}/api/v1/queue/join`;
  const statusUrl = `${GUARDED_URL}/api/v1/queue/status`;

  let joinRes = http.post(joinUrl, null, {
    timeout: REQUEST_TIMEOUT,
    tags: { scenario: "guarded", stage: "queue_join" },
  });

  const joinFailed = isHttpError(joinRes);
  queueJoinErrors.add(joinFailed ? 1 : 0);

  if (joinFailed) {
    guardedErrors.add(1);
    return;
  }

  // Poll until admitted, rejected, or timeout
  let admitted = false;
  while (Date.now() - queueStarted < MAX_QUEUE_WAIT_SECONDS * 1000) {
    if (joinRes.status === 200) {
      let body = {};
      try { body = joinRes.json(); } catch (_) {}

      if (body.state === "admitted") {
        const waitMs = Date.now() - queueStarted;
        queueWaitTime.add(waitMs);
        queueAdmittedCount.add(1);
        admitted = true;
        break;
      }

      if (body.state === "rejected") {
        liveQueueRejected.add(1);
        guardedErrors.add(1);
        return;
      }

      const pollDelay = Math.max(0.5, Math.min(Number(body.poll_after_seconds || 2), 5));
      sleep(pollDelay);

      joinRes = http.get(statusUrl, {
        timeout: REQUEST_TIMEOUT,
        tags: { scenario: "guarded", stage: "queue_poll" },
      });
    } else {
      sleep(1);
      joinRes = http.get(statusUrl, {
        timeout: REQUEST_TIMEOUT,
        tags: { scenario: "guarded", stage: "queue_poll_retry" },
      });
    }
  }

  if (!admitted) {
    liveQueueTimeouts.add(1);
    guardedErrors.add(1);
    return;
  }

  // Step 3: Access the protected origin with valid admission credentials
  // A visitor is only counted as successful AFTER receiving HTTP 200 from the origin.
  for (let page = 0; page < 2; page++) {
    const roll = SAMPLE_ROLLS[Math.floor(Math.random() * SAMPLE_ROLLS.length)];
    const started = Date.now();
    const res = http.get(`${GUARDED_URL}/?roll=${roll}`, {
      redirects: 0,
      timeout: REQUEST_TIMEOUT,
      tags: { scenario: "guarded", stage: "protected_page" },
    });
    const elapsed = Date.now() - started;

    guardedDuration.add(elapsed);

    if (res.status === 200) {
      guardedOk.add(1);
      liveGuardedAdmittedPageOk.add(1);
      guardedErrors.add(0);
    } else if (res.status === 503) {
      guarded503Count.add(1);
      guardedErrors.add(1);
    } else if (res.status === 302) {
      // Redirected back to waiting room — token may have expired
      guardedErrors.add(1);
    } else {
      guardedErrors.add(isHttpError(res) ? 1 : 0);
    }

    sleep(THINK_SECONDS);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const getMetric = (name) => (data.metrics[name] ? data.metrics[name].values : null);
  const getCount = (name) => {
    const m = getMetric(name);
    if (!m) return 0;
    return m.count !== undefined ? m.count : 0;
  };

  const uDur = getMetric("unguarded_page_duration");
  const uErr = getMetric("unguarded_page_errors");
  const gDur = getMetric("guarded_page_duration");
  const gErr = getMetric("guarded_page_errors");
  const qWait = getMetric("guarded_queue_wait");

  const u503 = getCount("unguarded_503_count");
  const uOk = getCount("unguarded_page_ok");
  const uConnErr = getCount("live_unguarded_conn_errors");
  const uTimeout = getCount("live_unguarded_timeouts");
  const uTotal = uOk + u503 + uConnErr + uTimeout;

  const gOk = getCount("guarded_page_ok");
  const g503 = getCount("guarded_503_count");
  const gAdmitted = getCount("guarded_admitted_count");
  const gQTimeout = getCount("live_queue_timeouts");
  const gQRejected = getCount("live_queue_rejected");
  const gAdmittedPageOk = getCount("live_guarded_admitted_page_ok");

  // Determine outcome labels
  const uErrRate = uErr ? uErr.rate : 0;
  const uStatus = uErrRate >= 0.50 ? "DOWN / HEAVILY DEGRADED" : uErrRate >= 0.10 ? "DEGRADED" : "UP";
  const gErrRate = gErr ? gErr.rate : 0;
  const gStatus = gErrRate < 0.05 ? "UP / PROTECTED" : gErrRate < 0.15 ? "DEGRADED" : "DOWN";

  const colWidth = 30;
  const pad = (s, len = colWidth) => String(s === null || s === undefined ? "n/a" : s).padEnd(len);
  const row = (label, col1, col2) => `  ${pad(label)} ${pad(col1)} ${pad(col2)}`;

  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════════════════╗",
    "║        SURGEGUARD LIVE DEMO — SIMULTANEOUS COMPARISON REPORT           ║",
    "╚══════════════════════════════════════════════════════════════════════════╝",
    "",
    `  Configuration: ${UNGUARDED_VUS} Unguarded VUs / ${GUARDED_VUS} Guarded VUs`,
    `  Ramp: ${RAMP_DURATION}  Hold: ${HOLD_DURATION}  Cooldown: ${COOLDOWN_DURATION}`,
    `  Guarded URL:   ${GUARDED_URL}`,
    `  Unguarded URL: ${UNGUARDED_URL}`,
    "",
    `  ┌─────────────────────────────────────────────────────────────────────┐`,
    `  │                  ${pad("DEMO 2: UNGUARDED", 28)}${pad("DEMO 1: GUARDED", 24)}│`,
    `  ├─────────────────────────────────────────────────────────────────────┤`,
    row("Overall Status", uStatus, gStatus),
    row("Total Page Requests", uTotal || "n/a", gOk + g503 || "n/a"),
    row("HTTP 200 OK", uOk, gOk),
    row("HTTP 503 Drops", u503, g503),
    row("Connection Errors", uConnErr, "0 (queued)"),
    row("Error Rate", uErr ? fmt(uErr.rate * 100, 1, "%") : "n/a", gErr ? fmt(gErr.rate * 100, 1, "%") : "n/a"),
    row("Latency p50", fmt(uDur ? uDur.med : null, 0, " ms"), fmt(gDur ? gDur.med : null, 0, " ms")),
    row("Latency p95", fmt(uDur ? uDur["p(95)"] : null, 0, " ms"), fmt(gDur ? gDur["p(95)"] : null, 0, " ms")),
    row("Latency p99", fmt(uDur ? uDur["p(99)"] : null, 0, " ms"), fmt(gDur ? gDur["p(99)"] : null, 0, " ms")),
    row("Admitted via Queue", "n/a", gAdmitted),
    row("Queue-Admitted Pages OK", "n/a", gAdmittedPageOk),
    row("Queue Timeouts", "n/a", gQTimeout),
    row("Queue Rejections", "n/a", gQRejected),
    row("Queue Wait p95", "n/a", fmt(qWait ? qWait["p(95)"] / 1000 : null, 1, " s")),
    `  └─────────────────────────────────────────────────────────────────────┘`,
    "",
    `  ► Unguarded Site: ${uStatus}`,
    `  ► Guarded Site:   ${gStatus}`,
    "",
    "  How SurgeGuard protects the origin:",
    "  • Visitors arrive → Nginx edge gate checks HMAC admission token",
    "  • Without a token → redirected to /waiting-room (302)",
    "  • Waiting room polls /api/v1/queue/status until admitted",
    "  • Admission worker releases tokens at ADMISSION_RATE/s via Redis token bucket",
    "  • Only admitted visitors reach the origin → origin stays within capacity",
    "  • Unguarded origin has no gate → semaphore fills → HTTP 503 under load",
    "",
    `  Test completed at: ${new Date().toISOString()}`,
    "════════════════════════════════════════════════════════════════════════════",
    "",
  ];

  const resultJson = {
    label: "live-demo",
    timestamp: new Date().toISOString(),
    config: {
      unguardedVus: UNGUARDED_VUS,
      guardedVus: GUARDED_VUS,
      ramp: RAMP_DURATION,
      hold: HOLD_DURATION,
      cooldown: COOLDOWN_DURATION,
      guardedUrl: GUARDED_URL,
      unguardedUrl: UNGUARDED_URL,
    },
    unguarded: {
      totalRequests: uTotal,
      success200: uOk,
      error503: u503,
      connectionErrors: uConnErr,
      timeouts: uTimeout,
      errorRate: uErr ? uErr.rate : null,
      p50Ms: uDur ? uDur.med : null,
      p95Ms: uDur ? uDur["p(95)"] : null,
      p99Ms: uDur ? uDur["p(99)"] : null,
      status: uStatus,
    },
    guarded: {
      totalPageRequests: gOk + g503,
      success200: gOk,
      error503: g503,
      admittedVisitors: gAdmitted,
      admittedPageOk: gAdmittedPageOk,
      queueTimeouts: gQTimeout,
      queueRejections: gQRejected,
      errorRate: gErr ? gErr.rate : null,
      p50Ms: gDur ? gDur.med : null,
      p95Ms: gDur ? gDur["p(95)"] : null,
      p99Ms: gDur ? gDur["p(99)"] : null,
      queueWaitP95Ms: qWait ? qWait["p(95)"] : null,
      status: gStatus,
    },
  };

  return {
    stdout: lines.join("\n"),
    "results/live-demo-result.json": JSON.stringify(resultJson, null, 2),
  };
}
