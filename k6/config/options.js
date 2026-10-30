/**
 * SurgeGuard k6 Configuration and Shared Utilities
 *
 * Provides centralized environment variable parsing, safety ceilings,
 * custom metrics, and reusable queue interaction helpers.
 */

import http from "k6/http";
import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// ─── Target URLs ─────────────────────────────────────────────────────────────
// Real public domains are the defaults for EC2/external runs.
// Set GUARDED_URL / UNGUARDED_URL env vars to override for local container use.
export const GUARDED_URL = (
  __ENV.GUARDED_URL ||
  __ENV.TARGET_GUARDED ||
  __ENV.TARGET ||
  "https://surgeguard-protected.duckdns.org"
).replace(/\/$/, "");

export const UNGUARDED_URL = (
  __ENV.UNGUARDED_URL ||
  __ENV.TARGET_UNGUARDED ||
  "https://surgeguard-direct.duckdns.org"
).replace(/\/$/, "");

// ─── Safety and Tunables ─────────────────────────────────────────────────────
export const DEFAULT_VUS = Math.min(Number(__ENV.VUS || 10), Number(__ENV.MAX_VUS || 100));
export const RAMP_DURATION = __ENV.RAMP || "10s";
export const HOLD_DURATION = __ENV.HOLD || "25s";
export const COOLDOWN_DURATION = __ENV.COOLDOWN || "5s";
export const THINK_SECONDS = Number(__ENV.THINK || 0.5);
export const MAX_QUEUE_WAIT_SECONDS = Number(__ENV.MAX_QUEUE_WAIT || 60);
export const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || "15s";

// TLS verification: disabled only when explicitly requested via INSECURE_TLS=true.
// Never disable globally in production — pass the CA cert via --ca-cert instead.
export const INSECURE_TLS = __ENV.INSECURE_TLS === "true";

// ─── Custom Telemetry Metrics ────────────────────────────────────────────────
export const guardedDuration = new Trend("guarded_page_duration", true);
export const guardedErrors = new Rate("guarded_page_errors");
export const guardedOk = new Counter("guarded_page_ok");
export const guarded503Count = new Counter("guarded_503_count");
export const queueWaitTime = new Trend("guarded_queue_wait", true);
export const queueAdmittedCount = new Counter("guarded_admitted_count");
export const queueJoinErrors = new Rate("guarded_queue_join_errors");

export const unguardedDuration = new Trend("unguarded_page_duration", true);
export const unguardedErrors = new Rate("unguarded_page_errors");
export const unguardedOk = new Counter("unguarded_page_ok");
export const unguarded503Count = new Counter("unguarded_503_count");

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Parses duration strings like "5s", "1m", "30" into integer seconds.
 */
export function parseDurationSeconds(durationStr, defaultSec = 10) {
  if (typeof durationStr === "number") return durationStr;
  if (!durationStr || typeof durationStr !== "string") return defaultSec;
  const match = durationStr.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h)?$/i);
  if (!match) return defaultSec;
  const num = parseFloat(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  if (unit === "m") return num * 60;
  if (unit === "h") return num * 3600;
  return num;
}

/**
 * Robust error check for HTTP responses.
 * Returns true if the response represents a connection failure or server error.
 * Note: 429 is a rate-limit, not a connection failure — treat as error for our purposes.
 */
export function isHttpError(res) {
  return !res || res.status === 0 || res.status >= 500 || res.status === 429;
}

/**
 * Handles the complete SurgeGuard waiting room lifecycle:
 * 1. POST /api/v1/queue/join
 * 2. Store session cookie automatically (k6 cookie jar)
 * 3. Poll /api/v1/queue/status until "admitted" token is issued
 * Returns true if admitted, false if timed out or rejected.
 */
