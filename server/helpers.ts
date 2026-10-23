import { storage } from "./storage";

export const COACH_CAPTAIN = ['Coach', 'Team Captain'];
export const COACH_CAPTAIN_DEPT_HEAD = ['Coach', 'Team Captain', 'Department Head'];
// 'Safety Trainer' was renamed to 'Trainer' (migration `role-safety-trainer-to-trainer`),
// but session JWTs carry a 30-day snapshot of the user's roles (see MemberToken
// in server/security.ts), so anyone already logged in at upgrade time still
// presents the old string. Both names are accepted until every pre-rename
// session has expired — remove 'Safety Trainer' after 2026-10-05.
export const TRAINER_ROLES = ['Trainer', 'Safety Trainer'];
export const COACH_CAPTAIN_TRAINER = ['Coach', 'Team Captain', ...TRAINER_ROLES];
export const TRAINER_COACH = [...TRAINER_ROLES, 'Coach'];
// Lives in shared/ so the client's role gates are the SAME list the routes
// enforce — see the header there. Re-exported rather than moved outright so the
// server keeps importing every role group from one place.
export { LEADERSHIP_ALL } from "../shared/roles";

export async function getUserRoles(userId: number): Promise<string[]> {
  const user = await storage.getUser(userId);
  return user ? (user.roles as string[]) : [];
}

export function hasAnyRole(userRoles: string[], allowedRoles: string[]): boolean {
  return userRoles.some(r => allowedRoles.includes(r));
}

export function roundToQuarterHour(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

type FirstCreds = { username: string; token: string };

// FIRST's official FTC Events API is the only external data source. Its
// credentials are a username + token pair, read from the Control Panel first
// and the FTC_API_USERNAME / FTC_API_TOKEN env vars as a fallback.
let _keyCache: { first: FirstCreds; expiresAt: number } | null = null;

async function getApiKeys() {
  const now = Date.now();
  if (_keyCache && _keyCache.expiresAt > now) return _keyCache;
  const envFirst: FirstCreds = {
    username: process.env.FTC_API_USERNAME || "",
    token:    process.env.FTC_API_TOKEN    || "",
  };
  try {
    const s = await storage.getTeamSettings();
    _keyCache = {
      first: {
        username: (s.ftcApiUsername as string | null) || envFirst.username,
        token:    (s.ftcApiToken    as string | null) || envFirst.token,
      },
      expiresAt: now + 5 * 60 * 1000,
    };
  } catch {
    _keyCache = { first: envFirst, expiresAt: now + 30 * 1000 };
  }
  return _keyCache;
}

export function invalidateApiKeyCache() {
  _keyCache = null;
}

// HTTP Basic over the username + token pair. `season` in paths is the 4-digit
// start year (2026 = the 2026–27 season) — see shared/ftcSeason.ts.
// FTC_API_BASE exists only to point at a mock server when testing.
const FIRST_BASE = process.env.FTC_API_BASE || "https://ftc-api.firstinspires.org/v2.0";

export async function firstFetch(path: string) {
  const { first } = await getApiKeys();
  if (!first.username || !first.token) {
    throw new Error("No FIRST API credentials configured. Add them in Control Panel → API Integrations.");
  }
  const auth = Buffer.from(`${first.username}:${first.token}`).toString("base64");
  const resp = await fetch(`${FIRST_BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    const err: any = new Error(`FIRST API error: ${resp.status} ${resp.statusText}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export async function hasFirstKey(): Promise<boolean> {
  const { first } = await getApiKeys();
  return !!(first.username && first.token);
}
