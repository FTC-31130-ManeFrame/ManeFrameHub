import { Router } from "express";
import { storage } from "../storage";
import { tbaFetch, TBA_KEY, nexusFetch, toaFetch, TOA_KEY, hasNexusKey } from "../helpers";
import { requireRoles } from "../middleware/auth";
import { BUILTIN_TEMPLATES, type ScoutKind, type TemplateField } from "../../shared/scoutingTemplates";
import { liveCompetitionEvents, localDatePT } from "../../utils/dates";
import { getTeamTimezone } from "../services/teamTime";

const router = Router();

// Members may enter scouting records (the normal competition workflow), but
// managing scout events, deleting records, imports, and assignments are
// leadership-only.
const SCOUT_MANAGERS = ["Coach", "Team Captain", "SCRUM Master"];
const requireScoutManager = requireRoles(...SCOUT_MANAGERS);

/** Resolve the template a scout event uses for a kind (custom → built-in fallback). */
async function resolveTemplateFields(event: any, kind: ScoutKind): Promise<TemplateField[]> {
  if (event?.seasonId) {
    const tpl = await storage.getTemplate(event.seasonId, kind);
    if (tpl?.fields?.length) return tpl.fields as TemplateField[];
  }
  return BUILTIN_TEMPLATES[kind].fields;
}

router.get("/scout-events", async (req, res) => {
  try {
    const events = await storage.getScoutEvents();
    if (req.query.active === "true") {
      const today = localDatePT(new Date(), await getTeamTimezone());
      return res.json(liveCompetitionEvents(events, today));
    }
    res.json(events);
  } catch (error) {
    console.error("Error fetching scout events:", error);
    res.status(500).json({ error: "Failed to fetch scout events" });
  }
});

router.post("/scout-events", requireScoutManager, async (req, res) => {
  try {
    const event = await storage.createScoutEvent(req.body);
    res.status(201).json(event);
  } catch (error) {
    console.error("Error creating scout event:", error);
    res.status(500).json({ error: "Failed to create scout event" });
  }
});

router.put("/scout-events/:id", requireScoutManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const event = await storage.updateScoutEvent(id, req.body);
    if (!event) return res.status(404).json({ error: "Scout event not found" });
    res.json(event);
  } catch (error) {
    console.error("Error updating scout event:", error);
    res.status(500).json({ error: "Failed to update scout event" });
  }
});

router.delete("/scout-events/:id", requireScoutManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteScoutEvent(id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting scout event:", error);
    res.status(500).json({ error: "Failed to delete scout event" });
  }
});

router.get("/scout-events/:eventId/pit-scouts", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const scouts = await storage.getPitScouts(eventId);
    res.json(scouts);
  } catch (error) {
    console.error("Error fetching pit scouts:", error);
    res.status(500).json({ error: "Failed to fetch pit scouts" });
  }
});

router.post("/scout-events/:eventId/pit-scouts", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const scout = await storage.createPitScout({ ...req.body, eventId });
    res.status(201).json(scout);
  } catch (error) {
    console.error("Error creating pit scout:", error);
    res.status(500).json({ error: "Failed to create pit scout" });
  }
});

router.put("/pit-scouts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const scout = await storage.updatePitScout(id, req.body);
    if (!scout) return res.status(404).json({ error: "Pit scout not found" });
    res.json(scout);
  } catch (error) {
    console.error("Error updating pit scout:", error);
    res.status(500).json({ error: "Failed to update pit scout" });
  }
});

router.delete("/pit-scouts/:id", requireScoutManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deletePitScout(id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting pit scout:", error);
    res.status(500).json({ error: "Failed to delete pit scout" });
  }
});

router.get("/scout/team/:teamNumber/all-matches", async (req, res) => {
  try {
    const teamNumber = parseInt(req.params.teamNumber);
    if (isNaN(teamNumber) || teamNumber <= 0) {
      return res.status(400).json({ error: "Invalid team number" });
    }
    const matches = await storage.getMatchScoutsByTeam(teamNumber);
    const allUsers = await storage.getUsers();
    const userMap = new Map(allUsers.map((u: any) => [u.id, u.displayName || u.username]));
    const enriched = matches.map(m => ({ ...m, scoutedByName: userMap.get(m.scoutedBy) || `User ${m.scoutedBy}` }));
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching team match scouts:", error);
    res.status(500).json({ error: "Failed to fetch team match scouts" });
  }
});

