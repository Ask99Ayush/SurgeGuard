"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Eye, LogOut, Menu, X } from "lucide-react";
import { RoleProvider } from "@/components/admin/RoleContext";
import type { Overview } from "@/components/admin/types";
import { Wordmark } from "@/components/Wordmark";
import { Badge, cn, type Tone } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { usePolling } from "@/hooks/usePolling";
import { fetchJson } from "@/lib/client";
import type { Role } from "@/lib/session";

export const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/queue", label: "Queue" },
  { href: "/backends", label: "Backends" },
  { href: "/monitoring", label: "Monitoring" },
  { href: "/settings", label: "Settings" },
];

/** One summary of system health from real API data. */
export function healthSummary(overview: Overview | null, apiOk: boolean): { tone: Tone; label: string } {
  if (!apiOk || !overview) return { tone: "danger", label: "SurgeGuard API unreachable" };
  if (!overview.redis.ok) return { tone: "danger", label: "Redis unreachable" };
  if (!overview.worker.alive) return { tone: "danger", label: "Admission worker not reporting" };
  const { healthy, total } = overview.backends;
  if (healthy === 0) return { tone: "danger", label: "No healthy backends" };
  if (healthy < total) return { tone: "warning", label: `${healthy} of ${total} backends healthy` };
  return { tone: "success", label: "All systems healthy" };
}

