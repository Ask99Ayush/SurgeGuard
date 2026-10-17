"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Hourglass, PauseCircle, ShieldAlert, WifiOff } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { Button, StatusDot, cn } from "@/components/ui/primitives";
import { RequestFailure } from "@/lib/client";
import { formatApproxWait, formatNumber } from "@/lib/format";
import { httpQueueApi, safeRedirect, type QueueApi, type QueueStatus } from "./types";

type View =
  | { kind: "connecting" }
  | { kind: "waiting"; status: QueueStatus }
  | { kind: "admitted"; status: QueueStatus }
  | { kind: "rejected" }
  | { kind: "unavailable"; message: string; retryIn: number; last: QueueStatus | null }
  | { kind: "disconnected"; retryIn: number; last: QueueStatus | null };

const MAX_BACKOFF_S = 15;
// Stable default: an inline default would change identity every render and restart the poll loop.
const browserNavigate = (url: string) => window.location.assign(url);

export function WaitingRoom({
  api = httpQueueApi,
  navigate = browserNavigate,
  admitDelayMs = 1500,
}: {
  api?: QueueApi;
  navigate?: (url: string) => void;
  admitDelayMs?: number;
}) {
  const [view, setView] = useState<View>({ kind: "connecting" });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const initialPosition = useRef<number | null>(null);
  const lastStatus = useRef<QueueStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const alive = useRef(true);

  const schedule = useCallback((fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  }, []);

  const step = useCallback(
    async (action: "join" | "status") => {
      try {
        const status = action === "join" ? await api.join() : await api.status();
        if (!alive.current) return;
        failures.current = 0;
        lastStatus.current = status;
        setUpdatedAt(Date.now());
        if (status.state === "waiting") {
          if (initialPosition.current === null && status.position !== null) initialPosition.current = status.position;
          setView({ kind: "waiting", status });
          schedule(() => void step("status"), Math.max(1, status.poll_after_seconds) * 1000);
        } else if (status.state === "admitted") {
          setView({ kind: "admitted", status });
          schedule(() => navigate(safeRedirect(status.redirect_to)), admitDelayMs);
        } else if (status.state === "expired") {
          // Tab was idle too long or the admission window ended: rejoin (keeps the place within the grace window).
          schedule(() => void step("join"), 250);
        } else {
          setView({ kind: "rejected" });
        }
      } catch (err) {
        if (!alive.current) return;
        if (err instanceof RequestFailure && err.status === 404) {
          schedule(() => void step("join"), 250);
          return;
        }
        failures.current += 1;
        const backoff = Math.min(MAX_BACKOFF_S, 2 ** Math.min(failures.current, 4));
        const retryIn = err instanceof RequestFailure && err.retryAfterSeconds ? err.retryAfterSeconds : backoff;
        const offline = (err instanceof RequestFailure && err.kind === "network") || !navigator.onLine;
        setView(
          offline
            ? { kind: "disconnected", retryIn, last: lastStatus.current }
            : {
                kind: "unavailable",
                retryIn,
                last: lastStatus.current,
                message:
                  err instanceof RequestFailure && err.status === 429
                    ? "Lots of people are checking at once. We'll retry for you shortly."
                    : "The waiting room is temporarily unavailable. Nobody is being let in until it's back.",
              },
        );
        schedule(() => void step("join"), retryIn * 1000);
      }
    },
    [api, navigate, schedule, admitDelayMs],
  );

  useEffect(() => {
    alive.current = true;
    void step("join");
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const onOnline = () => void step("join");
    window.addEventListener("online", onOnline);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      clearInterval(clock);
      window.removeEventListener("online", onOnline);
    };
  }, [step]);

  const retryNow = () => {
    failures.current = 0;
    setView({ kind: "connecting" });
    void step("join");
  };

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div aria-hidden className="hero-glow pointer-events-none absolute inset-0" />
      <header className="relative flex items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <LiveIndicator view={view} updatedAt={updatedAt} now={now} />
      </header>
      <main id="main" className="relative flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-[var(--shadow-pop)] sm:p-8">
            <Body view={view} initialPosition={initialPosition.current} onRetry={retryNow} />
          </div>
          <p className="mt-5 px-2 text-center text-[13px] leading-relaxed text-muted">
            Keep this tab open — you&apos;ll be let in automatically. Refreshing won&apos;t lose your place: it&apos;s tied
            to this browser, not your network.
          </p>
        </div>
      </main>
    </div>
  );
}

function LiveIndicator({ view, updatedAt, now }: { view: View; updatedAt: number | null; now: number }) {
  if (view.kind === "disconnected") {
    return (
      <span className="flex items-center gap-2 text-[12px] text-danger">
        <StatusDot tone="danger" /> Offline
      </span>
    );
  }
  if (view.kind === "unavailable") {
    return (
      <span className="flex items-center gap-2 text-[12px] text-warning">
        <StatusDot tone="warning" /> Reconnecting
      </span>
    );
  }
  const age = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <span className="flex items-center gap-2 text-[12px] text-muted">
      <StatusDot tone="success" pulse />
      {age === null ? "Connecting" : age < 2 ? "Live" : `Updated ${age}s ago`}
    </span>
  );
}

