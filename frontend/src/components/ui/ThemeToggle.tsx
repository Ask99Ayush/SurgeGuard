"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/components/ui/primitives";

export function ThemeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { resolvedTheme, setTheme, mounted } = useTheme();

  const modes: Array<{ mode: "light" | "dark"; label: string; icon: typeof Sun }> = [
    { mode: "light", label: "Light", icon: Sun },
    { mode: "dark", label: "Dark", icon: Moon },
  ];

  if (!mounted) {
    return (
      <div
        className={cn(
          "inline-flex items-center rounded-xl border border-border bg-surface p-0.5 text-muted",
          className,
        )}
        aria-hidden
      >
        <span className="grid size-7 place-items-center rounded-lg">
          <Sun className="size-3.5 opacity-50" />
        </span>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={cn(
        "inline-flex items-center rounded-xl border border-border bg-surface p-0.5 shadow-sm transition-colors duration-150",
        className,
      )}
    >
      {modes.map(({ mode, label, icon: Icon }) => {
        const active = resolvedTheme === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => setTheme(mode)}
            aria-pressed={active}
            title={`${label} theme`}
            className={cn(
              "relative grid place-items-center rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              compact ? "size-7" : "size-7 sm:size-7.5",
              active
                ? "bg-surface-elevated font-semibold text-foreground shadow-sm ring-1 ring-border"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
