import type {
  BackendsResponse,
  EventItem,
  Overview,
  PromStatus,
  VisitorPage,
  VisitorRow,
} from "@/components/admin/types";
import { type QueryName, type RangeName, RANGES } from "@/lib/promql";

interface ExhibitionState {
  isPaused: boolean;
  pausedSince: number | null;
  pauseReason: string | null;
  pauseActor: string | null;
  rejectedIds: Set<string>;
  events: EventItem[];
}

const state: ExhibitionState = {
  isPaused: false,
  pausedSince: null,
  pauseReason: null,
  pauseActor: null,
  rejectedIds: new Set<string>(),
  events: [
    {
      ts_ms: Date.now() - 5000,
      kind: "admission.admitted",
      level: "info",
      message: "Visitor #1 admitted with cryptographically signed token (kid: k3, ttl: 300s)",
      data: { rate: 10, position: 1, duration_ms: 12 },
    },
    {
      ts_ms: Date.now() - 12000,
      kind: "token_bucket.refilled",
      level: "info",
      message: "Token bucket capacity replenished: +10 admission slots available",
      data: { capacity: 10, interval: "1s" },
    },
    {
      ts_ms: Date.now() - 22000,
      kind: "health.check_passed",
      level: "info",
      message: "Backend demo-1 healthy: HTTP 200 OK (latency: 11.8ms)",
      data: { backend: "demo-1", latency_ms: 11.8 },
    },
    {
      ts_ms: Date.now() - 35000,
      kind: "health.check_passed",
      level: "info",
      message: "Backend demo-2 healthy: HTTP 200 OK (latency: 14.2ms)",
      data: { backend: "demo-2", latency_ms: 14.2 },
    },
    {
      ts_ms: Date.now() - 50000,
      kind: "queue.heartbeat",
      level: "info",
      message: "Active heartbeat sync acknowledged across 142 waiting visitors",
      data: { waiting_total: 142, interval_seconds: 3 },
    },
    {
      ts_ms: Date.now() - 75000,
      kind: "auth.sudo_session",
      level: "info",
      message: "Root Administrator signed in with full sudo privileges from console",
      data: { user: "admin", role: "admin", access: "sudo" },
    },
    {
      ts_ms: Date.now() - 110000,
      kind: "admission.rate_measured",
      level: "info",
      message: "Admission rate stable: 9.8 req/s (target: 10.0 req/s, burst: 10)",
      data: { rate: 9.8, target: 10 },
    },
    {
      ts_ms: Date.now() - 150000,
      kind: "proxy.nginx_auth",
      level: "info",
      message: "Nginx subrequest /internal/auth verified fail-closed JWT signature",
      data: { auth_subrequest_ms: 0.9, algorithm: "HS256" },
    },
  ],
};

/** Dynamic, realistic overview of queue, worker, redis and backend health. */
export function getExhibitionOverview(): Overview {
  const now = Date.now();
  // Minor dynamic oscillation (±3) based on time so numbers feel alive
  const variance = Math.floor(now / 3500) % 7 - 3;
  const waiting = Math.max(120, 142 + variance);
  const admittedActive = Math.max(70, 84 + (Math.floor(now / 4000) % 5));
  const measuredRate = state.isPaused ? 0 : 9.8 + (Math.floor(now / 2000) % 3) * 0.1;

  return {
    generated_at_ms: now,
    queue: {
      waiting,
      admitted_active: admittedActive,
      counts: {
        waiting,
        admitted: 3420 + Math.floor((now % 100000) / 1000),
        expired: 18,
        rejected: 4 + state.rejectedIds.size,
      },
      totals: {
        joined: 3584 + waiting,
        admitted: 3420,
        expired: 18,
        rejected: 4 + state.rejectedIds.size,
      },
    },
    admission: {
      configured_rate: 10,
      measured_rate_per_s: measuredRate,
      admitted_in_window: state.isPaused ? 0 : 588,
      window_seconds: 60,
      paused: state.isPaused
        ? {
            reason: state.pauseReason || "Manual administrative hold via Console",
            actor: state.pauseActor || "admin",
            since_ms: state.pausedSince || now - 15000,
          }
        : null,
      auto_paused: null,
    },
    worker: {
      alive: true,
      worker_id: "worker-surgeguard-main-01",
      last_tick_ms: now - 180,
      effective_rate: state.isPaused ? 0 : 10,
      backends_healthy: 2,
      backends_total: 2,
      auto_paused: false,
    },
    redis: {
      ok: true,
      latency_ms: 1.2,
    },
    backends: {
      total: 2,
      healthy: 2,
      reporting: 2,
    },
  };
}

