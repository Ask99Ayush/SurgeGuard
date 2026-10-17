"use client";

import { StateView } from "@/components/ui/StateView";

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface">
      <StateView
        kind="error"
        title="This view crashed"
        message="Something went wrong while rendering. The rest of the console still works."
        onRetry={reset}
      />
    </div>
  );
}
