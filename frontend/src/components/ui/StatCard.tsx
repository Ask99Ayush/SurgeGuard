import type { ReactNode } from "react";
import { Skeleton, cn } from "@/components/ui/primitives";

export function StatCard({
  label,
  value,
  unit,
  description,
  trend,
  badge,
  action,
  loading,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  description?: ReactNode;
  trend?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
  tone?: "default" | "success" | "warning" | "danger" | "accent";
  className?: string;
}) {
  const toneColors = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    accent: "text-accent",
  };

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-5 shadow-[var(--shadow-pop)] transition-colors",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted truncate">{label}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {badge}
          {action}
          {trend}
        </div>
      </div>

      <div className="mt-2.5 flex items-baseline gap-1.5">
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className={cn("text-2xl sm:text-3xl font-semibold tracking-[-0.03em] tabular-nums", toneColors[tone])}>
            {value ?? "—"}
          </div>
        )}
        {!loading && unit ? <span className="text-xs font-medium text-muted">{unit}</span> : null}
      </div>

      {description ? (
        <p className="mt-1.5 text-xs text-subtle leading-relaxed truncate" title={typeof description === "string" ? description : undefined}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
