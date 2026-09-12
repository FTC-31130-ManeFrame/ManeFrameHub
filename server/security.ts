import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "crypto";
import type { Request } from "express";

const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Session tokens (JWT in an httpOnly cookie)
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "piobyte_session";
const SESSION_TTL = "30d";

// In production a real secret MUST be provided via env. In dev we fall back to
// a fixed value so the app runs out of the box; index.ts warns loudly if unset.
const isProduction = process.env.NODE_ENV === "production";
export const SESSION_SECRET =
  process.env.SESSION_SECRET || (isProduction ? "" : "dev-only-insecure-session-secret");

export type MemberToken = { kind: "member"; userId: number; roles: string[] };
export type GuestToken = { kind: "guest"; eventId: number };
export type SessionToken = MemberToken | GuestToken;

export function signSession(payload: SessionToken): string {
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: SESSION_TTL });
}

export function verifySession(token: string | undefined | null): SessionToken | null {
  if (!token || !SESSION_SECRET) return null;
  try {
    return jwt.verify(token, SESSION_SECRET) as SessionToken;
  } catch {
    return null;
  }
}

// Replit runs the *preview* with `npm run dev` (see .replit), so NODE_ENV is
// "development" there even though the browser reaches us over Replit's HTTPS
// edge. Detect the platform directly rather than depending on X-Forwarded-Proto
// surviving Vite's proxy hop to the API.
const onReplit = Boolean(
  process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS,
);

/**
 * Cookie options for setting/clearing the session cookie.
 *
 * Replit embeds the app in a cross-site iframe, and browsers refuse to store or
 * send a SameSite=Lax cookie in a third-party frame — which silently broke
 * login and every authenticated write. SameSite=None fixes that but requires
 * Secure, so plain-HTTP local dev keeps Lax. Both attributes therefore follow
 * the transport together.
 *
 * Note SameSite=None only works where third-party cookies are allowed; Safari
 * blocks them outright, so the embedded preview is effectively Chrome-only.
 * Opening the app in its own tab works everywhere.
 */
export function sessionCookieOptions(req?: Pick<Request, "secure">) {
  const secure = isProduction || onReplit || Boolean(req?.secure);
  return {
    httpOnly: true,
    sameSite: (secure ? "none" : "lax") as "none" | "lax",
    secure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

/** True if a stored value is already a bcrypt hash (vs. a legacy plaintext password). */
export function isHashed(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\$2[aby]\$/.test(value);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a stored value.
 * Supports lazy migration: if the stored value is still legacy plaintext, we
 * compare directly and signal (via `needsRehash`) that the caller should
 * re-store it as a hash on successful login.
 */
export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!stored) return { ok: false, needsRehash: false };
  if (isHashed(stored)) {
    return { ok: await bcrypt.compare(plain, stored), needsRehash: false };
  }
  // Legacy plaintext row — accept on exact match, then upgrade to a hash.
  // Constant-time compare so login timing doesn't leak how much of the password
  // matched. Length is compared first (unavoidably non-secret) so the buffers
  // fed to timingSafeEqual are equal-length.
  const a = Buffer.from(plain);
  const b = Buffer.from(stored);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return { ok, needsRehash: ok };
}

/** Strip the password field from a user object before sending it to a client. */
export function sanitizeUser<T extends { password?: unknown }>(user: T): Omit<T, "password"> {
  if (!user) return user;
  const { password, ...rest } = user as any;
  return rest;
}
