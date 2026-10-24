"use client";

import { lazy, Suspense, useState } from "react";
import { ChartSkeleton } from "@/components/admin/MetricChart";
import { RangeSelect } from "@/components/admin/RangeSelect";
import { Card, CardHeader } from "@/components/ui/primitives";
import type { EventItem, Overview, SeriesResponse } from "@/components/admin/types";
import type { RangeName } from "@/lib/promql";
import { usePolling } from "@/hooks/usePolling";
import { formatClock } from "@/lib/format";
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

/** Lazy load recharts — avoids adding it to the initial bundle (it's already imported via MetricChart, but this keeps the component code-split friendly). */
const _Recharts = lazy(() => import("recharts").then((m) => ({ default: m.AreaChart as never })));
void _Recharts; // suppress unused import lint — the actual import is direct below for correctness.

const MARKER_COLORS: Record<string, { label: string; color: string }> = {
  backend_down: { label: "backend failed", color: "var(--danger)" },
  backend_recovered: { label: "backend recovered", color: "var(--success)" },
  admission_paused: { label: "paused", color: "var(--warning)" },
  admission_auto_paused: { label: "auto-paused", color: "var(--warning)" },
  admission_resumed: { label: "resumed", color: "var(--muted)" },
  admission_auto_resumed: { label: "auto-resumed", color: "var(--muted)" },
  worker_leader: { label: "leader change", color: "var(--accent)" },
};

interface MergedPoint {
  t: number;
  queue: number | null;
  rate: number | null;
}

function UnifiedChart({
  range,
  targetRate,
  events,
}: {
  range: RangeName;
  targetRate: number | null;
  events: EventItem[];
}) {
  const queuePoll = usePolling<SeriesResponse>(
    `/api/metrics/range?name=queue_length&range=${range}`,
    15_000,
  );
  const ratePoll = usePolling<SeriesResponse>(
    `/api/metrics/range?name=admission_rate&range=${range}`,
    15_000,
  );

  const qPts = queuePoll.data?.series[0]?.points ?? [];
  const rPts = ratePoll.data?.series[0]?.points ?? [];

  // Merge by timestamp
  const tMap = new Map<number, MergedPoint>();
  for (const p of qPts) tMap.set(p.t, { t: p.t, queue: p.v, rate: null });
  for (const p of rPts) {
    const existing = tMap.get(p.t);
    if (existing) existing.rate = p.v;
    else tMap.set(p.t, { t: p.t, queue: null, rate: p.v });
  }
  const merged = Array.from(tMap.values()).sort((a, b) => a.t - b.t);

  const loading = queuePoll.status === "loading" || ratePoll.status === "loading";
  const hasData = merged.some((p) => p.queue !== null || p.rate !== null);

  const first = merged[0]?.t ?? 0;
  const last = merged[merged.length - 1]?.t ?? 0;
  const markers = events.filter((e) => MARKER_COLORS[e.kind] && e.ts_ms >= first && e.ts_ms <= last);

  if (loading) return <div className="h-64"><ChartSkeleton /></div>;
  if (!hasData) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium text-foreground">No traffic data in this window</p>
        <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3 text-left">
          <p className="text-xs font-medium text-foreground">Generate demo traffic</p>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <code className="font-mono text-xs text-muted">make demo</code>
            <button
              type="button"
              aria-label="Copy make demo command"
              onClick={() => navigator.clipboard.writeText("make demo").catch(() => {})}
              className="ml-auto text-xs text-accent hover:underline"
            >
              Copy
            </button>
          </div>
        </div>
      </div>
    );
  }

  const maxQ = Math.max(0, ...merged.map((p) => p.queue ?? 0));
  const maxR = Math.max(0, ...merged.map((p) => p.rate ?? 0), targetRate ?? 0);
  const yMax = Math.max(maxQ, maxR) * 1.15;

  return (
    <Suspense fallback={<div className="h-64"><ChartSkeleton /></div>}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={merged} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="tl-queue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--warning)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="tl-rate" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--success)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => formatClock(t).slice(0, 5)}
              stroke="var(--subtle)"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
            />
            <YAxis
              stroke="var(--subtle)"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[0, yMax]}
            />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
              contentStyle={{
                background: "var(--surface-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: 12,
                boxShadow: "var(--shadow-pop)",
                color: "var(--foreground)",
              }}
              labelFormatter={(t) => formatClock(Number(t))}
              formatter={(v, name) => [
                v === null ? "no data" : Number(v).toFixed(1),
                name === "queue" ? "Queue depth" : "Admission /s",
              ]}
            />
            {/* Target rate dashed line */}
            {targetRate != null && (
              <ReferenceLine
                y={targetRate}
                stroke="var(--muted)"
                strokeDasharray="5 4"
                ifOverflow="extendDomain"
                label={{
                  value: `target ${targetRate}/s`,
                  position: "insideTopRight",
                  fill: "var(--muted)",
                  fontSize: 11,
                }}
              />
            )}
            {/* Event markers */}
            {markers.map((e) => (
              <ReferenceLine
                key={`${e.ts_ms}-${e.kind}`}
                x={e.ts_ms}
                stroke={MARKER_COLORS[e.kind]?.color}
                strokeOpacity={0.6}
                strokeDasharray="2 3"
                ifOverflow="discard"
              />
            ))}
            <Area
              type="monotone"
              dataKey="queue"
              stroke="var(--warning)"
              strokeWidth={2}
              fill="url(#tl-queue)"
              connectNulls={false}
              isAnimationActive={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="rate"
              stroke="var(--success)"
              strokeWidth={2}
              fill="url(#tl-rate)"
              connectNulls={false}
              isAnimationActive={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-warning" /> Queue depth
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-success" /> Admission rate
        </span>
        {targetRate != null && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4 border-t border-dashed border-muted" /> Target
          </span>
        )}
        {Array.from(new Set(markers.map((m) => m.kind))).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-px"
              style={{ background: MARKER_COLORS[k]?.color }}
            />
            {MARKER_COLORS[k]?.label}
          </span>
        ))}
      </div>
    </Suspense>
  );
}

export function Timeline({
  overview,
  events,
}: {
  overview: Overview | null;
  events: EventItem[];
}) {
  const [range, setRange] = useState<RangeName>("15m");

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Timeline"
        description="Queue depth and admission rate over time."
        action={<RangeSelect value={range} onChange={setRange} />}
      />
      <div className="px-5 pb-5 pt-3">
        <Suspense fallback={<div className="h-64"><ChartSkeleton /></div>}>
          <UnifiedChart
            range={range}
            targetRate={overview?.admission.configured_rate ?? null}
            events={events}
          />
        </Suspense>
      </div>
    </Card>
  );
}