router.get("/scout-events/:eventId/match-scouts", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const scouts = await storage.getMatchScouts(eventId);
    const allUsers = await storage.getUsers();
    const userMap = new Map(allUsers.map((u: any) => [u.id, u.displayName || u.username]));
    const enriched = scouts.map(s => ({ ...s, scoutedByName: userMap.get(s.scoutedBy) || `User ${s.scoutedBy}` }));
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching match scouts:", error);
    res.status(500).json({ error: "Failed to fetch match scouts" });
  }
});

router.post("/scout-events/:eventId/match-scouts", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const scout = await storage.createMatchScout({ ...req.body, eventId });
    res.status(201).json(scout);
  } catch (error) {
    console.error("Error creating match scout:", error);
    res.status(500).json({ error: "Failed to create match scout" });
  }
});

router.put("/match-scouts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const scout = await storage.updateMatchScout(id, req.body);
    if (!scout) return res.status(404).json({ error: "Match scout not found" });
    res.json(scout);
  } catch (error) {
    console.error("Error updating match scout:", error);
    res.status(500).json({ error: "Failed to update match scout" });
  }
});

router.delete("/match-scouts/:id", requireScoutManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteMatchScout(id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting match scout:", error);
    res.status(500).json({ error: "Failed to delete match scout" });
  }
});

router.post("/scout-events/:eventId/import", requireScoutManager, async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const { matchScouts: matchData, pitScouts: pitData } = req.body;
    const results: any = { matchScouts: [], skipped: 0, imported: 0, robotsImported: 0, robotsSkipped: 0 };
    if (matchData && Array.isArray(matchData)) {
      const existing = await storage.getMatchScouts(eventId);
      const existingSet = new Set(
        existing.map(e => `${e.matchNumber}-${e.teamNumber}-${e.scoutedBy}`)
      );
      for (const ms of matchData) {
        const { id, createdAt, eventId: _eid, ...cleanMs } = ms;
        const key = `${cleanMs.matchNumber}-${cleanMs.teamNumber}-${cleanMs.scoutedBy}`;
        if (existingSet.has(key)) {
          results.skipped++;
          continue;
        }
        const scout = await storage.createMatchScout({ ...cleanMs, eventId });
        results.matchScouts.push(scout);
        results.imported++;
        existingSet.add(key);
      }
    }
    if (pitData && Array.isArray(pitData)) {
      const existingPits = await storage.getPitScouts(eventId);
      const existingTeams = new Set(existingPits.map(p => p.teamNumber));
      for (const ps of pitData) {
        const { id, createdAt, updatedAt, eventId: _eid, ...cleanPs } = ps;
        if (existingTeams.has(cleanPs.teamNumber)) {
          results.robotsSkipped++;
          continue;
        }
        await storage.createPitScout({ ...cleanPs, eventId });
        results.robotsImported++;
        existingTeams.add(cleanPs.teamNumber);
      }
    }
    res.status(201).json(results);
  } catch (error) {
    console.error("Error importing scout data:", error);
    res.status(500).json({ error: "Failed to import scout data" });
  }
});

router.get("/scout-events/:eventId/export", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const event = await storage.getScoutEvent(eventId);
    if (!event) return res.status(404).json({ error: "Scout event not found" });
    const pitScoutsData = await storage.getPitScouts(eventId);
    const matchScoutsData = await storage.getMatchScouts(eventId);
    res.json({ event, pitScouts: pitScoutsData, matchScouts: matchScoutsData });
  } catch (error) {
    console.error("Error exporting scout data:", error);
    res.status(500).json({ error: "Failed to export scout data" });
  }
});

