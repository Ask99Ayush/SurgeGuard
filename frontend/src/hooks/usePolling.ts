"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RequestFailure, fetchJson } from "@/lib/client";

export type PollStatus = "loading" | "success" | "error" | "disconnected";

export interface PollState<T> {
  status: PollStatus;
  data: T | null;
  error: string | null;
  /** True when showing data from an earlier successful poll while the latest one failed. */
  stale: boolean;
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * Poll a JSON endpoint. Keeps the last good data visible (marked stale) on failure so
 * operators never mistake an outage for "zero". Redirects to login on 401.
 */
export function usePolling<T>(url: string | null, intervalMs: number): PollState<T> {
  const [state, setState] = useState<Omit<PollState<T>, "refresh">>({
    status: "loading",
    data: null,
    error: null,
    stale: false,
    updatedAt: null,
  });
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const run = async () => {
      try {
        const data = await fetchJson<T>(url);
        if (!cancelled) setState({ status: "success", data, error: null, stale: false, updatedAt: Date.now() });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof RequestFailure && err.kind === "unauthorized") {
          window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        const offline = (err instanceof RequestFailure && err.kind === "network") || !navigator.onLine;
        setState((prev) => ({
          status: offline ? "disconnected" : "error",
          data: prev.data,
          error: err instanceof Error ? err.message : "Request failed",
          stale: prev.data !== null,
          updatedAt: prev.updatedAt,
        }));
      } finally {
        if (!cancelled) timer.current = setTimeout(run, intervalMs);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [url, intervalMs, tick]);

  return { ...state, refresh };
}
