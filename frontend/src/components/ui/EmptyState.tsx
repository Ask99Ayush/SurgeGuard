import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function EmptyState({
  icon: Icon = Inbox,
  title = "No data found",
  message,
  actionLabel,
  onAction,
  children,
}: {
  icon?: React.ElementType;
  title?: string;
  message?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center py-10 px-4 text-center rounded-[var(--radius-card)] border border-dashed border-border bg-surface/40"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-surface-elevated text-muted border border-border">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 className="mt-3.5 text-sm font-semibold text-foreground">{title}</h3>
      {message ? <p className="mt-1 max-w-sm text-xs text-muted leading-relaxed">{message}</p> : null}
      {actionLabel && onAction ? (
        <div className="mt-4">
          <Button size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
