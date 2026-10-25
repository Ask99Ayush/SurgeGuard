"use client";

import { useState } from "react";
import { Activity, ChevronDown, ExternalLink, Server } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EventList } from "@/components/admin/EventList";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { BackendsResponse, SeriesResponse } from "@/components/admin/types";
import { Button, Card } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { formatMs, formatNumber, formatRelative } from "@/lib/format";

function byOrigin(data: SeriesResponse | null): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const s of data?.series ?? []) {
    const name = s.labels.origin;
    if (name) map.set(name, s.points[0]?.v ?? null);
  }
  return map;
}

export function BackendsView() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const backends = usePolling<BackendsResponse>("/api/admin/backends", 3000);
  const rps = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_rps_by_origin", 10_000);
  const p95 = usePolling<SeriesResponse>("/api/metrics/instant?name=origin_p95_by_origin", 10_000);

  const rpsMap = byOrigin(rps.data);
  const p95Map = byOrigin(p95.data);
  const promOk = rps.status === "success";

  const items = backends.data?.items ?? [];
  const healthyCount = items.filter((b) => b.healthy).length;
  const totalCount = items.length;
  const isAllHealthy = totalCount > 0 && healthyCount === totalCount;

  // Average probe latency across healthy nodes
  const probeLatencies = items.map((b) => b.last_latency_ms).filter((l): l is number => l !== null && l !== undefined);
  const avgProbeLatency = probeLatencies.length ? probeLatencies.reduce((a, b) => a + b, 0) / probeLatencies.length : null;

  return (
    <>
      <PageHeader
        title="Protected Backends"
        description="Origin servers shielded by SurgeGuard with automatic health probes and load balancing."
        breadcrumbs={[{ label: "Operations", href: "/dashboard" }, { label: "Backends" }]}
        actions={
          <a
            href="/grafana/d/surgeguard-backends"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
          >
            <span>Backends in Grafana</span>
            <ExternalLink className="size-3.5" />
          </a>
        }
      />

      {/* SUMMARY STAT CARDS */}
      <section aria-label="Backend Pool Summary" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total Backends"
          loading={backends.status === "loading"}
          value={totalCount ? formatNumber(totalCount) : "—"}
          description="Configured origin instances"
        />
        <StatCard
          label="Cluster Health"
          loading={backends.status === "loading"}
          value={totalCount ? `${healthyCount} / ${totalCount}` : "—"}
          badge={
            totalCount > 0 ? (
              <StatusBadge status={healthyCount === 0 ? "down" : isAllHealthy ? "healthy" : "degraded"} />
            ) : undefined
          }
          description={
            !totalCount
              ? "Checking probes"
              : isAllHealthy
                ? "All origins responding normally"
                : `${totalCount - healthyCount} backend node offline`
          }
          tone={!totalCount ? "default" : isAllHealthy ? "success" : healthyCount === 0 ? "danger" : "warning"}
        />
        <StatCard
          label="Probe Latency"
          loading={backends.status === "loading"}
          value={avgProbeLatency !== null ? `${avgProbeLatency.toFixed(1)}` : "—"}
          unit="ms"
          description={
            backends.data?.interval_seconds
              ? `Checked every ${backends.data.interval_seconds}s by worker`
              : "Roundtrip health check response"
          }
        />
      </section>

      {/* ORIGIN ENTITY CARDS: ONE CARD PER BACKEND */}
      <section aria-label="Configured Origin Instances" className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Origin Nodes</h2>
            <p className="text-xs text-muted">Status, active workload, and last health verification</p>
          </div>
          {backends.data ? (
            <span className="text-xs text-subtle">
              Updated {formatRelative(backends.updatedAt)}
            </span>
          ) : null}
        </div>

        {backends.status === "loading" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl border border-border bg-surface p-5" />
            ))}
          </div>
        ) : !backends.data ? (
          <StateView
            kind={backends.status === "disconnected" ? "disconnected" : "error"}
            title="Backend state unreachable"
            onRetry={backends.refresh}
          />
        ) : items.length === 0 ? (
          <StateView kind="empty" title="No backends configured" message="Set BACKEND_URLS in .env to register origin nodes." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((b) => {
              const rate = rpsMap.get(b.name);
              const latency = p95Map.get(b.name);
              const isHealthy = b.healthy === true;

              return (
                <Card key={b.name} className="p-5 flex flex-col justify-between transition-all hover:border-border-strong">
                  <div>
                    {/* Header: Name, Host, Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Server className="size-4 text-accent shrink-0" />
                          <h3 className="text-base font-semibold text-foreground truncate">{b.name}</h3>
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-subtle truncate" title={b.url}>
                          {b.url}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <StatusBadge
                          status={b.healthy === null ? undefined : isHealthy ? "healthy" : "down"}
                          label={b.healthy === null ? "Unknown" : undefined}
                        />
                      </div>
                    </div>

                    {b.last_error ? (
                      <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
                        {b.last_error}
                      </div>
                    ) : null}

                    {/* Simple metrics: Load and Last Check */}
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
                      <div>
                        <p className="text-subtle font-medium">Inflow Load</p>
                        <p className="mt-0.5 font-semibold text-foreground">
                          {!promOk ? "—" : rate === undefined || rate === null || rate === 0 ? "Idle" : `${formatNumber(rate, 1)} req/s`}
                        </p>
                      </div>
                      <div>
                        <p className="text-subtle font-medium">Response Time</p>
                        <p className="mt-0.5 font-semibold text-foreground">
                          {b.last_latency_ms !== null && b.last_latency_ms !== undefined
                            ? formatMs(b.last_latency_ms)
                            : latency !== undefined && latency !== null
                              ? formatMs(latency * 1000)
                              : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Clean status footer sentence */}
                  <div className="mt-3 border-t border-border/70 pt-2.5 flex items-center justify-between text-[11px] text-muted">
                    <span>
                      {isHealthy ? "Passing regular health checks" : "Failed last probe"}
                    </span>
                    <span className="text-subtle">
                      {b.last_check_ms ? `Checked ${formatRelative(b.last_check_ms)}` : "Active"}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* COLLAPSIBLE ADVANCED PROBING LOGS & EVENT STREAM */}
      <div className="rounded-[var(--radius-card)] border border-border bg-surface/60 overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-accent" />
            <div>
              <p className="text-sm font-semibold text-foreground">Backend Health Audit Log</p>
              <p className="text-xs text-muted">Historical failovers, recoveries, and probe transitions</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="text-xs gap-1.5"
          >
            <span>{showAdvanced ? "Hide Log" : "View Probe Log"}</span>
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
          </Button>
        </div>

        {showAdvanced && (
          <div className="border-t border-border p-4 animate-in fade-in duration-200">
            <EventList filter={(e) => e.kind.startsWith("backend_")} />
          </div>
        )}
      </div>
    </>
  );
}
