/** Server-side calls to the FastAPI admin API. The admin key is attached here and never leaves the server. */
import { NextResponse } from "next/server";
import {
  getExhibitionBackends,
  getExhibitionConfig,
  getExhibitionEvents,
  getExhibitionOverview,
  getExhibitionVisitors,
  pauseExhibitionQueue,
  rejectExhibitionVisitor,
  resumeExhibitionQueue,
} from "@/lib/exhibition-data";
import { ConfigError, serverEnv } from "@/lib/env";

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const env = serverEnv();
  const candidateUrls = [env.apiInternalUrl];
  if (env.apiInternalUrl.includes("api:8000")) {
    candidateUrls.push("http://127.0.0.1:8000");
  }

  let lastErr: unknown;
  for (const baseUrl of candidateUrls) {
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
        headers: { ...(init.headers ?? {}), "X-Admin-Key": env.adminApiKey, Accept: "application/json" },
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function handleExhibitionFallback(pathWithQuery: string, init: RequestInit): NextResponse | null {
  const parts = pathWithQuery.split("?");
  const cleanPath = parts[0] ?? "";
  const qs = parts[1] ?? "";
  const params = new URLSearchParams(qs);
  const method = (init.method || "GET").toUpperCase();

  if (cleanPath.endsWith("/overview")) {
    return NextResponse.json(getExhibitionOverview(), { headers: { "Cache-Control": "no-store" } });
  }
  if (cleanPath.endsWith("/backends")) {
    return NextResponse.json(getExhibitionBackends(), { headers: { "Cache-Control": "no-store" } });
  }
  if (cleanPath.endsWith("/events")) {
    const limit = Number(params.get("limit")) || 200;
    return NextResponse.json(getExhibitionEvents(limit), { headers: { "Cache-Control": "no-store" } });
  }
  if (cleanPath.endsWith("/visitors")) {
    const state = params.get("state") || "all";
    const page = Number(params.get("page")) || 1;
    const pageSize = Number(params.get("page_size")) || 25;
    const q = params.get("q") || "";
    return NextResponse.json(getExhibitionVisitors(state, page, pageSize, q), { headers: { "Cache-Control": "no-store" } });
  }
  if (cleanPath.endsWith("/config")) {
    return NextResponse.json(getExhibitionConfig(), { headers: { "Cache-Control": "no-store" } });
  }
  if (cleanPath.endsWith("/queue/pause")) {
    if (method === "POST") {
      let reason = "Manual pause via Console";
      let actor = "admin";
      try {
        if (typeof init.body === "string") {
          const parsed = JSON.parse(init.body);
          if (parsed.reason) reason = parsed.reason;
          if (parsed.actor) actor = parsed.actor;
        }
      } catch {}
      return NextResponse.json(pauseExhibitionQueue(reason, actor), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ paused: false }, { headers: { "Cache-Control": "no-store" } });
  }
  if (cleanPath.endsWith("/queue/resume")) {
    return NextResponse.json(resumeExhibitionQueue(), { headers: { "Cache-Control": "no-store" } });
  }
  const rejectMatch = cleanPath.match(/\/visitors\/([A-Za-z0-9_-]+)\/reject/);
  if (rejectMatch && rejectMatch[1]) {
    return NextResponse.json(rejectExhibitionVisitor(rejectMatch[1]), { headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

/** Relay an upstream response, falling back to realistic exhibition telemetry if offline. */
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

    const fallback = handleExhibitionFallback(path, init);
    if (fallback) return fallback;

    return errorResponse(502, "api_unreachable", "The SurgeGuard API is unreachable.");
  }
}
