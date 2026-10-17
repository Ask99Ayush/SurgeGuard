import { cn } from "@/components/ui/primitives";

/**
 * A live number with one fixed structure: label, large value, one line of context.
 * `value === null` renders `emptyLabel` (default "Unavailable") in the same slot, muted, with the
 * reason as the context line — never a fake zero.
 */
export function StatTile({
  label,
  value,
  unit,
  context,
  emptyLabel = "Unavailable",
  emphasis = "default",
  loading,
}: {
  label: string;
  value: string | null;
  unit?: string;
  context: string;
  emptyLabel?: string;
  /** Colour the value only for real problems; zero and normal values stay neutral. */
  emphasis?: "default" | "warning" | "danger";
  loading?: boolean;
}) {
  return (
    <div className="keycap flex min-h-[120px] flex-col p-4" data-testid={`stat-${label}`}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-auto flex h-9 items-end">
        {loading ? (
          <span className="block h-7 w-20 animate-pulse rounded-md bg-surface-hover" aria-label={`${label} loading`} />
        ) : value === null ? (
          <span className="text-xl font-medium leading-none text-subtle" data-unavailable>
            {emptyLabel}
          </span>
        ) : (
          <span
            className={cn(
              "text-[30px] font-semibold leading-none tabular-nums tracking-[-0.03em]",
              emphasis === "warning" && "text-warning",
              emphasis === "danger" && "text-danger",
            )}
          >
            {value}
            {unit ? <span className="ml-1 text-sm font-normal text-muted">{unit}</span> : null}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-xs text-subtle" title={context}>
        {loading ? "Loading…" : context}
      </p>
    </div>
  );
}
