"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Clock, Server, Users, X } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import type { Overview } from "@/components/admin/types";

/* ─────────────────────────────────────────────
   Particle animation helpers
───────────────────────────────────────────── */

interface Particle {
  id: number;
  x: number;
  opacity: number;
  speed: number;
}

let pid = 0;

function makeParticle(): Particle {
  return { id: pid++, x: 0, opacity: 0.4 + Math.random() * 0.5, speed: 0.6 + Math.random() * 0.9 };
}

/* ─────────────────────────────────────────────
   Stage drawer (click → side panel with detail)
───────────────────────────────────────────── */

type DrawerStage = "waiting" | "gate" | "site" | null;

function Drawer({
  stage,
  overview,
  onClose,
}: {
  stage: DrawerStage;
  overview: Overview | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stage) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", handler);
  }, [stage, onClose]);

  if (!stage) return null;

  const content: Record<DrawerStage & string, ReactNode> = {
    waiting: (
      <>
        <p className="text-sm text-muted">
          Visitors enter the waiting room when the site is under surge. They hold their position
          in a fair FIFO queue backed by Redis. Nobody is dropped — they wait for a token.
        </p>
        <dl className="mt-4 space-y-2">
          <Row label="Waiting now">{overview?.queue.waiting ?? "—"}</Row>
          <Row label="Admitted (active)">{overview?.queue.admitted_active ?? "—"}</Row>
          <Row label="Queue target">{overview?.admission.configured_rate ?? "—"}/s</Row>
        </dl>
        <div className="mt-4">
          <Link href="/queue" className="text-sm text-accent hover:underline flex items-center gap-1">
            Open queue table <ArrowRight className="size-3" />
          </Link>
        </div>
      </>
    ),
    gate: (
      <>
        <p className="text-sm text-muted">
          The Gate controls how fast visitors are admitted — like a valve. It issues signed
          HMAC-SHA256 tokens at the configured rate. Nginx validates every token before
          forwarding the request.
        </p>
        <dl className="mt-4 space-y-2">
          <Row label="Configured rate">{overview?.admission.configured_rate ?? "—"}/s</Row>
          <Row label="Measured rate">{overview?.admission.measured_rate_per_s.toFixed(1) ?? "—"}/s</Row>
          <Row label="Window">{overview?.admission.window_seconds ?? "—"}s</Row>
          <Row label="Status">{overview?.admission.paused ? "Paused" : overview?.admission.auto_paused ? "Auto-paused" : "Active"}</Row>
        </dl>
        <div className="mt-4">
          <Link href="/settings" className="text-sm text-accent hover:underline flex items-center gap-1">
            Admission settings <ArrowRight className="size-3" />
          </Link>
        </div>
      </>
    ),
    site: (
      <>
        <p className="text-sm text-muted">
          Protected origin backends receive only pre-authorized traffic. SurgeGuard probes
          each backend on a regular interval and removes unhealthy nodes from the admission
          pool automatically.
        </p>
        <dl className="mt-4 space-y-2">
          <Row label="Total backends">{overview?.backends.total ?? "—"}</Row>
          <Row label="Healthy">{overview?.backends.healthy ?? "—"}</Row>
          <Row label="Reporting">{overview?.backends.reporting ?? "—"}</Row>
        </dl>
        <div className="mt-4">
          <Link href="/backends" className="text-sm text-accent hover:underline flex items-center gap-1">
            Backend health details <ArrowRight className="size-3" />
          </Link>
        </div>
      </>
    ),
  };

  const titles: Record<string, string> = {
    waiting: "Waiting Room",
    gate: "The Gate",
    site: "Your Website",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end sm:items-start"
      aria-modal="true"
      role="dialog"
      aria-label={`${titles[stage]} detail`}
    >
      {/* Backdrop */}
      <button
        aria-label="Close drawer"
        type="button"
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        ref={ref}
        tabIndex={-1}
        className="relative z-10 flex h-full max-h-[80vh] w-full max-w-sm flex-col overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-[var(--shadow-pop)] sm:max-h-full sm:rounded-l-2xl sm:rounded-tr-none"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{titles[stage]}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-elevated hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="flex-1 px-5 py-4">{content[stage]}</div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

/* ─────────────────────────────────────────────
   The Gate SVG flow diagram
───────────────────────────────────────────── */

function BackendPill({ healthy, name }: { healthy: boolean | null; name: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        healthy === true
          ? "bg-success/15 text-success"
          : healthy === false
            ? "bg-danger/15 text-danger"
            : "bg-surface-elevated text-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          healthy === true ? "bg-success" : healthy === false ? "bg-danger" : "bg-subtle",
        )}
      />
      {name}
    </span>
  );
}

