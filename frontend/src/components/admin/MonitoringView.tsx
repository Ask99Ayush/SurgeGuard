"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ExternalLink,
  Layers,
  Radio,
  RefreshCw,
  Server,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { MetricChart } from "@/components/admin/MetricChart";
import { RangeSelect } from "@/components/admin/RangeSelect";
import { StatTile } from "@/components/admin/StatTile";
import type { Overview, PromStatus, SeriesResponse } from "@/components/admin/types";
import { Badge, ButtonLink, Card, CardHeader, StatusDot } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { formatNumber, formatPercent, formatRelative } from "@/lib/format";
import type { RangeName } from "@/lib/promql";

type Category = "all" | "overview" | "latency" | "infra" | "security";

const GRAFANA_BOARDS = [
  { id: "surgeguard-overview", name: "Overview & Health", icon: Activity, desc: "System health KPIs, token rates & traffic" },
  { id: "surgeguard-backends", name: "Edge & Traffic", icon: Layers, desc: "Nginx connections, per-origin load & bypass" },
  { id: "surgeguard-queue", name: "Queue & Tokens", icon: Radio, desc: "Queue mechanics, wait time & token validity" },
  { id: "surgeguard-resources", name: "Infrastructure", icon: Server, desc: "Redis memory, ping latency & worker loop" },
  { id: "surgeguard-latency", name: "Latency & 5xx", icon: BarChart3, desc: "Percentile curves, status distribution & tail" },
  { id: "surgeguard-failure", name: "Reliability & Chaos", icon: ShieldAlert, desc: "Dependency matrix, fail-closed & recovery" },
];

