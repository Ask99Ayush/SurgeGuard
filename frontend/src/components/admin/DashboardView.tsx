"use client";

import { useState } from "react";
import { AlertTriangle, MonitorPlay } from "lucide-react";
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
  const events = usePolling<EventItem[]>("/api/admin/events?limit=200", 10_000);
  const o = overview.data;
  const loading = overview.status === "loading";

  const promDown = errorRatio.status !== "success" && !errorRatio.data;
  const ratio = errorRatio.data?.series[0]?.points[0]?.v ?? null;
  const backendsKnown = o !== null && o.backends.reporting > 0;
  const backendEmphasis = !backendsKnown ? "default" : o.backends.healthy === 0 ? "danger" : o.backends.healthy < o.backends.total ? "warning" : "default";

  return (
    <>
      <PageHeader
        title="Operations"
        description="Live state of the queue, admission and protected backends."
        actions={
          <>
            {o ? <PauseControl paused={o.admission.paused} autoPaused={o.admission.auto_paused} onChanged={overview.refresh} /> : null}
            <ButtonLink href="/live" size="sm">
              <MonitorPlay className="size-4" aria-hidden />
              Live view
            </ButtonLink>
          </>
        }
      />

      {overview.status === "error" || overview.status === "disconnected" ? (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {overview.status === "disconnected" ? "Disconnected from the console server." : `SurgeGuard API unavailable: ${overview.error ?? "unknown error"}.`}
          {overview.stale ? " Showing the last known values." : ""}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Queue length" loading={loading} value={o ? formatNumber(o.queue.waiting) : null} context={o ? "Visitors waiting now" : "API unreachable"} />
        <StatTile
          label="Admission rate"
          loading={loading}
          value={o ? formatNumber(o.admission.measured_rate_per_s, 2) : null}
          unit="/s"
          context={o ? `Last ${o.admission.window_seconds}s · target ${o.admission.configured_rate}/s` : "API unreachable"}
        />
        <StatTile
          label="Active visitors"
          loading={loading}
          value={o ? formatNumber(o.queue.admitted_active) : null}
          context={o ? "Holding a valid admission token" : "API unreachable"}
        />
        <StatTile
          label="Backend health"
          loading={loading}
          value={backendsKnown ? `${o.backends.healthy}/${o.backends.total}` : null}
          emphasis={backendEmphasis}
          context={!o ? "API unreachable" : backendsKnown ? "Healthy / configured" : "No health checks reported yet"}
        />
        <StatTile
          label="Origin error rate"
          loading={errorRatio.status === "loading"}
          value={promDown || ratio === null ? null : formatPercent(ratio)}
          emptyLabel={promDown ? "Unavailable" : "No traffic"}
          emphasis={ratio !== null && ratio > 0.05 ? "danger" : "default"}
          context={promDown ? "Prometheus unreachable" : ratio === null ? "No origin requests in the last 1m" : "5xx share of origin responses, 1m"}
        />
      </div>

      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="text-base font-semibold">Trends</h2>
        <RangeSelect value={range} onChange={setRange} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <MetricChart
          title="Queue length"
          description="Visitors waiting"
          query="queue_length"
          range={range}
          format={(v) => v.toFixed(0)}
          events={events.data ?? []}
        />
        <MetricChart
          title="Admission rate"
          description="Admitted per second; dashed line is the configured rate"
          query="admission_rate"
          range={range}
          color="var(--success)"
          format={(v) => v.toFixed(1)}
          reference={o ? { value: o.admission.configured_rate, label: `target ${o.admission.configured_rate}/s` } : null}
          events={events.data ?? []}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EventList limit={8} />
        </div>
        <Connectivity overview={overview.data} status={overview.status} prometheusOk={!promDown} />
      </div>
    </>
  );
}

function Row({ label, tone, detail }: { label: string; tone: Tone; detail: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex items-center gap-2.5 text-sm">
        <StatusDot tone={tone} />
        {label}
      </span>
      <span className="truncate text-right text-xs tabular-nums text-muted">{detail}</span>
    </li>
  );
}

function Connectivity({ overview, status, prometheusOk }: { overview: Overview | null; status: string; prometheusOk: boolean }) {
  const apiOk = status === "success";
  return (
    <Card>
      <CardHeader title="Service connectivity" description="As seen by the console server." />
      <div className="px-5 pb-4 pt-2">
        {status === "loading" ? (
          <StateView kind="loading" compact title="Checking services" message="Asking the API for Redis, worker and backend state." />
        ) : (
          <ul className="divide-y divide-border">
            <Row label="SurgeGuard API" tone={apiOk ? "success" : "danger"} detail={apiOk ? "reachable" : "unreachable"} />
            <Row
              label="Redis"
              tone={!apiOk ? "neutral" : overview?.redis.ok ? "success" : "danger"}
              detail={!apiOk ? "unknown" : overview ? formatMs(overview.redis.latency_ms) : "—"}
            />
            <Row
              label="Admission worker"
              tone={!apiOk ? "neutral" : overview?.worker.alive ? "success" : "danger"}
              detail={!apiOk ? "unknown" : overview?.worker.alive ? `tick ${formatRelative(overview.worker.last_tick_ms)}` : "no heartbeat"}
            />
            <Row label="Prometheus" tone={prometheusOk ? "success" : "danger"} detail={prometheusOk ? "reachable" : "unreachable"} />
            <Row
              label="Backends"
              tone={!overview ? "neutral" : overview.backends.healthy === overview.backends.total ? "success" : overview.backends.healthy === 0 ? "danger" : "warning"}
              detail={overview ? `${overview.backends.healthy} of ${overview.backends.total} healthy` : "unknown"}
            />
          </ul>
        )}
      </div>
    </Card>
  );
}
