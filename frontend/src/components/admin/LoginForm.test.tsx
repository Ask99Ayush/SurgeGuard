import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("LoginForm", () => {
  it("has labelled inputs and a disabled submit until filled", () => {
    render(<LoginForm next="/dashboard" />);
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
  });

  it("navigates to the server-approved redirect on success", async () => {
    const fetchMock = respond(200, { ok: true, redirect: "/queue" });
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    render(<LoginForm next="/queue" navigate={navigate} />);
    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(navigate).toHaveBeenCalledWith("/queue");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ username: "admin", password: "secret", next: "/queue" });
  });

  it("shows the server error on bad credentials", async () => {
    vi.stubGlobal("fetch", respond(401, { error: { code: "invalid_credentials", message: "Incorrect username or password." } }));
    const navigate = vi.fn();
    render(<LoginForm next="/dashboard" navigate={navigate} />);
    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username or password.");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows only the demo button, without printing the credentials", () => {
    render(<LoginForm next="/dashboard" demo={{ username: "demo", password: "surgeguard-demo", role: "admin" }} />);
    expect(screen.getByRole("button", { name: /use demo account/i })).toBeInTheDocument();
    expect(screen.queryByText(/surgeguard-demo/)).not.toBeInTheDocument();
  });

  it("hides the demo option unless the server provides it", () => {
    render(<LoginForm next="/dashboard" />);
    expect(screen.queryByRole("button", { name: /use demo account/i })).not.toBeInTheDocument();
  });

  it("signs in with the demo account in one click", async () => {
    const fetchMock = respond(200, { ok: true, redirect: "/dashboard" });
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    render(<LoginForm next="/dashboard" demo={{ username: "demo", password: "surgeguard-demo" }} navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: /use demo account/i }));
    expect(navigate).toHaveBeenCalledWith("/dashboard");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ username: "demo", password: "surgeguard-demo" });
  });

  it("shows rate limiting", async () => {
    vi.stubGlobal("fetch", respond(429, { error: { code: "rate_limited", message: "Too many attempts. Try again in 120s." } }));
    render(<LoginForm next="/dashboard" />);
    await userEvent.type(screen.getByLabelText("Username"), "a");
    await userEvent.type(screen.getByLabelText("Password"), "b");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
  });

  it("signs in with root admin sudo access in one click", async () => {
    const fetchMock = respond(200, { ok: true, redirect: "/dashboard" });
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    render(<LoginForm next="/dashboard" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: /one-click root admin/i }));
    expect(navigate).toHaveBeenCalledWith("/dashboard");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ username: "admin", password: "admin123" });
  });

  it("auto-fills admin credentials when clicking auto-fill", async () => {
    render(<LoginForm next="/dashboard" />);
    await userEvent.click(screen.getByRole("button", { name: /auto-fill credentials/i }));
    expect(screen.getByLabelText("Username")).toHaveValue("admin");
    expect(screen.getByLabelText("Password")).toHaveValue("admin123");
  });
});

