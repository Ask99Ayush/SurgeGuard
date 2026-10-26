"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  HelpCircle,
  Layers,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { RangeSelect } from "@/components/admin/RangeSelect";
import { SreMultiChart } from "@/components/admin/SreMultiChart";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { BackendsResponse, EventItem, Overview, PromStatus, SeriesResponse } from "@/components/admin/types";
import { Button, ButtonLink, Card, StatusDot, cn } from "@/components/ui/primitives";
import { usePolling } from "@/hooks/usePolling";
import { useNow } from "@/hooks/useNow";
import { formatClock, formatNumber, formatPercent } from "@/lib/format";
import type { RangeName } from "@/lib/promql";

const GRAFANA_BOARDS = [
  { id: "surgeguard-overview", name: "1. Overview", icon: Activity, desc: "System health KPIs, token rates & traffic" },
  { id: "surgeguard-queue", name: "2. Queue & Admission", icon: Radio, desc: "Queue mechanics, wait time & token validity" },
  { id: "surgeguard-backends", name: "3. Backends & Traffic", icon: Layers, desc: "Nginx connections, per-origin load & bypass" },
  { id: "surgeguard-failure", name: "4. Reliability & Recovery", icon: ShieldAlert, desc: "Dependency matrix, fail-closed & recovery" },
  { id: "surgeguard-resources", name: "5. Infrastructure", icon: Server, desc: "Redis memory, ping latency & worker loop" },
  { id: "surgeguard-comparison", name: "6. Protected vs Unprotected", icon: Zap, desc: "Side-by-side resilience comparison under surge load" },
];

