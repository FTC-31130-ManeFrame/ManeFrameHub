import { Router, Request } from "express";
import { storage } from "../storage";
import {
  hashPassword,
  verifyPassword,
  sanitizeUser,
  signSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../security";
import { requireRoles } from "../middleware/auth";

const COACH_CAPTAIN = ["Coach", "Team Captain"];

const router = Router();

const guestLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const GUEST_RATE_LIMIT = 10;
const GUEST_RATE_WINDOW_MS = 15 * 60 * 1000;

// Reuse the same IP-based sliding window for password logins.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

// Use Express's resolved req.ip. With `trust proxy=1` (server/index.ts), this is
// the client address as seen by the single trusted proxy hop — unlike the raw
// X-Forwarded-For header, a client cannot spoof it to rotate the rate-limit key.
function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// NOTE: in-memory limiter — per-instance under Replit autoscale. Acceptable for
// brute-force slowdown; a shared store would be needed for hard guarantees.
function checkLoginRateLimit(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= LOGIN_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function checkGuestRateLimit(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = guestLoginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    guestLoginAttempts.set(ip, { count: 1, resetAt: now + GUEST_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= GUEST_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

router.get("/users", async (req, res) => {
  try {
    const users = await storage.getUsers();
    res.json(users.map(sanitizeUser));
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.post("/users", requireRoles(...COACH_CAPTAIN), async (req, res) => {
  try {
    const normalizedUsername = req.body.username?.toLowerCase().trim();
    if (!normalizedUsername) {
      return res.status(400).json({ error: "Username is required" });
    }
    const rawPassword = req.body.password;
    if (!rawPassword || String(rawPassword).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const existingUser = await storage.getUserByUsername(normalizedUsername);
    if (existingUser) {
      return res.status(400).json({ error: "Username already taken" });
    }
    const userData = {
      ...req.body,
      username: normalizedUsername,
      password: await hashPassword(String(rawPassword)),
    };
    const user = await storage.createUser(userData);
    res.status(201).json(sanitizeUser(user));
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.put("/users/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // A user may edit their own profile; editing anyone else (or changing
    // roles/password on any account) requires Coach/Team Captain.
    const isSelf = req.userId === id;
    const isPrivileged = (req.userRoles || []).some((r) => COACH_CAPTAIN.includes(r));
    if (!isSelf && !isPrivileged) {
      return res.status(403).json({ error: "You can only edit your own profile" });
    }
    const updateData = { ...req.body };
    // Only privileged users (Coach/Captain) may change roles, mute state,
    // archived state, or set a password directly. Self-service password changes
    // must go through POST /users/:id/change-password, which verifies the
    // current password; stripping it here also blocks an archived user from
    // reactivating their own account via this endpoint.
    if (!isPrivileged) {
      delete updateData.roles;
      delete updateData.muted;
      delete updateData.archived;
      delete updateData.password;
    }
    if (updateData.username) {
      updateData.username = updateData.username.toLowerCase().trim();
      const existingUser = await storage.getUserByUsername(updateData.username);
      if (existingUser && existingUser.id !== id) {
        return res.status(400).json({ error: "Username already taken" });
      }
    }
    // If a password is being set directly (e.g. admin reset), hash it. Require
    // a minimum length so resets can't set a trivially weak value.
    if (updateData.password !== undefined) {
      if (!updateData.password || String(updateData.password).length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      updateData.password = await hashPassword(String(updateData.password));
    }
    // Nothing left to change after authorization stripping — return current state.
    if (Object.keys(updateData).length === 0) {
      const current = await storage.getUser(id);
      if (!current) return res.status(404).json({ error: "User not found" });
      return res.json(sanitizeUser(current));
    }
    const user = await storage.updateUser(id, updateData);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(sanitizeUser(user));
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.patch("/users/:id/archive", requireRoles(...COACH_CAPTAIN), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.userId === id) return res.status(400).json({ error: "You cannot archive your own account" });
    const { archived } = req.body;
    const user = await storage.updateUser(id, { archived: !!archived });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(sanitizeUser(user));
  } catch (error) {
    console.error("Error archiving user:", error);
    res.status(500).json({ error: "Failed to archive user" });
  }
});

router.delete("/users/:id", requireRoles(...COACH_CAPTAIN), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteUser(id);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

router.post("/login", async (req, res) => {
  try {
    if (!checkLoginRateLimit(req)) {
      return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes and try again." });
    }
    const { username, password } = req.body;
    if (!username || !password) {
      console.info("[auth] login", { outcome: "missing_credentials", secure: req.secure });
      return res.status(400).json({ error: "Username and password are required" });
    }
    const normalizedUsername = String(username).toLowerCase().trim();
    const user = await storage.getUserByUsername(normalizedUsername);
    const { ok, needsRehash } = await verifyPassword(String(password), user?.password);
    if (user && ok) {
      if ((user as any).archived) {
        console.info("[auth] login", { outcome: "account_archived", secure: req.secure });
        return res.status(403).json({ error: "This account has been deactivated. Please contact your coach." });
      }
      // Lazy migration: upgrade legacy plaintext rows to a hash on first login.
      if (needsRehash) {
        try {
          await storage.updateUser(user.id, { password: await hashPassword(String(password)) });
        } catch (e) {
          console.warn("Password rehash on login failed:", e);
        }
      }
      const token = signSession({ kind: "member", userId: user.id, roles: (user.roles as string[]) || [] });
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
      console.info("[auth] login", { outcome: "success", secure: req.secure });
      res.json(sanitizeUser(user));
    } else {
      console.info("[auth] login", { outcome: "invalid_credentials", secure: req.secure });
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({ error: "Failed to log in" });
  }
});

router.post("/guest-login", async (req, res) => {
  if (!checkGuestRateLimit(req)) {
    return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes and try again." });
  }
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: "PIN is required" });
    const token = await storage.getGuestTokenByPin(String(pin).trim());
    if (!token) return res.status(404).json({ error: "Invalid or expired PIN" });
    const session = signSession({ kind: "guest", eventId: token.eventId });
    res.cookie(SESSION_COOKIE, session, sessionCookieOptions(req));
    res.json({ eventId: token.eventId, eventName: token.eventName, pin: token.pin, label: token.label });
  } catch (error) {
    console.error("Error with guest login:", error);
    res.status(500).json({ error: "Failed to process guest login" });
  }
});

// Return the currently authenticated user (used by the client on boot to
// restore a session from the cookie). Guests get a lightweight guest identity.
router.get("/me", async (req, res) => {
  try {
    const hasSessionCookie = Boolean(req.cookies?.[SESSION_COOKIE]);
    if (req.guestEventId !== undefined) {
      console.info("[auth] session", { outcome: "guest", hasSessionCookie, secure: req.secure });
      return res.json({ guest: true, eventId: req.guestEventId });
    }
    if (!req.userId) {
      console.info("[auth] session", { outcome: "missing_or_invalid", hasSessionCookie, secure: req.secure });
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await storage.getUser(req.userId);
    if (!user) {
      console.info("[auth] session", { outcome: "user_missing", hasSessionCookie, secure: req.secure });
      return res.status(401).json({ error: "Not authenticated" });
    }
    if ((user as any).archived) {
      console.info("[auth] session", { outcome: "account_archived", hasSessionCookie, secure: req.secure });
      return res.status(403).json({ error: "Account deactivated" });
    }
    console.info("[auth] session", { outcome: "success", hasSessionCookie, secure: req.secure });
    res.json(sanitizeUser(user));
  } catch (error) {
    console.error("Error fetching current user:", error);
    res.status(500).json({ error: "Failed to fetch current user" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(req), maxAge: undefined });
  res.json({ ok: true });
});

router.post("/users/:id/change-password", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (req.userId !== id) {
      return res.status(403).json({ error: "You can only change your own password" });
    }
    const { currentPassword, newPassword } = req.body;
    const user = await storage.getUser(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const { ok } = await verifyPassword(String(currentPassword ?? ""), user.password);
    if (!ok) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    await storage.updateUser(id, { password: await hashPassword(String(newPassword)) });
    res.json({ success: true });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
});

export default router;
