"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader, cn } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { useNow } from "@/hooks/useNow";
import { formatClock } from "@/lib/format";
import type { RangeName } from "@/lib/promql";
import type { EventItem, SeriesResponse } from "./types";

/** Event kinds drawn as vertical markers, and their colour. */
const MARKERS: Record<string, { label: string; color: string }> = {
  backend_down: { label: "backend failed", color: "var(--danger)" },
  backend_recovered: { label: "backend recovered", color: "var(--success)" },
  admission_paused: { label: "paused", color: "var(--warning)" },
  admission_auto_paused: { label: "auto-paused", color: "var(--warning)" },
  admission_resumed: { label: "resumed", color: "var(--muted)" },
  admission_auto_resumed: { label: "auto-resumed", color: "var(--muted)" },
};

export function LiveStamp({ updatedAt, stale }: { updatedAt: number | null; stale: boolean }) {
  const now = useNow();
  if (!updatedAt) return <span className="text-xs text-subtle">Waiting for data</span>;
  const age = Math.max(0, Math.round((now - updatedAt) / 1000));
  return (
    <span className={cn("flex items-center gap-1.5 text-xs tabular-nums", stale ? "text-warning" : "text-subtle")}>
      <span aria-hidden className={cn("size-1.5 rounded-full", stale ? "bg-warning" : "bg-success")} />
      {stale ? "Stale · " : ""}Updated {age}s ago
    </span>
  );
}

export function ChartSkeleton() {
  return (
    <div aria-label="Loading chart" className="flex h-full flex-col justify-between px-3 py-2">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="block h-px w-full bg-border" />
      ))}
      <span className="block h-16 w-full animate-pulse rounded-md bg-surface-elevated" />
    </div>
  );
}

/** Small area chart fed by a named Prometheus query, with optional target line and event markers. */
export function MetricChart({
  title,
  description,
  query,
  range,
  format = (v) => v.toFixed(1),
  color = "var(--accent)",
  reference,
  events,
}: {
  title: string;
  description?: string;
  query: string;
  range: RangeName;
  format?: (value: number) => string;
  color?: string;
  reference?: { value: number; label: string } | null;
  events?: EventItem[];
}) {
  const poll = usePolling<SeriesResponse>(`/api/metrics/range?name=${query}&range=${range}`, 15_000);
  const points = poll.data?.series[0]?.points ?? [];
  const hasData = points.some((p) => p.v !== null);
  const gradientId = `grad-${query}`;
  const first = points[0]?.t ?? 0;
  const last = points[points.length - 1]?.t ?? 0;
  const markers = (events ?? []).filter((e) => MARKERS[e.kind] && e.ts_ms >= first && e.ts_ms <= last);
  const maxValue = Math.max(0, ...points.map((p) => p.v ?? 0));
  const yMax = reference ? Math.max(maxValue, reference.value * 1.15) : undefined;

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader title={title} description={description} action={<LiveStamp updatedAt={poll.updatedAt} stale={poll.stale} />} />
      <div className="h-52 px-2 pb-2 pt-2">
        {poll.status === "loading" ? (
          <ChartSkeleton />
        ) : !poll.data ? (
          <StateView
            kind={poll.status === "disconnected" ? "disconnected" : "error"}
            title="Metrics unavailable"
            message="Prometheus could not be queried. Charts resume when it is reachable."
            compact
          />
        ) : !hasData ? (
          <StateView kind="empty" title="No samples in this range" message="Run make demo to generate traffic." compact />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) => formatClock(t).slice(0, 5)}
                stroke="var(--subtle)"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
              />
              <YAxis
                stroke="var(--subtle)"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={44}
                domain={[0, yMax ?? "auto"]}
                tickFormatter={(v: number) => format(v)}
              />
              <Tooltip
                cursor={{ stroke: "var(--border-strong)" }}
                contentStyle={{
                  background: "var(--surface-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "var(--foreground)",
                }}
                labelFormatter={(t) => formatClock(Number(t))}
                formatter={(v) => [v === null ? "no data" : format(Number(v)), title]}
              />
              {markers.map((e) => (
                <ReferenceLine
                  key={`${e.ts_ms}-${e.kind}`}
                  x={e.ts_ms}
                  stroke={MARKERS[e.kind]?.color}
                  strokeOpacity={0.55}
                  strokeDasharray="2 3"
                  ifOverflow="discard"
                />
              ))}
              {reference ? (
                <ReferenceLine
                  y={reference.value}
                  stroke="var(--muted)"
                  strokeDasharray="5 4"
                  ifOverflow="extendDomain"
                  label={{ value: reference.label, position: "insideTopRight", fill: "var(--muted)", fontSize: 12 }}
                />
              ) : null}
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.75}
                fill={`url(#${gradientId})`}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {markers.length > 0 ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-4 text-xs text-subtle">
          {Array.from(new Set(markers.map((m) => m.kind))).map((kind) => (
            <span key={kind} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-px" style={{ background: MARKERS[kind]?.color }} />
              {MARKERS[kind]?.label}
            </span>
          ))}
        </p>
      ) : null}
    </Card>
  );
}
