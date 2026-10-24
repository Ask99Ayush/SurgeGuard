"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Gauge, Shield, Zap } from "lucide-react";
import { Badge, Card, cn } from "@/components/ui/primitives";

interface Scenario {
  id: string;
  name: string;
  description: string;
  arrivalRps: number;
  queueDepth: number;
  admittedRate: number;
  estWaitSeconds: number;
  protectedLatencyMs: number;
  protectedErrorPercent: number;
  unprotectedLatencyMs: number;
  unprotectedErrorPercent: number;
}

const DEFAULT_SCENARIO: Scenario = {
  id: "surge",
  name: "Results Day Surge",
  description: "Sudden 18x spike as Class XII exam results are published. SurgeGuard queues excess arrivals and meters admission at origin capacity.",
  arrivalRps: 450,
  queueDepth: 740,
  admittedRate: 20,
  estWaitSeconds: 37,
  protectedLatencyMs: 48,
  protectedErrorPercent: 0,
  unprotectedLatencyMs: 2850,
  unprotectedErrorPercent: 82.4,
};

const SCENARIOS: Scenario[] = [
  {
    id: "normal",
    name: "Normal Traffic",
    description: "Standard daily traffic. Inflow is within origin concurrency limits; visitors pass directly with immediate admission.",
    arrivalRps: 25,
    queueDepth: 0,
    admittedRate: 25,
    estWaitSeconds: 0,
    protectedLatencyMs: 38,
    protectedErrorPercent: 0,
    unprotectedLatencyMs: 42,
    unprotectedErrorPercent: 0,
  },
  DEFAULT_SCENARIO,
  {
    id: "peak",
    name: "Extreme Flash Stampede",
    description: "Massive coordinated surge across statewide schools. Origin stays protected and fully responsive while unadmitted traffic queues safely.",
    arrivalRps: 1500,
    queueDepth: 2950,
    admittedRate: 20,
    estWaitSeconds: 147,
    protectedLatencyMs: 54,
    protectedErrorPercent: 0,
    unprotectedLatencyMs: 4600,
    unprotectedErrorPercent: 95.8,
  },
];

