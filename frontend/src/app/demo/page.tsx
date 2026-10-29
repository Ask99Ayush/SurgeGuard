import type { Metadata } from "next";
import { SiteNav } from "@/components/landing/SiteNav";
import { DemoComparison } from "@/components/landing/DemoComparison";
import { Footer } from "@/components/landing/Sections";

export const metadata: Metadata = {
  title: "Live Demo — Guarded vs. Unguarded Comparison | SurgeGuard",
  description:
    "Interactive performance testbed comparing SurgeGuard protected website against a direct unprotected website under load.",
};

export const dynamic = "force-dynamic";

export default function DemoPage() {
  const demoUrl = process.env.PUBLIC_SITE_URL ?? null;
  const directUrl = process.env.PUBLIC_DIRECT_URL ?? null;

  return (
    <>
      <SiteNav />
      <main id="main" className="min-h-screen pb-16">
        <div className="relative overflow-hidden px-4 pt-10 sm:px-6 sm:pt-14">
          <div aria-hidden className="hero-glow pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-4xl text-center">
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
              SurgeGuard Live Performance Testbed
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-base text-muted">
              Direct side-by-side comparison between SurgeGuard virtual queueing and unprotected direct origin ingress.
            </p>
          </div>
        </div>

        <DemoComparison demoUrl={demoUrl} directUrl={directUrl} />
      </main>
      <Footer />
    </>
  );
}
