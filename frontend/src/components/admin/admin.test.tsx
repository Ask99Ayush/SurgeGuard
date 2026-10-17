import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { healthSummary } from "./AdminShell";
import { QueueView } from "./QueueView";
import { RoleProvider } from "./RoleContext";
import { SettingsView } from "./SettingsView";
import type { Overview } from "./types";

afterEach(() => vi.unstubAllGlobals());

const overview = (over: Partial<Overview> = {}): Overview => ({
  generated_at_ms: 0,
  queue: { waiting: 0, admitted_active: 2, counts: { waiting: 0, admitted: 2, expired: 5, rejected: 0 }, totals: {} },
  admission: { configured_rate: 10, measured_rate_per_s: 0, admitted_in_window: 0, window_seconds: 60, paused: null, auto_paused: null },
  worker: { alive: true, last_tick_ms: 0 },
  redis: { ok: true, latency_ms: 1 },
  backends: { total: 2, healthy: 2, reporting: 2 },
  ...over,
});

function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: string) => {
    const key = Object.keys(routes).find((k) => input.startsWith(k));
    if (!key) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

describe("healthSummary (top-bar dot)", () => {
  it("is green only when everything is healthy", () => {
    expect(healthSummary(overview(), true)).toEqual({ tone: "success", label: "All systems healthy" });
  });
  it("is amber when some backends are down and red for real failures", () => {
    expect(healthSummary(overview({ backends: { total: 2, healthy: 1, reporting: 2 } }), true).tone).toBe("warning");
    expect(healthSummary(overview({ backends: { total: 2, healthy: 0, reporting: 2 } }), true).tone).toBe("danger");
    expect(healthSummary(overview({ worker: { alive: false } }), true).label).toMatch(/worker/);
    expect(healthSummary(null, false).label).toMatch(/unreachable/);
  });
});

describe("QueueView", () => {
  it("opens on the All tab, shows every state, and keeps zero counts neutral", async () => {
    const fetchMock = routeFetch({
      "/api/admin/overview": overview(),
      "/api/admin/visitors": {
        state: "all",
        total: 1,
        page: 1,
        page_size: 25,
        items: [
          { visitor_id: "AAAAAAAAAAAAAAAAAAAAAA", state: "admitted", position: null, seq: 3, joined_at_ms: 1, updated_at_ms: 1,
            admitted_at_ms: 1, token_expires_at_ms: 1, expired_reason: null, reject_reason: null },
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RoleProvider value="admin">
        <QueueView />
      </RoleProvider>,
    );
    expect(screen.getByRole("tab", { name: /^all/i })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByText("admitted")).toBeInTheDocument());
    expect(String(fetchMock.mock.calls.find(([u]) => String(u).includes("/visitors"))?.[0])).toContain("state=all");
    const waitingTab = screen.getByRole("tab", { name: /waiting/i });
    const zero = within(waitingTab).getByText("0");
    expect(zero.className).toMatch(/text-subtle/);
    expect(zero.className).not.toMatch(/danger|accent/);
  });
});

describe("SettingsView", () => {
  it("groups values, marks changed defaults and offers copy buttons", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/admin/config": { app_env: "development", admission_rate: 10, admission_burst: 25, token_ttl_seconds: 300, defaults: { admission_burst: 10, token_ttl_seconds: 300 } },
        "/api/metrics/status": { targets: [], alerts: [] },
      }),
    );
    render(<SettingsView grafanaUrl={null} siteUrl={null} />);
    for (const group of ["Queue", "Tokens", "Rate limits", "Health checks"]) {
      expect(await screen.findByText(group)).toBeInTheDocument();
    }
    expect(screen.getAllByText("changed")).toHaveLength(1); // only admission_burst differs
    expect(screen.getByRole("button", { name: "Copy Admission burst" })).toBeInTheDocument();
  });
});
