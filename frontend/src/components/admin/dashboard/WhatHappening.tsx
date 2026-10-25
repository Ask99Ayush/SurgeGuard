"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  XCircle,
} from "lucide-react";
import { usePolling } from "@/hooks/usePolling";
import { Card, CardHeader, cn } from "@/components/ui/primitives";
import { formatRelative } from "@/lib/format";
import type { BackendsResponse, EventItem, Overview } from "@/components/admin/types";

/* ─── Event metadata ─────────────────────────── */
const META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  backend_down: { label: "Backend Health Check Failed", icon: XCircle, color: "text-danger" },
  backend_recovered: { label: "Backend Restored", icon: CheckCircle2, color: "text-success" },
  admission_paused: { label: "Admission Paused", icon: AlertTriangle, color: "text-warning" },
  admission_auto_paused: { label: "Admission Auto-Paused", icon: AlertTriangle, color: "text-danger" },
  admission_resumed: { label: "Admission Resumed", icon: CheckCircle2, color: "text-success" },
  admission_auto_resumed: { label: "Admission Auto-Resumed", icon: CheckCircle2, color: "text-success" },
  worker_leader: { label: "Worker Leader Changed", icon: Info, color: "text-accent" },
  rate_limit_exceeded: { label: "Rate Limit Hit", icon: AlertTriangle, color: "text-warning" },
};

/* ─── Collapse repeated events ─────────────────── */
interface CollapsedEvent {
  event: EventItem;
  count: number;
}

function collapseEvents(events: EventItem[]): CollapsedEvent[] {
  const out: CollapsedEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.event.kind === e.kind) {
      last.count++;
    } else {
      out.push({ event: e, count: 1 });
    }
  }
  return out;
}

