"use client";

import { Card, CardHeader, StatusDot, type Tone } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { formatClock, formatRelative } from "@/lib/format";
import type { EventItem } from "./types";

const levelTone = (level: string): Tone => (level === "error" ? "danger" : level === "warning" ? "warning" : "success");

export function EventList({
  title = "Recent events",
  filter,
  limit = 20,
}: {
  title?: string;
  filter?: (event: EventItem) => boolean;
  limit?: number;
}) {
  const poll = usePolling<EventItem[]>(`/api/admin/events?limit=${filter ? 200 : limit}`, 5000);
  const events = (poll.data ?? []).filter(filter ?? (() => true)).slice(0, limit);

  return (
    <Card>
      <CardHeader title={title} description="Pauses, backend failures and recoveries." />
      <div className="px-5 pb-4 pt-3">
        {poll.status === "loading" ? (
          <StateView kind="loading" compact />
        ) : !poll.data ? (
          <StateView kind={poll.status === "disconnected" ? "disconnected" : "error"} compact onRetry={poll.refresh} />
        ) : events.length === 0 ? (
          <StateView kind="empty" title="No events yet" message="Pausing admission or a backend failure is recorded here." compact />
        ) : (
          <ol className="divide-y divide-border">
            {events.map((event, i) => (
              <li key={`${event.ts_ms}-${i}`} className="flex items-start gap-3 py-2.5">
                <span className="mt-1.5">
                  <StatusDot tone={levelTone(event.level)} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{event.message}</p>
                  <p className="mt-0.5 font-mono text-xs text-subtle">{event.kind}</p>
                </div>
                <time
                  dateTime={new Date(event.ts_ms).toISOString()}
                  title={formatClock(event.ts_ms)}
                  className="shrink-0 text-xs text-muted"
                >
                  {formatRelative(event.ts_ms)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