// Escape a CSV cell, guarding against spreadsheet formula injection: a leading
// = + - @ (or tab/CR) is neutralized with a leading apostrophe.
function csvCell(v: any): string {
  if (v === null || v === undefined) return '';
  let s = Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Column order: active fields (template order), then archived fields flagged.
function csvColumns(fields: TemplateField[]): { header: string; key: string }[] {
  const active = fields.filter(f => !f.archived).map(f => ({ header: f.label, key: f.key }));
  const archived = fields.filter(f => f.archived).map(f => ({ header: `${f.label} (archived)`, key: f.key }));
  return [...active, ...archived];
}

function scoutValue(row: any, key: string): any {
  const data = row?.data;
  if (data && typeof data === 'object' && data[key] !== undefined) return data[key];
  return row?.[key]; // legacy-column fallback
}

async function sendScoutCsv(eventId: number, res: any) {
  const event = await storage.getScoutEvent(eventId);
  if (!event) { res.status(404).json({ error: "Scout event not found" }); return; }
  const pitScoutsData = await storage.getPitScouts(eventId);
  const matchScoutsData = await storage.getMatchScouts(eventId);
  const pitFields = await resolveTemplateFields(event, 'pit');
  const matchFields = await resolveTemplateFields(event, 'match');

  const rows: string[] = [];
  rows.push(`ManeFrame Hub Scout Export — ${csvCell(event.name)}`);
  rows.push(`Exported,${new Date().toISOString()}`);
  rows.push('');

  rows.push('=== PIT SCOUTS ===');
  const pitCols = csvColumns(pitFields);
  rows.push(['Scouted By', ...pitCols.map(c => c.header)].map(csvCell).join(','));
  for (const p of pitScoutsData as any[]) {
    rows.push([csvCell((p as any).scoutedByName ?? p.scoutedBy), ...pitCols.map(c => csvCell(scoutValue(p, c.key)))].join(','));
  }

  rows.push('');
  rows.push('=== MATCH SCOUTS ===');
  const matchCols = csvColumns(matchFields);
  rows.push(['Scouted By', ...matchCols.map(c => c.header)].map(csvCell).join(','));
  for (const m of matchScoutsData as any[]) {
    rows.push([csvCell((m as any).scoutedByName ?? m.scoutedBy), ...matchCols.map(c => csvCell(scoutValue(m, c.key)))].join(','));
  }

  const safeName = (event.name || 'scout').replace(/[^a-z0-9_\-]/gi, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_scouting.csv"`);
  res.send(rows.join('\r\n'));
}

router.get("/scout-events/:eventId/export.csv", async (req, res) => {
  try { await sendScoutCsv(parseInt(req.params.eventId), res); }
  catch (error) { console.error("Error exporting scout CSV:", error); res.status(500).json({ error: "Failed to export scout CSV" }); }
});

router.get("/scout/events/:id/export.csv", async (req, res) => {
  try { await sendScoutCsv(parseInt(req.params.id), res); }
  catch (error) { console.error("Error exporting scout CSV:", error); res.status(500).json({ error: "Failed to export scout CSV" }); }
});

router.get("/tba/event/:eventKey/matches", async (req, res) => {
  try {
    const data = await tbaFetch(`/event/${req.params.eventKey}/matches`);
    res.json(data);
  } catch (error) {
    console.error("TBA event matches error:", error);
    res.status(500).json({ error: "Failed to fetch TBA event matches" });
  }
});

router.get("/tba/event/:eventKey/teams", async (req, res) => {
  try {
    const data = await tbaFetch(`/event/${req.params.eventKey}/teams`);
    res.json(data);
  } catch (error) {
    console.error("TBA event teams error:", error);
    res.status(500).json({ error: "Failed to fetch TBA event teams" });
  }
});

router.get("/tba/event/:eventKey/rankings", async (req, res) => {
  try {
    const data = await tbaFetch(`/event/${req.params.eventKey}/rankings`);
    res.json(data);
  } catch (error) {
    console.error("TBA rankings error:", error);
    res.status(500).json({ error: "Failed to fetch TBA rankings" });
  }
});

router.get("/tba/team/:teamKey/event/:eventKey/matches", async (req, res) => {
  try {
    const data = await tbaFetch(`/team/${req.params.teamKey}/event/${req.params.eventKey}/matches`);
    res.json(data);
  } catch (error) {
    console.error("TBA team matches error:", error);
    res.status(500).json({ error: "Failed to fetch TBA team matches" });
  }
});

router.get("/tba/team/:teamKey/event/:eventKey/status", async (req, res) => {
  try {
    const data = await tbaFetch(`/team/${req.params.teamKey}/event/${req.params.eventKey}/status`);
    res.json(data);
  } catch (error) {
    console.error("TBA team status error:", error);
    res.status(500).json({ error: "Failed to fetch TBA team status" });
  }
});

router.get("/tba/team/:teamKey/events/:year", async (req, res) => {
  try {
    const data = await tbaFetch(`/team/${req.params.teamKey}/events/${req.params.year}`);
    res.json(data);
  } catch (error) {
    console.error("TBA team year events error:", error);
    res.status(500).json({ error: "Failed to fetch TBA team year events" });
  }
});

router.get("/tba/team/:teamKey/events/:year/statuses", async (req, res) => {
  try {
    const data = await tbaFetch(`/team/${req.params.teamKey}/events/${req.params.year}/statuses`);
    res.json(data);
  } catch (error) {
    console.error("TBA team year statuses error:", error);
    res.status(500).json({ error: "Failed to fetch TBA team year statuses" });
  }
});

router.get("/tba/match/:matchKey", async (req, res) => {
  try {
    const data = await tbaFetch(`/match/${req.params.matchKey}`);
    res.json(data);
  } catch (error) {
    console.error("TBA match error:", error);
    res.status(500).json({ error: "Failed to fetch TBA match" });
  }
});

router.get("/toa/event/:eventKey/matches", async (req, res) => {
  try {
    if (!TOA_KEY) return res.status(503).json({ error: "TOA_API_KEY is not configured" });
    const data = await toaFetch(`/event/${req.params.eventKey}/matches`);
    res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error("TOA event matches error:", error);
    res.status(500).json({ error: "Failed to fetch TOA event matches" });
  }
});

router.get("/toa/event/:eventKey/rankings", async (req, res) => {
  try {
    if (!TOA_KEY) return res.status(503).json({ error: "TOA_API_KEY is not configured" });
    const data = await toaFetch(`/event/${req.params.eventKey}/rankings`);
    res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error("TOA rankings error:", error);
    res.status(500).json({ error: "Failed to fetch TOA rankings" });
  }
});

router.get("/toa/event/:eventKey/teams", async (req, res) => {
  try {
    if (!TOA_KEY) return res.status(503).json({ error: "TOA_API_KEY is not configured" });
    const data = await toaFetch(`/event/${req.params.eventKey}/teams`);
    res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error("TOA event teams error:", error);
    res.status(500).json({ error: "Failed to fetch TOA event teams" });
  }
});

router.get("/toa/team/:teamKey/events/:season", async (req, res) => {
  try {
    if (!TOA_KEY) return res.status(503).json({ error: "TOA_API_KEY is not configured" });
    const data = await toaFetch(`/team/${req.params.teamKey}/events/${req.params.season}`);
    res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error("TOA team events error:", error);
    res.status(500).json({ error: "Failed to fetch TOA team events" });
  }
});

router.get("/toa/team/:teamKey/media", async (req, res) => {
  try {
    if (!TOA_KEY) return res.status(503).json({ error: "TOA_API_KEY is not configured" });
    const data = await toaFetch(`/team/${req.params.teamKey}/media`);
    const photos = Array.isArray(data)
      ? data.filter((m: any) => m.url).map((m: any) => ({ url: m.url, description: m.description || m.file_name || '' }))
      : [];
    res.json(photos);
  } catch (error) {
    console.error("TOA team media error:", error);
    res.status(500).json({ error: "Failed to fetch TOA team media" });
  }
});

router.get("/nexus/:eventKey", async (req, res) => {
  try {
    if (!(await hasNexusKey())) {
      return res.status(503).json({ error: "Nexus API key not configured. Add one in the Control Panel." });
    }
    const data = await nexusFetch(`/event/${req.params.eventKey}`);
    res.json(data);
  } catch (error: any) {
    const status = error?.status ?? error?.statusCode ?? 500;
    if (status === 404) {
      return res.status(404).json({ error: "Event not found in Nexus — it may have ended." });
    }
    console.error("Nexus event error:", error.message);
    res.status(500).json({ error: error.message || "Failed to fetch Nexus event data" });
  }
});

router.get("/nexus/:eventKey/pits", async (req, res) => {
  try {
    if (!(await hasNexusKey())) {
      return res.status(503).json({ error: "Nexus API key not configured. Add one in the Control Panel." });
    }
    const data = await nexusFetch(`/event/${req.params.eventKey}/pits`);
    res.json(data);
  } catch (error: any) {
    const status = error?.status ?? error?.statusCode ?? 500;
    if (status === 404) {
      return res.status(404).json({ error: "Event not found in Nexus — it may have ended." });
    }
    console.error("Nexus pits error:", error.message);
    res.status(500).json({ error: error.message || "Failed to fetch Nexus pit data" });
  }
});

router.get("/nexus/:eventKey/map", async (req, res) => {
  try {
    if (!(await hasNexusKey())) {
      return res.status(503).json({ error: "Nexus API key not configured. Add one in the Control Panel." });
    }
    const data = await nexusFetch(`/event/${req.params.eventKey}/map`);
    res.json(data);
  } catch (error: any) {
    const status = error?.status ?? error?.statusCode ?? 500;
    if (status === 404) {
      return res.status(404).json({ error: "Event not found in Nexus — it may have ended." });
    }
    console.error(`Nexus map error [${req.params.eventKey}]:`, error.message);
    res.status(status).json({ error: error.message || "Failed to fetch Nexus pit map" });
  }
});

router.get("/scout-events/:eventId/info", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const info = await storage.getEventInfo(eventId);
    res.json(info || { eventId });
  } catch (error) {
    console.error("Error fetching event info:", error);
    res.status(500).json({ error: "Failed to fetch event info" });
  }
});

