"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutDashboard, Menu, X } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { ButtonLink } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const links = [
  { href: "#features", label: "Features" },
  { href: "#simulator", label: "Simulator" },
  { href: "#comparison", label: "Comparison" },
  { href: "#architecture", label: "Architecture" },
];

export function SiteNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 max-w-7xl items-center justify-between rounded-2xl border border-border bg-surface/95 px-3.5 shadow-[var(--shadow-pop)] backdrop-blur-md sm:px-4"
      >
        {/* Left: Brand logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Link href="/" aria-label="SurgeGuard home" className="rounded-lg shrink-0">
            <Wordmark />
          </Link>
        </div>

        {/* Center: Clean, single-line navigation links */}
        <ul className="hidden items-center gap-0.5 lg:flex">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        {/* Right: Theme Toggle, Sign in & Dashboard Button */}
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle compact />
          <Link
            href="/login"
            className="hidden whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground sm:inline-block"
          >
            Sign in
          </Link>
          <ButtonLink href="/login?next=/dashboard" variant="primary" size="sm" className="whitespace-nowrap shrink-0">
            <LayoutDashboard className="size-4 shrink-0" aria-hidden />
            <span>Dashboard</span>
          </ButtonLink>

          {/* Mobile hamburger toggle */}
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation menu"
            className="flex size-8 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground lg:hidden"
          >
            {mobileOpen ? <X className="size-4.5" /> : <Menu className="size-4.5" />}
          </button>
        </div>
      </nav>

      {/* Mobile navigation drawer */}
      {mobileOpen && (
        <div className="mx-auto mt-2 max-w-7xl rounded-2xl border border-border bg-surface p-3 shadow-lg lg:hidden animate-in fade-in duration-150">
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}

