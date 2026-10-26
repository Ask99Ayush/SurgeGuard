"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Eye, LogOut, Menu, Moon, ShieldCheck, Sun, X } from "lucide-react";
import { RoleProvider } from "@/components/admin/RoleContext";
import type { Overview } from "@/components/admin/types";
import { Wordmark } from "@/components/Wordmark";
import { cn, type Tone } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { usePolling } from "@/hooks/usePolling";
import { useTheme } from "@/hooks/useTheme";
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [copiedDiag, setCopiedDiag] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const overview = usePolling<Overview>("/api/admin/overview", 5000);
  const config = usePolling<{ app_env?: string }>("/api/admin/config", 60_000);
  const { theme, setTheme } = useTheme();

  const health =
    overview.status === "loading"
      ? { tone: "neutral" as Tone, label: "Checking health…" }
      : healthSummary(overview.data, overview.status === "success");

  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

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

  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [userMenuOpen]);

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
            <div className="flex h-14 items-center justify-between gap-3 px-3 sm:px-4">
              {/* Left: Brand + Live Health Dot + Env */}
              <div className="flex items-center gap-2.5 shrink-0">
                <Link href="/dashboard" className="shrink-0 rounded-lg" aria-label="SurgeGuard dashboard">
                  <span className="hidden sm:block">
                    <Wordmark />
                  </span>
                  <span className="block sm:hidden">
                    <Wordmark compact />
                  </span>
                </Link>

                {/* Status Dot */}
                <div
                  role="status"
                  title={`System health: ${health.label}`}
                  aria-label={`System health: ${health.label}`}
                  className="flex items-center gap-1.5"
                >
                  <span className="relative flex size-2 shrink-0">
                    {health.tone !== "success" && (
                      <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", dotClass[health.tone])} />
                    )}
                    <span className={cn("size-2 rounded-full transition-colors duration-150", dotClass[health.tone])} />
                  </span>
                  {health.tone !== "success" && (
                    <span className="hidden sm:inline text-xs font-medium text-danger">
                      {health.label}
                    </span>
                  )}
                </div>

                {config.data?.app_env && config.data.app_env !== "production" ? (
                  <span className="hidden sm:inline-block rounded-md border border-border/80 bg-surface-elevated/70 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                    {config.data.app_env === "development" ? "dev" : config.data.app_env}
                  </span>
                ) : null}
              </div>

              {/* Center: Primary Navigation — clean, spacious, never truncated */}
              <nav aria-label="Console" className="hidden md:flex items-center gap-1">
                {NAV.map(({ href, label }) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
                        active
                          ? "bg-surface-elevated font-semibold text-foreground shadow-xs ring-1 ring-border/50"
                          : "text-muted hover:bg-surface-elevated/60 hover:text-foreground",
                      )}
                    >
                      {label}
                    </Link>
                  );
                })}
              </nav>

              {/* Right: Refined Controls & Profile */}
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {role === "viewer" ? (
                  <span
                    title="Read-only demo mode: state mutations disabled"
                    className="hidden sm:inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
                  >
                    <Eye className="size-3" aria-hidden />
                    <span>Demo</span>
                  </span>
                ) : (
                  <span
                    title="Full administrative & sudo privileges active"
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 shadow-xs"
                  >
                    <ShieldCheck className="size-3.5 text-emerald-400" aria-hidden />
                    <span>Super Admin (Sudo)</span>
                  </span>
                )}

                {/* Sleek 1-click Theme Toggle */}
                <button
                  type="button"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  title={`Current theme: ${theme}. Click to switch to ${theme === "dark" ? "light" : "dark"}.`}
                  aria-label={`Toggle theme (currently ${theme})`}
                  className="grid size-8 place-items-center rounded-xl border border-border bg-surface-elevated/40 text-muted transition-colors hover:bg-surface-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {theme === "dark" ? (
                    <Sun className="size-3.5" aria-hidden />
                  ) : (
                    <Moon className="size-3.5" aria-hidden />
                  )}
                </button>

                {/* User Menu Popover */}
                <div className="relative" ref={userMenuRef}>
                  <button
                    type="button"
                    onClick={() => setUserMenuOpen((o) => !o)}
                    aria-expanded={userMenuOpen}
                    aria-haspopup="true"
                    title={`Signed in as ${username}`}
                    className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-surface-elevated/40 p-1 pl-1 pr-2 text-xs text-muted transition-colors hover:border-border hover:bg-surface-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span
                      aria-hidden
                      className="grid size-6 place-items-center rounded-lg border border-border-strong bg-surface-elevated text-[11px] font-semibold uppercase text-foreground"
                    >
                      {username.slice(0, 1)}
                    </span>
                    <span className="hidden lg:inline font-medium text-foreground">{username}</span>
                    <ChevronDown className={cn("size-3 text-subtle transition-transform duration-150", userMenuOpen && "rotate-180")} />
                  </button>

                  {/* Raycast-style floating card */}
                  {userMenuOpen && (
                    <div
                      role="menu"
                      aria-label="User menu"
                      className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-border bg-surface p-2 shadow-[var(--shadow-pop)] animate-in fade-in zoom-in-95 duration-100"
                    >
                      <div className="px-3 py-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-foreground">{username}</p>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase",
                              role === "admin"
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                : "border-border bg-surface-elevated text-muted",
                            )}
                          >
                            {role === "admin" ? "Super Admin" : "Viewer"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-subtle">
                          {role === "viewer" ? "Read-only access" : "Full sudo privileges (state mutation unlocked)"}
                        </p>
                      </div>

                      <div className="my-1 border-t border-border" />

                      <div className="px-3 py-2 text-xs">
                        <div className="flex items-center justify-between text-muted">
                          <span>Health</span>
                          <span className="flex items-center gap-1.5 font-medium text-foreground">
                            <span className={cn("size-2 rounded-full", dotClass[health.tone])} />
                            {health.label}
                          </span>
                        </div>
                        {overview.data && (
                          <div className="mt-1.5 flex items-center justify-between text-[11px] text-subtle">
                            <span>Redis: {overview.data.redis.ok ? `${overview.data.redis.latency_ms}ms` : "Down"}</span>
                            <span>Backends: {overview.data.backends.healthy}/{overview.data.backends.total}</span>
                          </div>
                        )}
                      </div>

                      <div className="my-1 border-t border-border" />

                      <button
                        type="button"
                        role="menuitem"
                        onClick={copyDiagnostics}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
                      >
                        <span className="flex items-center gap-2">
                          {copiedDiag ? (
                            <Check className="size-3.5 text-success" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          <span>{copiedDiag ? "Copied to clipboard!" : "Copy Diagnostics"}</span>
                        </span>
                        {copiedDiag && <span className="text-[10px] font-semibold text-success">Done</span>}
                      </button>

                      <div className="my-1 border-t border-border" />

                      <button
                        type="button"
                        role="menuitem"
                        onClick={logout}
                        disabled={leaving}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
                      >
                        <LogOut className="size-3.5" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Mobile Menu Hamburger */}
                <button
                  ref={menuButton}
                  type="button"
                  className="grid size-8 place-items-center rounded-xl text-muted transition-colors duration-150 hover:bg-surface-elevated hover:text-foreground md:hidden"
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
                  {NAV.map(({ href, label }) => {
                    const active = isActive(pathname, href);
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "block rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                            active
                              ? "bg-surface-elevated font-semibold text-foreground"
                              : "text-muted hover:bg-surface-hover/60 hover:text-foreground",
                          )}
                        >
                          {label}
                        </Link>
                      </li>
                    );
                  })}
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

export { PageHeader } from "@/components/ui/PageHeader";
