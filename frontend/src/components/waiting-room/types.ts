import { fetchJson } from "@/lib/client";

/** Mirrors backend app/schemas/queue.py QueueStatus. */
export interface QueueStatus {
  state: "waiting" | "admitted" | "expired" | "rejected";
  position: number | null;
  queue_length: number | null;
  estimated_wait_seconds: number | null;
  estimate_status: "available" | "insufficient_data" | "paused" | "not_applicable";
  measured_admission_rate: number | null;
  paused: boolean;
  poll_after_seconds: number;
  admitted_until: number | null;
  redirect_to: string | null;
}

export interface QueueApi {
  join(): Promise<QueueStatus>;
  status(): Promise<QueueStatus>;
}

export const httpQueueApi: QueueApi = {
  join: () => fetchJson<QueueStatus>("/api/v1/queue/join", { method: "POST" }),
  status: () => fetchJson<QueueStatus>("/api/v1/queue/status"),
};

/** Only same-site relative paths are followed after admission. */
export function safeRedirect(target: string | null | undefined): string {
  if (!target || !target.startsWith("/") || target.startsWith("//")) return "/";
  return target;
}
