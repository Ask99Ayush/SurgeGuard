/** Named, server-side PromQL. The browser can only pick a name, never send a query. */
export const QUERIES = {
  queue_length: "max(surgeguard_queue_length)",
  admission_rate: "sum(rate(surgeguard_admissions_total[1m]))",
  admitted_active: "max(surgeguard_admitted_active)",
  origin_rps: "sum(rate(demo_requests_total[1m]))",
  origin_error_ratio:
    'sum(rate(demo_requests_total{status=~"5.."}[1m])) / sum(rate(demo_requests_total[1m]))',
  origin_p50_seconds: "histogram_quantile(0.50, sum by (le) (rate(demo_request_duration_seconds_bucket[1m])))",
  origin_p95_seconds: "histogram_quantile(0.95, sum by (le) (rate(demo_request_duration_seconds_bucket[1m])))",
  origin_p99_seconds: "histogram_quantile(0.99, sum by (le) (rate(demo_request_duration_seconds_bucket[1m])))",
  origin_rps_by_origin: "sum by (origin) (rate(demo_requests_total[1m]))",
  origin_p95_by_origin:
    "histogram_quantile(0.95, sum by (le, origin) (rate(demo_request_duration_seconds_bucket[1m])))",
  wait_p95_seconds: "histogram_quantile(0.95, sum by (le) (rate(surgeguard_queue_wait_seconds_bucket[5m])))",
  token_rejections: "sum(rate(surgeguard_token_rejections_total[5m]))",
  tokens_issued: "sum(rate(surgeguard_tokens_issued_total[1m]))",
  tokens_validated: "sum(rate(surgeguard_token_validations_total[1m]))",
  auth_fail_closed: "sum(rate(surgeguard_auth_fail_closed_total[1m]))",
  edge_rps: "sum(rate(nginx_http_requests_total[1m]))",
  nginx_connections_active: "max(nginx_connections_active)",
  backends_healthy: "max(surgeguard_backends_healthy)",
  redis_memory_bytes: "max(redis_memory_used_bytes)",
  redis_ping_p95: "histogram_quantile(0.95, sum by (le) (rate(surgeguard_redis_ping_seconds_bucket[1m])))",
  upstream_5xx_rps: 'sum(rate(demo_requests_total{status=~"5.."}[1m]))',
  origin_success_rps: 'sum(rate(demo_requests_total{status=~"2.."}[1m]))',
} as const;

export type QueryName = keyof typeof QUERIES;

export const RANGES = {
  "15m": { seconds: 900, step: 15 },
  "1h": { seconds: 3600, step: 30 },
  "6h": { seconds: 21600, step: 120 },
  "24h": { seconds: 86400, step: 300 },
} as const;

export type RangeName = keyof typeof RANGES;

export function isQueryName(value: string | null): value is QueryName {
  return value !== null && Object.prototype.hasOwnProperty.call(QUERIES, value);
}

export function isRangeName(value: string | null): value is RangeName {
  return value !== null && Object.prototype.hasOwnProperty.call(RANGES, value);
}

export interface SeriesPoint {
  t: number;
  v: number | null;
}

export interface Series {
  labels: Record<string, string>;
  points: SeriesPoint[];
}

interface PromMatrix {
  status: string;
  data?: { resultType: string; result: Array<{ metric: Record<string, string>; values?: [number, string][]; value?: [number, string] }> };
}

/** NaN / Inf (e.g. a quantile with no traffic) become null — "no data", never zero. */
function num(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parsePromResult(body: PromMatrix): Series[] {
  if (body.status !== "success" || !body.data) throw new Error("prometheus query failed");
  return body.data.result.map((r) => ({
    labels: r.metric,
    points: r.values
      ? r.values.map(([t, v]) => ({ t: t * 1000, v: num(v) }))
      : r.value
        ? [{ t: r.value[0] * 1000, v: num(r.value[1]) }]
        : [],
  }));
}
