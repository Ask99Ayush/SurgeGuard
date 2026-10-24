import Image from "next/image";
import { Cloud, Cpu, GraduationCap, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/primitives";

export function CloudClubShowcase() {
  return (
    <section id="community" className="scroll-mt-28 border-t border-border px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-14">
          {/* Logo Showcase Card */}
          <div className="relative mx-auto w-full max-w-md lg:mx-0">
            <div
              aria-hidden
              className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-accent/30 via-border to-accent/10 opacity-70 blur-xl"
            />
            <div className="relative overflow-hidden rounded-3xl border border-border bg-surface p-6 shadow-[var(--shadow-pop)]">
              <div className="overflow-hidden rounded-2xl border border-border-strong bg-background p-2">
                <Image
                  src="/images/aws-cloud-club-kiet.jpg"
                  alt="AWS Cloud Club KIET - Official Student Technical Community"
                  className="aspect-square w-full rounded-xl object-cover shadow-sm transition-transform duration-300 hover:scale-[1.02]"
                  width={400}
                  height={400}
                />
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <GraduationCap className="size-4 text-accent" />
                  KIET Group of Institutions
                </span>
                <Badge tone="accent">Student Community</Badge>
              </div>
            </div>
          </div>

          {/* Context and Narrative */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-accent">
              <Cloud className="size-3.5" aria-hidden />
              Community & Cloud Architecture Initiative
            </div>

            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
              Engineered with AWS Cloud Club KIET
            </h2>

            <p className="mt-4 text-[16px] leading-relaxed text-muted">
              SurgeGuard was designed and implemented as an open-source resilience showcase under the mentorship of{" "}
              <strong className="font-semibold text-foreground">AWS Cloud Club KIET</strong> at KIET Group of Institutions.
              It tackles one of the most critical challenges in web infrastructure: graceful degradation and deterministic queueing during massive concurrent surges.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 place-items-center rounded-lg border border-border bg-surface-elevated text-accent">
                    <Cpu className="size-4" />
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">Cloud-Native Design</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Strict separation of proxy layers, Redis Lua state transitions, and asynchronous worker pools modeled after AWS best practices.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 place-items-center rounded-lg border border-border bg-surface-elevated text-success">
                    <ShieldCheck className="size-4" />
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">Fail-Closed Security</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Zero-trust origin boundary ensuring that internal auth or Redis failures never leak unauthorized access to the application.
                </p>
              </div>
            </div>

            <div className="mt-8 rounded-xl border border-border/80 bg-surface/60 p-4 text-xs text-subtle">
              <p>
                <strong className="font-semibold text-foreground">Community Disclaimer:</strong> AWS Cloud Club KIET is an official student-led academic club affiliated with the AWS Cloud Clubs initiative. SurgeGuard is an independent student engineering project created for InnoTech &apos;26 and does not represent an official Amazon Web Services commercial product or endorsement.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
