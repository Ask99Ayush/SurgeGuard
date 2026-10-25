import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui/primitives";

export type SystemStatus =
  | "healthy"
  | "degraded"
  | "paused"
  | "down"
  | "waiting"
  | "admitted"
  | "expired"
  | "rejected"
  | "offline"
  | "active";

const STATUS_CONFIG: Record<SystemStatus, { tone: Tone; label: string }> = {
  healthy: { tone: "success", label: "Healthy" },
  active: { tone: "success", label: "Active" },
  admitted: { tone: "success", label: "Admitted" },
  paused: { tone: "warning", label: "Paused" },
  waiting: { tone: "warning", label: "Waiting" },
  degraded: { tone: "warning", label: "Degraded" },
  down: { tone: "danger", label: "Down" },
  rejected: { tone: "danger", label: "Rejected" },
  offline: { tone: "danger", label: "Offline" },
  expired: { tone: "neutral", label: "Expired" },
};

export function StatusBadge({
  status,
  label,
  tone,
  dot = true,
  children,
}: {
  status?: SystemStatus;
  label?: string;
  tone?: Tone;
  dot?: boolean;
  children?: ReactNode;
}) {
  const cfg = status ? STATUS_CONFIG[status] : undefined;
  const resolvedTone = tone ?? cfg?.tone ?? "neutral";
  const resolvedLabel = children ?? label ?? cfg?.label ?? "Unknown";

  return (
    <Badge tone={resolvedTone} dot={dot}>
      {resolvedLabel}
    </Badge>
  );
}
