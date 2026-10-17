/** Browser-side fetch helper that classifies failures so every screen can show the right state. */

export type FailureKind = "network" | "unauthorized" | "http";

export class RequestFailure extends Error {
  constructor(
    public readonly kind: FailureKind,
    public readonly status: number | null,
    message: string,
    public readonly code: string | null = null,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

export async function fetchJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    throw new RequestFailure("network", null, "Network unreachable");
  }
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    /* non-JSON error page */
  }
  const retryHeader = response.headers.get("retry-after");
  const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : null;
  const message = body.error?.message ?? `Request failed (${response.status})`;
  const kind: FailureKind = response.status === 401 ? "unauthorized" : "http";
  throw new RequestFailure(kind, response.status, message, body.error?.code ?? null, retryAfter);
}
