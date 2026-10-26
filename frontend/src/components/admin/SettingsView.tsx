"use client";

import { useState } from "react";
import { Check, ChevronRight, Copy, ExternalLink, Info, Sliders, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import type { PromStatus } from "@/components/admin/types";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { getGrafanaBaseUrl, getProtectedSiteUrl } from "@/lib/urls";
import { usePolling } from "@/hooks/usePolling";

type Value = string | number | boolean | string[] | null;
type Config = Record<string, Value> & { defaults?: Record<string, Value> };

const FIELD_HELPERS: Record<string, string> = {
  admission_rate: "Visitors admitted per second to origin servers during high traffic.",
  admission_burst: "Initial burst of admissions permitted when a traffic spike begins.",
  max_active_admitted: "Maximum concurrent active visitors allowed on the origin at once.",
  queue_max_size: "Maximum waiting queue capacity before rejecting new visitors.",
  queue_poll_interval_seconds: "Polling cadence for queue position updates and client heartbeats.",
  heartbeat_timeout_seconds: "Duration of client inactivity before a queue spot is released.",
  rejoin_grace_seconds: "Grace window to preserve queue spot if connection drops.",
  wait_estimate_window_seconds: "Rolling time window used to calculate typical wait time.",
  wait_estimate_min_samples: "Minimum recent admissions needed to display wait estimate.",
  token_ttl_seconds: "How long an admitted visitor can browse the site before re-verifying.",
  token_issuer: "Cryptographic issuer identifier embedded in admission JWTs.",
  token_audience: "Intended audience verified by Nginx edge proxy.",
  token_signing_kid: "Key identifier used to sign new admission tokens.",
  token_verify_kids: "Retired key identifiers accepted during key rotations.",
  cookie_secure: "Enforce HTTPS Secure flag on session and admission cookies.",
  rate_limit_requests: "Maximum join attempts permitted per IP per window.",
  rate_limit_window_seconds: "IP rate limiting time window.",
  backends: "List of protected origin application URLs.",
  backend_health_interval_seconds: "Frequency of background health check probes.",
  backend_health_failure_threshold: "Consecutive probe failures before backend is marked down.",
  backend_health_recovery_threshold: "Consecutive probe successes before backend is restored.",
};

const ADMISSION_GROUPS = [
  {
    title: "Queue",
    hint: "Controls virtual waiting room depth, admission velocity, and client polling.",
    rows: [
      ["admission_rate", "Admission rate", "admissions/s"],
      ["admission_burst", "Admission burst", "tokens"],
      ["max_active_admitted", "Max active admitted", "0 = no cap"],
      ["queue_max_size", "Queue max size", "visitors"],
      ["queue_poll_interval_seconds", "Poll interval", "seconds"],
      ["heartbeat_timeout_seconds", "Heartbeat timeout", "seconds"],
      ["rejoin_grace_seconds", "Rejoin grace window", "seconds"],
      ["wait_estimate_window_seconds", "Wait estimate window", "seconds"],
      ["wait_estimate_min_samples", "Min admissions for an estimate", "samples"],
    ] as [key: string, label: string, unit?: string][],
  },
  {
    title: "Tokens",
    hint: "HMAC-SHA256 JWT admission tokens validated at edge by Nginx auth_request.",
    rows: [
      ["token_ttl_seconds", "Token TTL", "seconds"],
      ["token_issuer", "Issuer"],
      ["token_audience", "Audience"],
      ["token_signing_kid", "Active key id"],
      ["token_verify_kids", "Retired keys accepted"],
      ["cookie_secure", "Secure cookies"],
    ] as [key: string, label: string, unit?: string][],
  },
];

const ADVANCED_GROUPS = [
  {
    title: "Rate limits",
    hint: "IP join limiter to prevent bot abuse before queue entry.",
    rows: [
      ["rate_limit_requests", "Joins per IP per window", "requests"],
      ["rate_limit_window_seconds", "Window", "seconds"],
    ] as [key: string, label: string, unit?: string][],
  },
  {
    title: "Health checks",
    hint: "Active HTTP probes evaluated continuously by the admission worker.",
    rows: [
      ["backends", "Backends"],
      ["backend_health_interval_seconds", "Check interval", "seconds"],
      ["backend_health_failure_threshold", "Failures before down", "probes"],
      ["backend_health_recovery_threshold", "Successes before up", "probes"],
    ] as [key: string, label: string, unit?: string][],
  },
];

function show(value: Value | undefined): string {
  if (value === null || value === undefined) return "unavailable";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title="Copy value"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className="grid size-7 shrink-0 place-items-center rounded-md text-subtle transition-colors duration-150 hover:bg-surface-elevated hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

function Group({ title, hint, rows, config }: { title: string; hint?: string; rows: [key: string, label: string, unit?: string][]; config: Config }) {
  const defaults = config.defaults ?? {};
  const changed = rows.filter(([key]) => key in defaults && show(defaults[key]) !== show(config[key])).length;

  return (
    <details open className="group border-b border-border last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 transition-colors duration-150 hover:bg-surface-elevated/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-subtle transition-transform duration-150 group-open:rotate-90" aria-hidden />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="ml-auto text-xs text-subtle">
          {rows.length} values{changed ? ` · ${changed} changed` : ""}
        </span>
      </summary>
      <div className="px-5 pb-4">
        {hint ? <p className="mb-2 text-xs text-subtle">{hint}</p> : null}
        <dl className="divide-y divide-border rounded-xl border border-border">
          {rows.map(([key, label, unit]) => {
            const value = show(config[key]);
            const hasDefault = key in defaults;
            const differs = hasDefault && show(defaults[key]) !== value;
            const helper = FIELD_HELPERS[key];

            return (
              <div key={key} className="flex flex-col gap-1 px-3.5 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                <dt className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{label}</span>
                    <span className="sr-only"> ({key})</span>
                    {differs ? (
                      <span title={`Default: ${show(defaults[key])}`}>
                        <Badge tone="accent">changed</Badge>
                      </span>
                    ) : null}
                  </div>
                  {helper ? <p className="mt-0.5 text-[11px] text-muted leading-tight">{helper}</p> : null}
                </dt>
                <dd className="flex items-center gap-2 max-w-full sm:max-w-[45%] font-mono tabular-nums text-foreground">
                  <span className="truncate" title={value}>{value}</span>
                  {unit ? <span className="text-subtle font-sans text-[11px] shrink-0">{unit}</span> : null}
                  <CopyButton text={value} label={label} />
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </details>
  );
}

export function SettingsView({ grafanaUrl, siteUrl }: { grafanaUrl: string | null; siteUrl: string | null }) {
  const config = usePolling<Config>("/api/admin/config", 30_000);
  const prom = usePolling<PromStatus>("/api/metrics/status", 30_000);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Runtime parameters across admission rate, token verification, and origin health checks."
        breadcrumbs={[{ label: "Operations", href: "/dashboard" }, { label: "Settings" }]}
      />

      {/* IMMUTABILITY EXPLANATION & SAVE / RESET ASSISTANCE */}
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 text-xs text-muted">
        <Info className="size-4 text-accent shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Fail-Closed Runtime Configuration</p>
          <p className="mt-0.5 leading-relaxed">
            Settings are loaded securely from environment variables. To update values, adjust <code className="font-mono">.env</code> or compose settings and reload. Secret keys and credentials are never transmitted to the browser.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* LEFT COLUMN: PARAMETER GROUPS */}
        <div className="space-y-6 lg:col-span-2">
          {config.status === "loading" ? (
            <Card className="p-5 space-y-3" aria-label="Loading settings">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="block h-12 animate-pulse rounded-xl bg-surface-elevated" />
              ))}
            </Card>
          ) : !config.data ? (
            <Card className="p-5">
              <StateView
                kind={config.status === "disconnected" ? "disconnected" : "error"}
                title="Configuration unavailable"
                message="The SurgeGuard API did not respond."
                compact
                onRetry={config.refresh}
              />
            </Card>
          ) : (
            <>
              {/* SECTION 1: ADMISSION */}
              <Card className="overflow-hidden">
                <div className="border-b border-border bg-surface-elevated/40 px-5 py-3.5 flex items-center gap-2">
                  <Sliders className="size-4 text-accent" />
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Admission</h2>
                    <p className="text-xs text-muted">Virtual waiting room throughput and token validity</p>
                  </div>
                </div>
                {ADMISSION_GROUPS.map((g) => (
                  <Group key={g.title} {...g} config={config.data as Config} />
                ))}
              </Card>

              {/* SECTION 2: ADVANCED */}
              <Card className="overflow-hidden">
                <div className="border-b border-border bg-surface-elevated/40 px-5 py-3.5 flex items-center gap-2">
                  <ShieldCheck className="size-4 text-warning" />
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Advanced</h2>
                    <p className="text-xs text-muted">Client abuse rate limiting and origin health check policies</p>
                  </div>
                </div>
                {ADVANCED_GROUPS.map((g) => (
                  <Group key={g.title} {...g} config={config.data as Config} />
                ))}
              </Card>
            </>
          )}
        </div>

        {/* RIGHT COLUMN: INTEGRATIONS & CONNECTIVITY */}
        <Card className="h-fit">
          <CardHeader title="Cluster Integrations" description="Connectivity as seen by the console server." />
          <ul className="divide-y divide-border px-5 pb-4 pt-1 text-xs">
            <li className="flex items-center justify-between py-2.5">
              <span className="font-medium text-foreground">Environment</span>
              <span className="font-mono text-xs">{config.data ? show(config.data.app_env) : "—"}</span>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span className="font-medium text-foreground">SurgeGuard Control Plane</span>
              <Badge tone={config.data ? "success" : config.status === "loading" ? "neutral" : "danger"} dot>
                {config.data ? "connected" : config.status === "loading" ? "checking" : "unreachable"}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span className="font-medium text-foreground">Redis State Store</span>
              <span className="font-mono text-xs">{config.data ? show(config.data.redis_version) : "—"}</span>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span className="font-medium text-foreground">Prometheus Engine</span>
              <Badge tone={prom.data ? "success" : prom.status === "loading" ? "neutral" : "danger"} dot>
                {prom.data
                  ? `${prom.data.targets.filter((t) => t.health === "up").length}/${prom.data.targets.length} scrape targets`
                  : prom.status === "loading"
                    ? "checking"
                    : "unreachable"}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span className="font-medium text-foreground">Prometheus Metrics Path</span>
              <span className="font-mono text-xs">{config.data ? show(config.data.metrics_enabled) : "—"}</span>
            </li>
            {[
              ["Grafana Dashboards", getGrafanaBaseUrl(grafanaUrl)],
              ["Protected Origin Gateway", getProtectedSiteUrl(siteUrl)],
            ].map(([label, url]) => (
              <li key={label} className="flex items-center justify-between py-2.5">
                <span className="font-medium text-foreground">{label}</span>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-accent hover:underline font-medium"
                  >
                    <span>Open</span>
                    <ExternalLink className="size-3" />
                  </a>
                ) : (
                  <Badge>not configured</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
