import type { NextRequest } from "next/server";
import { errorResponse, relay } from "@/lib/admin-api";
import { requireAdmin, requireSession, sameOrigin } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only these admin API paths are reachable through the console. */
const GET_ALLOW = [/^overview$/, /^visitors$/, /^backends$/, /^events$/, /^config$/, /^queue\/pause$/];
const POST_ALLOW = [/^queue\/pause$/, /^queue\/resume$/, /^visitors\/[A-Za-z0-9_-]{22}\/reject$/];
const QUERY_KEYS = new Set(["state", "q", "page", "page_size", "limit"]);

type Params = { params: Promise<{ path: string[] }> };

async function target(params: Params["params"]) {
  const { path } = await params;
  return path.join("/");
}

export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireSession();
  if (denied) return denied;
  const path = await target(params);
  if (!GET_ALLOW.some((re) => re.test(path))) return errorResponse(404, "not_found", "Unknown admin endpoint.");
  const query = new URLSearchParams();
  request.nextUrl.searchParams.forEach((value, key) => {
    if (QUERY_KEYS.has(key)) query.set(key, value.slice(0, 64));
  });
  const qs = query.toString();
  return relay(`/api/v1/admin/${path}${qs ? `?${qs}` : ""}`);
}

export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!sameOrigin(request)) return errorResponse(403, "forbidden", "Cross-site request rejected.");
  const path = await target(params);
  if (!POST_ALLOW.some((re) => re.test(path))) return errorResponse(404, "not_found", "Unknown admin endpoint.");
  const body = (await request.text()).slice(0, 2048) || "{}";
  return relay(`/api/v1/admin/${path}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}
