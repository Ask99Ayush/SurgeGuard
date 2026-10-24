"use client";

import Image from "next/image";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { ButtonLink } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const links = [
  { href: "#features", label: "Features" },
  { href: "#simulator", label: "Live Simulator" },
  { href: "#comparison", label: "Protected vs Unprotected" },
  { href: "#architecture", label: "Architecture" },
  { href: "#community", label: "AWS Cloud Club KIET" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 px-4 pt-4 sm:px-6">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-7xl items-center justify-between rounded-2xl border border-border bg-surface/95 px-4 shadow-[var(--shadow-pop)] backdrop-blur-md sm:px-6"
      >
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="SurgeGuard home" className="rounded-lg">
            <Wordmark />
          </Link>
          <div className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <div className="hidden items-center gap-2 rounded-full border border-border bg-surface-elevated px-2.5 py-1 text-xs text-muted md:inline-flex">
            <Image
              src="/images/aws-cloud-club-kiet.jpg"
              alt="AWS Cloud Club KIET"
              className="size-4.5 rounded-full object-cover ring-1 ring-border"
              width={18}
              height={18}
            />
            <span className="font-medium text-foreground">AWS Cloud Club KIET</span>
          </div>
        </div>

        <ul className="hidden items-center gap-1 xl:flex">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <Link
            href="/login"
            className="hidden rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-foreground sm:block"
          >
            Console Log in
          </Link>
          <ButtonLink href="/login?next=/dashboard" variant="primary" size="sm">
            <LayoutDashboard className="size-4" aria-hidden />
            <span>Launch Dashboard</span>
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
}
