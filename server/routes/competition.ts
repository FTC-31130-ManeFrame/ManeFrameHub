import { Router } from "express";
import { storage } from "../storage";
import { requireRoles } from "../middleware/auth";
import { COACH_CAPTAIN, getUserRoles, hasAnyRole } from "../helpers";

const router = Router();

// Competition attendance is stored on the shared clock (time_entries, kind =
// "competition", scoutEventId set) — see storage.ensureCompetitionUnification
// for why. These routes translate between that internal shape and the
// competition-specific vocabulary the client already speaks, so the URLs and
// response shape below are the external API contract and stay stable even
// though the storage underneath changed.
//
// Internal time_entries.status -> external competition status:
//   checked_in        -> checked_in
//   pending_check_out  -> pending_approval
//   completed          -> approved
//   rejected           -> rejected
const toExternalStatus = (status: string): string => {
  if (status === "pending_check_out") return "pending_approval";
  if (status === "completed") return "approved";
  return status;
};

// checkOutConfirmedBy/At double as "who approved/rejected this, and when" for
// competition rows — the shop clock's "coach confirmed the checkout" concept
// maps directly onto "coach approved/rejected the competition attendance".
function toApi(e: any) {
  return {
    id: e.id,
    userId: e.userId,
    eventId: e.scoutEventId,
    checkInAt: e.checkInAt,
    checkOutAt: e.checkOutAt,
    status: toExternalStatus(e.status),
    approvedBy: e.checkOutConfirmedBy ?? null,
    approvedAt: e.checkOutConfirmedAt ?? null,
    roundedMinutes: e.roundedMinutes,
    notes: e.notes,
    createdAt: e.createdAt,
  };
}

router.get("/competition-checkins", async (req, res) => {
  try {
    const { eventId, userId } = req.query;
    let entries: any[];
    if (eventId) {
      entries = await storage.getTimeEntriesByScoutEvent(parseInt(eventId as string));
    } else if (userId) {
      entries = await storage.getTimeEntriesByUserAndKind(parseInt(userId as string), "competition");
    } else {
      return res.status(400).json({ error: "eventId or userId query param required" });
    }
    const allUsers = await storage.getUsers();
    const userMap = new Map(allUsers.map((u: any) => [u.id, u.name || u.username]));
    const enriched = entries.map((e) => {
      const api = toApi(e);
      return {
        ...api,
        userName: userMap.get(e.userId) || `User ${e.userId}`,
        approvedByName: api.approvedBy ? (userMap.get(api.approvedBy) || `User ${api.approvedBy}`) : null,
      };
    });
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching competition checkins:", error);
    res.status(500).json({ error: "Failed to fetch competition checkins" });
  }
});

// Competition attendance now runs through the competition's calendar event
// (sign-up, roster check-in, self clock-in), which the FIRST import links to
// each scouting event. Two independent check-ins for one competition let a
// student be clocked in twice and counted twice in the hours ledger, so new
// sessions are refused here. Check-out, approve and reject stay so any
// session opened before this change can still be closed.
const MOVED_TO_CALENDAR =
  "Competition attendance has moved to the competition's calendar event. Clock in from Time, or ask a coach to check you in from the event roster.";

router.post("/competition-checkins/check-in", (_req, res) => {
  res.status(410).json({ error: MOVED_TO_CALENDAR });
});

router.post("/competition-checkins/:id/check-out", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const prev = await storage.getTimeEntry(id);
    if (!prev) return res.status(404).json({ error: "Checkin not found" });
    const checkOutAt = new Date();
    const updated = await storage.updateTimeEntry(id, { checkOutAt, status: "pending_check_out" } as any);
    await storage.createTimeEntryAudit({
      entryId: id,
      actorId: prev.userId,
      actionType: "check_out",
      previousValues: { status: prev.status },
      newValues: { status: "pending_check_out", checkOutAt },
    });
    res.json(toApi(updated!));
  } catch (error) {
    console.error("Error checking out from competition:", error);
    res.status(500).json({ error: "Failed to check out" });
  }
});

