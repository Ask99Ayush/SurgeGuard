"use client";

import { RANGES, type RangeName } from "@/lib/promql";
import { cn } from "@/components/ui/primitives";

/** Segmented control for the chart time range (keyboard: arrow keys move between options). */
export function RangeSelect({ value, onChange }: { value: RangeName; onChange: (range: RangeName) => void }) {
  const options = Object.keys(RANGES) as RangeName[];
  return (
    <div role="radiogroup" aria-label="Time range" className="inline-flex rounded-[10px] border border-border bg-surface p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          tabIndex={value === option ? 0 : -1}
          onClick={() => onChange(option)}
          onKeyDown={(e) => {
            const idx = options.indexOf(value);
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const next = options[(idx + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
              if (next) onChange(next);
            }
          }}
          className={cn(
            "h-7 rounded-lg px-2.5 text-xs font-medium transition-colors duration-150",
            value === option ? "bg-surface-elevated text-foreground shadow-[var(--shadow-key)]" : "text-muted hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
