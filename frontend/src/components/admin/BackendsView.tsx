"use client";

import { Clock, ExternalLink, Server } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { EventList } from "@/components/admin/EventList";
import { StatTile } from "@/components/admin/StatTile";
import type { BackendsResponse, SeriesResponse } from "@/components/admin/types";
import { Badge, Card } from "@/components/ui/primitives";
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
        description="Origin instances shielded by SurgeGuard. Active health probes and real-time load distribution."
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

      {/* SUMMARY STAT TILES */}
      <section aria-label="Backend Pool Summary" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Total Instances"
          loading={backends.status === "loading"}
          value={totalCount ? formatNumber(totalCount) : null}
          context="Configured origin nodes"
        />
        <StatTile
          label="Healthy Pool"
          loading={backends.status === "loading"}
          value={totalCount ? `${healthyCount}/${totalCount}` : null}
          emphasis={!totalCount ? "default" : isAllHealthy ? "default" : healthyCount === 0 ? "danger" : "warning"}
          context={isAllHealthy ? "All instances passing probes" : `${totalCount - healthyCount} nodes failing checks`}
        />
        <StatTile
          label="Probe Latency"
          loading={backends.status === "loading"}
          value={avgProbeLatency !== null ? `${avgProbeLatency.toFixed(1)}` : null}
          unit="ms"
          context="Average roundtrip check latency"
        />
        <StatTile
          label="Probing Cadence"
          loading={backends.status === "loading"}
          value={backends.data?.interval_seconds ? `${backends.data.interval_seconds}` : null}
          unit="s"
          context={backends.data?.checks_running ? "Admission worker active" : "Probing daemon inactive"}
        />
      </section>

      {/* ORIGIN ENTITY CARDS */}
      <section aria-label="Configured Origin Instances" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Origin Nodes &amp; Workload</h2>
            <p className="text-xs text-muted">Active HTTP health checks and telemetry metrics per instance</p>
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
              <div key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-surface p-5" />
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
                <Card key={b.name} className="flex flex-col justify-between p-5 transition-all hover:border-accent/40">
                  <div>
                    {/* Header: Name, Host, Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Server className="size-4 text-accent shrink-0" />
                          <h3 className="text-base font-semibold text-foreground truncate">{b.name}</h3>
                        </div>
                        <p className="mt-1 font-mono text-xs text-subtle truncate" title={b.url}>
                          {b.url}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {b.healthy === null ? (
                          <Badge>Unknown</Badge>
                        ) : isHealthy ? (
                          <Badge tone="success" dot>
                            Healthy
                          </Badge>
                        ) : (
                          <Badge tone="danger" dot>
                            Down
                          </Badge>
                        )}
                      </div>
                    </div>

                    {b.last_error ? (
                      <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
                        {b.last_error}
                      </div>
                    ) : null}

                    {/* Operational Telemetry Grid */}
                    <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4 text-xs">
                      <div>
                        <p className="text-subtle font-medium">Request Inflow</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-foreground">
                          {!promOk ? "—" : rate === undefined || rate === null ? "No traffic" : `${formatNumber(rate, 1)} req/s`}
                        </p>
                      </div>
                      <div>
                        <p className="text-subtle font-medium">p95 Latency</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-foreground">
                          {!promOk ? "—" : latency === undefined || latency === null ? "No traffic" : formatMs(latency * 1000)}
                        </p>
                      </div>
                      <div>
                        <p className="text-subtle font-medium">Probe Latency</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-foreground">
                          {formatMs(b.last_latency_ms ?? null)}
                        </p>
                      </div>
                      <div>
                        <p className="text-subtle font-medium">Failures</p>
                        <p
                          className={`mt-1 font-mono text-sm font-semibold ${
                            b.consecutive_failures && b.consecutive_failures > 0 ? "text-danger" : "text-muted"
                          }`}
                        >
                          {b.consecutive_failures ?? 0}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Footer Timestamps */}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted">
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-3 text-subtle" />
                      Checked {formatRelative(b.last_check_ms)}
                    </span>
                    <span>
                      {b.last_change_ms ? `Last state change: ${formatRelative(b.last_change_ms)}` : "Stable"}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* FAILURE & RECOVERY EVENTS */}
      <section aria-label="Backend Health Transitions">
        <EventList
          title="Backend failure and recovery stream"
          description="Real-time log of health probe transitions, circuit breaks, and auto-pause events."
          filter={(e) => e.kind.startsWith("backend_") || e.kind.startsWith("admission_auto")}
        />
      </section>
    </>
  );
}
