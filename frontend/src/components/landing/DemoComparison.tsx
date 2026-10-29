"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Gauge,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Users,
  XCircle,
} from "lucide-react";
import { Badge, ButtonLink } from "@/components/ui/primitives";
import { getDirectOriginUrl, getProtectedSiteUrl } from "@/lib/urls";

type DemoStatus = "Healthy" | "Under Load" | "Degraded" | "Recovering";

type TelemetryData = {
  guarded: {
    status: DemoStatus;
    queueLength: number;
    admissionRate: number;
    admissionStatus: string;
    originHealth: string;
    healthyNodes: number;
    totalNodes: number;
    responseStatus: number;
    latencyMs: number;
    overloadRate?: number;
  };
  unguarded: {
    status: DemoStatus;
    originHealth: string;
    responseStatus: number;
    activeSlots: number;
    maxSlots: number;
    successRate: number;
    failureRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
  };
  updatedAt: string;
};

const STATUS_CONFIG: Record<
  DemoStatus,
  { label: string; tone: "success" | "warning" | "danger" | "neutral"; dotClass: string }
> = {
  Healthy: { label: "Healthy", tone: "success", dotClass: "bg-emerald-500" },
  "Under Load": { label: "Under Load", tone: "warning", dotClass: "bg-amber-500 animate-pulse" },
  Degraded: { label: "Degraded", tone: "danger", dotClass: "bg-rose-500 animate-ping" },
  Recovering: { label: "Recovering", tone: "neutral", dotClass: "bg-sky-500" },
};

