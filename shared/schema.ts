import { pgTable, serial, text, integer, boolean, timestamp, jsonb, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import type { TemplateField } from "./scoutingTemplates";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  roles: jsonb("roles").$type<string[]>().notNull().default([]),
  departments: jsonb("departments").$type<string[]>().notNull().default([]),
  muted: boolean("muted").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  // Per-student requirement overrides (Epic C). null = use team defaults.
  fundraisingGoalCents: integer("fundraising_goal_cents"),
  hourRequirementOverrides: jsonb("hour_requirement_overrides").$type<Record<string, number>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  archived: boolean("archived").notNull().default(false),
  department: text("department"),
  scrumMasters: jsonb("scrum_masters").$type<number[]>().notNull().default([]),
  showInWarRoom: boolean("show_in_war_room").notNull().default(true),
  allowAllTaskCreation: boolean("allow_all_task_creation").notNull().default(false),
  links: jsonb("links").$type<{id: string; label: string; url: string; type: string}[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("Not Started"),
  priority: text("priority").notNull().default("Medium"),
  effort: integer("effort"),
  departments: jsonb("departments").$type<string[]>().notNull().default([]),
  assignees: jsonb("assignees").$type<number[]>().notNull().default([]),
  contributors: jsonb("contributors").$type<number[]>().notNull().default([]),
  successCriteria: jsonb("success_criteria").$type<{id: string; text: string; completed: boolean}[]>().notNull().default([]),
  attachments: jsonb("attachments").$type<{id: string; label: string; url: string; type: string}[]>().notNull().default([]),
  comments: jsonb("comments").$type<{id: string; userId: number; text: string; timestamp: number}[]>().notNull().default([]),
  history: jsonb("history").$type<{id: string; userId: number; action: string; timestamp: number}[]>().notNull().default([]),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  dependencies: jsonb("dependencies").$type<number[]>().notNull().default([]),
  helpRequested: boolean("help_requested").notNull().default(false),
  deptOnly: boolean("dept_only").notNull().default(false),
  blockedReason: text("blocked_reason"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  requiredCertificationId: integer("required_certification_id").references(() => certifications.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  toUserId: integer("to_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromUserId: integer("from_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  timestamp: timestamp("timestamp", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  authorId: integer("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  scope: text("scope").notNull().default("Global"),
  targetDepartment: text("target_department"),
  comments: jsonb("comments").$type<{id: string; userId: number; text: string; timestamp: number}[]>().notNull().default([]),
  timestamp: timestamp("timestamp", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  sentNotifications: many(notifications, { relationName: "sentNotifications" }),
  receivedNotifications: many(notifications, { relationName: "receivedNotifications" }),
  announcements: many(announcements),
}));

export const projectsRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  toUser: one(users, { fields: [notifications.toUserId], references: [users.id], relationName: "receivedNotifications" }),
  fromUser: one(users, { fields: [notifications.fromUserId], references: [users.id], relationName: "sentNotifications" }),
  task: one(tasks, { fields: [notifications.taskId], references: [tasks.id] }),
}));

export const announcementsRelations = relations(announcements, ({ one }) => ({
  author: one(users, { fields: [announcements.authorId], references: [users.id] }),
}));

export const generalTasks = pgTable("general_tasks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const timeEntries = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull(),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  checkInConfirmedBy: integer("check_in_confirmed_by").references(() => users.id),
  checkInConfirmedAt: timestamp("check_in_confirmed_at", { withTimezone: true }),
  checkOutConfirmedBy: integer("check_out_confirmed_by").references(() => users.id),
  checkOutConfirmedAt: timestamp("check_out_confirmed_at", { withTimezone: true }),
  status: text("status").notNull().default("pending_check_in"),
  roundedMinutes: integer("rounded_minutes"),
  notes: text("notes"),
  workingOnTaskId: integer("working_on_task_id").references(() => tasks.id, { onDelete: "set null" }),
  workingOnGeneralTaskId: integer("working_on_general_task_id").references(() => generalTasks.id, { onDelete: "set null" }),
  taskHandoffNote: text("task_handoff_note"),
  // Category of worked time — any HOUR_CATEGORIES value (see shared/hourCategories),
  // "shop" by default. Non-shop entries link to the calendar event they were
  // clocked against.
  kind: text("kind").notNull().default("shop"),
  calendarEventId: integer("calendar_event_id").references(() => calendarEvents.id, { onDelete: "set null" }),
  // Competition time ("kind" = "competition") is clocked against a scouting
  // competition (scout_events), not a calendar event — the two are separate
  // entities. Exactly one of calendarEventId/scoutEventId is set, or neither
  // for plain shop time. See server/routes/competition.ts.
  scoutEventId: integer("scout_event_id").references(() => scoutEvents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  // Prevents a repeat of the competition-checkin resurrection bug — see
  // storage.ensureCompetitionEntryUniqueIndex, which creates the same index
  // by this same name. Declared here too so `schema:push` never proposes
  // dropping it.
  competitionUnique: uniqueIndex("time_entries_competition_unique_idx")
    .on(t.userId, t.scoutEventId, t.checkInAt)
    .where(sql`${t.scoutEventId} IS NOT NULL`),
}));

// One row per stretch of a clocked session spent on a single task. A member
// picks a task at check-in and may switch during the session (Time page ->
// "Switch task"); leadership may reassign them. Each switch closes the open
// segment and opens a new one, so per-task minutes survive the switch instead
// of being overwritten on `time_entries.working_on_task_id` (which still holds
// the CURRENT task and is what the live "Who's Here" board reads).
export const timeEntryTaskSegments = pgTable("time_entry_task_segments", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull().references(() => timeEntries.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Exactly one of these is set — a board task or an always-available general task.
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  generalTaskId: integer("general_task_id").references(() => generalTasks.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  // null while the segment is still open (member is on this task right now).
  endedAt: timestamp("ended_at", { withTimezone: true }),
  // Wall-clock minutes, stamped when the segment closes. Deliberately NOT
  // rounded to the quarter hour: these are for attribution ("where did the
  // session go"), never for the hours ledger, which stays entry-level.
  minutes: integer("minutes"),
  // Who put the member on this task — themselves, or a coach/captain.
  assignedBy: integer("assigned_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const timeEntryAudit = pgTable("time_entry_audit", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull().references(() => timeEntries.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actionType: text("action_type").notNull(),
  previousValues: jsonb("previous_values").$type<Record<string, any>>(),
  newValues: jsonb("new_values").$type<Record<string, any>>(),
  deltaMinutes: integer("delta_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// One-shot applied-migrations ledger (see storage.ensureSchemaMigrationsTable /
// claimMigration). Declared here purely so drizzle-kit recognizes it as
// intentional — without this, `schema:push` sees a table it doesn't know
// about and proposes dropping it (exactly the class of problem this file's
// calendarFeedTokens/etc. already had; see db/drizzle.config.ts). Nothing in
// the app queries this table through Drizzle — storage.ts talks to it via
// raw SQL — so no relations, no $inferSelect/$inferInsert exports needed.
export const schemaMigrations = pgTable("schema_migrations", {
  key: text("key").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const timeEntriesRelations = relations(timeEntries, ({ one, many }) => ({
  user: one(users, { fields: [timeEntries.userId], references: [users.id] }),
  checkInConfirmer: one(users, { fields: [timeEntries.checkInConfirmedBy], references: [users.id] }),
  checkOutConfirmer: one(users, { fields: [timeEntries.checkOutConfirmedBy], references: [users.id] }),
  auditLogs: many(timeEntryAudit),
}));

export const timeEntryAuditRelations = relations(timeEntryAudit, ({ one }) => ({
  entry: one(timeEntries, { fields: [timeEntryAudit.entryId], references: [timeEntries.id] }),
  actor: one(users, { fields: [timeEntryAudit.actorId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
export type Announcement = typeof announcements.$inferSelect;
export type InsertAnnouncement = typeof announcements.$inferInsert;

// A season owns the pit + match scouting templates and groups events/data by
// year/game. Exactly one season is active at a time (app-enforced).
export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  gameName: text("game_name").notNull().default(""),
  year: integer("year"),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// One editable template per (season, kind). Fields are append-only with an
// `archived` soft-delete; `revision` bumps on each save (cache-busting).
export const scoutingTemplates = pgTable("scouting_templates", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'pit' | 'match'
  name: text("name").notNull().default(""),
  fields: jsonb("fields").$type<TemplateField[]>().notNull().default([]),
  revision: integer("revision").notNull().default(1),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  seasonKindUnique: uniqueIndex("scouting_templates_season_kind_unique").on(t.seasonId, t.kind),
}));

export const scoutEvents = pgTable("scout_events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull().default(""),
  startDate: text("start_date"),
  endDate: text("end_date"),
  seasonId: integer("season_id").references(() => seasons.id),
  toaEventKey: text("toa_event_key"),
  tbaEventKey: text("tba_event_key"),
  nexusEventKey: text("nexus_event_key"),
  nexusPitMapKey: text("nexus_pit_map_key"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const pitScouts = pgTable("pit_scouts", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => scoutEvents.id, { onDelete: "cascade" }),
  teamNumber: integer("team_number").notNull(),
  teamName: text("team_name").notNull().default(""),
  robotName: text("robot_name").notNull().default(""),
  drivetrain: text("drivetrain").notNull().default(""),
  weight: integer("weight"),
  speed: integer("speed"),
  height: integer("height"),
  fuelCapacity: integer("fuel_capacity").notNull().default(0),
  traversalAbility: text("traversal_ability").notNull().default(""),
  shooterType: text("shooter_type").notNull().default(""),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  deficiencies: jsonb("deficiencies").$type<string[]>().notNull().default([]),
  autonomousRoutine: text("autonomous_routine").notNull().default(""),
  autoOptions: jsonb("auto_options").$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  photoUrl: text("photo_url"),
  offenseRating: integer("offense_rating").notNull().default(5),
  defenseRating: integer("defense_rating").notNull().default(5),
  overallRating: integer("overall_rating").notNull().default(5),
  coreValuesRating: integer("core_values_rating").notNull().default(3),
  templateId: integer("template_id").references(() => scoutingTemplates.id),
  data: jsonb("data").$type<Record<string, any>>().notNull().default({}),
  scoutedBy: integer("scouted_by").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const matchScouts = pgTable("match_scouts", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => scoutEvents.id, { onDelete: "cascade" }),
  matchNumber: integer("match_number").notNull(),
  matchType: text("match_type").notNull().default("qualification"),
  teamNumber: integer("team_number").notNull(),
  alliance: text("alliance").notNull().default("Red"),
  autoScore: integer("auto_score").notNull().default(0),
  teleopScore: integer("teleop_score").notNull().default(0),
  endgameScore: integer("endgame_score").notNull().default(0),
  penalties: integer("penalties").notNull().default(0),
  autoClimb: boolean("auto_climb").notNull().default(false),
  endClimbLevel: integer("end_climb_level").notNull().default(0),
  coralScored: integer("coral_scored").notNull().default(0),
  algaeScored: integer("algae_scored").notNull().default(0),
  autoFuelTotal: integer("auto_fuel_total").notNull().default(0),
  teleopFuelTotal: integer("teleop_fuel_total").notNull().default(0),
  humanPlayerScore: integer("human_player_score").notNull().default(0),
  defenseRating: integer("defense_rating").notNull().default(3),
  drivingSkillRating: integer("driving_skill_rating").notNull().default(3),
  coreValuesRating: integer("core_values_rating").notNull().default(3),
  autoUsed: text("auto_used").notNull().default(""),
  notes: text("notes").notNull().default(""),
  templateId: integer("template_id").references(() => scoutingTemplates.id),
  data: jsonb("data").$type<Record<string, any>>().notNull().default({}),
  scoutedBy: integer("scouted_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type Season = typeof seasons.$inferSelect;
export type InsertSeason = typeof seasons.$inferInsert;
export type ScoutingTemplate = typeof scoutingTemplates.$inferSelect;
export type InsertScoutingTemplate = typeof scoutingTemplates.$inferInsert;

export type GeneralTask = typeof generalTasks.$inferSelect;
export type InsertGeneralTask = typeof generalTasks.$inferInsert;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = typeof timeEntries.$inferInsert;
export type TimeEntryAudit = typeof timeEntryAudit.$inferSelect;
export type InsertTimeEntryAudit = typeof timeEntryAudit.$inferInsert;
export type TimeEntryTaskSegment = typeof timeEntryTaskSegments.$inferSelect;
export type InsertTimeEntryTaskSegment = typeof timeEntryTaskSegments.$inferInsert;
export type ScoutEvent = typeof scoutEvents.$inferSelect;
export type InsertScoutEvent = typeof scoutEvents.$inferInsert;
export type PitScout = typeof pitScouts.$inferSelect;
export type InsertPitScout = typeof pitScouts.$inferInsert;
export type MatchScout = typeof matchScouts.$inferSelect;
export type InsertMatchScout = typeof matchScouts.$inferInsert;

export const competitionAssignments = pgTable("competition_assignments", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => scoutEvents.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromMatch: integer("from_match").notNull(),
  toMatch: integer("to_match").notNull(),
  role: text("role").notNull().default("Scout - Stands"),
  notes: text("notes"),
  autoAssignScouting: boolean("auto_assign_scouting").notNull().default(false),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const eventInfo = pgTable("event_info", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().unique().references(() => scoutEvents.id, { onDelete: "cascade" }),
  venueInfo: text("venue_info"),
  wifiNetwork: text("wifi_network"),
  wifiPassword: text("wifi_password"),
  parkingInfo: text("parking_info"),
  schedule: text("schedule"),
  resources: text("resources"),
  notes: text("notes"),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const competitionCheckinAudit = pgTable("competition_checkin_audit", {
  id: serial("id").primaryKey(),
  checkinId: integer("checkin_id").notNull(),
  actorId: integer("actor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actionType: text("action_type").notNull(),
  previousValues: jsonb("previous_values").$type<Record<string, any>>(),
  newValues: jsonb("new_values").$type<Record<string, any>>(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const competitionCheckins = pgTable("competition_checkins", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventId: integer("event_id").notNull().references(() => scoutEvents.id, { onDelete: "cascade" }),
  checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull(),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  status: text("status").notNull().default("checked_in"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  roundedMinutes: integer("rounded_minutes"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const fullscreenAlerts = pgTable("fullscreen_alerts", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => scoutEvents.id, { onDelete: "set null" }),
  type: text("type").notNull().default("general"),
  message: text("message").notNull(),
  targetAll: boolean("target_all").notNull().default(true),
  targetPitDisplay: boolean("target_pit_display").notNull().default(false),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
});

export type CompetitionAssignment = typeof competitionAssignments.$inferSelect;
export type InsertCompetitionAssignment = typeof competitionAssignments.$inferInsert;
export type EventInfo = typeof eventInfo.$inferSelect;
export type InsertEventInfo = typeof eventInfo.$inferInsert;
export type CompetitionCheckin = typeof competitionCheckins.$inferSelect;
export type InsertCompetitionCheckin = typeof competitionCheckins.$inferInsert;
export type CompetitionCheckinAudit = typeof competitionCheckinAudit.$inferSelect;
export type InsertCompetitionCheckinAudit = typeof competitionCheckinAudit.$inferInsert;
export type FullscreenAlert = typeof fullscreenAlerts.$inferSelect;
export type InsertFullscreenAlert = typeof fullscreenAlerts.$inferInsert;

export const teamClaims = pgTable("team_claims", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => scoutEvents.id, { onDelete: "cascade" }),
  matchKey: text("match_key").notNull(),
  teamNumber: integer("team_number").notNull(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userName: text("user_name").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  uniqSlot: uniqueIndex("team_claims_slot_idx").on(t.eventId, t.matchKey, t.teamNumber),
}));

export type TeamClaim = typeof teamClaims.$inferSelect;
export type InsertTeamClaim = typeof teamClaims.$inferInsert;

// The TS symbol is `certifications` — the feature covers all certifications,
// not just safety ones — but THE PHYSICAL TABLE NAME STAYS `safety_certifications`
// on purpose. Replit's Publish step has historically run its own `drizzle-kit
// push` against the production database (see db/drizzle.config.ts and
// replit.md), and a table rename is exactly the diff that push turns into
// DROP + CREATE: silent loss of every granted certification. The physical name
// is invisible to users; the risk isn't worth the tidiness.
export const certifications = pgTable("safety_certifications", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  equipment: text("equipment").notNull().default(""),
  description: text("description").notNull().default(""),
  safetyGuide: text("safety_guide").notNull().default(""),
  // Declared as string[] because that is what has always actually been written
  // here — the previous `{id,text}[]` type never matched a single row.
  checklistItems: jsonb("checklist_items").$type<string[]>().notNull().default([]),
  // null = the "General" category. A free-text department name with no FK, so
  // it must be remapped by `updateTeamSettingsWithDepartmentChanges` when a
  // department is renamed or removed — removal degrades the cert to General,
  // which fails safe (it stays visible, just ungrouped) rather than orphaning.
  department: text("department"),
  level: integer("level").notNull().default(1), // 1..MAX_LEVEL, see shared/certifications.ts
  // Same jsonb shape as projects.links / tasks.attachments, so the existing
  // components/ProjectLinks.tsx helpers render these unchanged.
  links: jsonb("links").$type<{ id: string; label: string; url: string; type: string }[]>().notNull().default([]),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const userCertifications = pgTable("user_certifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  certificationId: integer("certification_id").notNull().references(() => certifications.id, { onDelete: "cascade" }),
  grantedBy: integer("granted_by").notNull().references(() => users.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  uniqUserCert: uniqueIndex("user_certifications_user_cert_idx").on(t.userId, t.certificationId),
}));

export const certificationRequests = pgTable("certification_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  certificationId: integer("certification_id").notNull().references(() => certifications.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  trainerId: integer("trainer_id").references(() => users.id),
  // Mirrors checklistItems positionally; `item` is the checklist text. Matches
  // what the trainer UI has always written (the old `{id,completed}[]` did not).
  checklistProgress: jsonb("checklist_progress").$type<{ item: string; completed: boolean }[]>().notNull().default([]),
  notes: text("notes"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  uniqActiveRequest: uniqueIndex("cert_requests_active_uniq_idx")
    .on(t.userId, t.certificationId)
    .where(sql`status IN ('pending', 'in_progress')`),
}));

export type Certification = typeof certifications.$inferSelect;
export type InsertCertification = typeof certifications.$inferInsert;
export type UserCertification = typeof userCertifications.$inferSelect;
export type InsertUserCertification = typeof userCertifications.$inferInsert;
export type CertificationRequest = typeof certificationRequests.$inferSelect;
export type InsertCertificationRequest = typeof certificationRequests.$inferInsert;

// Who may train what. This REPLACES the old implicit rule ("holds the cert and
// carries the Safety Trainer role") with an explicit grant: a trainer scoped to
// Manufacturing with maxLevel 1 may claim and sign off Manufacturing Lvl 1
// requests, and nothing else. Coaches and Captains bypass scopes entirely.
export const trainerScopes = pgTable("trainer_scopes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  department: text("department"), // null = the General category
  maxLevel: integer("max_level").notNull().default(1), // trains levels 1..maxLevel
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});
// Uniqueness is (user_id, coalesce(department, '')) — a plain unique index over
// a nullable column would let duplicate General rows through, since Postgres
// treats NULLs as distinct. Declared as a raw expression index in
// `ensureCertificationLevelsAndBadges`, which Drizzle's uniqueIndex can't express.

export type TrainerScope = typeof trainerScopes.$inferSelect;
export type InsertTrainerScope = typeof trainerScopes.$inferInsert;

// Coach-authored custom badges (e.g. a Safety Badge), awarded by hand. Level
// badges need no definition row: their label, color and icon are derived from
// the department and level. Archived rather than deleted so awarded badges
// never dangle.
export const badgeDefinitions = pgTable("badge_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("award"),     // key into BADGE_ICONS, components/badgeStyles.tsx
  color: text("color").notNull().default("#dc2626"), // hex; applied via inline style, never a Tailwind class
  archived: boolean("archived").notNull().default(false),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type BadgeDefinition = typeof badgeDefinitions.$inferSelect;
export type InsertBadgeDefinition = typeof badgeDefinitions.$inferInsert;

// One award table for both kinds of badge, because every render site shows them
// as a single chip row per member. `kind` discriminates:
//   'level'  -> department + level are set, badgeDefinitionId is null
//   'custom' -> badgeDefinitionId is set, department + level are null
// `awardedBy` is null for automatic level badges and set for hand-awarded ones.
//
// Level badges are written ONCE, when earned, and are never recomputed away —
// see newlyEarnedLevelBadges in shared/certifications.ts.
export const userBadges = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // level | custom
  badgeDefinitionId: integer("badge_definition_id").references(() => badgeDefinitions.id, { onDelete: "cascade" }),
  department: text("department"), // null = General (kind = 'level')
  level: integer("level"),
  awardedBy: integer("awarded_by").references(() => users.id), // null = automatic
  note: text("note"),
  earnedAt: timestamp("earned_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});
// Two PARTIAL unique indexes, one per kind, created in
// `ensureCertificationLevelsAndBadges`:
//   (user_id, coalesce(department,''), level) WHERE kind = 'level'
//   (user_id, badge_definition_id)            WHERE kind = 'custom'

export type UserBadge = typeof userBadges.$inferSelect;
export type InsertUserBadge = typeof userBadges.$inferInsert;

export const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  type: text("type").notNull().default("shop"),
  location: text("location").notNull().default(""),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  recurrenceType: text("recurrence_type"),
  recurrenceEndsOn: text("recurrence_ends_on"),
  parentEventId: integer("parent_event_id").references((): AnyPgColumn => calendarEvents.id, { onDelete: 'cascade' }),
  instanceDate: text("instance_date"),
  deletedDates: text("deleted_dates"),
  attending: boolean("attending").notNull().default(true),
  // Event participation (Epic A): students sign up, leadership accepts, hours are
  // clocked against the event on the shared time clock.
  signupEnabled: boolean("signup_enabled").notNull().default(false),
  capacity: integer("capacity"), // null = unlimited
  archived: boolean("archived").notNull().default(false),
  // Invite-only visibility: hidden from everyone except invitees, the
  // creator, and leadership. See server/services/eventVisibility.ts.
  inviteOnly: boolean("invite_only").notNull().default(false),
});

export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InsertCalendarEvent = typeof calendarEvents.$inferInsert;

export const resources = pgTable("resources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("Other"),
  addedBy: integer("added_by").notNull().references(() => users.id),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type Resource = typeof resources.$inferSelect;
export type InsertResource = typeof resources.$inferInsert;

export const teamSettings = pgTable("team_settings", {
  id: serial("id").primaryKey(),
  teamNumber: integer("team_number").notNull().default(31130),
  teamName: text("team_name").notNull().default("ManeFrame"),
  themeColor: text("theme_color").notNull().default("#4169e1"),
  logoUrl: text("logo_url"),
  departments: jsonb("departments").$type<{ name: string; color: string }[]>().notNull().default([
    { name: 'Mechanical', color: '#f97316' },
    { name: 'Software', color: '#3b82f6' },
    { name: 'Modeling', color: '#8b5cf6' },
    { name: 'Logistics', color: '#22c55e' },
    { name: 'Electrical', color: '#eab308' },
    { name: 'Business', color: '#14b8a6' },
    { name: 'Leadership', color: '#ef4444' },
  ]),
  roles: jsonb("roles").$type<{ name: string; tier: string }[]>().notNull().default([
    { name: 'Coach', tier: 'leadership' },
    { name: 'Team Captain', tier: 'leadership' },
    { name: 'SCRUM Master', tier: 'leadership' },
    { name: 'Department Head', tier: 'lead' },
    { name: 'Trainer', tier: 'lead' },
    { name: 'Team Member', tier: 'member' },
    { name: 'Class Member', tier: 'member' },
  ]),
  teamProgram: text("team_program").notNull().default("FTC"),
  // Home-base IANA timezone (e.g. "America/Los_Angeles"). Business rules that
  // must stay pinned to the team regardless of viewer (hours-day bucketing,
  // the calendar subscription feed) use this; personal display of instants
  // uses the viewer's own device timezone with this shown alongside when
  // they differ — see utils/timeFormat.ts.
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  tbaApiKey: text("tba_api_key"),
  toaApiKey: text("toa_api_key"),
  nexusApiKey: text("nexus_api_key"),
  // Requirements config (Epic C) — fundraising goal + per-category hour requirements.
  requirements: jsonb("requirements").$type<any>(),
  fundraisingCategories: jsonb("fundraising_categories").$type<string[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type TeamSettings = typeof teamSettings.$inferSelect;
export type InsertTeamSettings = typeof teamSettings.$inferInsert;

export const matchExceptions = pgTable("match_exceptions", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => scoutEvents.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  matchNumber: integer("match_number").notNull(),
  type: text("type").notNull().default("off"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  uniqException: uniqueIndex("match_exceptions_unique_idx").on(t.eventId, t.userId, t.matchNumber),
}));

export type MatchException = typeof matchExceptions.$inferSelect;
export type InsertMatchException = typeof matchExceptions.$inferInsert;

export const guestTokens = pgTable("guest_tokens", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => scoutEvents.id, { onDelete: "cascade" }),
  pin: text("pin").notNull(),
  label: text("label").notNull().default("Guest"),
  active: boolean("active").notNull().default(true),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type GuestToken = typeof guestTokens.$inferSelect;
export type InsertGuestToken = typeof guestTokens.$inferInsert;

// One secret per user for their personal calendar subscription feed
// (webcal/ICS). "Regenerating" is an update-in-place — the old URL stops
// working the instant a new token is written. See server/routes/calendarFeed.ts.
export const calendarFeedTokens = pgTable("calendar_feed_tokens", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type CalendarFeedToken = typeof calendarFeedTokens.$inferSelect;
export type InsertCalendarFeedToken = typeof calendarFeedTokens.$inferInsert;

// Web Push (VAPID) subscriptions — one row per browser/device a user enabled.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

// Recurring task templates — a scheduler stamps these into normal `tasks` on a
// fixed interval (daily/weekly/biweekly/monthly). Generated tasks are ordinary
// tasks; editing/completing one never touches the template.
export const recurringTaskTemplates = pgTable("recurring_task_templates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  priority: text("priority").notNull().default("Medium"),
  effort: integer("effort"),
  departments: jsonb("departments").$type<string[]>().notNull().default([]),
  assignees: jsonb("assignees").$type<number[]>().notNull().default([]),
  deptOnly: boolean("dept_only").notNull().default(false),
  frequency: text("frequency").notNull().default("weekly"), // daily | weekly | biweekly | monthly
  dueOffsetDays: integer("due_offset_days").notNull().default(0),
  active: boolean("active").notNull().default(true),
  lastGeneratedDate: text("last_generated_date"), // YYYY-MM-DD of the most recent generation
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type RecurringTaskTemplate = typeof recurringTaskTemplates.$inferSelect;
export type InsertRecurringTaskTemplate = typeof recurringTaskTemplates.$inferInsert;

// Event participation roster (Epic A). Hours are NOT stored here — they are
// clocked on the shared time clock (`time_entries` with kind + calendarEventId).
export const eventSignups = pgTable("event_signups", {
  id: serial("id").primaryKey(),
  calendarEventId: integer("calendar_event_id").notNull().references(() => calendarEvents.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("requested"), // requested | accepted | declined | waitlisted | invited
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  note: text("note"),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
  checkedInBy: integer("checked_in_by").references(() => users.id),
  // Set when status is (or was) "invited" — who invited this person to a
  // private event, and when. See server/services/eventVisibility.ts.
  invitedBy: integer("invited_by").references(() => users.id),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  uniqSignup: uniqueIndex("event_signups_unique_idx").on(t.calendarEventId, t.userId),
}));

export type EventSignup = typeof eventSignups.$inferSelect;
export type InsertEventSignup = typeof eventSignups.$inferInsert;

// Fundraising contributions (Epic C). Amounts in integer cents.
export const fundraisingEntries = pgTable("fundraising_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  category: text("category").notNull().default("Other"),
  description: text("description").notNull().default(""),
  occurredOn: text("occurred_on").notNull(), // YYYY-MM-DD
  status: text("status").notNull().default("verified"), // verified | pending
  verifiedBy: integer("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type FundraisingEntry = typeof fundraisingEntries.$inferSelect;
export type InsertFundraisingEntry = typeof fundraisingEntries.$inferInsert;