router.post("/competition-checkins/:id/approve", requireRoles(...COACH_CAPTAIN), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { roundedMinutes } = req.body;
    const coachId = req.userId!;
    const prev = await storage.getTimeEntry(id);
    if (!prev) return res.status(404).json({ error: "Checkin not found" });
    const updated = await storage.updateTimeEntry(id, {
      status: "completed",
      roundedMinutes: roundedMinutes != null ? parseInt(roundedMinutes) : (prev.roundedMinutes ?? undefined),
      checkOutConfirmedBy: coachId,
      checkOutConfirmedAt: new Date(),
    } as any);
    await storage.createTimeEntryAudit({
      entryId: id,
      actorId: coachId,
      actionType: "approve",
      previousValues: { status: prev.status, roundedMinutes: prev.roundedMinutes },
      newValues: { status: "completed", roundedMinutes: updated!.roundedMinutes, approvedBy: coachId },
    });
    res.json(toApi(updated!));
  } catch (error) {
    console.error("Error approving competition checkin:", error);
    res.status(500).json({ error: "Failed to approve checkin" });
  }
});

router.post("/competition-checkins/:id/reject", requireRoles(...COACH_CAPTAIN), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const coachId = req.userId!;
    const prev = await storage.getTimeEntry(id);
    if (!prev) return res.status(404).json({ error: "Checkin not found" });
    const updated = await storage.updateTimeEntry(id, {
      status: "rejected",
      checkOutConfirmedBy: coachId,
      checkOutConfirmedAt: new Date(),
    } as any);
    await storage.createTimeEntryAudit({
      entryId: id,
      actorId: coachId,
      actionType: "reject",
      previousValues: { status: prev.status },
      newValues: { status: "rejected" },
    });
    res.json(toApi(updated!));
  } catch (error) {
    console.error("Error rejecting competition checkin:", error);
    res.status(500).json({ error: "Failed to reject checkin" });
  }
});

router.post("/competition-checkins/manual-add", requireRoles(...COACH_CAPTAIN), (_req, res) => {
  res.status(410).json({ error: MOVED_TO_CALENDAR });
});

router.get("/competition-checkins/:id/audit", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const logs = await storage.getTimeEntryAudit(id);
    const allUsers = await storage.getUsers();
    const userMap = new Map(allUsers.map((u: any) => [u.id, u.name || u.username]));
    const enriched = logs.map((l) => ({ ...l, actorName: userMap.get(l.actorId) || `User ${l.actorId}` }));
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching competition checkin audit:", error);
    res.status(500).json({ error: "Failed to fetch audit" });
  }
});

router.put("/competition-checkins/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { actorId, ...data } = req.body;
    if (!actorId) return res.status(400).json({ error: "actorId is required" });
    const actorRoles = await getUserRoles(parseInt(actorId));
    const existing = await storage.getTimeEntry(id);
    if (!existing) return res.status(404).json({ error: "Checkin not found" });
    const isCoachOrCaptain = hasAnyRole(actorRoles, COACH_CAPTAIN);
    const ownsRecord = existing.userId === parseInt(actorId);
    if (!isCoachOrCaptain && !ownsRecord) {
      return res.status(403).json({ error: "Not authorized to update this checkin" });
    }
    // Only `notes` is editable through this route — every real state
    // transition (check-out, approve, reject, correct hours) has its own
    // dedicated, role-guarded endpoint below. Forwarding the body unfiltered
    // used to let a record's owner (a plain student, via ownsRecord above)
    // rewrite status/roundedMinutes/checkInAt directly, which both
    // self-awards hours into the ledger and — via checkInAt — is what caused
    // duplicate rows on every republish (see ensureCompetitionUnification).
    const patch: Record<string, unknown> = {};
    if (typeof data.notes === "string") patch.notes = data.notes;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Nothing to update — only `notes` is editable here" });
    }
    const updated = await storage.updateTimeEntry(id, patch as any);
    await storage.createTimeEntryAudit({
      entryId: id,
      actorId: parseInt(actorId),
      actionType: "update",
      previousValues: { status: existing.status, notes: existing.notes },
      newValues: patch,
    });
    res.json(toApi(updated!));
  } catch (error) {
    console.error("Error updating competition checkin:", error);
    res.status(500).json({ error: "Failed to update checkin" });
  }
});

router.delete("/competition-checkins/:id", requireRoles(...COACH_CAPTAIN), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await storage.getTimeEntry(id);
    await storage.createTimeEntryAudit({
      entryId: id,
      actorId: req.userId!,
      actionType: "delete",
      previousValues: existing ? { status: existing.status, userId: existing.userId, roundedMinutes: existing.roundedMinutes } : undefined,
    });
    await storage.deleteTimeEntry(id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting competition checkin:", error);
    res.status(500).json({ error: "Failed to delete checkin" });
  }
});

export default router;
