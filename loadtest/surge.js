// Sudden surge against either endpoint with an identical traffic profile.
//   k6 run -e TARGET=http://nginx:8081 -e LABEL=unprotected surge.js
//   k6 run -e TARGET=http://nginx:8080 -e LABEL=protected   surge.js
import { fmt, summarize, surgeStages, visitorSession } from "./lib.js";

const TARGET = __ENV.TARGET;
const LABEL = __ENV.LABEL || "run";
if (!TARGET) throw new Error("set -e TARGET=<base url>");

export const options = {
  scenarios: {
    surge: { executor: "ramping-vus", startVUs: 0, stages: surgeStages(), gracefulRampDown: "5s", gracefulStop: "5s" },
  },
  summaryTrendStats: ["med", "p(95)", "max"],
  // Informational thresholds only (they make the numbers visible; they do not gate the demo).
  thresholds: { page_errors: ["rate>=0"], page_duration: ["p(95)>=0"] },
};

export default function () {
  visitorSession(TARGET);
}

export function handleSummary(data) {
  const s = summarize(data, LABEL);
  const lines = [
    "",
    `== ${LABEL} (${TARGET}) ==`,
    `page requests        ${s.page_requests}`,
    `successful pages     ${s.page_ok}`,
    `page error rate      ${fmt(s.page_error_rate * 100, 2, "%")}`,
    `page latency p50/p95 ${fmt(s.page_p50_ms)} / ${fmt(s.page_p95_ms)} ms`,
    `sessions completed   ${s.sessions_completed}`,
    `admitted via queue   ${s.admitted_visitors}`,
    `still queued at end  ${s.still_queued_at_end}`,
    `queue wait p50/p95   ${fmt(s.queue_wait_p50_ms)} / ${fmt(s.queue_wait_p95_ms)} ms`,
    "",
  ];
  return {
    stdout: lines.join("\n"),
    [`results/${LABEL}.json`]: JSON.stringify(s, null, 2),
  };
}
