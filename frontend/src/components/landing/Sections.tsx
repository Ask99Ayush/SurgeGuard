import type { ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  BarChart3,
  Database,
  Gauge,
  Globe,
  ListOrdered,
  Server,
  ShieldCheck,
  Timer,
  Users,
  Workflow,
} from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { Kbd, cn } from "@/components/ui/primitives";

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-[13px] font-medium text-accent">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">{title}</h2>
      <p className="mt-4 text-[17px] leading-relaxed text-muted">{subtitle}</p>
    </div>
  );
}

const features = [
  {
    icon: ListOrdered,
    title: "Fair Queueing",
    text: "A server-side sequence decides who is next — never the browser clock, never the IP. Reconnect and keep your place.",
    detail: "Redis ZSET · INCR · Lua",
  },
  {
    icon: Gauge,
    title: "Controlled Admission",
    text: "A separate worker admits visitors at the rate you configure, with a fenced leader lock so nobody gets in twice.",
    detail: "Token bucket · leader lock · fencing",
  },
  {
    icon: ShieldCheck,
    title: "Backend Protection",
    text: "Nginx checks a signed admission token on every request. If the check can't run, the gate stays shut.",
    detail: "auth_request · JWT · fail closed",
  },
  {
    icon: Activity,
    title: "Observability",
    text: "Queue length, admission rate, wait time, token decisions and origin health, all exported as real metrics.",
    detail: "Prometheus · Grafana · alerts",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-28 px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Features"
          title="Built for the minute everything breaks."
          subtitle="Results day, fee deadlines, ticket drops. SurgeGuard turns a stampede into an orderly line in front of the site you already have."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, text, detail }) => (
            <article key={title} className="keycap flex flex-col p-5 transition-colors hover:border-border-strong">
              <span className="grid size-10 place-items-center rounded-xl border border-border bg-background text-foreground">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-5 text-base font-semibold tracking-[-0.01em]">{title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{text}</p>
              <p className="mt-5 font-mono text-[11px] text-subtle">{detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const steps = [
  { key: "1", title: "Visitor arrives", text: "No admission token? Nginx sends them to the waiting room instead of the origin." },
  { key: "2", title: "Joins the line", text: "An opaque signed cookie identifies them. Each status poll doubles as a heartbeat." },
  { key: "3", title: "Admitted in order", text: "The worker releases the next visitors at the configured rate, scaled down if backends fail." },
  { key: "4", title: "Browses normally", text: "A signed, time-limited token lets them use the site for its whole lifetime." },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-28 border-y border-border bg-surface/40 px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="How it works"
          title="Four steps, no rewrite."
          subtitle="SurgeGuard sits in front of your site. The application behind it does not change."
        />
        <ol className="mt-12 grid gap-4 md:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.key} className="relative">
              <div className="flex items-center gap-3">
                <Kbd>{step.key}</Kbd>
                {i < steps.length - 1 ? (
                  <span aria-hidden className="hidden h-px flex-1 bg-gradient-to-r from-border-strong to-transparent md:block" />
                ) : null}
              </div>
              <h3 className="mt-4 text-[15px] font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Node({ icon, title, sub, tone = "default", className }: {
  icon: ReactNode;
  title: string;
  sub: string;
  tone?: "default" | "accent" | "success";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "keycap flex items-center gap-3 p-4",
        tone === "accent" && "border-accent/40",
        tone === "success" && "border-success/30",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg border bg-background",
          tone === "accent" ? "border-accent/40 text-accent" : tone === "success" ? "border-success/30 text-success" : "border-border text-muted",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="truncate font-mono text-[11px] text-subtle">{sub}</p>
      </div>
    </div>
  );
}

function Arrow({ vertical }: { vertical?: boolean }) {
  return (
    <span aria-hidden className="grid place-items-center text-subtle">
      {vertical ? <ArrowDown className="size-4" /> : <ArrowRight className="hidden size-4 lg:block" />}
      {!vertical ? <ArrowDown className="size-4 lg:hidden" /> : null}
    </span>
  );
}

export function Architecture() {
  return (
    <section id="architecture" className="scroll-mt-28 px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Architecture"
          title="Small parts, each doing one job."
          subtitle="Everything runs in Docker Compose on a single machine today. Terraform for AWS is included but must be applied by you."
        />
        <div className="mt-12 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-8 hairline-grid">
          <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <Node icon={<Users className="size-4" />} title="Visitors" sub="browser · cookies only" />
            <Arrow />
            <Node
              icon={<ShieldCheck className="size-4" />}
              title="Nginx edge"
              sub="auth_request · rate limit · static cache"
              tone="accent"
            />
            <Arrow />
            <div className="grid gap-2">
              <Node icon={<Server className="size-4" />} title="Origin instance 1" sub="the site you protect" tone="success" />
              <Node icon={<Server className="size-4" />} title="Origin instance 2" sub="passive health + retry" tone="success" />
            </div>
          </div>
          <div className="my-3 grid lg:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <span className="lg:col-start-3">
              <Arrow vertical />
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Node icon={<Globe className="size-4" />} title="Queue API" sub="FastAPI · /api/v1 · /internal/auth" />
            <Node icon={<Database className="size-4" />} title="Redis" sub="queue state · Lua scripts" />
            <Node icon={<Timer className="size-4" />} title="Admission worker" sub="leader lock · token bucket" />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Node icon={<BarChart3 className="size-4" />} title="Prometheus" sub="scrapes API, worker, origins, Nginx" />
            <Node icon={<Workflow className="size-4" />} title="Grafana + console" sub="dashboards · alerts · operations" />
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            ["Not a DDoS shield", "SurgeGuard meters legitimate demand. Large malicious floods need upstream protection."],
            ["Doesn't fix slow code", "It keeps load within what your origin can serve; it does not make the origin faster."],
            ["People still wait", "During a surge visitors queue. The waiting room tells them their real position."],
          ].map(([title, text]) => (
            <div key={title} className="rounded-xl border border-dashed border-border p-4">
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const stack = [
  "Next.js", "React", "TypeScript", "Tailwind CSS", "Recharts", "FastAPI", "Python 3.12", "Redis",
  "Lua", "Nginx", "Prometheus", "Grafana", "k6", "Docker Compose", "Terraform", "GitHub Actions",
];

export function Stack() {
  return (
    <section id="stack" className="scroll-mt-28 border-t border-border px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Stack"
          title="Boring technology, on purpose."
          subtitle="Every component is open source and self-hostable. No vendor account required."
        />
        <ul className="mt-10 flex flex-wrap gap-2">
          {stack.map((item) => (
            <li key={item} className="keycap px-3.5 py-2 text-sm text-muted">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border px-4 py-12 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="text-[13px] text-muted">Survive the surge. Keep every user in line.</p>
          <div className="flex items-center gap-2 pt-1 text-xs text-subtle">
            <span>Built by <strong className="font-medium text-foreground">Team InfraFusion</strong></span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted">
          <a href="#simulator" className="transition-colors hover:text-foreground">Simulator</a>
          <a href="#comparison" className="transition-colors hover:text-foreground">Demo Compare</a>
          <a href="#architecture" className="transition-colors hover:text-foreground">Architecture</a>
          <a href="/login" className="transition-colors hover:text-foreground">Console</a>
          <span>MIT License</span>
          <span>InnoTech &apos;26</span>
        </div>
      </div>
    </footer>
  );
}
