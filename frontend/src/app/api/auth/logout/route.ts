import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/admin-api";
import { sameOrigin } from "@/lib/auth-guard";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return errorResponse(403, "forbidden", "Cross-site request rejected.");
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.COOKIE_SECURE ?? "false") === "true",
    path: "/",
    maxAge: 0,
  });
  return response;
}
