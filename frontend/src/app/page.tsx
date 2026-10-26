import { LayoutDashboard, ShieldCheck, Users, Gauge } from "lucide-react";
import { DemoComparison } from "@/components/landing/DemoComparison";
import { HeroDemoButton } from "@/components/landing/HeroDemoButton";
import { Architecture, Features, Footer, Stack } from "@/components/landing/Sections";
import { SiteNav } from "@/components/landing/SiteNav";
import { SurgeSimulator } from "@/components/landing/SurgeSimulator";
import { LandingDeepDive } from "@/components/landing/LandingDeepDive";
import { ButtonLink, Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default function LandingPage() {
  const demoUrl = process.env.PUBLIC_SITE_URL ?? null;
  const directUrl = process.env.PUBLIC_DIRECT_URL ?? null;

  return (
    <>
      <SiteNav />
      <main id="main">
        {/* Calm, Focused Hero */}
        <section className="relative overflow-hidden px-4 pb-14 pt-12 sm:px-6 sm:pt-16 lg:pb-20 lg:pt-20">
          <div aria-hidden className="hero-glow pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-4xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs text-muted shadow-sm">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <span aria-hidden className="size-1.5 rounded-full bg-accent animate-pulse" />
                Virtual Waiting Room
              </span>
              <span className="h-3 w-px bg-border" aria-hidden />
              <span className="text-muted">High-Concurrency Protection</span>
            </div>

            <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-foreground sm:text-5xl lg:text-6xl text-balance">
              Survive the surge.
              <span className="block text-muted">Keep every user in line.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base sm:text-lg leading-relaxed text-muted text-balance">
              SurgeGuard holds traffic spikes in a fair virtual waiting room, admitting visitors first-come, first-served
              at the exact pace your origin servers can sustain.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <ButtonLink href="/login?next=/dashboard" variant="primary" size="lg">
                <LayoutDashboard className="size-4" aria-hidden />
                Open Console
              </ButtonLink>
              <HeroDemoButton initialUrl={demoUrl} />
            </div>

            <p className="mt-4 text-xs text-subtle">
              Self-hosted &middot; Nginx edge verification &middot; Redis state store &middot; Zero code changes required on origin
            </p>
          </div>
        </section>

        {/* 3-Step "How It Works" Section */}
        <section aria-label="How SurgeGuard Works" className="border-t border-border bg-surface/40 px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">How it works</p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-foreground">
                Three calm steps. Zero server crashes.
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
                SurgeGuard sits transparently in front of your site. Your application code never changes.
              </p>
            </div>

            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              <Card className="p-6 flex flex-col justify-between">
                <div>
                  <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-elevated text-foreground">
                    <Users className="size-5 text-accent" />
                  </div>
                  <span className="mt-4 inline-block font-mono text-xs font-semibold text-subtle">01 / QUEUE</span>
                  <h3 className="mt-1 text-base font-semibold text-foreground">Traffic Surges</h3>
                  <p className="mt-2 text-xs sm:text-sm text-muted leading-relaxed">
                    When visitors exceed capacity, edge Nginx directs them into a fair, verified virtual waiting room instead of letting requests crash your origin.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border text-[11px] font-mono text-subtle">
                  State: In Virtual Queue
                </div>
              </Card>

              <Card className="p-6 flex flex-col justify-between">
                <div>
                  <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-elevated text-foreground">
                    <Gauge className="size-5 text-warning" />
                  </div>
                  <span className="mt-4 inline-block font-mono text-xs font-semibold text-subtle">02 / ORDER</span>
                  <h3 className="mt-1 text-base font-semibold text-foreground">Fair Holding</h3>
                  <p className="mt-2 text-xs sm:text-sm text-muted leading-relaxed">
                    Visitors hold an exact FIFO position tracked in Redis with automatic heartbeats. If a user refreshes or reconnects, their place in line is preserved.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border text-[11px] font-mono text-subtle">
                  Ordering: FIFO Sequence
                </div>
              </Card>

              <Card className="p-6 flex flex-col justify-between">
                <div>
                  <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-elevated text-foreground">
                    <ShieldCheck className="size-5 text-success" />
                  </div>
                  <span className="mt-4 inline-block font-mono text-xs font-semibold text-subtle">03 / ADMIT</span>
                  <h3 className="mt-1 text-base font-semibold text-foreground">Smooth Admission</h3>
                  <p className="mt-2 text-xs sm:text-sm text-muted leading-relaxed">
                    The admission worker releases visitors at your chosen rate with a signed token. Nginx validates the token in sub-millisecond time.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border text-[11px] font-mono text-subtle">
                  Security: HMAC-SHA256 Token
                </div>
              </Card>
            </div>
          </div>
        </section>

        {/* Collapsible Deep Dive & Simulator */}
        <LandingDeepDive
          simulator={<SurgeSimulator />}
          comparison={<DemoComparison demoUrl={demoUrl} directUrl={directUrl} />}
          features={<Features />}
          architecture={<Architecture />}
          stack={<Stack />}
        />
      </main>
      <Footer />
    </>
  );
}
