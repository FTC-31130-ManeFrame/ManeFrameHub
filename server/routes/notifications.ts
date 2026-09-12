import { Router } from "express";
import { storage } from "../storage";
import { sendPushToUsers } from "../push";

const router = Router();

router.get("/notifications", async (req, res) => {
  try {
    const notifications = await storage.getNotifications();
    res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.post("/notifications", async (req, res) => {
  try {
    const notification = await storage.createNotification(req.body);
    res.status(201).json(notification);
    // Fire a device push to the recipient (best-effort, after responding).
    if (notification.toUserId) {
      const sender = notification.fromUserId ? await storage.getUser(notification.fromUserId).catch(() => null) : null;
      // The message body describes the event (mention, assignment, …); keep the
      // title to who triggered it so it reads correctly for every notification type.
      sendPushToUsers([notification.toUserId], {
        title: sender?.name ? `${sender.name} • ManeFrame Hub` : "ManeFrame Hub",
        body: notification.message || "You have a new notification",
        url: "/",
        tag: `notification-${notification.id}`,
      });
    }
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ error: "Failed to create notification" });
  }
});

router.put("/notifications/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const notification = await storage.updateNotification(id, req.body);
    if (!notification) return res.status(404).json({ error: "Notification not found" });
    res.json(notification);
  } catch (error) {
    console.error("Error updating notification:", error);
    res.status(500).json({ error: "Failed to update notification" });
  }
});

router.delete("/notifications/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteNotification(id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

router.get("/announcements", async (req, res) => {
  try {
    const announcements = await storage.getAnnouncements();
    res.json(announcements);
  } catch (error) {
    console.error("Error fetching announcements:", error);
    res.status(500).json({ error: "Failed to fetch announcements" });
  }
});

router.post("/announcements", async (req, res) => {
  try {
    const authorId = parseInt(req.body.authorId);
    if (!isNaN(authorId)) {
      const author = await storage.getUser(authorId);
      if (author?.muted) {
        return res.status(403).json({ error: "User is muted and cannot post announcements" });
      }
    }
    const announcement = await storage.createAnnouncement(req.body);
    res.status(201).json(announcement);
  } catch (error) {
    console.error("Error creating announcement:", error);
    res.status(500).json({ error: "Failed to create announcement" });
  }
});

router.put("/announcements/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const announcement = await storage.updateAnnouncement(id, req.body);
    if (!announcement) return res.status(404).json({ error: "Announcement not found" });
    res.json(announcement);
  } catch (error) {
    console.error("Error updating announcement:", error);
    res.status(500).json({ error: "Failed to update announcement" });
  }
});

router.delete("/announcements/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteAnnouncement(id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting announcement:", error);
    res.status(500).json({ error: "Failed to delete announcement" });
  }
});

export default router;
