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
  // Probe the /live-load endpoint which returns JSON with active/max/saturated fields.
  // DEMO_DIRECT_INTERNAL_URL is set by docker-compose to http://nginx:8081
  const directUrls = [
    process.env.DEMO_DIRECT_INTERNAL_URL
      ? `${process.env.DEMO_DIRECT_INTERNAL_URL.replace(/\/$/, "")}/live-load`
      : null,
    "http://nginx:8081/live-load",
    "http://demo-direct:8000/live-load",
    "http://127.0.0.1:8081/live-load",
  ].filter(Boolean) as string[];

  for (const url of directUrls) {
    const res = await probeEndpoint(url);
    if (res.ok || res.status === 503) {
      return res;
    }
  }
  return { ok: false, status: 0, latencyMs: 0 };
}

async function probeGuardedOrigin(
  apiBase: string,
): Promise<{ ok: boolean; status: number; latencyMs: number }> {
  const guardedUrls = [
    "http://demo-1:8000/health",
    "http://demo-2:8000/health",
    "http://127.0.0.1:8000/health",
    `${apiBase}/healthz`,
  ];
  for (const url of guardedUrls) {
    const res = await probeEndpoint(url);
    if (res.ok) return res;
  }
  return { ok: false, status: 0, latencyMs: 0 };
}

