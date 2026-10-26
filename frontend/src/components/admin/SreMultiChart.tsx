"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader, cn } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { formatClock } from "@/lib/format";
import type { RangeName } from "@/lib/promql";
import type { SeriesResponse } from "./types";

export interface SreSeriesSpec {
  name: string;
  query: string;
  color: string;
  fillOpacity?: number;
  dashed?: boolean;
}

interface MergedPoint {
  t: number;
  [key: string]: number | null;
}

export function SreMultiChart({
  title,
  description,
  seriesSpecs,
  range,
  unit = "",
  formatValue = (v) => v.toFixed(1),
  height = "h-56",
  stacked = false,
}: {
  title: string;
  description?: string;
  seriesSpecs: SreSeriesSpec[];
  range: RangeName;
  unit?: string;
  formatValue?: (value: number) => string;
  height?: string;
  stacked?: boolean;
}) {
  // Query 1
  const q0 = seriesSpecs[0]?.query ?? "";
  const poll0 = usePolling<SeriesResponse>(q0 ? `/api/metrics/range?name=${q0}&range=${range}` : "", 10_000);

  // Query 2
  const q1 = seriesSpecs[1]?.query ?? "";
  const poll1 = usePolling<SeriesResponse>(q1 ? `/api/metrics/range?name=${q1}&range=${range}` : "", 10_000);

  // Query 3
  const q2 = seriesSpecs[2]?.query ?? "";
  const poll2 = usePolling<SeriesResponse>(q2 ? `/api/metrics/range?name=${q2}&range=${range}` : "", 10_000);

  // Query 4
  const q3 = seriesSpecs[3]?.query ?? "";
  const poll3 = usePolling<SeriesResponse>(q3 ? `/api/metrics/range?name=${q3}&range=${range}` : "", 10_000);

  const polls = [poll0, poll1, poll2, poll3].slice(0, seriesSpecs.length);
  const isLoading = polls.some((p) => p.status === "loading" && !p.data);

  // Merge points by timestamp
  const { mergedData, stats } = useMemo(() => {
    const timeMap = new Map<number, MergedPoint>();
    const statsCalc: Record<string, { avg: number | null; current: number | null }> = {};

    seriesSpecs.forEach((spec, idx) => {
      const poll = polls[idx];
      const points = poll?.data?.series[0]?.points ?? [];
      const validPoints = points.filter((p) => p.v !== null);

      if (validPoints.length > 0) {
        const sum = validPoints.reduce((acc, p) => acc + (p.v ?? 0), 0);
        const avg = sum / validPoints.length;
        const current = validPoints[validPoints.length - 1]?.v ?? null;
        statsCalc[spec.name] = { avg, current };
      } else {
        statsCalc[spec.name] = { avg: null, current: null };
      }

      points.forEach((p) => {
        const entry = timeMap.get(p.t) ?? { t: p.t };
        entry[spec.name] = p.v;
        timeMap.set(p.t, entry);
      });
    });

    const sorted = Array.from(timeMap.values()).sort((a, b) => a.t - b.t);
    return { mergedData: sorted, stats: statsCalc };
  }, [seriesSpecs, polls]);

  const hasData = mergedData.length > 0;

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden border-border bg-surface">
      <CardHeader
        title={title}
        description={description}
        action={
          <div className="flex items-center gap-1.5 text-xs text-subtle">
            <span className="size-2 rounded-full bg-success" />
            <span className="font-mono">{range}</span>
          </div>
        }
      />
      <div className="p-3">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-center">
          {/* Main Chart Column (3 cols) */}
          <div className={cn(height, "lg:col-span-3 w-full")}>
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <span className="text-xs text-muted animate-pulse">Loading telemetry...</span>
              </div>
            ) : !hasData ? (
              <StateView
                kind="empty"
                title="No metrics yet"
                message="Waiting for traffic samples in this time window."
                compact
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mergedData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    {seriesSpecs.map((spec) => (
                      <linearGradient
                        key={spec.name}
                        id={`grad-${spec.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor={spec.color} stopOpacity={spec.fillOpacity ?? 0.16} />
                        <stop offset="100%" stopColor={spec.color} stopOpacity={0.01} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(t: number) => formatClock(t).slice(0, 5)}
                    stroke="var(--subtle)"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    stroke="var(--subtle)"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(v: number) => formatValue(v)}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
                    contentStyle={{
                      background: "var(--surface-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 11,
                      boxShadow: "var(--shadow-pop)",
                      color: "var(--foreground)",
                    }}
                    labelFormatter={(t) => formatClock(Number(t))}
                    formatter={(val, name) => [
                      val === null || val === undefined ? "—" : `${formatValue(Number(val))} ${unit}`,
                      String(name),
                    ]}
                  />
                  {seriesSpecs.map((spec) => (
                    <Area
                      key={spec.name}
                      type="monotone"
                      dataKey={spec.name}
                      stroke={spec.color}
                      strokeWidth={spec.dashed ? 1.5 : 2}
                      strokeDasharray={spec.dashed ? "4 4" : undefined}
                      fill={`url(#grad-${spec.name.replace(/[^a-zA-Z0-9_-]/g, "_")})`}
                      stackId={stacked ? "1" : undefined}
                      connectNulls={false}
                      isAnimationActive={false}
                      activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 1.5, fill: spec.color }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* SRE Right Stat Legend Table (1 col) */}
          <div className="lg:col-span-1 rounded-lg border border-border/80 bg-surface-elevated/40 p-2.5 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted pb-1 border-b border-border/60">
              <span>Series</span>
              <div className="flex items-center gap-3">
                <span>avg</span>
                <span>curr</span>
              </div>
            </div>
            {seriesSpecs.map((spec) => {
              const s = stats[spec.name];
              return (
                <div key={spec.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 min-w-0 pr-2">
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ background: spec.color }}
                    />
                    <span className="truncate text-foreground font-medium text-[11px]" title={spec.name}>
                      {spec.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums shrink-0">
                    <span className="text-muted">
                      {s?.avg !== null && s?.avg !== undefined ? formatValue(s.avg) : "—"}
                    </span>
                    <span className="font-semibold text-foreground">
                      {s?.current !== null && s?.current !== undefined ? formatValue(s.current) : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
