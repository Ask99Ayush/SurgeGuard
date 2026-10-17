import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestFailure } from "@/lib/client";
import type { QueueApi, QueueStatus } from "./types";
import { WaitingRoom } from "./WaitingRoom";

const waiting = (over: Partial<QueueStatus> = {}): QueueStatus => ({
  state: "waiting",
  position: 12,
  queue_length: 40,
  estimated_wait_seconds: null,
  estimate_status: "insufficient_data",
  measured_admission_rate: null,
  paused: false,
  poll_after_seconds: 3,
  admitted_until: null,
  redirect_to: null,
  ...over,
});

function api(join: QueueApi["join"], status: QueueApi["status"] = join): QueueApi {
  return { join: vi.fn(join), status: vi.fn(status) };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("WaitingRoom", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));
  afterEach(() => vi.useRealTimers());

  it("shows a loading state before the first response", () => {
    render(<WaitingRoom api={api(() => new Promise(() => {}))} />);
    expect(screen.getByText(/finding your place/i)).toBeInTheDocument();
  });

  it("shows the real position and says the estimate is unavailable without data", async () => {
    render(<WaitingRoom api={api(async () => waiting())} />);
    await flush();
    expect(screen.getByTestId("position")).toHaveTextContent("12");
    expect(screen.getByText(/40 people waiting in total/)).toBeInTheDocument();
    expect(screen.getByText("Estimate unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("estimate")).not.toBeInTheDocument();
  });

  it("shows an approximate wait only when the server measured one", async () => {
    render(<WaitingRoom api={api(async () => waiting({ estimate_status: "available", estimated_wait_seconds: 300 }))} />);
    await flush();
    expect(screen.getByTestId("estimate")).toHaveTextContent("about 5 minutes");
  });

  it("explains a paused queue", async () => {
    render(<WaitingRoom api={api(async () => waiting({ paused: true, estimate_status: "paused" }))} />);
    await flush();
    expect(screen.getByText("Admission is paused.")).toBeInTheDocument();
  });

  it("polls status and updates the position (each poll is a heartbeat)", async () => {
    const status = vi.fn().mockResolvedValueOnce(waiting({ position: 5 })).mockResolvedValue(waiting({ position: 2 }));
    const client = { join: vi.fn(async () => waiting({ position: 8 })), status };
    render(<WaitingRoom api={client} />);
    await flush();
    expect(screen.getByTestId("position")).toHaveTextContent("8");
    await act(async () => void vi.advanceTimersByTime(3000));
    await flush();
    expect(screen.getByTestId("position")).toHaveTextContent("5");
    await act(async () => void vi.advanceTimersByTime(3000));
    await flush();
    expect(screen.getByTestId("position")).toHaveTextContent("2");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });

  it("redirects once admitted, only to a same-site path", async () => {
    const navigate = vi.fn();
    const admitted: QueueStatus = { ...waiting(), state: "admitted", position: null, redirect_to: "//evil.example" };
    render(<WaitingRoom api={api(async () => admitted)} navigate={navigate} admitDelayMs={10} />);
    await flush();
    expect(screen.getByText(/you're in/i)).toBeInTheDocument();
    await act(async () => void vi.advanceTimersByTime(20));
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("rejoins automatically when the session expired", async () => {
    const join = vi.fn().mockResolvedValueOnce({ ...waiting(), state: "expired" }).mockResolvedValue(waiting({ position: 3 }));
    render(<WaitingRoom api={{ join, status: vi.fn() }} />);
    await flush();
    await act(async () => void vi.advanceTimersByTime(300));
    await flush();
    expect(join).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("position")).toHaveTextContent("3");
  });

  it("shows the rejected state", async () => {
    render(<WaitingRoom api={api(async () => ({ ...waiting(), state: "rejected" }))} />);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(/can't admit this session/i);
  });

  it("shows a fail-closed message when the API is unavailable", async () => {
    const join = vi.fn().mockRejectedValue(new RequestFailure("http", 503, "unavailable", "unavailable", 5));
    render(<WaitingRoom api={{ join, status: vi.fn() }} />);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(/temporarily unavailable/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/nobody is being let in/i);
    expect(screen.getByText(/retrying automatically in 5s/i)).toBeInTheDocument();
  });

  it("shows the disconnected state on network failure and keeps the last known position", async () => {
    const status = vi.fn().mockRejectedValue(new RequestFailure("network", null, "Network unreachable"));
    const join = vi.fn().mockResolvedValueOnce(waiting({ position: 7 })).mockRejectedValue(new RequestFailure("network", null, "x"));
    render(<WaitingRoom api={{ join, status }} />);
    await flush();
    await act(async () => void vi.advanceTimersByTime(3000));
    await flush();
    expect(screen.getByText("You're offline")).toBeInTheDocument();
    expect(screen.getByText(/last known position: 7/i)).toBeInTheDocument();
  });
});