export function TheGate({
  overview,
  backendsItems = [],
}: {
  overview: Overview | null;
  backendsItems?: Array<{ name: string; healthy: boolean | null }>;
}) {
  const [drawer, setDrawer] = useState<DrawerStage>(null);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const particles = useRef<Particle[]>([]);
  const raf = useRef<number>(0);

  const isPaused = !!(overview?.admission.paused) || !!(overview?.admission.auto_paused);
  const isQuiet = !overview || (overview.queue.waiting === 0 && overview.admission.measured_rate_per_s < 0.05);

  // Spawn particles proportional to admission rate
  useEffect(() => {
    const rate = overview?.admission.measured_rate_per_s ?? 0;
    const target = isPaused ? 0 : isQuiet ? 0 : Math.min(8, Math.ceil(rate));
    let last = 0;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;

      // Move existing particles
      particles.current = particles.current
        .map((p) => ({ ...p, x: p.x + p.speed * (dt / 16) }))
        .filter((p) => p.x < 100);

      // Spawn new ones if needed
      if (particles.current.length < target && Math.random() < 0.25) {
        particles.current.push(makeParticle());
      }

      forceUpdate();
      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [overview?.admission.measured_rate_per_s, isPaused, isQuiet]);

  const configuredRate = overview?.admission.configured_rate ?? 10;
  const measuredRate = overview?.admission.measured_rate_per_s ?? 0;
  const valvePct = isPaused ? 0 : Math.min(1, measuredRate / configuredRate);

  const stageBtn =
    "cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-2xl transition-shadow hover:shadow-[0_0_0_2px_var(--accent)]";

  const ariaDesc = overview
    ? `Waiting room: ${overview.queue.waiting} visitors waiting. Gate: admitting at ${measuredRate.toFixed(1)} of ${configuredRate} per second. Website: ${overview.backends.healthy} of ${overview.backends.total} backends healthy.`
    : "Loading gate status.";

  return (
    <>
      <section
        aria-label="The Gate — live flow diagram"
        aria-describedby="gate-desc"
        className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-pop)]"
      >
        <p id="gate-desc" className="sr-only">{ariaDesc}</p>
        {/* Quiet-state resting message */}
        {isQuiet && !isPaused && (
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center px-4 pt-3">
            <span className="rounded-full border border-success/25 bg-success/10 px-3 py-1 text-xs font-medium text-success">
              Quiet right now · Everything is ready
            </span>
          </div>
        )}

        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-0 divide-x divide-border">
          {/* ── STAGE 1: WAITING ROOM ── */}
          <button
            type="button"
            onClick={() => setDrawer("waiting")}
            className={cn("flex flex-col gap-3 p-5 text-left", stageBtn)}
            aria-label="Open waiting room details"
          >
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted" aria-hidden />
              <span className="text-xs font-medium text-muted uppercase tracking-wide">Waiting Room</span>
            </div>
            <div className="flex-1">
              <p className="text-3xl font-semibold tabular-nums tracking-[-0.04em] text-foreground">
                {overview?.queue.waiting ?? "—"}
              </p>
              <p className="mt-1 text-xs text-subtle">
                {overview
                  ? overview.queue.waiting === 0
                    ? "Queue is empty"
                    : `${overview.queue.waiting} in FIFO queue`
                  : "Loading…"}
              </p>
            </div>
            {/* Filling bar */}
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-elevated">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  overview && overview.queue.waiting > 0 ? "bg-warning" : "bg-success/40",
                )}
                style={{
                  width: overview
                    ? overview.queue.waiting > 0
                      ? `${Math.min(100, (overview.queue.waiting / Math.max(overview.queue.waiting, 100)) * 100)}%`
                      : "8%"
                    : "0%",
                }}
              />
            </div>
          </button>

          {/* ── STAGE 2: THE GATE (center with animation) ── */}
          <button
            type="button"
            onClick={() => setDrawer("gate")}
            aria-label="Open gate admission details"
            className={cn("relative flex w-[140px] flex-col items-center justify-center gap-2 overflow-hidden px-4 py-5 sm:w-[180px]", stageBtn)}
          >
            {/* Animated particle track */}
            <svg
              aria-hidden
              viewBox="0 0 180 12"
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full overflow-visible"
              preserveAspectRatio="none"
            >
              {/* Track line */}
              <line x1="0" y1="6" x2="180" y2="6" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
              {/* Particles */}
              {particles.current.map((p) => (
                <circle
                  key={p.id}
                  cx={p.x * 1.8}
                  cy={6}
                  r={3}
                  fill="var(--accent)"
                  opacity={p.opacity}
                />
              ))}
            </svg>

            {/* Valve gauge */}
            <div className="relative z-10 flex flex-col items-center gap-1.5 bg-surface px-2">
              <div className="relative flex size-14 items-center justify-center rounded-full border-2 border-border bg-surface-elevated shadow-[var(--shadow-key)]">
                {/* Arc fill */}
                <svg aria-hidden viewBox="0 0 56 56" className="absolute inset-0 size-full -rotate-90">
                  <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" strokeWidth="4" />
                  <circle
                    cx="28"
                    cy="28"
                    r="22"
                    fill="none"
                    stroke={isPaused ? "var(--warning)" : "var(--accent)"}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${valvePct * 138.2} 138.2`}
                    className="transition-all duration-700"
                  />
                </svg>
                <span className="relative text-[10px] font-semibold tabular-nums text-foreground">
                  {isPaused ? "OFF" : `${Math.round(valvePct * 100)}%`}
                </span>
              </div>
              <span className="text-[10px] font-medium text-muted uppercase tracking-widest">Gate</span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {isPaused ? "Paused" : `${measuredRate.toFixed(1)}/${configuredRate}/s`}
              </span>
            </div>
          </button>

          {/* ── STAGE 3: YOUR WEBSITE ── */}
          <button
            type="button"
            onClick={() => setDrawer("site")}
            className={cn("flex flex-col gap-3 p-5 text-left", stageBtn)}
            aria-label="Open backend health details"
          >
            <div className="flex items-center gap-2">
              <Server className="size-4 text-muted" aria-hidden />
              <span className="text-xs font-medium text-muted uppercase tracking-wide">Your Website</span>
            </div>
            <div className="flex-1">
              <p className={cn("text-3xl font-semibold tabular-nums tracking-[-0.04em]",
                overview && overview.backends.healthy === 0 ? "text-danger"
                  : overview && overview.backends.healthy < (overview.backends.total) ? "text-warning"
                    : "text-foreground",
              )}>
                {overview ? `${overview.backends.healthy}/${overview.backends.total}` : "—"}
              </p>
              <p className="mt-1 text-xs text-subtle">backends healthy</p>
            </div>
            {/* Backend pills */}
            <div className="flex flex-wrap gap-1.5">
              {backendsItems.length > 0
                ? backendsItems.map((b) => (
                    <BackendPill key={b.name} name={b.name} healthy={b.healthy} />
                  ))
                : overview
                  ? Array.from({ length: overview.backends.total }, (_, i) => (
                      <BackendPill
                        key={i}
                        name={`origin-${i + 1}`}
                        healthy={i < overview.backends.healthy}
                      />
                    ))
                  : <span className="text-xs text-subtle">Loading…</span>
              }
            </div>
          </button>
        </div>

        {/* Flow arrows overlay (decorative) */}
        <div className="flex items-center justify-between border-t border-border px-5 py-2 text-[10px] text-subtle">
          <span className="flex items-center gap-1">
            <Clock className="size-3" aria-hidden /> FIFO queue → signed token
          </span>
          <span>Nginx auth_request validates token →</span>
          <span>Origin receives only admitted requests</span>
        </div>
      </section>

      {/* Drawer */}
      <Drawer stage={drawer} overview={overview} onClose={() => setDrawer(null)} />
    </>
  );
}
