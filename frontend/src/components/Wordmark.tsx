import { cn } from "@/components/ui/primitives";

/**
 * Original SurgeGuard mark: a rounded gate with three bars of decreasing length — a line of
 * visitors being metered through. Coral accent on the leading bar.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn("size-7", className)} aria-hidden focusable="false">
      <rect x="1" y="1" width="26" height="26" rx="8" fill="var(--surface-elevated)" stroke="var(--border-strong)" />
      <rect x="7" y="8" width="14" height="3" rx="1.5" fill="var(--accent)" />
      <rect x="7" y="12.5" width="10" height="3" rx="1.5" fill="var(--foreground)" opacity="0.85" />
      <rect x="7" y="17" width="6" height="3" rx="1.5" fill="var(--foreground)" opacity="0.45" />
      <rect x="20" y="15" width="2" height="6" rx="1" fill="var(--muted)" opacity="0.6" />
    </svg>
  );
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark />
      {compact ? (
        <span className="sr-only">SurgeGuard</span>
      ) : (
        <span className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">
          Surge<span className="text-muted">Guard</span>
        </span>
      )}
    </span>
  );
}