router.put("/scout-events/:eventId/info", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const actorId = parseInt(req.body.updatedBy);
    if (!actorId) return res.status(400).json({ error: "updatedBy is required" });
    const actor = await storage.getUser(actorId);
    const actorRoles: string[] = actor?.roles || [];
    if (!actorRoles.includes("Coach") && !actorRoles.includes("Team Captain")) {
      return res.status(403).json({ error: "Only coaches and captains can update event info" });
    }
    const info = await storage.upsertEventInfo(eventId, req.body);
    res.json(info);
  } catch (error) {
    console.error("Error updating event info:", error);
    res.status(500).json({ error: "Failed to update event info" });
  }
});

router.get("/scout-events/:eventId/assignments", async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const assignments = await storage.getCompetitionAssignments(eventId);
    const allUsers = await storage.getUsers();
    const userMap = new Map(allUsers.map((u: any) => [u.id, u.name || u.username]));
    const enriched = assignments.map(a => ({
      ...a,
      userName: userMap.get(a.userId) || `User ${a.userId}`,
      createdByName: userMap.get(a.createdBy) || `User ${a.createdBy}`,
    }));
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching assignments:", error);
    res.status(500).json({ error: "Failed to fetch assignments" });
  }
});

router.post("/scout-events/:eventId/assignments", requireScoutManager, async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const actorId = parseInt(req.body.createdBy);
    if (!actorId) return res.status(400).json({ error: "createdBy is required" });
    const actor = await storage.getUser(actorId);
    const actorRoles: string[] = actor?.roles || [];
    if (!actorRoles.includes("Coach") && !actorRoles.includes("Team Captain")) {
      return res.status(403).json({ error: "Only coaches and captains can create assignments" });
    }
    const assignment = await storage.createCompetitionAssignment({ ...req.body, eventId });
    res.status(201).json(assignment);
  } catch (error) {
    console.error("Error creating assignment:", error);
    res.status(500).json({ error: "Failed to create assignment" });
  }
});