export function enterAndPassQueue(baseUrl, tags = {}) {
  const started = Date.now();
  const joinUrl = `${baseUrl}/api/v1/queue/join`;
  const statusUrl = `${baseUrl}/api/v1/queue/status`;

  let res = http.post(joinUrl, null, {
    timeout: REQUEST_TIMEOUT,
    tags: { ...tags, stage: "queue_join" },
  });

  const joinFailed = isHttpError(res);
  queueJoinErrors.add(joinFailed ? 1 : 0, tags);
  let hasJoined = !joinFailed && res.status === 200;

  while (Date.now() - started < MAX_QUEUE_WAIT_SECONDS * 1000) {
    if (res.status === 200) {
      let body;
      try {
        body = res.json();
      } catch (_) {
        body = {};
      }

      if (body.state === "admitted") {
        queueWaitTime.add(Date.now() - started, tags);
        queueAdmittedCount.add(1, tags);
        return true;
      }

      if (body.state === "rejected") {
        return false;
      }

      const pollDelay = Math.max(0.5, Math.min(Number(body.poll_after_seconds || 2), 5));
      sleep(pollDelay);
      res = http.get(statusUrl, {
        timeout: REQUEST_TIMEOUT,
        tags: { ...tags, stage: "queue_poll" },
      });
    } else if (!hasJoined) {
      sleep(1);
      res = http.post(joinUrl, null, {
        timeout: REQUEST_TIMEOUT,
        tags: { ...tags, stage: "queue_retry" },
      });
      const retryFailed = isHttpError(res);
      queueJoinErrors.add(retryFailed ? 1 : 0, tags);
      if (!retryFailed && res.status === 200) {
        hasJoined = true;
      }
    } else {
      // Already joined; transient status poll failure, retry status poll
      sleep(1);
      res = http.get(statusUrl, {
        timeout: REQUEST_TIMEOUT,
        tags: { ...tags, stage: "queue_poll_retry" },
      });
    }
  }

  return false;
}

/**
 * Safe number formatting helper. Returns "n/a" for null/undefined/NaN.
 */
export function fmt(val, digits = 0, suffix = "") {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return "n/a";
  return `${Number(val).toFixed(digits)}${suffix}`;
}

/**
 * Extracts and formats benchmark metrics from k6 summary data.
 */
export function extractMetrics(data, label, extra = {}) {
  const getMetric = (name) => (data.metrics[name] ? data.metrics[name].values : null);
  const getCount = (name) => {
    const m = getMetric(name);
    if (!m) return 0;
    // Counter metrics report `count` in values
    return m.count !== undefined ? m.count : 0;
  };

  const gDur = getMetric("guarded_page_duration");
  const gErr = getMetric("guarded_page_errors");
  const uDur = getMetric("unguarded_page_duration");
  const uErr = getMetric("unguarded_page_errors");
  const qWait = getMetric("guarded_queue_wait");

  // Total guarded requests = admitted visits (for guarded, only admitted visitors make page requests)
  const gAdmitted = getCount("guarded_admitted_count");
  const gOk = getCount("guarded_page_ok");
  const g503 = getCount("guarded_503_count");
  // Total guarded page requests = ok + 503 + (error rate * total attempts)
  const gTotal = gOk + g503 + (gErr ? Math.round(gErr.passes || 0) : 0);

  // Total unguarded requests = ok + 503 + connection errors
  const uOk = getCount("unguarded_page_ok");
  const u503 = getCount("unguarded_503_count");
  const uTotal = uOk + u503 + (uErr ? Math.round(uErr.passes || 0) : 0);

  return {
    label,
    timestamp: new Date().toISOString(),
    config: {
      vus: DEFAULT_VUS,
      ramp: RAMP_DURATION,
      hold: HOLD_DURATION,
      guardedUrl: GUARDED_URL,
      unguardedUrl: UNGUARDED_URL,
    },
    guarded: {
      requests: gTotal,
      success200: gOk,
      error503: g503,
      errorRate: gErr ? gErr.rate : null,
      p50Ms: gDur ? gDur.med : null,
      p95Ms: gDur ? gDur["p(95)"] : null,
      p99Ms: gDur ? gDur["p(99)"] : null,
      admittedVisitors: gAdmitted,
      queueWaitP95Ms: qWait ? qWait["p(95)"] : null,
    },
    unguarded: {
      requests: uTotal,
      success200: uOk,
      error503: u503,
      errorRate: uErr ? uErr.rate : null,
      p50Ms: uDur ? uDur.med : null,
      p95Ms: uDur ? uDur["p(95)"] : null,
      p99Ms: uDur ? uDur["p(99)"] : null,
    },
    totalHttpRequests: getCount("http_reqs"),
    ...extra,
  };
}