/* ─── Single event row ──────────────────────── */
function EventRow({
  event,
  count,
  isRecovered = false,
}: CollapsedEvent & { isRecovered?: boolean }) {
  const meta = META[event.kind];
  const Icon = meta?.icon ?? Info;
  const label = meta?.label ?? event.kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const color = meta?.color ?? "text-muted";
  const isErrorKind = event.kind === "backend_down" || event.kind === "admission_auto_paused" || event.level === "error";

  return (
    <li
      className={cn(
        "flex items-start gap-3 py-2.5",
        isErrorKind && !isRecovered && "rounded-xl border border-danger/20 bg-danger/5 px-2.5",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", color)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
          <span>{label}</span>
          {count > 1 && (
            <span className="text-xs font-normal text-muted">
              ×{count}
            </span>
          )}
          {isRecovered && (
            <span className="rounded-md border border-success/30 bg-success/10 px-1.5 py-0.2 text-[10px] font-medium text-success">
              Recovered
            </span>
          )}
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted">{event.message}</p>
      </div>
      <time
        dateTime={new Date(event.ts_ms).toISOString()}
        className="shrink-0 text-xs tabular-nums text-muted"
      >
        {formatRelative(event.ts_ms)}
      </time>
    </li>
  );
}

/* ─── Full drawer list ────────────────────────── */
function AllEventsDrawer({
  events,
  isBackendRecovered,
  onClose,
}: {
  events: EventItem[];
  isBackendRecovered: (e: EventItem) => boolean;
  onClose: () => void;
}) {
  const [severity, setSeverity] = useState<"all" | "alerts">("all");
  const filtered = severity === "alerts"
    ? events.filter((e) => e.level === "error" || e.kind === "backend_down" || e.kind === "admission_auto_paused")
    : events;
  const collapsed = collapseEvents(filtered);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <button
        type="button"
        aria-label="Close events drawer"
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 flex h-full max-h-[80vh] w-full max-w-sm flex-col rounded-t-2xl border border-border bg-surface sm:max-h-full sm:rounded-l-2xl sm:rounded-tr-none">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">All Events</h2>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs">
              {(["all", "alerts"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium capitalize transition-colors",
                    severity === s ? "bg-surface-elevated text-foreground" : "text-muted hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-elevated"
            >
              ✕<span className="sr-only">Close</span>
            </button>
          </div>
        </div>
        <ol className="flex-1 divide-y divide-border overflow-y-auto px-4 py-2">
          {collapsed.length === 0 ? (
            <li className="py-8 text-center text-sm text-muted">
              No events to show
            </li>
          ) : (
            collapsed.map((item, i) => (
              <EventRow
                key={`${item.event.ts_ms}-${i}`}
                {...item}
                isRecovered={isBackendRecovered(item.event)}
              />
            ))
          )}
        </ol>
      </div>
    </div>
  );
}

export interface ActiveIncident {
  id: string;
  title: string;
  detail: string;
  severity: "danger" | "warning";
}

/* ─── WhatHappening (exported) ─────────────────── */
export function WhatHappening({
  overview = null,
  backends = null,
}: {
  overview?: Overview | null;
  backends?: BackendsResponse | null;
} = {}) {
  const poll = usePolling<EventItem[]>("/api/admin/events?limit=100", 5_000);
  const events = poll.data ?? [];
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Compute ACTUAL ACTIVE ALERTS from live system state rather than historical log entries
  const activeAlerts: ActiveIncident[] = [];

  if (backends?.items) {
    const downBackends = backends.items.filter((b) => b.healthy === false);
    for (const b of downBackends) {
      activeAlerts.push({
        id: `backend-${b.name}`,
        title: `Backend ${b.name} Health Check Failed`,
        detail: b.last_error ?? "Consecutive health checks exceeded failure threshold",
        severity: "danger",
      });
    }
  } else if (overview && overview.backends.healthy < overview.backends.total) {
    activeAlerts.push({
      id: "backends-degraded",
      title: `${overview.backends.total - overview.backends.healthy} Origin Node(s) Unhealthy`,
      detail: "Traffic admission is operating in reduced capacity mode",
      severity: "danger",
    });
  }

  if (overview?.admission.auto_paused) {
    activeAlerts.push({
      id: "admission-auto-paused",
      title: "Admission Auto-Paused",
      detail: "All origin backends are unhealthy; admission halted to protect origins",
      severity: "danger",
    });
  } else if (overview?.admission.paused) {
    activeAlerts.push({
      id: "admission-paused",
      title: "Admission Manually Paused",
      detail: "Operator has paused new visitor admissions",
      severity: "warning",
    });
  }

  if (overview && !overview.redis.ok) {
    activeAlerts.push({
      id: "redis-offline",
      title: "Redis State Store Offline",
      detail: "Queue service unreachable; proxy is failing closed",
      severity: "danger",
    });
  }

  if (overview && !overview.worker.alive) {
    activeAlerts.push({
      id: "worker-offline",
      title: "Admission Worker Daemon Offline",
      detail: "Worker heartbeat expired; queue processing halted",
      severity: "danger",
    });
  }

  // Check if a historical backend_down event is now recovered
  function isBackendRecovered(e: EventItem): boolean {
    if (e.kind !== "backend_down") return false;
    // Check if the backend is currently healthy
    if (backends?.items) {
      const match = backends.items.find((b) => e.message.includes(b.name));
      if (match) return match.healthy === true;
    }
    if (overview && overview.backends.healthy === overview.backends.total && overview.backends.total > 0) {
      return true;
    }
    // Also check if there's a subsequent backend_recovered event
    const laterRecovery = events.some(
      (other) => other.kind === "backend_recovered" && other.ts_ms >= e.ts_ms,
    );
    return laterRecovery;
  }

  const recent = events.slice(0, 5);
  const collapsed = collapseEvents(recent);

  return (
    <>
      <Card className="flex flex-col">
        <CardHeader
          title="What's happening"
          description="Recent operational events and current incident alerts."
          action={
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              View all <ArrowRight className="size-3" />
            </button>
          }
        />
        <div className="flex flex-1 flex-col px-5 pb-5 pt-2">
          {/* Active alerts banner: ONLY shows when an alert is genuinely active right now */}
          {activeAlerts.length > 0 && (
            <div className="mb-3 rounded-xl border border-danger/30 bg-danger/8 px-3.5 py-2.5">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  {activeAlerts.length} active alert{activeAlerts.length !== 1 ? "s" : ""}
                </p>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-danger/80">
                  Active Incident
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {activeAlerts.map((a) => (
                  <li key={a.id} className="text-xs">
                    <span className="font-semibold text-foreground">{a.title}</span> —{" "}
                    <span className="text-muted">{a.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Genuine No-Alerts Reassurance: Shown when all systems are healthy */}
          {activeAlerts.length === 0 && (
            <div className="mb-3 flex items-center justify-between rounded-xl border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="size-3.5" aria-hidden />
                All systems normal · No active alerts
              </span>
              <span className="text-[11px] text-subtle">
                Historical event log below
              </span>
            </div>
          )}

          {/* Event Stream */}
          {poll.status === "loading" ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-surface-elevated" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
              <CheckCircle2 className="size-6 text-success" aria-hidden />
              <p className="text-sm font-medium text-foreground">Quiet right now</p>
              <p className="text-xs text-muted">
                State changes, backend probe alerts, and admission events will appear here.
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-border">
              {collapsed.map((item, i) => (
                <EventRow
                  key={`${item.event.ts_ms}-${i}`}
                  {...item}
                  isRecovered={isBackendRecovered(item.event)}
                />
              ))}
            </ol>
          )}
        </div>
      </Card>

      {drawerOpen && (
        <AllEventsDrawer
          events={events}
          isBackendRecovered={isBackendRecovered}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}
