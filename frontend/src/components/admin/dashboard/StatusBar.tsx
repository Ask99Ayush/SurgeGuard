"use client";

import Link from "next/link";
import { ArrowRight, Pause, Play, ShieldCheck } from "lucide-react";
import { useReadOnly } from "@/components/admin/RoleContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/components/ui/primitives";
import { fetchJson, RequestFailure } from "@/lib/client";
import type { Overview } from "@/components/admin/types";
import { deriveStatus, type GateState } from "./statusSentence";
import { useState } from "react";

const stateRing: Record<GateState, string> = {
  quiet: "bg-success",
  admitting: "bg-accent animate-soft-pulse",
  busy: "bg-warning animate-soft-pulse",
  paused: "bg-warning",
  degraded: "bg-danger animate-soft-pulse",
  offline: "bg-danger",
};

const stateSentenceColor: Record<GateState, string> = {
  quiet: "text-foreground",
  admitting: "text-foreground",
  busy: "text-foreground",
  paused: "text-warning",
  degraded: "text-danger",
  offline: "text-danger",
};

export function StatusBar({
  overview,
  apiOk,
  onChanged,
}: {
  overview: Overview | null;
  apiOk: boolean;
  onChanged: () => void;
}) {
  const status = deriveStatus(overview, apiOk);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const readOnly = useReadOnly();

  const isPaused = !!(overview?.admission.paused);
  const isAutoPaused = !!(overview?.admission.auto_paused);

  async function handlePauseResume() {
    setBusy(true);
    setErr(null);
    try {
      await fetchJson(isPaused ? "/api/admin/queue/resume" : "/api/admin/queue/pause", {
        method: "POST",
        body: JSON.stringify(isPaused ? {} : { reason: "Paused from console" }),
      });
      setConfirmOpen(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof RequestFailure ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-gate-state={status.state}
      className="flex min-h-[72px] items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-4 shadow-[var(--shadow-pop)]"
    >
      {/* Left: dot + sentence */}
      <div className="flex min-w-0 items-start gap-3 sm:items-center">
        <span
          aria-hidden
          className={cn("mt-1 size-3 shrink-0 rounded-full sm:mt-0", stateRing[status.state])}
        />
        <div className="min-w-0">
          <p
            className={cn(
              "text-[17px] font-semibold leading-snug tracking-[-0.02em]",
              stateSentenceColor[status.state],
            )}
          >
            {status.sentence}
          </p>
          {status.detail && (
            <p className="mt-0.5 text-sm text-muted">{status.detail}</p>
          )}
        </div>
      </div>

      {/* Right: action */}
      <div className="flex shrink-0 items-center gap-2">
        {err && <span role="alert" className="text-xs text-danger">{err}</span>}
        {overview && !isAutoPaused && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={readOnly}
            title={readOnly ? "Read-only demo mode — cannot change admission state" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
              isPaused
                ? "border-success/30 bg-success/10 text-success hover:bg-success/20"
                : "border-border bg-surface-elevated text-muted hover:border-border-strong hover:text-foreground",
            )}
          >
            {isPaused ? (
              <>
                <Play className="size-3.5" aria-hidden />
                Resume
              </>
            ) : (
              <>
                <Pause className="size-3.5" aria-hidden />
                Pause
              </>
            )}
          </button>
        )}
        {overview && status.state === "quiet" && (
          <Link
            href="/monitoring"
            className="flex items-center gap-1 rounded-xl border border-border bg-surface-elevated px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
          >
            <ShieldCheck className="size-3.5 text-success" aria-hidden />
            Monitoring
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
        {overview && status.state !== "quiet" && overview.queue.waiting > 0 && (
          <Link
            href="/queue"
            className="flex items-center gap-1 rounded-xl border border-border bg-surface-elevated px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
          >
            Queue ({overview.queue.waiting})
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        busy={busy}
        title={isPaused ? "Resume admission?" : "Pause admission?"}
        description={
          isPaused
            ? "The worker will start admitting waiting visitors again at the configured rate."
            : "Nobody new will be admitted until you resume. Visitors already admitted keep access; waiting visitors keep their place."
        }
        confirmLabel={isPaused ? "Resume" : "Pause admission"}
        tone={isPaused ? "primary" : "danger"}
        onConfirm={handlePauseResume}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