export function MonitoringView({ grafanaUrl }: { grafanaUrl: string | null }) {
  const [range, setRange] = useState<RangeName>("1h");
  const [category, setCategory] = useState<Category>("all");

  // Telemetry feeds
  const overview = usePolling<Overview>("/api/admin/overview", 5000);
  const status = usePolling<PromStatus>("/api/metrics/status", 10_000);
  const edgeRps = usePolling<SeriesResponse>("/api/metrics/instant?name=edge_rps", 10_000);
  const originRps = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_rps", 10_000);
  const errorRatio = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_error_ratio", 10_000);
  const p95Latency = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_p95_seconds", 10_000);
  const p50Latency = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_p50_seconds", 10_000);

  const o = overview.data;
  const promAvailable = status.status === "success" && status.data !== null;

  // Extracted instant values
  const valEdge = edgeRps.data?.series[0]?.points[0]?.v ?? null;
  const valOrigin = originRps.data?.series[0]?.points[0]?.v ?? null;
  const valErr = errorRatio.data?.series[0]?.points[0]?.v ?? null;
  const valP95 = p95Latency.data?.series[0]?.points[0]?.v ?? null;
  const valP50 = p50Latency.data?.series[0]?.points[0]?.v ?? null;

  const backendsKnown = o !== null && o.backends.reporting > 0;
  const backendHealthEmphasis = !backendsKnown
    ? "default"
    : o.backends.healthy === 0
      ? "danger"
      : o.backends.healthy < o.backends.total
        ? "warning"
        : "default";

  const getGrafanaDashboardUrl = (boardId: string) => {
    if (grafanaUrl) {
      return `${grafanaUrl.replace(/\/$/, "")}/d/${boardId}`;
    }
    return `/grafana/d/${boardId}`;
  };

  return (
    <>
      <PageHeader
        title="Monitoring & Observability"
        description="Comprehensive metrics, live scrape targets, queue telemetry, and alert state."
        breadcrumbs={[{ label: "Operations", href: "/dashboard" }, { label: "Monitoring" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RangeSelect value={range} onChange={setRange} />
            <button
              type="button"
              onClick={() => {
                overview.refresh();
                status.refresh();
                edgeRps.refresh();
                originRps.refresh();
                errorRatio.refresh();
                p95Latency.refresh();
              }}
              title="Refresh telemetry"
              className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              <RefreshCw className="size-4" aria-hidden />
              <span className="sr-only">Refresh all metrics</span>
            </button>
            {grafanaUrl ? (
              <ButtonLink href={grafanaUrl} external size="sm">
                Open Grafana <ExternalLink className="size-3.5" aria-hidden />
              </ButtonLink>
            ) : null}
          </div>
        }
      />

      {/* Prom or API Warning */}
      {!promAvailable && status.status !== "loading" ? (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          <AlertTriangle className="size-4.5 shrink-0" aria-hidden />
          <span>
            Prometheus is currently unreachable. Chart time series and scrape target status are running on fallback mode.
          </span>
        </div>
      ) : null}

      {/* Observability Summary Cards */}
      <section aria-label="Observability Key Performance Indicators" className="mb-6">
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-muted">System Vital Metrics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatTile
            label="Edge Throughput"
            loading={edgeRps.status === "loading"}
            value={valEdge !== null ? formatNumber(valEdge, 1) : null}
            unit="req/s"
            emptyLabel={promAvailable ? "No traffic" : "Unavailable"}
            context="Nginx public entry requests"
          />

          <StatTile
            label="Origin Request Rate"
            loading={originRps.status === "loading"}
            value={valOrigin !== null ? formatNumber(valOrigin, 1) : null}
            unit="req/s"
            emptyLabel={promAvailable ? "No traffic" : "Unavailable"}
            context="Admitted requests reaching backends"
          />

          <StatTile
            label="Queue Depth"
            loading={overview.status === "loading"}
            value={o ? formatNumber(o.queue.waiting) : null}
            context={o ? "Waiting visitors in FIFO sequence" : "API unreachable"}
          />

          <StatTile
            label="Admitted Active"
            loading={overview.status === "loading"}
            value={o ? formatNumber(o.queue.admitted_active) : null}
            context={o ? "Holding valid admission token" : "API unreachable"}
          />

          <StatTile
            label="Origin Error Rate"
            loading={errorRatio.status === "loading"}
            value={valErr !== null ? formatPercent(valErr) : null}
            emptyLabel={promAvailable ? "0.0%" : "Unavailable"}
            emphasis={valErr !== null && valErr > 0.05 ? "danger" : "default"}
            context={valErr === null ? "0.0% · Zero 5xx drop" : "5xx share of responses"}
          />

          <StatTile
            label="Origin Latency (p95)"
            loading={p95Latency.status === "loading"}
            value={valP95 !== null ? `${(valP95 * 1000).toFixed(0)}` : null}
            unit="ms"
            emptyLabel={promAvailable ? "No traffic" : "Unavailable"}
            emphasis={valP95 !== null && valP95 > 1.0 ? "warning" : "default"}
            context={valP50 !== null ? `p50: ${(valP50 * 1000).toFixed(0)}ms` : "Work execution duration"}
          />

          <StatTile
            label="Protected Backends"
            loading={overview.status === "loading"}
            value={backendsKnown ? `${o.backends.healthy}/${o.backends.total}` : null}
            emphasis={backendHealthEmphasis}
            context={!o ? "API unreachable" : backendsKnown ? "Healthy / configured" : "No probes reported"}
          />
        </div>
      </section>

      {/* Grafana Dashboards Deep-Link Launcher */}
      <section aria-label="Grafana Provisioned Dashboards" className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-accent" />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Dedicated Grafana Dashboards</h2>
          </div>
          <span className="text-xs text-muted">6 pre-provisioned dashboards with live Prometheus queries</span>
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
                className="group flex flex-col justify-between rounded-xl border border-border bg-surface p-3 transition-all hover:border-accent/50 hover:bg-surface-elevated hover:shadow-[var(--shadow-pop)]"
              >
                <div>
                  <div className="flex items-center justify-between text-muted group-hover:text-foreground">
                    <Icon className="size-4 text-accent" />
                    <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <h3 className="mt-2 text-xs font-semibold text-foreground group-hover:text-accent">{b.name}</h3>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-muted">{b.desc}</p>
                </div>
                <span className="mt-2.5 inline-block text-[10px] font-medium text-subtle group-hover:text-accent">
                  Launch in Grafana &rarr;
                </span>
              </a>
            );
          })}
        </div>
      </section>

      {/* Service Health & Prometheus Scrape Targets */}
      <div className="mb-8 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Service Health & Exporters"
            description="Active Prometheus scrape targets across container boundaries"
          />
          <div className="px-5 pb-4 pt-2">
            {status.status === "loading" ? (
              <StateView kind="loading" compact />
            ) : !status.data ? (
              <StateView
                kind={status.status === "disconnected" ? "disconnected" : "error"}
                title="Prometheus unreachable"
                compact
                onRetry={status.refresh}
              />
            ) : status.data.targets.length === 0 ? (
              <StateView kind="empty" title="No scrape targets discovered" compact />
            ) : (
              <ul className="divide-y divide-border">
                {status.data.targets.map((t) => (
                  <li key={`${t.job}-${t.instance}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <StatusDot tone={t.health === "up" ? "success" : t.health === "down" ? "danger" : "neutral"} />
                      <span className="font-medium text-foreground">{t.job}</span>
                      <span className="truncate font-mono text-xs text-subtle">{t.instance}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted" title={t.lastError ?? undefined}>
                      {t.health === "up" ? `Scraped ${formatRelative(Date.parse(t.lastScrape))}` : (t.lastError ?? t.health)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Prometheus Alerting Rules"
            description="Active evaluation state for operational threshold breaches"
          />
          <div className="px-5 pb-4 pt-2">
            {status.status === "loading" ? (
              <StateView kind="loading" compact />
            ) : !status.data ? (
              <StateView
                kind={status.status === "disconnected" ? "disconnected" : "error"}
                title="Prometheus alerts unreachable"
                compact
              />
            ) : status.data.alerts.length === 0 ? (
              <StateView kind="empty" title="No active alerts" message="All operational alert rules are normal and quiet." compact />
            ) : (
              <ul className="divide-y divide-border">
                {status.data.alerts.map((a) => (
                  <li key={`${a.name}-${a.activeAt}`} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">{a.name}</span>
                      <Badge
                        tone={a.state === "firing" ? (a.severity === "critical" ? "danger" : "warning") : "neutral"}
                        dot
                      >
                        {a.state}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{a.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Metric Charts Section with Category Tabs */}
      <section aria-label="Detailed Timeseries Telemetry">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Traffic, Latency & Queue Dynamics</h2>
            <p className="text-xs text-muted">Time-series data over the selected {range} window</p>
          </div>
          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
            {[
              { id: "all", label: "All Telemetry" },
              { id: "overview", label: "System Overview" },
              { id: "latency", label: "Latency & Performance" },
              { id: "infra", label: "Infrastructure" },
              { id: "security", label: "Security & Reliability" },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id as Category)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  category === cat.id
                    ? "bg-accent text-accent-contrast shadow-sm"
                    : "text-muted hover:bg-surface-elevated hover:text-foreground"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* SYSTEM OVERVIEW */}
          {(category === "all" || category === "overview") && (
            <>
              <MetricChart
                title="Edge Request Ingress"
                description="Total requests handled by Nginx proxy"
                query="edge_rps"
                range={range}
                color="var(--accent)"
                format={(v) => `${v.toFixed(1)} req/s`}
              />
              <MetricChart
                title="Origin Admitted Inflow"
                description="Metered requests admitted into backends"
                query="origin_rps"
                range={range}
                color="var(--success)"
                format={(v) => `${v.toFixed(1)} req/s`}
              />
              <MetricChart
                title="Nginx Active TCP Connections"
                description="Current open TCP connections at edge proxy"
                query="nginx_connections_active"
                range={range}
                color="var(--accent)"
                format={(v) => v.toFixed(0)}
              />
              <MetricChart
                title="Queue Join Influx Rate"
                description="New visitor arrivals attempting entry"
                query="queue_joins_rps"
                range={range}
                color="var(--warning)"
                format={(v) => `${v.toFixed(1)} joins/s`}
              />
            </>
          )}

          {/* LATENCY & PERFORMANCE */}
          {(category === "all" || category === "latency") && (
            <>
              <MetricChart
                title="Origin Latency (p95)"
                description="95th percentile work duration inside origin"
                query="origin_p95_seconds"
                range={range}
                color="var(--warning)"
                format={(v) => `${(v * 1000).toFixed(0)} ms`}
              />
              <MetricChart
                title="Origin Latency (Median p50)"
                description="Median execution time under load"
                query="origin_p50_seconds"
                range={range}
                color="var(--muted)"
                format={(v) => `${(v * 1000).toFixed(0)} ms`}
              />
              <MetricChart
                title="Origin Latency Tail (p99)"
                description="99th percentile tail latency"
                query="origin_p99_seconds"
                range={range}
                color="var(--danger)"
                format={(v) => `${(v * 1000).toFixed(0)} ms`}
              />
              <MetricChart
                title="Queue Wait Time (p95)"
                description="95th percentile wait from join to admission"
                query="wait_p95_seconds"
                range={range}
                color="var(--warning)"
                format={(v) => `${v.toFixed(0)}s`}
              />
              <MetricChart
                title="Queue Wait Time (Median p50)"
                description="Median duration spent waiting in queue"
                query="wait_p50_seconds"
                range={range}
                color="var(--muted)"
                format={(v) => `${v.toFixed(0)}s`}
              />
              <MetricChart
                title="Redis Roundtrip PING (p95)"
                description="Roundtrip latency from worker to Redis"
                query="redis_ping_p95"
                range={range}
                color="var(--muted)"
                format={(v) => `${(v * 1000).toFixed(1)} ms`}
              />
            </>
          )}

          {/* SECURITY & RELIABILITY */}
          {(category === "all" || category === "security") && (
            <>
              <MetricChart
                title="Origin Error Ratio"
                description="Share of 5xx responses from backends"
                query="origin_error_ratio"
                range={range}
                color="var(--danger)"
                format={(v) => `${(v * 100).toFixed(1)}%`}
              />
              <MetricChart
                title="Overload Rejections (503)"
                description="Requests dropped when local concurrency limit exceeded"
                query="origin_overload_rejections"
                range={range}
                color="var(--danger)"
                format={(v) => `${v.toFixed(1)} drops/s`}
              />
              <MetricChart
                title="Bypass Attempts (403)"
                description="Direct requests blocked without Nginx secret header"
                query="origin_forbidden_rps"
                range={range}
                color="var(--danger)"
                format={(v) => `${v.toFixed(1)} blocked/s`}
              />
              <MetricChart
                title="Token Rejections"
                description="Expired, tampered, or invalid tokens refused at edge"
                query="token_rejections"
                range={range}
                color="var(--danger)"
                format={(v) => `${v.toFixed(2)}/s`}
              />
              <MetricChart
                title="Tokens Minted Velocity"
                description="Admission JWT tokens issued to visitors"
                query="tokens_issued"
                range={range}
                color="var(--success)"
                format={(v) => `${v.toFixed(1)} tokens/s`}
              />
              <MetricChart
                title="Fail-Closed Decisions"
                description="Requests refused when internal auth/Redis is down"
                query="auth_fail_closed"
                range={range}
                color="var(--danger)"
                format={(v) => `${v.toFixed(2)}/s`}
              />
            </>
          )}

          {/* INFRASTRUCTURE & HEALTH */}
          {(category === "all" || category === "infra") && (
            <>
              <MetricChart
                title="Healthy Backends"
                description="Actively passing health check probes"
                query="backends_healthy"
                range={range}
                color="var(--success)"
                format={(v) => `${v.toFixed(0)} nodes`}
              />
              <MetricChart
                title="Redis Roundtrip PING (p95)"
                description="Roundtrip latency from worker to Redis"
                query="redis_ping_p95"
                range={range}
                color="var(--muted)"
                format={(v) => `${(v * 1000).toFixed(1)} ms`}
              />
              <MetricChart
                title="Redis Command Throughput"
                description="Redis commands executed per second"
                query="redis_commands_rps"
                range={range}
                color="var(--accent)"
                format={(v) => `${v.toFixed(0)} cmds/s`}
              />
              <MetricChart
                title="Admission Worker Cadence"
                description="Worker loop ticks evaluated per second"
                query="worker_ticks_rps"
                range={range}
                color="var(--success)"
                format={(v) => `${v.toFixed(1)} ticks/s`}
              />
            </>
          )}
        </div>
      </section>
    </>
  );
}