router.put("/scout-events/:eventId/assignments/:id", requireScoutManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const eventId = parseInt(req.params.eventId);
    const actorId = parseInt(req.body.createdBy);
    if (!actorId) return res.status(400).json({ error: "createdBy is required" });
    const actor = await storage.getUser(actorId);
    const actorRoles: string[] = actor?.roles || [];
    if (!actorRoles.includes("Coach") && !actorRoles.includes("Team Captain")) {
      return res.status(403).json({ error: "Only coaches and captains can update assignments" });
    }
    const existing = await storage.getCompetitionAssignment(id);
    if (!existing || existing.eventId !== eventId) return res.status(404).json({ error: "Assignment not found" });
    const assignment = await storage.updateCompetitionAssignment(id, req.body);
    res.json(assignment);
  } catch (error) {
    console.error("Error updating assignment:", error);
    res.status(500).json({ error: "Failed to update assignment" });
  }
});

router.delete("/scout-events/:eventId/assignments/:id", requireScoutManager, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const eventId = parseInt(req.params.eventId);
    const actorId = parseInt(req.query.requesterId as string);
    if (!actorId) return res.status(400).json({ error: "requesterId query param is required" });
    const actor = await storage.getUser(actorId);
    const actorRoles: string[] = actor?.roles || [];
    if (!actorRoles.includes("Coach") && !actorRoles.includes("Team Captain")) {
      return res.status(403).json({ error: "Only coaches and captains can delete assignments" });
    }
    const existing = await storage.getCompetitionAssignment(id);
    if (!existing || existing.eventId !== eventId) return res.status(404).json({ error: "Assignment not found" });
    await storage.deleteCompetitionAssignment(id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting assignment:", error);
    res.status(500).json({ error: "Failed to delete assignment" });
  }
});

