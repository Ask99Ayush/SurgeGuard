"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
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
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricChart } from "@/components/admin/MetricChart";
import { RangeSelect } from "@/components/admin/RangeSelect";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { BackendsResponse, EventItem, Overview, PromStatus, SeriesResponse } from "@/components/admin/types";
import { Button, ButtonLink, Card, StatusDot, cn } from "@/components/ui/primitives";
import { usePolling } from "@/hooks/usePolling";
import { useNow } from "@/hooks/useNow";
import { formatClock, formatMs, formatNumber, formatPercent, formatRelative } from "@/lib/format";
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
        <HelpCircle className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-30 mb-2 w-60 -translate-x-1/2 rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground shadow-[var(--shadow-pop)] animate-in fade-in"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* ─── Trend Indicator ────────────────────────────────── */
function TrendArrow({ points }: { points?: number[] }) {
  if (!points || points.length < 4) return <span className="text-xs text-subtle">→ steady</span>;
  const recent = points.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const earlier = points.slice(-8, -5).reduce((a, b) => a + b, 0) / 3;
  const delta = recent - earlier;
  const pct = earlier > 0 ? (delta / earlier) * 100 : 0;
  if (Math.abs(pct) < 5) return <span className="text-xs text-subtle">→ steady</span>;
  return (
    <span className={cn("text-xs font-medium tabular-nums", delta > 0 ? "text-warning" : "text-success")}>
      {delta > 0 ? "↑" : "↓"} {Math.abs(pct).toFixed(0)}%
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

  // Key Instant Metrics for the 5 Stat Cards
  const edgeRps = usePolling<SeriesResponse>("/api/metrics/instant?name=edge_rps", pollInterval ? 10_000 : 0);
  const originRps = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_rps", pollInterval ? 10_000 : 0);
  const errorRatio = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_error_ratio", pollInterval ? 10_000 : 0);
  const p95Latency = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_p95_seconds", pollInterval ? 10_000 : 0);
  const waitP50 = usePolling<SeriesResponse>("/api/metrics/instant?name=wait_p50_seconds", pollInterval ? 10_000 : 0);
  const waitP95 = usePolling<SeriesResponse>("/api/metrics/instant?name=wait_p95_seconds", pollInterval ? 10_000 : 0);

  // Advanced metrics
  const tokensIssued = usePolling<SeriesResponse>("/api/metrics/instant?name=tokens_issued", pollInterval ? 15_000 : 0);
  const tokensValidated = usePolling<SeriesResponse>("/api/metrics/instant?name=tokens_validated", pollInterval ? 15_000 : 0);
  const redisPing = usePolling<SeriesResponse>("/api/metrics/instant?name=redis_ping_p95", pollInterval ? 15_000 : 0);

  const o = overview.data;
  const apiOk = overview.status === "success" && o !== null;
  const promAvailable = status.status === "success" && status.data !== null;

  // Extracted values
  const waiting = o?.queue.waiting ?? 0;
  const admittedActive = o?.queue.admitted_active ?? 0;
  const measuredRate = o?.admission.measured_rate_per_s ?? 0;
  const configuredRate = o?.admission.configured_rate ?? 0;
  const healthyBackends = o?.backends.healthy ?? 0;
  const totalBackends = o?.backends.total ?? 0;
  const backendsKnown = o !== null && o.backends.reporting > 0;
  const isAdmissionPaused = !!(o?.admission.paused);
  const isAutoPaused = !!(o?.admission.auto_paused);

  const p50v = waitP50.data?.series[0]?.points[0]?.v ?? null;
  const p95v = waitP95.data?.series[0]?.points[0]?.v ?? null;
  const valErr = errorRatio.data?.series[0]?.points[0]?.v ?? null;

  // Last update timestamp
  const lastUpdated = overview.updatedAt ? Math.max(0, Math.round((now - overview.updatedAt) / 1000)) : null;

  // 1. Status sentence and badge derivation
  let statusBadge: "healthy" | "degraded" | "paused" | "down" = "healthy";
  let statusSentence = "All systems normal. Your website is protected and nobody is waiting in line.";

  const avgWaitStr = p50v !== null ? formatMs(p50v * 1000) : waiting > 0 ? "under a minute" : "0s";

  if (!apiOk) {
    statusBadge = "down";
    statusSentence = "SurgeGuard API unreachable. Retrying connection to control plane.";
  } else if (isAutoPaused || isAdmissionPaused) {
    statusBadge = "paused";
    statusSentence = isAutoPaused
      ? "Admission auto-paused because all backends are offline. Waiting for origin recovery."
      : `Admission is paused by operator. ${formatNumber(waiting)} visitors held safely in queue.`;
  } else if (backendsKnown && healthyBackends === 0) {
    statusBadge = "down";
    statusSentence = "All protected backends are failing health checks. Traffic is held at edge.";
  } else if (backendsKnown && healthyBackends < totalBackends) {
    statusBadge = "degraded";
    statusSentence = `Attention: ${healthyBackends} of ${totalBackends} backends are healthy. ${formatNumber(waiting)} people waiting, about ${avgWaitStr} each.`;
  } else if (waiting > 0) {
    statusBadge = "healthy";
    statusSentence = `Traffic surge active: ${formatNumber(waiting)} people waiting, about ${avgWaitStr} each. Admission pace is steady.`;
  }

  const getGrafanaDashboardUrl = (boardId: string) => {
    if (grafanaUrl) {
      return `${grafanaUrl.replace(/\/$/, "")}/d/${boardId}`;
    }
    return `/grafana/d/${boardId}`;
  };

  const recentEvents = (events.data ?? []).slice(0, 10);

  return (
    <>
      <PageHeader
        title="Monitoring"
        description="Live traffic surge metrics, queue velocity, backend health, and operational diagnostics."
        breadcrumbs={[{ label: "Operations", href: "/dashboard" }, { label: "Monitoring" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RangeSelect value={range} onChange={setRange} options={["5m", "15m", "1h"]} />

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
                edgeRps.refresh();
                originRps.refresh();
                errorRatio.refresh();
                p95Latency.refresh();
                waitP50.refresh();
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
          1. TOP STATUS BANNER (Answers status in 5s)
      ─────────────────────────────────────────────── */}
      <div
        role="status"
        aria-live="polite"
        className="mb-6 flex min-h-[64px] flex-col justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-3.5 shadow-[var(--shadow-pop)] sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-3">
          <StatusBadge status={statusBadge} />
          <p className="text-sm font-medium tracking-tight text-foreground sm:text-base">{statusSentence}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-subtle">
          <span>Worker: {o?.worker.alive ? "Leader Active" : "Waiting"}</span>
          <span>&middot;</span>
          <span>Redis: {o?.redis.ok ? "Connected" : "Failing"}</span>
        </div>
      </div>

      {/* Prom Warning if Down */}
      {!promAvailable && status.status !== "loading" ? (
        <div
          role="alert"
          className="mb-6 flex items-center gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            Prometheus telemetry feed is currently reconnecting. Historical timeseries charts will populate automatically once active.
          </span>
        </div>
      ) : null}

      {/* ──────────────────────────────────────────────
          2. ROW OF 5 STAT CARDS
      ─────────────────────────────────────────────── */}
      <section aria-label="Key system statistics" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* 1. Waiting now */}
        <StatCard
          label="Waiting now"
          loading={overview.status === "loading"}
          value={formatNumber(waiting)}
          trend={<TrendArrow />}
          badge={<MetricTip text="Visitors currently holding an exact FIFO spot in the virtual waiting room." />}
          description={`${formatNumber(admittedActive)} currently active`}
          tone={waiting > 50 ? "warning" : "default"}
        />

        {/* 2. Admitted per second */}
        <StatCard
          label="Admitted / sec"
          loading={overview.status === "loading"}
          value={formatNumber(measuredRate, 1)}
          unit="/s"
          trend={<TrendArrow />}
          badge={<MetricTip text="Rate of visitors admitted into the protected site, compared against the configured maximum." />}
          description={`Target: ${configuredRate}/s limit`}
          tone={measuredRate > 0 ? "success" : "default"}
        />

        {/* 3. Average wait */}
        <StatCard
          label="Average wait"
          loading={waitP50.status === "loading" && overview.status === "loading"}
          value={p50v !== null ? formatMs(p50v * 1000) : "—"}
          badge={<MetricTip text="Typical median time (p50) a visitor spends in queue before receiving an admission token." />}
          description={p95v !== null ? `p95 wait: ${formatMs(p95v * 1000)}` : "No queue delay"}
        />

        {/* 4. Healthy backends */}
        <StatCard
          label="Healthy backends"
          loading={overview.status === "loading"}
          value={backendsKnown ? `${healthyBackends} of ${totalBackends}` : "—"}
          badge={<MetricTip text="Origin application nodes currently passing active HTTP health check probes." />}
          description={
            !backendsKnown
              ? "Checking probes…"
              : healthyBackends === totalBackends
                ? "All origins operational"
                : `${totalBackends - healthyBackends} backend down`
          }
          tone={!backendsKnown ? "default" : healthyBackends === totalBackends ? "success" : "warning"}
        />

        {/* 5. Error rate */}
        <StatCard
          label="Error rate"
          loading={errorRatio.status === "loading"}
          value={valErr !== null ? formatPercent(valErr) : "0.0%"}
          badge={<MetricTip text="Percentage of admitted requests resulting in 5xx server errors on origin." />}
          description={valErr === null || valErr === 0 ? "Zero 5xx response drops" : "Origin 5xx server errors"}
          tone={valErr !== null && valErr > 0.05 ? "danger" : "default"}
        />
      </section>

      {/* ──────────────────────────────────────────────
          3. THREE MAIN CHARTS ONLY (with Range Switcher)
      ─────────────────────────────────────────────── */}
      <section aria-label="Primary Monitoring Charts" className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Core System Dynamics</h2>
            <p className="text-xs text-muted">Real-time queue depth, admission rate, and site performance over the last {range}</p>
          </div>
          <span className="text-xs text-subtle">Window: {range}</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Chart 1: People in line */}
          <div className="flex flex-col">
            <MetricChart
              title="People in line"
              description="Visitors in the queue over time with pause/resume markers"
              query="queue_length"
              range={range}
              color="var(--accent)"
              events={events.data ?? []}
              format={(v) => formatNumber(Math.round(v))}
            />
            <p className="mt-1 text-[11px] text-subtle px-1">
              Shows virtual queue depth. Vertical markers indicate operator pause or backend failover events.
            </p>
          </div>

          {/* Chart 2: People let in per second */}
          <div className="flex flex-col">
            <MetricChart
              title="People let in per second"
              description="Measured admission rate vs configured threshold"
              query="admission_rate"
              range={range}
              color="var(--success)"
              reference={configuredRate ? { value: configuredRate, label: `Target: ${configuredRate}/s` } : null}
              format={(v) => `${v.toFixed(1)}/s`}
            />
            <p className="mt-1 text-[11px] text-subtle px-1">
              Solid line represents metered admissions. Dashed grey reference shows configured target capacity.
            </p>
          </div>

          {/* Chart 3: Website speed and errors */}
          <div className="flex flex-col">
            <MetricChart
              title="Website speed and errors"
              description="p95 origin response latency and server error rate"
              query="origin_p95_seconds"
              range={range}
              color="var(--foreground)"
              format={(v) => `${(v * 1000).toFixed(0)} ms`}
            />
            <p className="mt-1 text-[11px] text-subtle px-1">
              Tail response time for requests processed by origin servers. Stays steady during surge queueing.
            </p>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────────────────────
          4. "BACKENDS" STRIP (One card per backend)
      ─────────────────────────────────────────────── */}
      <section aria-label="Backend Pool Strip" className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">Protected Backends Strip</h3>
          </div>
          <ButtonLink href="/backends" size="sm" variant="ghost" className="text-xs gap-1">
            <span>Manage Backends</span>
            <ArrowRight className="size-3" />
          </ButtonLink>
        </div>

        {backends.status === "loading" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-surface" />
            ))}
          </div>
        ) : !backends.data || backends.data.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface/50 p-4 text-center text-xs text-muted">
            No backends registered. Set BACKEND_URLS in .env to register origin nodes.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {backends.data.items.map((b) => {
              const isHealthy = b.healthy === true;
              return (
                <div
                  key={b.name}
                  className="flex items-center justify-between rounded-xl border border-border bg-surface p-3.5 shadow-sm transition-colors hover:border-border-strong"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <StatusDot tone={b.healthy === null ? "neutral" : isHealthy ? "success" : "danger"} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{b.name}</p>
                      <p className="font-mono text-[11px] text-subtle truncate" title={b.url}>
                        {b.url}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-foreground">
                      {b.last_latency_ms !== null && b.last_latency_ms !== undefined ? formatMs(b.last_latency_ms) : "Idle"}
                    </p>
                    <p className="text-[10px] text-subtle">
                      {b.last_check_ms ? `Checked ${formatRelative(b.last_check_ms)}` : "Active"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ──────────────────────────────────────────────
          5. "RECENT EVENTS" LIST (Last 10 plain events)
      ─────────────────────────────────────────────── */}
      <section aria-label="Recent Operational Events" className="mb-6">
        <Card>
          <div className="flex items-center justify-between border-b border-border p-4">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-accent" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Recent Events</h3>
                <p className="text-xs text-muted">Last 10 plain-language operational state changes and health transitions</p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-border px-4">
            {recentEvents.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted">
                No system events recorded yet. Run <code className="font-mono text-accent">make demo</code> to generate traffic.
              </div>
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
                };
                const title = eventTitles[e.kind] ?? e.kind.replace(/_/g, " ");
                const tone = e.kind.includes("down") || e.kind.includes("auto_paused") ? "danger" : e.kind.includes("recovered") || e.kind.includes("resumed") ? "success" : "neutral";

                return (
                  <div key={`${e.ts_ms}-${idx}`} className="flex items-center justify-between py-2.5 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <StatusDot tone={tone} />
                      <span className="font-medium text-foreground truncate">{title}</span>
                      {e.message ? <span className="text-muted truncate hidden sm:inline">&middot; {e.message}</span> : null}
                    </div>
                    <span className="shrink-0 text-[11px] text-subtle font-mono">{formatClock(e.ts_ms)}</span>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </section>

      {/* ──────────────────────────────────────────────
          6. "ADVANCED" COLLAPSIBLE (Token stats, Redis, Grafana)
      ─────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-card)] border border-border bg-surface/60 overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-accent" />
            <div>
              <p className="text-sm font-semibold text-foreground">Advanced Infrastructure &amp; Grafana Dashboards</p>
              <p className="text-xs text-muted">Token validation telemetry, Redis latency, worker leader lock, and direct deep links</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="text-xs gap-1.5"
          >
            <span>{showAdvanced ? "Hide Advanced" : "View Advanced"}</span>
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
          </Button>
        </div>

        {showAdvanced && (
          <div className="border-t border-border p-4 space-y-5 animate-in fade-in duration-200">
            {/* Advanced Metrics Row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-surface p-3">
                <p className="text-[11px] font-medium text-subtle">Tokens Issued Rate</p>
                <p className="mt-1 font-mono text-sm font-semibold text-foreground">
                  {tokensIssued.data?.series[0]?.points[0]?.v !== undefined && tokensIssued.data?.series[0]?.points[0]?.v !== null
                    ? `${formatNumber(tokensIssued.data.series[0].points[0].v, 1)} /s`
                    : "—"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted">HMAC-SHA256 JWT minting</p>
              </div>

              <div className="rounded-xl border border-border bg-surface p-3">
                <p className="text-[11px] font-medium text-subtle">Tokens Validated</p>
                <p className="mt-1 font-mono text-sm font-semibold text-foreground">
                  {tokensValidated.data?.series[0]?.points[0]?.v !== undefined && tokensValidated.data?.series[0]?.points[0]?.v !== null
                    ? `${formatNumber(tokensValidated.data.series[0].points[0].v, 1)} /s`
                    : "—"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted">Edge Nginx auth_request</p>
              </div>

              <div className="rounded-xl border border-border bg-surface p-3">
                <p className="text-[11px] font-medium text-subtle">Redis Ping Latency (p95)</p>
                <p className="mt-1 font-mono text-sm font-semibold text-foreground">
                  {redisPing.data?.series[0]?.points[0]?.v !== undefined && redisPing.data?.series[0]?.points[0]?.v !== null
                    ? formatMs(redisPing.data.series[0].points[0].v * 1000)
                    : o?.redis.latency_ms !== undefined
                      ? `${o.redis.latency_ms} ms`
                      : "—"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted">State store roundtrip</p>
              </div>

              <div className="rounded-xl border border-border bg-surface p-3">
                <p className="text-[11px] font-medium text-subtle">Worker Leadership</p>
                <p className="mt-1 font-mono text-sm font-semibold text-success">
                  {o?.worker.alive ? "Leader Lock Held" : "Standby / Dead"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted">Fenced admission daemon</p>
              </div>
            </div>

            {/* Grafana Dashboards Launcher */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Provisioned Grafana Dashboards
                </h4>
                <ButtonLink href={getGrafanaDashboardUrl("surgeguard-overview")} external size="sm" variant="primary">
                  <span>Open Full Dashboards in Grafana</span>
                  <ExternalLink className="size-3.5" />
                </ButtonLink>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
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
                      <span className="mt-2.5 inline-block text-[10px] font-medium text-subtle group-hover:text-accent">
                        Launch &rarr;
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