/** Interactive pause queue */
export function pauseExhibitionQueue(reason = "Administrative pause via Console", actor = "admin") {
  state.isPaused = true;
  state.pausedSince = Date.now();
  state.pauseReason = reason;
  state.pauseActor = actor;
  state.events.unshift({
    ts_ms: Date.now(),
    kind: "queue.paused",
    level: "warning",
    message: `Queue admission paused by administrator (${actor}): ${reason}`,
    data: { actor, reason },
  });
  return { ok: true, paused: true, reason, actor };
}

/** Interactive resume queue */
export function resumeExhibitionQueue() {
  state.isPaused = false;
  state.pausedSince = null;
  state.pauseReason = null;
  state.pauseActor = null;
  state.events.unshift({
    ts_ms: Date.now(),
    kind: "queue.resumed",
    level: "info",
    message: "Queue admission resumed by administrator. Gate token refill restarted.",
    data: { actor: "admin" },
  });
  return { ok: true, paused: false };
}

/** Returns backend service health and response latencies */
export function getExhibitionBackends(): BackendsResponse {
  const now = Date.now();
  return {
    items: [
      {
        name: "demo-1 (Catalog Origin)",
        url: "http://demo-1:8000/health",
        healthy: true,
        consecutive_successes: 142,
        consecutive_failures: 0,
        last_check_ms: now - 1200,
        last_latency_ms: 11.8,
        last_status_code: 200,
        last_error: null,
        last_change_ms: now - 3600000,
      },
      {
        name: "demo-2 (Checkout Origin)",
        url: "http://demo-2:8000/health",
        healthy: true,
        consecutive_successes: 138,
        consecutive_failures: 0,
        last_check_ms: now - 950,
        last_latency_ms: 14.2,
        last_status_code: 200,
        last_error: null,
        last_change_ms: now - 3600000,
      },
    ],
    checks_running: true,
    interval_seconds: 2,
  };
}

/** Returns audit log events */
export function getExhibitionEvents(limit = 200): EventItem[] {
  return state.events.slice(0, limit);
}

/** Sample visitor names & hashes */
const MOCK_VISITORS = [
  { id: "sg_v_7f9a2b4c1e08432a9f11ab", ip: "192.168.1.45" },
  { id: "sg_v_8e1b3d5f2a19543b0e22cd", ip: "10.0.4.12" },
  { id: "sg_v_9c2c4e6a3b20654c1f33ef", ip: "172.16.8.99" },
  { id: "sg_v_0d3d5f7b4c31765d2a44gh", ip: "192.168.2.14" },
  { id: "sg_v_1e4e6a8c5d42876e3b55ij", ip: "10.21.130.40" },
  { id: "sg_v_2f5f7b9d6e53987f4c66kl", ip: "192.168.10.8" },
  { id: "sg_v_3a6a8c0e7f64098a5d77mn", ip: "172.20.1.55" },
  { id: "sg_v_4b7b9d1f8a75109b6e88op", ip: "10.100.5.21" },
  { id: "sg_v_5c8c0e2a9b86210c7f99qr", ip: "192.168.3.77" },
  { id: "sg_v_6d9d1f3b0c97321d8a00st", ip: "172.18.9.11" },
  { id: "sg_v_7e0e2a4c1d08432e9b11uv", ip: "10.0.12.84" },
  { id: "sg_v_8f1f3b5d2e19543f0c22wx", ip: "192.168.5.63" },
  { id: "sg_v_9a2a4c6e3f20654a1d33yz", ip: "172.19.4.2" },
  { id: "sg_v_0b3b5d7f4a31765b2e44aa", ip: "10.50.3.18" },
  { id: "sg_v_1c4c6e8a5b42876c3f55bb", ip: "192.168.8.90" },
];

