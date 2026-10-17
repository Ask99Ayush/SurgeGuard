import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/** Every admin page and admin API route requires a valid signed session cookie. */
export async function middleware(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
  if (session) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Login required." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/queue/:path*",
    "/backends/:path*",
    "/monitoring/:path*",
    "/settings/:path*",
    "/live/:path*",
    "/api/admin/:path*",
    "/api/metrics/:path*",
  ],
};
