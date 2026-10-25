"use client";

import Link from "next/link";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { ArrowLeft, WifiOff } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/components/ui/primitives";
import { usePolling } from "@/hooks/usePolling";
import { useNow } from "@/hooks/useNow";
import { formatClock, formatNumber } from "@/lib/format";
import type { Overview, SeriesResponse } from "./types";

const POLL_MS = 2000;

function Big({
  label,
  value,
  unit,
  note,
  tone = "default",
}: {
  label: string;
  value: string | null;
  unit?: string;
  note: string;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-border bg-surface p-6 xl:p-8 shadow-[var(--shadow-pop)]">
      <p className="text-xl font-medium text-muted xl:text-2xl">{label}</p>
      <p
        className={cn(
          "mt-4 truncate text-[64px] font-semibold leading-none tabular-nums tracking-[-0.04em] sm:text-[80px] xl:text-[104px]",
          value === null && "text-subtle",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {value ?? "—"}
        {value !== null && unit ? <span className="ml-2 text-3xl font-medium text-muted xl:text-4xl">{unit}</span> : null}
      </p>
      <p className="mt-4 text-base text-subtle xl:text-lg">{note}</p>
    </div>
  );
}

function merge(queue: SeriesResponse | null, rate: SeriesResponse | null) {
  const rows = new Map<number, { t: number; queue: number | null; rate: number | null }>();
  for (const p of queue?.series[0]?.points ?? []) rows.set(p.t, { t: p.t, queue: p.v, rate: null });
  for (const p of rate?.series[0]?.points ?? []) {
    const row = rows.get(p.t) ?? { t: p.t, queue: null, rate: null };
    row.rate = p.v;
    rows.set(p.t, row);
  }
  return Array.from(rows.values()).sort((a, b) => a.t - b.t);
}

/** Full-screen, high-contrast projector view. Auto-refreshes every 2 s. */
export function LiveView() {
  const now = useNow();
  const overview = usePolling<Overview>("/api/admin/overview", POLL_MS);
  const queue = usePolling<SeriesResponse>("/api/metrics/range?name=queue_length&range=15m", POLL_MS);
  const rate = usePolling<SeriesResponse>("/api/metrics/range?name=admission_rate&range=15m", POLL_MS);

  const o = overview.data;
  const disconnected = overview.status === "error" || overview.status === "disconnected";
  const age = overview.updatedAt ? Math.round((now - overview.updatedAt) / 1000) : null;
  const rows = merge(queue.data, rate.data);
  const hasChart = rows.some((r) => r.queue !== null || r.rate !== null);

  const backendsKnown = o !== null && o.backends.reporting > 0;
  const isPaused = !!(o?.admission.paused);

  // Derive simple human status for projector
  let statusText = "Checking";
  let statusTone: "default" | "success" | "warning" | "danger" = "default";
  let statusNote = "Connecting to telemetry";

  if (disconnected) {
    statusText = "Offline";
    statusTone = "danger";
    statusNote = "Console API unreachable";
  } else if (isPaused) {
    statusText = "Paused";
    statusTone = "warning";
    statusNote = "Admission held by operator";
  } else if (!backendsKnown) {
    statusText = "Healthy";
    statusTone = "success";
    statusNote = "Worker active & ready";
  } else if (o.backends.healthy === 0) {
    statusText = "Down";
    statusTone = "danger";
    statusNote = "All origin nodes failing probes";
  } else if (o.backends.healthy < o.backends.total) {
    statusText = "Degraded";
    statusTone = "warning";
    statusNote = `${o.backends.healthy} of ${o.backends.total} backends healthy`;
  } else {
    statusText = "Healthy";
    statusTone = "success";
    statusNote = "All origin servers operational";
  }

  return (
    <main id="main" className="flex min-h-dvh flex-col gap-6 bg-background p-6 text-foreground xl:p-10">
      {/* Minimal projector header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Wordmark />
          <span className="rounded-lg bg-surface-elevated px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-muted border border-border">
            Projector View
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <span className={cn("flex items-center gap-2 text-base tabular-nums", disconnected ? "text-danger" : "text-muted")}>
            <span aria-hidden className={cn("size-2.5 rounded-full animate-pulse", disconnected ? "bg-danger" : "bg-success")} />
            {age === null ? "Connecting" : `Live · updated ${age}s ago`}
          </span>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Exit Projector
          </Link>
        </div>
      </header>

      {disconnected ? (
        <div role="alert" className="flex items-center gap-4 rounded-xl border-2 border-danger bg-danger/15 px-6 py-5 text-2xl font-semibold text-danger">
          <WifiOff className="size-8 shrink-0" aria-hidden />
          Disconnected
          <span className="text-lg font-normal text-foreground">
            {o ? "Numbers below are the last known values." : "No response from the SurgeGuard API."}
          </span>
        </div>
      ) : null}

      {/* 3 VERY LARGE NUMBERS (Waiting, Admitted, Status) */}
      <section aria-label="Key projector numbers" className={cn("grid gap-4 sm:grid-cols-3", disconnected && "opacity-60")}>
        <Big
          label="Waiting"
          value={o ? formatNumber(o.queue.waiting) : null}
          note={o ? `${formatNumber(o.queue.admitted_active)} currently active` : "visitors waiting"}
          tone={o && o.queue.waiting > 100 ? "warning" : "default"}
        />
        <Big
          label="Admitted"
          value={o ? formatNumber(o.admission.measured_rate_per_s, 1) : null}
          unit="/s"
          note={o ? `Configured target: ${o.admission.configured_rate}/s` : "measured throughput"}
          tone="success"
        />
        <Big
          label="Status"
          value={statusText}
          note={statusNote}
          tone={statusTone}
        />
      </section>

      {/* PROJECTOR TIMELINE CHART */}
      <section aria-label="Last 15 minutes" className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-[var(--shadow-pop)]">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium text-muted">Queue Depth &amp; Admission Velocity · Last 15 Minutes</h2>
          <span className="text-xs text-subtle">Auto-refreshing every 2s</span>
        </div>
        <div className="mt-4 h-[42vh] min-h-[300px]">
          {!queue.data && !rate.data ? (
            <p className="grid h-full place-items-center text-xl text-subtle">
              {queue.status === "loading" ? "Loading live chart…" : "Chart unavailable: Prometheus unreachable"}
            </p>
          ) : !hasChart ? (
            <p className="grid h-full place-items-center text-xl text-subtle">No queue traffic yet. Run make demo to generate surge load.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(t: number) => formatClock(t).slice(0, 5)}
                  stroke="var(--muted)"
                  tick={{ fontSize: 16 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={80}
                />
                <YAxis yAxisId="q" stroke="var(--accent)" tick={{ fontSize: 16 }} tickLine={false} axisLine={false} width={64} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" stroke="var(--success)" tick={{ fontSize: 16 }} tickLine={false} axisLine={false} width={56} />
                <Legend wrapperStyle={{ fontSize: 16, color: "var(--foreground)" }} />
                <Line yAxisId="q" name="Queue depth" type="monotone" dataKey="queue" stroke="var(--accent)" strokeWidth={4} dot={false} isAnimationActive={false} connectNulls={false} />
                <Line yAxisId="r" name="Admitted / s" type="monotone" dataKey="rate" stroke="var(--success)" strokeWidth={4} dot={false} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </main>
  );
}
