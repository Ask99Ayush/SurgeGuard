import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness for the container healthcheck. Reports no configuration or dependency details. */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
