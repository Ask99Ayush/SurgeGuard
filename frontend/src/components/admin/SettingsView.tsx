"use client";

import { useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import type { PromStatus } from "@/components/admin/types";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { StateView } from "@/components/ui/StateView";
import { usePolling } from "@/hooks/usePolling";

type Value = string | number | boolean | string[] | null;
type Config = Record<string, Value> & { defaults?: Record<string, Value> };

/** The API reports values and code defaults, but not where each value came from, so no source is shown. */
const GROUPS: { title: string; hint?: string; rows: [key: string, label: string][] }[] = [
  {
    title: "Queue",
    rows: [
      ["admission_rate", "Admission rate (/s)"],
      ["admission_burst", "Admission burst"],
      ["max_active_admitted", "Max active admitted (0 = no cap)"],
      ["queue_max_size", "Queue max size"],
      ["queue_poll_interval_seconds", "Poll interval (s)"],
      ["heartbeat_timeout_seconds", "Heartbeat timeout (s)"],
      ["rejoin_grace_seconds", "Rejoin grace window (s)"],
      ["wait_estimate_window_seconds", "Wait estimate window (s)"],
      ["wait_estimate_min_samples", "Min admissions for an estimate"],
    ],
  },
  {
    title: "Tokens",
    hint: "Rotate keys with scripts/rotate-token-key.sh; retired keys stay valid until their tokens expire.",
    rows: [
      ["token_ttl_seconds", "Token TTL (s)"],
      ["token_issuer", "Issuer"],
      ["token_audience", "Audience"],
      ["token_signing_kid", "Active key id"],
      ["token_verify_kids", "Retired keys accepted"],
      ["cookie_secure", "Secure cookies"],
    ],
  },
  {
    title: "Rate limits",
    hint: "App-level join limit per client IP. Nginx limits are set in .env (PROXY_*).",
    rows: [
      ["rate_limit_requests", "Joins per IP per window"],
      ["rate_limit_window_seconds", "Window (s)"],
    ],
  },
  {
    title: "Health checks",
    rows: [
      ["backends", "Backends"],
      ["backend_health_interval_seconds", "Check interval (s)"],
      ["backend_health_failure_threshold", "Failures before down"],
      ["backend_health_recovery_threshold", "Successes before up"],
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
        <span className="text-base font-semibold">{title}</span>
        <span className="ml-auto text-xs text-subtle">
          {rows.length} values{changed ? ` · ${changed} changed` : ""}
        </span>
      </summary>
      <div className="px-5 pb-4">
        {hint ? <p className="mb-2 text-xs text-subtle">{hint}</p> : null}
        <dl className="divide-y divide-border rounded-lg border border-border">
          {rows.map(([key, label]) => {
            const value = show(config[key]);
            const hasDefault = key in defaults;
            const differs = hasDefault && show(defaults[key]) !== value;
            return (
              <div key={key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <dt className="min-w-0 flex-1 text-muted">
                  {label}
                  <span className="sr-only"> ({key})</span>
                </dt>
                {differs ? (
                  <span title={`Default: ${show(defaults[key])}`}>
                    <Badge tone="accent">changed</Badge>
                  </span>
                ) : null}
                <dd className="max-w-[45%] truncate font-mono text-xs tabular-nums text-foreground" title={value}>
                  {value}
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
      <PageHeader title="Settings" description="Non-secret configuration in effect. Edit .env and restart to change." />
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          {config.status === "loading" ? (
            <div className="space-y-3 p-5" aria-label="Loading settings">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="block h-10 animate-pulse rounded-lg bg-surface-elevated" />
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

        <Card>
          <CardHeader title="Integrations" description="Reachability from the console server." />
          <ul className="divide-y divide-border px-5 pb-4 pt-2 text-sm">
            <li className="flex items-center justify-between py-2.5">
              <span>Environment</span>
              <span className="font-mono text-xs">{config.data ? show(config.data.app_env) : "—"}</span>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span>SurgeGuard API</span>
              <Badge tone={config.data ? "success" : config.status === "loading" ? "neutral" : "danger"} dot>
                {config.data ? "connected" : config.status === "loading" ? "checking" : "unreachable"}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span>Redis</span>
              <span className="font-mono text-xs">{config.data ? show(config.data.redis_version) : "—"}</span>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span>Prometheus</span>
              <Badge tone={prom.data ? "success" : prom.status === "loading" ? "neutral" : "danger"} dot>
                {prom.data
                  ? `${prom.data.targets.filter((t) => t.health === "up").length}/${prom.data.targets.length} targets up`
                  : prom.status === "loading"
                    ? "checking"
                    : "unreachable"}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span>Metrics endpoint</span>
              <span className="font-mono text-xs">{config.data ? show(config.data.metrics_enabled) : "—"}</span>
            </li>
            {[
              ["Grafana", grafanaUrl],
              ["Protected site", siteUrl],
            ].map(([label, url]) => (
              <li key={label} className="flex items-center justify-between py-2.5">
                <span>{label}</span>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="text-xs text-muted underline underline-offset-4 transition-colors duration-150 hover:text-foreground">
                    open
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