router.get("/events/:id/team-claims", async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const claims = await storage.getTeamClaims(eventId);
    res.json(claims);
  } catch (error) {
    console.error("Error fetching team claims:", error);
    res.status(500).json({ error: "Failed to fetch team claims" });
  }
});

router.post("/events/:id/team-claims", async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { matchKey, teamNumber, userId, userName } = req.body;
    if (!matchKey || !teamNumber || !userId || !userName) {
      return res.status(400).json({ error: "matchKey, teamNumber, userId, userName are required" });
    }
    const claim = await storage.upsertTeamClaim({ eventId, matchKey, teamNumber: parseInt(teamNumber), userId: parseInt(userId), userName });
    res.status(201).json(claim);
  } catch (error) {
    console.error("Error upserting team claim:", error);
    res.status(500).json({ error: "Failed to upsert team claim" });
  }
});

router.delete("/events/:id/team-claims", async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { matchKey, teamNumber, userId } = req.body;
    if (!matchKey || !teamNumber || !userId) {
      return res.status(400).json({ error: "matchKey, teamNumber, userId are required" });
    }
    await storage.deleteTeamClaim(eventId, matchKey, parseInt(teamNumber), parseInt(userId));
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting team claim:", error);
    res.status(500).json({ error: "Failed to delete team claim" });
  }
});

router.get("/events/:id/match-exceptions", async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const exceptions = await storage.getMatchExceptions(eventId);
    res.json(exceptions);
  } catch (error) {
    console.error("Error fetching match exceptions:", error);
    res.status(500).json({ error: "Failed to fetch match exceptions" });
  }
});

router.post("/events/:id/match-exceptions", async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { userId, matchNumber, type = "off", createdBy } = req.body;
    if (!userId || !matchNumber || !createdBy) {
      return res.status(400).json({ error: "userId, matchNumber, createdBy are required" });
    }
    const actor = await storage.getUser(parseInt(createdBy));
    const actorRoles: string[] = actor?.roles || [];
    if (!actorRoles.includes("Coach") && !actorRoles.includes("Team Captain")) {
      return res.status(403).json({ error: "Only coaches and captains can mark match exceptions" });
    }
    const exception = await storage.upsertMatchException({ eventId, userId: parseInt(userId), matchNumber: parseInt(matchNumber), type, createdBy: parseInt(createdBy) });
    res.status(201).json(exception);
  } catch (error) {
    console.error("Error upserting match exception:", error);
    res.status(500).json({ error: "Failed to upsert match exception" });
  }
});

