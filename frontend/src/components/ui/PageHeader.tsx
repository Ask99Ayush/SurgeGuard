import type { ReactNode } from "react";
import Link from "next/link";

export function PageHeader({
  title,
  description,
  breadcrumbs,
  statusBadge,
  actions,
}: {
  title: string;
  description: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  statusBadge?: ReactNode;
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
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
          {statusBadge}
        </div>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}
