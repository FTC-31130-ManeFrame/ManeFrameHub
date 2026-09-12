import { Router } from "express";
import { storage } from "../storage";
import { getUserRoles, hasAnyRole, COACH_CAPTAIN_DEPT_HEAD, LEADERSHIP_ALL, tbaFetch, TBA_KEY, toaFetch, TOA_KEY } from "../helpers";
import { filterVisibleEvents } from "../services/eventVisibility";
import { sendPushToUsers } from "../push";

const router = Router();

router.get("/calendar", async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const events = await storage.getCalendarEvents(includeArchived);
    const roles = req.userId ? await getUserRoles(req.userId) : [];
    const visible = await filterVisibleEvents(events, req.userId!, roles);
    const enriched = await Promise.all(visible.map(async (e) => {
      const cap = (e as any).capacity as number | null;
      if (cap == null) return e;
      const acceptedCount = await storage.countAcceptedSignups(e.id);
      return { ...e, acceptedCount };
    }));
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching calendar events:", error);
    res.status(500).json({ error: "Failed to fetch calendar events" });
  }
});

router.patch("/calendar/:id/archive", async (req, res) => {
  try {
    const roles = await getUserRoles(req.userId);
    if (!hasAnyRole(roles, COACH_CAPTAIN_DEPT_HEAD)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const id = parseInt(req.params.id);
    const { archived } = req.body;
    const event = await storage.updateCalendarEvent(id, { archived: !!archived });
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(event);
  } catch (error) {
    console.error("Error archiving event:", error);
    res.status(500).json({ error: "Failed to archive event" });
  }
});

// Invite the given userIds to an event and notify the newly-added ones
// (in-app notification + push). Never blocks the caller on failure.
async function applyInvites(eventId: number, eventTitle: string, invitees: number[] | undefined, actorId: number) {
  if (!Array.isArray(invitees)) return;
  const before = new Set(await storage.getEventInviteeIds(eventId));
  const after = new Set(invitees.map((id) => parseInt(String(id))));

  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id) && id !== actorId);

  await storage.inviteUsersToEvent(eventId, added, actorId);
  await Promise.all(removed.map((id) => storage.uninviteUserFromEvent(eventId, id)));

  if (added.length === 0) return;
  const actor = await storage.getUser(actorId).catch(() => null);
  await Promise.all(added.map((toUserId) =>
    storage.createNotification({
      toUserId,
      fromUserId: actorId,
      message: `You've been invited to "${eventTitle}".`,
    }).catch((e) => console.error("createNotification (invite):", e))
  ));
  sendPushToUsers(added, {
    title: actor?.name ? `${actor.name} • ManeFrame Hub` : "ManeFrame Hub",
    body: `You've been invited to "${eventTitle}"`,
    url: "/#/calendar",
    tag: `event-invite-${eventId}`,
  }).catch((e) => console.error("sendPushToUsers (invite):", e));
}

router.post("/calendar", async (req, res) => {
  try {
    const { requesterId, invitees, ...data } = req.body;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(parseInt(requesterId));
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN_DEPT_HEAD)) {
      return res.status(403).json({ error: "Only Coaches, Captains, or Department Heads can create calendar events" });
    }
    // Roster participation is an event-level setting. Keep new events
    // roster-enabled by default for API callers that do not send the field;
    // the calendar form always sends the user's explicit choice.
    if (data.signupEnabled === undefined) data.signupEnabled = true;
    const event = await storage.createCalendarEvent({ ...data, createdBy: parseInt(requesterId) });
    if (data.inviteOnly) {
      await applyInvites(event.id, event.title, invitees, parseInt(requesterId));
    }
    res.status(201).json(event);
  } catch (error) {
    console.error("Error creating calendar event:", error);
    res.status(500).json({ error: "Failed to create calendar event" });
  }
});

router.put("/calendar/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { requesterId, invitees, ...data } = req.body;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(parseInt(requesterId));
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN_DEPT_HEAD)) {
      return res.status(403).json({ error: "Only Coaches, Captains, or Department Heads can edit calendar events" });
    }
    const event = await storage.updateCalendarEvent(id, data);
    if (!event) return res.status(404).json({ error: "Calendar event not found" });
    if (event.inviteOnly) {
      await applyInvites(event.id, event.title, invitees, parseInt(requesterId));
    }
    res.json(event);
  } catch (error) {
    console.error("Error updating calendar event:", error);
    res.status(500).json({ error: "Failed to update calendar event" });
  }
});

router.delete("/calendar/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const requesterId = req.query.requesterId ? parseInt(req.query.requesterId as string) : undefined;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(requesterId);
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN_DEPT_HEAD)) {
      return res.status(403).json({ error: "Only Coaches, Captains, or Department Heads can delete calendar events" });
    }
    await storage.deleteCalendarEvent(id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting calendar event:", error);
    res.status(500).json({ error: "Failed to delete calendar event" });
  }
});

router.patch("/calendar/:id/deleted-dates", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { requesterId, deletedDates } = req.body;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(parseInt(requesterId));
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN_DEPT_HEAD)) {
      return res.status(403).json({ error: "Only Coaches, Captains, or Department Heads can modify calendar events" });
    }
    if (!Array.isArray(deletedDates)) return res.status(400).json({ error: "deletedDates must be an array" });
    const event = await storage.patchCalendarEventDeletedDates(id, deletedDates);
    if (!event) return res.status(404).json({ error: "Calendar event not found" });
    res.json(event);
  } catch (error) {
    console.error("Error patching deleted dates:", error);
    res.status(500).json({ error: "Failed to patch deleted dates" });
  }
});