router.delete("/events/:id/match-exceptions", async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { userId, matchNumber, requesterId } = req.body;
    if (!userId || !matchNumber || !requesterId) {
      return res.status(400).json({ error: "userId, matchNumber, requesterId are required" });
    }
    const actor = await storage.getUser(parseInt(requesterId));
    const actorRoles: string[] = actor?.roles || [];
    if (!actorRoles.includes("Coach") && !actorRoles.includes("Team Captain")) {
      return res.status(403).json({ error: "Only coaches and captains can remove match exceptions" });
    }
    await storage.deleteMatchException(eventId, parseInt(userId), parseInt(matchNumber));
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting match exception:", error);
    res.status(500).json({ error: "Failed to delete match exception" });
  }
});

async function requireTeamMember(userId: number | undefined, res: any): Promise<boolean> {
  if (!userId || isNaN(userId)) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  const user = await storage.getUser(userId);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  return true;
}

router.get("/events/:id/guest-pin", requireScoutManager, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId as string);
    if (!(await requireTeamMember(userId, res))) return;
    const eventId = parseInt(req.params.id);
    const token = await storage.getActiveGuestToken(eventId);
    res.json(token || null);
  } catch (error) {
    console.error("Error fetching guest pin:", error);
    res.status(500).json({ error: "Failed to fetch guest pin" });
  }
});

router.post("/events/:id/guest-pin", requireScoutManager, async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { label, createdBy } = req.body;
    if (!(await requireTeamMember(createdBy ? parseInt(createdBy) : undefined, res))) return;
    let pin: string;
    let attempts = 0;
    do {
      pin = String(Math.floor(100000 + Math.random() * 900000));
      const collision = await storage.getGuestTokenByPin(pin);
      if (!collision) break;
      attempts++;
    } while (attempts < 10);
    const token = await storage.createGuestToken(eventId, pin, label || "Guest", parseInt(createdBy));
    res.status(201).json(token);
  } catch (error) {
    console.error("Error creating guest pin:", error);
    res.status(500).json({ error: "Failed to create guest pin" });
  }
});

router.delete("/events/:id/guest-pin", requireScoutManager, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId as string);
    if (!(await requireTeamMember(userId, res))) return;
    const eventId = parseInt(req.params.id);
    await storage.deactivateGuestToken(eventId);
    res.status(204).send();
  } catch (error) {
    console.error("Error deactivating guest pin:", error);
    res.status(500).json({ error: "Failed to deactivate guest pin" });
  }
});

router.get("/scout/events/:id/guest-pin", requireScoutManager, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId as string);
    if (!(await requireTeamMember(userId, res))) return;
    const eventId = parseInt(req.params.id);
    const token = await storage.getActiveGuestToken(eventId);
    res.json(token || null);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch guest pin" });
  }
});
router.post("/scout/events/:id/guest-pin", requireScoutManager, async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { label, createdBy } = req.body;
    if (!(await requireTeamMember(createdBy ? parseInt(createdBy) : undefined, res))) return;
    let pin: string;
    let attempts = 0;
    do {
      pin = String(Math.floor(100000 + Math.random() * 900000));
      const collision = await storage.getGuestTokenByPin(pin);
      if (!collision) break;
      attempts++;
    } while (attempts < 10);
    const token = await storage.createGuestToken(eventId, pin, label || "Guest", parseInt(createdBy));
    res.status(201).json(token);
  } catch (error) {
    res.status(500).json({ error: "Failed to create guest pin" });
  }
});
router.delete("/scout/events/:id/guest-pin", requireScoutManager, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId as string);
    if (!(await requireTeamMember(userId, res))) return;
    const eventId = parseInt(req.params.id);
    await storage.deactivateGuestToken(eventId);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to deactivate guest pin" });
  }
});

export default router;
