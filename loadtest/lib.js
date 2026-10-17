// Shared k6 helpers. One iteration = one visitor session (k6 resets the cookie jar per iteration).
import http from "k6/http";
import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

export const pageDuration = new Trend("page_duration", true);
export const pageErrors = new Rate("page_errors");
export const pageOk = new Counter("page_ok");
export const queueWait = new Trend("queue_wait", true);
export const admitted = new Counter("admitted_visitors");
export const stillQueued = new Counter("still_queued_at_end");
export const queueApiErrors = new Rate("queue_api_errors");
export const sessions = new Counter("sessions_completed");

export const PAGES_PER_SESSION = Number(__ENV.PAGES || 3);
export const THINK_SECONDS = Number(__ENV.THINK || 1);
const MAX_QUEUE_WAIT_S = Number(__ENV.MAX_QUEUE_WAIT || 120);
const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || "20s";

/** The identical traffic profile used for the unprotected and protected runs. */
export function surgeStages() {
  const vus = Number(__ENV.VUS || 300);
  return [
    { duration: __ENV.RAMP || "15s", target: vus },
    { duration: __ENV.HOLD || "60s", target: vus },
    { duration: "5s", target: 0 },
  ];
}

function isError(res) {
  return res.status === 0 || res.status >= 500 || res.status === 429;
}

/** A page view that reached the origin (or failed trying). Redirects to the waiting room are not page views. */
export function recordPage(res, tags) {
  pageDuration.add(res.timings.duration, tags);
  const failed = isError(res);
  pageErrors.add(failed, tags);
  if (res.status === 200) pageOk.add(1, tags);
  return !failed;
}

/** Wait in the SurgeGuard queue until admitted. Returns true when admitted. */
export function waitInQueue(base, tags = {}) {
  const started = Date.now();
  let res = http.post(`${base}/api/v1/queue/join`, null, { timeout: REQUEST_TIMEOUT, tags: { ...tags, kind: "queue" } });
  queueApiErrors.add(res.status !== 200, tags);
  while (Date.now() - started < MAX_QUEUE_WAIT_S * 1000) {
    if (res.status === 200) {
      const body = res.json();
      if (body.state === "admitted") {
        queueWait.add(Date.now() - started, tags);
        admitted.add(1, tags);
        return true;
      }
      if (body.state === "rejected") return false;
      sleep(Math.max(0.5, Number(body.poll_after_seconds || 3)));
      res = http.get(`${base}/api/v1/queue/status`, { timeout: REQUEST_TIMEOUT, tags: { ...tags, kind: "queue" } });
    } else {
      sleep(2);
      res = http.post(`${base}/api/v1/queue/join`, null, { timeout: REQUEST_TIMEOUT, tags: { ...tags, kind: "queue" } });
    }
    queueApiErrors.add(res.status !== 200, tags);
  }
  stillQueued.add(1, tags);
  return false;
}

/**
 * One visitor session against either endpoint:
 *   direct    -> PAGES page views straight away
 *   protected -> first request is redirected to the waiting room; wait, then PAGES page views
 */
export function visitorSession(base, tagFn = () => ({})) {
  let res = http.get(`${base}/`, { redirects: 0, timeout: REQUEST_TIMEOUT, tags: { ...tagFn(), kind: "page" } });
  let pagesDone = 0;
  if (res.status === 302) {
    if (!waitInQueue(base, tagFn())) return;
  } else {
    recordPage(res, tagFn());
    pagesDone = 1;
    sleep(THINK_SECONDS);
  }
  for (; pagesDone < PAGES_PER_SESSION; pagesDone++) {
    res = http.get(`${base}/`, { redirects: 0, timeout: REQUEST_TIMEOUT, tags: { ...tagFn(), kind: "page" } });
    if (res.status === 302) {
      // Token expired or was revoked mid-session: back to the queue.
      if (!waitInQueue(base, tagFn())) return;
      continue;
    }
    recordPage(res, tagFn());
    sleep(THINK_SECONDS);
  }
  sessions.add(1, tagFn());
}

function metricValues(data, name) {
  return data.metrics[name] ? data.metrics[name].values : null;
}

/** Compact, honest summary: only metrics k6 actually measured. */
export function summarize(data, label, extra = {}) {
  const pd = metricValues(data, "page_duration");
  const pe = metricValues(data, "page_errors");
  const qw = metricValues(data, "queue_wait");
  const counters = (name) => (metricValues(data, name) ? metricValues(data, name).count : 0);
  return {
    label,
    finished_at: new Date().toISOString(),
    config: {
      vus: Number(__ENV.VUS || 300),
      ramp: __ENV.RAMP || "15s",
      hold: __ENV.HOLD || "60s",
      pages_per_session: PAGES_PER_SESSION,
      think_seconds: THINK_SECONDS,
      target: __ENV.TARGET,
    },
    page_requests: pe ? pe.passes + pe.fails : 0,
    page_ok: counters("page_ok"),
    page_error_rate: pe ? pe.rate : null,
    page_p50_ms: pd ? pd.med : null,
    page_p95_ms: pd ? pd["p(95)"] : null,
    page_max_ms: pd ? pd.max : null,
    sessions_completed: counters("sessions_completed"),
    admitted_visitors: counters("admitted_visitors"),
    still_queued_at_end: counters("still_queued_at_end"),
    queue_wait_p50_ms: qw ? qw.med : null,
    queue_wait_p95_ms: qw ? qw["p(95)"] : null,
    total_http_requests: metricValues(data, "http_reqs") ? metricValues(data, "http_reqs").count : 0,
    ...extra,
  };
}

export function fmt(value, digits = 0, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${Number(value).toFixed(digits)}${suffix}`;
}
