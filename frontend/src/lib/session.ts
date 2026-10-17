/** Signed admin session (HS256 JWT in an HttpOnly cookie). Works in both Edge and Node runtimes. */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "sg_admin_session";
const ISSUER = "surgeguard-console";
const AUDIENCE = "surgeguard-admin";

const encoder = new TextEncoder();

/** admin = full control; viewer = read-only demo account. */
export type Role = "admin" | "viewer";

export interface Session {
  username: string;
  role: Role;
  expiresAt: number;
}

export async function createSessionToken(
  username: string,
  secret: string,
  ttlSeconds: number,
  role: Role = "admin",
): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(username)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(secret));
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
): Promise<Session | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.role !== "admin" && payload.role !== "viewer") return null;
    return { username: payload.sub, role: payload.role, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

/** Only allow same-site relative redirects after login (no open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  if (next.startsWith("/api/") || next.startsWith("/login")) return "/dashboard";
  return next;
}
