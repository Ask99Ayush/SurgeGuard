import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/admin-api";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function currentSession() {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
}

/** Defence in depth: route handlers re-check the session even though middleware already did. */
export async function requireSession() {
  return (await currentSession()) ? null : errorResponse(401, "unauthorized", "Login required.");
}

/** State-changing admin actions need the admin role; the demo viewer is read-only. */
export async function requireAdmin() {
  const session = await currentSession();
  if (!session) return errorResponse(401, "unauthorized", "Login required.");
  if (session.role !== "admin") return errorResponse(403, "read_only", "The demo account is read-only.");
  return null;
}

/** Reject cross-site state-changing requests (SameSite=Lax already blocks cookies; this is a second check). */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