const dotClass: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-subtle",
  accent: "bg-accent",
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({ username, role, children }: { username: string; role: Role; children: ReactNode }) {
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedDiag, setCopiedDiag] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const overview = usePolling<Overview>("/api/admin/overview", 5000);
  const config = usePolling<{ app_env?: string }>("/api/admin/config", 60_000);
  const health =
    overview.status === "loading"
      ? { tone: "neutral" as Tone, label: "Checking health…" }
      : healthSummary(overview.data, overview.status === "success");

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function logout() {
    setLeaving(true);
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  async function copyDiagnostics() {
    const o = overview.data;
    const summary = [
      "# SurgeGuard Operations Diagnostic Summary",
      `- Timestamp: ${new Date().toISOString()}`,
      `- Overall Health: ${health.label}`,
      `- API Status: ${overview.status === "success" ? "Healthy (200 OK)" : overview.status}`,
      `- Redis: ${o ? (o.redis.ok ? `Operational (${o.redis.latency_ms}ms ping)` : "Unreachable") : "Unknown"}`,
      `- Admission Worker: ${o ? (o.worker.alive ? `Active (${o.admission.paused ? "PAUSED" : "Running"})` : "Dead") : "Unknown"}`,
      `- Backends: ${o ? `${o.backends.healthy}/${o.backends.total} healthy` : "Unknown"}`,
      `- Queue Waiting: ${o ? o.queue.waiting : "Unknown"}`,
      `- Admitted Active: ${o ? o.queue.admitted_active : "Unknown"}`,
      `- Admission Target: ${o ? `${o.admission.configured_rate} req/s` : "Unknown"}`,
      `- Environment: ${config.data?.app_env ?? "production"}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      setCopiedDiag(true);
      setTimeout(() => setCopiedDiag(false), 2000);
    } catch {
      setCopiedDiag(false);
    }
  }

  const linkClass = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150",
      active ? "bg-surface-elevated text-foreground" : "text-muted hover:bg-surface-elevated/60 hover:text-foreground",
    );

  return (
    <RoleProvider value={role}>
      <div className="flex min-h-dvh flex-col">
        {/* Accessible Skip to Content Link */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:border focus:border-border-strong focus:bg-surface-elevated focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-foreground focus:shadow-[var(--shadow-pop)]"
        >
          Skip to main content
        </a>

        {/* Global Navigation Header */}
        <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
          <div className="mx-auto max-w-7xl rounded-2xl border border-border bg-surface shadow-[var(--shadow-pop)]">
            <div className="flex h-14 min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-4">
              <Link href="/dashboard" className="shrink-0 rounded-lg" aria-label="SurgeGuard dashboard">
                <span className="hidden sm:block">
                  <Wordmark />
                </span>
                <span className="block sm:hidden">
                  <Wordmark compact />
                </span>
              </Link>

              {/* Status Pill */}
              <div
                role="status"
                title={health.label}
                aria-label={`System health: ${health.label}`}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-elevated/60 px-2 py-0.5 text-xs text-subtle"
              >
                <span aria-hidden className={cn("size-2 rounded-full transition-colors duration-150", dotClass[health.tone])} />
                <span className="hidden lg:inline font-medium text-foreground">{health.label}</span>
              </div>

              {config.data?.app_env ? (
                <span className="hidden md:inline-block min-w-0 truncate">
                  <Badge>{config.data.app_env}</Badge>
                </span>
              ) : null}

              {/* Primary Navigation */}
              <nav aria-label="Console" className="ml-2 hidden min-w-0 flex-1 md:block">
                <ul className="flex items-center gap-0.5">
                  {NAV.map(({ href, label }) => (
                    <li key={href}>
                      <Link href={href} aria-current={isActive(pathname, href) ? "page" : undefined} className={linkClass(isActive(pathname, href))}>
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>

              {/* Right Controls */}
              <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                {/* Copy Diagnostics button */}
                <button
                  type="button"
                  onClick={copyDiagnostics}
                  title="Copy non-secret operational diagnostics"
                  className="hidden xl:inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
                >
                  {copiedDiag ? (
                    <>
                      <Check className="size-3.5 text-success" />
                      <span className="text-success">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      <span>Diagnostics</span>
                    </>
                  )}
                </button>

                {role === "viewer" ? (
                  <Badge tone="accent">
                    <Eye className="size-3" aria-hidden />
                    <span className="hidden sm:inline">Read-only demo</span>
                    <span className="sm:hidden">Demo</span>
                  </Badge>
                ) : null}

                <span className="flex items-center gap-2 text-xs text-muted" title={`Signed in as ${username}`}>
                  <span
                    aria-hidden
                    className="grid size-7 place-items-center rounded-full border border-border-strong bg-surface-elevated text-xs font-semibold uppercase text-foreground"
                  >
                    {username.slice(0, 1)}
                  </span>
                  <span className="hidden lg:inline">{username}</span>
                  <span className="sr-only">Signed in as {username}</span>
                </span>

                <ThemeToggle compact className="hidden sm:inline-flex" />

                <button
                  type="button"
                  onClick={logout}
                  disabled={leaving}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted transition-colors duration-150 hover:bg-surface-elevated hover:text-foreground"
                >
                  <LogOut className="size-4" aria-hidden />
                  <span className="hidden sm:inline">Log out</span>
                </button>

                <button
                  ref={menuButton}
                  type="button"
                  className="grid size-9 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-elevated hover:text-foreground md:hidden"
                  aria-expanded={menuOpen}
                  aria-controls="console-menu"
                  aria-label={menuOpen ? "Close menu" : "Open menu"}
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
                </button>
              </div>
            </div>

            {/* Mobile Drawer */}
            {menuOpen ? (
              <nav id="console-menu" aria-label="Console menu" className="border-t border-border p-2 md:hidden">
                <ul className="flex flex-col gap-0.5">
                  {NAV.map(({ href, label }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={isActive(pathname, href) ? "page" : undefined}
                        className={cn(linkClass(isActive(pathname, href)), "block py-2")}
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t border-border px-3 pt-2">
                  <span className="text-xs text-muted">Theme</span>
                  <ThemeToggle compact />
                </div>
                <div className="flex items-center justify-between border-t border-border px-3 pt-2">
                  <p className="text-xs text-subtle">{health.label}</p>
                  <button
                    type="button"
                    onClick={copyDiagnostics}
                    className="text-xs text-accent hover:underline"
                  >
                    {copiedDiag ? "Copied!" : "Copy Diagnostics"}
                  </button>
                </div>
              </nav>
            ) : null}
          </div>
        </header>

        {/* Main Content Viewport */}
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-3 pb-12 pt-6 sm:px-5">
          {children}
        </main>

        {/* Restrained Application Footer */}
        <footer className="mt-auto border-t border-border bg-surface/50 py-4 px-3 sm:px-5">
          <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">SurgeGuard</span>
              <span>&middot;</span>
              <span>Self-Hosted Virtual Waiting Room & Surge Protection</span>
            </div>
            <div className="flex items-center gap-3 text-subtle">
              <span>Token Security: HMAC-SHA256 JWT</span>
              <span>&middot;</span>
              <span>Fail-Closed Topology</span>
            </div>
          </div>
        </footer>
      </div>
    </RoleProvider>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
            {breadcrumbs.map((b, idx) => (
              <span key={b.label} className="flex items-center gap-1.5">
                {idx > 0 && <span className="text-subtle">/</span>}
                {b.href ? (
                  <Link href={b.href} className="hover:text-foreground transition-colors">
                    {b.label}
                  </Link>
                ) : (
                  <span className="text-foreground font-medium">{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
