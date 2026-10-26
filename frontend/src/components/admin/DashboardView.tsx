"use client";

import { useState } from "react";
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
import { getDirectOriginUrl, getGrafanaBaseUrl, getProtectedSiteUrl } from "@/lib/urls";
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

  // Resolve exhibition presentation URLs dynamically
  const effectiveSiteUrl = getProtectedSiteUrl(propSiteUrl ?? config.data?.site_url);
  const effectiveDirectUrl = getDirectOriginUrl(propDirectUrl);
  const effectiveGrafanaUrl = getGrafanaBaseUrl(propGrafanaUrl ?? config.data?.grafana_url);

  return (
    <>
      {/* Calm, Focused Page Header with Clean Presentation Actions */}
      <PageHeader
        title="Dashboard"
        description="Real-time gate status, admission rate, and site protection health."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={effectiveSiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-elevated hover:border-border-hover shadow-xs"
              title="Open protected demo website behind SurgeGuard (:8088)"
            >
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              <Globe className="size-3.5 text-muted" aria-hidden />
              <span>Demo Site</span>
              <ExternalLink className="size-3 text-muted" aria-hidden />
            </a>

            <a
              href={effectiveDirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-elevated hover:text-foreground hover:border-border-hover"
              title="Open unprotected raw origin (:8081)"
            >
              <Flame className="size-3.5 text-warning" aria-hidden />
              <span>Unprotected (:8081)</span>
              <ExternalLink className="size-3 text-muted" aria-hidden />
            </a>

            <ButtonLink href="/live" size="sm" variant="secondary" className="text-xs">
              <MonitorPlay className="size-3.5 text-accent" aria-hidden />
              <span>Projector</span>
            </ButtonLink>

            <a
              href={effectiveGrafanaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-elevated hover:text-foreground hover:border-border-hover"
              title="Open Grafana SRE observability dashboard"
            >
              <BarChart3 className="size-3.5 text-chart-cyan" aria-hidden />
              <span>Grafana SRE</span>
              <ExternalLink className="size-3 text-muted" aria-hidden />
            </a>
          </div>
        }
      />

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
