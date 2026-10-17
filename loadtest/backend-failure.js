// Protected-path traffic while one backend is stopped and restarted (scripts/demo.sh drives the
// docker commands at FAIL_AT and RECOVER_AT seconds). Every request is tagged with its phase.
//   k6 run -e TARGET=http://nginx:8080 -e FAIL_AT=25 -e RECOVER_AT=55 backend-failure.js
import { fmt, summarize, visitorSession } from "./lib.js";

const TARGET = __ENV.TARGET;
const FAIL_AT = Number(__ENV.FAIL_AT || 25);
const RECOVER_AT = Number(__ENV.RECOVER_AT || 55);
const DURATION = Number(__ENV.DURATION || 85);
const VUS = Number(__ENV.VUS || 150);
if (!TARGET) throw new Error("set -e TARGET=<base url>");

const PHASES = ["before", "during", "after"];

export const options = {
  scenarios: {
    failure: { executor: "constant-vus", vus: VUS, duration: `${DURATION}s`, gracefulStop: "5s" },
  },
  summaryTrendStats: ["med", "p(95)", "max"],
  thresholds: Object.fromEntries(
    PHASES.flatMap((p) => [
      [`page_errors{phase:${p}}`, ["rate>=0"]],
      [`page_duration{phase:${p}}`, ["p(95)>=0"]],
      [`page_ok{phase:${p}}`, ["count>=0"]],
    ]),
  ),
};

export function setup() {
  return { start: Date.now() };
}

export default function (ctx) {
  const phase = () => {
    const t = (Date.now() - ctx.start) / 1000;
    return { phase: t < FAIL_AT ? "before" : t < RECOVER_AT ? "during" : "after" };
  };
  visitorSession(TARGET, phase);
}

export function handleSummary(data) {
  const phases = {};
  for (const p of PHASES) {
    const err = data.metrics[`page_errors{phase:${p}}`];
    const dur = data.metrics[`page_duration{phase:${p}}`];
    const ok = data.metrics[`page_ok{phase:${p}}`];
    phases[p] = {
      page_requests: err ? err.values.passes + err.values.fails : 0,
      page_ok: ok ? ok.values.count : 0,
      page_error_rate: err ? err.values.rate : null,
      page_p95_ms: dur ? dur.values["p(95)"] : null,
    };
  }
  const s = summarize(data, "backend-failure", { fail_at_s: FAIL_AT, recover_at_s: RECOVER_AT, vus: VUS, phases });
  const lines = ["", `== backend failure (${TARGET}), one backend stopped ${FAIL_AT}s → ${RECOVER_AT}s ==`];
  for (const p of PHASES) {
    const v = phases[p];
    lines.push(
      `${p.padEnd(7)} pages ${String(v.page_requests).padStart(6)}  ok ${String(v.page_ok).padStart(6)}  errors ${fmt(
        v.page_error_rate * 100, 2, "%",
      ).padStart(7)}  p95 ${fmt(v.page_p95_ms).padStart(6)} ms`,
    );
  }
  lines.push("");
  return { stdout: lines.join("\n"), "results/backend-failure.json": JSON.stringify(s, null, 2) };
}