/** Returns paginated visitor list */
export function getExhibitionVisitors(filterState: string, page = 1, pageSize = 25, q = ""): VisitorPage {
  const now = Date.now();
  const allItems: VisitorRow[] = [];

  // Generate admitted visitors
  for (let i = 0; i < 10; i++) {
    const item = MOCK_VISITORS[i % MOCK_VISITORS.length] ?? { id: `sg_v_mock_admit_${i}` };
    const visitorId = item.id;
    const isRejected = state.rejectedIds.has(visitorId);
    allItems.push({
      visitor_id: visitorId,
      state: isRejected ? "rejected" : "admitted",
      position: null,
      seq: i + 1,
      joined_at_ms: now - (600 - i * 30) * 1000,
      updated_at_ms: now - (30 - i * 2) * 1000,
      admitted_at_ms: now - (120 - i * 10) * 1000,
      token_expires_at_ms: now + (180 + i * 10) * 1000,
      expired_reason: null,
      reject_reason: isRejected ? "Ejected by root administrator during exhibition demo" : null,
    });
  }

  // Generate waiting visitors in queue
  for (let i = 0; i < 20; i++) {
    const item = MOCK_VISITORS[(i + 5) % MOCK_VISITORS.length] ?? { id: `sg_v_mock_wait_${i}` };
    const visitorId = `${item.id.slice(0, -2)}${i.toString(16).padStart(2, "0")}`;
    const isRejected = state.rejectedIds.has(visitorId);
    allItems.push({
      visitor_id: visitorId,
      state: isRejected ? "rejected" : "waiting",
      position: isRejected ? null : i + 1,
      seq: 11 + i,
      joined_at_ms: now - (180 - i * 6) * 1000,
      updated_at_ms: now - (3 - (i % 3)) * 1000,
      admitted_at_ms: null,
      token_expires_at_ms: null,
      expired_reason: null,
      reject_reason: isRejected ? "Ejected by root administrator during exhibition demo" : null,
    });
  }

  // Filter items
  const filtered = allItems.filter((item) => {
    if (filterState !== "all" && item.state !== filterState) return false;
    if (q && !item.visitor_id.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  return {
    state: filterState as VisitorPage["state"],
    total: filtered.length,
    page,
    page_size: pageSize,
    items: paginated,
  };
}

/** Reject visitor */
export function rejectExhibitionVisitor(visitorId: string, reason = "Ejected by Root Admin") {
  state.rejectedIds.add(visitorId);
  state.events.unshift({
    ts_ms: Date.now(),
    kind: "visitor.rejected",
    level: "warning",
    message: `Visitor ${visitorId.slice(0, 10)}… ejected from admission queue by Root Admin`,
    data: { visitor_id: visitorId, reason },
  });
  return { ok: true, visitor_id: visitorId, rejected: true };
}

/** Returns configuration matching .env */
export function getExhibitionConfig() {
  return {
    app_env: "development",
    admission_rate: 10,
    admission_burst: 10,
    queue_max_size: 100000,
    token_ttl_seconds: 300,
    heartbeat_timeout_seconds: 30,
    rejoin_grace_seconds: 60,
    visitor_record_ttl_seconds: 86400,
    cookie_secure: false,
    metrics_enabled: true,
    defaults: {
      admission_burst: 10,
      token_ttl_seconds: 300,
    },
  };
}

/** Returns realistic Prometheus series for charts */
export function getExhibitionMetricSeries(name: QueryName, range: RangeName) {
  const { seconds, step } = RANGES[range];
  const now = Math.floor(Date.now() / 1000);
  const start = now - seconds;
  const points: Array<{ t: number; v: number | null }> = [];

  let baseVal = 10;
  let isConstant = false;

  switch (name) {
    case "edge_rps":
      baseVal = 28.5;
      break;
    case "origin_rps":
      baseVal = 18.2;
      break;
    case "queue_length":
      baseVal = 138;
      break;
    case "admission_rate":
      baseVal = 9.8;
      break;
    case "admission_rate_configured":
      baseVal = 10.0;
      isConstant = true;
      break;
    case "admission_rate_effective":
      baseVal = 9.8;
      break;
    case "admitted_active":
      baseVal = 84;
      break;
    case "origin_p50_seconds":
      baseVal = 0.012;
      break;
    case "origin_p95_seconds":
      baseVal = 0.024;
      break;
    case "origin_p99_seconds":
      baseVal = 0.048;
      break;
    case "origin_error_ratio":
      baseVal = 0.0005;
      break;
    case "tokens_issued":
      baseVal = 9.8;
      break;
    case "queue_joins_rps":
      baseVal = 12.2;
      break;
    case "token_rejections":
      baseVal = 0.3;
      break;
    case "tokens_expired":
      baseVal = 0.1;
      break;
    case "redis_memory_bytes":
      baseVal = 134217728; // 128 MB
      break;
    case "redis_ping_p95":
      baseVal = 0.0018; // 1.8 ms
      break;
    case "backends_healthy":
      baseVal = 2;
      isConstant = true;
      break;
    case "worker_ticks_rps":
      baseVal = 2.0;
      break;
    case "worker_last_tick_age":
      baseVal = 0.2;
      break;
    default:
      if (name.includes("p95") || name.includes("p50")) baseVal = 0.015;
      else if (name.includes("queue")) baseVal = 140;
      else if (name.includes("rate")) baseVal = 9.8;
      break;
  }

  for (let t = start; t <= now; t += step) {
    let noise = 0;
    if (!isConstant) {
      if (baseVal > 100) {
        noise = Math.sin(t / 90) * (baseVal * 0.12) + Math.cos(t / 25) * (baseVal * 0.05);
      } else if (baseVal > 1) {
        noise = Math.sin(t / 45) * (baseVal * 0.1) + Math.cos(t / 15) * (baseVal * 0.05);
      } else {
        noise = Math.sin(t / 30) * (baseVal * 0.15);
      }
    }
    const rawVal = baseVal + noise;
    const val = Number(rawVal.toFixed(baseVal >= 10 ? 1 : 4));
    points.push({ t: t * 1000, v: Math.max(0, val) });
  }

  return [
    {
      labels: { job: "surgeguard-api", metric: name },
      points,
    },
  ];
}

/** Returns Prometheus scrape targets status */
export function getExhibitionMetricStatus(): PromStatus {
  return {
    targets: [
      {
        job: "surgeguard-api",
        instance: "127.0.0.1:8000",
        health: "up",
        lastScrape: new Date(Date.now() - 2000).toISOString(),
        lastError: null,
      },
      {
        job: "nginx-edge",
        instance: "127.0.0.1:8080",
        health: "up",
        lastScrape: new Date(Date.now() - 3000).toISOString(),
        lastError: null,
      },
      {
        job: "redis",
        instance: "127.0.0.1:6379",
        health: "up",
        lastScrape: new Date(Date.now() - 1500).toISOString(),
        lastError: null,
      },
      {
        job: "demo-backends",
        instance: "127.0.0.1:8081",
        health: "up",
        lastScrape: new Date(Date.now() - 2500).toISOString(),
        lastError: null,
      },
    ],
    alerts: [],
  };
}
