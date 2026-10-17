import type { ReactNode } from "react";
import { Activity, Gauge, ListOrdered, ShieldCheck } from "lucide-react";
import { cn } from "@/components/ui/primitives";

/** Decorative keycap grid (design language only). Feature keys carry real product claims, no numbers. */

function FadedKey({ label, className }: { label?: string; className?: string }) {
  return (
    <div aria-hidden className={cn("keycap-faded flex items-end px-3 pb-2 text-lg font-medium text-border-strong", className)}>
      {label}
    </div>
  );
}

function FeatureKey({
  icon,
  title,
  text,
  className,
  highlight,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "keycap relative flex flex-col justify-between p-4 transition-colors duration-200 hover:border-border-strong",
        highlight && "border-accent/40",
        className,
      )}
    >
      <span className={cn("text-muted", highlight && "text-accent")}>{icon}</span>
      <p className="text-[15px] leading-snug tracking-[-0.01em]">
        <span className="font-semibold text-foreground">{title}</span> <span className="text-muted">{text}</span>
      </p>
      {highlight ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-6 -bottom-px h-px bg-gradient-to-r from-transparent via-accent to-transparent" />
      ) : null}
    </div>
  );
}

export function KeyGrid() {
  return (
    <div className="relative fade-mask-b">
      <div className="grid grid-cols-6 grid-rows-[40px_56px_96px_96px_40px] gap-2.5 sm:grid-rows-[44px_64px_104px_104px_44px] sm:gap-3">
        <FadedKey label="esc" className="col-span-2 text-base" />
        <FadedKey label="F1" className="text-base" />
        <FadedKey label="F2" className="text-base" />
        <FadedKey label="F3" className="text-base" />
        <FadedKey label="F4" className="text-base" />

        <FadedKey label="§" />
        <FadedKey label="1" />
        <FadedKey label="2" />
        <FadedKey label="3" />
        <FadedKey label="4" />
        <FadedKey label="5" />

        <FadedKey label="⇥" className="text-xl" />
        <FeatureKey
          className="col-span-3 sm:col-span-2"
          icon={<ListOrdered className="size-5" />}
          title="Fair."
          text="First come, first served."
          highlight
        />
        <FeatureKey
          className="col-span-2 sm:col-span-3"
          icon={<Gauge className="size-5" />}
          title="Controlled."
          text="Admitted at your rate."
        />

        <FeatureKey
          className="col-span-3"
          icon={<ShieldCheck className="size-5" />}
          title="Protected."
          text="Fails closed, never open."
        />
        <FeatureKey
          className="col-span-2"
          icon={<Activity className="size-5" />}
          title="Observable."
          text="Every number measured."
        />
        <FadedKey label="S" />

        <FadedKey label="⇧" className="col-span-2 text-xl" />
        <FadedKey label="Z" />
        <FadedKey label="X" />
        <FadedKey label="C" />
        <FadedKey label="V" />
      </div>
    </div>
  );
}
