"use client";

import { type ReactNode, useState } from "react";
import { HelpCircle } from "lucide-react";
import { usePolling } from "@/hooks/usePolling";
import { cn, Skeleton } from "@/components/ui/primitives";
import { formatNumber, formatMs } from "@/lib/format";
import type { Overview, SeriesResponse } from "@/components/admin/types";

/* ─── Tooltip ────────────────────────────────── */
function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative ml-1 inline-flex">
      <button
        type="button"
        aria-label="Explain this metric"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center text-subtle hover:text-muted"
      >
        <HelpCircle className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-muted shadow-[var(--shadow-pop)]"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* ─── Mini sparkline (SVG, no recharts dep in this card) ── */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 0.001);
  const H = 28;
  const W = 64;
  const step = W / (points.length - 1);
  const coords = points
    .map((v, i) => `${i * step},${H - (v / max) * H}`)
    .join(" ");
  const area = `${coords} ${W},${H} 0,${H}`;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0"
      style={{ width: W, height: H }}
    >
      <polygon points={area} fill={color} opacity={0.15} />
      <polyline points={coords} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ─── Trend arrow ──────────────────────────── */
function Trend({ points }: { points: number[] }) {
  if (points.length < 4) return null;
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

/* ─── Site-health rating ─────────────────────── */
type HealthRating = "Great" | "OK" | "Slow" | "Failing";

function rateHealth(errorRatio: number | null, p95: number | null): HealthRating {
  if (errorRatio !== null && errorRatio > 0.1) return "Failing";
  if (errorRatio !== null && errorRatio > 0.02) return "Slow";
  if (p95 !== null && p95 > 1.5) return "Slow";
  if (p95 !== null && p95 > 0.5) return "OK";
  return "Great";
}

const ratingStyle: Record<HealthRating, string> = {
  Great: "text-success",
  OK: "text-foreground",
  Slow: "text-warning",
  Failing: "text-danger",
};

/* ─── One number card ────────────────────────── */
function NumberCard({
  label,
  tooltip,
  value,
  sub,
  trend,
  sparkPoints,
  sparkColor,
  loading,
  children,
}: {
  label: string;
  tooltip: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: ReactNode;
  sparkPoints?: number[];
  sparkColor?: string;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="keycap flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">
          {label}
          <Tip text={tooltip} />
        </p>
        {trend}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          {loading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <div className="text-[30px] font-semibold leading-none tabular-nums tracking-[-0.03em]">
              {value}
            </div>
          )}
          {sub && <p className="mt-1.5 text-xs text-muted">{sub}</p>}
          {children}
        </div>
        {sparkPoints && sparkPoints.length > 1 && sparkColor && (
          <Sparkline points={sparkPoints} color={sparkColor} />
        )}
      </div>
    </div>
  );
}

/* ─── ThreeNumbers (exported) ─────────────────── */
export function ThreeNumbers({ overview }: { overview: Overview | null }) {
  // Queue series for sparkline
  const queueSeries = usePolling<SeriesResponse>(
    "/api/metrics/range?name=queue_length&range=15m",
    15_000,
  );
  const waitP50 = usePolling<SeriesResponse>(
    "/api/metrics/instant?name=wait_p50_seconds",
    10_000,
  );
  const waitP95 = usePolling<SeriesResponse>(
    "/api/metrics/instant?name=wait_p95_seconds",
    10_000,
  );
  const errorRatio = usePolling<SeriesResponse>(
    "/api/metrics/instant?name=origin_error_ratio",
    10_000,
  );
  const p95Latency = usePolling<SeriesResponse>(
    "/api/metrics/instant?name=origin_p95_seconds",
    10_000,
  );

  const queuePoints = (queueSeries.data?.series[0]?.points ?? [])
    .map((p) => p.v ?? 0);
  const p50v = waitP50.data?.series[0]?.points[0]?.v ?? null;
  const p95v = waitP95.data?.series[0]?.points[0]?.v ?? null;
  const ratio = errorRatio.data?.series[0]?.points[0]?.v ?? null;
  const p95lat = p95Latency.data?.series[0]?.points[0]?.v ?? null;
  const rating = rateHealth(ratio, p95lat);

  const loading = overview === null;

  return (
    <section aria-label="Three numbers that matter" className="grid gap-3 sm:grid-cols-3">
      {/* 1. Waiting now */}
      <NumberCard
        label="Waiting now"
        tooltip="How many visitors are currently in the virtual queue. A bigger number means more surge; zero means everything is flowing freely."
        loading={loading}
        value={
          <span>{overview ? formatNumber(overview.queue.waiting) : "—"}</span>
        }
        sub={overview ? `${formatNumber(overview.queue.admitted_active)} admitted and active` : undefined}
        trend={<Trend points={queuePoints} />}
        sparkPoints={queuePoints}
        sparkColor="var(--warning)"
      />

      {/* 2. Typical wait */}
      <NumberCard
        label="Typical wait"
        tooltip="The median time (p50) a visitor spends in the waiting room before being admitted. p95 shows the experience of the slowest 1 in 20."
        loading={waitP50.status === "loading"}
        value={
          p50v !== null ? formatMs(p50v * 1000) : (
            <span className="text-xl font-medium text-subtle">—</span>
          )
        }
        sub={
          p50v === null
            ? "Not enough data yet"
            : p95v !== null
              ? `p95: ${formatMs(p95v * 1000)}`
              : undefined
        }
      />

      {/* 3. Site health */}
      <NumberCard
        label="Site health"
        tooltip="A combined rating from error rate (5xx responses) and p95 backend latency. Great = fast and error-free, Failing = high error rate."
        loading={errorRatio.status === "loading"}
        value={
          <span className={ratingStyle[rating]}>{rating}</span>
        }
        sub={
          ratio !== null || p95lat !== null
            ? [
                ratio !== null ? `${(ratio * 100).toFixed(1)}% errors` : null,
                p95lat !== null ? `${(p95lat * 1000).toFixed(0)}ms p95` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "No backend traffic yet"
        }
      />
    </section>
  );
}
