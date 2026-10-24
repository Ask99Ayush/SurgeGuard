"use client";

import { useState } from "react";
import { MonitorPlay } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { StatusBar } from "@/components/admin/dashboard/StatusBar";
import { TheGate } from "@/components/admin/dashboard/TheGate";
import { ThreeNumbers } from "@/components/admin/dashboard/ThreeNumbers";
import { Timeline } from "@/components/admin/dashboard/Timeline";
import { WhatHappening } from "@/components/admin/dashboard/WhatHappening";
import { CommandPalette } from "@/components/admin/dashboard/CommandPalette";
import { ButtonLink } from "@/components/ui/primitives";
import { usePolling } from "@/hooks/usePolling";
import type { BackendsResponse, EventItem, Overview } from "@/components/admin/types";

export function DashboardView() {
  const [, setRefreshKey] = useState(0);

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
      {/* Page header — keeps existing nav/footer intact */}
      <PageHeader
        title="Dashboard"
        description="SurgeGuard virtual waiting room — real-time gate status and traffic overview."
        actions={
          <ButtonLink href="/live" size="sm">
            <MonitorPlay className="size-4" aria-hidden />
            Live Projector
          </ButtonLink>
        }
      />

      {/* ──────────────────────────────────────────────
          ZONE 1: STATUS BAR
          One sentence that tells the whole story.
      ─────────────────────────────────────────────── */}
      <div className="mb-4">
        <StatusBar overview={o} apiOk={apiOk} onChanged={handleChanged} />
      </div>

      {/* ──────────────────────────────────────────────
          ZONE 2: THE GATE (hero visual)
          Waiting room → Gate → Your website
      ─────────────────────────────────────────────── */}
      <div className="mb-4">
        <TheGate overview={o} backendsItems={backendsItems} />
      </div>

      {/* ──────────────────────────────────────────────
          ZONE 3: THREE NUMBERS
          Queue depth · Typical wait · Site health
      ─────────────────────────────────────────────── */}
      <div className="mb-4">
        <ThreeNumbers overview={o} />
      </div>

      {/* ──────────────────────────────────────────────
          ZONE 4: TIMELINE + WHAT'S HAPPENING
          Side-by-side panels (stacked on mobile)
      ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Timeline overview={o} events={events.data ?? []} />
        <WhatHappening />
      </div>

      {/* ──────────────────────────────────────────────
          CMD+K COMMAND PALETTE
          Floating trigger; opens on Ctrl/Cmd+K
      ─────────────────────────────────────────────── */}
      <CommandPalette grafanaUrl={config.data?.grafana_url ?? null} />
    </>
  );
}