router.get("/calendar/tba-preview", async (req, res) => {
  try {
    if (!TBA_KEY) return res.status(503).json({ error: "TBA_API_KEY is not configured on this server" });
    const requesterId = req.query.requesterId ? parseInt(req.query.requesterId as string) : undefined;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(requesterId);
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN_DEPT_HEAD)) {
      return res.status(403).json({ error: "Only Coaches, Captains, or Department Heads can import events" });
    }
    const teamSettings = await storage.getTeamSettings();
    const year = new Date().getFullYear();
    const data = await tbaFetch(`/team/frc${teamSettings.teamNumber}/events/${year}`);
    const events = Array.isArray(data) ? data : [];
    const mapped = events.map((e: any) => ({
      key: e.key,
      name: e.name,
      startDate: e.start_date,
      endDate: e.end_date,
      location: [e.city, e.state_prov, e.country].filter(Boolean).join(', '),
    }));
    res.json(mapped);
  } catch (error) {
    console.error("Error fetching TBA preview:", error);
    res.status(500).json({ error: "Failed to fetch TBA events" });
  }
});

router.post("/calendar/tba-import", async (req, res) => {
  try {
    const { requesterId, events: eventsToImport } = req.body;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(parseInt(requesterId));
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN_DEPT_HEAD)) {
      return res.status(403).json({ error: "Only Coaches, Captains, or Department Heads can import events" });
    }
    if (!Array.isArray(eventsToImport)) return res.status(400).json({ error: "events must be an array" });
    const existing = await storage.getCalendarEvents();
    const created: any[] = [];
    let skipped = 0;
    for (const ev of eventsToImport) {
      const isDup = existing.some(e => e.title === ev.name && e.startDate === ev.startDate);
      if (isDup) { skipped++; continue; }
      const row = await storage.createCalendarEvent({
        title: ev.name,
        description: '',
        startDate: ev.startDate,
        endDate: ev.endDate || null,
        startTime: null,
        endTime: null,
        type: 'competition',
        location: ev.location || '',
        attending: true,
        signupEnabled: true,
        createdBy: parseInt(requesterId),
      });
      created.push(row);
    }
    res.json({ created: created.length, skipped });
  } catch (error) {
    console.error("Error importing TBA events:", error);
    res.status(500).json({ error: "Failed to import TBA events" });
  }
});

router.get("/calendar/toa-preview", async (req, res) => {
  try {
    if (!TOA_KEY) return res.status(503).json({ error: "TOA_API_KEY is not configured on this server" });
    const requesterId = req.query.requesterId ? parseInt(req.query.requesterId as string) : undefined;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(requesterId);
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN_DEPT_HEAD)) {
      return res.status(403).json({ error: "Only Coaches, Captains, or Department Heads can import events" });
    }
    const teamSettings = await storage.getTeamSettings();
    const season = req.query.season as string || (() => {
      const y = new Date().getFullYear();
      const m = new Date().getMonth();
      const start = m >= 8 ? y : y - 1;
      return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
    })();
    const teamNum = (teamSettings.teamNumber as number) || 10991;
    const data = await toaFetch(`/team/ftc${teamNum}/events/${season}`);
    const events = Array.isArray(data) ? data : [];
    const mapped = events.map((e: any) => ({
      key: e.event_key,
      name: e.event_name,
      startDate: e.start_date ? e.start_date.slice(0, 10) : null,
      endDate: e.end_date ? e.end_date.slice(0, 10) : null,
      location: [e.city, e.state_prov, e.country].filter(Boolean).join(', '),
    }));
    res.json(mapped);
  } catch (error) {
    console.error("Error fetching TOA preview:", error);
    res.status(500).json({ error: "Failed to fetch TOA events" });
  }
});

router.post("/calendar/toa-import", async (req, res) => {
  try {
    const { requesterId, events: eventsToImport } = req.body;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(parseInt(requesterId));
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN_DEPT_HEAD)) {
      return res.status(403).json({ error: "Only Coaches, Captains, or Department Heads can import events" });
    }
    if (!Array.isArray(eventsToImport)) return res.status(400).json({ error: "events must be an array" });
    const existing = await storage.getCalendarEvents();
    const created: any[] = [];
    let skipped = 0;
    for (const ev of eventsToImport) {
      if (!ev.startDate) { skipped++; continue; }
      const isDup = existing.some(e => e.title === ev.name && e.startDate === ev.startDate);
      if (isDup) { skipped++; continue; }
      const row = await storage.createCalendarEvent({
        title: ev.name,
        description: '',
        startDate: ev.startDate,
        endDate: ev.endDate || null,
        startTime: null,
        endTime: null,
        type: 'competition',
        location: ev.location || '',
        attending: true,
        signupEnabled: true,
        createdBy: parseInt(requesterId),
      });
      created.push(row);
    }
    res.json({ created: created.length, skipped });
  } catch (error) {
    console.error("Error importing TOA events:", error);
    res.status(500).json({ error: "Failed to import TOA events" });
  }
});

export default router;
