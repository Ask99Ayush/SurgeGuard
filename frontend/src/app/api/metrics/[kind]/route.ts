import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/admin-api";
import { requireSession } from "@/lib/auth-guard";
import { QUERIES, RANGES, isQueryName, isRangeName, parsePromResult } from "@/lib/promql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ kind: string }> };

async function prom(path: string): Promise<unknown> {
  const base = process.env.PROMETHEUS_URL?.replace(/\/$/, "");
  if (!base) throw new Error("not configured");
  const res = await fetch(`${base}${path}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`prometheus HTTP ${res.status}`);
  return res.json();
}

const unavailable = () => errorResponse(502, "prometheus_unavailable", "Prometheus is unreachable.");

export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireSession();
  if (denied) return denied;
  const { kind } = await params;
  const search = request.nextUrl.searchParams;

  try {
    if (kind === "range") {
      const name = search.get("name");
      const range = search.get("range") ?? "1h";
      if (!isQueryName(name) || !isRangeName(range)) return errorResponse(400, "bad_request", "Unknown query or range.");
      const { seconds, step } = RANGES[range];
      const end = Math.floor(Date.now() / 1000);
      const qs = new URLSearchParams({
        query: QUERIES[name],
        start: String(end - seconds),
        end: String(end),
        step: String(step),
      });
      const series = parsePromResult((await prom(`/api/v1/query_range?${qs}`)) as never);
      return NextResponse.json({ name, range, series }, { headers: { "Cache-Control": "no-store" } });
    }

    if (kind === "instant") {
      const name = search.get("name");
      if (!isQueryName(name)) return errorResponse(400, "bad_request", "Unknown query.");
      const series = parsePromResult((await prom(`/api/v1/query?query=${encodeURIComponent(QUERIES[name])}`)) as never);
      return NextResponse.json({ name, series }, { headers: { "Cache-Control": "no-store" } });
    }

    if (kind === "status") {
      const [targets, alerts] = (await Promise.all([prom("/api/v1/targets?state=active"), prom("/api/v1/alerts")])) as [
        { data: { activeTargets: Array<{ labels: Record<string, string>; health: string; lastScrape: string; lastError: string; scrapeUrl: string }> } },
        { data: { alerts: Array<{ labels: Record<string, string>; annotations: Record<string, string>; state: string; activeAt: string }> } },
      ];
      return NextResponse.json(
        {
          targets: targets.data.activeTargets.map((t) => ({
            job: t.labels.job ?? "unknown",
            instance: t.labels.instance ?? "",
            health: t.health,
            lastScrape: t.lastScrape,
            lastError: t.lastError || null,
          })),
          alerts: alerts.data.alerts.map((a) => ({
            name: a.labels.alertname ?? "alert",
            severity: a.labels.severity ?? "info",
            state: a.state,
            summary: a.annotations.summary ?? "",
            activeAt: a.activeAt,
          })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch {
    return unavailable();
  }
  return errorResponse(404, "not_found", "Unknown metrics endpoint.");
}
