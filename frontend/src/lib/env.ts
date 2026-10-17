import type { Role } from "@/lib/session";

/**
 * Server-only configuration. Never import this from a client component: none of these values
 * may reach the browser bundle. Values are read at request time (runtime env), not build time.
 */

export class ConfigError extends Error {}

export interface ServerEnv {
  appEnv: string;
  apiInternalUrl: string;
  adminApiKey: string;
  adminUsername: string;
  adminPasswordHash: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  loginRateLimitAttempts: number;
  loginRateLimitWindowSeconds: number;
  cookieSecure: boolean;
  prometheusUrl: string | null;
  publicSiteUrl: string | null;
  publicGrafanaUrl: string | null;
  /** Demo account with public credentials (role from DEMO_ROLE). Only ever enabled in development/test. */
  demoLogin: { username: string; password: string; role: Role } | null;
  /** Shareable full-permission reviewer account. Only ever enabled in development/test. */
  reviewerLogin: { username: string; password: string } | null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.includes("<generated>")) throw new ConfigError(`${name} is not configured`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${name} must be a positive integer`);
  return value;
}

export function serverEnv(): ServerEnv {
  const appEnv = process.env.APP_ENV ?? "development";
  const sessionSecret = required("SESSION_SECRET");
  const minSecret = appEnv === "development" || appEnv === "test" ? 16 : 32;
  if (Buffer.byteLength(sessionSecret) < minSecret) {
    throw new ConfigError(`SESSION_SECRET must be at least ${minSecret} bytes`);
  }
  const hash = required("ADMIN_PASSWORD_HASH");
  if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(hash)) throw new ConfigError("ADMIN_PASSWORD_HASH must be a bcrypt hash");
  const cookieSecure = (process.env.COOKIE_SECURE ?? "false").toLowerCase() === "true";
  if (appEnv === "production" && !cookieSecure) throw new ConfigError("COOKIE_SECURE must be true in production");
  const demoEnabled = (process.env.DEMO_LOGIN_ENABLED ?? "false").toLowerCase() === "true";
  if (demoEnabled && appEnv !== "development" && appEnv !== "test") {
    throw new ConfigError("DEMO_LOGIN_ENABLED is only allowed when APP_ENV is development or test");
  }
  const demoRole = (process.env.DEMO_ROLE ?? "viewer").toLowerCase();
  if (demoRole !== "admin" && demoRole !== "viewer") throw new ConfigError("DEMO_ROLE must be admin or viewer");
  const demoLogin = demoEnabled
    ? { username: required("DEMO_USERNAME"), password: required("DEMO_PASSWORD"), role: demoRole as Role }
    : null;
  const reviewerEnabled = (process.env.REVIEWER_LOGIN_ENABLED ?? "false").toLowerCase() === "true";
  if (reviewerEnabled && appEnv !== "development" && appEnv !== "test") {
    throw new ConfigError("REVIEWER_LOGIN_ENABLED is only allowed when APP_ENV is development or test");
  }
  const reviewerLogin = reviewerEnabled
    ? { username: required("REVIEWER_USERNAME"), password: required("REVIEWER_PASSWORD") }
    : null;
  if (reviewerLogin && Buffer.byteLength(reviewerLogin.password) < 12) {
    throw new ConfigError("REVIEWER_PASSWORD must be at least 12 characters");
  }
  const usernames = [required("ADMIN_USERNAME"), demoLogin?.username, reviewerLogin?.username].filter(Boolean);
  if (new Set(usernames).size !== usernames.length) {
    throw new ConfigError("ADMIN_USERNAME, DEMO_USERNAME and REVIEWER_USERNAME must all differ");
  }
  return {
    appEnv,
    apiInternalUrl: required("API_INTERNAL_URL").replace(/\/$/, ""),
    adminApiKey: required("ADMIN_API_KEY"),
    adminUsername: required("ADMIN_USERNAME"),
    adminPasswordHash: hash,
    sessionSecret,
    sessionTtlSeconds: positiveInt("SESSION_TTL_SECONDS", 28800),
    loginRateLimitAttempts: positiveInt("LOGIN_RATE_LIMIT_ATTEMPTS", 5),
    loginRateLimitWindowSeconds: positiveInt("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 300),
    cookieSecure,
    prometheusUrl: optional("PROMETHEUS_URL")?.replace(/\/$/, "") ?? null,
    publicSiteUrl: optional("PUBLIC_SITE_URL"),
    publicGrafanaUrl: optional("PUBLIC_GRAFANA_URL"),
    demoLogin,
    reviewerLogin,
  };
}
