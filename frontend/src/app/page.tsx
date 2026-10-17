import { ArrowRight, LayoutDashboard } from "lucide-react";
import { KeyGrid } from "@/components/landing/KeyGrid";
import { QueueFlow } from "@/components/landing/QueueFlow";
import { Architecture, Features, Footer, HowItWorks, Stack } from "@/components/landing/Sections";
import { SiteNav } from "@/components/landing/SiteNav";
import { ButtonLink, Kbd } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default function LandingPage() {
  const demoUrl = process.env.PUBLIC_SITE_URL ?? null;
  return (
    <>
      <SiteNav />
      <main id="main">
        <section className="relative overflow-hidden px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:pb-24 lg:pt-20">
          <div aria-hidden className="hero-glow pointer-events-none absolute inset-0" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-muted">
                <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                Self-hosted virtual waiting room
              </p>
              <h1 className="mt-6 text-[40px] font-semibold leading-[1.05] tracking-[-0.04em] text-balance sm:text-[52px] xl:text-[56px]">
                Survive the surge.
                <span className="block text-muted">Keep every user in line.</span>
              </h1>
              <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-muted">
                When results go live or registrations open, SurgeGuard queues the overflow and admits visitors
                first come, first served — at the pace your servers can actually handle.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <ButtonLink href="/login?next=/dashboard" variant="primary" size="lg">
                  <LayoutDashboard className="size-[18px]" aria-hidden />
                  Launch Dashboard
                </ButtonLink>
                <ButtonLink href="#architecture" variant="secondary" size="lg">
                  View Architecture
                  <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
              </div>
              {demoUrl ? (
                <p className="mt-6 flex items-center gap-2 text-[13px] text-muted">
                  <Kbd>↵</Kbd>
                  <a href={demoUrl} className="underline decoration-border-strong underline-offset-4 hover:text-foreground">
                    Open the protected demo site
                  </a>
                </p>
              ) : null}
            </div>
            <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 lg:mr-0">
              <KeyGrid />
              <QueueFlow />
            </div>
          </div>
        </section>
        <Features />
        <HowItWorks />
        <Architecture />
        <Stack />
      </main>
      <Footer />
    </>
  );
}
