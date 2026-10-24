import { describe, expect, it } from "vitest";
import { deriveStatus } from "./statusSentence";
import type { Overview } from "@/components/admin/types";

/** Minimal healthy overview — override fields per test */
const ok = (over: Partial<Overview> = {}): Overview => ({
  generated_at_ms: Date.now(),
  queue: {
    waiting: 0,
    admitted_active: 2,
    counts: { waiting: 0, admitted: 2, expired: 0, rejected: 0 },
    totals: {},
  },
  admission: {
    configured_rate: 10,
    measured_rate_per_s: 0,
    admitted_in_window: 0,
    window_seconds: 60,
    paused: null,
    auto_paused: null,
  },
  worker: { alive: true, last_tick_ms: Date.now() },
  redis: { ok: true, latency_ms: 1 },
  backends: { total: 2, healthy: 2, reporting: 2 },
  ...over,
});

describe("deriveStatus — all 6 states", () => {
  it("returns offline when apiOk=false", () => {
    const r = deriveStatus(null, false);
    expect(r.state).toBe("offline");
    expect(r.sentence).toMatch(/fail-closed/i);
  });

  it("returns offline when overview is null but apiOk=true", () => {
    const r = deriveStatus(null, true);
    expect(r.state).toBe("offline");
  });

  it("returns quiet when healthy, no queue, no traffic", () => {
    const r = deriveStatus(ok(), true);
    expect(r.state).toBe("quiet");
    expect(r.sentence).toMatch(/all clear/i);
    expect(r.detail).toBeNull();
  });

  it("returns admitting when admission rate > 0", () => {
    const r = deriveStatus(ok({ admission: { configured_rate: 10, measured_rate_per_s: 5, admitted_in_window: 10, window_seconds: 60, paused: null, auto_paused: null } }), true);
    expect(r.state).toBe("admitting");
    expect(r.sentence).toMatch(/admitting/i);
  });

  it("returns busy when queue is large (≥50)", () => {
    const r = deriveStatus(ok({
      queue: { waiting: 50, admitted_active: 5, counts: { waiting: 50, admitted: 5, expired: 0, rejected: 0 }, totals: {} },
      admission: { configured_rate: 10, measured_rate_per_s: 8, admitted_in_window: 100, window_seconds: 60, paused: null, auto_paused: null },
    }), true);
    expect(r.state).toBe("busy");
    expect(r.sentence).toMatch(/busy/i);
    expect(r.sentence).toMatch(/50/);
  });

  it("returns admitting for small queue (< 50 people)", () => {
    const r = deriveStatus(ok({
      queue: { waiting: 10, admitted_active: 2, counts: { waiting: 10, admitted: 2, expired: 0, rejected: 0 }, totals: {} },
      admission: { configured_rate: 10, measured_rate_per_s: 8, admitted_in_window: 100, window_seconds: 60, paused: null, auto_paused: null },
    }), true);
    expect(r.state).toBe("admitting");
  });

  it("returns paused when admission is manually paused", () => {
    const r = deriveStatus(ok({
      admission: {
        configured_rate: 10,
        measured_rate_per_s: 0,
        admitted_in_window: 0,
        window_seconds: 60,
        paused: { reason: "Operator pause", since_ms: Date.now() - 5000 },
        auto_paused: null,
      },
    }), true);
    expect(r.state).toBe("paused");
    expect(r.sentence).toMatch(/paused/i);
  });

  it("returns degraded when all backends are down", () => {
    const r = deriveStatus(ok({ backends: { total: 2, healthy: 0, reporting: 2 } }), true);
    expect(r.state).toBe("degraded");
    expect(r.sentence).toMatch(/all origin backends/i);
  });

  it("returns degraded when some backends are down but admission continues", () => {
    const r = deriveStatus(ok({ backends: { total: 2, healthy: 1, reporting: 2 } }), true);
    expect(r.state).toBe("degraded");
    expect(r.sentence).toMatch(/1 of 2/i);
  });

  it("returns degraded when Redis is down", () => {
    const r = deriveStatus(ok({ redis: { ok: false, latency_ms: 0 } }), true);
    expect(r.state).toBe("degraded");
    expect(r.sentence).toMatch(/redis/i);
  });

  it("returns degraded when worker is not alive", () => {
    const r = deriveStatus(ok({ worker: { alive: false } }), true);
    expect(r.state).toBe("degraded");
    expect(r.sentence).toMatch(/worker/i);
  });
});

describe("deriveStatus — wait time approximations", () => {
  it("includes wait time when queue is non-empty and rate is positive", () => {
    const r = deriveStatus(ok({
      queue: { waiting: 10, admitted_active: 2, counts: { waiting: 10, admitted: 2, expired: 0, rejected: 0 }, totals: {} },
      admission: { configured_rate: 10, measured_rate_per_s: 2, admitted_in_window: 10, window_seconds: 60, paused: null, auto_paused: null },
    }), true);
    // 10 waiting at 2/s = 5 seconds → "under 30 seconds"
    expect(r.sentence).toMatch(/under 30 seconds|about/i);
  });

  it("omits wait when rate is zero", () => {
    const r = deriveStatus(ok({
      queue: { waiting: 5, admitted_active: 0, counts: { waiting: 5, admitted: 0, expired: 0, rejected: 0 }, totals: {} },
      admission: { configured_rate: 10, measured_rate_per_s: 0, admitted_in_window: 0, window_seconds: 60, paused: null, auto_paused: null },
    }), true);
    // Still admitting state with no rate — sentence should not include "NaN"
    expect(r.sentence).not.toMatch(/nan/i);
    expect(r.sentence).not.toMatch(/infinity/i);
  });
});
