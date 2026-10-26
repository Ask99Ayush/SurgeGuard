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
        className="relative overflow-hidden rounded-2xl border border-border bg-surface/90 shadow-[var(--shadow-pop)] backdrop-blur-xs"
      >
        <p id="gate-desc" className="sr-only">{ariaDesc}</p>

        {/* Dedicated Status Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 bg-surface-elevated/40 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-2">
              <span
                className={cn(
                  "absolute inline-flex size-full rounded-full opacity-75",
                  isPaused ? "bg-warning animate-ping" : isQuiet ? "bg-success" : "bg-chart-cyan animate-ping",
                )}
              />
              <span
                className={cn(
                  "relative inline-flex size-2 rounded-full",
                  isPaused ? "bg-warning" : isQuiet ? "bg-success" : "bg-chart-cyan",
                )}
              />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Traffic Admission Gate</span>
            <span className="hidden sm:inline-block text-[11px] text-subtle font-mono">· FIFO / HMAC-SHA256 Token Pipeline</span>
          </div>
          <div>
            {isPaused ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                <span className="size-1.5 rounded-full bg-warning" />
                Admission Paused · Traffic held safely
              </span>
            ) : isQuiet ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success">
                <span className="size-1.5 rounded-full bg-success" />
                Quiet right now · Everything is ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-chart-cyan/30 bg-chart-cyan/10 px-3 py-1 text-xs font-medium text-chart-cyan">
                <span className="size-1.5 rounded-full bg-chart-cyan animate-ping" />
                Active Admission · {measuredRate.toFixed(1)} req/s
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
          {/* ── STAGE 1: WAITING ROOM ── */}
          <button
            type="button"
            onClick={() => setDrawer("waiting")}
            className={cn("flex flex-col justify-between gap-4 p-5 text-left transition-colors hover:bg-surface-elevated/30", stageBtn)}
            aria-label="Open waiting room details"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-surface-elevated text-muted">
                  <Users className="size-4" aria-hidden />
                </div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Waiting Room</span>
              </div>
              <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-subtle">Stage 1</span>
            </div>

            <div className="my-1">
              <div className="flex items-baseline gap-2">
                <p className="font-mono text-3xl font-bold tabular-nums tracking-tight text-foreground">
                  {overview?.queue.waiting ?? "0"}
                </p>
                <span className="text-xs text-muted">visitors</span>
              </div>
              <p className="mt-1 text-xs text-subtle">
                {overview
                  ? overview.queue.waiting === 0
                    ? "Queue is empty · Instant admission"
                    : `${overview.queue.waiting} waiting in FIFO queue`
                  : "Connecting…"}
              </p>
            </div>

            {/* Queue fill capacity indicator */}
            <div className="space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    overview && overview.queue.waiting > 0 ? "bg-warning" : "bg-success/50",
                  )}
                  style={{
                    width: overview
                      ? overview.queue.waiting > 0
                        ? `${Math.min(100, Math.max(8, (overview.queue.waiting / 50) * 100))}%`
                        : "6%"
                      : "0%",
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-subtle">
                <span>FIFO Buffer</span>
                <span className="text-accent group-hover:underline">Click for details →</span>
              </div>
            </div>
          </button>

          {/* ── STAGE 2: THE GATE (center with animation) ── */}
          <button
            type="button"
            onClick={() => setDrawer("gate")}
            aria-label="Open gate admission details"
            className={cn(
              "relative flex flex-col items-center justify-between gap-3 overflow-hidden px-4 py-5 md:w-[220px] transition-colors hover:bg-surface-elevated/30",
              stageBtn,
            )}
          >
            <div className="flex w-full items-center justify-center">
              <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-subtle">
                Stage 2 · Admission Valve
              </span>
            </div>

            {/* Animated particle track across the stage */}
            <div className="relative flex w-full items-center justify-center py-2">
              <svg
                aria-hidden
                viewBox="0 0 220 28"
                className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 w-full overflow-visible"
                preserveAspectRatio="none"
              >
                {/* Track line (entering from left and exiting to right) */}
                <line x1="0" y1="14" x2="220" y2="14" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
                {/* Particles moving across */}
                {particles.current.map((p) => (
                  <g key={p.id}>
                    <circle
                      cx={p.x * 2.2}
                      cy={14}
                      r={3.5}
                      fill="var(--chart-cyan)"
                      opacity={p.opacity * 0.5}
                    />
                    <circle
                      cx={p.x * 2.2}
                      cy={14}
                      r={1.8}
                      fill="var(--foreground)"
                      opacity={p.opacity}
                    />
                  </g>
                ))}
              </svg>

              {/* Valve Circular Gauge */}
              <div className="relative z-10 flex size-18 items-center justify-center rounded-full border border-border bg-surface shadow-[var(--shadow-key)]">
                <svg aria-hidden viewBox="0 0 64 64" className="absolute inset-0 size-full -rotate-90">
                  {/* Background track circle */}
                  <circle cx="32" cy="32" r="25" fill="none" stroke="var(--border)" strokeWidth="3.5" />
                  {/* Active arc fill: Only rendered when valvePct > 0 to avoid zero-pct dot artifact */}
                  {valvePct > 0 && (
                    <circle
                      cx="32"
                      cy="32"
                      r="25"
                      fill="none"
                      stroke={isPaused ? "var(--warning)" : "var(--chart-cyan)"}
                      strokeWidth="3.5"
                      strokeLinecap={valvePct > 0.03 ? "round" : "butt"}
                      strokeDasharray={`${valvePct * 157.08} 157.08`}
                      className="transition-all duration-500"
                    />
                  )}
                </svg>
                <div className="relative z-10 flex flex-col items-center">
                  <span
                    className={cn(
                      "font-mono text-xs font-bold tabular-nums",
                      isPaused ? "text-warning" : valvePct > 0 ? "text-chart-cyan" : "text-muted",
                    )}
                  >
                    {isPaused ? "OFF" : `${Math.round(valvePct * 100)}%`}
                  </span>
                  <span className="text-[9px] font-semibold tracking-wider uppercase text-subtle">
                    {isPaused ? "PAUSED" : valvePct > 0 ? "FLOW" : "IDLE"}
                  </span>
                </div>
              </div>
            </div>

            {/* Velocity readout */}
            <div className="flex flex-col items-center text-center">
              <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                {isPaused ? "Paused" : `${measuredRate.toFixed(1)} / ${configuredRate}/s`}
              </span>
              <span className="text-[10px] text-accent group-hover:underline">Valve details →</span>
            </div>
          </button>

          {/* ── STAGE 3: YOUR WEBSITE ── */}
          <button
            type="button"
            onClick={() => setDrawer("site")}
            className={cn("flex flex-col justify-between gap-4 p-5 text-left transition-colors hover:bg-surface-elevated/30", stageBtn)}
            aria-label="Open backend health details"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-surface-elevated text-muted">
                  <Server className="size-4" aria-hidden />
                </div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Your Website</span>
              </div>
              <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-subtle">Stage 3</span>
            </div>

            <div className="my-1">
              <div className="flex items-baseline gap-2">
                <p
                  className={cn(
                    "font-mono text-3xl font-bold tabular-nums tracking-tight",
                    overview && overview.backends.healthy === 0
                      ? "text-danger"
                      : overview && overview.backends.healthy < overview.backends.total
                        ? "text-warning"
                        : "text-foreground",
                  )}
                >
                  {overview ? `${overview.backends.healthy}/${overview.backends.total}` : "—"}
                </p>
                <span className="text-xs text-muted">backends healthy</span>
              </div>
              <p className="mt-1 text-xs text-subtle">
                {overview && overview.backends.healthy === overview.backends.total
                  ? "All upstream origin nodes healthy"
                  : `${(overview?.backends.total ?? 0) - (overview?.backends.healthy ?? 0)} node(s) degraded`}
              </p>
            </div>

            {/* Backend pills */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {backendsItems.length > 0
                  ? backendsItems.map((b) => (
                      <BackendPill key={b.name} name={b.name} healthy={b.healthy} />
                    ))
                  : overview
                    ? Array.from({ length: overview.backends.total }, (_, i) => (
                        <BackendPill
                          key={i}
                          name={`demo-${i + 1}`}
                          healthy={i < overview.backends.healthy}
                        />
                      ))
                    : <span className="text-xs text-subtle">Connecting…</span>
                }
              </div>
              <div className="flex items-center justify-between text-[10px] text-subtle">
                <span>Protected Origin</span>
                <span className="text-accent group-hover:underline">Click for details →</span>
              </div>
            </div>
          </button>
        </div>

        {/* Pipeline sequence footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 bg-surface-elevated/20 px-5 py-2.5 text-[11px] text-muted">
          <div className="flex items-center gap-1.5">
            <Clock className="size-3 text-muted" aria-hidden />
            <span>1. FIFO Queue holds surge</span>
          </div>
          <span className="hidden md:inline text-subtle font-mono">──▶</span>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-chart-cyan" />
            <span>2. Gate issues signed HMAC token</span>
          </div>
          <span className="hidden md:inline text-subtle font-mono">──▶</span>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" />
            <span>3. Nginx auth_request validates &amp; proxies</span>
          </div>
        </div>
      </section>

      {/* Drawer */}
      <Drawer stage={drawer} overview={overview} onClose={() => setDrawer(null)} />
    </>
  );
}
