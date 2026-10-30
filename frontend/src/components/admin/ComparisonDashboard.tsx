"use client";

/**
 * ComparisonDashboard — Side-by-side live comparison of Guarded vs Unguarded demo sites.
 *
 * Data is fetched from /api/demo/status which queries real health probes and
 * Prometheus metrics. Status labels are derived from actual HTTP responses and
 * concurrency meters, not hardcoded values.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ShieldOff,
  Users,
  XCircle,
  Zap,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SiteStatus = "Healthy" | "Under Load" | "Degraded" | "Recovering";

interface TelemetryData {
  guarded: {
    status: SiteStatus;
    queueLength: number;
    admissionRate: number;
    admissionStatus: string;
    originHealth: string;
    healthyNodes: number;
    totalNodes: number;
    responseStatus: number;
    latencyMs: number;
    overloadRate?: number;
    p95LatencyMs?: number;
    totalRequests?: number;
    admittedVisitors?: number;
  };
  unguarded: {
    status: SiteStatus;
    originHealth: string;
    responseStatus: number;
    activeSlots: number;
    maxSlots: number;
    successRate: number;
    failureRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    total503s?: number;
    totalRequests?: number;
    activeInflight?: number;
  };
  updatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<SiteStatus, { bg: string; border: string; badge: string; dot: string; label: string; icon: string }> = {
  Healthy:      { bg: "bg-emerald-500/10", border: "border-emerald-500/40", badge: "text-emerald-400 bg-emerald-500/15 border border-emerald-500/30", dot: "bg-emerald-500", label: "UP", icon: "✓" },
  "Under Load": { bg: "bg-amber-500/10",   border: "border-amber-500/40",   badge: "text-amber-400  bg-amber-500/15  border border-amber-500/30",  dot: "bg-amber-500  animate-pulse", label: "UNDER LOAD", icon: "⚡" },
  Degraded:     { bg: "bg-rose-500/10",    border: "border-rose-500/40",    badge: "text-rose-400   bg-rose-500/15   border border-rose-500/30",   dot: "bg-rose-500   animate-ping",  label: "DEGRADED",   icon: "✗" },
  Recovering:   { bg: "bg-sky-500/10",     border: "border-sky-500/40",     badge: "text-sky-400    bg-sky-500/15    border border-sky-500/30",    dot: "bg-sky-500",                   label: "RECOVERING", icon: "↻" },
};

function fmt(val: number | null | undefined, digits = 0, suffix = ""): string {
  if (val === null || val === undefined || Number.isNaN(val)) return "—";
  return `${val.toFixed(digits)}${suffix}`;
}

function MetricRow({
  label,
  value,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger" | "warning" | "neutral";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const toneClass =
    tone === "success" ? "text-emerald-400" :
    tone === "danger"  ? "text-rose-400"    :
    tone === "warning" ? "text-amber-400"   :
    "text-slate-300";

  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
      <span className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
        {Icon ? <Icon className="size-3 opacity-60" /> : null}
        {label}
      </span>
      <span className={`text-xs font-semibold font-mono text-right ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}

function StatusBanner({ status, label }: { status: SiteStatus; label: string }) {
  const cfg = STATUS_COLORS[status];
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${cfg.bg} ${cfg.border}`}>
      <span className={`size-3 rounded-full ${cfg.dot} shrink-0`} />
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-black tracking-tight mt-0.5 ${cfg.badge.split(" ")[0]}`}>
          {cfg.icon} {cfg.label}
        </p>
      </div>
    </div>
  );
}

function PanelCard({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  status,
  statusLabel,
  children,
  borderColor,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  status: SiteStatus;
  statusLabel: string;
  children: React.ReactNode;
  borderColor: string;
}) {
  return (
    <div className={`flex flex-col rounded-2xl border bg-slate-900/60 backdrop-blur ${borderColor}`}>
      {/* Panel header */}
      <div className="flex items-start justify-between gap-3 p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className={`grid size-9 place-items-center rounded-xl border border-white/10 bg-slate-800 ${iconColor}`}>
            <Icon className="size-4" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold font-mono ${STATUS_COLORS[status].badge}`}>
          {STATUS_COLORS[status].icon} {statusLabel}
        </span>
      </div>

      {/* Panel body */}
      <div className="flex flex-col flex-1 gap-4 p-5">
        <StatusBanner status={status} label="Current Status" />
        <div className="space-y-0">{children}</div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ComparisonDashboard() {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTelemetry = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/demo/status", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as TelemetryData;
        setTelemetry(data);
        setLastUpdated(new Date());
        setError(null);
      } else {
        setError(`Status API returned ${res.status}`);
      }
    } catch (e) {
      setError("Connection to status API failed");
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
    const id = setInterval(fetchTelemetry, 3000);
    return () => clearInterval(id);
  }, [fetchTelemetry]);

  const g = telemetry?.guarded;
  const u = telemetry?.unguarded;
  const guardedStatus: SiteStatus = g?.status ?? "Healthy";
  const unguardedStatus: SiteStatus = u?.status ?? "Healthy";

  // Detect "live" activity
  const isActive = (g?.queueLength ?? 0) > 0 || (u?.failureRate ?? 0) > 5 || (u?.activeSlots ?? 0) > 0;

  return (
    <section className="space-y-6">
      {/* ── Section header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-800/60 px-3 py-1 text-xs font-medium text-emerald-400 mb-3">
            <ShieldCheck className="size-3.5" />
            Live Comparison Dashboard
          </div>
          <h2 className="text-2xl font-semibold text-white tracking-tight">
            Guarded vs. Unguarded
          </h2>
          <p className="mt-1 text-sm text-slate-400 max-w-xl">
            Side-by-side comparison using real health probes and Prometheus metrics.
            Status reflects actual HTTP responses, not simulated data.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Live traffic indicator */}
          {isActive && (
            <span className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
              <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
              Live Traffic
            </span>
          )}

          {/* Last updated */}
          {lastUpdated && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="size-3" />
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}

          {/* Refresh button */}
          <button
            type="button"
            onClick={fetchTelemetry}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:text-white hover:bg-slate-700"
            title="Refresh telemetry"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-emerald-400" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          <AlertTriangle className="size-4 shrink-0" />
          {error} — retrying automatically…
        </div>
      )}

      {/* ── Side-by-side panels ──────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">

        {/* ──────── DEMO 1: GUARDED ──────────────────────────────────────── */}
        <PanelCard
          title="DEMO 1 — GUARDED"
          subtitle="SurgeGuard Virtual Waiting Room"
          icon={ShieldCheck}
          iconColor="text-emerald-400"
          status={guardedStatus}
          statusLabel={`${STATUS_COLORS[guardedStatus].label} · ${g?.healthyNodes ?? 2}/${g?.totalNodes ?? 2} Nodes`}
          borderColor={loading ? "border-white/10" : `border-${guardedStatus === "Healthy" ? "emerald" : guardedStatus === "Degraded" ? "rose" : "amber"}-500/30`}
        >
          <MetricRow
            label="Queue Length"
            value={g ? `${g.queueLength} visitors waiting` : "—"}
            tone={g && g.queueLength > 50 ? "warning" : "success"}
            icon={Users}
          />
          <MetricRow
            label="Admission Status"
            value={g ? `${g.admissionRate}/s (${g.admissionStatus})` : "—"}
            tone={g?.admissionStatus === "Paused" ? "warning" : "success"}
            icon={Zap}
          />
          <MetricRow
            label="Origin Health"
            value={g ? `${g.healthyNodes}/${g.totalNodes} nodes (HTTP ${g.responseStatus})` : "—"}
            tone={g?.responseStatus === 200 ? "success" : "danger"}
            icon={Activity}
          />
          <MetricRow
            label="Response Latency"
            value={g ? `${g.latencyMs} ms` : "—"}
            tone={g && g.latencyMs < 500 ? "success" : "warning"}
            icon={Clock}
          />
          {g?.p95LatencyMs !== undefined && (
            <MetricRow
              label="p95 Latency"
              value={`${g.p95LatencyMs} ms`}
              tone={g.p95LatencyMs < 1000 ? "success" : "warning"}
              icon={TrendingUp}
            />
          )}
          <MetricRow
            label="Origin Overload Rate"
            value={g ? `${fmt(g.overloadRate ?? 0, 1)}% drops (protected)` : "0% (protected)"}
            tone="success"
            icon={CheckCircle2}
          />
          {g?.admittedVisitors !== undefined && (
            <MetricRow
              label="Admitted Visitors"
              value={`${g.admittedVisitors}`}
              tone="success"
              icon={Users}
            />
          )}
        </PanelCard>

        {/* ──────── DEMO 2: UNGUARDED ────────────────────────────────────── */}
        <PanelCard
          title="DEMO 2 — UNGUARDED"
          subtitle="Direct Origin — No Protection"
          icon={ShieldOff}
          iconColor="text-rose-400"
          status={unguardedStatus}
          statusLabel={`${STATUS_COLORS[unguardedStatus].label} · HTTP ${u?.responseStatus ?? 200}`}
          borderColor={loading ? "border-white/10" : unguardedStatus === "Degraded" ? "border-rose-500/50" : "border-white/10"}
        >
          <MetricRow
            label="Concurrency Slots"
            value={u ? `${u.activeSlots} / ${u.maxSlots} busy` : "0 / 8 busy"}
            tone={u && u.activeSlots >= u.maxSlots ? "danger" : u && u.activeSlots > u.maxSlots / 2 ? "warning" : "neutral"}
            icon={Activity}
          />
          <MetricRow
            label="Response Status"
            value={u ? `HTTP ${u.responseStatus} (${u.originHealth})` : "HTTP 200 (Healthy)"}
            tone={u?.responseStatus === 503 ? "danger" : u?.responseStatus === 200 ? "success" : "warning"}
            icon={u?.responseStatus === 503 ? XCircle : CheckCircle2}
          />
          <MetricRow
            label="Success / Error Rate"
            value={u ? `${fmt(u.successRate, 1)}% OK · ${fmt(u.failureRate, 1)}% Error` : "100% OK"}
            tone={u && u.failureRate > 20 ? "danger" : u && u.failureRate > 5 ? "warning" : "success"}
            icon={u && u.failureRate > 10 ? TrendingDown : TrendingUp}
          />
          <MetricRow
            label="p50 Latency"
            value={u ? `${u.p50LatencyMs} ms` : "—"}
            tone={u && u.p50LatencyMs > 1000 ? "warning" : "neutral"}
            icon={Clock}
          />
          <MetricRow
            label="p95 Latency"
            value={u ? `${u.p95LatencyMs} ms` : "—"}
            tone={u && u.p95LatencyMs > 2000 ? "danger" : u && u.p95LatencyMs > 800 ? "warning" : "neutral"}
            icon={TrendingUp}
          />
          {u?.total503s !== undefined && (
            <MetricRow
              label="Total HTTP 503 Drops"
              value={`${u.total503s}`}
              tone={u.total503s > 0 ? "danger" : "success"}
              icon={XCircle}
            />
          )}
          {u?.totalRequests !== undefined && (
            <MetricRow
              label="Total Requests"
              value={`${u.totalRequests}`}
              tone="neutral"
              icon={Activity}
            />
          )}
        </PanelCard>
      </div>

      {/* ── How SurgeGuard protects ─────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/8 bg-slate-900/40 p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="size-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">How SurgeGuard Protects the Origin</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-xs text-slate-400">
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-white">1. Edge Gate (Nginx)</span>
            <p>Every request is checked for a valid HMAC admission token. Unadmitted visitors receive HTTP 302 → /waiting-room.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-white">2. Virtual Waiting Room</span>
            <p>Visitors join the Redis-backed queue, receive a session cookie, and poll /api/v1/queue/status for their turn.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-white">3. Controlled Admission</span>
            <p>The admission worker releases tokens at ADMISSION_RATE/s. Only admitted visitors reach the origin → zero 503 drops.</p>
          </div>
        </div>
      </div>

      {/* ── k6 command strip ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-slate-900/40 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-white">Run Simultaneous Live Demonstration</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Sends traffic to both endpoints at the same time and generates a comparison report.
            </p>
          </div>
          <code className="shrink-0 rounded-lg border border-white/8 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">
            k6 run k6/scripts/live-demo.js
          </code>
        </div>
      </div>
    </section>
  );
}

