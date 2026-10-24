"use client";

import { Badge, Card, CardHeader, StatusDot, type Tone } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { formatClock, formatRelative } from "@/lib/format";
import type { EventItem } from "./types";

const EVENT_METADATA: Record<string, { title: string; defaultTone: Tone }> = {
  backend_down: { title: "Backend Health Check Failed", defaultTone: "danger" },
  backend_recovered: { title: "Backend Restored to Service", defaultTone: "success" },
  admission_paused: { title: "Admission Manually Paused", defaultTone: "warning" },
  admission_auto_paused: { title: "Admission Auto-Paused (Zero Healthy Backends)", defaultTone: "danger" },
  admission_resumed: { title: "Admission Manually Resumed", defaultTone: "success" },
  admission_auto_resumed: { title: "Admission Auto-Resumed (Backends Restored)", defaultTone: "success" },
  worker_leader: { title: "Worker Acquired Cluster Leader Lock", defaultTone: "accent" },
  rate_limit_exceeded: { title: "App Rate Limit Throttled", defaultTone: "warning" },
};

const levelTone = (level: string, kind: string): Tone => {
  if (EVENT_METADATA[kind]?.defaultTone) return EVENT_METADATA[kind].defaultTone;
  if (level === "error") return "danger";
  if (level === "warning") return "warning";
  return "success";
};

export function EventList({
  title = "Recent operational events",
  description = "Cluster state transitions, backend health changes, and admission events.",
  filter,
  limit = 20,
}: {
  title?: string;
  description?: string;
  filter?: (event: EventItem) => boolean;
  limit?: number;
}) {
  const poll = usePolling<EventItem[]>(`/api/admin/events?limit=${filter ? 200 : limit}`, 5000);
  const events = (poll.data ?? []).filter(filter ?? (() => true)).slice(0, limit);

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="px-5 pb-4 pt-2">
        {poll.status === "loading" ? (
          <StateView kind="loading" compact />
        ) : !poll.data ? (
          <StateView kind={poll.status === "disconnected" ? "disconnected" : "error"} compact onRetry={poll.refresh} />
        ) : events.length === 0 ? (
          <StateView
            kind="empty"
            title="No events recorded"
            message="Cluster is quiet. State changes, backend probe alerts, and admission controls will appear here."
            compact
          />
        ) : (
          <ol className="divide-y divide-border">
            {events.map((event, i) => {
              const meta = EVENT_METADATA[event.kind];
              const tone = levelTone(event.level, event.kind);
              const eventTitle = meta?.title ?? event.kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

              return (
                <li key={`${event.ts_ms}-${i}`} className="flex items-start gap-3 py-3">
                  <span className="mt-1">
                    <StatusDot tone={tone} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{eventTitle}</span>
                      <span className="font-mono text-[10px] text-subtle">({event.kind})</span>
                      {event.level === "error" || event.level === "warning" ? (
                        <Badge tone={tone}>{event.level}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{event.message}</p>
                  </div>
                  <time
                    dateTime={new Date(event.ts_ms).toISOString()}
                    title={formatClock(event.ts_ms)}
                    className="shrink-0 text-xs tabular-nums text-muted"
                  >
                    {formatRelative(event.ts_ms)}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}
