"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, LogOut, Menu, X } from "lucide-react";
import { RoleProvider } from "@/components/admin/RoleContext";
import type { Overview } from "@/components/admin/types";
import { Wordmark } from "@/components/Wordmark";
import { Badge, cn, type Tone } from "@/components/ui/primitives";
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
  const menuButton = useRef<HTMLButtonElement>(null);
  const overview = usePolling<Overview>("/api/admin/overview", 10_000);
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

  const linkClass = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-sm transition-colors duration-150",
      active ? "bg-surface-elevated text-foreground" : "text-muted hover:bg-surface-elevated/60 hover:text-foreground",
    );

  return (
    <RoleProvider value={role}>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
          <div className="mx-auto max-w-7xl rounded-2xl border border-border bg-surface shadow-[var(--shadow-pop)]">
            <div className="flex h-14 min-w-0 items-center gap-2 px-3 sm:gap-3 sm:px-4">
              <Link href="/dashboard" className="shrink-0 rounded-lg" aria-label="SurgeGuard dashboard">
                {/* Wrappers carry the breakpoint: Wordmark's own inline-flex would override `hidden`. */}
                <span className="hidden sm:block">
                  <Wordmark />
                </span>
                <span className="block sm:hidden">
                  <Wordmark compact />
                </span>
              </Link>
              <span
                role="status"
                title={health.label}
                aria-label={`System health: ${health.label}`}
                className="flex shrink-0 items-center"
              >
                <span aria-hidden className={cn("size-2 rounded-full transition-colors duration-150", dotClass[health.tone])} />
              </span>
              {config.data?.app_env ? (
                <span className="min-w-0 truncate">
                  <Badge>{config.data.app_env}</Badge>
                </span>
              ) : null}

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

              <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                {role === "viewer" ? (
                  <Badge tone="accent">
                    <Eye className="size-3" aria-hidden />
                    <span className="hidden sm:inline">Read-only demo</span>
                    <span className="sm:hidden">Read-only</span>
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
                <p className="px-3 pb-1 pt-2 text-xs text-subtle">{health.label}</p>
              </nav>
            ) : null}
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-3 pb-16 pt-8 sm:px-5">
          {children}
        </main>
      </div>
    </RoleProvider>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
