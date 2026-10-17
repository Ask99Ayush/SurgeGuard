/** Server-side calls to the FastAPI admin API. The admin key is attached here and never leaves the server. */
import { NextResponse } from "next/server";
import { ConfigError, serverEnv } from "@/lib/env";

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const env = serverEnv();
  return fetch(`${env.apiInternalUrl}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
    headers: { ...(init.headers ?? {}), "X-Admin-Key": env.adminApiKey, Accept: "application/json" },
  });
}

/** Relay an upstream response, mapping network failures to an explicit 502. */
export async function relay(path: string, init: RequestInit = {}): Promise<NextResponse> {
  try {
    const upstream = await adminFetch(path, init);
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof ConfigError) return errorResponse(500, "misconfigured", "Console is not configured.");
    return errorResponse(502, "api_unreachable", "The SurgeGuard API is unreachable.");
  }
}
