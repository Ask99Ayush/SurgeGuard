"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  ChevronDown,
  ExternalLink,
  Flame,
  Globe,
  MonitorPlay,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBar } from "@/components/admin/dashboard/StatusBar";
import { FourStats } from "@/components/admin/dashboard/FourStats";
import { Timeline } from "@/components/admin/dashboard/Timeline";
import { TheGate } from "@/components/admin/dashboard/TheGate";
import { WhatHappening } from "@/components/admin/dashboard/WhatHappening";
import { CommandPalette } from "@/components/admin/dashboard/CommandPalette";
import { Button, ButtonLink } from "@/components/ui/primitives";
import { usePolling } from "@/hooks/usePolling";
import type { BackendsResponse, EventItem, Overview } from "@/components/admin/types";

export interface DashboardViewProps {
  siteUrl?: string | null;
  directUrl?: string | null;
  grafanaUrl?: string | null;
}

export function DashboardView({
  siteUrl: propSiteUrl,
  directUrl: propDirectUrl,
  grafanaUrl: propGrafanaUrl,
}: DashboardViewProps = {}) {
  const [, setRefreshKey] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const overview = usePolling<Overview>("/api/admin/overview", 3000);
  const backends = usePolling<BackendsResponse>("/api/admin/backends", 10_000);
  const events = usePolling<EventItem[]>("/api/admin/events?limit=200", 10_000);
  const config = usePolling<{ grafana_url?: string; site_url?: string }>("/api/admin/config", 60_000);

  const o = overview.data;
  const apiOk = overview.status === "success";

  function handleChanged() {
    setRefreshKey((k) => k + 1);
    overview.refresh();
  }

  const backendsItems = (backends.data?.items ?? []).map((b) => ({
    name: b.name,
    healthy: b.healthy,
  }));

  const isPaused = !!(o?.admission.paused) || !!(o?.admission.auto_paused);
  const isQuiet = !o || (o.queue.waiting === 0 && o.admission.measured_rate_per_s < 0.05);
  const measuredRate = o?.admission.measured_rate_per_s ?? 0;

  // Resolve exhibition presentation URLs
  const effectiveSiteUrl =
    propSiteUrl ??
    config.data?.site_url ??
    (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:8088` : "http://3.109.184.177:8088");
  const effectiveDirectUrl =
    propDirectUrl ??
    (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:8081` : "http://3.109.184.177:8081");
  const effectiveGrafanaUrl =
    propGrafanaUrl ??
    config.data?.grafana_url ??
    (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:3001` : "http://3.109.184.177:3001");

  return (
    <>
      {/* Calm, Focused Page Header with Exhibition Presentation Actions */}
      <PageHeader
        title="Dashboard"
        description="Real-time gate status, admission rate, and site protection health."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={effectiveSiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/15 px-3 py-1.5 text-xs font-semibold text-success shadow-xs transition hover:bg-success/25"
              title="Open protected demo website behind SurgeGuard admission gate"
            >
              <Globe className="size-3.5" aria-hidden />
              <span>Demo Website (Protected)</span>
              <ExternalLink className="size-3 opacity-70" aria-hidden />
            </a>

            <a
              href={effectiveDirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning transition hover:bg-warning/20"
              title="Test unprotected raw origin (collapses with 503 under concurrency)"
            >
              <Flame className="size-3.5" aria-hidden />
              <span>Unprotected Site (:8081)</span>
              <ExternalLink className="size-3 opacity-70" aria-hidden />
            </a>

            <ButtonLink href="/live" size="sm" variant="secondary" className="text-xs">
              <MonitorPlay className="size-3.5" aria-hidden />
              <span>Live Projector</span>
            </ButtonLink>

            <a
              href={effectiveGrafanaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-surface-hover"
              title="Open Grafana SRE observability dashboard"
            >
              <BarChart3 className="size-3.5 text-chart-cyan" aria-hidden />
              <span>Grafana SRE</span>
              <ExternalLink className="size-3 opacity-70" aria-hidden />
            </a>
          </div>
        }
      />

      {/* ──────────────────────────────────────────────
          ZONE 0: EXHIBITION SHOWCASE & DEMO CONTROL SUITE
          Instant presentation switcher for exhibitions, audits, and demos
      ─────────────────────────────────────────────── */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-gradient-to-r from-surface-elevated/80 via-surface to-surface-elevated/60 p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/15 text-accent shadow-xs">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-foreground">Exhibition Live Demo Suite</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                  <span className="size-1.5 rounded-full bg-success animate-pulse" />
                  Live AWS Cluster (ap-south-1)
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Showcase SurgeGuard&apos;s virtual waiting room admission gate, raw origin failure contrast, and Grafana SRE observability.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            {/* Step 1: Protected Demo */}
            <a
              href={effectiveSiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col justify-between rounded-xl border border-success/30 bg-success/5 p-3 transition hover:border-success/60 hover:bg-success/10"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-success">1. Protected Origin</span>
                <ExternalLink className="size-3 text-success opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <div className="mt-1.5 font-semibold text-foreground">Open Demo Website (:8088)</div>
              <div className="mt-0.5 text-[11px] text-muted">FIFO gate · Token verified</div>
            </a>

            {/* Step 2: Unprotected Failure Demo */}
            <a
              href={effectiveDirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col justify-between rounded-xl border border-warning/30 bg-warning/5 p-3 transition hover:border-warning/60 hover:bg-warning/10"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">2. Failure Contrast</span>
                <ExternalLink className="size-3 text-warning opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <div className="mt-1.5 font-semibold text-foreground">Unprotected Site (:8081)</div>
              <div className="mt-0.5 text-[11px] text-muted">Bypasses gate · 503 under surge</div>
            </a>

            {/* Step 3: Big Screen Projector */}
            <Link
              href="/live"
              className="group flex flex-col justify-between rounded-xl border border-border bg-surface p-3 transition hover:border-accent/40 hover:bg-surface-elevated"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">3. Stage Kiosk</span>
                <MonitorPlay className="size-3 text-accent opacity-70 transition-transform group-hover:scale-110" />
              </div>
              <div className="mt-1.5 font-semibold text-foreground">Live Queue Projector</div>
              <div className="mt-0.5 text-[11px] text-muted">Audience big-screen mode</div>
            </Link>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────
          ZONE 1: TOP STATUS BANNER
          System health in one glance + prominent Pause/Resume action
      ─────────────────────────────────────────────── */}
      <div className="mb-4">
        <StatusBar overview={o} apiOk={apiOk} onChanged={handleChanged} />
      </div>

      {/* ──────────────────────────────────────────────
          ZONE 2: 4 KEY STAT CARDS
          Waiting · Admitted per second · Avg wait · Healthy backends
      ─────────────────────────────────────────────── */}
      <div className="mb-4">
        <FourStats overview={o} />
      </div>

      {/* ──────────────────────────────────────────────
          ZONE 3: ONE MAIN QUEUE CHART
          Clean time series of Queue Depth and Admission Velocity
      ─────────────────────────────────────────────── */}
      <div className="mb-6">
        <Timeline overview={o} events={events.data ?? []} />
      </div>

      {/* ──────────────────────────────────────────────
          ZONE 4: COLLAPSIBLE ADVANCED / GATE VISUALIZER
          Moved behind a collapsible section to eliminate screen clutter
      ─────────────────────────────────────────────── */}
      <div className="rounded-[var(--radius-card)] border border-border bg-surface/60 overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface-elevated text-chart-cyan">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Interactive Gate Flow &amp; Event Stream</p>
                {isPaused ? (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                    <span className="size-1 rounded-full bg-warning" />
                    Paused
                  </span>
                ) : isQuiet ? (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                    <span className="size-1 rounded-full bg-success" />
                    Quiet
                  </span>
                ) : (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-chart-cyan/30 bg-chart-cyan/10 px-2 py-0.5 text-[11px] font-medium text-chart-cyan">
                    <span className="size-1 rounded-full bg-chart-cyan animate-ping" />
                    Active ({measuredRate.toFixed(1)}/s)
                  </span>
                )}
              </div>
              <p className="text-xs text-muted">Particle simulation of admission token flow and audit log</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="text-xs gap-1.5"
          >
            <span>{showAdvanced ? "Hide Flow" : "View Flow & Events"}</span>
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
          </Button>
        </div>

        {showAdvanced && (
          <div className="border-t border-border p-4 space-y-4 animate-in fade-in duration-200">
            <TheGate overview={o} backendsItems={backendsItems} />
            <WhatHappening overview={o} backends={backends.data} />
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────
          CMD+K COMMAND PALETTE
      ─────────────────────────────────────────────── */}
      <CommandPalette grafanaUrl={config.data?.grafana_url ?? null} />
    </>
  );
}
