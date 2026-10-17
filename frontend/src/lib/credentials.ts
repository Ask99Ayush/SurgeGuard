import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time username check plus bcrypt verification (always runs, to keep timing uniform). */
export async function verifyCredentials(
  username: string,
  password: string,
  expectedUsername: string,
  passwordHash: string,
): Promise<boolean> {
  const userOk = timingSafeEqual(digest(username), digest(expectedUsername));
  const passOk = await bcrypt.compare(password, passwordHash);
  return userOk && passOk;
}

/**
 * Constant-time check of a plain-text credential pair from the environment (demo and reviewer
 * accounts, which are meant to be shared and so are not hashed).
 */
export function verifyPlainCredentials(
  username: string,
  password: string,
  expected: { username: string; password: string },
): boolean {
  const userOk = timingSafeEqual(digest(username), digest(expected.username));
  const passOk = timingSafeEqual(digest(password), digest(expected.password));
  return userOk && passOk;
}
