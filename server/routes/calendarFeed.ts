import { Router } from "express";
import { storage } from "../storage";
import { getUserRoles } from "../helpers";
import { filterVisibleEvents } from "../services/eventVisibility";
import { buildCalendarFeed } from "../services/icsFeed";
import { getTeamTimezone } from "../services/teamTime";

const router = Router();

function feedUrls(req: any, token: string) {
  const host = req.get("host");
  const httpsUrl = `${req.protocol}://${host}/api/calendar/feed/${token}.ics`;
  const webcalUrl = `webcal://${host}/api/calendar/feed/${token}.ics`;
  return { token, url: httpsUrl, webcalUrl };
}

// Authenticated — returns (creating on first use) the caller's personal feed token.
router.get("/calendar/feed-token", async (req, res) => {
  try {
    const token = await storage.getOrCreateCalendarFeedToken(req.userId!);
    res.json(feedUrls(req, token));
  } catch (error) {
    console.error("Error fetching calendar feed token:", error);
    res.status(500).json({ error: "Failed to fetch feed token" });
  }
});

// Authenticated — invalidates the old URL and issues a new one.
router.post("/calendar/feed-token/regenerate", async (req, res) => {
  try {
    const token = await storage.regenerateCalendarFeedToken(req.userId!);
    res.json(feedUrls(req, token));
  } catch (error) {
    console.error("Error regenerating calendar feed token:", error);
    res.status(500).json({ error: "Failed to regenerate feed token" });
  }
});

// PUBLIC — no session cookie available to an external calendar app polling
// this URL. Added to the PUBLIC allow-list in server/middleware/auth.ts.
// The token itself is the only credential; visibility is enforced exactly
// like the in-app calendar (filterVisibleEvents), so an invite-only event
// only appears in feeds belonging to someone who could already see it.
router.get("/calendar/feed/:tokenWithExt", async (req, res) => {
  try {
    const token = req.params.tokenWithExt.replace(/\.ics$/i, "");
    const userId = await storage.getUserIdByFeedToken(token);
    if (!userId) return res.status(404).send("Not found");

    const roles = await getUserRoles(userId);
    const events = await storage.getCalendarEvents(false);
    const visible = await filterVisibleEvents(events, userId, roles);

    const [settings, teamTimezone] = await Promise.all([storage.getTeamSettings(), getTeamTimezone()]);
    const teamName = (settings.teamName as string) || "ManeFrame Hub";

    const ics = buildCalendarFeed(visible as any, teamName, teamTimezone);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${teamName.replace(/[^a-z0-9]+/gi, "-")}-calendar.ics"`);
    res.setHeader("Cache-Control", "no-cache");
    res.send(ics);
  } catch (error) {
    console.error("Error generating calendar feed:", error);
    res.status(500).send("Failed to generate calendar feed");
  }
});

export default router;
