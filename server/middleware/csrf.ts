import type { Request, Response, NextFunction } from "express";

const isProduction = process.env.NODE_ENV === "production";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Extra permitted origins, comma-separated (e.g. a custom domain). */
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function hostOf(value?: string | null): string | null {
  try {
    return value ? new URL(value).host : null;
  } catch {
    return null;
  }
}

/**
 * Reject cross-site state-changing requests.
 *
 * The session cookie is SameSite=None (required for Replit's iframe — see
 * sessionCookieOptions in server/security.ts), which gives up the browser's
 * built-in CSRF protection. `overwriteActorFields` in ./auth stops a caller
 * forging *who* they are, but not a forged request riding a genuine session,
 * so the origin check has to happen here.
 *
 * Requests made from inside the Replit iframe carry the app's own Origin, not
 * replit.com, so the embedded preview passes this check.
 */
export function verifyOrigin(req: Request, res: Response, next: NextFunction) {
  // Dev is reached through Vite's proxy, which rewrites Host — the comparison
  // can't hold there, and the dev server isn't internet-reachable anyway.
  if (!isProduction) return next();
  if (SAFE_METHODS.has(req.method)) return next();

  const raw = req.get("origin") || req.get("referer");
  // A browser always sends Origin on a cross-site write and cannot be made to
  // drop it, so an absent header means a non-browser client (curl, a native
  // app) — not something CSRF can target.
  if (!raw) return next();

  // Present but unparseable, or the opaque "null" origin. No real browser sends
  // that on a legitimate write, and it must not fall through to the branch
  // above, or a junk header would bypass the check entirely.
  const origin = hostOf(raw);
  if (!origin) return res.status(403).json({ error: "Cross-site request blocked" });

  const self = req.get("x-forwarded-host")?.split(",")[0].trim() || req.get("host");
  if (origin === self || EXTRA_ORIGINS.some((o) => hostOf(o) === origin)) return next();

  return res.status(403).json({ error: "Cross-site request blocked" });
}
