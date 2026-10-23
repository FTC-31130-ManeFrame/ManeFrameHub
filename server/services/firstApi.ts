// FIRST's official FTC Events API — the app's only external competition data.
//
// Everything here returns normalized shapes so routes and the client never
// see FIRST's raw JSON. Field names on events and teams were not fully listed
// in FIRST's published spec, so the mappers read defensively (e.g. both
// `stateprov` and `stateProv`).

import { firstFetch } from "../helpers";
import { storage } from "../storage";
import { ftcSeasonFor } from "../../shared/ftcSeason";

export interface FirstEvent {
  code: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  location: string;
  type: string;
}

export interface FirstTeam {
  team_number: number;
  team_name_short: string;
  team_name: string;
  city: string;
  state_prov: string;
  country: string;
}

const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);

export function normalizeFirstEvent(e: any): FirstEvent {
  return {
    code: String(e?.code || "").toUpperCase(),
    name: e?.name || e?.code || "FTC Event",
    startDate: day(e?.dateStart),
    endDate: day(e?.dateEnd),
    location: [e?.venue, e?.city, e?.stateprov ?? e?.stateProv, e?.country].filter(Boolean).join(", "),
    type: e?.typeName || e?.type || "",
  };
}

// The season's event list is a few hundred rows and changes rarely, so it is
// cached briefly rather than fetched on every search keystroke.
const seasonEventsCache = new Map<number, { at: number; events: FirstEvent[] }>();
const SEASON_EVENTS_TTL = 10 * 60 * 1000;

export async function listSeasonEvents(season: number): Promise<FirstEvent[]> {
  const hit = seasonEventsCache.get(season);
  if (hit && Date.now() - hit.at < SEASON_EVENTS_TTL) return hit.events;
  const data: any = await firstFetch(`/${season}/events`);
  const events = (Array.isArray(data?.events) ? data.events : [])
    .map(normalizeFirstEvent)
    .filter((e: FirstEvent) => e.code);
  seasonEventsCache.set(season, { at: Date.now(), events });
  return events;
}

export async function listTeamEvents(season: number, teamNumber: number): Promise<FirstEvent[]> {
  const data: any = await firstFetch(`/${season}/events?teamNumber=${teamNumber}`);
  return (Array.isArray(data?.events) ? data.events : []).map(normalizeFirstEvent).filter((e: FirstEvent) => e.code);
}

export async function getFirstEvent(season: number, code: string): Promise<FirstEvent | null> {
  const data: any = await firstFetch(`/${season}/events?eventCode=${encodeURIComponent(code)}`);
  const raw = Array.isArray(data?.events) ? data.events[0] : null;
  return raw ? normalizeFirstEvent(raw) : null;
}

/** All teams at an event. The endpoint paginates; a single call truncates big events. */
export async function fetchEventTeams(season: number, code: string): Promise<FirstTeam[]> {
  const collected: any[] = [];
  let page = 1;
  let pageTotal = 1;
  do {
    const data: any = await firstFetch(`/${season}/teams?eventCode=${encodeURIComponent(code)}&page=${page}`);
    collected.push(...(Array.isArray(data?.teams) ? data.teams : []));
    pageTotal = Number(data?.pageTotal) || 1;
    page++;
  } while (page <= pageTotal && page <= 25); // hard stop so a bad pageTotal can't spin
  return collected
    .filter((t: any) => t?.teamNumber)
    .map((t: any) => ({
      team_number: t.teamNumber,
      team_name_short: t.nameShort || "",
      team_name: t.nameFull || t.nameShort || "",
      city: t.city || "",
      state_prov: t.stateProv || t.stateprov || "",
      country: t.country || "",
    }));
}

/** FIRST reports "QUALIFICATION"/"PLAYOFF"/"FINAL"; the client uses qm/sf/f. */
function compLevelOf(level: unknown): "qm" | "sf" | "f" {
  const s = String(level ?? "").toUpperCase();
  if (s.startsWith("QUAL")) return "qm";
  if (s.startsWith("FINAL")) return "f";
  return s ? "sf" : "qm";
}

export async function fetchEventMatches(season: number, code: string) {
  const raw: any = await firstFetch(`/${season}/matches/${encodeURIComponent(code)}`);
  const matches = Array.isArray(raw?.matches) ? raw.matches : [];
  return matches.map((m: any) => {
    const teams = Array.isArray(m.teams) ? m.teams : [];
    const keysFor = (side: string) =>
      teams
        .filter((t: any) => String(t.station || "").toLowerCase().startsWith(side))
        .map((t: any) => `ftc${t.teamNumber}`);
    const red = m.scoreRedFinal ?? -1;
    const blue = m.scoreBlueFinal ?? -1;
    // postResultTime is FIRST's own "this match is final" signal; the score
    // check is a fallback. A genuine 0-0 tie reads as unplayed — acceptable,
    // since the alternative is showing every unplayed match as a 0-0 tie.
    const played = m.postResultTime != null || (red >= 0 && blue >= 0 && red + blue > 0);
    const compLevel = compLevelOf(m.tournamentLevel);
    const number = m.matchNumber ?? 1;
    return {
      key: `${code}_${compLevel}${m.series ? `${m.series}m` : ""}${number}`,
      comp_level: compLevel,
      match_number: number,
      set_number: m.series || number,
      alliances: {
        red:  { team_keys: keysFor("red"),  score: red },
        blue: { team_keys: keysFor("blue"), score: blue },
      },
      winning_alliance: played && red !== blue ? (red > blue ? "red" : "blue") : "",
      post_result_time: played ? 1 : null,
    };
  });
}

