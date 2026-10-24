import { ArrowUpRight, CheckCircle2, ShieldCheck, Terminal, XCircle } from "lucide-react";
import { Badge, ButtonLink } from "@/components/ui/primitives";

export function DemoComparison({ demoUrl }: { demoUrl: string | null }) {
  const protectedUrl = demoUrl || "/waiting-room";
  const unprotectedUrl = "http://localhost:8081";

  return (
    <section id="comparison" className="scroll-mt-28 border-t border-border px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-accent">
            <ShieldCheck className="size-3.5" aria-hidden />
            Interactive Testbed
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            Experience the difference live.
          </h2>
          <p className="mt-3 text-[16px] leading-relaxed text-muted">
            The local stack exposes both the protected edge route and the direct baseline origin side-by-side so you can verify the queueing mechanics in real time.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {/* Protected Route */}
          <div className="relative flex flex-col justify-between rounded-2xl border border-success/40 bg-surface p-6 shadow-sm transition-all hover:border-success/60">
            <div>
              <div className="flex items-center justify-between">
                <Badge tone="success" dot>
                  Protected Route · Port 8080
                </Badge>
                <span className="font-mono text-xs text-muted">Nginx + SurgeGuard Gate</span>
              </div>

              <h3 className="mt-4 text-xl font-semibold text-foreground">SurgeGuard Protected Origin</h3>
              <p className="mt-2 text-sm text-muted">
                Visitors without a valid cryptographic token are gently intercepted and placed into the virtual waiting room. When admitted, they browse without errors.
              </p>

              <div className="mt-6 space-y-3 rounded-xl border border-border bg-surface-elevated p-4 text-xs">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                  <div>
                    <span className="font-semibold text-foreground">Nginx auth_request gate:</span>
                    <span className="ml-1 text-muted">Checks signed admission token on every request</span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                  <div>
                    <span className="font-semibold text-foreground">Deterministic FIFO sequence:</span>
                    <span className="ml-1 text-muted">Redis Lua script prevents race conditions and ticket jumping</span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                  <div>
                    <span className="font-semibold text-foreground">Zero origin overload:</span>
                    <span className="ml-1 text-muted">Backends receive exactly their target capacity</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ButtonLink href={protectedUrl} variant="primary" size="md">
                  <span>Enter Protected Waiting Room</span>
                  <ArrowUpRight className="size-4" aria-hidden />
                </ButtonLink>
                <span className="font-mono text-xs text-subtle">curl -i http://localhost:8080/</span>
              </div>
            </div>
          </div>

          {/* Unprotected Route */}
          <div className="relative flex flex-col justify-between rounded-2xl border border-border bg-surface p-6 shadow-sm transition-all hover:border-border-strong">
            <div>
              <div className="flex items-center justify-between">
                <Badge tone="neutral">Baseline Route · Port 8081</Badge>
                <span className="font-mono text-xs text-muted">Direct Origin Pool</span>
              </div>

              <h3 className="mt-4 text-xl font-semibold text-foreground">Direct Unprotected Baseline</h3>
              <p className="mt-2 text-sm text-muted">
                Direct entry to the fragile demo application without queueing or rate governance. Useful for verifying how easily unmetered traffic exhausts servers.
              </p>

              <div className="mt-6 space-y-3 rounded-xl border border-border bg-surface-elevated p-4 text-xs">
                <div className="flex items-start gap-2.5">
                  <XCircle className="size-4 shrink-0 text-danger" />
                  <div>
                    <span className="font-semibold text-foreground">No admission token check:</span>
                    <span className="ml-1 text-muted">Traffic passes directly into application workers</span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <XCircle className="size-4 shrink-0 text-danger" />
                  <div>
                    <span className="font-semibold text-foreground">Vulnerable to concurrency saturation:</span>
                    <span className="ml-1 text-muted">Throws 503 once concurrency limit is exceeded</span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <XCircle className="size-4 shrink-0 text-danger" />
                  <div>
                    <span className="font-semibold text-foreground">Stampede risk:</span>
                    <span className="ml-1 text-muted">Unchecked reloads cause cascading database failure</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <a
                  href={unprotectedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-elevated px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
                >
                  <span>Open Unprotected Origin</span>
                  <ArrowUpRight className="size-4 text-muted" aria-hidden />
                </a>
                <span className="font-mono text-xs text-subtle">curl -i http://localhost:8081/</span>
              </div>
            </div>
          </div>
        </div>

        {/* Load Test Helper Command */}
        <div className="mt-8 rounded-xl border border-border bg-surface-elevated p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg border border-border bg-background text-muted">
                <Terminal className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-xs font-semibold text-foreground">Run Automated Surge Comparison</p>
                <p className="text-xs text-muted">Execute the k6 test suite comparing both endpoints under identical surge profiles.</p>
              </div>
            </div>
            <code className="rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground">
              make demo
            </code>
          </div>
        </div>
      </div>
    </section>
  );
}