function Body({ view, initialPosition, onRetry }: { view: View; initialPosition: number | null; onRetry: () => void }) {
  switch (view.kind) {
    case "connecting":
      return (
        <div role="status" aria-live="polite" className="py-6">
          <p className="text-sm text-muted">Finding your place in line…</p>
          <div className="mt-6 h-16 animate-pulse rounded-xl bg-surface-elevated" />
          <div className="mt-4 h-2 animate-pulse rounded-full bg-surface-elevated" />
        </div>
      );
    case "waiting":
      return <Waiting status={view.status} initialPosition={initialPosition} />;
    case "admitted":
      return (
        <div role="status" aria-live="assertive" className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-success/30 bg-success/10 text-success">
            <CheckCircle2 className="size-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em]">You&apos;re in.</h1>
          <p className="mt-2 text-sm text-muted">Taking you to the site now…</p>
          <a
            href={safeRedirect(view.status.redirect_to)}
            className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-foreground px-4 text-sm font-medium text-background"
          >
            Continue
          </a>
        </div>
      );
    case "rejected":
      return (
        <div role="alert" className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-danger/30 bg-danger/10 text-danger">
            <ShieldAlert className="size-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-xl font-semibold">We can&apos;t admit this session</h1>
          <p className="mt-2 text-sm text-muted">
            The site operator removed this session from the queue. If you think this is a mistake, contact the site
            owner.
          </p>
        </div>
      );
    case "unavailable":
    case "disconnected":
      return <Problem view={view} onRetry={onRetry} />;
  }
}

function Waiting({ status, initialPosition }: { status: QueueStatus; initialPosition: number | null }) {
  const position = status.position ?? 0;
  const start = initialPosition ?? position;
  const progress = start > 0 ? Math.min(1, Math.max(0, (start - position) / start)) : 0;
  return (
    <div>
      <p className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <Hourglass className="size-4" aria-hidden /> You&apos;re in line
      </p>
      <div aria-live="polite" aria-atomic="true" className="mt-4">
        <p className="sr-only">
          Your position is {position}
          {status.queue_length ? ` of ${status.queue_length}` : ""}.
        </p>
        <div aria-hidden className="flex items-baseline gap-2">
          <span className="text-6xl font-semibold tabular-nums tracking-[-0.04em]" data-testid="position">
            {formatNumber(position)}
          </span>
          <span className="text-sm text-muted">
            {position === 1 ? "you're next" : "ahead of you: " + formatNumber(Math.max(0, position - 1))}
          </span>
        </div>
      </div>
      {status.queue_length !== null ? (
        <p className="mt-1 text-[13px] text-subtle">{formatNumber(status.queue_length)} {status.queue_length === 1 ? "person" : "people"} waiting in total</p>
      ) : null}

      <div className="mt-6">
        <div
          role="progressbar"
          aria-label="Progress since you joined"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-surface-elevated"
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="mt-2 text-[12px] text-subtle">Progress since you joined</p>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-background/60 p-4">
        <Estimate status={status} />
      </div>
    </div>
  );
}

function Estimate({ status }: { status: QueueStatus }) {
  if (status.paused || status.estimate_status === "paused") {
    return (
      <p className="flex items-start gap-3 text-sm">
        <PauseCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Admission is paused.</span>{" "}
          <span className="text-muted">Your place is safe and the line will move again when admission resumes.</span>
        </span>
      </p>
    );
  }
  if (status.estimate_status === "available" && status.estimated_wait_seconds !== null) {
    return (
      <p className="flex items-start gap-3 text-sm">
        <Clock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <span>
          <span className="text-muted">Approximate wait</span>{" "}
          <span className="font-medium text-foreground" data-testid="estimate">
            {formatApproxWait(status.estimated_wait_seconds)}
          </span>
          <span className="block text-[12px] text-subtle">Based on how fast people were admitted in the last minute.</span>
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-3 text-sm">
      <Clock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <span>
        <span className="font-medium text-foreground">Estimate unavailable</span>
        <span className="block text-[12px] text-muted">
          Not enough recent admissions to measure the pace yet. Your position above is exact.
        </span>
      </span>
    </p>
  );
}

function Problem({ view, onRetry }: { view: Extract<View, { kind: "unavailable" | "disconnected" }>; onRetry: () => void }) {
  const offline = view.kind === "disconnected";
  return (
    <div role="alert">
      <span
        className={cn(
          "grid size-12 place-items-center rounded-2xl border",
          offline ? "border-danger/30 bg-danger/10 text-danger" : "border-warning/30 bg-warning/10 text-warning",
        )}
      >
        {offline ? <WifiOff className="size-6" aria-hidden /> : <Clock className="size-6" aria-hidden />}
      </span>
      <h1 className="mt-5 text-xl font-semibold">{offline ? "You're offline" : "Temporarily unavailable"}</h1>
      <p className="mt-2 text-sm text-muted">
        {offline
          ? "We can't reach the waiting room. Reconnect soon — your place is held for a short while."
          : view.message}
      </p>
      {view.last?.position ? (
        <p className="mt-3 text-[13px] text-subtle">
          Last known position: {formatNumber(view.last.position)} (may have changed)
        </p>
      ) : null}
      <div className="mt-6 flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={onRetry}>
          Retry now
        </Button>
        <span className="text-[12px] text-muted">Retrying automatically in {view.retryIn}s</span>
      </div>
    </div>
  );
}
