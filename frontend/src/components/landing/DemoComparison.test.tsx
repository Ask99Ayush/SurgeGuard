import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoComparison } from "./DemoComparison";

afterEach(() => vi.unstubAllGlobals());

const mockTelemetry = {
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
    p50LatencyMs: 150,
    p95LatencyMs: 175,
  },
  updatedAt: new Date().toISOString(),
};

describe("DemoComparison Component", () => {
  it("renders both Guarded and Unguarded demo cards with correct headers", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(mockTelemetry), { status: 200 })),
    );

    render(<DemoComparison demoUrl="https://guarded.example.com" directUrl="http://direct.example.com" />);

    expect(screen.getByText(/DEMO 1 · GUARDED/i)).toBeInTheDocument();
    expect(screen.getByText(/SurgeGuard Protected Origin/i)).toBeInTheDocument();

    expect(screen.getByText(/DEMO 2 · UNGUARDED/i)).toBeInTheDocument();
    expect(screen.getByText(/Direct Unprotected Baseline/i)).toBeInTheDocument();
  });

  it("updates live telemetry values from /api/demo/status", async () => {
    const loadedTelemetry = {
      ...mockTelemetry,
      guarded: {
        ...mockTelemetry.guarded,
        queueLength: 42,
        status: "Under Load",
      },
      unguarded: {
        ...mockTelemetry.unguarded,
        activeSlots: 8,
        status: "Degraded",
        originHealth: "Overloaded",
        responseStatus: 503,
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(loadedTelemetry), { status: 200 })),
    );

    render(<DemoComparison />);

    await waitFor(() => {
      expect(screen.getByText("42 waiting")).toBeInTheDocument();
      expect(screen.getByText(/8 \/ 8 Busy/i)).toBeInTheDocument();
      expect(screen.getByText("HTTP 503 (Overloaded)")).toBeInTheDocument();
    });
  });

  it("renders links for both protected and direct demos", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(mockTelemetry), { status: 200 })),
    );

    render(<DemoComparison demoUrl="https://guarded.test:8080" directUrl="http://direct.test:8081" />);

    const protectedLink = screen.getByRole("link", { name: /Enter Protected Demo/i });
    expect(protectedLink).toBeInTheDocument();
    expect(protectedLink).toHaveAttribute("href", "https://guarded.test:8080");

    const directLink = screen.getByRole("link", { name: /Open Direct Demo/i });
    expect(directLink).toBeInTheDocument();
    expect(directLink).toHaveAttribute("href", "http://direct.test:8081");
  });
});
