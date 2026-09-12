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

let _keyCache: { tba: string; toa: string; nexus: string; expiresAt: number } | null = null;

async function getApiKeys() {
  const now = Date.now();
  if (_keyCache && _keyCache.expiresAt > now) return _keyCache;
  try {
    const s = await storage.getTeamSettings();
    _keyCache = {
      tba:   (s.tbaApiKey   as string | null) || process.env.TBA_API_KEY   || "",
      toa:   (s.toaApiKey   as string | null) || process.env.TOA_API_KEY   || "",
      nexus: (s.nexusApiKey as string | null) || process.env.NEXUS_API_KEY || "",
      expiresAt: now + 5 * 60 * 1000,
    };
  } catch {
    _keyCache = {
      tba:   process.env.TBA_API_KEY   || "",
      toa:   process.env.TOA_API_KEY   || "",
      nexus: process.env.NEXUS_API_KEY || "",
      expiresAt: now + 30 * 1000,
    };
  }
  return _keyCache;
}

export function invalidateApiKeyCache() {
  _keyCache = null;
}

export async function getResolvedKeys() {
  return getApiKeys();
}

const TBA_BASE = "https://www.thebluealliance.com/api/v3";
export const TBA_KEY = process.env.TBA_API_KEY || "";

export async function tbaFetch(path: string) {
  const { tba } = await getApiKeys();
  const resp = await fetch(`${TBA_BASE}${path}`, {
    headers: { "X-TBA-Auth-Key": tba },
  });
  if (!resp.ok) throw new Error(`TBA API error: ${resp.status}`);
  return resp.json();
}

export async function hasTbaKey(): Promise<boolean> {
  const { tba } = await getApiKeys();
  return !!tba;
}

const TOA_BASE = "https://api.theorangealliance.org";
export const TOA_KEY = process.env.TOA_API_KEY || "";

export async function toaFetch(path: string) {
  const { toa } = await getApiKeys();
  if (!toa) throw new Error("No TOA API key configured. Add one in the Control Panel.");
  const resp = await fetch(`${TOA_BASE}${path}`, {
    headers: {
      "X-TOA-Key": toa,
      "X-Application-Origin": "ManeFrameHub",
    },
  });
  if (!resp.ok) {
    const err: any = new Error(`TOA API error: ${resp.status} ${resp.statusText}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export async function hasToaKey(): Promise<boolean> {
  const { toa } = await getApiKeys();
  return !!toa;
}

const NEXUS_BASE = "https://frc.nexus/api/v1";

export async function nexusFetch(path: string) {
  const { nexus } = await getApiKeys();
  if (!nexus) throw new Error("No Nexus API key configured. Add one in the Control Panel.");
  const resp = await fetch(`${NEXUS_BASE}${path}`, {
    headers: { "Nexus-Api-Key": nexus },
  });
  if (!resp.ok) {
    const err: any = new Error(`Nexus API error: ${resp.status} ${resp.statusText}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export async function hasNexusKey(): Promise<boolean> {
  const { nexus } = await getApiKeys();
  return !!nexus;
}
