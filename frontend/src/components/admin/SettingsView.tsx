"use client";

import { useState } from "react";
import { Check, ChevronRight, Copy, ExternalLink, Info } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import type { PromStatus } from "@/components/admin/types";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";

type Value = string | number | boolean | string[] | null;
type Config = Record<string, Value> & { defaults?: Record<string, Value> };

const GROUPS: { title: string; hint?: string; rows: [key: string, label: string, unit?: string][] }[] = [
  {
    title: "Queue",
    hint: "Controls virtual waiting room queue depth, admission velocity, and polling interval.",
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
    ],
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
    ],
  },
  {
    title: "Rate limits",
    hint: "App-level IP join limiter. Nginx proxy rate limits are configured separately in proxy templates.",
    rows: [
      ["rate_limit_requests", "Joins per IP per window", "requests"],
      ["rate_limit_window_seconds", "Window", "seconds"],
    ],
  },
  {
    title: "Health checks",
    hint: "Active HTTP probes evaluated by the admission worker daemon.",
    rows: [
      ["backends", "Backends"],
      ["backend_health_interval_seconds", "Check interval", "seconds"],
      ["backend_health_failure_threshold", "Failures before down", "probes"],
      ["backend_health_recovery_threshold", "Successes before up", "probes"],
    ],
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

function Group({ title, hint, rows, config }: (typeof GROUPS)[number] & { config: Config }) {
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

            return (
              <div key={key} className="flex items-center gap-3 px-3.5 py-2.5 text-xs">
                <dt className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{label}</span>
                  <span className="sr-only"> ({key})</span>
                </dt>
                {differs ? (
                  <span title={`Default: ${show(defaults[key])}`}>
                    <Badge tone="accent">changed</Badge>
                  </span>
                ) : null}
                <dd className="max-w-[45%] truncate font-mono tabular-nums text-foreground" title={value}>
                  {value} {unit ? <span className="text-subtle font-sans text-[11px]">{unit}</span> : null}
                </dd>
                <CopyButton text={value} label={label} />
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
        title="System Configuration"
        description="Effective runtime parameters across admission engine, token verification, and health policies."
        breadcrumbs={[{ label: "Operations", href: "/dashboard" }, { label: "Settings" }]}
      />

      {/* RUNTIME DISCLAIMER BANNER */}
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 text-xs text-muted">
        <Info className="size-4 text-accent shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Immutable Runtime Configuration</p>
          <p className="mt-0.5 leading-relaxed">
            SurgeGuard enforces fail-closed immutability. Parameters below are loaded at container boot from environment variables and Docker configuration. To modify policies, update your `.env` or Compose spec and perform a rolling restart. Secret keys and credentials are intentionally never transmitted to the browser.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* LEFT COLUMN: PARAMETER GROUPS */}
        <Card className="overflow-hidden lg:col-span-2">
          {config.status === "loading" ? (
            <div className="space-y-3 p-5" aria-label="Loading settings">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="block h-12 animate-pulse rounded-xl bg-surface-elevated" />
              ))}
            </div>
          ) : !config.data ? (
            <StateView
              kind={config.status === "disconnected" ? "disconnected" : "error"}
              title="Configuration unavailable"
              message="The SurgeGuard API did not respond."
              compact
              onRetry={config.refresh}
            />
          ) : (
            GROUPS.map((g) => <Group key={g.title} {...g} config={config.data as Config} />)
          )}
        </Card>

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
              ["Grafana Dashboards", grafanaUrl],
              ["Protected Origin Gateway", siteUrl],
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
