"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Sliders, Layers } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function LandingDeepDive({
  simulator,
  comparison,
  showcase,
  features,
  architecture,
  stack,
}: {
  simulator: ReactNode;
  comparison: ReactNode;
  showcase: ReactNode;
  features: ReactNode;
  architecture: ReactNode;
  stack: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-border bg-surface/30">
      <div className="mx-auto max-w-6xl px-4 py-8 text-center sm:px-6">
        <div className="inline-flex flex-col items-center gap-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            Interactive Demonstrator &amp; Architecture
          </p>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setOpen((prev) => !prev)}
            className="gap-2 text-xs font-semibold"
          >
            {open ? <Layers className="size-3.5" /> : <Sliders className="size-3.5 text-accent" />}
            {open ? "Hide Technical Deep Dive & Simulator" : "Open Interactive Simulator & Architecture"}
            <ChevronDown
              className={`size-3.5 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </Button>
          {!open && (
            <p className="max-w-md text-xs text-subtle">
              Run interactive surge simulations, compare protected vs unprotected routes, and inspect edge token architecture.
            </p>
          )}
        </div>
      </div>

      {open && (
        <div className="divide-y divide-border border-t border-border animate-in fade-in duration-300">
          <div id="simulator">{simulator}</div>
          <div id="comparison">{comparison}</div>
          {showcase}
          {features}
          {architecture}
          {stack}
        </div>
      )}
    </div>
  );
}