export async function GET() {
  const apiBase = process.env.API_INTERNAL_URL?.replace(/\/$/, "") || "http://api:8000";

  // ─── Parallel telemetry gathering ───────────────────────────────────────────
  const [
    promQueueLen,
    promEffectiveRate,
    promHealthyBackends,
    promPaused,
    // Requests and overload for all demo origins (demo-1, demo-2, demo-direct)
    promTotalReqsAll,
    promOverloadReqsAll,
    // Specifically for demo-direct (unguarded)
    promTotalReqsDirect,
    promOverloadReqsDirect,
    promInflightDirect,
    // Latency for guarded backends (demo-1, demo-2)
    promLatencyP95Guarded,
    // Latency for unguarded backend (demo-direct)
    promLatencyP95Unguarded,
    apiProbe,
    directProbe,
    guardedOriginProbe,
  ] = await Promise.all([
    queryPrometheus("max(surgeguard_queue_length)"),
    queryPrometheus("max(surgeguard_admission_rate_effective)"),
    queryPrometheus("max(surgeguard_backends_healthy)"),
    queryPrometheus("max(surgeguard_admission_paused)"),
    // All origins total request rate
    queryPrometheus("sum(rate(demo_requests_total[1m]))"),
    // All origins overload rate
    queryPrometheus("sum(rate(demo_overload_rejections_total[1m]))"),
    // Unguarded-only: cumulative request count for demo-direct
    queryPrometheus('sum(demo_requests_total{origin="demo-direct"})'),
    // Unguarded-only: cumulative overload count for demo-direct
    queryPrometheus('sum(demo_overload_rejections_total{origin="demo-direct"})'),
    // Unguarded-only: current inflight for demo-direct
    queryPrometheus('max(demo_inflight_requests{origin="demo-direct"})'),
    // p95 latency for guarded backends (demo-1, demo-2)
    queryPrometheus(
      'histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket{origin=~"demo-1|demo-2"}[1m]))) * 1000',
    ),
    // p95 latency for unguarded backend (demo-direct)
    queryPrometheus(
      'histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket{origin="demo-direct"}[1m]))) * 1000',
    ),
    probeEndpoint(`${apiBase}/healthz`),
    probeDirectOrigin(),
    probeGuardedOrigin(apiBase),
  ]);

  // ─── 1. Determine Guarded Demo Status ────────────────────────────────────────
  const queueLength =
    promQueueLen !== null ? Math.max(0, Math.round(promQueueLen)) : 0;
  const admissionRate =
    promEffectiveRate !== null ? Math.round(promEffectiveRate) : 10;
  const isPaused = promPaused !== null && promPaused > 0;
  const healthyNodes =
    promHealthyBackends !== null
      ? Math.round(promHealthyBackends)
      : guardedOriginProbe.ok
        ? 2
        : apiProbe.ok
          ? 1
          : 0;
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

  // p95 latency for guarded backends
  const guardedP95Ms =
    promLatencyP95Guarded !== null
      ? Math.round(promLatencyP95Guarded)
      : guardedOriginProbe.ok
        ? Math.round(guardedOriginProbe.latencyMs)
        : null;

  // ─── 2. Determine Unguarded Demo Status ──────────────────────────────────────

  // Live-load probe gives us active/max/saturated from the demo origin JSON
  const activeSlots =
    typeof directProbe.data?.active === "number" ? directProbe.data.active : 0;
  const pendingSlots =
    typeof directProbe.data?.pending === "number" ? directProbe.data.pending : 0;
  const maxSlots =
    typeof directProbe.data?.max === "number" ? directProbe.data.max : 8;
  const isSaturated =
    Boolean(directProbe.data?.saturated) || activeSlots >= maxSlots;

  // Use Prometheus for rates if demo-direct is scraped (added to prometheus.yml)
  const totalRateAll = promTotalReqsAll || 0;
  const overloadRateAll = promOverloadReqsAll || 0;

  // For unguarded failure rate: prefer direct-specific Prometheus data
  let failureRate = 0;
  let successRate = 100;
  const totalReqsDirect = promTotalReqsDirect !== null ? Math.round(promTotalReqsDirect) : null;
  const totalOverloadDirect =
    promOverloadReqsDirect !== null ? Math.round(promOverloadReqsDirect) : null;

  if (totalReqsDirect !== null && totalReqsDirect > 0 && totalOverloadDirect !== null) {
    failureRate = Math.min(100, Math.round((totalOverloadDirect / totalReqsDirect) * 100));
    successRate = 100 - failureRate;
  } else if (totalRateAll > 0 && overloadRateAll > 0) {
    // Fall back to aggregate rate if demo-direct isn't scraped yet
    failureRate = Math.min(
      100,
      Math.round((overloadRateAll / totalRateAll) * 100),
    );
    successRate = 100 - failureRate;
  } else if (isSaturated) {
    failureRate = 60;
    successRate = 40;
  }

  // Latency: prefer Prometheus p95, fall back to probe round-trip
  const latencyP50 = Math.round(directProbe.latencyMs || 150);
  const latencyP95Unguarded =
    promLatencyP95Unguarded !== null
      ? Math.round(promLatencyP95Unguarded)
      : isSaturated
        ? 1450
        : latencyP50 + 25;

  // Inflight from Prometheus (more accurate than probe)
  const activeInflight =
    promInflightDirect !== null ? Math.round(promInflightDirect) : activeSlots;

  let unguardedStatus: "Healthy" | "Under Load" | "Degraded" | "Recovering" = "Healthy";
  if (!directProbe.ok && directProbe.status !== 503) {
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
        admissionStatus: isPaused
          ? "Paused"
          : admissionRate > 0
            ? "Active"
            : "Throttled",
        originHealth:
          guardedStatus === "Degraded" ? "Degraded" : "Healthy",
        healthyNodes,
        totalNodes,
        responseStatus: apiProbe.ok || guardedOriginProbe.ok ? 200 : 503,
        latencyMs: Math.round(guardedOriginProbe.latencyMs || 120),
        overloadRate: 0,
        p95LatencyMs: guardedP95Ms,
      },
      unguarded: {
        status: unguardedStatus,
        originHealth:
          unguardedStatus === "Degraded" || isSaturated ? "Overloaded" : "Healthy",
        responseStatus:
          directProbe.status === 503 || isSaturated
            ? 503
            : directProbe.ok
              ? 200
              : 503,
        activeSlots,
        pendingSlots,
        maxSlots,
        successRate,
        failureRate,
        p50LatencyMs: latencyP50,
        p95LatencyMs: latencyP95Unguarded,
        // Cumulative counters (from Prometheus if demo-direct is scraped)
        totalRequests: totalReqsDirect,
        total503s: totalOverloadDirect,
        activeInflight,
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
