import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { ButtonLink } from "@/components/ui/primitives";

const links = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#architecture", label: "Architecture" },
  { href: "#stack", label: "Stack" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 px-4 pt-4 sm:px-6">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between rounded-2xl border border-border bg-surface/95 px-4 shadow-[var(--shadow-pop)] sm:px-6"
      >
        <Link href="/" aria-label="SurgeGuard home" className="rounded-lg">
          <Wordmark />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
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
          <Link href="/login" className="hidden rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground sm:block">
            Log in
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
