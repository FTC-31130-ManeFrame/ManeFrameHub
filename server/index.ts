import express from "express";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { storage } from "./storage";
import { pool } from "./db.js";
import { authenticate } from "./middleware/auth";
import { verifyOrigin } from "./middleware/csrf";
import { getTeamTimezone } from "./services/teamTime";
import { SESSION_SECRET } from "./security";

import usersRouter from "./routes/users";
import projectsRouter from "./routes/projects";
import tasksRouter from "./routes/tasks";
import notificationsRouter from "./routes/notifications";
import timeRouter from "./routes/time";
import scoutRouter from "./routes/scout";
import competitionRouter from "./routes/competition";
import alertsRouter from "./routes/alerts";
import certificationsRouter from "./routes/certifications";
import badgesRouter from "./routes/badges";
import calendarRouter from "./routes/calendar";
import calendarFeedRouter from "./routes/calendarFeed";
import resourcesRouter from "./routes/resources";
import settingsRouter from "./routes/settings";
import pushRouter from "./routes/push";
import recurringRouter from "./routes/recurring";
import eventSignupsRouter from "./routes/eventSignups";
import requirementsRouter from "./routes/requirements";
import productivityRouter from "./routes/productivity";
import seasonsRouter from "./routes/seasons";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Ensures the PostgreSQL schema exists before the server accepts traffic.
 * On a fresh remix the database has no tables at all — this detects that
 * (error code 42P01) and runs `drizzle-kit push` to create them, then seeds
 * the demo accounts so the login screen works immediately.
 */
async function initializeDatabase() {
  let needsPush = false;

  try {
    await pool.query("SELECT 1 FROM team_settings LIMIT 1");
    console.log("✅  Database schema verified.");
  } catch (err: any) {
    if (err.code === "42P01") {
      needsPush = true;
    } else {
      console.error("Database connection error:", err.message);
      process.exit(1);
    }
  }

  if (needsPush) {
    console.log("⏳  Fresh database detected — pushing schema …");
    const result = spawnSync(
      "npx",
      // --config is required: drizzle.config.ts deliberately lives in db/
      // rather than the repo root, so Replit's Publish step doesn't find a
      // Drizzle project and run its own destructive push. See db/drizzle.config.ts.
      ["drizzle-kit", "push", "--force", "--config=db/drizzle.config.ts"],
      { stdio: "inherit", shell: true }
    );
    if (result.status !== 0) {
      console.error("Schema push failed. Exiting.");
      process.exit(1);
    }
    console.log("✅  Schema push complete.");
  }

  // Auto-seed demo accounts if the users table is empty
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
    if (rows[0].n === 0) {
      console.log("🌱  Seeding demo accounts …");
      await storage.seedDatabase();
      console.log("✅  Demo accounts ready (password: changeme).");
    }
  } catch (e) {
    console.warn("Auto-seed skipped:", e);
  }
}

const app = express();
const isProduction = process.env.NODE_ENV === "production";

// Replit (and most PaaS) terminate TLS at a proxy; needed for secure cookies.
app.set("trust proxy", 1);

app.use(compression());
// Same-origin in production (server serves the client); allow the Vite dev
// origin with credentials in development only.
if (isProduction) {
  app.use(cors());
} else {
  app.use(cors({ origin: true, credentials: true }));
}
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

if (isProduction && !SESSION_SECRET) {
  console.error("FATAL: SESSION_SECRET is not set. Add it to your environment (Replit Secrets) before deploying.");
  process.exit(1);
}

// Dynamic manifest.json — always served before static files so it reflects current team settings
app.get("/manifest.json", async (req, res) => {
  try {
    const settings = await storage.getTeamSettings();
    const name = (settings.teamName as string) || 'ManeFrame Hub';
    const color = (settings.themeColor as string) || '#4169e1';
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      name,
      short_name: name,
      description: `${settings.teamProgram || 'FTC'} Team ${settings.teamNumber} Project Management & Scouting`,
      start_url: "/",
      display: "standalone",
      background_color: "#0f172a",
      theme_color: color,
      orientation: "any",
      icons: [
        { src: "/api/settings/pwa-icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        { src: "/api/settings/pwa-icon.svg", sizes: "any", type: "image/svg+xml" },
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
    });
  } catch {
    res.status(500).json({ error: "Failed to generate manifest" });
  }
});

if (isProduction) {
  app.use('/sw.js', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache');
    next();
  });
  app.use(express.static(path.join(__dirname, "../dist")));
}

// Ahead of authenticate so it also covers POST /login, which is itself CSRF-able.
app.use("/api", verifyOrigin);
// Gate every /api route behind a valid session (public allowlist inside).
app.use("/api", authenticate);

