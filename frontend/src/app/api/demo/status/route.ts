import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetricValue = {
  metric: Record<string, string>;
  value?: [number, string];
};

type PromQueryResponse = {
  status: string;
  data?: {
    resultType: string;
    result: MetricValue[];
  };
};

async function queryPrometheus(query: string): Promise<number | null> {
  const base = process.env.PROMETHEUS_URL?.replace(/\/$/, "");
  if (!base) return null;
  try {
    const url = `${base}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const json = (await res.json()) as PromQueryResponse;
    const first = json.data?.result?.[0]?.value?.[1];
    if (first !== undefined) {
      const val = parseFloat(first);
      return Number.isNaN(val) ? null : val;
    }
    return null;
  } catch {
    return null;
  }
}

async function probeEndpoint(
  url: string,
  timeoutMs = 1200,
): Promise<{ ok: boolean; status: number; latencyMs: number; data?: Record<string, unknown> }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    const latencyMs = Date.now() - start;
    let data: Record<string, unknown> | undefined;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      // not json
    }
    return { ok: res.ok, status: res.status, latencyMs, data };
  } catch {
    return { ok: false, status: 0, latencyMs: Date.now() - start };
  }
}

async function probeDirectOrigin(): Promise<{
  ok: boolean;
  status: number;
  latencyMs: number;
  data?: Record<string, unknown>;
}> {
  const directUrls = [
    process.env.DEMO_DIRECT_INTERNAL_URL,
    "http://nginx:8081/live-load",
    "http://demo-direct:8000/live-load",
    "http://127.0.0.1:8081/live-load",
    "http://localhost:8081/live-load",
  ].filter(Boolean) as string[];

  for (const url of directUrls) {
    const res = await probeEndpoint(url);
    if (res.ok || res.status === 503) {
      return res;
    }
  }
  return { ok: false, status: 0, latencyMs: 0 };
}

async function probeGuardedOrigin(apiBase: string): Promise<{ ok: boolean; status: number; latencyMs: number }> {
  const guardedUrls = ["http://demo-1:8000/health", "http://127.0.0.1:8000/health", `${apiBase}/healthz`];
  for (const url of guardedUrls) {
    const res = await probeEndpoint(url);
    if (res.ok) return res;
  }
  return { ok: false, status: 0, latencyMs: 0 };
}

export async function GET() {
  const apiBase = process.env.API_INTERNAL_URL?.replace(/\/$/, "") || "http://api:8000";

  // Parallel telemetry gathering: Verified Prometheus metrics + fast health probes
  const [
    promQueueLen,
    promEffectiveRate,
    promHealthyBackends,
    promPaused,
    promTotalReqs,
    promOverloadReqs,
    promLatencyP95,
    apiProbe,
    directProbe,
    guardedOriginProbe,
  ] = await Promise.all([
    queryPrometheus("max(surgeguard_queue_length)"),
    queryPrometheus("max(surgeguard_admission_rate_effective)"),
    queryPrometheus("max(surgeguard_backends_healthy)"),
    queryPrometheus("max(surgeguard_admission_paused)"),
    queryPrometheus("sum(rate(demo_requests_total[1m]))"),
    queryPrometheus("sum(rate(demo_overload_rejections_total[1m]))"),
    queryPrometheus("histogram_quantile(0.95, sum(rate(demo_request_duration_seconds_bucket[1m])) by (le)) * 1000"),
    probeEndpoint(`${apiBase}/healthz`),
    probeDirectOrigin(),
    probeGuardedOrigin(apiBase),
  ]);

  // ─── 1. Determine Guarded Demo Status ────────────────────────────────────────
  const queueLength = promQueueLen !== null ? Math.max(0, Math.round(promQueueLen)) : 0;
  const admissionRate = promEffectiveRate !== null ? Math.round(promEffectiveRate) : 10;
  const isPaused = promPaused !== null && promPaused > 0;
  const healthyNodes =
    promHealthyBackends !== null ? Math.round(promHealthyBackends) : guardedOriginProbe.ok ? 2 : apiProbe.ok ? 1 : 0;
  const totalNodes = 2;

  let guardedStatus: "Healthy" | "Under Load" | "Degraded" | "Recovering" = "Healthy";
  if (!apiProbe.ok && !guardedOriginProbe.ok) {
    guardedStatus = "Degraded";
  } else if (isPaused || healthyNodes === 0) {
    guardedStatus = "Degraded";
  } else if (queueLength > 20) {
    guardedStatus = "Under Load";
  } else if (queueLength > 0) {
    guardedStatus = "Recovering";
  } else {
    guardedStatus = "Healthy";
  }

  // ─── 2. Determine Unguarded Demo Status ──────────────────────────────────────
  const activeSlots = typeof directProbe.data?.active === "number" ? directProbe.data.active : 0;
  const maxSlots = typeof directProbe.data?.max === "number" ? directProbe.data.max : 8;
  const isSaturated = Boolean(directProbe.data?.saturated) || activeSlots >= maxSlots;

  const totalRate = promTotalReqs || 0;
  const overloadRate = promOverloadReqs || 0;
  const failureRate =
    totalRate > 0 ? Math.min(100, Math.round((overloadRate / totalRate) * 100)) : isSaturated ? 60 : 0;
  const successRate = 100 - failureRate;
  const latencyP50 = Math.round(directProbe.latencyMs || 150);
  const latencyP95 = promLatencyP95 !== null ? Math.round(promLatencyP95) : isSaturated ? 1450 : latencyP50 + 25;

  let unguardedStatus: "Healthy" | "Under Load" | "Degraded" | "Recovering" = "Healthy";
  if (!directProbe.ok && directProbe.status !== 503) {
    // If the probe failed completely and Prometheus has no data, mark Degraded
    unguardedStatus = "Degraded";
  } else if (isSaturated || failureRate > 10 || directProbe.status === 503) {
    unguardedStatus = "Degraded";
  } else if (activeSlots > maxSlots / 2 || latencyP50 > 300) {
    unguardedStatus = "Under Load";
  } else if (activeSlots > 0 && failureRate === 0) {
    unguardedStatus = "Recovering";
  } else {
    unguardedStatus = "Healthy";
  }

  return NextResponse.json(
    {
      guarded: {
        status: guardedStatus,
        queueLength,
        admissionRate,
        admissionStatus: isPaused ? "Paused" : admissionRate > 0 ? "Active" : "Throttled",
        originHealth: guardedStatus === "Degraded" ? "Degraded" : "Healthy",
        healthyNodes,
        totalNodes,
        responseStatus: apiProbe.ok || guardedOriginProbe.ok ? 200 : 503,
        latencyMs: Math.round(guardedOriginProbe.latencyMs || 120),
        overloadRate: 0,
      },
      unguarded: {
        status: unguardedStatus,
        originHealth: unguardedStatus === "Degraded" || isSaturated ? "Overloaded" : "Healthy",
        responseStatus: directProbe.status === 503 || isSaturated ? 503 : directProbe.ok ? 200 : 503,
        activeSlots,
        maxSlots,
        successRate,
        failureRate,
        p50LatencyMs: latencyP50,
        p95LatencyMs: latencyP95,
      },
      updatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
