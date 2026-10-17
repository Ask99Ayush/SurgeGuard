"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { MetricChart } from "@/components/admin/MetricChart";
import { RangeSelect } from "@/components/admin/RangeSelect";
import type { PromStatus } from "@/components/admin/types";
import { Badge, ButtonLink, Card, CardHeader, StatusDot } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { formatRelative } from "@/lib/format";
import type { RangeName } from "@/lib/promql";

export function MonitoringView({ grafanaUrl }: { grafanaUrl: string | null }) {
  const [range, setRange] = useState<RangeName>("1h");
  const status = usePolling<PromStatus>("/api/metrics/status", 10_000);

  return (
    <>
      <PageHeader
        title="Monitoring"
        description="Scrape targets, alerts and service charts from Prometheus."
        actions={
          <>
            <RangeSelect value={range} onChange={setRange} />
            {grafanaUrl ? (
              <ButtonLink href={grafanaUrl} external size="sm">
                Grafana <ExternalLink className="size-3.5" aria-hidden />
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Service health" description="Prometheus scrape targets" />
          <div className="px-5 pb-4 pt-2">
            {status.status === "loading" ? (
              <StateView kind="loading" compact />
            ) : !status.data ? (
              <StateView kind={status.status === "disconnected" ? "disconnected" : "error"} title="Prometheus unavailable" compact onRetry={status.refresh} />
            ) : status.data.targets.length === 0 ? (
              <StateView kind="empty" title="No scrape targets" compact />
            ) : (
              <ul className="divide-y divide-border">
                {status.data.targets.map((t) => (
                  <li key={`${t.job}-${t.instance}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <StatusDot tone={t.health === "up" ? "success" : t.health === "down" ? "danger" : "neutral"} />
                      <span className="font-medium">{t.job}</span>
                      <span className="truncate font-mono text-xs text-subtle">{t.instance}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted" title={t.lastError ?? undefined}>
                      {t.health === "up" ? `scraped ${formatRelative(Date.parse(t.lastScrape))}` : (t.lastError ?? t.health)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Alerts" description="Pending and firing rules" />
          <div className="px-5 pb-4 pt-2">
            {status.status === "loading" ? (
              <StateView kind="loading" compact />
            ) : !status.data ? (
              <StateView kind={status.status === "disconnected" ? "disconnected" : "error"} title="Prometheus unavailable" compact />
            ) : status.data.alerts.length === 0 ? (
              <StateView kind="empty" title="No alerts" message="All alert rules are inactive." compact />
            ) : (
              <ul className="divide-y divide-border">
                {status.data.alerts.map((a) => (
                  <li key={`${a.name}-${a.activeAt}`} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{a.name}</span>
                      <Badge tone={a.state === "firing" ? (a.severity === "critical" ? "danger" : "warning") : "neutral"} dot>
                        {a.state}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{a.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <MetricChart title="Origin request rate" description="Requests/s reaching the demo origins" query="origin_rps" range={range} />
        <MetricChart
          title="Origin error ratio"
          description="Share of 5xx responses from origins"
          query="origin_error_ratio"
          range={range}
          color="var(--danger)"
          format={(v) => `${(v * 100).toFixed(1)}%`}
        />
        <MetricChart
          title="Origin p95 latency"
          description="Seconds, inside the origin"
          query="origin_p95_seconds"
          range={range}
          color="var(--warning)"
          format={(v) => `${v.toFixed(2)}s`}
        />
        <MetricChart
          title="Queue wait p95"
          description="Join → admission, seconds"
          query="wait_p95_seconds"
          range={range}
          format={(v) => `${v.toFixed(0)}s`}
        />
        <MetricChart
          title="Token rejections"
          description="Invalid / expired / revoked tokens per second"
          query="token_rejections"
          range={range}
          color="var(--danger)"
          format={(v) => v.toFixed(2)}
        />
        <MetricChart
          title="Edge request rate"
          description="All requests handled by Nginx"
          query="edge_rps"
          range={range}
          color="var(--success)"
          format={(v) => v.toFixed(0)}
        />
      </div>
    </>
  );
}
