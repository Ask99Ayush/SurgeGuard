"use client";

import { useEffect, useState } from "react";
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Info,
  Search,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { PauseControl } from "@/components/admin/PauseControl";
import { useReadOnly } from "@/components/admin/RoleContext";
import { StatTile } from "@/components/admin/StatTile";
import type { Overview, VisitorFilter, VisitorPage, VisitorRow, VisitorState } from "@/components/admin/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Button, Card, cn, type Tone } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";
import { RequestFailure, fetchJson } from "@/lib/client";
import { formatClock, formatNumber, formatRelative, shortId } from "@/lib/format";

const TABS: { key: VisitorFilter; label: string }[] = [
  { key: "all", label: "All Visitors" },
  { key: "waiting", label: "Waiting" },
  { key: "admitted", label: "Admitted" },
  { key: "expired", label: "Expired" },
  { key: "rejected", label: "Rejected" },
];

const STATE_TONE: Record<VisitorState, Tone> = {
  waiting: "warning",
  admitted: "success",
  expired: "neutral",
  rejected: "danger",
};

const EMPTY_HINT: Record<VisitorFilter, string> = {
  all: "No visitors recorded yet. Open the protected site or launch the Traffic Lab to generate load.",
  waiting: "No visitors currently waiting in the virtual queue. Inflow is flowing freely.",
  admitted: "No active admitted tokens right now. Tokens appear as visitors pass the admission gate.",
  expired: "No expired visitors. Abandoned sessions and timed-out tokens will show up here.",
  rejected: "No rejected visitors. Admin-revoked tokens will appear here.",
};

const PAGE_SIZE = 25;

