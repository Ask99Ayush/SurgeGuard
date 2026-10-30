import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComparisonDashboard } from "./ComparisonDashboard";

afterEach(() => vi.unstubAllGlobals());

function mockStatusFetch(telemetry: Record<string, unknown>) {
  return vi.fn(async (input: string) => {
    if (input.includes("/api/demo/status")) {
      return new Response(JSON.stringify(telemetry), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  });
}

describe("ComparisonDashboard", () => {
  it("renders side-by-side Guarded and Unguarded panels with Healthy status", async () => {
    const mockData = {
      guarded: {
        status: "Healthy",
        queueLength: 0,
        admissionRate: 10,
        admissionStatus: "Active",
        originHealth: "Healthy",
        healthyNodes: 2,
        totalNodes: 2,
        responseStatus: 200,
        latencyMs: 110,
        overloadRate: 0,
      },
      unguarded: {
        status: "Healthy",
        originHealth: "Healthy",
        responseStatus: 200,
        activeSlots: 0,
        maxSlots: 8,
        successRate: 100,
        failureRate: 0,
        p50LatencyMs: 140,
        p95LatencyMs: 165,
      },
      updatedAt: new Date().toISOString(),
    };

    vi.stubGlobal("fetch", mockStatusFetch(mockData));

    render(<ComparisonDashboard />);

    expect(screen.getByText("DEMO 1 — GUARDED")).toBeInTheDocument();
    expect(screen.getByText("DEMO 2 — UNGUARDED")).toBeInTheDocument();

    await waitFor(() => {
      const upBadges = screen.getAllByText(/UP/i);
      expect(upBadges.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("0 visitors waiting")).toBeInTheDocument();
      expect(screen.getByText("0 / 8 busy")).toBeInTheDocument();
    });
  });

  it("reflects DEGRADED status when the unguarded origin is overloaded under load", async () => {
    const mockOverloadedData = {
      guarded: {
        status: "Healthy",
        queueLength: 15,
        admissionRate: 10,
        admissionStatus: "Active",
        originHealth: "Healthy",
        healthyNodes: 2,
        totalNodes: 2,
        responseStatus: 200,
        latencyMs: 120,
        overloadRate: 0,
      },
      unguarded: {
        status: "Degraded",
        originHealth: "Overloaded",
        responseStatus: 503,
        activeSlots: 8,
        maxSlots: 8,
        successRate: 40,
        failureRate: 60,
        p50LatencyMs: 1200,
        p95LatencyMs: 1850,
        total503s: 24,
      },
      updatedAt: new Date().toISOString(),
    };

    vi.stubGlobal("fetch", mockStatusFetch(mockOverloadedData));

    render(<ComparisonDashboard />);

    await waitFor(() => {
      // Guarded is UP, Unguarded is DEGRADED
      const degradedBadges = screen.getAllByText(/DEGRADED/i);
      expect(degradedBadges.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("8 / 8 busy")).toBeInTheDocument();
      expect(screen.getByText("HTTP 503 (Overloaded)")).toBeInTheDocument();
      expect(screen.getByText("15 visitors waiting")).toBeInTheDocument();
    });
  });
});
