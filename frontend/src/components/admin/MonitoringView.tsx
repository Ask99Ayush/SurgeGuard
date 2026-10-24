"use client";

import { useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
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

export function MonitoringView({ grafanaUrl }: { grafanaUrl: string | null }) {
  const [range, setRange] = useState<RangeName>("1h");

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

  return (
    <>
      <PageHeader
        title="Monitoring & Observability"
        description="Comprehensive metrics, live scrape targets, queue telemetry, and alert state."
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
      <section aria-label="Observability Key Performance Indicators" className="mb-8">
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-muted">System Vital Metrics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
            context="5xx responses from origin instances"
          />

          <StatTile
            label="Origin Latency (p95)"
            loading={p95Latency.status === "loading"}
            value={valP95 !== null ? `${(valP95 * 1000).toFixed(0)}` : null}
            unit="ms"
            emptyLabel={promAvailable ? "No traffic" : "Unavailable"}
            emphasis={valP95 !== null && valP95 > 1.0 ? "warning" : "default"}
            context={valP50 !== null ? `p50: ${(valP50 * 1000).toFixed(0)}ms` : "Work execution inside origin"}
          />

          <StatTile
            label="Protected Backends"
            loading={overview.status === "loading"}
            value={backendsKnown ? `${o.backends.healthy}/${o.backends.total}` : null}
            emphasis={backendHealthEmphasis}
            context={!o ? "API unreachable" : backendsKnown ? "Healthy / configured nodes" : "No probes reported yet"}
          />
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

      {/* Metric Charts Section */}
      <section aria-label="Detailed Timeseries Telemetry">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Traffic, Latency & Queue Dynamics</h2>
            <p className="text-xs text-muted">Time-series data over the selected {range} window</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Edge Request Velocity */}
          <MetricChart
            title="Edge Request Velocity"
            description="Total requests handled by Nginx proxy"
            query="edge_rps"
            range={range}
            color="var(--accent)"
            format={(v) => `${v.toFixed(1)} req/s`}
          />

          {/* Origin Request Volume */}
          <MetricChart
            title="Origin Inflow Rate"
            description="Metered requests admitted into backends"
            query="origin_rps"
            range={range}
            color="var(--success)"
            format={(v) => `${v.toFixed(1)} req/s`}
          />

          {/* Origin Error Rate */}
          <MetricChart
            title="Origin Error Ratio"
            description="Share of 5xx responses from backends"
            query="origin_error_ratio"
            range={range}
            color="var(--danger)"
            format={(v) => `${(v * 100).toFixed(1)}%`}
          />

          {/* Origin Latency p95 */}
          <MetricChart
            title="Origin Latency (p95)"
            description="Work execution duration inside origin"
            query="origin_p95_seconds"
            range={range}
            color="var(--warning)"
            format={(v) => `${(v * 1000).toFixed(0)} ms`}
          />

          {/* Origin Latency p50 */}
          <MetricChart
            title="Origin Latency (Median p50)"
            description="Median execution time under load"
            query="origin_p50_seconds"
            range={range}
            color="var(--muted)"
            format={(v) => `${(v * 1000).toFixed(0)} ms`}
          />

          {/* Origin Latency p99 */}
          <MetricChart
            title="Origin Latency Tail (p99)"
            description="99th percentile tail latency"
            query="origin_p99_seconds"
            range={range}
            color="var(--danger)"
            format={(v) => `${(v * 1000).toFixed(0)} ms`}
          />

          {/* Queue Wait Time p95 */}
          <MetricChart
            title="Queue Wait Time (p95)"
            description="Time from joining queue to token admission"
            query="wait_p95_seconds"
            range={range}
            color="var(--warning)"
            format={(v) => `${v.toFixed(0)}s`}
          />

          {/* Token Validations & Rejections */}
          <MetricChart
            title="Token Rejections"
            description="Tampered, expired, or invalid tokens refused at edge"
            query="token_rejections"
            range={range}
            color="var(--danger)"
            format={(v) => `${v.toFixed(2)}/s`}
          />

          {/* Fail-Closed Auth Decisions */}
          <MetricChart
            title="Fail-Closed Decisions"
            description="Requests refused when internal auth/Redis is down"
            query="auth_fail_closed"
            range={range}
            color="var(--danger)"
            format={(v) => `${v.toFixed(2)}/s`}
          />

          {/* Active Nginx Connections */}
          <MetricChart
            title="Nginx Active Connections"
            description="Current open TCP connections at edge proxy"
            query="nginx_connections_active"
            range={range}
            color="var(--accent)"
            format={(v) => v.toFixed(0)}
          />

          {/* Redis PING Latency */}
          <MetricChart
            title="Redis PING Latency (p95)"
            description="Roundtrip latency from worker to Redis"
            query="redis_ping_p95"
            range={range}
            color="var(--muted)"
            format={(v) => `${(v * 1000).toFixed(1)} ms`}
          />

          {/* Healthy Backends Count */}
          <MetricChart
            title="Healthy Backends"
            description="Actively passing health check probes"
            query="backends_healthy"
            range={range}
            color="var(--success)"
            format={(v) => `${v.toFixed(0)} nodes`}
          />
        </div>
      </section>
    </>
  );
}
