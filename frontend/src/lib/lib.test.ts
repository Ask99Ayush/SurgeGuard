// @vitest-environment node
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";
import { verifyCredentials, verifyPlainCredentials } from "./credentials";
import { formatApproxWait, formatPercent, formatRelative } from "./format";
import { parsePromResult } from "./promql";
import { LoginRateLimiter } from "./rate-limit";
import { SESSION_COOKIE, createSessionToken, safeNextPath, verifySessionToken } from "./session";

const SECRET = "test-session-secret-0123456789abcdef";

describe("session tokens", () => {
  it("round-trips", async () => {
    const token = await createSessionToken("admin", SECRET, 60);
    expect((await verifySessionToken(token, SECRET))?.username).toBe("admin");
  });
  it("rejects wrong secret, tampering and expiry", async () => {
    const token = await createSessionToken("admin", SECRET, 60);
    expect(await verifySessionToken(token, "another-secret-0123456789abcdef")).toBeNull();
    expect(await verifySessionToken(`${token.slice(0, -3)}abc`, SECRET)).toBeNull();
    expect(await verifySessionToken(await createSessionToken("admin", SECRET, -10), SECRET)).toBeNull();
    expect(await verifySessionToken(undefined, SECRET)).toBeNull();
    expect(await verifySessionToken(token, undefined)).toBeNull();
  });
  it("carries the role and defaults to admin", async () => {
    expect((await verifySessionToken(await createSessionToken("admin", SECRET, 60), SECRET))?.role).toBe("admin");
    const viewer = await createSessionToken("demo", SECRET, 60, "viewer");
    expect(await verifySessionToken(viewer, SECRET)).toMatchObject({ username: "demo", role: "viewer" });
  });
  it("rejects sessions without a known role", async () => {
    const enc = new TextEncoder();
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("x")
        .setIssuer("surgeguard-console")
        .setAudience("surgeguard-admin")
        .setExpirationTime("60s")
        .sign(enc.encode(SECRET));
    expect(await verifySessionToken(await sign({}), SECRET)).toBeNull();
    expect(await verifySessionToken(await sign({ role: "superuser" }), SECRET)).toBeNull();
  });
  it("only allows same-site relative redirects", () => {
    expect(safeNextPath("/queue?state=admitted")).toBe("/queue?state=admitted");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "/api/admin/x", "/login", null]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});

describe("middleware route protection", () => {
  process.env.SESSION_SECRET = SECRET;

  it("redirects unauthenticated admin pages to login with next", async () => {
    const res = await middleware(new NextRequest("http://console.local/queue?state=waiting"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/queue?state=waiting");
  });

  it("returns 401 JSON for unauthenticated admin API calls", async () => {
    const res = await middleware(new NextRequest("http://console.local/api/admin/overview"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("rejects a forged session cookie", async () => {
    const forged = await createSessionToken("admin", "attacker-secret-0123456789abcdef", 60);
    const req = new NextRequest("http://console.local/dashboard", { headers: { cookie: `${SESSION_COOKIE}=${forged}` } });
    expect((await middleware(req)).status).toBe(307);
  });

  it("lets a valid session through", async () => {
    const token = await createSessionToken("admin", SECRET, 60);
    const req = new NextRequest("http://console.local/dashboard", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    const res = await middleware(req);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("credentials", () => {
  it("verifies bcrypt hashes and the username", async () => {
    const hash = await bcrypt.hash("correct horse", 4);
    expect(await verifyCredentials("admin", "correct horse", "admin", hash)).toBe(true);
    expect(await verifyCredentials("admin", "wrong", "admin", hash)).toBe(false);
    expect(await verifyCredentials("root", "correct horse", "admin", hash)).toBe(false);
  });
  it("verifies the demo credentials exactly", () => {
    const demo = { username: "demo", password: "surgeguard-demo" };
    expect(verifyPlainCredentials("demo", "surgeguard-demo", demo)).toBe(true);
    expect(verifyPlainCredentials("demo", "surgeguard-dem", demo)).toBe(false);
    expect(verifyPlainCredentials("admin", "surgeguard-demo", demo)).toBe(false);
  });
});

describe("server env: shared logins", () => {
  const base = {
    APP_ENV: "development",
    API_INTERNAL_URL: "http://api:8000",
    ADMIN_API_KEY: "k".repeat(32),
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: "$2b$12$" + "a".repeat(53),
    SESSION_SECRET: "s".repeat(32),
  };
  const withEnv = async (vars: Record<string, string>) => {
    const saved = { ...process.env };
    Object.assign(process.env, base, vars);
    try {
      const { serverEnv } = await import("./env");
      return serverEnv();
    } finally {
      process.env = saved;
    }
  };

  it("enables the reviewer account in development", async () => {
    const env = await withEnv({ REVIEWER_LOGIN_ENABLED: "true", REVIEWER_USERNAME: "reviewer", REVIEWER_PASSWORD: "x".repeat(16) });
    expect(env.reviewerLogin).toEqual({ username: "reviewer", password: "x".repeat(16) });
  });
  it("refuses shared logins outside development/test", async () => {
    await expect(
      withEnv({ APP_ENV: "staging", REVIEWER_LOGIN_ENABLED: "true", REVIEWER_USERNAME: "r", REVIEWER_PASSWORD: "x".repeat(16) }),
    ).rejects.toThrow(/only allowed/);
    await expect(
      withEnv({ APP_ENV: "production", COOKIE_SECURE: "true", DEMO_LOGIN_ENABLED: "true", DEMO_USERNAME: "d", DEMO_PASSWORD: "p" }),
    ).rejects.toThrow(/only allowed/);
  });
  it("refuses weak or clashing reviewer credentials", async () => {
    await expect(
      withEnv({ REVIEWER_LOGIN_ENABLED: "true", REVIEWER_USERNAME: "reviewer", REVIEWER_PASSWORD: "short" }),
    ).rejects.toThrow(/at least 12/);
    await expect(
      withEnv({ REVIEWER_LOGIN_ENABLED: "true", REVIEWER_USERNAME: "admin", REVIEWER_PASSWORD: "x".repeat(16) }),
    ).rejects.toThrow(/must all differ/);
  });
});

describe("login rate limiter", () => {
  it("blocks after the limit until the window resets", () => {
    let now = 0;
    const limiter = new LoginRateLimiter(2, 1000, () => now);
    expect(limiter.attempt("ip")).toBe(0);
    expect(limiter.attempt("ip")).toBe(0);
    expect(limiter.attempt("ip")).toBeGreaterThan(0);
    expect(limiter.attempt("other")).toBe(0);
    now = 1001;
    expect(limiter.attempt("ip")).toBe(0);
  });
});

describe("format", () => {
  it("keeps waits approximate", () => {
    expect(formatApproxWait(20)).toBe("less than a minute");
    expect(formatApproxWait(61)).toBe("about 1 minute");
    expect(formatApproxWait(1500)).toBe("about 25 minutes");
    expect(formatApproxWait(4000)).toMatch(/^about 1 h/);
  });
  it("renders missing values as a dash, not zero", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatRelative(null)).toBe("never");
  });
});

describe("prometheus parsing", () => {
  it("turns NaN into null (no data), never zero", () => {
    const series = parsePromResult({
      status: "success",
      data: { resultType: "matrix", result: [{ metric: {}, values: [[1, "NaN"], [2, "3.5"]] }] },
    });
    expect(series[0]?.points).toEqual([
      { t: 1000, v: null },
      { t: 2000, v: 3.5 },
    ]);
  });
  it("throws on failed queries", () => {
    expect(() => parsePromResult({ status: "error" })).toThrow();
  });
});

describe("service URL resolution", () => {
  it("resolves protected, direct origin, and grafana dashboard URLs", async () => {
    const { getDirectOriginUrl, getGrafanaDashboardUrl, getProtectedSiteUrl, resolveServiceUrl } = await import("./urls");

    // Server-side fallback defaults
    expect(resolveServiceUrl(null, 8088)).toBe("http://3.109.184.177:8088");
    expect(getProtectedSiteUrl("https://surgeguard.example.com")).toBe("https://surgeguard.example.com");
    expect(getDirectOriginUrl(null)).toBe("http://3.109.184.177:8081");
    expect(getGrafanaDashboardUrl("surgeguard-backends", "http://3.109.184.177:3001")).toBe(
      "http://3.109.184.177:3001/d/surgeguard-backends"
    );
  });
});