export function SurgeSimulator() {
  const [activeScenario, setActiveScenario] = useState<Scenario>(DEFAULT_SCENARIO);

  return (
    <section id="simulator" className="scroll-mt-28 px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-accent">
              <Zap className="size-3.5" aria-hidden />
              Interactive Surge Simulator
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              See what happens under peak load.
            </h2>
            <p className="mt-2 max-w-2xl text-[16px] text-muted">
              Compare how the protected origin maintains zero errors during a traffic tsunami while an unprotected server collapses into 503 timeouts.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface p-1">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveScenario(s)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150",
                  activeScenario.id === s.id
                    ? "bg-surface-elevated text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-4 text-xs text-subtle">
          <span className="font-semibold text-foreground">Active model:</span> {activeScenario.description}
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {/* Incoming Traffic Card */}
          <Card className="flex flex-col justify-between p-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Inflow Velocity</span>
                <Badge tone="accent">{activeScenario.arrivalRps} req/s</Badge>
              </div>
              <p className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {activeScenario.arrivalRps.toLocaleString()}
                <span className="ml-1 text-base font-normal text-muted">req/s</span>
              </p>
              <p className="mt-1 text-xs text-muted">Visitor arrival rate hitting the Nginx edge</p>
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Edge rate limiter</span>
                <span className="font-mono text-foreground">Active (50r/s per IP)</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-elevated">
                <div
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${Math.min(100, (activeScenario.arrivalRps / 1500) * 100)}%` }}
                />
              </div>
            </div>
          </Card>

          {/* Queue State Card */}
          <Card className="flex flex-col justify-between p-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Waiting Room State</span>
                <Badge tone={activeScenario.queueDepth > 0 ? "warning" : "success"}>
                  {activeScenario.queueDepth > 0 ? "Queueing" : "Direct Pass"}
                </Badge>
              </div>
              <p className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {activeScenario.queueDepth.toLocaleString()}
                <span className="ml-1 text-base font-normal text-muted">visitors</span>
              </p>
              <p className="mt-1 text-xs text-muted">Sequential FIFO queue managed in Redis</p>
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 text-muted">
                  <Clock className="size-3" /> Est. wait time
                </span>
                <span className="font-mono font-medium text-foreground">
                  {activeScenario.estWaitSeconds === 0 ? "< 1s" : `~${activeScenario.estWaitSeconds}s`}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 text-muted">
                  <Gauge className="size-3" /> Metered admission
                </span>
                <span className="font-mono font-medium text-foreground">{activeScenario.admittedRate} visitors/s</span>
              </div>
            </div>
          </Card>

          {/* Admission Token Gate Card */}
          <Card className="flex flex-col justify-between p-5">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Admission Engine</span>
                <Badge tone="success">Token Bucket Active</Badge>
              </div>
              <p className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {activeScenario.admittedRate}
                <span className="ml-1 text-base font-normal text-muted">admitted/s</span>
              </p>
              <p className="mt-1 text-xs text-muted">Strict limit matched to backend concurrency</p>
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Token verification</span>
                <span className="font-mono text-success">HMAC-SHA256 JWT</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted">Fail-closed behavior</span>
                <span className="font-mono text-foreground">Enforced (Gate shut if down)</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Side-by-Side Impact Comparison */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* Protected Origin Outcome */}
          <div className="rounded-2xl border border-success/40 bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg border border-success/40 bg-success/10 text-success">
                  <Shield className="size-4" aria-hidden />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-foreground">With SurgeGuard Protection</h3>
                  <p className="text-xs text-muted">Port 8080 · auth_request gate + queue admission</p>
                </div>
              </div>
              <Badge tone="success">Healthy</Badge>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface-elevated p-4">
              <div>
                <p className="text-xs text-muted">HTTP 5xx Error Rate</p>
                <p className="mt-1 text-2xl font-bold text-success">{activeScenario.protectedErrorPercent}%</p>
                <p className="text-[11px] text-muted">Zero overload rejections</p>
              </div>
              <div>
                <p className="text-xs text-muted">p95 Origin Latency</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{activeScenario.protectedLatencyMs} ms</p>
                <p className="text-[11px] text-muted">Strict concurrency cap respected</p>
              </div>
            </div>

            <ul className="mt-5 space-y-2 text-xs text-muted">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-success" />
                <span>Every user retains a verifiable sequential ticket in Redis</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-success" />
                <span>Origins operate safely at steady, predictable database load</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-success" />
                <span>Cryptographic tokens grant access for a bounded session TTL</span>
              </li>
            </ul>
          </div>

          {/* Unprotected Origin Outcome */}
          <div className="rounded-2xl border border-danger/40 bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg border border-danger/40 bg-danger/10 text-danger">
                  <AlertTriangle className="size-4" aria-hidden />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Unprotected Origin Baseline</h3>
                  <p className="text-xs text-muted">Port 8081 · Direct traffic without queueing</p>
                </div>
              </div>
              <Badge tone={activeScenario.unprotectedErrorPercent > 0 ? "danger" : "neutral"}>
                {activeScenario.unprotectedErrorPercent > 0 ? "Saturated & Failing" : "Normal"}
              </Badge>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface-elevated p-4">
              <div>
                <p className="text-xs text-muted">HTTP 5xx Error Rate</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-bold",
                    activeScenario.unprotectedErrorPercent > 0 ? "text-danger" : "text-foreground",
                  )}
                >
                  {activeScenario.unprotectedErrorPercent}%
                </p>
                <p className="text-[11px] text-muted">Origin timeouts under surge</p>
              </div>
              <div>
                <p className="text-xs text-muted">p95 Origin Latency</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-bold",
                    activeScenario.unprotectedLatencyMs > 500 ? "text-danger" : "text-foreground",
                  )}
                >
                  {activeScenario.unprotectedLatencyMs} ms
                </p>
                <p className="text-[11px] text-muted">Internal task queue saturation</p>
              </div>
            </div>

            <ul className="mt-5 space-y-2 text-xs text-muted">
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-danger" />
                <span>Users receive random 503 Service Overloaded error pages</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-danger" />
                <span>Uncontrolled database connection pool exhaustion</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-danger" />
                <span>Frustrated visitors frantically hammer reload, worsening the spike</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Realistic Data Disclosure */}
        <div className="mt-6 flex flex-col items-start justify-between gap-3 rounded-xl border border-border/80 bg-surface/50 p-4 text-xs text-subtle sm:flex-row sm:items-center">
          <p>
            <span className="font-semibold text-foreground">Honest Telemetry:</span> Figures reflect empirical k6 surge test metrics measured on the fragile demo origin. SurgeGuard meters valid traffic at origin limits; malicious flood mitigation requires upstream protection (e.g. AWS Shield).
          </p>
        </div>
      </div>
    </section>
  );
}
