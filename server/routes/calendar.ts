import { Router } from "express";
import { storage } from "../storage";
import { getUserRoles, hasAnyRole, COACH_CAPTAIN_DEPT_HEAD, LEADERSHIP_ALL } from "../helpers";
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

// Competition import lives at POST /api/first/events/:code/import
// (server/routes/scout.ts) — one import creates the calendar event, the
// linked scout event and the team list together.

export default router;
