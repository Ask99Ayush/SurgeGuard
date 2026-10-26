import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { Wordmark } from "@/components/Wordmark";
import { serverEnv } from "@/lib/env";
import { SESSION_COOKIE, safeNextPath, verifySessionToken } from "@/lib/session";

function demoCredentials() {
  try {
    return serverEnv().demoLogin;
  } catch {
    return null;
  }
}

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNextPath(next);
  const store = await cookies();
  if (await verifySessionToken(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET)) redirect(target);

  return (
    <main id="main" className="relative grid min-h-dvh place-items-center px-4 py-12">
      <div aria-hidden className="hero-glow pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-sm">
        <Link href="/" className="mx-auto mb-8 flex w-fit rounded-lg" aria-label="SurgeGuard home">
          <Wordmark />
        </Link>
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-[var(--shadow-pop)] sm:p-7">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-semibold tracking-[-0.02em]">Operator console</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              <span className="size-1.5 rounded-full bg-accent animate-pulse" />
              Sudo Mode
            </span>
          </div>
          <p className="mb-6 text-[13px] text-muted">Sign in with full administrative privileges to showcase real-time telemetry and admission controls.</p>
          <LoginForm next={target} demo={demoCredentials()} />
        </div>
        <div className="mt-4 rounded-xl border border-border/80 bg-surface/40 p-3 text-center text-xs text-subtle">
          <div className="flex items-center justify-center gap-1.5 font-medium text-foreground text-[11px] mb-1">
            <span>👑 Root Admin Sudo Credentials</span>
          </div>
          <p className="text-[11px] text-muted">
            User: <code className="font-mono text-accent font-semibold">admin</code> &middot; Pass: <code className="font-mono text-accent font-semibold">admin123</code>
          </p>
          <p className="mt-1 text-[10px] text-subtle">
            Full permissions enabled: Gate Pause/Resume, Visitor Ejection, Rate Shaping &amp; Metrics
          </p>
        </div>
      </div>
    </main>
  );
}