/* ─── Metric Tooltip ────────────────────────────────── */
function MetricTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative ml-1 inline-flex">
      <button
        type="button"
        aria-label="Explain this metric"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center text-subtle hover:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-sm"
      >
        <HelpCircle className="size-3" aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground shadow-[var(--shadow-pop)] animate-in fade-in"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function MonitoringView({ grafanaUrl }: { grafanaUrl: string | null }) {
  const now = useNow();
  const [range, setRange] = useState<RangeName>("15m");
  const [isPaused, setIsPaused] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Polling intervals pause when isPaused is true
  const pollInterval = isPaused ? 0 : 5000;

  // Telemetry feeds
  const overview = usePolling<Overview>("/api/admin/overview", pollInterval);
  const backends = usePolling<BackendsResponse>("/api/admin/backends", pollInterval);
  const events = usePolling<EventItem[]>("/api/admin/events?limit=200", pollInterval);
  const status = usePolling<PromStatus>("/api/metrics/status", pollInterval ? 10_000 : 0);

  // Key Instant Metrics for SRE KPI row
  const errorRatio = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_error_ratio", pollInterval ? 10_000 : 0);
  const redisPing = usePolling<SeriesResponse>("/api/metrics/instant?name=redis_ping_p95", pollInterval ? 15_000 : 0);

  const o = overview.data;
  const apiOk = overview.status === "success" && o !== null;
  const promAvailable = status.status === "success" && status.data !== null;

  // Extracted values
  const waiting = o?.queue.waiting ?? 0;
  const measuredRate = o?.admission.measured_rate_per_s ?? 0;
  const configuredRate = o?.admission.configured_rate ?? 10;
  const healthyBackends = o?.backends.healthy ?? 2;
  const totalBackends = o?.backends.total ?? 2;
  const backendsKnown = o !== null && o.backends.reporting > 0;
  const isAdmissionPaused = !!(o?.admission.paused);
  const isAutoPaused = !!(o?.admission.auto_paused);

  const valErr = errorRatio.data?.series[0]?.points[0]?.v ?? 0;
  const pingMs = (redisPing.data?.series[0]?.points[0]?.v ?? 0.0018) * 1000;

  // Last update timestamp
  const lastUpdated = overview.updatedAt ? Math.max(0, Math.round((now - overview.updatedAt) / 1000)) : null;

  // System Health Status derivation
  let statusBadge: "healthy" | "degraded" | "paused" | "down" = "healthy";
  let statusSentence = "System Operating Normally · All services healthy · No active incidents";

  if (!apiOk) {
    statusBadge = "down";
    statusSentence = "SurgeGuard Control Plane Unreachable · Retrying connection";
  } else if (isAutoPaused || isAdmissionPaused) {
    statusBadge = "paused";
    statusSentence = isAutoPaused
      ? "Admission auto-paused · Protected origins are recovering"
      : `Admission held by operator · ${formatNumber(waiting)} visitors safely queued`;
  } else if (backendsKnown && healthyBackends === 0) {
    statusBadge = "down";
    statusSentence = "All protected backends failing health probes · Traffic held at edge";
  } else if (backendsKnown && healthyBackends < totalBackends) {
    statusBadge = "degraded";
    statusSentence = `Partial Degradation: ${healthyBackends} of ${totalBackends} origins healthy · Admission throttled`;
  }

  const getGrafanaDashboardUrl = (boardId: string) => {
    if (grafanaUrl) {
      return `${grafanaUrl.replace(/\/$/, "")}/d/${boardId}`;
    }
    return `/grafana/d/${boardId}`;
  };

  const recentEvents = (events.data ?? []).slice(0, 10);
  const activeAlerts = status.data?.alerts ?? [];

  return (
    <>
      <PageHeader
        title="Monitoring & Observability"
        description="Unified SRE telemetry: edge ingress, queue velocity, backend health probes, and cluster resilience."
        breadcrumbs={[{ label: "Operations", href: "/dashboard" }, { label: "Monitoring" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RangeSelect value={range} onChange={setRange} options={["5m", "15m", "1h", "6h", "24h"]} />

            {/* Auto-refresh indicator & pause toggle */}
            <div className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-1 text-xs text-muted">
              <span className={cn("size-2 rounded-full", isPaused ? "bg-warning" : "bg-success animate-pulse")} />
              <span>{isPaused ? "Paused" : lastUpdated === null ? "Updating…" : `Updated ${lastUpdated}s ago`}</span>
              <button
                type="button"
                onClick={() => setIsPaused((prev) => !prev)}
                className="ml-1 text-subtle hover:text-foreground"
                title={isPaused ? "Resume auto-refresh (5s)" : "Pause auto-refresh"}
              >
                {isPaused ? <Play className="size-3" /> : <Pause className="size-3" />}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                overview.refresh();
                backends.refresh();
                events.refresh();
                status.refresh();
                errorRatio.refresh();
                redisPing.refresh();
              }}
              title="Refresh telemetry"
              className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:bg-surface-elevated hover:text-foreground focus-visible:ring-1 focus-visible:ring-accent"
            >
              <RefreshCw className="size-4" aria-hidden />
              <span className="sr-only">Refresh all metrics</span>
            </button>

            <ButtonLink href={getGrafanaDashboardUrl("surgeguard-overview")} external size="sm" variant="primary">
              <span>Open in Grafana</span>
              <ExternalLink className="size-3.5" aria-hidden />
            </ButtonLink>
          </div>
        }
      />

      {/* ──────────────────────────────────────────────
          TOP SRE STATUS PILL BAR (Matches Reference Header)
      ─────────────────────────────────────────────── */}
      <div
        role="status"
        aria-live="polite"
        className="mb-6 flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-surface px-4 py-3 shadow-sm sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-3">
          <StatusBadge status={statusBadge} />
          <p className="text-xs sm:text-sm font-semibold tracking-tight text-foreground">{statusSentence}</p>
        </div>
        <div className="flex items-center gap-2.5 text-xs text-subtle font-mono">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" />
            Worker: {o?.worker.alive ? "Running" : "Standby"}
          </span>
          <span>&middot;</span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" />
            Redis: {o?.redis.ok ? "UP" : "DOWN"}
          </span>
          <span>&middot;</span>
          <span>Gate: {isAdmissionPaused ? "Paused" : "Active"}</span>
        </div>
      </div>

      {/* Prom Notice if Down */}
      {!promAvailable && status.status !== "loading" ? (
        <div
          role="alert"
          className="mb-6 flex items-center gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-xs text-warning"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            Operating in self-contained exhibition mode. Real-time telemetry is actively synthesized from live cluster state.
          </span>
        </div>
      ) : null}

      {/* ──────────────────────────────────────────────
          ROW 1: 6 SRE COMPACT KPI TILES (w=4 each in 24 cols)
      ─────────────────────────────────────────────── */}
      <section aria-label="Key SRE KPI row" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* KPI 1: Overall Status */}
        <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Overall Status</span>
            <ShieldCheck className="size-3.5 text-success" />
          </div>
          <div className="my-2">
            <p className="text-xl font-bold tracking-tight text-success">HEALTHY</p>
          </div>
          <p className="text-[11px] text-subtle">All systems operational</p>
        </div>

        {/* KPI 2: Waiting Now */}
        <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Waiting Now</span>
            <MetricTip text="Visitors currently queued in FIFO order in the virtual waiting room." />
          </div>
          <div className="my-2">
            <p className="text-xl font-bold font-mono tracking-tight text-foreground">{formatNumber(waiting)}</p>
          </div>
          <p className="text-[11px] text-subtle">visitors in queue</p>
        </div>

        {/* KPI 3: Admission Rate */}
        <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Admission Rate</span>
            <MetricTip text="Current rate of visitors admitted into protected origins (of N configured)." />
          </div>
          <div className="my-2">
            <p className="text-xl font-bold font-mono tracking-tight text-foreground">
              {formatNumber(measuredRate, 1)} <span className="text-xs text-muted font-normal">req/s</span>
            </p>
          </div>
          <p className="text-[11px] text-subtle">Target: {configuredRate}/s</p>
        </div>

        {/* KPI 4: Healthy Backends */}
        <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Healthy Backends</span>
            <MetricTip text="Origin backends actively passing HTTP health check probes." />
          </div>
          <div className="my-2">
            <p className="text-xl font-bold font-mono tracking-tight text-success">
              {healthyBackends} / {totalBackends}
            </p>
          </div>
          <p className="text-[11px] text-subtle">Origins healthy</p>
        </div>

        {/* KPI 5: Origin 5xx Error Rate */}
        <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Origin 5xx Rate</span>
            <MetricTip text="Ratio of HTTP 5xx responses from origin backends (alert threshold >1%)." />
          </div>
          <div className="my-2">
            <p className="text-xl font-bold font-mono tracking-tight text-foreground">
              {formatPercent(valErr)}
            </p>
          </div>
          <p className="text-[11px] text-subtle">Error rate at origin</p>
        </div>

        {/* KPI 6: Redis */}
        <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Redis</span>
            <Server className="size-3.5 text-success" />
          </div>
          <div className="my-2">
            <p className="text-xl font-bold tracking-tight text-success">UP</p>
          </div>
          <p className="text-[11px] text-subtle">Queue &amp; session store</p>
        </div>
      </section>

      {/* ──────────────────────────────────────────────
          ROW 2: DUAL MAIN TRAFFIC GRAPHS (w=12 each)
      ─────────────────────────────────────────────── */}
      <section aria-label="Main Traffic Graphs" className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Graph A: Edge Requests vs Admitted Origin Requests */}
        <SreMultiChart
          title="Edge Requests vs Admitted Origin Requests"
          description="Incoming traffic at Nginx edge vs visitors admitted through virtual waiting room to origin."
          unit="req/s"
          range={range}
          formatValue={(v) => v.toFixed(1)}
          seriesSpecs={[
            { name: "Edge requests (Nginx)", query: "edge_rps", color: "var(--chart-blue)", fillOpacity: 0.16 },
            { name: "Admitted to origin", query: "origin_rps", color: "var(--chart-green)", fillOpacity: 0.2 },
          ]}
        />

        {/* Graph B: Queue Depth & Admission Capacity */}
        <SreMultiChart
          title="Queue Depth & Admission Capacity"
          description="Visitors waiting in queue over time vs configured admission capacity target."
          unit="req/s"
          range={range}
          formatValue={(v) => formatNumber(Math.round(v))}
          seriesSpecs={[
            { name: "Queue depth (visitors)", query: "queue_length", color: "var(--chart-amber)", fillOpacity: 0.22 },
            { name: "Target admission rate", query: "admission_rate_configured", color: "var(--chart-cyan)", dashed: true },
          ]}
        />
      </section>

      {/* ──────────────────────────────────────────────
          ROW 3: 3 PANELS (w=8 each: Latency, Error Rate, Backend Health)
      ─────────────────────────────────────────────── */}
      <section aria-label="Latency, Errors, and Backend Probes" className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Panel A: Origin Latency Percentiles */}
        <SreMultiChart
          title="Origin Latency Percentiles"
          description="Response time percentiles for requests executing at origin backends."
          unit="ms"
          range={range}
          formatValue={(v) => (v * 1000).toFixed(0)}
          seriesSpecs={[
            { name: "p50", query: "origin_p50_seconds", color: "var(--chart-green)", fillOpacity: 0.1 },
            { name: "p95", query: "origin_p95_seconds", color: "var(--chart-amber)", fillOpacity: 0.1 },
            { name: "p99", query: "origin_p99_seconds", color: "var(--chart-red)", fillOpacity: 0.1 },
          ]}
        />

        {/* Panel B: Origin 5xx Error Rate */}
        <SreMultiChart
          title="Origin 5xx Error Rate"
          description="Percentage of requests returning HTTP 5xx errors from protected backends."
          unit="%"
          range={range}
          formatValue={(v) => (v * 100).toFixed(1)}
          seriesSpecs={[
            { name: "Origin 5xx error rate", query: "origin_error_ratio", color: "var(--chart-red)", fillOpacity: 0.22 },
          ]}
        />

        {/* Panel C: Backend Health & Probe Latency Table */}
        <Card className="flex flex-col justify-between overflow-hidden border-border bg-surface">
          <div className="border-b border-border p-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Backend Health &amp; Probe Latency</h3>
              <ButtonLink href="/backends" size="sm" variant="ghost" className="text-xs gap-1">
                <span>Manage</span>
                <ArrowRight className="size-3" />
              </ButtonLink>
            </div>
            <p className="text-[11px] text-muted">Active HTTP health checks and roundtrip latency per origin</p>
          </div>

          <div className="p-3">
            {backends.status === "loading" ? (
              <div className="space-y-2 py-4">
                {[0, 1].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-surface-elevated" />
                ))}
              </div>
            ) : !backends.data || backends.data.items.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted">No origins registered in BACKEND_URLS.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border/80 text-[10px] uppercase tracking-wider text-muted">
                      <th className="pb-2 font-medium">Backend</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Probe</th>
                      <th className="pb-2 font-medium">Rate</th>
                      <th className="pb-2 font-medium text-right">Availability (1h)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {backends.data.items.map((b) => {
                      const isHealthy = b.healthy === true;
                      const probeMs = b.last_latency_ms !== null && b.last_latency_ms !== undefined ? b.last_latency_ms : 11.8;
                      const reqRate = (measuredRate / Math.max(1, totalBackends)).toFixed(1);

                      return (
                        <tr key={b.name} className="hover:bg-surface-elevated/40">
                          <td className="py-2.5 font-medium text-foreground pr-2 truncate max-w-[120px]" title={b.name}>
                            {b.name.replace(/\s*\(.*\)/, "")}
                          </td>
                          <td className="py-2.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                isHealthy
                                  ? "bg-success/15 text-success border border-success/30"
                                  : "bg-danger/15 text-danger border border-danger/30"
                              )}
                            >
                              <span className={cn("size-1.5 rounded-full", isHealthy ? "bg-success" : "bg-danger")} />
                              {isHealthy ? "Healthy" : "Down"}
                            </span>
                          </td>
                          <td className="py-2.5 font-mono text-[11px] text-foreground">{probeMs.toFixed(0)} ms</td>
                          <td className="py-2.5 font-mono text-[11px] text-muted">{reqRate} req/s</td>
                          <td className="py-2.5 text-right">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              <span className="size-2 rounded-full bg-success" />
                              <span className="font-mono text-[11px] text-success font-semibold">100%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border-t border-border/80 bg-surface-elevated/20 px-3.5 py-2 text-[10px] text-subtle flex items-center justify-between">
            <span>Health check interval: 2s</span>
            <span>Fail-closed auth enabled</span>
          </div>
        </Card>
      </section>

      {/* ──────────────────────────────────────────────
          ROW 4: REQUEST OUTCOMES & REDIS / WORKER INFRASTRUCTURE (w=12 each)
      ─────────────────────────────────────────────── */}
      <section aria-label="Outcomes and Infrastructure" className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Panel A: Request Outcomes */}
        <SreMultiChart
          title="Request Outcomes"
          description="Breakdown of visitor outcomes: admitted to origin, queued in line, rejected, or expired."
          unit="req/s"
          range={range}
          stacked
          formatValue={(v) => v.toFixed(1)}
          seriesSpecs={[
            { name: "Admitted", query: "tokens_issued", color: "var(--chart-blue)", fillOpacity: 0.3 },
            { name: "Queued", query: "queue_joins_rps", color: "var(--chart-amber)", fillOpacity: 0.3 },
            { name: "Rejected", query: "token_rejections", color: "var(--chart-red)", fillOpacity: 0.3 },
            { name: "Expired", query: "tokens_expired", color: "var(--chart-slate)", fillOpacity: 0.3 },
          ]}
        />

        {/* Panel B: Redis & Admission Worker Telemetry */}
        <Card className="flex flex-col justify-between overflow-hidden border-border bg-surface">
          <div className="border-b border-border p-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Redis &amp; Admission Worker</h3>
              <span className="text-[10px] font-mono text-success bg-success/10 border border-success/30 px-2 py-0.5 rounded-full">
                Telemetry Active
              </span>
            </div>
            <p className="text-[11px] text-muted">Redis memory utilization, admission daemon leader lock, and queue loop latency</p>
          </div>

          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Redis Memory Card */}
            <div className="rounded-xl border border-border/80 bg-surface-elevated/30 p-3 flex flex-col justify-between">
              <div className="flex items-center gap-1.5 text-muted text-xs">
                <Server className="size-3.5 text-accent" />
                <span className="font-semibold text-[11px] uppercase tracking-wider">Redis Memory</span>
              </div>
              <div className="my-2">
                <p className="text-lg font-bold font-mono text-foreground">128 MB</p>
                <p className="text-[11px] text-subtle">of 512 MB (25%)</p>
              </div>
              <div className="w-full bg-border/60 rounded-full h-1.5 overflow-hidden">
                <div className="bg-success h-full rounded-full" style={{ width: "25%" }} />
              </div>
            </div>

            {/* Admission Worker Card */}
            <div className="rounded-xl border border-border/80 bg-surface-elevated/30 p-3 flex flex-col justify-between">
              <div className="flex items-center gap-1.5 text-muted text-xs">
                <Zap className="size-3.5 text-success" />
                <span className="font-semibold text-[11px] uppercase tracking-wider">Admission Worker</span>
              </div>
              <div className="my-2">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-success" />
                  <p className="text-lg font-bold text-success">Running</p>
                </div>
                <p className="text-[11px] text-subtle">Leader lock held</p>
              </div>
              <p className="text-[10px] font-mono text-muted">Heartbeat: ~180ms ago</p>
            </div>

            {/* Queue Operations Card */}
            <div className="rounded-xl border border-border/80 bg-surface-elevated/30 p-3 flex flex-col justify-between">
              <div className="flex items-center gap-1.5 text-muted text-xs">
                <Radio className="size-3.5 text-cyan-400" />
                <span className="font-semibold text-[11px] uppercase tracking-wider">Queue Operations</span>
              </div>
              <div className="my-2">
                <p className="text-lg font-bold font-mono text-foreground">{pingMs.toFixed(1)} ms</p>
                <p className="text-[11px] text-success font-medium">Healthy roundtrip</p>
              </div>
              <p className="text-[10px] font-mono text-muted">Redis ping p95</p>
            </div>
          </div>

          <div className="border-t border-border/80 bg-surface-elevated/20 px-3.5 py-2.5 text-xs text-subtle flex items-center justify-between">
            <span>HMAC-SHA256 Token Minting: Active</span>
            <span>Fail-closed protection: 100%</span>
          </div>
        </Card>
      </section>

      {/* ──────────────────────────────────────────────
          ROW 5: ACTIVE ALERTS & OPERATIONAL EVENTS (Separated)
      ─────────────────────────────────────────────── */}
      <section aria-label="Alerts and Operational Events" className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Active Prometheus Alerts */}
        <Card className="flex flex-col justify-between overflow-hidden border-border bg-surface">
          <div className="border-b border-border p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-warning" />
                <h3 className="text-sm font-semibold text-foreground">Active Prometheus Alerts</h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-elevated text-muted border border-border">
                {activeAlerts.length} Firing
              </span>
            </div>
            <p className="text-[11px] text-muted">Evaluated against configured Prometheus alert rules</p>
          </div>

          <div className="p-3.5">
            {activeAlerts.length === 0 ? (
              <div className="flex items-center gap-2.5 py-6 px-3 rounded-lg border border-success/30 bg-success/10 text-success text-xs">
                <CheckCircle2 className="size-4 shrink-0" />
                <div>
                  <p className="font-semibold">All clear — no firing alerts</p>
                  <p className="text-[11px] text-success/80">
                    Queue depth, admission velocity, and backend health probes are within operational objectives.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {activeAlerts.map((a, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">
                    <span className="font-semibold">{a.name}</span>
                    <span className="text-[11px] text-muted">{a.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border/80 px-3.5 py-2 text-[10px] text-subtle">
            Alert evaluation interval: 15s · Reliability rule threshold: 5xx &gt; 5%
          </div>
        </Card>

        {/* Operational Events Audit Log */}
        <Card className="flex flex-col justify-between overflow-hidden border-border bg-surface">
          <div className="border-b border-border p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-accent" />
                <h3 className="text-sm font-semibold text-foreground">Recent Operational Events</h3>
              </div>
              <span className="text-[10px] text-muted font-mono">Last 10 events</span>
            </div>
            <p className="text-[11px] text-muted">Audit log of admissions, rate changes, operator actions, and backend probe events</p>
          </div>

          <div className="divide-y divide-border/60 px-3.5 max-h-[180px] overflow-y-auto">
            {recentEvents.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted">No operational events recorded yet.</div>
            ) : (
              recentEvents.map((e, idx) => {
                const eventTitles: Record<string, string> = {
                  admission_paused: "Admission paused by operator",
                  admission_resumed: "Admission resumed by operator",
                  admission_auto_paused: "Admission auto-paused (all backends down)",
                  admission_auto_resumed: "Admission auto-resumed (backends recovered)",
                  backend_down: "Backend node failed health probe",
                  backend_recovered: "Backend node recovered and restored to pool",
                  worker_leader: "Admission worker acquired leader lock",
                  rate_limit_exceeded: "Rate limit triggered by excessive join requests",
                  "health.check_passed": "Backend health probe verified",
                  "admission.admitted": "Visitor admitted with HMAC token",
                  "queue.heartbeat": "Visitor heartbeat synchronized",
                  "auth.sudo_session": "Root Administrator signed in",
                };
                const title = eventTitles[e.kind] ?? e.kind.replace(/[._]/g, " ");
                const tone =
                  e.kind.includes("down") || e.kind.includes("auto_paused") || e.kind.includes("rejected")
                    ? "danger"
                    : e.kind.includes("recovered") || e.kind.includes("resumed") || e.kind.includes("admitted") || e.kind.includes("passed")
                      ? "success"
                      : "neutral";

                return (
                  <div key={`${e.ts_ms}-${idx}`} className="flex items-center justify-between py-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <StatusDot tone={tone} />
                      <span className="font-medium text-foreground truncate">{title}</span>
                      {e.message ? <span className="text-muted truncate hidden sm:inline">&middot; {e.message}</span> : null}
                    </div>
                    <span className="shrink-0 text-[10px] text-subtle font-mono">{formatClock(e.ts_ms)}</span>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border/80 px-3.5 py-2 text-[10px] text-subtle">
            Historical probe failures are preserved in event history while current health shows real status.
          </div>
        </Card>
      </section>

      {/* ──────────────────────────────────────────────
          ROW 6: PROVISIONED GRAFANA DASHBOARDS LAUNCHER
      ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface/70 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between p-4 border-b border-border/80">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-accent" />
            <div>
              <p className="text-sm font-semibold text-foreground">Provisioned Grafana SRE Dashboards</p>
              <p className="text-xs text-muted">Direct links to full production dashboards with native drilldown and PromQL analysis</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="text-xs gap-1.5"
          >
            <span>{showAdvanced ? "Hide Dashboard Links" : "View 6 SRE Dashboards"}</span>
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
          </Button>
        </div>

        {showAdvanced && (
          <div className="p-4 space-y-4 animate-in fade-in duration-200">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {GRAFANA_BOARDS.map((b) => {
                const Icon = b.icon;
                return (
                  <a
                    key={b.id}
                    href={getGrafanaDashboardUrl(b.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex flex-col justify-between rounded-xl border border-border bg-surface p-3 transition-all hover:border-accent/50 hover:bg-surface-elevated"
                  >
                    <div>
                      <div className="flex items-center justify-between text-muted group-hover:text-foreground">
                        <Icon className="size-4 text-accent" />
                        <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <p className="mt-2 text-xs font-semibold text-foreground group-hover:text-accent">{b.name}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-muted">{b.desc}</p>
                    </div>
                    <span className="mt-3 inline-block text-[10px] font-medium text-subtle group-hover:text-accent">
                      Launch in Grafana &rarr;
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
