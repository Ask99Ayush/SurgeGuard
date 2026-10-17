"use client";

import { PageHeader } from "@/components/admin/AdminShell";
import { EventList } from "@/components/admin/EventList";
import type { BackendsResponse, SeriesResponse } from "@/components/admin/types";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
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

  return (
    <>
      <PageHeader
        title="Backends"
        description="Origin instances and their health, from active and passive checks."
      />
      <Card>
        <CardHeader
          title="Instances"
          description={
            backends.data
              ? backends.data.checks_running
                ? `Checked every ${backends.data.interval_seconds}s by the admission worker`
                : "Worker not running; health data may be stale"
              : undefined
          }
        />
        <div className="pt-3">
          {backends.status === "loading" ? (
            <StateView kind="loading" />
          ) : !backends.data ? (
            <StateView kind={backends.status === "disconnected" ? "disconnected" : "error"} onRetry={backends.refresh} />
          ) : backends.data.items.length === 0 ? (
            <StateView kind="empty" title="No backends configured" message="Set BACKEND_URLS in .env." />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs text-subtle">
                  <tr className="border-y border-border">
                    {["Instance", "Health", "Last check", "Check latency", "Failures", "Request rate", "p95 latency", "Last change"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {backends.data.items.map((b) => {
                    const rate = rpsMap.get(b.name);
                    const latency = p95Map.get(b.name);
                    return (
                      <tr key={b.name}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{b.name}</p>
                          <p className="font-mono text-xs text-subtle">{b.url}</p>
                        </td>
                        <td className="px-4 py-3">
                          {b.healthy === null ? (
                            <Badge>Unknown</Badge>
                          ) : b.healthy ? (
                            <Badge tone="success" dot>
                              Healthy
                            </Badge>
                          ) : (
                            <Badge tone="danger" dot>
                              Down
                            </Badge>
                          )}
                          {b.last_error ? <p className="mt-1 font-mono text-xs text-danger">{b.last_error}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-muted">{formatRelative(b.last_check_ms)}</td>
                        <td className="px-4 py-3 tabular-nums text-muted">{formatMs(b.last_latency_ms ?? null)}</td>
                        <td className="px-4 py-3 tabular-nums text-muted">{b.consecutive_failures ?? "—"}</td>
                        <td className="px-4 py-3 tabular-nums text-muted">
                          {!promOk ? "unavailable" : rate === undefined || rate === null ? "no data" : `${formatNumber(rate, 1)}/s`}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted">
                          {!promOk ? "unavailable" : latency === undefined || latency === null ? "no data" : formatMs(latency * 1000)}
                        </td>
                        <td className="px-4 py-3 text-muted">{b.last_change_ms ? formatRelative(b.last_change_ms) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
      <div className="mt-3">
        <EventList
          title="Failure and recovery events"
          filter={(e) => e.kind.startsWith("backend_") || e.kind.startsWith("admission_auto")}
        />
      </div>
    </>
  );
}
