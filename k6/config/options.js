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
// Supports explicit environment variables, falling back to sensible host or container defaults.
export const GUARDED_URL = (
  __ENV.GUARDED_URL ||
  __ENV.TARGET_GUARDED ||
  __ENV.TARGET ||
  "https://localhost:8080"
).replace(/\/$/, "");

export const UNGUARDED_URL = (
  __ENV.UNGUARDED_URL ||
  __ENV.TARGET_UNGUARDED ||
  "http://127.0.0.1:8081"
).replace(/\/$/, "");

// ─── Safety and Tunables ─────────────────────────────────────────────────────
// Conservative default load to safeguard EC2 / local host resources.
export const DEFAULT_VUS = Math.min(Number(__ENV.VUS || 10), Number(__ENV.MAX_VUS || 100));
export const RAMP_DURATION = __ENV.RAMP || "10s";
export const HOLD_DURATION = __ENV.HOLD || "25s";
export const COOLDOWN_DURATION = __ENV.COOLDOWN || "5s";
export const THINK_SECONDS = Number(__ENV.THINK || 0.5);
export const MAX_QUEUE_WAIT_SECONDS = Number(__ENV.MAX_QUEUE_WAIT || 60);
export const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || "10s";

// TLS verification: disabled only when explicitly requested
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
  queueJoinErrors.add(joinFailed, tags);
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
      queueJoinErrors.add(retryFailed, tags);
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
 * Safe number formatting helper.
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
  const getCount = (name) => (getMetric(name) ? getMetric(name).count : 0);

  const gDur = getMetric("guarded_page_duration");
  const gErr = getMetric("guarded_page_errors");
  const uDur = getMetric("unguarded_page_duration");
  const uErr = getMetric("unguarded_page_errors");
  const qWait = getMetric("guarded_queue_wait");

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
      requests: getCount("guarded_page_ok") + (gErr ? gErr.passes : 0),
      success200: getCount("guarded_page_ok"),
      error503: getCount("guarded_503_count"),
      errorRate: gErr ? gErr.rate : 0,
      p50Ms: gDur ? gDur.med : null,
      p95Ms: gDur ? gDur["p(95)"] : null,
      p99Ms: gDur ? gDur["p(99)"] : null,
      admittedVisitors: getCount("guarded_admitted_count"),
      queueWaitP95Ms: qWait ? qWait["p(95)"] : null,
    },
    unguarded: {
      requests: getCount("unguarded_page_ok") + (uErr ? uErr.passes : 0),
      success200: getCount("unguarded_page_ok"),
      error503: getCount("unguarded_503_count"),
      errorRate: uErr ? uErr.rate : 0,
      p50Ms: uDur ? uDur.med : null,
      p95Ms: uDur ? uDur["p(95)"] : null,
      p99Ms: uDur ? uDur["p(99)"] : null,
    },
    totalHttpRequests: getCount("http_reqs"),
    ...extra,
  };
}
