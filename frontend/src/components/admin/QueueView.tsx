"use client";

import { useEffect, useState } from "react";
import { Ban, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { PauseControl } from "@/components/admin/PauseControl";
import { useReadOnly } from "@/components/admin/RoleContext";
import type { Overview, VisitorFilter, VisitorPage, VisitorRow, VisitorState } from "@/components/admin/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Button, Card, cn, type Tone } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { RequestFailure, fetchJson } from "@/lib/client";
import { formatClock, formatNumber, formatRelative, shortId } from "@/lib/format";

const TABS: { key: VisitorFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting" },
  { key: "admitted", label: "Admitted" },
  { key: "expired", label: "Expired" },
  { key: "rejected", label: "Rejected" },
];

/** State colours: only rejected (an admin action against a visitor) uses a warning colour. */
const STATE_TONE: Record<VisitorState, Tone> = {
  waiting: "neutral",
  admitted: "success",
  expired: "neutral",
  rejected: "warning",
};

const EMPTY_HINT: Record<VisitorFilter, string> = {
  all: "No visitors yet. Open the protected site or run make demo to generate traffic.",
  waiting: "No waiting visitors. Run make demo to generate traffic.",
  admitted: "No admitted visitors right now. Admissions appear here as the worker lets people in.",
  expired: "No expired visitors. Abandoned tabs and ended tokens show up here.",
  rejected: "No rejected visitors.",
};

const PAGE_SIZE = 25;

export function QueueView() {
  const [filter, setFilter] = useState<VisitorFilter>("all");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rejecting, setRejecting] = useState<VisitorRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const readOnly = useReadOnly();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [filter, debounced]);

  const overview = usePolling<Overview>("/api/admin/overview", 5000);
  const qs = new URLSearchParams({ state: filter, page: String(page), page_size: String(PAGE_SIZE) });
  if (debounced) qs.set("q", debounced);
  const list = usePolling<VisitorPage>(`/api/admin/visitors?${qs}`, 4000);
  const data = list.data && list.data.state === filter ? list.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const counts = overview.data?.queue.counts;
  const countFor = (key: VisitorFilter) =>
    !counts ? null : key === "all" ? counts.waiting + counts.admitted + counts.expired + counts.rejected : counts[key];
  const showState = filter === "all";
  const showPosition = filter === "all" || filter === "waiting";

  async function reject() {
    if (!rejecting) return;
    setBusy(true);
    setActionError(null);
    try {
      await fetchJson(`/api/admin/visitors/${rejecting.visitor_id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "Rejected from console" }),
      });
      setRejecting(null);
      list.refresh();
      overview.refresh();
    } catch (err) {
      setActionError(err instanceof RequestFailure ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Queue"
        description="Every visitor known to the waiting room, by state."
        actions={
          overview.data ? (
            <PauseControl paused={overview.data.admission.paused} autoPaused={overview.data.admission.auto_paused} onChanged={overview.refresh} />
          ) : null
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <div role="tablist" aria-label="Visitor state" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {TABS.map((t) => {
              const count = countFor(t.key);
              const selected = filter === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  onClick={() => setFilter(t.key)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors duration-150",
                    selected ? "bg-surface-elevated text-foreground" : "text-muted hover:bg-surface-elevated/60 hover:text-foreground",
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs tabular-nums",
                      count ? "bg-surface-hover text-foreground" : "text-subtle",
                    )}
                  >
                    {count === null ? "—" : formatNumber(count)}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="relative block lg:w-72">
            <span className="sr-only">Search by visitor ID</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32))}
              placeholder="Search visitor ID"
              className="h-9 w-full rounded-[10px] border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors duration-150 placeholder:text-subtle hover:border-border-strong focus:border-border-strong"
            />
          </label>
        </div>

        {actionError ? (
          <p role="alert" className="mx-4 mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {actionError}
          </p>
        ) : null}

        {list.status === "loading" || (!data && list.status === "success") ? (
          <TableSkeleton />
        ) : !data ? (
          <StateView
            kind={list.status === "disconnected" ? "disconnected" : "error"}
            title={list.status === "disconnected" ? "Disconnected" : "Visitor list unavailable"}
            message={list.error ?? "The SurgeGuard API did not respond. Retrying every few seconds."}
            onRetry={list.refresh}
            compact
          />
        ) : data.items.length === 0 ? (
          <StateView
            kind="empty"
            compact
            title={debounced ? "No matching visitors" : "Nothing here yet"}
            message={debounced ? `No visitor ID contains "${debounced}".` : EMPTY_HINT[filter]}
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-xs text-subtle">
                <tr className="border-b border-border">
                  {showState ? <th scope="col" className="px-4 py-2.5 font-medium">State</th> : null}
                  {showPosition ? <th scope="col" className="px-4 py-2.5 font-medium">Position</th> : null}
                  <th scope="col" className="px-4 py-2.5 font-medium">Visitor</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Sequence</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Joined</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{filter === "admitted" ? "Token expires" : "Updated"}</th>
                  {filter !== "waiting" && filter !== "admitted" ? <th scope="col" className="px-4 py-2.5 font-medium">Reason</th> : null}
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((row) => {
                  const state = row.state as VisitorState;
                  const canReject = state === "waiting" || state === "admitted";
                  return (
                    <tr key={row.visitor_id} className="transition-colors duration-150 hover:bg-surface-elevated/50">
                      {showState ? (
                        <td className="px-4 py-2.5">
                          <Badge tone={STATE_TONE[state] ?? "neutral"}>{row.state}</Badge>
                        </td>
                      ) : null}
                      {showPosition ? (
                        <td className="px-4 py-2.5 tabular-nums text-foreground">{row.position ? `#${row.position}` : "—"}</td>
                      ) : null}
                      <td className="px-4 py-2.5 font-mono text-xs" title={row.visitor_id}>
                        {shortId(row.visitor_id)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{row.seq ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted">{row.joined_at_ms ? formatRelative(row.joined_at_ms) : "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">
                        {filter === "admitted"
                          ? row.token_expires_at_ms
                            ? formatClock(row.token_expires_at_ms)
                            : "—"
                          : row.updated_at_ms
                            ? formatRelative(row.updated_at_ms)
                            : "—"}
                      </td>
                      {filter !== "waiting" && filter !== "admitted" ? (
                        <td className="px-4 py-2.5 text-muted">{row.expired_reason ?? row.reject_reason ?? "—"}</td>
                      ) : null}
                      <td className="px-4 py-2.5 text-right">
                        {canReject ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRejecting(row)}
                            disabled={readOnly}
                            title={readOnly ? "The demo account is read-only" : undefined}
                            aria-label={`Reject visitor ${shortId(row.visitor_id)}`}
                          >
                            <Ban className="size-3.5" aria-hidden />
                            Reject
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted">
          <span className="tabular-nums">
            {data ? `${formatNumber(data.total)} total` : "—"}
            {list.stale ? <span className="ml-2 text-warning">stale</span> : null}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="tabular-nums">
              Page {page} of {pages}
            </span>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={rejecting !== null}
        busy={busy}
        title="Reject this visitor?"
        description={
          <>
            Visitor <span className="font-mono text-foreground">{rejecting ? shortId(rejecting.visitor_id) : ""}</span> will be
            removed{rejecting?.state === "admitted" ? " and their admission token revoked immediately" : " from the queue"}. They
            cannot rejoin with this session.
          </>
        }
        confirmLabel="Reject visitor"
        tone="danger"
        onConfirm={reject}
        onCancel={() => setRejecting(null)}
      />
    </>
  );
}

function TableSkeleton() {
  return (
    <div aria-label="Loading visitors" className="divide-y divide-border">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-6 px-4 py-3">
          <span className="h-3 w-16 animate-pulse rounded bg-surface-elevated" />
          <span className="h-3 w-24 animate-pulse rounded bg-surface-elevated" />
          <span className="h-3 w-10 animate-pulse rounded bg-surface-elevated" />
          <span className="h-3 w-20 animate-pulse rounded bg-surface-elevated" />
        </div>
      ))}
    </div>
  );
}
