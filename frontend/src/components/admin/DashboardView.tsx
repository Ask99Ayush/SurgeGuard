"use client";

import { useState } from "react";
import { ChevronDown, MonitorPlay, Sparkles } from "lucide-react";
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

export function DashboardView() {
  const [, setRefreshKey] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const overview = usePolling<Overview>("/api/admin/overview", 3000);
  const backends = usePolling<BackendsResponse>("/api/admin/backends", 10_000);
  const events = usePolling<EventItem[]>("/api/admin/events?limit=200", 10_000);
  const config = usePolling<{ grafana_url?: string }>("/api/admin/config", 60_000);

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

  return (
    <>
      {/* Calm, Focused Page Header */}
      <PageHeader
        title="Dashboard"
        description="Real-time gate status, admission rate, and site protection health."
        actions={
          <ButtonLink href="/live" size="sm">
            <MonitorPlay className="size-4" aria-hidden />
            Live Projector
          </ButtonLink>
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
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            <div>
              <p className="text-sm font-semibold text-foreground">Interactive Gate Flow &amp; Event Stream</p>
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
            <div className="mt-4">
              <WhatHappening overview={o} backends={backends.data} />
            </div>
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
