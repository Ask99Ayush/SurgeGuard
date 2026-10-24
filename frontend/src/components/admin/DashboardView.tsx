"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Layers,
  MonitorPlay,
  Radio,
  Server,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { EventList } from "@/components/admin/EventList";
import { MetricChart } from "@/components/admin/MetricChart";
import { PauseControl } from "@/components/admin/PauseControl";
import { RangeSelect } from "@/components/admin/RangeSelect";
import { StatTile } from "@/components/admin/StatTile";
import type { EventItem, Overview, SeriesResponse } from "@/components/admin/types";
import { ButtonLink, Card, CardHeader, StatusDot, type Tone } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { formatMs, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import type { RangeName } from "@/lib/promql";

export function DashboardView() {
  const [range, setRange] = useState<RangeName>("15m");
  const overview = usePolling<Overview>("/api/admin/overview", 3000);
  const errorRatio = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_error_ratio", 10_000);
  const p95Latency = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_p95_seconds", 10_000);
  const events = usePolling<EventItem[]>("/api/admin/events?limit=200", 10_000);

  const o = overview.data;
  const loading = overview.status === "loading";

  const promDown = errorRatio.status !== "success" && !errorRatio.data;
  const ratio = errorRatio.data?.series[0]?.points[0]?.v ?? null;
  const p95 = p95Latency.data?.series[0]?.points[0]?.v ?? null;

  const backendsKnown = o !== null && o.backends.reporting > 0;
  const backendEmphasis = !backendsKnown
    ? "default"
    : o.backends.healthy === 0
      ? "danger"
      : o.backends.healthy < o.backends.total
        ? "warning"
        : "default";

  // Attention Required Detection
  const hasIssues =
    overview.status === "error" ||
    overview.status === "disconnected" ||
    (o && (!o.redis.ok || !o.worker.alive || o.backends.healthy < o.backends.total || (ratio !== null && ratio > 0.05)));

  return (
    <>
      <PageHeader
        title="Operations Overview"
        description="Real-time pulse of SurgeGuard virtual waiting room, admission velocity, and backend protection."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {o ? <PauseControl paused={o.admission.paused} autoPaused={o.admission.auto_paused} onChanged={overview.refresh} /> : null}
            <ButtonLink href="/live" size="sm">
              <MonitorPlay className="size-4" aria-hidden />
              Live Projector
            </ButtonLink>
          </div>
        }
      />

      {/* SECTION E: ATTENTION REQUIRED OR SYSTEM HEALTH BANNER */}
      {overview.status === "error" || overview.status === "disconnected" ? (
        <div role="alert" className="mb-6 flex items-center justify-between rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="size-5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">SurgeGuard Control Plane Disconnected</p>
              <p className="text-xs text-danger/80">
                {overview.status === "disconnected"
                  ? "Lost connection to the console backend server."
                  : `SurgeGuard API returned error: ${overview.error ?? "unknown"}.`}
                {overview.stale ? " Displaying cached values." : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={overview.refresh}
            className="rounded-lg border border-danger/30 bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-elevated"
          >
            Retry Connection
          </button>
        </div>
      ) : o?.admission.paused || o?.admission.auto_paused ? (
        <div role="alert" className="mb-6 flex items-center justify-between rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Admission Rate Regulated &middot; Queue Paused</p>
              <p className="text-xs text-warning/80">
                {o.admission.auto_paused
                  ? "System auto-paused token issuance because healthy origin backends dropped to zero."
                  : "Manual pause active by operator instruction. Incoming requests are safely enqueued in Redis."}
              </p>
            </div>
          </div>
          <Link
            href="/queue"
            className="flex items-center gap-1 rounded-lg border border-warning/40 bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-elevated"
          >
            View Queue ({o.queue.waiting}) <ArrowRight className="size-3" />
          </Link>
        </div>
      ) : hasIssues ? (
        <div role="alert" className="mb-6 flex items-center justify-between rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Attention Required &middot; Subsystem Degraded</p>
              <p className="text-xs text-warning/80">
                {o && o.backends.healthy < o.backends.total
                  ? `${o.backends.total - o.backends.healthy} backend instance failing active health probes.`
                  : "One or more auxiliary telemetry feeds are reporting degraded responses."}
              </p>
            </div>
          </div>
          <Link
            href="/backends"
            className="flex items-center gap-1 rounded-lg border border-warning/40 bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-elevated"
          >
            Inspect Backends <ArrowRight className="size-3" />
          </Link>
        </div>
      ) : o && o.queue.waiting > 0 ? (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          <div className="flex items-center gap-2.5">
            <span className="size-2.5 rounded-full bg-accent animate-pulse" />
            <div>
              <p className="font-semibold">Virtual Waiting Room Active &middot; Surge Protection Engaged</p>
              <p className="text-xs text-accent/80">
                Regulating visitor ingress at {o.admission.configured_rate} admissions/second. Origins running safely with 0.0% database connection overload.
              </p>
            </div>
          </div>
          <Link
            href="/queue?state=waiting"
            className="flex items-center gap-1 rounded-lg border border-accent/40 bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-elevated"
          >
            Manage Queue ({o.queue.waiting} waiting) <ArrowRight className="size-3" />
          </Link>
        </div>
      ) : (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-2.5 text-xs text-muted">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="size-4 text-success" />
            <span>
              <strong className="text-foreground">Surge Protection Active:</strong> Reverse proxy gate enforcing HMAC-SHA256 tokens. Backends operating at steady capacity.
            </span>
          </div>
          <div className="flex items-center gap-3 text-subtle">
            <Link href="/monitoring" className="hover:text-foreground">
              Deep Monitoring &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* SECTION A: OPERATIONAL SUMMARY (6 TILES) */}
      <section aria-label="Key Performance Indicators" className="mb-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile
            label="Queue Depth"
            loading={loading}
            value={o ? formatNumber(o.queue.waiting) : null}
            context={o ? (o.queue.waiting > 0 ? "Visitors waiting in line" : "No backlog in queue") : "API unreachable"}
          />
          <StatTile
            label="Admission Rate"
            loading={loading}
            value={o ? formatNumber(o.admission.measured_rate_per_s, 2) : null}
            unit="/s"
            context={o ? `Target: ${o.admission.configured_rate}/s (window ${o.admission.window_seconds}s)` : "API unreachable"}
          />
          <StatTile
            label="Active Visitors"
            loading={loading}
            value={o ? formatNumber(o.queue.admitted_active) : null}
            context={o ? "Holding valid admission token" : "API unreachable"}
          />
          <StatTile
            label="Backend Health"
            loading={loading}
            value={backendsKnown ? `${o.backends.healthy}/${o.backends.total}` : null}
            emphasis={backendEmphasis}
            context={!o ? "API unreachable" : backendsKnown ? `${o.backends.healthy} healthy origins` : "Probing…"}
          />
          <StatTile
            label="Origin Error Rate"
            loading={errorRatio.status === "loading"}
            value={promDown || ratio === null ? null : formatPercent(ratio)}
            emptyLabel={promDown ? "Unavailable" : "0.0%"}
            emphasis={ratio !== null && ratio > 0.05 ? "danger" : "default"}
            context={promDown ? "Prometheus offline" : ratio === null ? "Zero 5xx server drops" : "5xx response share"}
          />
          <StatTile
            label="Origin Latency (p95)"
            loading={p95Latency.status === "loading"}
            value={p95 !== null ? `${(p95 * 1000).toFixed(0)}` : null}
            unit="ms"
            emptyLabel={promDown ? "Unavailable" : "No traffic"}
            emphasis={p95 !== null && p95 > 1.0 ? "warning" : "default"}
            context={p95 !== null ? "Backend execution time" : "Waiting for samples"}
          />
        </div>
      </section>

      {/* SECTION B: TRAFFIC AND QUEUE TRENDS (4-CHART COCKPIT) */}
      <section aria-label="Operational Trends" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Traffic &amp; Queue Trends</h2>
            <p className="text-xs text-muted">Time-series signals over the selected {range} window</p>
          </div>
          <RangeSelect value={range} onChange={setRange} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <MetricChart
            title="Queue Depth (Waiting Visitors)"
            description="Live visitors waiting in FIFO queue sequence"
            query="queue_length"
            range={range}
            color="var(--warning)"
            format={(v) => v.toFixed(0)}
            events={events.data ?? []}
          />
          <MetricChart
            title="Admission Rate (Velocity)"
            description="Admitted per second; dashed line is configured target"
            query="admission_rate"
            range={range}
            color="var(--success)"
            format={(v) => `${v.toFixed(1)}/s`}
            reference={o ? { value: o.admission.configured_rate, label: `target ${o.admission.configured_rate}/s` } : null}
            events={events.data ?? []}
          />
          <MetricChart
            title="Admitted Origin Inflow"
            description="Rate of requests admitted into backend origins"
            query="origin_rps"
            range={range}
            color="var(--accent)"
            format={(v) => `${v.toFixed(1)} req/s`}
            events={events.data ?? []}
          />
          <MetricChart
            title="Origin Execution Latency (p95)"
            description="95th percentile application work duration"
            query="origin_p95_seconds"
            range={range}
            color="var(--muted)"
            format={(v) => `${(v * 1000).toFixed(0)} ms`}
            events={events.data ?? []}
          />
        </div>
      </section>

      {/* SECTION C & D: SYSTEM HEALTH & RECENT OPERATIONAL EVENTS */}
      <section aria-label="Infrastructure Connectivity and Event Stream">
        <div className="grid gap-4 lg:grid-cols-3">
          {/* SECTION D: RECENT OPERATIONAL EVENTS (2 COLS) */}
          <div className="lg:col-span-2">
            <EventList limit={10} />
          </div>

          {/* SECTION C: SYSTEM HEALTH (1 COL) */}
          <Connectivity overview={overview.data} status={overview.status} prometheusOk={!promDown} />
        </div>
      </section>
    </>
  );
}

function ConnectivityRow({
  icon: Icon,
  label,
  tone,
  statusText,
  detail,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: Tone;
  statusText: string;
  detail: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className="size-4 text-muted shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{label}</p>
          <p className="text-[11px] text-subtle truncate">{detail}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusDot tone={tone} />
        <span className="text-xs font-semibold text-foreground">{statusText}</span>
      </div>
    </div>
  );

  if (href) {
    return (
      <li>
        <Link href={href} className="block transition-colors hover:bg-surface-elevated/40 px-1 rounded-lg">
          {content}
        </Link>
      </li>
    );
  }
  return <li>{content}</li>;
}

function Connectivity({
  overview,
  status,
  prometheusOk,
}: {
  overview: Overview | null;
  status: string;
  prometheusOk: boolean;
}) {
  const apiOk = status === "success";

  return (
    <Card>
      <CardHeader
        title="Subsystem Health"
        description="Live status matrix across cluster dependencies."
      />
      <div className="px-5 pb-4 pt-2">
        {status === "loading" ? (
          <StateView kind="loading" compact title="Querying cluster health" message="Checking API, Redis, worker, and backend nodes." />
        ) : (
          <ul className="divide-y divide-border">
            <ConnectivityRow
              icon={Zap}
              label="SurgeGuard API"
              tone={apiOk ? "success" : "danger"}
              statusText={apiOk ? "Healthy" : "Unavailable"}
              detail={apiOk ? "HTTP 200 OK &middot; Subrequests serving" : "Cannot reach FastAPI control plane"}
            />
            <ConnectivityRow
              icon={Server}
              label="Redis State Store"
              tone={!apiOk ? "neutral" : overview?.redis.ok ? "success" : "danger"}
              statusText={!apiOk ? "Unknown" : overview?.redis.ok ? "Healthy" : "Unavailable"}
              detail={!apiOk ? "Status unknown" : overview?.redis.ok ? `Roundtrip latency: ${formatMs(overview.redis.latency_ms)}` : "Redis connection refused"}
            />
            <ConnectivityRow
              icon={Clock}
              label="Admission Worker"
              tone={!apiOk ? "neutral" : overview?.worker.alive ? "success" : "danger"}
              statusText={!apiOk ? "Unknown" : overview?.worker.alive ? "Running" : "Unresponsive"}
              detail={
                !apiOk
                  ? "Heartbeat unknown"
                  : overview?.worker.alive
                    ? `Last tick: ${formatRelative(overview.worker.last_tick_ms)}`
                    : "Worker tick timeout exceeded"
              }
            />
            <ConnectivityRow
              icon={Radio}
              label="Prometheus Engine"
              tone={prometheusOk ? "success" : "danger"}
              statusText={prometheusOk ? "Healthy" : "Unavailable"}
              detail={prometheusOk ? "Scraping targets active" : "Metrics service unreachable"}
              href="/monitoring"
            />
            <ConnectivityRow
              icon={Layers}
              label="Protected Backends"
              tone={
                !overview
                  ? "neutral"
                  : overview.backends.healthy === overview.backends.total
                    ? "success"
                    : overview.backends.healthy === 0
                      ? "danger"
                      : "warning"
              }
              statusText={
                !overview
                  ? "Unknown"
                  : overview.backends.healthy === overview.backends.total
                    ? "Healthy"
                    : overview.backends.healthy === 0
                      ? "Unavailable"
                      : "Degraded"
              }
              detail={
                overview
                  ? `${overview.backends.healthy} of ${overview.backends.total} instances responding`
                  : "Origin status unknown"
              }
              href="/backends"
            />
          </ul>
        )}
      </div>
    </Card>
  );
}