export function QueueView() {
  const [filter, setFilter] = useState<VisitorFilter>("all");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "seq">("newest");
  const [selectedVisitor, setSelectedVisitor] = useState<VisitorRow | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<VisitorRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const readOnly = useReadOnly();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [filter, debounced, sortBy]);

  const overview = usePolling<Overview>("/api/admin/overview", 4000);
  const qs = new URLSearchParams({ state: filter, page: String(page), page_size: String(PAGE_SIZE) });
  if (debounced) qs.set("q", debounced);
  const list = usePolling<VisitorPage>(`/api/admin/visitors?${qs}`, 3000);
  const data = list.data && list.data.state === filter ? list.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const counts = overview.data?.queue.counts;

  // Sorting
  const sortedItems = [...(data?.items ?? [])].sort((a, b) => {
    if (sortBy === "oldest") return (a.joined_at_ms ?? 0) - (b.joined_at_ms ?? 0);
    if (sortBy === "seq") return (a.seq ?? 0) - (b.seq ?? 0);
    return (b.joined_at_ms ?? 0) - (a.joined_at_ms ?? 0);
  });

  const countFor = (key: VisitorFilter) =>
    !counts ? null : key === "all" ? counts.waiting + counts.admitted + counts.expired + counts.rejected : counts[key];

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopiedId(null);
    }
  }

  async function reject() {
    if (!rejecting) return;
    setBusy(true);
    setActionError(null);
    try {
      await fetchJson(`/api/admin/visitors/${rejecting.visitor_id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "Revoked from Operations Console" }),
      });
      if (selectedVisitor?.visitor_id === rejecting.visitor_id) {
        setSelectedVisitor(null);
      }
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
        title="Queue Management"
        description="Monitor waiting room sequence, verify admission token lifecycle, and manage visitor sessions."
        breadcrumbs={[{ label: "Operations", href: "/dashboard" }, { label: "Queue" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {overview.data ? (
              <PauseControl paused={overview.data.admission.paused} autoPaused={overview.data.admission.auto_paused} onChanged={overview.refresh} />
            ) : null}
          </div>
        }
      />

      {/* TOP KPI CARDS */}
      <section aria-label="Queue Metrics Summary" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Waiting in Queue"
          loading={overview.status === "loading"}
          value={counts ? formatNumber(counts.waiting) : null}
          emphasis={counts && counts.waiting > 0 ? "warning" : "default"}
          context={counts && counts.waiting > 0 ? "Visitors holding FIFO position" : "Queue is clear"}
        />
        <StatTile
          label="Admitted Active"
          loading={overview.status === "loading"}
          value={counts ? formatNumber(counts.admitted) : null}
          emphasis="default"
          context={counts ? "Holding valid JWT token" : "API unreachable"}
        />
        <StatTile
          label="Expired Sessions"
          loading={overview.status === "loading"}
          value={counts ? formatNumber(counts.expired) : null}
          context="Heartbeat timed out or token expired"
        />
        <StatTile
          label="Rejected Visitors"
          loading={overview.status === "loading"}
          value={counts ? formatNumber(counts.rejected) : null}
          emphasis={counts && counts.rejected > 0 ? "danger" : "default"}
          context="Revoked by operator action"
        />
      </section>

      {/* READ-ONLY DEMO DISCLAIMER */}
      {readOnly ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-4 py-2.5 text-xs text-accent">
          <Eye className="size-4 shrink-0" />
          <span>
            <strong>Read-Only Demo Mode:</strong> You are viewing live queue telemetry. Visitor revocation and pause actions are disabled for this session.
          </span>
        </div>
      ) : null}

      {/* MAIN QUEUE DATA CARD */}
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Filter Tabs */}
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
                    "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150",
                    selected ? "bg-surface-elevated text-foreground" : "text-muted hover:bg-surface-elevated/60 hover:text-foreground",
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs tabular-nums",
                      count ? "bg-surface-hover text-foreground font-semibold" : "text-subtle",
                    )}
                  >
                    {count === null ? "—" : formatNumber(count)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search & Sort Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block sm:w-64">
              <span className="sr-only">Search by visitor ID</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32))}
                placeholder="Search visitor ID"
                className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-8 text-sm outline-none transition-colors placeholder:text-subtle hover:border-border-strong focus:border-accent"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </label>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "newest" | "oldest" | "seq")}
              className="h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground outline-none hover:border-border-strong"
              aria-label="Sort queue visitors"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="seq">Sort: Sequence Order</option>
            </select>
          </div>
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
        ) : sortedItems.length === 0 ? (
          <StateView
            kind="empty"
            compact
            title={debounced ? "No matching visitors" : "No visitors in this state"}
            message={debounced ? `No visitor ID contains "${debounced}".` : EMPTY_HINT[filter]}
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="text-xs text-subtle">
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2.5 font-medium">Position</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Visitor</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Waiting time</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedItems.map((row) => {
                  const state = row.state as VisitorState;
                  const canReject = state === "waiting" || state === "admitted";
                  const isSelected = selectedVisitor?.visitor_id === row.visitor_id;

                  const waitTimeDisplay =
                    state === "waiting"
                      ? row.joined_at_ms ? formatRelative(row.joined_at_ms) : "In queue"
                      : state === "admitted"
                        ? row.admitted_at_ms ? `Admitted ${formatRelative(row.admitted_at_ms)}` : "Admitted"
                        : row.joined_at_ms ? formatRelative(row.joined_at_ms) : "—";

                  return (
                    <tr
                      key={row.visitor_id}
                      onClick={() => setSelectedVisitor((prev) => (prev?.visitor_id === row.visitor_id ? null : row))}
                      className={cn(
                        "cursor-pointer transition-colors duration-150",
                        isSelected ? "bg-surface-elevated" : "hover:bg-surface-elevated/50",
                      )}
                    >
                      <td className="px-4 py-3 tabular-nums text-foreground font-semibold">
                        {row.position ? `#${row.position}` : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        <span className="flex items-center gap-1.5" title={row.visitor_id}>
                          {shortId(row.visitor_id)}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyId(row.visitor_id);
                            }}
                            title="Copy full visitor ID"
                            className="text-subtle hover:text-foreground"
                          >
                            {copiedId === row.visitor_id ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
                          </button>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {waitTimeDisplay}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATE_TONE[state] ?? "neutral"}>{row.state}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedVisitor((prev) => (prev?.visitor_id === row.visitor_id ? null : row))}
                            aria-label={`Inspect visitor ${shortId(row.visitor_id)}`}
                          >
                            <Info className="size-3.5" />
                            <span className="hidden sm:inline">Details</span>
                          </Button>
                          {canReject ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setRejecting(row)}
                              disabled={readOnly}
                              title={readOnly ? "The demo account is read-only" : undefined}
                              aria-label={`Reject visitor ${shortId(row.visitor_id)}`}
                            >
                              <Ban className="size-3.5 text-danger" aria-hidden />
                              <span className="text-danger hidden sm:inline">Reject</span>
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        )}

        {/* Pagination Bar */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted">
          <span className="tabular-nums">
            {data ? `${formatNumber(data.total)} total visitors` : "—"}
            {list.stale ? <span className="ml-2 text-warning">(stale)</span> : null}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="tabular-nums font-medium text-foreground">
              Page {page} of {pages}
            </span>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </Card>

      {/* VISITOR DETAILS DRAWER / INSPECTOR */}
      {selectedVisitor ? (
        <Card className="mt-4 border-accent/40 bg-surface">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div className="flex items-center gap-2.5">
              <Users className="size-4 text-accent" />
              <h3 className="text-sm font-semibold text-foreground">Visitor Session Inspector</h3>
              <Badge tone={STATE_TONE[selectedVisitor.state as VisitorState] ?? "neutral"}>
                {selectedVisitor.state}
              </Badge>
            </div>
            <button
              type="button"
              onClick={() => setSelectedVisitor(null)}
              className="rounded-lg p-1 text-muted hover:bg-surface-elevated hover:text-foreground"
              aria-label="Close details"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div>
              <p className="text-subtle font-medium">Full Visitor Identifier</p>
              <p className="mt-1 font-mono text-[11px] text-foreground break-all">{selectedVisitor.visitor_id}</p>
            </div>
            <div>
              <p className="text-subtle font-medium">Queue Ticket Sequence</p>
              <p className="mt-1 font-semibold text-foreground">
                {selectedVisitor.seq ? `#${selectedVisitor.seq}` : "—"} {selectedVisitor.position ? `(Position #${selectedVisitor.position})` : ""}
              </p>
            </div>
            <div>
              <p className="text-subtle font-medium">Initial Queue Entry</p>
              <p className="mt-1 text-foreground">
                {selectedVisitor.joined_at_ms ? `${formatClock(selectedVisitor.joined_at_ms)} (${formatRelative(selectedVisitor.joined_at_ms)})` : "—"}
              </p>
            </div>
            <div>
              <p className="text-subtle font-medium">Last Interaction / Heartbeat</p>
              <p className="mt-1 text-foreground">
                {selectedVisitor.updated_at_ms ? `${formatClock(selectedVisitor.updated_at_ms)} (${formatRelative(selectedVisitor.updated_at_ms)})` : "—"}
              </p>
            </div>
            {selectedVisitor.token_expires_at_ms ? (
              <div>
                <p className="text-subtle font-medium">Admission Token Expiration</p>
                <p className="mt-1 font-mono text-success">
                  {formatClock(selectedVisitor.token_expires_at_ms)} ({formatRelative(selectedVisitor.token_expires_at_ms)})
                </p>
              </div>
            ) : null}
            {selectedVisitor.expired_reason || selectedVisitor.reject_reason ? (
              <div className="sm:col-span-2">
                <p className="text-subtle font-medium">Termination Reason</p>
                <p className="mt-1 text-danger font-medium">
                  {selectedVisitor.expired_reason ?? selectedVisitor.reject_reason}
                </p>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* CONFIRM REVOCATION DIALOG */}
      <ConfirmDialog
        open={rejecting !== null}
        busy={busy}
        title="Revoke visitor admission?"
        description={
          <>
            Visitor <span className="font-mono text-foreground">{rejecting ? shortId(rejecting.visitor_id) : ""}</span> will be
            removed {rejecting?.state === "admitted" ? "and their HMAC-SHA256 admission token invalidated immediately" : "from the waiting room queue"}. They
            will not be able to bypass the edge proxy with this ticket.
          </>
        }
        confirmLabel="Revoke admission"
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
