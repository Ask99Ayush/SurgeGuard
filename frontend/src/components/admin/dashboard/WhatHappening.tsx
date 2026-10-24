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
import type { EventItem } from "@/components/admin/types";

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

const ALERT_KINDS = new Set(["backend_down", "admission_auto_paused"]);

function isAlert(e: EventItem) {
  return ALERT_KINDS.has(e.kind) || e.level === "error";
}

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
function EventRow({ event, count }: CollapsedEvent) {
  const meta = META[event.kind];
  const Icon = meta?.icon ?? Info;
  const label = meta?.label ?? event.kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const color = meta?.color ?? "text-muted";
  const alert = isAlert(event);

  return (
    <li
      className={cn(
        "flex items-start gap-3 py-2.5",
        alert && "rounded-xl border border-danger/20 bg-danger/5 px-2.5",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", color)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {label}
          {count > 1 && (
            <span className="ml-1.5 text-xs font-normal text-muted">
              ×{count}
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
  onClose,
}: {
  events: EventItem[];
  onClose: () => void;
}) {
  const [severity, setSeverity] = useState<"all" | "alerts">("all");
  const filtered = severity === "alerts" ? events.filter(isAlert) : events;
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
              <EventRow key={`${item.event.ts_ms}-${i}`} {...item} />
            ))
          )}
        </ol>
      </div>
    </div>
  );
}

/* ─── WhatHappening (exported) ─────────────────── */
export function WhatHappening() {
  const poll = usePolling<EventItem[]>("/api/admin/events?limit=100", 5_000);
  const events = poll.data ?? [];
  const [drawerOpen, setDrawerOpen] = useState(false);

  const alerts = events.filter(isAlert);
  const recent = events.slice(0, 5);
  const collapsed = collapseEvents(recent);

  return (
    <>
      <Card className="flex flex-col">
        <CardHeader
          title="What's happening"
          description="Latest 5 system events in plain language."
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
          {/* Active alerts pinned at top */}
          {alerts.length > 0 && (
            <div className="mb-3 rounded-xl border border-danger/30 bg-danger/8 px-3 py-2">
              <p className="text-xs font-semibold text-danger">
                {alerts.length} active alert{alerts.length !== 1 ? "s" : ""}
              </p>
              <ul className="mt-1 space-y-0.5">
                {alerts.slice(0, 2).map((e, i) => (
                  <li key={i} className="text-xs text-muted">
                    {META[e.kind]?.label ?? e.kind} — {formatRelative(e.ts_ms)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* No alerts reassurance */}
          {alerts.length === 0 && events.length > 0 && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="size-3.5" aria-hidden />
              No active alerts
            </p>
          )}

          {/* Events */}
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
                <EventRow key={`${item.event.ts_ms}-${i}`} {...item} />
              ))}
            </ol>
          )}
        </div>
      </Card>

      {drawerOpen && (
        <AllEventsDrawer events={events} onClose={() => setDrawerOpen(false)} />
      )}
    </>
  );
}
