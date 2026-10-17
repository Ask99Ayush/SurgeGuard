// Fairness check from the outside: visitors join one at a time (spaced by JOIN_SPACING_MS) and
// poll quickly; we record join and admission times. compare.js counts order inversions beyond a
// tolerance that covers poll and worker-tick granularity.
//   k6 run -e TARGET=http://nginx:8080 queue-fairness.js 2> results/fairness.log
import http from "k6/http";
import { sleep } from "k6";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";

const TARGET = __ENV.TARGET;
const VISITORS = Number(__ENV.VISITORS || 120);
const SPACING_MS = Number(__ENV.JOIN_SPACING_MS || 100);
const POLL_S = Number(__ENV.FAIRNESS_POLL || 0.5);
if (!TARGET) throw new Error("set -e TARGET=<base url>");

const admittedCount = new Counter("fair_admitted");
const positionRegressions = new Counter("position_regressions");
const waitTrend = new Trend("fair_wait", true);

export const options = {
  scenarios: {
    fairness: { executor: "per-vu-iterations", vus: VISITORS, iterations: 1, maxDuration: "4m" },
  },
  thresholds: { position_regressions: ["count>=0"], fair_admitted: ["count>=0"] },
};

export default function () {
  const idx = exec.vu.idInTest - 1;
  sleep((idx * SPACING_MS) / 1000);
  const joinedAt = Date.now();
  let res = http.post(`${TARGET}/api/v1/queue/join`, null, { tags: { kind: "queue" } });
  if (res.status !== 200) return;
  let body = res.json();
  const firstPosition = body.position;
  let lastPosition = body.position;
  const deadline = Date.now() + 200_000;
  while (body.state === "waiting" && Date.now() < deadline) {
    sleep(POLL_S);
    res = http.get(`${TARGET}/api/v1/queue/status`, { tags: { kind: "queue" } });
    if (res.status !== 200) continue;
    body = res.json();
    if (body.state === "waiting" && body.position > lastPosition) positionRegressions.add(1);
    if (body.state === "waiting") lastPosition = body.position;
  }
  if (body.state !== "admitted") return;
  const admittedAt = Date.now();
  admittedCount.add(1);
  waitTrend.add(admittedAt - joinedAt);
  console.log(`FAIRNESS ${JSON.stringify({ idx, joinedAt, admittedAt, firstPosition })}`);
}
