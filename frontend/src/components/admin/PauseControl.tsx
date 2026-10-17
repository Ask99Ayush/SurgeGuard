"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { useReadOnly } from "@/components/admin/RoleContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Button } from "@/components/ui/primitives";
import { RequestFailure, fetchJson } from "@/lib/client";
import { formatRelative } from "@/lib/format";
import type { PauseInfo } from "./types";

/** Manual pause/resume with a confirmation step. Auto-pause (no healthy backends) is shown but not overridable. */
export function PauseControl({
  paused,
  autoPaused,
  onChanged,
}: {
  paused: PauseInfo | null;
  autoPaused: PauseInfo | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPaused = paused !== null;
  const readOnly = useReadOnly();

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(isPaused ? "/api/admin/queue/resume" : "/api/admin/queue/pause", {
        method: "POST",
        body: JSON.stringify(isPaused ? {} : { reason: "Paused from console" }),
      });
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof RequestFailure ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {autoPaused ? (
        <Badge tone="danger" dot>
          Auto-paused: {autoPaused.reason}
        </Badge>
      ) : null}
      {isPaused ? (
        <Badge tone="warning" dot>
          Paused {formatRelative(paused.since_ms)}
        </Badge>
      ) : (
        <Badge tone="success" dot>
          Admitting
        </Badge>
      )}
      <Button
        size="sm"
        variant={isPaused ? "primary" : "secondary"}
        onClick={() => setOpen(true)}
        disabled={readOnly}
        title={readOnly ? "The demo account is read-only" : undefined}
      >
        {isPaused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
        {isPaused ? "Resume admission" : "Pause admission"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={open}
        busy={busy}
        title={isPaused ? "Resume admission?" : "Pause admission?"}
        description={
          isPaused
            ? "The worker will start admitting waiting visitors again at the configured rate."
            : "Nobody new will be admitted until you resume. Visitors already admitted keep access; waiting visitors keep their place."
        }
        confirmLabel={isPaused ? "Resume" : "Pause admission"}
        tone={isPaused ? "primary" : "danger"}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
