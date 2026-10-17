import { Server, ShieldCheck } from "lucide-react";

/** Illustration of metered admission: visitors line up, pass the gate one by one, reach a healthy origin. */
export function QueueFlow() {
  return (
    <figure className="keycap overflow-hidden p-5 sm:p-6" aria-labelledby="queueflow-caption">
      <div className="flex items-center gap-3 sm:gap-5">
        <div className="fade-mask-x relative h-10 min-w-0 flex-1 overflow-hidden" aria-hidden>
          <div className="animate-advance absolute inset-y-0 -left-7 flex items-center gap-2">
            {Array.from({ length: 18 }, (_, i) => (
              <span
                key={i}
                className="size-5 shrink-0 rounded-md border border-border-strong bg-surface-elevated"
                style={{ opacity: 0.35 + (i / 18) * 0.65 }}
              />
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <span className="grid size-12 place-items-center rounded-xl border border-accent/40 bg-accent/10 text-accent">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className="text-[11px] font-medium text-muted">gate</span>
        </div>
        <div className="flex shrink-0 items-center gap-1" aria-hidden>
          <span className="size-1.5 rounded-full bg-success" />
          <span className="h-px w-6 bg-gradient-to-r from-success to-transparent sm:w-10" />
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {["origin-1", "origin-2"].map((name) => (
            <span
              key={name}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted"
            >
              <Server className="size-3.5" aria-hidden />
              {name}
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
            </span>
          ))}
        </div>
      </div>
      <figcaption id="queueflow-caption" className="mt-4 text-[12px] text-subtle">
        Illustration · excess visitors wait in line while the origin receives only what it can handle.
      </figcaption>
    </figure>
  );
}
