/**
 * Derives the human-friendly status sentence shown in Zone 1 of the dashboard.
 * Pure function — easy to unit-test with no DOM or React involved.
 */
import type { Overview } from "@/components/admin/types";

export type GateState =
  | "quiet"          // no queue, all healthy
  | "admitting"      // small queue or active admission velocity
  | "busy"           // meaningful queue depth
  | "paused"         // operator-paused
  | "degraded"       // backends failing / worker dead / redis down
  | "offline";       // API unreachable (fail-closed)

export interface StatusResult {
  state: GateState;
  sentence: string;
  /** Short description below the sentence (optional). */
  detail: string | null;
}

/** Approximate median wait in seconds given queue depth and admission rate. */
function approxWaitSeconds(waiting: number, ratePerSec: number): number | null {
  if (ratePerSec <= 0) return null;
  return waiting / ratePerSec;
}

function fmtWait(seconds: number): string {
  if (seconds < 30) return "under 30 seconds";
  if (seconds < 90) return "about a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `about ${Math.round(seconds / 3600)} hour${Math.round(seconds / 3600) === 1 ? "" : "s"}`;
}

export function deriveStatus(
  overview: Overview | null,
  apiOk: boolean,
): StatusResult {
  // API unreachable
  if (!apiOk || !overview) {
    return {
      state: "offline",
      sentence: "SurgeGuard is protecting your site in fail-closed mode.",
      detail: "The control plane is unreachable. The Nginx gate is still enforcing admission. No traffic is leaking.",
    };
  }

  const { queue, admission, worker, redis, backends } = overview;

  // Hard failures
  if (!redis.ok) {
    return {
      state: "degraded",
      sentence: "Attention needed. Redis is not responding.",
      detail: "State cannot be read or written. Admissions are blocked until Redis recovers.",
    };
  }
  if (!worker.alive) {
    return {
      state: "degraded",
      sentence: "Attention needed. The admission worker has stopped reporting.",
      detail: "New visitors will queue up but not be admitted until the worker comes back online.",
    };
  }
  if (backends.total > 0 && backends.healthy === 0) {
    return {
      state: "degraded",
      sentence: "Attention needed. All origin backends are failing health checks.",
      detail: `Admission has been auto-paused. Visitors are queued safely. (0 of ${backends.total} backends responding)`,
    };
  }

  // Manual pause
  if (admission.paused) {
    return {
      state: "paused",
      sentence: `Queue paused. ${queue.waiting > 0 ? `${queue.waiting} ${queue.waiting === 1 ? "person is" : "people are"} holding their place.` : "No visitors are waiting."}`,
      detail: `Admission manually paused by operator. Resume when you are ready.`,
    };
  }

  // Auto-pause from partial backend failure
  if (admission.auto_paused) {
    return {
      state: "paused",
      sentence: "Admission auto-paused. Backends degraded.",
      detail: `${backends.healthy} of ${backends.total} backends healthy. Admissions will resume when backends recover.`,
    };
  }

  // Some backends down but still admitting
  if (backends.healthy < backends.total) {
    return {
      state: "degraded",
      sentence: `Degraded. ${backends.total - backends.healthy} of ${backends.total} origin ${backends.total - backends.healthy === 1 ? "server is" : "servers are"} down.`,
      detail: `Admitting at ${admission.measured_rate_per_s.toFixed(1)}/s to the ${backends.healthy} healthy ${backends.healthy === 1 ? "backend" : "backends"}.`,
    };
  }

  // Active queue
  if (queue.waiting > 0) {
    const wait = approxWaitSeconds(queue.waiting, admission.measured_rate_per_s);
    if (queue.waiting >= 50 || (wait !== null && wait > 120)) {
      return {
        state: "busy",
        sentence: `Busy. ${queue.waiting} ${queue.waiting === 1 ? "person is" : "people are"} waiting${wait !== null ? `, ${fmtWait(wait)} each` : ""}.`,
        detail: `Admitting at ${admission.measured_rate_per_s.toFixed(1)}/s · ${backends.healthy} backend${backends.healthy === 1 ? "" : "s"} healthy.`,
      };
    }
    return {
      state: "admitting",
      sentence: `Admitting. ${queue.waiting} ${queue.waiting === 1 ? "visitor is" : "visitors are"} in line${wait !== null ? `, ${fmtWait(wait)} wait` : ""}.`,
      detail: `Surge protection engaged at ${admission.configured_rate}/s · All systems healthy.`,
    };
  }

  // Active admission (no backlog but traffic flowing)
  if (admission.measured_rate_per_s > 0.05) {
    return {
      state: "admitting",
      sentence: "Admitting. Traffic is flowing and the queue is clear.",
      detail: `${admission.measured_rate_per_s.toFixed(1)} visitors/s · ${backends.healthy} backend${backends.healthy === 1 ? "" : "s"} healthy.`,
    };
  }

  // Quiet
  return {
    state: "quiet",
    sentence: "All clear. Your site is protected and nobody is waiting.",
    detail: null,
  };
}
