"use client";

import { usePolling } from "@/hooks/usePolling";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatNumber, formatMs } from "@/lib/format";
import type { Overview, SeriesResponse } from "@/components/admin/types";

export function FourStats({ overview }: { overview: Overview | null }) {
  const waitP50 = usePolling<SeriesResponse>(
    "/api/metrics/instant?name=wait_p50_seconds",
    10_000,
  );
  const waitP95 = usePolling<SeriesResponse>(
    "/api/metrics/instant?name=wait_p95_seconds",
    10_000,
  );

  const p50v = waitP50.data?.series[0]?.points[0]?.v ?? null;
  const p95v = waitP95.data?.series[0]?.points[0]?.v ?? null;

  const loading = overview === null;
  const waiting = overview?.queue.waiting ?? 0;
  const admittedActive = overview?.queue.admitted_active ?? 0;
  const measuredRate = overview?.admission.measured_rate_per_s ?? 0;
  const configuredRate = overview?.admission.configured_rate ?? 0;

  const healthyBackends = overview?.backends.healthy ?? 0;
  const totalBackends = overview?.backends.total ?? 0;
  const backendsKnown = overview !== null && overview.backends.reporting > 0;

  return (
    <section aria-label="Key operational statistics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* 1. Waiting */}
      <StatCard
        label="Waiting"
        loading={loading}
        value={formatNumber(waiting)}
        description={`${formatNumber(admittedActive)} currently active`}
        tone={waiting > 50 ? "warning" : "default"}
      />

      {/* 2. Admitted per second */}
      <StatCard
        label="Admitted / sec"
        loading={loading}
        value={formatNumber(measuredRate, 1)}
        unit="/s"
        description={`Configured: ${configuredRate}/s target`}
        tone={measuredRate > 0 ? "success" : "default"}
      />

      {/* 3. Avg wait */}
      <StatCard
        label="Avg wait"
        loading={waitP50.status === "loading" && loading}
        value={p50v !== null ? formatMs(p50v * 1000) : "—"}
        description={
          p50v === null
            ? "No recent queue delay"
            : p95v !== null
              ? `p95 wait: ${formatMs(p95v * 1000)}`
              : "Measured wait time"
        }
      />

      {/* 4. Healthy backends */}
      <StatCard
        label="Healthy backends"
        loading={loading}
        value={backendsKnown ? `${healthyBackends} / ${totalBackends}` : "—"}
        badge={
          backendsKnown ? (
            <StatusBadge
              status={
                healthyBackends === 0
                  ? "down"
                  : healthyBackends < totalBackends
                    ? "degraded"
                    : "healthy"
              }
            />
          ) : undefined
        }
        description={
          !backendsKnown
            ? "Waiting for probe data"
            : healthyBackends === totalBackends
              ? "All instances passing health probes"
              : `${totalBackends - healthyBackends} backend instance down`
        }
        tone={
          !backendsKnown
            ? "default"
            : healthyBackends === 0
              ? "danger"
              : healthyBackends < totalBackends
                ? "warning"
                : "default"
        }
      />
    </section>
  );
}