export function DemoComparison({
  demoUrl,
  directUrl,
}: {
  demoUrl?: string | null;
  directUrl?: string | null;
}) {
  const [protectedUrl, setProtectedUrl] = useState(() => getProtectedSiteUrl(demoUrl));
  const [unprotectedUrl, setUnprotectedUrl] = useState(() => getDirectOriginUrl(directUrl));
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setProtectedUrl(getProtectedSiteUrl(demoUrl));
    setUnprotectedUrl(getDirectOriginUrl(directUrl));
  }, [demoUrl, directUrl]);

  const fetchTelemetry = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch("/api/demo/status", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as TelemetryData;
        setTelemetry(data);
      }
    } catch (_) {
      // Keep existing state on transient poll failure
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 3000);
    return () => clearInterval(interval);
  }, []);

  const guardedStatus = telemetry?.guarded.status ?? "Healthy";
  const unguardedStatus = telemetry?.unguarded.status ?? "Healthy";
  const gConf = STATUS_CONFIG[guardedStatus];
  const uConf = STATUS_CONFIG[unguardedStatus];

  return (
    <section id="comparison" className="scroll-mt-28 border-t border-border px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-accent">
              <ShieldCheck className="size-3.5" aria-hidden />
              Interactive Testbed &middot; Live Observability
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl text-foreground">
              Guarded vs. Unguarded Comparison
            </h2>
            <p className="mt-3 text-[16px] leading-relaxed text-muted">
              Live telemetry and side-by-side performance metrics derived from real health checks,
              active concurrency meters, and queue state.
            </p>
          </div>

          <button
            type="button"
            onClick={fetchTelemetry}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground self-start sm:self-auto"
            title="Refresh live telemetry"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-accent" : ""}`} />
            <span>Telemetry: Live (3s)</span>
          </button>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {/* =========================================================================
              DEMO 1 — GUARDED: SurgeGuard Protected Website
             ========================================================================= */}
          <div className="relative flex flex-col justify-between rounded-2xl border border-success/40 bg-surface p-6 shadow-sm transition-all hover:border-success/60">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${gConf.dotClass}`} />
                  <Badge tone={gConf.tone}>
                    DEMO 1 &middot; GUARDED ({gConf.label})
                  </Badge>
                </div>
                <span className="font-mono text-xs text-muted">SurgeGuard Gate Active</span>
              </div>

              <h3 className="mt-4 text-xl font-semibold text-foreground">SurgeGuard Protected Origin</h3>
              <p className="mt-2 text-sm text-muted">
                Visitors pass through the SurgeGuard admission gate. Unadmitted visitors are placed in
                the deterministic virtual waiting room and admitted at origin capacity with zero 503 rejections.
              </p>

              {/* Live Status & Telemetry Grid */}
              <div className="mt-6 grid grid-cols-2 gap-2.5 rounded-xl border border-border bg-surface-elevated p-4 text-xs font-mono">
                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <span className="text-[11px] text-muted block flex items-center gap-1.5">
                    <Users className="size-3 text-accent" /> Live Queue Length
                  </span>
                  <span className="text-base font-bold text-foreground mt-1 block">
                    {telemetry ? `${telemetry.guarded.queueLength} waiting` : "0 waiting"}
                  </span>
                </div>

                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <span className="text-[11px] text-muted block flex items-center gap-1.5">
                    <Gauge className="size-3 text-success" /> Admission Status
                  </span>
                  <span className="text-base font-bold text-foreground mt-1 block">
                    {telemetry ? `${telemetry.guarded.admissionRate}/s (${telemetry.guarded.admissionStatus})` : "10/s (Active)"}
                  </span>
                </div>

                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <span className="text-[11px] text-muted block flex items-center gap-1.5">
                    <Server className="size-3 text-sky-400" /> Origin Health
                  </span>
                  <span className="text-base font-bold text-success mt-1 block">
                    {telemetry ? `${telemetry.guarded.healthyNodes}/${telemetry.guarded.totalNodes} Nodes (200 OK)` : "2/2 Nodes (200 OK)"}
                  </span>
                </div>

                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <span className="text-[11px] text-muted block flex items-center gap-1.5">
                    <Activity className="size-3 text-warning" /> Origin Overload Rate
                  </span>
                  <span className="text-base font-bold text-success mt-1 block">
                    {telemetry ? `${telemetry.guarded.overloadRate ?? 0}% Drops (Protected)` : "0.0% Drops (Protected)"}
                  </span>
                </div>
              </div>

              {/* Key Features List */}
              <div className="mt-4 space-y-2.5 rounded-xl border border-border/70 bg-surface/40 p-3.5 text-xs">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-3.5 shrink-0 text-success mt-0.5" />
                  <span className="text-muted">
                    <strong className="text-foreground">Edge Gate:</strong> Signed HMAC token checked at Nginx proxy before origin access.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-3.5 shrink-0 text-success mt-0.5" />
                  <span className="text-muted">
                    <strong className="text-foreground">Zero Drop Guarantee:</strong> SurgeGuard absorbs spikes safely; backends operate within capacity.
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ButtonLink href={protectedUrl} external variant="primary" size="md">
                  <span>Enter Protected Demo</span>
                  <ArrowUpRight className="size-4" aria-hidden />
                </ButtonLink>
                <span className="font-mono text-xs text-subtle">Target: {protectedUrl}/</span>
              </div>
            </div>
          </div>

          {/* =========================================================================
              DEMO 2 — UNGUARDED: Direct Website Under Load
             ========================================================================= */}
          <div className="relative flex flex-col justify-between rounded-2xl border border-border bg-surface p-6 shadow-sm transition-all hover:border-rose-500/40">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${uConf.dotClass}`} />
                  <Badge tone={uConf.tone}>
                    DEMO 2 &middot; UNGUARDED ({uConf.label})
                  </Badge>
                </div>
                <span className="font-mono text-xs text-muted">Direct Raw Ingress</span>
              </div>

              <h3 className="mt-4 text-xl font-semibold text-foreground">Direct Unprotected Baseline</h3>
              <p className="mt-2 text-sm text-muted">
                Direct entry to origin without virtual waiting room or token verification.
                Subject to realistic concurrency capacity limits; drops excess traffic with HTTP 503.
              </p>

              {/* Live Status & Telemetry Grid */}
              <div className="mt-6 grid grid-cols-2 gap-2.5 rounded-xl border border-border bg-surface-elevated p-4 text-xs font-mono">
                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <span className="text-[11px] text-muted block flex items-center gap-1.5">
                    <Gauge className="size-3 text-warning" /> Concurrency Slots
                  </span>
                  <span className="text-base font-bold text-foreground mt-1 block">
                    {telemetry ? `${telemetry.unguarded.activeSlots} / ${telemetry.unguarded.maxSlots} Busy` : "0 / 8 Busy"}
                  </span>
                </div>

                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <span className="text-[11px] text-muted block flex items-center gap-1.5">
                    <Server className="size-3 text-rose-400" /> Response Status
                  </span>
                  <span className={`text-base font-bold mt-1 block ${telemetry?.unguarded.responseStatus === 503 ? "text-rose-500" : "text-emerald-500"}`}>
                    {telemetry ? `HTTP ${telemetry.unguarded.responseStatus} (${telemetry.unguarded.originHealth})` : "HTTP 200 (Healthy)"}
                  </span>
                </div>

                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <span className="text-[11px] text-muted block flex items-center gap-1.5">
                    <Activity className="size-3 text-accent" /> Success / Error Rate
                  </span>
                  <span className={`text-base font-bold mt-1 block ${telemetry && telemetry.unguarded.failureRate > 0 ? "text-rose-400" : "text-foreground"}`}>
                    {telemetry ? `${telemetry.unguarded.successRate}% OK · ${telemetry.unguarded.failureRate}% Err` : "100% OK · 0% Err"}
                  </span>
                </div>

                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <span className="text-[11px] text-muted block flex items-center gap-1.5">
                    <Activity className="size-3 text-sky-400" /> Response Latency
                  </span>
                  <span className="text-base font-bold text-foreground mt-1 block">
                    {telemetry ? `p50: ${telemetry.unguarded.p50LatencyMs}ms · p95: ${telemetry.unguarded.p95LatencyMs}ms` : "p50: 150ms · p95: 175ms"}
                  </span>
                </div>
              </div>

              {/* Key Vulnerabilities List */}
              <div className="mt-4 space-y-2.5 rounded-xl border border-border/70 bg-surface/40 p-3.5 text-xs">
                <div className="flex items-start gap-2">
                  <XCircle className="size-3.5 shrink-0 text-danger mt-0.5" />
                  <span className="text-muted">
                    <strong className="text-foreground">No Virtual Waiting Room:</strong> Sudden traffic spikes hit origin workers directly.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <XCircle className="size-3.5 shrink-0 text-danger mt-0.5" />
                  <span className="text-muted">
                    <strong className="text-foreground">Fragile Ceiling:</strong> Hard semaphore concurrency limit triggers immediate HTTP 503 saturation.
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <a
                  href={unprotectedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-elevated px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
                >
                  <span>Open Direct Demo</span>
                  <ArrowUpRight className="size-4 text-muted" aria-hidden />
                </a>
                <span className="font-mono text-xs text-subtle">Target: {unprotectedUrl}/</span>
              </div>
            </div>
          </div>
        </div>

        {/* Load Test Helper Command */}
        <div className="mt-8 rounded-xl border border-border bg-surface-elevated p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg border border-border bg-background text-muted">
                <Terminal className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-xs font-semibold text-foreground">Execute k6 Performance Comparison Suite</p>
                <p className="text-xs text-muted">Run sequential load tests comparing both endpoints under identical surge profiles.</p>
              </div>
            </div>
            <code className="rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground">
              k6 run k6/scripts/comparison.js
            </code>
          </div>
        </div>
      </div>
    </section>
  );
}
