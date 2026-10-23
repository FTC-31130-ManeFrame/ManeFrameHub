import { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, verifySession } from "../security";

// Augment Express's Request with the authenticated identity.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
      userRoles?: string[];
      guestEventId?: number;
    }
  }
}

/**
 * Endpoints reachable without a session. Matched against the path *after* the
 * `/api` mount prefix (e.g. "/login"). Regexes allow the dynamic PWA-icon paths.
 */
const PUBLIC: Array<{ method: string; test: (path: string) => boolean }> = [
  { method: "POST", test: (p) => p === "/login" },
  { method: "POST", test: (p) => p === "/guest-login" },
  { method: "GET", test: (p) => p === "/settings/pwa-icon.png" },
  { method: "GET", test: (p) => p === "/settings/pwa-icon.svg" },
  { method: "GET", test: (p) => p === "/settings" },        // team identity/theme for the login screen
  { method: "GET", test: (p) => p === "/settings/api-status" },
  // Personal calendar subscription feed — polled by external calendar apps
  // (Google/Apple/Outlook) that never carry a session cookie. The feed token
  // itself is the credential; see server/routes/calendarFeed.ts.
  { method: "GET", test: (p) => /^\/calendar\/feed\/[^/]+\.ics$/i.test(p) },
];

function isPublic(method: string, path: string): boolean {
  return PUBLIC.some((r) => r.method === method && r.test(path));
}

/**
 * Read-only scouting endpoints a guest (alliance partner with a PIN) may reach.
 * Everything else is 403 for guests.
 */
function guestAllowed(method: string, path: string): boolean {
  if (method !== "GET") return false;
  return (
    /^\/scout-events(\/|$)/.test(path) ||        // event list + pit/match reads + export
    /^\/scout\/events\/\d+\/export\.csv$/.test(path) ||
    /^\/scout\/team\//.test(path) ||
    /^\/events\/\d+\/(team-claims|match-exceptions)$/.test(path) ||
    /^\/seasons\/\d+\/templates$/.test(path) ||   // field labels for rendering scouting data
    /^\/first\/event\/[^/]+\/(matches|rankings|teams)$/.test(path)   // FIRST schedule/results for viewing
  );
}

/**
 * A guest PIN authenticates against ONE scout event. Beyond the method/path
 * allow-list above, a guest may only read data for their own event: any path
 * carrying an explicit event id must match the session's `eventId`, and
 * cross-event history is denied outright. Paths without an event id (the bare
 * event list, third-party proxies) are permitted.
 */
function guestEventScopeOk(path: string, eventId: number): boolean {
  // Cross-event team history spans all events — not scopable to one; deny.
  if (/^\/scout\/team\//.test(path)) return false;
  const m =
    path.match(/^\/scout-events\/(\d+)(?:\/|$)/) ||
    path.match(/^\/scout\/events\/(\d+)(?:\/|$)/) ||
    path.match(/^\/events\/(\d+)\/(?:team-claims|match-exceptions)/);
  if (m) return parseInt(m[1], 10) === eventId;
  return true;
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const path = req.path; // path within the /api router, e.g. "/users"
  if (isPublic(req.method, path)) return next();

  const session = verifySession(req.cookies?.[SESSION_COOKIE]);
  if (!session) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (session.kind === "guest") {
    if (!guestAllowed(req.method, path) || !guestEventScopeOk(path, session.eventId)) {
      return res.status(403).json({ error: "Guests have read-only access to scouting for their event" });
    }
    req.guestEventId = session.eventId;
    return next();
  }

  req.userId = session.userId;
  req.userRoles = session.roles || [];

  // Trust the session, never the client, for "who is acting". Existing routes
  // read the actor id from these body/query fields to run role checks and set
  // attribution; overwrite any that are present with the authenticated id so a
  // logged-in user cannot forge a higher-privilege actor. `userId` is left
  // alone because it denotes the *subject* of an action, not the actor.
  overwriteActorFields(req);
  next();
}

const ACTOR_FIELDS = [
  "requesterId",
  "createdBy",
  "coachId",
  "actorId",
  "grantedBy",
  "trainerId",
  "updatedBy",
  "deletedBy",
  "authorId",
];

function overwriteActorFields(req: Request) {
  const uid = req.userId;
  if (uid === undefined) return;
  for (const f of ACTOR_FIELDS) {
    if (req.body && typeof req.body === "object" && f in req.body) req.body[f] = uid;
    if (req.query && f in req.query) (req.query as any)[f] = String(uid);
  }
}

/** Route guard: require the caller to hold at least one of the given roles. */
export function requireRoles(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles = req.userRoles || [];
    if (!roles.some((r) => allowed.includes(r))) {
      return res.status(403).json({ error: "You don't have permission to do that" });
    }
    next();
  };
}
