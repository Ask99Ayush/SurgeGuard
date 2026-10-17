/** Shapes returned by the FastAPI admin API (see backend/app/api/admin.py). */

export interface PauseInfo {
  reason: string;
  actor?: string;
  since_ms: number;
}

export interface Overview {
  generated_at_ms: number;
  queue: {
    waiting: number;
    admitted_active: number;
    counts: Record<"waiting" | "admitted" | "expired" | "rejected", number>;
    totals: Record<string, number>;
  };
  admission: {
    configured_rate: number;
    measured_rate_per_s: number;
    admitted_in_window: number;
    window_seconds: number;
    paused: PauseInfo | null;
    auto_paused: PauseInfo | null;
  };
  worker: {
    alive: boolean;
    worker_id?: string;
    last_tick_ms?: number;
    effective_rate?: number;
    backends_healthy?: number;
    backends_total?: number;
    auto_paused?: boolean;
  };
  redis: { ok: boolean; latency_ms: number };
  backends: { total: number; healthy: number; reporting: number };
}

export interface EventItem {
  ts_ms: number;
  kind: string;
  level: "info" | "warning" | "error" | string;
  message: string;
  data: Record<string, unknown>;
}

export interface VisitorRow {
  visitor_id: string;
  state: string;
  position: number | null;
  seq: number | null;
  joined_at_ms: number | null;
  updated_at_ms: number | null;
  admitted_at_ms: number | null;
  token_expires_at_ms: number | null;
  expired_reason: string | null;
  reject_reason: string | null;
}

export interface VisitorPage {
  state: VisitorFilter;
  total: number;
  page: number;
  page_size: number;
  items: VisitorRow[];
}

export type VisitorState = "waiting" | "admitted" | "expired" | "rejected";
export type VisitorFilter = VisitorState | "all";

export interface BackendState {
  name: string;
  url: string;
  healthy: boolean | null;
  consecutive_failures?: number;
  consecutive_successes?: number;
  last_check_ms: number | null;
  last_latency_ms?: number | null;
  last_status_code?: number | null;
  last_error?: string | null;
  last_change_ms?: number | null;
}

export interface BackendsResponse {
  items: BackendState[];
  checks_running: boolean;
  interval_seconds: number;
}

export interface SeriesResponse {
  series: Array<{ labels: Record<string, string>; points: Array<{ t: number; v: number | null }> }>;
}

export interface PromStatus {
  targets: Array<{ job: string; instance: string; health: string; lastScrape: string; lastError: string | null }>;
  alerts: Array<{ name: string; severity: string; state: string; summary: string; activeAt: string }>;
}