app.use("/api", usersRouter);
app.use("/api", projectsRouter);
app.use("/api", tasksRouter);
app.use("/api", notificationsRouter);
app.use("/api", timeRouter);
app.use("/api", scoutRouter);
app.use("/api", competitionRouter);
app.use("/api", alertsRouter);
app.use("/api", certificationsRouter);
app.use("/api", badgesRouter);
app.use("/api", calendarRouter);
app.use("/api", calendarFeedRouter);
app.use("/api", resourcesRouter);
app.use("/api", settingsRouter);
app.use("/api", pushRouter);
app.use("/api", recurringRouter);
app.use("/api", eventSignupsRouter);
app.use("/api", requirementsRouter);
app.use("/api", productivityRouter);
app.use("/api", seasonsRouter);

if (isProduction) {
  app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(__dirname, "../dist/index.html"));
  });
}

const PORT = isProduction ? 5000 : 3001;

// Initialize DB before accepting any traffic
initializeDatabase().then(() => {
  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on port ${PORT}`);
    try {
      // Must succeed before any claimMigration() call below can work — the
      // one-shot data migrations (competition unification, outreach hours
      // backfill, stuck check-in cleanup) all depend on this table existing.
      await storage.ensureSchemaMigrationsTable();
    } catch (e) {
      console.error("schema_migrations table creation failed — one-shot migrations below cannot run safely:", e);
    }
    try {
      await storage.migrateApiKeyColumns();
      await storage.ensureTeamTimezoneColumn();
      await storage.migrateCalendarTypes();
      await storage.ensurePushSubscriptionsTable();
      await storage.ensureRecurringTasksTable();
      await storage.ensureEventParticipationTables();
      await storage.ensureInviteOnlyEvents();
      await storage.ensureCompetitionUnification();
      await storage.ensureCalendarFeedTokens();
      await storage.ensureRequirementsAndFundraising();
      await storage.ensureArchiveColumns();
      await storage.ensureAttendanceColumns();
      await storage.ensureProjectLinksColumn();
      await storage.ensureTaskSegments();
      await storage.ensureCertificationLevelsAndBadges();
      await getTeamTimezone(); // warm the cache and surface any DB issue at boot
      // Generate any due recurring tasks now, then re-check hourly. The guarded
      // UPDATE inside makes this safe to run on every instance under autoscale.
      storage.generateDueRecurringTasks().catch((e) => console.warn("Recurring generation skipped:", e));
      setInterval(() => {
        storage.generateDueRecurringTasks().catch((e) => console.warn("Recurring generation error:", e));
      }, 60 * 60 * 1000);
    } catch (e) {
      console.warn("Boot migration chain failed:", e);
    }
    // Certifications v2 one-shots, in their own block so a failure here can't
    // abort the chain above. Order matters: the role rename must land before
    // scopes are seeded from it, and the columns must exist before badges are
    // backfilled against them. Each is claimMigration-guarded and runs once.
    try {
      await storage.migrateTrainerRoleRename();
      await storage.seedTrainerScopes();
      await storage.backfillLevelBadges();
    } catch (e) {
      console.warn("Certifications v2 migration skipped:", e);
    }
    try {
      await storage.ensureScoutingSeasonsTables();
    } catch (e) {
      console.warn("Scouting seasons migration skipped:", e);
    }
    try {
      await storage.backfillNexusEventKeys();
    } catch (e) {
      console.warn("Nexus key backfill skipped:", e);
    }
    try {
      await storage.backfillOutreachHours();
    } catch (e) {
      console.warn("Outreach hours backfill skipped:", e);
    }
    // Must run after the backfills above are confirmed gated, and before the
    // unique index below — the index would otherwise trip on the very rows
    // this cleanup is about to remove.
    try {
      await storage.cleanupStuckCompetitionEntries();
    } catch (e) {
      console.warn("Stuck competition check-in cleanup skipped:", e);
    }
    try {
      await storage.ensureCompetitionEntryUniqueIndex();
    } catch (e) {
      // Failure here means duplicate competition rows exist in the database —
      // possibly double-counted completed entries inflating someone's hours.
      // Needs investigation, not a silent skip.
      console.error("Competition unique index NOT created — duplicate rows likely exist:", e);
    }
    try {
      const allUsers = await storage.getUsers();
      if (allUsers.length > 0) {
        const coachOrCaptain = allUsers.find(u => (u.roles as string[]).some(r => ['Coach', 'Team Captain'].includes(r)));
        if (coachOrCaptain) {
          await storage.seedCalendarEvents(coachOrCaptain.id);
          await storage.seedResources(coachOrCaptain.id);
        }
      }
    } catch (e) {
      console.warn("Seed skipped:", e);
    }
  });
}).catch((err) => {
  console.error("Fatal: database initialization failed:", err);
  process.exit(1);
});