export async function fetchEventRankings(season: number, code: string) {
  const data: any = await firstFetch(`/${season}/rankings/${encodeURIComponent(code)}`);
  const rows = Array.isArray(data?.rankings) ? data.rankings : [];
  return rows
    .filter((r: any) => r?.teamNumber)
    .map((r: any) => ({
      teamNumber: r.teamNumber,
      rank: r.rank ?? 0,
      rp: r.sortOrder1 ?? 0,
      record: `${r.wins ?? 0}-${r.losses ?? 0}-${r.ties ?? 0}`,
    }));
}

export interface FirstImportResult {
  scoutEvent: any;
  calendarEvent: any;
  createdScoutEvent: boolean;
  createdCalendarEvent: boolean;
  teamsAdded: number;
  teamsTotal: number;
}

/**
 * Import one FIRST event: a calendar event (attendance), a scout event linked
 * to it (scouting) and the team list (one robot row per team). Idempotent —
 * re-running reuses both events and only adds teams not already present, so
 * it doubles as "refresh the team list" once FIRST publishes it.
 */
export async function importFirstEvent(
  rawCode: string,
  actorId: number,
  season?: number,
): Promise<FirstImportResult> {
  const code = rawCode.trim().toUpperCase();
  const existingScout = await storage.getScoutEventByCode(code);
  const seasonYear = season ?? (existingScout?.startDate ? ftcSeasonFor(existingScout.startDate) : ftcSeasonFor());

  const event = await getFirstEvent(seasonYear, code);
  if (!event) {
    const err: any = new Error(`Event ${code} was not found in the ${seasonYear}–${String(seasonYear + 1).slice(2)} season.`);
    err.status = 404;
    throw err;
  }

  // Calendar event: the linked one, else a same-name same-day event from an
  // earlier calendar-only import, else a new one.
  let calendarEvent: any = existingScout?.calendarEventId
    ? await storage.getCalendarEvent(existingScout.calendarEventId)
    : undefined;
  let createdCalendarEvent = false;
  if (!calendarEvent && event.startDate) {
    const all = await storage.getCalendarEvents();
    calendarEvent = all.find(e => e.title === event.name && e.startDate === event.startDate);
  }
  if (!calendarEvent && event.startDate) {
    calendarEvent = await storage.createCalendarEvent({
      title: event.name,
      description: `FTC event ${code}`,
      startDate: event.startDate,
      endDate: event.endDate,
      startTime: null,
      endTime: null,
      type: "competition",
      location: event.location,
      attending: true,
      signupEnabled: true,
      createdBy: actorId,
    } as any);
    createdCalendarEvent = true;
  }

  // Scout event, linked to the calendar event and placed in the active season
  // so it picks up that season's templates.
  let scoutEvent: any = existingScout;
  let createdScoutEvent = false;
  if (scoutEvent) {
    const patch: Record<string, any> = {};
    if (calendarEvent && scoutEvent.calendarEventId !== calendarEvent.id) patch.calendarEventId = calendarEvent.id;
    if (!scoutEvent.startDate && event.startDate) patch.startDate = event.startDate;
    if (!scoutEvent.endDate && event.endDate) patch.endDate = event.endDate;
    if (!scoutEvent.location && event.location) patch.location = event.location;
    if (Object.keys(patch).length) scoutEvent = await storage.updateScoutEvent(scoutEvent.id, patch);
  } else {
    const activeSeason = (await storage.getSeasons()).find((s: any) => s.active);
    scoutEvent = await storage.createScoutEvent({
      name: event.name,
      location: event.location,
      startDate: event.startDate,
      endDate: event.endDate,
      eventCode: code,
      calendarEventId: calendarEvent?.id ?? null,
      seasonId: activeSeason?.id ?? null,
      createdBy: actorId,
    } as any);
    createdScoutEvent = true;
  }

  // Teams: one robot row each. FIRST publishes the list some time before the
  // event, so an empty list is normal early on — re-import later to fill it.
  const teams = await fetchEventTeams(seasonYear, code);
  const existing = new Set((await storage.getPitScouts(scoutEvent.id)).map((p: any) => p.teamNumber));
  let teamsAdded = 0;
  for (const t of teams) {
    if (existing.has(t.team_number)) continue;
    const teamName = t.team_name_short || t.team_name || `FTC Team ${t.team_number}`;
    await storage.createPitScout({
      eventId: scoutEvent.id,
      teamNumber: t.team_number,
      teamName,
      data: { teamNumber: t.team_number, teamName },
      scoutedBy: actorId,
    } as any);
    existing.add(t.team_number);
    teamsAdded++;
  }

  return { scoutEvent, calendarEvent, createdScoutEvent, createdCalendarEvent, teamsAdded, teamsTotal: teams.length };
}
