import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, WifiOff } from "lucide-react";
import { Button, cn } from "@/components/ui/primitives";

export type StateKind = "loading" | "empty" | "error" | "disconnected";

const icons = {
  loading: <Loader2 className="size-5 animate-spin" aria-hidden />,
  empty: <Inbox className="size-5" aria-hidden />,
  error: <AlertTriangle className="size-5 text-warning" aria-hidden />,
  disconnected: <WifiOff className="size-5 text-danger" aria-hidden />,
};

const defaults: Record<StateKind, { title: string; message: string }> = {
  loading: { title: "Loading", message: "Fetching the latest data." },
  empty: { title: "Nothing here yet", message: "Run make demo to generate traffic." },
  error: { title: "Unavailable", message: "The service returned an error. Retrying automatically." },
  disconnected: { title: "Disconnected", message: "Can't reach the console server." },
};

/** One component for every loading / empty / error / disconnected state, so they look consistent. */
export function StateView({
  kind,
  title,
  message,
  onRetry,
  compact,
  children,
}: {
  kind: StateKind;
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      role={kind === "error" || kind === "disconnected" ? "alert" : "status"}
      aria-live="polite"
      data-state={kind}
      className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 py-6" : "gap-3 py-8")}
    >
      <span className="keycap grid size-10 place-items-center text-muted">{icons[kind]}</span>
      <div>
        <p className="text-sm font-medium text-foreground">{title ?? defaults[kind].title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{message ?? defaults[kind].message}</p>
      </div>
      {onRetry && kind !== "loading" ? (
        <Button size="sm" onClick={onRetry}>
          Retry now
        </Button>
      ) : null}
      {children}
    </div>
  );
}
