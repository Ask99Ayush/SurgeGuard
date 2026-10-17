"use client";

import Link from "next/link";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { WifiOff } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/components/ui/primitives";
import { usePolling } from "@/hooks/usePolling";
import { useNow } from "@/hooks/useNow";
import { formatClock, formatNumber, formatPercent } from "@/lib/format";
import type { Overview, SeriesResponse } from "./types";

const POLL_MS = 2000;

function Big({ label, value, unit, note, tone = "default" }: {
  label: string;
  value: string | null;
  unit?: string;
  note: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-6 xl:p-8">
      <p className="text-xl font-medium text-muted xl:text-2xl">{label}</p>
      <p
        className={cn(
          "mt-4 truncate text-[64px] font-semibold leading-none tabular-nums tracking-[-0.04em] sm:text-[80px] xl:text-[112px]",
          value === null && "text-subtle",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {value ?? "—"}
        {value !== null && unit ? <span className="ml-2 text-3xl font-medium text-muted xl:text-4xl">{unit}</span> : null}
      </p>
      <p className="mt-4 text-lg text-subtle xl:text-xl">{note}</p>
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

/** Full-screen, high-contrast view for projectors. Real data only, polled every 2 s. */
export function LiveView() {
  const now = useNow();
  const overview = usePolling<Overview>("/api/admin/overview", POLL_MS);
  const ratio = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_error_ratio", POLL_MS);
  const queue = usePolling<SeriesResponse>("/api/metrics/range?name=queue_length&range=15m", POLL_MS);
  const rate = usePolling<SeriesResponse>("/api/metrics/range?name=admission_rate&range=15m", POLL_MS);

  const o = overview.data;
  const disconnected = overview.status === "error" || overview.status === "disconnected";
  const age = overview.updatedAt ? Math.round((now - overview.updatedAt) / 1000) : null;
  const errorValue = ratio.data?.series[0]?.points[0]?.v ?? null;
  const promDown = ratio.status !== "success" && !ratio.data;
  const rows = merge(queue.data, rate.data);
  const hasChart = rows.some((r) => r.queue !== null || r.rate !== null);
  const backendsKnown = o !== null && o.backends.reporting > 0;

  return (
    <main id="main" className="flex min-h-dvh flex-col gap-6 bg-background p-6 text-foreground xl:p-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Wordmark />
          <span className="text-lg text-muted">Live</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <span className={cn("flex items-center gap-2 text-lg tabular-nums", disconnected ? "text-danger" : "text-muted")}>
            <span aria-hidden className={cn("size-3 rounded-full", disconnected ? "bg-danger" : "bg-success")} />
            {age === null ? "Connecting" : `Updated ${age}s ago`}
          </span>
          <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-base text-muted transition-colors duration-150 hover:bg-surface-elevated hover:text-foreground">
            Exit
          </Link>
        </div>
      </header>

      {disconnected ? (
        <div role="alert" className="flex items-center gap-4 rounded-xl border-2 border-danger bg-danger/15 px-6 py-5 text-3xl font-semibold text-danger">
          <WifiOff className="size-9 shrink-0" aria-hidden />
          Disconnected
          <span className="text-xl font-normal text-foreground">
            {o ? "Numbers below are the last known values and are not updating." : "No data received from the SurgeGuard API."}
          </span>
        </div>
      ) : null}

      <section aria-label="Key numbers" className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", disconnected && "opacity-60")}>
        <Big label="Queue length" value={o ? formatNumber(o.queue.waiting) : null} note="visitors waiting" />
        <Big
          label="Admitted per second"
          value={o ? formatNumber(o.admission.measured_rate_per_s, 1) : null}
          note={o ? `target ${o.admission.configured_rate}/s` : "unavailable"}
        />
        <Big
          label="Backends healthy"
          value={backendsKnown ? `${o.backends.healthy}/${o.backends.total}` : null}
          note={backendsKnown ? "healthy / configured" : "no health data"}
          tone={backendsKnown && o.backends.healthy === 0 ? "danger" : backendsKnown && o.backends.healthy < o.backends.total ? "warning" : "default"}
        />
        <Big
          label="Error rate"
          value={promDown || errorValue === null ? null : formatPercent(errorValue)}
          note={promDown ? "Prometheus unreachable" : errorValue === null ? "no origin traffic" : "origin 5xx, last 1m"}
          tone={errorValue !== null && errorValue > 0.05 ? "danger" : "default"}
        />
      </section>

      <section aria-label="Last 15 minutes" className="flex flex-col rounded-xl border border-border bg-surface p-6">
        <h2 className="text-xl font-medium text-muted">Queue length and admission rate · last 15 minutes</h2>
        {/* Explicit height: ResponsiveContainer measures 0 inside an unsized flex child. */}
        <div className="mt-4 h-[42vh] min-h-[300px]">
          {!queue.data && !rate.data ? (
            <p className="grid h-full place-items-center text-2xl text-subtle">
              {queue.status === "loading" ? "Loading chart…" : "Chart unavailable: Prometheus unreachable"}
            </p>
          ) : !hasChart ? (
            <p className="grid h-full place-items-center text-2xl text-subtle">No samples yet. Run make demo to generate traffic.</p>
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
                  tick={{ fontSize: 18 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={80}
                />
                <YAxis yAxisId="q" stroke="var(--accent)" tick={{ fontSize: 18 }} tickLine={false} axisLine={false} width={64} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" stroke="var(--success)" tick={{ fontSize: 18 }} tickLine={false} axisLine={false} width={56} />
                <Legend wrapperStyle={{ fontSize: 18, color: "var(--foreground)" }} />
                <Line yAxisId="q" name="Queue length" type="monotone" dataKey="queue" stroke="var(--accent)" strokeWidth={4} dot={false} isAnimationActive={false} connectNulls={false} />
                <Line yAxisId="r" name="Admitted / s" type="monotone" dataKey="rate" stroke="var(--success)" strokeWidth={4} dot={false} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </main>
  );
}
