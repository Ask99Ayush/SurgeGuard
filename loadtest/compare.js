// Prints a side-by-side summary of measured results. Runs no traffic.
//   k6 run --quiet compare.js
// Reads results/*.json written by the other scenarios (missing files are reported as "not run").

function load(path) {
  try {
    return JSON.parse(open(path));
  } catch (_) {
    return null;
  }
}

function loadText(path) {
  try {
    return open(path);
  } catch (_) {
    return null;
  }
}

const unprotected = load("results/unprotected.json");
const protectedRun = load("results/protected.json");
const failure = load("results/backend-failure.json");
const recovery = load("results/recovery.json");
const fairnessLog = loadText("results/fairness.log");

export const options = { vus: 1, iterations: 1 };

export default function () {}

const n = (v, d = 0, s = "") => (v === null || v === undefined || Number.isNaN(v) ? "n/a" : `${Number(v).toFixed(d)}${s}`);
const pct = (v) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(2)}%`);
const row = (label, a, b) => `${label.padEnd(28)}${String(a).padStart(16)}${String(b).padStart(18)}`;

function fairness() {
  if (!fairnessLog) return null;
  const rows = fairnessLog
    .split("\n")
    .map((line) => line.match(/FAIRNESS (\{.*\})/))
    .filter(Boolean)
    .map((m) => JSON.parse(m[1].replace(/\\"/g, '"')));
  if (rows.length < 2) return { admitted: rows.length, inversions: null };
  const TOL_MS = 1000;
  let inversions = 0;
  let pairs = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows.length; j++) {
      if (rows[i].joinedAt + 50 < rows[j].joinedAt) {
        pairs++;
        if (rows[i].admittedAt > rows[j].admittedAt + TOL_MS) inversions++;
      }
    }
  }
  return { admitted: rows.length, pairs, inversions, tolerance_ms: TOL_MS };
}

export function handleSummary() {
  const out = ["", "=================== SurgeGuard demo: measured results ===================", ""];
  if (!unprotected && !protectedRun) out.push("No surge results found. Run `make demo` or `make loadtest` first.");
  else {
    const u = unprotected || {};
    const p = protectedRun || {};
    out.push(row("Metric", "Unprotected", "With SurgeGuard"));
    out.push("-".repeat(62));
    out.push(row("Page requests", u.page_requests ?? "not run", p.page_requests ?? "not run"));
    out.push(row("Successful pages (200)", u.page_ok ?? "n/a", p.page_ok ?? "n/a"));
    out.push(row("Page error rate", pct(u.page_error_rate), pct(p.page_error_rate)));
    out.push(row("Page latency p50", n(u.page_p50_ms, 0, " ms"), n(p.page_p50_ms, 0, " ms")));
    out.push(row("Page latency p95", n(u.page_p95_ms, 0, " ms"), n(p.page_p95_ms, 0, " ms")));
    out.push(row("Sessions completed", u.sessions_completed ?? "n/a", p.sessions_completed ?? "n/a"));
    out.push(row("Admitted via queue", "n/a", p.admitted_visitors ?? "n/a"));
    out.push(row("Still queued at end", "n/a", p.still_queued_at_end ?? "n/a"));
    out.push(row("Queue wait p95", "n/a", n(p.queue_wait_p95_ms / 1000, 1, " s")));
    out.push(row("VUs / hold", `${u.config?.vus ?? "?"} / ${u.config?.hold ?? "?"}`, `${p.config?.vus ?? "?"} / ${p.config?.hold ?? "?"}`));
  }
  out.push("");
  if (failure) {
    out.push(`Backend failure run (one backend stopped ${failure.fail_at_s}s → ${failure.recover_at_s}s, ${failure.vus} VUs):`);
    for (const phase of ["before", "during", "after"]) {
      const v = failure.phases[phase];
      out.push(`  ${phase.padEnd(7)} pages ${String(v.page_requests).padStart(6)}  errors ${pct(v.page_error_rate).padStart(7)}  p95 ${n(v.page_p95_ms, 0, " ms")}`);
    }
  } else out.push("Backend failure run: not run");
  if (recovery) {
    out.push(`  detected down after   ${n(recovery.detect_down_s, 1, " s")} (active health checks)`);
    out.push(`  recovered healthy in  ${n(recovery.recover_s, 1, " s")} after restart`);
  }
  out.push("");
  const f = fairness();
  if (f) {
    out.push(
      f.inversions === null
        ? `Fairness: only ${f.admitted} admitted, not enough to evaluate`
        : `Fairness: ${f.admitted} visitors admitted, ${f.inversions} order inversions beyond ${f.tolerance_ms} ms out of ${f.pairs} ordered pairs`,
    );
  } else out.push("Fairness run: not run");
  out.push("");
  out.push("All numbers above were measured in this run on this machine. See loadtest/README.md for the setup.");
  out.push("");
  return { stdout: out.join("\n") };
}
