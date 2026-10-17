import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import Link from "next/link";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-foreground text-background hover:bg-foreground/90 shadow-[0_1px_0_0_var(--border-strong),0_8px_24px_-12px_var(--foreground)]",
  secondary: "bg-surface-elevated text-foreground border border-border hover:bg-surface-hover hover:border-border-strong",
  ghost: "text-muted hover:text-foreground hover:bg-surface-elevated",
  danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-5 text-[15px] gap-2.5 rounded-xl",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors duration-150",
    "disabled:opacity-50 disabled:pointer-events-none select-none",
    variants[variant],
    sizes[size],
    extra,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  external,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  if (external) {
    return (
      <a href={href} className={buttonClass(variant, size, className)} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-pop)]", className)}
      {...props}
    />
  );
}

/** The only card-header style: 16px title, optional one-line description, optional action. No icons. */
export function CardHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 truncate text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0 pt-1">{action}</div> : null}
    </div>
  );
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-elevated text-muted border-border",
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/10 text-warning border-warning/25",
  danger: "bg-danger/10 text-danger border-danger/25",
  accent: "bg-accent/10 text-accent border-accent/25",
};
const dots: Record<Tone, string> = {
  neutral: "bg-subtle",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
};

export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-5 tabular-nums",
        tones[tone],
      )}
    >
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", dots[tone])} /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return <span aria-hidden className={cn("inline-block size-2 rounded-full", dots[tone], pulse && "animate-soft-pulse")} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="keycap inline-flex h-6 min-w-6 items-center justify-center px-1.5 font-mono text-xs text-muted">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-elevated", className)} />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-border-strong border-t-foreground"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
