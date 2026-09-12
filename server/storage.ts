import crypto from "crypto";
import { db } from "./db";
import { hashPassword } from "./security";
import { users, projects, tasks, notifications, announcements, generalTasks, timeEntries, timeEntryAudit, timeEntryTaskSegments, scoutEvents, pitScouts, matchScouts, competitionAssignments, eventInfo, competitionCheckins, competitionCheckinAudit, fullscreenAlerts, teamClaims, certifications, userCertifications, certificationRequests, trainerScopes, badgeDefinitions, userBadges, calendarEvents, resources, matchExceptions, teamSettings, guestTokens, calendarFeedTokens, recurringTaskTemplates, eventSignups, fundraisingEntries, seasons, scoutingTemplates } from "../shared/schema";
import { BUILTIN_TEMPLATES, dataFromLegacyRow, legacyColumnsFromData, type ScoutKind } from "../shared/scoutingTemplates";
import { sameDepartment, newlyEarnedLevelBadges, normalizeLevel, MAX_LEVEL, type EarnedLevelBadge } from "../shared/certifications";

/**
 * Normalize a scout write during the seasons/templates transition. If the
 * caller supplies a `data` blob (new clients), dual-write the built-in legacy
 * columns from it so rollback stays possible — without clobbering any legacy
 * field the caller set explicitly. If no `data` is supplied (old clients),
 * synthesize it from the legacy fields so every row ends up with a `data` blob.
 */
function normalizeScoutWrite(kind: ScoutKind, values: Record<string, any>): Record<string, any> {
  const v: Record<string, any> = { ...values };
  if (v.data && typeof v.data === "object" && Object.keys(v.data).length > 0) {
    const legacy = legacyColumnsFromData(kind, v.data);
    for (const [col, val] of Object.entries(legacy)) {
      if (v[col] === undefined) v[col] = val;
    }
  } else {
    const derived = dataFromLegacyRow(kind, v);
    if (Object.keys(derived).length > 0) v.data = derived;
  }
  return v;
}

/** Read shim: fill an empty `data` blob from legacy columns (post-backfill no-op). */
function fillScoutData<T extends Record<string, any>>(kind: ScoutKind, row: T): T {
  if (!row) return row;
  if (row.data && typeof row.data === "object" && Object.keys(row.data).length > 0) return row;
  return { ...row, data: dataFromLegacyRow(kind, row) };
}
import type { User, InsertUser, Project, InsertProject, Task, InsertTask, Notification, InsertNotification, Announcement, InsertAnnouncement, GeneralTask, InsertGeneralTask, TimeEntry, InsertTimeEntry, TimeEntryAudit, InsertTimeEntryAudit, TimeEntryTaskSegment, ScoutEvent, InsertScoutEvent, PitScout, InsertPitScout, MatchScout, InsertMatchScout, CompetitionAssignment, InsertCompetitionAssignment, EventInfo, InsertEventInfo, CompetitionCheckin, InsertCompetitionCheckin, CompetitionCheckinAudit, InsertCompetitionCheckinAudit, FullscreenAlert, InsertFullscreenAlert, TeamClaim, Certification, InsertCertification, UserCertification, CertificationRequest, TrainerScope, InsertTrainerScope, BadgeDefinition, InsertBadgeDefinition, UserBadge, InsertUserBadge, CalendarEvent, InsertCalendarEvent, Resource, InsertResource, MatchException, TeamSettings, InsertTeamSettings, GuestToken, RecurringTaskTemplate, InsertRecurringTaskTemplate, EventSignup, InsertEventSignup, FundraisingEntry, InsertFundraisingEntry } from "../shared/schema";
import { eq, desc, and, or, isNull, lt, inArray, sql } from "drizzle-orm";
import { HOUR_CATEGORIES } from "../shared/hourCategories";
import {
  type DepartmentChangeSet,
  type DepartmentPropagationCounts,
  type DepartmentUsageMap,
  normalizeDepartmentChanges,
  remapDepartmentName,
  remapDepartmentList,
  reconcileDepartmentChanges,
} from "../shared/departments";

/** Thrown by `updateTeamSettingsWithDepartmentChanges` when the client's declared
 *  department rename/removal intent doesn't reconcile against what's actually
 *  stored — the route layer maps this to a 400 instead of a 500. */
export class DepartmentChangeError extends Error {}

// --- Recurring-task date helpers (team-local, matching the app's date convention) ---
// No cache import here (server/services/teamTime.ts imports `storage`, so the
// reverse import would be circular) — callers fetch the timezone via
// `this.getTeamSettings()` and pass it in.
function todayServerLocalStr(tz: string = 'America/Los_Angeles'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}
function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function addMonthsStr(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}
// The earliest date a template is next due to generate. Null last-generated =>
// due immediately.
function nextRecurringDate(lastGenerated: string | null, frequency: string): string {
  if (!lastGenerated) return '0000-01-01';
  switch (frequency) {
    case 'daily': return addDaysStr(lastGenerated, 1);
    case 'weekly': return addDaysStr(lastGenerated, 7);
    case 'biweekly': return addDaysStr(lastGenerated, 14);
    case 'monthly': return addMonthsStr(lastGenerated, 1);
    default: return addDaysStr(lastGenerated, 7);
  }
}

function toDate(value: any): Date | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  return undefined;
}

function migrateSuccessCriteria(criteria: any[]): {id: string; text: string; completed: boolean}[] {
  if (!Array.isArray(criteria)) return [];
  return criteria.map((item, idx) => {
    if (typeof item === 'string') {
      return { id: `migrated-${idx}-${Date.now()}`, text: item, completed: false };
    }
    return item;
  });
}

/** Shallow same-elements-same-order comparison, used to skip a write when a department remap is a no-op. */
function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sanitizeTask(task: any): any {
  const sanitized: any = { ...task };
  if ('createdAt' in sanitized) sanitized.createdAt = toDate(sanitized.createdAt);
  if ('completedAt' in sanitized) sanitized.completedAt = toDate(sanitized.completedAt);
  return sanitized;
}

function sanitizeProject(project: any): any {
  const sanitized: any = { ...project };
  if ('createdAt' in sanitized) sanitized.createdAt = toDate(sanitized.createdAt);
  return sanitized;
}

function sanitizeNotification(notification: any): any {
  const sanitized: any = { ...notification };
  if ('timestamp' in sanitized) sanitized.timestamp = toDate(sanitized.timestamp);
  return sanitized;
}

function sanitizeAnnouncement(announcement: any): any {
  const sanitized: any = { ...announcement };
  if ('timestamp' in sanitized) sanitized.timestamp = toDate(sanitized.timestamp);
  return sanitized;
}

function sanitizeUser(user: any): any {
  const sanitized: any = { ...user };
  delete sanitized.id;
  delete sanitized.createdAt;
  return sanitized;
}

function sanitizeTimeEntry(entry: any): any {
  const sanitized: any = { ...entry };
  if ('checkInAt' in sanitized) sanitized.checkInAt = toDate(sanitized.checkInAt);
  if ('checkOutAt' in sanitized) sanitized.checkOutAt = toDate(sanitized.checkOutAt);
  if ('checkInConfirmedAt' in sanitized) sanitized.checkInConfirmedAt = toDate(sanitized.checkInConfirmedAt);
  if ('checkOutConfirmedAt' in sanitized) sanitized.checkOutConfirmedAt = toDate(sanitized.checkOutConfirmedAt);
  if ('createdAt' in sanitized) sanitized.createdAt = toDate(sanitized.createdAt);
  return sanitized;
}

export interface IStorage {
  getUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<void>;

  getProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  getTasks(): Promise<Task[]>;
  getTask(id: number): Promise<Task | undefined>;
  getTasksByProject(projectId: number): Promise<Task[]>;
  createTask(task: InsertTask): Promise<Task>;
  createTasksBulk(tasks: (InsertTask & { dependencyTitles?: string[] })[]): Promise<Task[]>;
  updateTask(id: number, task: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: number): Promise<void>;

  getNotifications(): Promise<Notification[]>;
  getNotificationsByUser(userId: number): Promise<Notification[]>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  updateNotification(id: number, notification: Partial<InsertNotification>): Promise<Notification | undefined>;
  deleteNotification(id: number): Promise<void>;

  getAnnouncements(): Promise<Announcement[]>;
  createAnnouncement(announcement: InsertAnnouncement): Promise<Announcement>;
  updateAnnouncement(id: number, announcement: Partial<InsertAnnouncement>): Promise<Announcement | undefined>;
  deleteAnnouncement(id: number): Promise<void>;

  getScoutEvents(): Promise<ScoutEvent[]>;
  getScoutEvent(id: number): Promise<ScoutEvent | undefined>;
  createScoutEvent(event: InsertScoutEvent): Promise<ScoutEvent>;
  updateScoutEvent(id: number, event: Partial<InsertScoutEvent>): Promise<ScoutEvent | undefined>;
  deleteScoutEvent(id: number): Promise<void>;

  getPitScouts(eventId: number): Promise<PitScout[]>;
  getPitScout(id: number): Promise<PitScout | undefined>;
  createPitScout(scout: InsertPitScout): Promise<PitScout>;
  updatePitScout(id: number, scout: Partial<InsertPitScout>): Promise<PitScout | undefined>;
  deletePitScout(id: number): Promise<void>;

  getMatchScouts(eventId: number): Promise<MatchScout[]>;
  getMatchScoutsByTeam(teamNumber: number): Promise<any[]>;
  getMatchScout(id: number): Promise<MatchScout | undefined>;
  createMatchScout(scout: InsertMatchScout): Promise<MatchScout>;
  updateMatchScout(id: number, scout: Partial<InsertMatchScout>): Promise<MatchScout | undefined>;
  deleteMatchScout(id: number): Promise<void>;

  getCompetitionAssignments(eventId: number): Promise<CompetitionAssignment[]>;
  getCompetitionAssignment(id: number): Promise<CompetitionAssignment | undefined>;
  createCompetitionAssignment(assignment: InsertCompetitionAssignment): Promise<CompetitionAssignment>;
  updateCompetitionAssignment(id: number, assignment: Partial<InsertCompetitionAssignment>): Promise<CompetitionAssignment | undefined>;
  deleteCompetitionAssignment(id: number): Promise<void>;

  getEventInfo(eventId: number): Promise<EventInfo | undefined>;
  upsertEventInfo(eventId: number, data: Partial<InsertEventInfo>): Promise<EventInfo>;
  deleteEventInfo(eventId: number): Promise<void>;

  getCompetitionCheckins(eventId: number): Promise<CompetitionCheckin[]>;
  getCompetitionCheckinsByUser(userId: number): Promise<CompetitionCheckin[]>;
  getAllCompetitionCheckins(): Promise<CompetitionCheckin[]>;
  getOpenCompetitionCheckin(userId: number, eventId: number): Promise<CompetitionCheckin | undefined>;
  createCompetitionCheckin(checkin: InsertCompetitionCheckin): Promise<CompetitionCheckin>;
  updateCompetitionCheckin(id: number, checkin: Partial<InsertCompetitionCheckin>): Promise<CompetitionCheckin | undefined>;
  deleteCompetitionCheckin(id: number): Promise<void>;

  getFullscreenAlerts(activeOnly?: boolean): Promise<FullscreenAlert[]>;
  getFullscreenAlert(id: number): Promise<FullscreenAlert | undefined>;
  createFullscreenAlert(alert: InsertFullscreenAlert): Promise<FullscreenAlert>;
  updateFullscreenAlert(id: number, alert: Partial<InsertFullscreenAlert>): Promise<FullscreenAlert | undefined>;
  deleteFullscreenAlert(id: number): Promise<void>;

  getTeamClaims(eventId: number): Promise<TeamClaim[]>;
  upsertTeamClaim(data: { eventId: number; matchKey: string; teamNumber: number; userId: number; userName: string }): Promise<TeamClaim>;
  deleteTeamClaim(eventId: number, matchKey: string, teamNumber: number, userId: number): Promise<void>;

  getGeneralTasks(includeArchived?: boolean): Promise<GeneralTask[]>;
  getGeneralTask(id: number): Promise<GeneralTask | undefined>;
  createGeneralTask(data: InsertGeneralTask): Promise<GeneralTask>;
  updateGeneralTask(id: number, data: Partial<InsertGeneralTask>): Promise<GeneralTask | undefined>;
  deleteGeneralTask(id: number): Promise<void>;

  getAvailableTasksForUser(userId: number): Promise<(Task & { isAssigned: boolean; projectName: string })[]>;
  setWorkingOn(entryId: number, taskId?: number | null, generalTaskId?: number | null, assignedBy?: number | null): Promise<{ entry: TimeEntry | undefined; closed: TimeEntryTaskSegment | undefined }>;
  closeOpenTaskSegments(entryId: number, at?: Date): Promise<TimeEntryTaskSegment[]>;
  getTaskSegmentsForUser(userId: number): Promise<TimeEntryTaskSegment[]>;
  getTaskSegments(): Promise<TimeEntryTaskSegment[]>;

  getCertifications(): Promise<any[]>;
  getCertification(id: number): Promise<Certification | undefined>;
  createCertification(data: InsertCertification): Promise<Certification>;
  updateCertification(id: number, data: Partial<InsertCertification>): Promise<Certification | undefined>;
  deleteCertification(id: number): Promise<void>;
  getUserCertifications(userId: number): Promise<any[]>;
  grantCertification(userId: number, certId: number, grantedBy: number): Promise<UserCertification>;
  revokeCertification(userId: number, certId: number): Promise<void>;
  getCertifiedUsers(certId: number): Promise<any[]>;
  getTrainersForCert(certId: number): Promise<any[]>;
  createCertRequest(userId: number, certId: number): Promise<CertificationRequest>;
  getCertRequests(filters: { userId?: number; statuses?: string[]; scope?: { bypass: boolean; scopes: { department: string | null; maxLevel: number }[] } }): Promise<any[]>;
  getCertRequestDetail(requestId: number): Promise<any | undefined>;
  claimCertRequest(requestId: number, trainerId: number): Promise<CertificationRequest | undefined>;
  updateCertRequestProgress(requestId: number, checklistProgress: { item: string; completed: boolean }[], notes?: string): Promise<CertificationRequest | undefined>;
  completeCertRequest(requestId: number, trainerId: number): Promise<CertificationRequest | undefined>;
  rejectCertRequest(requestId: number, trainerId: number, notes?: string): Promise<CertificationRequest | undefined>;

  getTrainerScopes(userId?: number): Promise<TrainerScope[]>;
  setTrainerScopes(userId: number, scopes: { department: string | null; maxLevel: number }[], createdBy: number): Promise<TrainerScope[]>;

  getBadgeDefinitions(includeArchived?: boolean): Promise<BadgeDefinition[]>;
  createBadgeDefinition(data: InsertBadgeDefinition): Promise<BadgeDefinition>;
  updateBadgeDefinition(id: number, data: Partial<InsertBadgeDefinition>): Promise<BadgeDefinition | undefined>;
  deleteBadgeDefinition(id: number): Promise<void>;
  getUserBadges(userId?: number): Promise<UserBadge[]>;
  awardCustomBadge(userId: number, badgeDefinitionId: number, awardedBy: number, note?: string): Promise<UserBadge | undefined>;
  revokeBadge(userId: number, badgeId: number): Promise<void>;

  getCalendarEvents(): Promise<CalendarEvent[]>;
  getCalendarEvent(id: number): Promise<CalendarEvent | undefined>;
  createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent>;
  updateCalendarEvent(id: number, data: Partial<InsertCalendarEvent>): Promise<CalendarEvent | undefined>;
  deleteCalendarEvent(id: number): Promise<void>;
  patchCalendarEventDeletedDates(id: number, deletedDates: string[]): Promise<CalendarEvent | undefined>;
  migrateCalendarTypes(): Promise<void>;
  backfillNexusEventKeys(): Promise<void>;
  backfillOutreachHours(): Promise<void>;
  seedCalendarEvents(createdBy: number): Promise<void>;

  getResources(category?: string): Promise<Resource[]>;
  getResource(id: number): Promise<Resource | undefined>;
  createResource(data: InsertResource): Promise<Resource>;
  updateResource(id: number, data: Partial<InsertResource>): Promise<Resource | undefined>;
  deleteResource(id: number): Promise<void>;
  seedResources(addedBy: number): Promise<void>;

  getMatchExceptions(eventId: number): Promise<MatchException[]>;
  upsertMatchException(data: { eventId: number; userId: number; matchNumber: number; type: string; createdBy: number }): Promise<MatchException>;
  deleteMatchException(eventId: number, userId: number, matchNumber: number): Promise<void>;

  getTeamSettings(): Promise<TeamSettings>;
  upsertTeamSettings(data: Partial<Omit<TeamSettings, 'id' | 'updatedAt'>>): Promise<TeamSettings>;
  /**
   * Like `upsertTeamSettings`, but for saves that touch `departments`: the
   * declared `DepartmentChangeSet` is reconciled against the current row
   * (inside the same transaction, under a row lock) and then propagated to
   * every table that references a department by name — users, tasks,
   * projects, announcements, recurring task templates — before the settings
   * row itself is written. Throws `DepartmentChangeError` if the declared
   * changes don't reconcile.
   */
  updateTeamSettingsWithDepartmentChanges(
    data: Partial<Omit<TeamSettings, 'id' | 'updatedAt'>>,
    declared: DepartmentChangeSet,
  ): Promise<{ settings: TeamSettings; propagation: DepartmentPropagationCounts }>;
  /** Per-department reference counts across every table that can name one, keyed by department name. */
  getDepartmentUsageCounts(): Promise<DepartmentUsageMap>;
  migrateApiKeyColumns(): Promise<void>;
  ensureTeamTimezoneColumn(): Promise<void>;

  seedDatabase(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined> {
    const sanitized = sanitizeUser(user);
    const [updated] = await db.update(users).set(sanitized).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async createProject(project: InsertProject): Promise<Project> {
    const sanitized = sanitizeProject(project);
    const [newProject] = await db.insert(projects).values(sanitized).returning();
    return newProject;
  }

  async updateProject(id: number, project: Partial<InsertProject>): Promise<Project | undefined> {
    const sanitized = sanitizeProject(project);
    delete sanitized.id;
    const [updated] = await db.update(projects).set(sanitized).where(eq(projects.id, id)).returning();
    return updated;
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  async getTasks(): Promise<Task[]> {
    const result = await db.select().from(tasks).orderBy(desc(tasks.createdAt));
    return result.map(t => ({ ...t, successCriteria: migrateSuccessCriteria(t.successCriteria as any) }));
  }

  async getTask(id: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!task) return undefined;
    return { ...task, successCriteria: migrateSuccessCriteria(task.successCriteria as any) };
  }

  async getTasksByProject(projectId: number): Promise<Task[]> {
    const result = await db.select().from(tasks).where(eq(tasks.projectId, projectId));
    return result.map(t => ({ ...t, successCriteria: migrateSuccessCriteria(t.successCriteria as any) }));
  }

  async createTask(task: InsertTask): Promise<Task> {
    const sanitized = sanitizeTask(task);
    const [newTask] = await db.insert(tasks).values(sanitized).returning();
    return newTask;
  }

  // Insert every task in one transaction: a bulk import should either land
  // in full or not at all, so the caller (e.g. a CSV import) never has to
  // figure out which rows silently made it onto the board.
  //
  // Two passes, same transaction: a row's dependency on another row in this
  // same batch can't be expressed until both exist, so pass one inserts
  // everything and pass two links same-batch dependencies by id, using each
  // task's title to find the row it was pointing at (`dependencyTitles`,
  // resolved server-side in server/routes/tasks.ts before this is called).
  // If pass two fails, pass one rolls back with it.
  async createTasksBulk(taskList: (InsertTask & { dependencyTitles?: string[] })[]): Promise<Task[]> {
    if (taskList.length === 0) return [];
    return db.transaction(async (tx) => {
      const linkNames = taskList.map(t => t.dependencyTitles || []);
      const toInsert = taskList.map(t => {
        const { dependencyTitles, ...rest } = t;
        return sanitizeTask(rest);
      });

      // A single multi-row INSERT ... RETURNING preserves the VALUES order
      // in Postgres, so inserted[i] corresponds to taskList[i] — that's what
      // lets pass two line up each row with its dependencyTitles.
      const inserted = await tx.insert(tasks).values(toInsert).returning();

      const titleToId = new Map<string, number>();
      for (const row of inserted) titleToId.set(row.title.trim().toLowerCase(), row.id);

      const updates: { id: number; dependencies: number[] }[] = [];
      inserted.forEach((row, i) => {
        const names = linkNames[i];
        if (names.length === 0) return;
        const linkedIds = names
          .map(n => titleToId.get(n.trim().toLowerCase()))
          .filter((id): id is number => id !== undefined && id !== row.id);
        if (linkedIds.length === 0) return;
        const merged = Array.from(new Set([...(row.dependencies as number[] || []), ...linkedIds]));
        updates.push({ id: row.id, dependencies: merged });
      });

      if (updates.length === 0) return inserted;

      for (const u of updates) {
        await tx.update(tasks).set({ dependencies: u.dependencies }).where(eq(tasks.id, u.id));
      }
      const updatedRows = await tx.select().from(tasks).where(inArray(tasks.id, updates.map(u => u.id)));
      const updatedById = new Map(updatedRows.map(r => [r.id, r]));
      return inserted.map(row => updatedById.get(row.id) || row);
    });
  }

  async updateTask(id: number, task: Partial<InsertTask>): Promise<Task | undefined> {
    const sanitized = sanitizeTask(task);
    delete sanitized.id;
    const [updated] = await db.update(tasks).set(sanitized).where(eq(tasks.id, id)).returning();
    return updated;
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  async getNotifications(): Promise<Notification[]> {
    return db.select().from(notifications).orderBy(desc(notifications.timestamp));
  }

  async getNotificationsByUser(userId: number): Promise<Notification[]> {
    return db.select().from(notifications).where(eq(notifications.toUserId, userId)).orderBy(desc(notifications.timestamp));
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const sanitized = sanitizeNotification(notification);
    const [newNotification] = await db.insert(notifications).values(sanitized).returning();
    return newNotification;
  }

  async updateNotification(id: number, notification: Partial<InsertNotification>): Promise<Notification | undefined> {
    const sanitized = sanitizeNotification(notification);
    delete sanitized.id;
    const [updated] = await db.update(notifications).set(sanitized).where(eq(notifications.id, id)).returning();
    return updated;
  }

  async deleteNotification(id: number): Promise<void> {
    await db.delete(notifications).where(eq(notifications.id, id));
  }

  async getAnnouncements(): Promise<Announcement[]> {
    return db.select().from(announcements).orderBy(desc(announcements.timestamp));
  }

  async createAnnouncement(announcement: InsertAnnouncement): Promise<Announcement> {
    const sanitized = sanitizeAnnouncement(announcement);
    const [newAnnouncement] = await db.insert(announcements).values(sanitized).returning();
    return newAnnouncement;
  }

  async updateAnnouncement(id: number, announcement: Partial<InsertAnnouncement>): Promise<Announcement | undefined> {
    const sanitized = sanitizeAnnouncement(announcement);
    delete sanitized.id;
    const [updated] = await db.update(announcements).set(sanitized).where(eq(announcements.id, id)).returning();
    return updated;
  }

  async deleteAnnouncement(id: number): Promise<void> {
    await db.delete(announcements).where(eq(announcements.id, id));
  }

  async getTimeEntries(): Promise<any[]> {
    const entries = await db.select().from(timeEntries).orderBy(desc(timeEntries.createdAt));
    if (entries.length === 0) return entries;
    const taskIds = [...new Set(entries.map(e => e.workingOnTaskId).filter((id): id is number => id !== null && id !== undefined))];
    const genTaskIds = [...new Set(entries.map(e => e.workingOnGeneralTaskId).filter((id): id is number => id !== null && id !== undefined))];
    const taskMap: Record<number, string> = {};
    const genTaskMap: Record<number, string> = {};
    if (taskIds.length > 0) {
      const taskRows = await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, taskIds));
      for (const t of taskRows) taskMap[t.id] = t.title;
    }
    if (genTaskIds.length > 0) {
      const genRows = await db.select({ id: generalTasks.id, name: generalTasks.name }).from(generalTasks).where(inArray(generalTasks.id, genTaskIds));
      for (const g of genRows) genTaskMap[g.id] = g.name;
    }
    return entries.map(e => ({
      ...e,
      workingOnTaskTitle: e.workingOnTaskId ? (taskMap[e.workingOnTaskId] || null) : null,
      workingOnGeneralTaskName: e.workingOnGeneralTaskId ? (genTaskMap[e.workingOnGeneralTaskId] || null) : null,
    }));
  }

  async getTimeEntry(id: number): Promise<TimeEntry | undefined> {
    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
    return entry;
  }

  async getTimeEntriesByUser(userId: number): Promise<TimeEntry[]> {
    return db.select().from(timeEntries).where(eq(timeEntries.userId, userId)).orderBy(desc(timeEntries.createdAt));
  }

  async getOpenTimeEntry(userId: number): Promise<TimeEntry | undefined> {
    const results = await db.select().from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.checkOutAt)));
    // A rejected session shouldn't block a later clock-in — it was declined,
    // not left open.
    return results.find(e => e.status !== 'completed' && e.status !== 'rejected');
  }

  // --- Competition time (kind='competition', scoutEventId set) ---
  async getTimeEntriesByScoutEvent(scoutEventId: number): Promise<TimeEntry[]> {
    return db.select().from(timeEntries)
      .where(eq(timeEntries.scoutEventId, scoutEventId))
      .orderBy(desc(timeEntries.createdAt));
  }
  async getTimeEntriesByUserAndKind(userId: number, kind: string): Promise<TimeEntry[]> {
    return db.select().from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), eq(timeEntries.kind, kind)))
      .orderBy(desc(timeEntries.createdAt));
  }
  async getOpenTimeEntryForScoutEvent(userId: number, scoutEventId: number): Promise<TimeEntry | undefined> {
    const [row] = await db.select().from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        eq(timeEntries.scoutEventId, scoutEventId),
        isNull(timeEntries.checkOutAt),
      ));
    return row;
  }

  async createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry> {
    const sanitized = sanitizeTimeEntry(entry);
    const [newEntry] = await db.insert(timeEntries).values(sanitized).returning();
    return newEntry;
  }

  async updateTimeEntry(id: number, entry: Partial<InsertTimeEntry>): Promise<TimeEntry | undefined> {
    const sanitized = sanitizeTimeEntry(entry);
    delete sanitized.id;
    const [updated] = await db.update(timeEntries).set(sanitized).where(eq(timeEntries.id, id)).returning();
    return updated;
  }

  async deleteTimeEntry(id: number): Promise<void> {
    await db.delete(timeEntries).where(eq(timeEntries.id, id));
  }

  async getGeneralTasks(includeArchived = false): Promise<GeneralTask[]> {
    const rows = await db.select().from(generalTasks).orderBy(generalTasks.name);
    return includeArchived ? rows : rows.filter(r => r.active);
  }

  async getGeneralTask(id: number): Promise<GeneralTask | undefined> {
    const [row] = await db.select().from(generalTasks).where(eq(generalTasks.id, id));
    return row;
  }

  async createGeneralTask(data: InsertGeneralTask): Promise<GeneralTask> {
    const [row] = await db.insert(generalTasks).values(data).returning();
    return row;
  }

  async updateGeneralTask(id: number, data: Partial<InsertGeneralTask>): Promise<GeneralTask | undefined> {
    const sanitized: any = { ...data };
    delete sanitized.id;
    const [row] = await db.update(generalTasks).set(sanitized).where(eq(generalTasks.id, id)).returning();
    return row;
  }

  async deleteGeneralTask(id: number): Promise<void> {
    await db.delete(generalTasks).where(eq(generalTasks.id, id));
  }

  /**
   * The "what are you working on?" menu. Tasks on an ARCHIVED board are
   * excluded: archiving a board retires its work, and a retired task must not
   * come back as something a student can clock onto. Anyone may pick any live
   * task — being an assignee only sorts it to the top (`isAssigned`), because
   * students routinely help on work they don't lead.
   */
  async getAvailableTasksForUser(userId: number): Promise<(Task & { isAssigned: boolean; projectName: string })[]> {
    const rows = await db
      .select({ task: tasks, projectName: projects.name })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(projects.archived, false));
    const statusOrder: Record<string, number> = {
      'In Progress': 0,
      'Not Started': 1,
      'Backlog': 2,
      'Blocked': 3,
    };
    return rows
      .filter(({ task: t }) => t.status !== 'Complete' && t.status !== 'Blocked')
      .map(({ task: t, projectName }) => {
        const assignees = (t.assignees as number[]) || [];
        return {
          ...t,
          successCriteria: migrateSuccessCriteria(t.successCriteria as any),
          isAssigned: assignees.includes(userId),
          projectName,
        };
      })
      .sort((a, b) => {
        if (a.isAssigned !== b.isAssigned) return a.isAssigned ? -1 : 1;
        return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      });
  }

  /**
   * Point a live session at a task, closing whatever it was on before.
   *
   * `time_entries.working_on_task_id` holds only the CURRENT task, so a switch
   * would erase the previous one. The segment ledger keeps both: close the open
   * segment (stamping its wall-clock minutes) and open a new one. Returns the
   * closed segment so the caller can credit that task's contributors.
   */
  async setWorkingOn(
    entryId: number,
    taskId?: number | null,
    generalTaskId?: number | null,
    assignedBy?: number | null,
  ): Promise<{ entry: TimeEntry | undefined; closed: TimeEntryTaskSegment | undefined }> {
    const updates: any = {
      workingOnTaskId: taskId ?? null,
      workingOnGeneralTaskId: generalTaskId ?? null,
    };
    const [updated] = await db.update(timeEntries).set(updates).where(eq(timeEntries.id, entryId)).returning();
    const [closed] = await this.closeOpenTaskSegments(entryId);
    if (updated && (taskId != null || generalTaskId != null)) {
      await db.insert(timeEntryTaskSegments).values({
        entryId,
        userId: updated.userId,
        taskId: taskId ?? null,
        generalTaskId: generalTaskId ?? null,
        startedAt: new Date(),
        assignedBy: assignedBy ?? null,
      });
    }
    return { entry: updated, closed };
  }

  /**
   * Close every still-open segment on an entry, stamping elapsed minutes.
   * Called on a task switch and again at check-out. Idempotent — an entry with
   * nothing open is a no-op, so a double check-out can't double-count.
   */
  async closeOpenTaskSegments(entryId: number, at: Date = new Date()): Promise<TimeEntryTaskSegment[]> {
    const open = await db.select().from(timeEntryTaskSegments)
      .where(and(eq(timeEntryTaskSegments.entryId, entryId), isNull(timeEntryTaskSegments.endedAt)));
    const closed: TimeEntryTaskSegment[] = [];
    for (const seg of open) {
      const minutes = Math.max(0, Math.round((at.getTime() - new Date(seg.startedAt).getTime()) / 60000));
      const [row] = await db.update(timeEntryTaskSegments)
        .set({ endedAt: at, minutes })
        .where(eq(timeEntryTaskSegments.id, seg.id))
        .returning();
      if (row) closed.push(row);
    }
    return closed;
  }

  /** Every task stretch for a member, newest first. Powers the productivity deep dive. */
  async getTaskSegmentsForUser(userId: number): Promise<TimeEntryTaskSegment[]> {
    return db.select().from(timeEntryTaskSegments)
      .where(eq(timeEntryTaskSegments.userId, userId))
      .orderBy(desc(timeEntryTaskSegments.startedAt));
  }

  /** Every task stretch on the team, newest first. */
  async getTaskSegments(): Promise<TimeEntryTaskSegment[]> {
    return db.select().from(timeEntryTaskSegments).orderBy(desc(timeEntryTaskSegments.startedAt));
  }

  async getTimeEntryAudit(entryId: number): Promise<TimeEntryAudit[]> {
    return db.select().from(timeEntryAudit).where(eq(timeEntryAudit.entryId, entryId)).orderBy(desc(timeEntryAudit.createdAt));
  }

  async createTimeEntryAudit(audit: InsertTimeEntryAudit): Promise<TimeEntryAudit> {
    const [newAudit] = await db.insert(timeEntryAudit).values(audit).returning();
    return newAudit;
  }

  async getScoutEvents(): Promise<ScoutEvent[]> {
    return db.select().from(scoutEvents).orderBy(desc(scoutEvents.createdAt));
  }

  async getScoutEvent(id: number): Promise<ScoutEvent | undefined> {
    const [event] = await db.select().from(scoutEvents).where(eq(scoutEvents.id, id));
    return event;
  }

  async createScoutEvent(event: InsertScoutEvent): Promise<ScoutEvent> {
    const [newEvent] = await db.insert(scoutEvents).values(event).returning();
    return newEvent;
  }

  async updateScoutEvent(id: number, event: Partial<InsertScoutEvent>): Promise<ScoutEvent | undefined> {
    const updates: Partial<InsertScoutEvent> = {};
    if (event.name !== undefined) updates.name = event.name;
    if (event.location !== undefined) updates.location = event.location;
    if (event.startDate !== undefined) updates.startDate = event.startDate;
    if (event.endDate !== undefined) updates.endDate = event.endDate;
    if (event.tbaEventKey !== undefined) updates.tbaEventKey = event.tbaEventKey;
    if (event.nexusEventKey !== undefined) updates.nexusEventKey = event.nexusEventKey;
    if (event.toaEventKey !== undefined) updates.toaEventKey = event.toaEventKey;
    if (event.nexusPitMapKey !== undefined) updates.nexusPitMapKey = event.nexusPitMapKey;
    if (event.seasonId !== undefined) updates.seasonId = event.seasonId;
    if (event.archived !== undefined) updates.archived = event.archived;
    if (Object.keys(updates).length === 0) {
      const [row] = await db.select().from(scoutEvents).where(eq(scoutEvents.id, id));
      return row;
    }
    const [updated] = await db.update(scoutEvents).set(updates).where(eq(scoutEvents.id, id)).returning();
    return updated;
  }

  async deleteScoutEvent(id: number): Promise<void> {
    await db.delete(scoutEvents).where(eq(scoutEvents.id, id));
  }

  async getPitScouts(eventId: number): Promise<PitScout[]> {
    const rows = await db.select().from(pitScouts).where(eq(pitScouts.eventId, eventId)).orderBy(desc(pitScouts.createdAt));
    return rows.map(r => fillScoutData("pit", r));
  }

  async getPitScout(id: number): Promise<PitScout | undefined> {
    const [scout] = await db.select().from(pitScouts).where(eq(pitScouts.id, id));
    return scout ? fillScoutData("pit", scout) : scout;
  }

  async createPitScout(scout: InsertPitScout): Promise<PitScout> {
    const [newScout] = await db.insert(pitScouts).values(normalizeScoutWrite("pit", scout) as InsertPitScout).returning();
    return newScout;
  }

  async updatePitScout(id: number, scout: Partial<InsertPitScout>): Promise<PitScout | undefined> {
    const sanitized: any = normalizeScoutWrite("pit", { ...scout });
    delete sanitized.id;
    const [updated] = await db.update(pitScouts).set(sanitized).where(eq(pitScouts.id, id)).returning();
    return updated;
  }

  async deletePitScout(id: number): Promise<void> {
    await db.delete(pitScouts).where(eq(pitScouts.id, id));
  }

  async getMatchScouts(eventId: number): Promise<MatchScout[]> {
    const rows = await db.select().from(matchScouts).where(eq(matchScouts.eventId, eventId)).orderBy(desc(matchScouts.createdAt));
    return rows.map(r => fillScoutData("match", r));
  }

  async getMatchScoutsByTeam(teamNumber: number): Promise<any[]> {
    const rows = await db
      .select({
        matchScout: matchScouts,
        eventName: scoutEvents.name,
      })
      .from(matchScouts)
      .innerJoin(scoutEvents, eq(matchScouts.eventId, scoutEvents.id))
      .where(eq(matchScouts.teamNumber, teamNumber))
      .orderBy(desc(matchScouts.createdAt));
    return rows.map(r => ({ ...fillScoutData("match", r.matchScout), eventName: r.eventName }));
  }

  async getMatchScout(id: number): Promise<MatchScout | undefined> {
    const [scout] = await db.select().from(matchScouts).where(eq(matchScouts.id, id));
    return scout ? fillScoutData("match", scout) : scout;
  }

  async createMatchScout(scout: InsertMatchScout): Promise<MatchScout> {
    const [newScout] = await db.insert(matchScouts).values(normalizeScoutWrite("match", scout) as InsertMatchScout).returning();
    return newScout;
  }

  async updateMatchScout(id: number, scout: Partial<InsertMatchScout>): Promise<MatchScout | undefined> {
    const sanitized: any = normalizeScoutWrite("match", { ...scout });
    delete sanitized.id;
    const [updated] = await db.update(matchScouts).set(sanitized).where(eq(matchScouts.id, id)).returning();
    return updated;
  }

  async deleteMatchScout(id: number): Promise<void> {
    await db.delete(matchScouts).where(eq(matchScouts.id, id));
  }

  // --- Seasons & scouting templates (Epic D) ---

  async getSeasons(): Promise<any[]> {
    return db.select().from(seasons).orderBy(desc(seasons.year), desc(seasons.createdAt));
  }

  async getSeason(id: number): Promise<any | undefined> {
    const [row] = await db.select().from(seasons).where(eq(seasons.id, id));
    return row;
  }

  async getActiveSeason(): Promise<any | undefined> {
    const [row] = await db.select().from(seasons).where(eq(seasons.active, true)).limit(1);
    return row;
  }

  async createSeason(data: { name: string; gameName?: string; year?: number | null; active?: boolean }): Promise<any> {
    const [row] = await db.insert(seasons).values({
      name: data.name,
      gameName: data.gameName ?? "",
      year: data.year ?? null,
      active: data.active ?? false,
    }).returning();
    if (row.active) await db.update(seasons).set({ active: false }).where(sql`${seasons.id} <> ${row.id}`);
    return row;
  }

  async updateSeason(id: number, data: { name?: string; gameName?: string; year?: number | null; active?: boolean }): Promise<any | undefined> {
    const updates: Record<string, any> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.gameName !== undefined) updates.gameName = data.gameName;
    if (data.year !== undefined) updates.year = data.year;
    if (data.active !== undefined) updates.active = data.active;
    if (Object.keys(updates).length === 0) return this.getSeason(id);
    const [row] = await db.update(seasons).set(updates).where(eq(seasons.id, id)).returning();
    // Exactly one active season at a time.
    if (data.active === true && row) {
      await db.update(seasons).set({ active: false }).where(sql`${seasons.id} <> ${id}`);
    }
    return row;
  }

  async deleteSeason(id: number): Promise<{ ok: boolean; reason?: string }> {
    const [ev] = await db.select().from(scoutEvents).where(eq(scoutEvents.seasonId, id)).limit(1);
    if (ev) return { ok: false, reason: "Season has events assigned to it" };
    await db.delete(seasons).where(eq(seasons.id, id));
    return { ok: true };
  }

  async getTemplatesForSeason(seasonId: number): Promise<any[]> {
    return db.select().from(scoutingTemplates).where(eq(scoutingTemplates.seasonId, seasonId));
  }

  async getTemplate(seasonId: number, kind: ScoutKind): Promise<any | undefined> {
    const [row] = await db.select().from(scoutingTemplates)
      .where(and(eq(scoutingTemplates.seasonId, seasonId), eq(scoutingTemplates.kind, kind))).limit(1);
    return row;
  }

  async getTemplateById(id: number): Promise<any | undefined> {
    const [row] = await db.select().from(scoutingTemplates).where(eq(scoutingTemplates.id, id));
    return row;
  }

  async createTemplate(data: { seasonId: number; kind: ScoutKind; name?: string; fields: any[]; createdBy?: number | null }): Promise<any> {
    const [row] = await db.insert(scoutingTemplates).values({
      seasonId: data.seasonId,
      kind: data.kind,
      name: data.name ?? "",
      fields: data.fields,
      revision: 1,
      createdBy: data.createdBy ?? null,
    }).returning();
    return row;
  }

  async updateTemplate(id: number, data: { name?: string; fields?: any[] }): Promise<any | undefined> {
    const updates: Record<string, any> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.fields !== undefined) {
      updates.fields = data.fields;
      updates.revision = sql`${scoutingTemplates.revision} + 1`;
    }
    if (Object.keys(updates).length === 0) return this.getTemplateById(id);
    const [row] = await db.update(scoutingTemplates).set(updates).where(eq(scoutingTemplates.id, id)).returning();
    return row;
  }

  async getCompetitionAssignments(eventId: number): Promise<CompetitionAssignment[]> {
    return db.select().from(competitionAssignments)
      .where(eq(competitionAssignments.eventId, eventId))
      .orderBy(competitionAssignments.fromMatch);
  }

  async getCompetitionAssignment(id: number): Promise<CompetitionAssignment | undefined> {
    const [row] = await db.select().from(competitionAssignments).where(eq(competitionAssignments.id, id));
    return row;
  }

  async createCompetitionAssignment(assignment: InsertCompetitionAssignment): Promise<CompetitionAssignment> {
    const [row] = await db.insert(competitionAssignments).values(assignment).returning();
    return row;
  }

  async updateCompetitionAssignment(id: number, assignment: Partial<InsertCompetitionAssignment>): Promise<CompetitionAssignment | undefined> {
    const sanitized: any = { ...assignment, updatedAt: new Date() };
    delete sanitized.id;
    const [row] = await db.update(competitionAssignments).set(sanitized).where(eq(competitionAssignments.id, id)).returning();
    return row;
  }

  async deleteCompetitionAssignment(id: number): Promise<void> {
    await db.delete(competitionAssignments).where(eq(competitionAssignments.id, id));
  }

  async getEventInfo(eventId: number): Promise<EventInfo | undefined> {
    const [row] = await db.select().from(eventInfo).where(eq(eventInfo.eventId, eventId));
    return row;
  }

  async upsertEventInfo(eventId: number, data: Partial<InsertEventInfo>): Promise<EventInfo> {
    const existing = await this.getEventInfo(eventId);
    const sanitized: any = { ...data, eventId, updatedAt: new Date() };
    delete sanitized.id;
    if (existing) {
      const [row] = await db.update(eventInfo).set(sanitized).where(eq(eventInfo.eventId, eventId)).returning();
      return row;
    } else {
      const [row] = await db.insert(eventInfo).values({ ...sanitized, eventId }).returning();
      return row;
    }
  }

  async deleteEventInfo(eventId: number): Promise<void> {
    await db.delete(eventInfo).where(eq(eventInfo.eventId, eventId));
  }

  async getCompetitionCheckins(eventId: number): Promise<CompetitionCheckin[]> {
    return db.select().from(competitionCheckins)
      .where(eq(competitionCheckins.eventId, eventId))
      .orderBy(desc(competitionCheckins.checkInAt));
  }

  async getCompetitionCheckinsByUser(userId: number): Promise<CompetitionCheckin[]> {
    return db.select().from(competitionCheckins)
      .where(eq(competitionCheckins.userId, userId))
      .orderBy(desc(competitionCheckins.checkInAt));
  }

  async getAllCompetitionCheckins(): Promise<CompetitionCheckin[]> {
    return db.select().from(competitionCheckins).orderBy(desc(competitionCheckins.checkInAt));
  }

  async getCompetitionCheckinById(id: number): Promise<CompetitionCheckin | undefined> {
    const [row] = await db.select().from(competitionCheckins).where(eq(competitionCheckins.id, id));
    return row;
  }

  async getOpenCompetitionCheckin(userId: number, eventId: number): Promise<CompetitionCheckin | undefined> {
    const results = await db.select().from(competitionCheckins)
      .where(and(
        eq(competitionCheckins.userId, userId),
        eq(competitionCheckins.eventId, eventId),
        isNull(competitionCheckins.checkOutAt)
      ));
    return results[0];
  }

  async createCompetitionCheckin(checkin: InsertCompetitionCheckin): Promise<CompetitionCheckin> {
    const sanitized: any = { ...checkin };
    if (sanitized.checkInAt && !(sanitized.checkInAt instanceof Date)) sanitized.checkInAt = new Date(sanitized.checkInAt);
    const [row] = await db.insert(competitionCheckins).values(sanitized).returning();
    return row;
  }

  async updateCompetitionCheckin(id: number, checkin: Partial<InsertCompetitionCheckin>): Promise<CompetitionCheckin | undefined> {
    const sanitized: any = { ...checkin };
    delete sanitized.id;
    if (sanitized.checkInAt && !(sanitized.checkInAt instanceof Date)) sanitized.checkInAt = new Date(sanitized.checkInAt);
    if (sanitized.checkOutAt && !(sanitized.checkOutAt instanceof Date)) sanitized.checkOutAt = new Date(sanitized.checkOutAt);
    if (sanitized.approvedAt && !(sanitized.approvedAt instanceof Date)) sanitized.approvedAt = new Date(sanitized.approvedAt);
    const [row] = await db.update(competitionCheckins).set(sanitized).where(eq(competitionCheckins.id, id)).returning();
    return row;
  }

  async deleteCompetitionCheckin(id: number): Promise<void> {
    await db.delete(competitionCheckins).where(eq(competitionCheckins.id, id));
  }

  async getCompetitionCheckinAudit(checkinId: number): Promise<(CompetitionCheckinAudit & { actorName: string })[]> {
    const rows = await db.select({
      id: competitionCheckinAudit.id,
      checkinId: competitionCheckinAudit.checkinId,
      actorId: competitionCheckinAudit.actorId,
      actionType: competitionCheckinAudit.actionType,
      previousValues: competitionCheckinAudit.previousValues,
      newValues: competitionCheckinAudit.newValues,
      createdAt: competitionCheckinAudit.createdAt,
      actorName: users.name,
    })
      .from(competitionCheckinAudit)
      .leftJoin(users, eq(competitionCheckinAudit.actorId, users.id))
      .where(eq(competitionCheckinAudit.checkinId, checkinId))
      .orderBy(desc(competitionCheckinAudit.createdAt));
    return rows.map(r => ({ ...r, actorName: r.actorName || `User #${r.actorId}` }));
  }

  async getCompetitionEventAudit(eventCheckinIds: number[]): Promise<CompetitionCheckinAudit[]> {
    if (eventCheckinIds.length === 0) return [];
    return db.select().from(competitionCheckinAudit)
      .orderBy(desc(competitionCheckinAudit.createdAt));
  }

  async createCompetitionCheckinAudit(audit: InsertCompetitionCheckinAudit): Promise<CompetitionCheckinAudit> {
    const [row] = await db.insert(competitionCheckinAudit).values(audit).returning();
    return row;
  }

  async getFullscreenAlerts(activeOnly = false): Promise<FullscreenAlert[]> {
    if (activeOnly) {
      return db.select().from(fullscreenAlerts)
        .where(eq(fullscreenAlerts.active, true))
        .orderBy(desc(fullscreenAlerts.createdAt));
    }
    return db.select().from(fullscreenAlerts).orderBy(desc(fullscreenAlerts.createdAt));
  }

  async getFullscreenAlert(id: number): Promise<FullscreenAlert | undefined> {
    const [row] = await db.select().from(fullscreenAlerts).where(eq(fullscreenAlerts.id, id));
    return row;
  }

  async createFullscreenAlert(alert: InsertFullscreenAlert): Promise<FullscreenAlert> {
    const sanitized: any = { ...alert };
    if (sanitized.expiresAt && !(sanitized.expiresAt instanceof Date)) sanitized.expiresAt = new Date(sanitized.expiresAt);
    const [row] = await db.insert(fullscreenAlerts).values(sanitized).returning();
    return row;
  }

  async updateFullscreenAlert(id: number, alert: Partial<InsertFullscreenAlert>): Promise<FullscreenAlert | undefined> {
    const sanitized: any = { ...alert };
    delete sanitized.id;
    if (sanitized.expiresAt && !(sanitized.expiresAt instanceof Date)) sanitized.expiresAt = new Date(sanitized.expiresAt);
    const [row] = await db.update(fullscreenAlerts).set(sanitized).where(eq(fullscreenAlerts.id, id)).returning();
    return row;
  }

  async deleteFullscreenAlert(id: number): Promise<void> {
    await db.delete(fullscreenAlerts).where(eq(fullscreenAlerts.id, id));
  }

  async getTeamClaims(eventId: number): Promise<TeamClaim[]> {
    const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await db.delete(teamClaims).where(and(eq(teamClaims.eventId, eventId), lt(teamClaims.claimedAt, cutoff)));
    return db.select().from(teamClaims).where(eq(teamClaims.eventId, eventId));
  }

  async upsertTeamClaim(data: { eventId: number; matchKey: string; teamNumber: number; userId: number; userName: string }): Promise<TeamClaim> {
    await db.delete(teamClaims).where(
      and(
        eq(teamClaims.eventId, data.eventId),
        eq(teamClaims.matchKey, data.matchKey),
        eq(teamClaims.teamNumber, data.teamNumber)
      )
    );
    const [row] = await db.insert(teamClaims).values({ ...data, claimedAt: new Date() }).returning();
    return row;
  }

  async deleteTeamClaim(eventId: number, matchKey: string, teamNumber: number, userId: number): Promise<void> {
    await db.delete(teamClaims).where(
      and(
        eq(teamClaims.eventId, eventId),
        eq(teamClaims.matchKey, matchKey),
        eq(teamClaims.teamNumber, teamNumber),
        eq(teamClaims.userId, userId)
      )
    );
  }

  async getCertifications(): Promise<any[]> {
    const certs = await db.select().from(certifications)
      .orderBy(certifications.department, certifications.level, certifications.name);
    if (certs.length === 0) return [];
    const allUserCerts = await db.select({
      certId: userCertifications.certificationId,
    }).from(userCertifications);
    const certifiedCount: Record<number, number> = {};
    for (const uc of allUserCerts) {
      certifiedCount[uc.certId] = (certifiedCount[uc.certId] || 0) + 1;
    }
    // Trainer count is now driven by explicit scopes rather than "holds the
    // cert and carries the role" — a coach-appointed trainer need not hold the
    // certification themselves. One scope row per (user, department), so this
    // list is small enough to match in JS.
    const scopes = await db.select().from(trainerScopes);
    const trainerCount: Record<number, number> = {};
    for (const c of certs) {
      trainerCount[c.id] = scopes.filter(
        sc => sameDepartment(sc.department, c.department) && sc.maxLevel >= c.level,
      ).length;
    }
    return certs.map(c => ({
      ...c,
      certifiedCount: certifiedCount[c.id] || 0,
      trainerCount: trainerCount[c.id] || 0,
    }));
  }

  async getCertification(id: number): Promise<Certification | undefined> {
    const [row] = await db.select().from(certifications).where(eq(certifications.id, id));
    return row;
  }

  async createCertification(data: InsertCertification): Promise<Certification> {
    const [row] = await db.insert(certifications).values(data).returning();
    return row;
  }

  async updateCertification(id: number, data: Partial<InsertCertification>): Promise<Certification | undefined> {
    const sanitized: any = { ...data };
    delete sanitized.id;
    delete sanitized.createdAt;
    const [row] = await db.update(certifications).set(sanitized).where(eq(certifications.id, id)).returning();
    return row;
  }

  async deleteCertification(id: number): Promise<void> {
    await db.delete(certifications).where(eq(certifications.id, id));
  }

  async getUserCertifications(userId: number): Promise<any[]> {
    const rows = await db.select({
      id: userCertifications.id,
      userId: userCertifications.userId,
      certificationId: userCertifications.certificationId,
      grantedBy: userCertifications.grantedBy,
      grantedAt: userCertifications.grantedAt,
      certName: certifications.name,
      certEquipment: certifications.equipment,
      certDescription: certifications.description,
    }).from(userCertifications)
      .innerJoin(certifications, eq(userCertifications.certificationId, certifications.id))
      .where(eq(userCertifications.userId, userId))
      .orderBy(desc(userCertifications.grantedAt));
    const grantorIds = [...new Set(rows.map(r => r.grantedBy))];
    const grantors = grantorIds.length > 0
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, grantorIds))
      : [];
    const grantorMap: Record<number, string> = {};
    for (const g of grantors) grantorMap[g.id] = g.name;
    return rows.map(r => ({ ...r, grantedByName: grantorMap[r.grantedBy] || `User #${r.grantedBy}` }));
  }

  /**
   * Grant a certification, and record any level badge it completes.
   *
   * This is the single choke point for handing out a certification — request
   * completion, a direct coach grant, and the migration backfill all land here
   * — so the badge check lives here rather than in any one caller.
   *
   * The `FOR UPDATE` on the user row is load-bearing, not decorative. Under
   * READ COMMITTED, two trainers completing the last two certifications of a
   * level at the same moment would each fail to see the other's uncommitted
   * insert, both conclude "not all held", and the badge would never be awarded
   * at all. Duplicates are impossible either way (user_badges is uniquely
   * indexed), so the silent no-award is the failure mode worth locking against.
   * Locking the user row serializes grants for one student and contends with
   * nothing else.
   */
  async grantCertification(userId: number, certId: number, grantedBy: number): Promise<UserCertification> {
    const { row } = await this.grantCertificationWithBadges(userId, certId, grantedBy);
    return row;
  }

  async grantCertificationWithBadges(
    userId: number,
    certId: number,
    grantedBy: number,
  ): Promise<{ row: UserCertification; newBadges: EarnedLevelBadge[] }> {
    return db.transaction(async (tx) => this.grantCertificationTx(tx, userId, certId, grantedBy));
  }

  /**
   * The transaction-scoped grant. Callers that already hold a transaction
   * (completeCertRequest) MUST use this rather than the public wrapper —
   * `db.transaction` inside a transaction takes a second pooled connection,
   * which both breaks atomicity and can deadlock against the `FOR UPDATE`
   * below.
   */
  private async grantCertificationTx(
    tx: any,
    userId: number,
    certId: number,
    grantedBy: number,
  ): Promise<{ row: UserCertification; newBadges: EarnedLevelBadge[] }> {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);

    const [inserted] = await tx.insert(userCertifications)
      .values({ userId, certificationId: certId, grantedBy, grantedAt: new Date() })
      .onConflictDoNothing()
      .returning();
    if (!inserted) {
      // Already held — idempotent, and nothing can have newly completed.
      const [existing] = await tx.select().from(userCertifications)
        .where(and(eq(userCertifications.userId, userId), eq(userCertifications.certificationId, certId)));
      return { row: existing, newBadges: [] };
    }

    const newBadges = await this.awardLevelBadgesTx(tx, userId);
    return { row: inserted, newBadges };
  }

  /**
   * Record every level badge this user has newly completed. Returns only what
   * was actually inserted, so callers can notify on it.
   *
   * `newlyEarnedLevelBadges` only ever returns additions — a badge is never
   * recomputed away here — which is what makes this safe to run on every grant.
   */
  private async awardLevelBadgesTx(tx: any, userId: number): Promise<EarnedLevelBadge[]> {
    const allCerts = await tx.select({
      id: certifications.id,
      department: certifications.department,
      level: certifications.level,
    }).from(certifications);
    const heldRows = await tx.select({ id: userCertifications.certificationId })
      .from(userCertifications).where(eq(userCertifications.userId, userId));
    const earnedRows = await tx.select({
      department: userBadges.department,
      level: userBadges.level,
    }).from(userBadges).where(and(eq(userBadges.userId, userId), eq(userBadges.kind, 'level')));

    const held = new Set<number>(heldRows.map((r: any) => r.id));
    const earned = earnedRows.map((r: any) => ({ department: r.department, level: r.level })) as EarnedLevelBadge[];
    const pending = newlyEarnedLevelBadges(allCerts as any[], held, earned);

    const awarded: EarnedLevelBadge[] = [];
    for (const badge of pending) {
      const [row] = await tx.insert(userBadges).values({
        userId,
        kind: 'level',
        department: badge.department,
        level: badge.level,
        awardedBy: null, // automatic
        earnedAt: new Date(),
      }).onConflictDoNothing().returning();
      if (row) awarded.push(badge);
    }
    return awarded;
  }

  /**
   * Revoke a certification, and drop the level badge for that certification's
   * own level if the user no longer holds every cert in it.
   *
   * Deliberately NOT symmetric with "adding a cert to a level later never
   * strips a badge". Adding a cert raises the standard after the fact; a
   * revocation is an explicit statement that this person is no longer
   * qualified. Leaving the badge would also leave their higher levels
   * unlocked, because the level gate reads badge rows — in a system that
   * governs power-tool authorization that is a safety hole, not a cosmetic
   * one. Higher badges are left alone (those levels were genuinely completed),
   * but `isLevelUnlocked` checks every lower level, so the lock still
   * propagates upward.
   */
  async revokeCertification(userId: number, certId: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
      const [cert] = await tx.select({
        department: certifications.department,
        level: certifications.level,
      }).from(certifications).where(eq(certifications.id, certId));

      await tx.delete(userCertifications).where(
        and(eq(userCertifications.userId, userId), eq(userCertifications.certificationId, certId))
      );
      if (!cert) return;

      const remaining = await tx.select({ id: certifications.id })
        .from(certifications)
        .innerJoin(userCertifications, eq(userCertifications.certificationId, certifications.id))
        .where(and(
          eq(userCertifications.userId, userId),
          eq(certifications.level, cert.level),
          sql`coalesce(${certifications.department}, '') = coalesce(${cert.department}, '')`,
        ));
      const inLevel = await tx.select({ id: certifications.id })
        .from(certifications)
        .where(and(
          eq(certifications.level, cert.level),
          sql`coalesce(${certifications.department}, '') = coalesce(${cert.department}, '')`,
        ));

      if (remaining.length < inLevel.length) {
        await tx.delete(userBadges).where(and(
          eq(userBadges.userId, userId),
          eq(userBadges.kind, 'level'),
          eq(userBadges.level, cert.level),
          sql`coalesce(${userBadges.department}, '') = coalesce(${cert.department}, '')`,
        ));
      }
    });
  }

  async getCertifiedUsers(certId: number): Promise<any[]> {
    const rows = await db.select({
      // `id` is the USER id — the UI revokes and compares against it. The
      // join-row id is exposed separately as `userCertificationId`.
      id: users.id,
      userCertificationId: userCertifications.id,
      userId: userCertifications.userId,
      name: users.name,
      username: users.username,
      certificationId: userCertifications.certificationId,
      grantedBy: userCertifications.grantedBy,
      grantedAt: userCertifications.grantedAt,
      userName: users.name,
      userUsername: users.username,
      userRoles: users.roles,
    }).from(userCertifications)
      .innerJoin(users, eq(userCertifications.userId, users.id))
      .where(eq(userCertifications.certificationId, certId))
      .orderBy(desc(userCertifications.grantedAt));
    const grantorIds = [...new Set(rows.map(r => r.grantedBy))];
    const grantors = grantorIds.length > 0
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, grantorIds))
      : [];
    const grantorMap: Record<number, string> = {};
    for (const g of grantors) grantorMap[g.id] = g.name;
    return rows.map(r => ({
      ...r,
      grantedByName: grantorMap[r.grantedBy] || `User #${r.grantedBy}`,
    }));
  }

  /**
   * Who may train this certification.
   *
   * No longer "holds the cert and carries the Trainer role" — authority is now
   * an explicit `trainer_scopes` row covering the cert's department at or above
   * its level. A coach-appointed trainer need not hold the certification.
   * Coaches bypass scopes entirely and are unioned in.
   */
  async getTrainersForCert(certId: number): Promise<any[]> {
    const [cert] = await db.select({
      department: certifications.department,
      level: certifications.level,
    }).from(certifications).where(eq(certifications.id, certId));
    if (!cert) return [];

    const scoped = await db.select({
      id: users.id,
      name: users.name,
      username: users.username,
      roles: users.roles,
      department: trainerScopes.department,
      maxLevel: trainerScopes.maxLevel,
    }).from(trainerScopes)
      .innerJoin(users, eq(trainerScopes.userId, users.id))
      .where(and(
        sql`coalesce(${trainerScopes.department}, '') = coalesce(${cert.department}, '')`,
        sql`${trainerScopes.maxLevel} >= ${cert.level}`,
      ));

    const coaches = await db.select({
      id: users.id,
      name: users.name,
      username: users.username,
      roles: users.roles,
    }).from(users).where(sql`${users.roles} @> '["Coach"]'::jsonb`);

    const seen = new Set<number>();
    const out: any[] = [];
    for (const row of [...scoped, ...coaches]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ ...row, userId: row.id, userName: row.name, userUsername: row.username });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async createCertRequest(userId: number, certId: number): Promise<CertificationRequest> {
    const existing = await db.select().from(certificationRequests).where(
      and(
        eq(certificationRequests.userId, userId),
        eq(certificationRequests.certificationId, certId),
        eq(certificationRequests.status, 'pending')
      )
    );
    if (existing.length > 0) return existing[0];
    const inProgress = await db.select().from(certificationRequests).where(
      and(
        eq(certificationRequests.userId, userId),
        eq(certificationRequests.certificationId, certId),
        eq(certificationRequests.status, 'in_progress')
      )
    );
    if (inProgress.length > 0) return inProgress[0];
    const [row] = await db.insert(certificationRequests).values({
      userId,
      certificationId: certId,
      status: 'pending',
      requestedAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return row;
  }

  /**
   * Certification requests, filtered in SQL rather than in JS. `scope` narrows
   * a trainer's queue to the (department, level) sets they're authorized for;
   * omit it (or pass `bypass`) for coaches and for a student's own rows.
   */
  async getCertRequests(filters: {
    userId?: number;
    statuses?: string[];
    scope?: { bypass: boolean; scopes: { department: string | null; maxLevel: number }[] };
  }): Promise<any[]> {
    const conditions: any[] = [];
    if (filters.userId !== undefined) {
      conditions.push(eq(certificationRequests.userId, filters.userId));
    }
    if (filters.statuses && filters.statuses.length > 0) {
      conditions.push(inArray(certificationRequests.status, filters.statuses));
    }

    let rows = await db.select({
      id: certificationRequests.id,
      userId: certificationRequests.userId,
      certificationId: certificationRequests.certificationId,
      status: certificationRequests.status,
      trainerId: certificationRequests.trainerId,
      checklistProgress: certificationRequests.checklistProgress,
      notes: certificationRequests.notes,
      requestedAt: certificationRequests.requestedAt,
      updatedAt: certificationRequests.updatedAt,
      userName: users.name,
      userUsername: users.username,
      certName: certifications.name,
      certEquipment: certifications.equipment,
      certChecklistItems: certifications.checklistItems,
      certSafetyGuide: certifications.safetyGuide,
      certDepartment: certifications.department,
      certLevel: certifications.level,
      certLinks: certifications.links,
    }).from(certificationRequests)
      .innerJoin(users, eq(certificationRequests.userId, users.id))
      .innerJoin(certifications, eq(certificationRequests.certificationId, certifications.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(certificationRequests.requestedAt));

    // Scope matching stays in JS: a scope list is at most one row per
    // department, so this is a handful of comparisons per request.
    if (filters.scope && !filters.scope.bypass) {
      const scopes = filters.scope.scopes;
      rows = rows.filter(r => scopes.some(
        sc => sameDepartment(sc.department, r.certDepartment) && sc.maxLevel >= r.certLevel,
      ));
    }

    const trainerIds = [...new Set(rows.map(r => r.trainerId).filter((id): id is number => id !== null))];
    const trainerUsers = trainerIds.length > 0
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, trainerIds))
      : [];
    const trainerMap: Record<number, string> = {};
    for (const t of trainerUsers) trainerMap[t.id] = t.name;
    return rows.map(r => ({
      ...r,
      trainerName: r.trainerId ? (trainerMap[r.trainerId] || `User #${r.trainerId}`) : null,
      certification: {
        id: r.certificationId,
        name: r.certName,
        equipment: r.certEquipment,
        checklistItems: r.certChecklistItems || [],
        safetyGuide: r.certSafetyGuide || '',
        department: r.certDepartment,
        level: r.certLevel,
        links: r.certLinks || [],
      },
    }));
  }

  /** One request with its certification's department/level, for scope checks. */
  async getCertRequestDetail(requestId: number): Promise<any | undefined> {
    const [row] = await db.select({
      id: certificationRequests.id,
      userId: certificationRequests.userId,
      certificationId: certificationRequests.certificationId,
      status: certificationRequests.status,
      trainerId: certificationRequests.trainerId,
      certName: certifications.name,
      certDepartment: certifications.department,
      certLevel: certifications.level,
    }).from(certificationRequests)
      .innerJoin(certifications, eq(certificationRequests.certificationId, certifications.id))
      .where(eq(certificationRequests.id, requestId));
    return row;
  }

  async claimCertRequest(requestId: number, trainerId: number): Promise<CertificationRequest | undefined> {
    const [row] = await db.update(certificationRequests)
      .set({ trainerId, status: 'in_progress', updatedAt: new Date() })
      .where(and(eq(certificationRequests.id, requestId), eq(certificationRequests.status, 'pending')))
      .returning();
    return row;
  }

  async updateCertRequestProgress(requestId: number, checklistProgress: { item: string; completed: boolean }[], notes?: string): Promise<CertificationRequest | undefined> {
    const updateData: any = { checklistProgress, updatedAt: new Date() };
    if (notes !== undefined) updateData.notes = notes;
    const [row] = await db.update(certificationRequests)
      .set(updateData)
      .where(eq(certificationRequests.id, requestId))
      .returning();
    return row;
  }

  /**
   * Complete a request: flip it to `completed` and grant the certification, in
   * ONE transaction. Previously these were two statements, so a failing grant
   * left a `completed` request with no certification and no retry path — and
   * badge awards widen that window further.
   */
  async completeCertRequest(
    requestId: number,
    trainerId: number,
  ): Promise<(CertificationRequest & { newBadges?: EarnedLevelBadge[] }) | undefined> {
    return db.transaction(async (tx) => {
      const [req] = await tx.select().from(certificationRequests).where(eq(certificationRequests.id, requestId));
      if (!req) return undefined;
      const [row] = await tx.update(certificationRequests)
        .set({ status: 'completed', trainerId, updatedAt: new Date() })
        .where(eq(certificationRequests.id, requestId))
        .returning();
      if (!row) return undefined;
      const { newBadges } = await this.grantCertificationTx(tx, req.userId, req.certificationId, trainerId);
      return { ...row, newBadges };
    });
  }

  async rejectCertRequest(requestId: number, trainerId: number, notes?: string): Promise<CertificationRequest | undefined> {
    const updateData: any = { status: 'rejected', trainerId, updatedAt: new Date() };
    if (notes !== undefined) updateData.notes = notes;
    const [row] = await db.update(certificationRequests)
      .set(updateData)
      .where(eq(certificationRequests.id, requestId))
      .returning();
    return row;
  }

  // --- Trainer scopes -------------------------------------------------------

  async getTrainerScopes(userId?: number): Promise<TrainerScope[]> {
    if (userId !== undefined) {
      return db.select().from(trainerScopes).where(eq(trainerScopes.userId, userId));
    }
    return db.select().from(trainerScopes).orderBy(trainerScopes.userId, trainerScopes.department);
  }

  /** All scopes joined to the holder's name, for the Control Panel list. */
  async getTrainerScopesWithUsers(): Promise<any[]> {
    return db.select({
      id: trainerScopes.id,
      userId: trainerScopes.userId,
      department: trainerScopes.department,
      maxLevel: trainerScopes.maxLevel,
      createdAt: trainerScopes.createdAt,
      userName: users.name,
      userUsername: users.username,
    }).from(trainerScopes)
      .innerJoin(users, eq(trainerScopes.userId, users.id))
      .orderBy(users.name, trainerScopes.department);
  }

  /**
   * Replace a user's entire scope set in one transaction. Whole-set replace
   * rather than per-row add/remove mirrors how the Control Panel edits roles
   * and departments, and avoids the client juggling row ids.
   */
  async setTrainerScopes(
    userId: number,
    scopes: { department: string | null; maxLevel: number }[],
    createdBy: number,
  ): Promise<TrainerScope[]> {
    return db.transaction(async (tx) => {
      await tx.delete(trainerScopes).where(eq(trainerScopes.userId, userId));
      if (scopes.length === 0) return [];
      const rows = await tx.insert(trainerScopes).values(
        scopes.map(sc => ({
          userId,
          department: sc.department,
          maxLevel: normalizeLevel(sc.maxLevel),
          createdBy,
        })),
      ).returning();
      return rows;
    });
  }

  // --- Badges ---------------------------------------------------------------

  async getBadgeDefinitions(includeArchived = false): Promise<BadgeDefinition[]> {
    if (includeArchived) {
      return db.select().from(badgeDefinitions).orderBy(badgeDefinitions.name);
    }
    return db.select().from(badgeDefinitions)
      .where(eq(badgeDefinitions.archived, false))
      .orderBy(badgeDefinitions.name);
  }

  async createBadgeDefinition(data: InsertBadgeDefinition): Promise<BadgeDefinition> {
    const [row] = await db.insert(badgeDefinitions).values(data).returning();
    return row;
  }

  async updateBadgeDefinition(id: number, data: Partial<InsertBadgeDefinition>): Promise<BadgeDefinition | undefined> {
    const { id: _ignored, createdAt: _ignoredAt, ...sanitized } = data as any;
    const [row] = await db.update(badgeDefinitions).set(sanitized)
      .where(eq(badgeDefinitions.id, id)).returning();
    return row;
  }

  /** Archive rather than delete, so already-awarded badges never dangle. */
  async deleteBadgeDefinition(id: number): Promise<void> {
    await db.update(badgeDefinitions).set({ archived: true }).where(eq(badgeDefinitions.id, id));
  }

  async getUserBadges(userId?: number): Promise<UserBadge[]> {
    if (userId !== undefined) {
      return db.select().from(userBadges).where(eq(userBadges.userId, userId))
        .orderBy(desc(userBadges.earnedAt));
    }
    return db.select().from(userBadges).orderBy(desc(userBadges.earnedAt));
  }

  async awardCustomBadge(
    userId: number,
    badgeDefinitionId: number,
    awardedBy: number,
    note?: string,
  ): Promise<UserBadge | undefined> {
    const [row] = await db.insert(userBadges).values({
      userId,
      kind: 'custom',
      badgeDefinitionId,
      awardedBy,
      note: note ?? null,
      earnedAt: new Date(),
    }).onConflictDoNothing().returning();
    if (row) return row;
    const [existing] = await db.select().from(userBadges).where(and(
      eq(userBadges.userId, userId),
      eq(userBadges.kind, 'custom'),
      eq(userBadges.badgeDefinitionId, badgeDefinitionId),
    ));
    return existing;
  }

  async revokeBadge(userId: number, badgeId: number): Promise<void> {
    await db.delete(userBadges).where(and(eq(userBadges.id, badgeId), eq(userBadges.userId, userId)));
  }

  async getCalendarEvents(includeArchived = false): Promise<CalendarEvent[]> {
    if (includeArchived) {
      return db.select().from(calendarEvents).orderBy(calendarEvents.startDate);
    }
    return db.select().from(calendarEvents)
      .where(eq(calendarEvents.archived, false))
      .orderBy(calendarEvents.startDate);
  }

  async getCalendarEvent(id: number): Promise<CalendarEvent | undefined> {
    const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
    return row;
  }

  async createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent> {
    const sanitized: any = { ...data };
    delete sanitized.id;
    delete sanitized.createdAt;
    const [row] = await db.insert(calendarEvents).values(sanitized).returning();
    return row;
  }

  async updateCalendarEvent(id: number, data: Partial<InsertCalendarEvent>): Promise<CalendarEvent | undefined> {
    const sanitized: any = { ...data };
    delete sanitized.id;
    delete sanitized.createdAt;
    const [row] = await db.update(calendarEvents).set(sanitized).where(eq(calendarEvents.id, id)).returning();
    return row;
  }

  async deleteCalendarEvent(id: number): Promise<void> {
    await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
  }

  async ensureArchiveColumns(): Promise<void> {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`);
  }

  async ensureProjectLinksColumn(): Promise<void> {
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'`);
  }

  /**
   * Per-task stretches inside a clocked session (see the table's comment in
   * shared/schema.ts). Additive and idempotent — existing sessions simply have
   * no segments until their next task pick.
   */
  async ensureTaskSegments(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS time_entry_task_segments (
        id SERIAL PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        general_task_id INTEGER REFERENCES general_tasks(id) ON DELETE CASCADE,
        started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMPTZ,
        minutes INTEGER,
        assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS time_entry_task_segments_user_idx ON time_entry_task_segments (user_id, started_at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS time_entry_task_segments_entry_idx ON time_entry_task_segments (entry_id)`);
    // Backfill: every session that already recorded a task gets one segment
    // spanning the session, so history predating this table still shows up in
    // the productivity deep dive. Guarded on emptiness so it runs exactly once.
    const existing = await db.execute(sql`SELECT COUNT(*)::int AS count FROM time_entry_task_segments`);
    const alreadyBackfilled = Number(((existing as any).rows?.[0]?.count) ?? 1) > 0;
    if (!alreadyBackfilled) {
      await db.execute(sql`
        INSERT INTO time_entry_task_segments (entry_id, user_id, task_id, general_task_id, started_at, ended_at, minutes)
        SELECT e.id, e.user_id, e.working_on_task_id, e.working_on_general_task_id, e.check_in_at, e.check_out_at,
               CASE WHEN e.check_out_at IS NULL THEN NULL
                    ELSE GREATEST(0, (EXTRACT(EPOCH FROM (e.check_out_at - e.check_in_at)) / 60)::int) END
        FROM time_entries e
        WHERE e.working_on_task_id IS NOT NULL OR e.working_on_general_task_id IS NOT NULL
      `);
    }
  }

  /**
   * Certifications v2 — department + level + links on certifications, explicit
   * trainer scopes, and the badge tables. Idempotent; runs on every boot.
   *
   * The certifications table is NOT renamed. The Drizzle symbol is
   * `certifications` but the physical table stays `safety_certifications` —
   * see the comment in shared/schema.ts. Every statement here is additive.
   */
  async ensureCertificationLevelsAndBadges(): Promise<void> {
    await db.execute(sql`ALTER TABLE safety_certifications ADD COLUMN IF NOT EXISTS department TEXT`);
    await db.execute(sql`ALTER TABLE safety_certifications ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1`);
    await db.execute(sql`ALTER TABLE safety_certifications ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'`);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS safety_certifications_dept_level_idx
        ON safety_certifications (coalesce(department, ''), level)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trainer_scopes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        department TEXT,
        max_level INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // One scope per (user, department). `department IS NULL` means General, and
    // a plain UNIQUE treats every NULL as distinct, so key on the coalesced
    // expression instead. (UNIQUE NULLS NOT DISTINCT is PG15+; this works
    // everywhere.) Not expressible via Drizzle's uniqueIndex().
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS trainer_scopes_user_dept_uniq
        ON trainer_scopes (user_id, coalesce(department, ''))
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS badge_definitions (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT 'award',
        color TEXT NOT NULL DEFAULT '#dc2626',
        archived BOOLEAN NOT NULL DEFAULT false,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_badges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        badge_definition_id INTEGER REFERENCES badge_definitions(id) ON DELETE CASCADE,
        department TEXT,
        level INTEGER,
        awarded_by INTEGER REFERENCES users(id),
        note TEXT,
        earned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Partial unique indexes, one per kind — the two kinds key on different
    // columns, so a single constraint can't express both.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS user_badges_level_uniq
        ON user_badges (user_id, coalesce(department, ''), level) WHERE kind = 'level'
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS user_badges_custom_uniq
        ON user_badges (user_id, badge_definition_id) WHERE kind = 'custom'
    `);
  }

  /**
   * Transaction-scoped variant of `claimMigration`.
   *
   * `claimMigration` inserts the ledger row on the pooled `db`, OUTSIDE any
   * transaction — so if the migration body then throws, the key stays claimed
   * and the work is skipped forever. Claiming inside the same transaction as
   * the work makes the claim roll back with it.
   */
  async claimMigrationTx(tx: any, key: string): Promise<boolean> {
    const result = await tx.execute(sql`
      INSERT INTO schema_migrations (key) VALUES (${key})
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);
    return ((result as any).rows?.length ?? 0) > 0;
  }

  /**
   * Rename the 'Safety Trainer' role to 'Trainer', in team_settings.roles AND
   * in every users.roles array.
   *
   * Unlike departments, role renames have no propagation path — the Control
   * Panel just overwrites team_settings.roles and leaves users.roles stale —
   * so this has to do both halves itself. 'Safety Trainer' is not in
   * PROTECTED_ROLES, so a team may already have renamed or deleted it: both
   * statements are no-ops when the role is absent, and the users update dedupes
   * so a user who somehow holds both names ends up with one 'Trainer'.
   */
  async migrateTrainerRoleRename(): Promise<void> {
    await db.transaction(async (tx) => {
      if (!(await this.claimMigrationTx(tx, 'role-safety-trainer-to-trainer'))) return;

      // team_settings.roles :: [{name,tier}] — order preserved via ORDINALITY.
      await tx.execute(sql`
        UPDATE team_settings SET roles = (
          SELECT coalesce(jsonb_agg(
            CASE WHEN elem->>'name' = 'Safety Trainer'
                 THEN jsonb_set(elem, '{name}', '"Trainer"')
                 ELSE elem END
            ORDER BY ord), '[]'::jsonb)
          FROM jsonb_array_elements(team_settings.roles) WITH ORDINALITY AS t(elem, ord)
        )
        WHERE roles @> '[{"name":"Safety Trainer"}]'::jsonb
      `);

      // users.roles :: string[]. DISTINCT guards against a user holding both
      // names; Postgres requires ORDER BY to match the DISTINCT expression, so
      // the result sorts alphabetically. Harmless — roles render as an
      // unordered chip row.
      const res = await tx.execute(sql`
        UPDATE users SET roles = (
          SELECT coalesce(jsonb_agg(DISTINCT val ORDER BY val), '[]'::jsonb)
          FROM (
            SELECT CASE WHEN r = 'Safety Trainer' THEN 'Trainer' ELSE r END AS val
            FROM jsonb_array_elements_text(users.roles) AS r
          ) mapped
        )
        WHERE roles @> '["Safety Trainer"]'::jsonb
        RETURNING id
      `);
      console.log(`migrateTrainerRoleRename: updated ${(res as any).rows?.length ?? 0} users.`);
    });
  }

  /**
   * Seed explicit trainer scopes from the old implicit model.
   *
   * Removing the implicit rule would otherwise strand every current trainer
   * with no authority at all, so this is deliberately generous: one scope per
   * department in team_settings plus a General scope, all at the maximum level.
   * Coaches narrow them afterwards in the Control Panel.
   *
   * Must run AFTER migrateTrainerRoleRename. Matches both role names anyway,
   * in case the rename was already done by hand.
   */
  async seedTrainerScopes(): Promise<void> {
    await db.transaction(async (tx) => {
      if (!(await this.claimMigrationTx(tx, 'seed-trainer-scopes-from-roles'))) return;

      const [settings] = await tx.select().from(teamSettings);
      const departments = ((settings?.departments as { name: string }[] | undefined) ?? []).map(d => d.name);
      const trainers = await tx.select({ id: users.id }).from(users).where(
        sql`${users.roles} @> '["Trainer"]'::jsonb OR ${users.roles} @> '["Safety Trainer"]'::jsonb`,
      );
      if (trainers.length === 0) return;

      // Attribute the seeded rows to a Coach so created_by stays a real FK.
      const [coach] = await tx.select({ id: users.id }).from(users)
        .where(sql`${users.roles} @> '["Coach"]'::jsonb`).limit(1);
      const createdBy = coach?.id ?? trainers[0].id;

      const values: any[] = [];
      for (const t of trainers) {
        values.push({ userId: t.id, department: null, maxLevel: MAX_LEVEL, createdBy });
        for (const dept of departments) {
          values.push({ userId: t.id, department: dept, maxLevel: MAX_LEVEL, createdBy });
        }
      }
      const res = await tx.insert(trainerScopes).values(values).onConflictDoNothing().returning();
      console.log(`seedTrainerScopes: created ${res.length} scopes for ${trainers.length} trainers.`);
    });
  }

  /**
   * Award level badges to users who already held every certification in a
   * level before badges existed.
   *
   * `earned_at` is the date of the LAST certification in that set, so the
   * historical record reads truthfully instead of "migration day".
   *
   * On a pre-existing database every certification defaults to
   * (General, Lvl 1), so this awards a single General Lvl 1 badge to anyone
   * holding every cert — correct, and it re-sorts itself as coaches classify
   * the certs. Must run AFTER ensureCertificationLevelsAndBadges.
   */
  async backfillLevelBadges(): Promise<void> {
    await db.transaction(async (tx) => {
      if (!(await this.claimMigrationTx(tx, 'backfill-level-badges'))) return;
      const res = await tx.execute(sql`
        INSERT INTO user_badges (user_id, kind, department, level, awarded_by, earned_at)
        SELECT u.id, 'level', lv.department, lv.level, NULL,
               (SELECT MAX(uc2.granted_at)
                  FROM user_certifications uc2
                  JOIN safety_certifications c2 ON c2.id = uc2.certification_id
                 WHERE uc2.user_id = u.id
                   AND coalesce(c2.department, '') = coalesce(lv.department, '')
                   AND c2.level = lv.level)
        FROM users u
        CROSS JOIN (SELECT DISTINCT department, level FROM safety_certifications) lv
        WHERE EXISTS (
                SELECT 1 FROM safety_certifications c
                 WHERE coalesce(c.department, '') = coalesce(lv.department, '') AND c.level = lv.level)
          AND NOT EXISTS (
                SELECT 1 FROM safety_certifications c
                 WHERE coalesce(c.department, '') = coalesce(lv.department, '') AND c.level = lv.level
                   AND NOT EXISTS (
                         SELECT 1 FROM user_certifications uc
                          WHERE uc.user_id = u.id AND uc.certification_id = c.id))
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      console.log(`backfillLevelBadges: awarded ${(res as any).rows?.length ?? 0} badges.`);
    });
  }

  /**
   * Seasons + customizable scouting templates (Epic D). Idempotent: creates the
   * tables/columns, seeds a default active season with built-in templates that
   * mirror the legacy forms, assigns existing events to it, and backfills every
   * scout record's `data` blob from its legacy columns. Safe to run on boot.
   */
  async ensureScoutingSeasonsTables(): Promise<void> {
    // 1. Tables + columns (all additive; legacy columns kept intact).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS seasons (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        game_name TEXT NOT NULL DEFAULT '',
        year INTEGER,
        active BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS scouting_templates (
        id SERIAL PRIMARY KEY,
        season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        fields JSONB NOT NULL DEFAULT '[]',
        revision INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS scouting_templates_season_kind_unique
      ON scouting_templates (season_id, kind)
    `);
    await db.execute(sql`ALTER TABLE scout_events ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id)`);
    await db.execute(sql`ALTER TABLE pit_scouts ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES scouting_templates(id)`);
    await db.execute(sql`ALTER TABLE pit_scouts ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'`);
    await db.execute(sql`ALTER TABLE match_scouts ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES scouting_templates(id)`);
    await db.execute(sql`ALTER TABLE match_scouts ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'`);

    // 2. Default season (only if none exists).
    let [defaultSeason] = await db.select().from(seasons).limit(1);
    if (!defaultSeason) {
      const year = new Date().getFullYear();
      [defaultSeason] = await db.insert(seasons)
        .values({ name: String(year), gameName: "", year, active: true })
        .returning();
    }

    // 3. Built-in pit + match templates for the default season (idempotent via
    //    the unique (season_id, kind) index — insert only when missing).
    for (const kind of ["pit", "match"] as ScoutKind[]) {
      const existing = await db.select().from(scoutingTemplates)
        .where(and(eq(scoutingTemplates.seasonId, defaultSeason.id), eq(scoutingTemplates.kind, kind)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(scoutingTemplates).values({
          seasonId: defaultSeason.id,
          kind,
          name: BUILTIN_TEMPLATES[kind].name,
          fields: BUILTIN_TEMPLATES[kind].fields,
          revision: 1,
        });
      }
    }
    const [pitTemplate] = await db.select().from(scoutingTemplates)
      .where(and(eq(scoutingTemplates.seasonId, defaultSeason.id), eq(scoutingTemplates.kind, "pit"))).limit(1);
    const [matchTemplate] = await db.select().from(scoutingTemplates)
      .where(and(eq(scoutingTemplates.seasonId, defaultSeason.id), eq(scoutingTemplates.kind, "match"))).limit(1);

    // 4. Assign orphan events to the default season.
    await db.execute(sql`UPDATE scout_events SET season_id = ${defaultSeason.id} WHERE season_id IS NULL`);

    // 5. Backfill `data` + `template_id` on every scout record whose data blob
    //    is still empty. One-time; legacy columns are retained for safety.
    const pitRows = await db.select().from(pitScouts).where(sql`${pitScouts.data} = '{}'::jsonb`);
    for (const row of pitRows as any[]) {
      await db.update(pitScouts)
        .set({ data: dataFromLegacyRow("pit", row), templateId: row.templateId ?? pitTemplate?.id })
        .where(eq(pitScouts.id, row.id));
    }
    const matchRows = await db.select().from(matchScouts).where(sql`${matchScouts.data} = '{}'::jsonb`);
    for (const row of matchRows as any[]) {
      await db.update(matchScouts)
        .set({ data: dataFromLegacyRow("match", row), templateId: row.templateId ?? matchTemplate?.id })
        .where(eq(matchScouts.id, row.id));
    }
  }

  // A tiny applied-migrations ledger. The schema itself is maintained by the
  // idempotent ensure*/backfill* chain below (see replit.md) — those are safe
  // to re-run every boot because they re-derive state from a source of truth.
  // A few steps are NOT like that: they are one-shot DATA migrations, and
  // re-running them resurrects rows a coach deliberately deleted (this is
  // exactly what happened with competition check-ins — see
  // ensureCompetitionUnification below). Those claim a key here instead.
  async ensureSchemaMigrationsTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        key TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /** Atomically claim a one-shot migration. True = you own it, run it now.
   *  False = it has already run (possibly by another instance under
   *  autoscale, or in a prior boot) — do not run it again. */
  async claimMigration(key: string): Promise<boolean> {
    const result = await db.execute(sql`
      INSERT INTO schema_migrations (key) VALUES (${key})
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);
    return ((result as any).rows?.length ?? 0) > 0;
  }

  /** Record a migration as already applied, without running it — used to
   *  retire a step on databases where its effects are already present, so
   *  the very next boot after gating it doesn't run it "one last time". */
  async markMigrationApplied(key: string): Promise<void> {
    await db.execute(sql`INSERT INTO schema_migrations (key) VALUES (${key}) ON CONFLICT DO NOTHING`);
  }

  async migrateApiKeyColumns(): Promise<void> {
    await db.execute(sql`ALTER TABLE team_settings ADD COLUMN IF NOT EXISTS tba_api_key TEXT`);
    await db.execute(sql`ALTER TABLE team_settings ADD COLUMN IF NOT EXISTS toa_api_key TEXT`);
    await db.execute(sql`ALTER TABLE team_settings ADD COLUMN IF NOT EXISTS nexus_api_key TEXT`);
  }

  async ensureTeamTimezoneColumn(): Promise<void> {
    await db.execute(sql`ALTER TABLE team_settings ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'`);
  }

  async ensurePushSubscriptionsTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async ensureEventParticipationTables(): Promise<void> {
    await db.execute(sql`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS signup_enabled BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS capacity INTEGER`);
    await db.execute(sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'shop'`);
    await db.execute(sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS calendar_event_id INTEGER REFERENCES calendar_events(id) ON DELETE SET NULL`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS event_signups (
        id SERIAL PRIMARY KEY,
        calendar_event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'requested',
        approved_by INTEGER REFERENCES users(id),
        approved_at TIMESTAMPTZ,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (calendar_event_id, user_id)
      )
    `);
  }

  /**
   * Unify competition time onto the shared clock (`time_entries`). Historically
   * competition attendance was its own table (`competition_checkins`), keyed to
   * `scout_events` rather than `calendar_events`, so it never showed up in the
   * hours ledger, the Home team-hours card, or the "Who's Here" board. This
   * adds the `scout_event_id` column time_entries needs to carry competition
   * rows, then backfills every existing competition_checkins row across.
   *
   * The backfill INSERT is a ONE-SHOT data migration, gated by
   * schema_migrations — it must NOT re-run on every boot. It used to be
   * guarded only by a NOT EXISTS check against the destination, which sounds
   * idempotent but isn't: deleting or editing the derived time_entries row
   * (the normal way a coach clears a stale check-in) makes the NOT EXISTS
   * pass again, so the next republish resurrected it — permanently stuck
   * "checked in" competition rows that blocked clock-in forever. See
   * cleanupStuckCompetitionEntries for the one-time fix to existing bad data.
   * `competition_checkins` and its audit table are left in place, untouched
   * and unread, purely as a historical record — nothing after this reads them.
   */
  async ensureCompetitionUnification(): Promise<void> {
    await db.execute(sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS scout_event_id INTEGER REFERENCES scout_events(id) ON DELETE SET NULL`);

    const COMPETITION_UNIFICATION_KEY = 'competition_unification_backfill';

    // Any database that already holds a competition-linked time entry has had
    // this backfill applied before (under the old ungated code path). Retire
    // it there without running it again, so a row a coach already deleted
    // stays deleted on the very first boot of the gated version.
    await db.execute(sql`
      INSERT INTO schema_migrations (key)
      SELECT ${COMPETITION_UNIFICATION_KEY}
      WHERE EXISTS (SELECT 1 FROM time_entries WHERE scout_event_id IS NOT NULL)
      ON CONFLICT DO NOTHING
    `);

    if (!(await this.claimMigration(COMPETITION_UNIFICATION_KEY))) return;

    console.log('ensureCompetitionUnification: running one-time competition_checkins backfill…');
    await db.execute(sql`
      INSERT INTO time_entries (user_id, scout_event_id, kind, check_in_at, check_out_at, status, rounded_minutes, notes, check_out_confirmed_by, check_out_confirmed_at, created_at)
      SELECT
        c.user_id, c.event_id, 'competition', c.check_in_at, c.check_out_at,
        CASE c.status
          WHEN 'checked_in' THEN 'checked_in'
          WHEN 'pending_approval' THEN 'pending_check_out'
          WHEN 'approved' THEN 'completed'
          WHEN 'rejected' THEN 'rejected'
          ELSE c.status
        END,
        c.rounded_minutes, c.notes, c.approved_by, c.approved_at, c.created_at
      FROM competition_checkins c
      WHERE NOT EXISTS (
        SELECT 1 FROM time_entries t
        WHERE t.scout_event_id = c.event_id AND t.user_id = c.user_id AND t.check_in_at = c.check_in_at
      )
    `);
  }

  /**
   * One-shot cleanup for the resurrection bug above: competition check-ins
   * from before the team's 2026-06-01 year rollover that were never closed
   * out (open, non-completed) had no UI path to fix — TimeTracking.tsx only
   * lists events with endDate >= today, so a spring competition isn't even
   * selectable — and every republish put them back regardless. Deletes them
   * outright, plus their legacy competition_checkins source rows (so a
   * rollback to the ungated backfill can't re-derive them). Gated by
   * schema_migrations; the cutoff is embedded in the key so widening it later
   * requires a new key rather than silently re-running a broader delete.
   *
   * The predicate is `status <> 'completed'`, not `status = 'checked_in'`,
   * deliberately: the hours ledger counts only status='completed' rows with
   * roundedMinutes (hoursLedger.ts), so this is the exact complement on the
   * same column — the delete set and the ledger set are provably disjoint,
   * so no legitimate hours can be destroyed. It's also exactly
   * getOpenTimeEntry's blocking predicate, so it clears the whole stuck set
   * (legacy pending_approval/rejected rows block clock-in identically and
   * would otherwise be missed).
   */
  async cleanupStuckCompetitionEntries(): Promise<void> {
    const KEY = 'competition_stuck_cleanup_before_2026_06_01';
    if (!(await this.claimMigration(KEY))) return;

    const deleted = await db.execute(sql`
      DELETE FROM time_entries
      WHERE kind = 'competition'
        AND scout_event_id IS NOT NULL
        AND check_out_at IS NULL
        AND status <> 'completed'
        AND check_in_at < TIMESTAMPTZ '2026-06-01 00:00:00+00'
      RETURNING id, user_id, scout_event_id, check_in_at, status
    `);
    const rows = (deleted as any).rows ?? [];
    console.log(`cleanupStuckCompetitionEntries: removed ${rows.length} stuck competition time_entries.`);
    if (rows.length) console.log(JSON.stringify(rows));

    const legacy = await db.execute(sql`
      DELETE FROM competition_checkins
      WHERE check_out_at IS NULL
        AND status <> 'approved'
        AND check_in_at < TIMESTAMPTZ '2026-06-01 00:00:00+00'
      RETURNING id, user_id, event_id, check_in_at, status
    `);
    const legacyRows = (legacy as any).rows ?? [];
    console.log(`cleanupStuckCompetitionEntries: removed ${legacyRows.length} legacy competition_checkins rows.`);
    if (legacyRows.length) console.log(JSON.stringify(legacyRows));
  }

  /**
   * Structurally prevents a repeat of the resurrection bug: a competition
   * entry can't be duplicated for the same user/event/check-in instant.
   * Partial — ordinary shop/event time is unconstrained; two shop clock-ins
   * with an identical timestamp are legitimate. Not CONCURRENTLY: this runs
   * through db.execute, which uses the extended query protocol (implicit
   * transaction) and Postgres rejects CONCURRENTLY inside one; worse,
   * CONCURRENTLY fails *soft* on a conflict, leaving a permanently-invalid
   * index that IF NOT EXISTS would then skip forever. A plain create fails
   * loud instead. Also declared in shared/schema.ts (same name) so
   * `schema:push` never proposes dropping it.
   */
  async ensureCompetitionEntryUniqueIndex(): Promise<void> {
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS time_entries_competition_unique_idx
      ON time_entries (user_id, scout_event_id, check_in_at)
      WHERE scout_event_id IS NOT NULL
    `);
  }

  // Invite-only events (Epic — private events). A coach can mark an event
  // invite-only and pick specific invitees; visibility filtering happens in
  // server/services/eventVisibility.ts. Invites piggyback on event_signups
  // (status "invited") so the same roster the signup system already tracks
  // also carries invite state.
  async ensureInviteOnlyEvents(): Promise<void> {
    await db.execute(sql`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS invite_only BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE event_signups ADD COLUMN IF NOT EXISTS invited_by INTEGER REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE event_signups ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ`);
  }

  // --- Event invites ---

  /** All userIds invited (or otherwise on the roster) for an event. */
  async getEventInviteeIds(calendarEventId: number): Promise<number[]> {
    const rows = await db.select({ userId: eventSignups.userId }).from(eventSignups)
      .where(eq(eventSignups.calendarEventId, calendarEventId));
    return rows.map((r) => r.userId);
  }

  /** Bulk version of getEventInviteeIds — one query for many events, used when
   *  filtering a whole calendar list by visibility. */
  async getInviteeIdsForEvents(calendarEventIds: number[]): Promise<Record<number, number[]>> {
    if (calendarEventIds.length === 0) return {};
    const rows = await db.select({ calendarEventId: eventSignups.calendarEventId, userId: eventSignups.userId })
      .from(eventSignups)
      .where(inArray(eventSignups.calendarEventId, calendarEventIds));
    const byEvent: Record<number, number[]> = {};
    for (const r of rows) {
      (byEvent[r.calendarEventId] ||= []).push(r.userId);
    }
    return byEvent;
  }

  /**
   * Invite users to an event. Never downgrades an existing signup — someone
   * who already requested/accepted/declined keeps that status; only users
   * with no row (or an existing "invited" row) are touched.
   */
  async inviteUsersToEvent(calendarEventId: number, userIds: number[], invitedBy: number): Promise<void> {
    for (const userId of userIds) {
      const existing = await this.getEventSignup(calendarEventId, userId);
      if (existing) {
        if (existing.status === 'invited') {
          await db.update(eventSignups)
            .set({ invitedBy, invitedAt: new Date() })
            .where(eq(eventSignups.id, existing.id));
        }
        continue;
      }
      await db.insert(eventSignups).values({
        calendarEventId, userId, status: 'invited', invitedBy, invitedAt: new Date(),
      } as any);
    }
  }

  /** Remove an invite — only while it's still in "invited" status; never
   *  touches someone who has since requested/accepted/declined. */
  async uninviteUserFromEvent(calendarEventId: number, userId: number): Promise<void> {
    const existing = await this.getEventSignup(calendarEventId, userId);
    if (existing && existing.status === 'invited') {
      await db.delete(eventSignups).where(eq(eventSignups.id, existing.id));
    }
  }

  // Personal calendar subscription feed (webcal/ICS). One secret token per
  // user; "regenerating" just overwrites it, which is all it takes to
  // invalidate the old URL. See server/routes/calendarFeed.ts.
  async ensureCalendarFeedTokens(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private newFeedToken(): string {
    return crypto.randomBytes(24).toString("base64url");
  }

  /** Returns the user's existing feed token, minting one on first use. */
  async getOrCreateCalendarFeedToken(userId: number): Promise<string> {
    const [existing] = await db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.userId, userId));
    if (existing) return existing.token;
    const token = this.newFeedToken();
    await db.insert(calendarFeedTokens).values({ userId, token })
      // Race-safe: if another request minted one first, just re-read it below.
      .onConflictDoNothing({ target: calendarFeedTokens.userId });
    const [row] = await db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.userId, userId));
    return row?.token ?? token;
  }

  /** Overwrites the user's token, immediately invalidating any URL built from the old one. */
  async regenerateCalendarFeedToken(userId: number): Promise<string> {
    const token = this.newFeedToken();
    await db.insert(calendarFeedTokens).values({ userId, token })
      .onConflictDoUpdate({ target: calendarFeedTokens.userId, set: { token } });
    return token;
  }

  /** Resolves a feed token back to the owning user id, or undefined if it's unknown/revoked. */
  async getUserIdByFeedToken(token: string): Promise<number | undefined> {
    const [row] = await db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.token, token));
    return row?.userId;
  }

  // --- Event signups (roster) ---
  async getEventSignups(calendarEventId: number): Promise<EventSignup[]> {
    return db.select().from(eventSignups).where(eq(eventSignups.calendarEventId, calendarEventId));
  }
  async getEventSignup(calendarEventId: number, userId: number): Promise<EventSignup | undefined> {
    const [row] = await db.select().from(eventSignups)
      .where(and(eq(eventSignups.calendarEventId, calendarEventId), eq(eventSignups.userId, userId)));
    return row;
  }
  async getEventSignupById(id: number): Promise<EventSignup | undefined> {
    const [row] = await db.select().from(eventSignups).where(eq(eventSignups.id, id));
    return row;
  }
  async countAcceptedSignups(calendarEventId: number): Promise<number> {
    const rows = await db.select().from(eventSignups)
      .where(and(eq(eventSignups.calendarEventId, calendarEventId), eq(eventSignups.status, 'accepted')));
    return rows.length;
  }
  async upsertEventSignup(calendarEventId: number, userId: number, status: string): Promise<EventSignup> {
    const [row] = await db.insert(eventSignups)
      .values({ calendarEventId, userId, status })
      .onConflictDoUpdate({ target: [eventSignups.calendarEventId, eventSignups.userId], set: { status } })
      .returning();
    return row;
  }
  async setEventSignupStatus(id: number, status: string, approvedBy: number): Promise<EventSignup | undefined> {
    const [row] = await db.update(eventSignups)
      .set({ status, approvedBy, approvedAt: new Date() })
      .where(eq(eventSignups.id, id)).returning();
    return row;
  }
  async deleteEventSignup(calendarEventId: number, userId: number): Promise<void> {
    await db.delete(eventSignups)
      .where(and(eq(eventSignups.calendarEventId, calendarEventId), eq(eventSignups.userId, userId)));
  }
  async getUserSignups(userId: number): Promise<EventSignup[]> {
    return db.select().from(eventSignups).where(eq(eventSignups.userId, userId));
  }

  async ensureAttendanceColumns(): Promise<void> {
    await db.execute(sql`ALTER TABLE event_signups ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE event_signups ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ`);
    await db.execute(sql`ALTER TABLE event_signups ADD COLUMN IF NOT EXISTS checked_in_by INTEGER REFERENCES users(id)`);
  }

  async checkInSignup(signupId: number, coachId: number, time?: Date): Promise<EventSignup | undefined> {
    const [row] = await db.update(eventSignups)
      .set({ checkedInAt: time ?? new Date(), checkedInBy: coachId, checkedOutAt: null })
      .where(eq(eventSignups.id, signupId)).returning();
    return row;
  }

  async checkOutSignup(signupId: number, time?: Date): Promise<EventSignup | undefined> {
    const [row] = await db.update(eventSignups)
      .set({ checkedOutAt: time ?? new Date() })
      .where(eq(eventSignups.id, signupId)).returning();
    return row;
  }

  async editSignupAttendance(signupId: number, data: { checkedInAt?: Date | null; checkedOutAt?: Date | null }): Promise<EventSignup | undefined> {
    const [row] = await db.update(eventSignups)
      .set(data as any)
      .where(eq(eventSignups.id, signupId)).returning();
    return row;
  }

  async upsertAndCheckIn(eventId: number, userId: number, coachId: number, time?: Date): Promise<EventSignup> {
    const existing = await this.getEventSignup(eventId, userId);
    if (existing) {
      const [row] = await db.update(eventSignups)
        .set({ status: 'accepted', checkedInAt: time ?? new Date(), checkedInBy: coachId, checkedOutAt: null })
        .where(eq(eventSignups.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(eventSignups)
      .values({ calendarEventId: eventId, userId, status: 'accepted', checkedInAt: time ?? new Date(), checkedInBy: coachId })
      .returning();
    return row;
  }

  // Self-service check-in from the time clock: mark the student present on the
  // event roster the moment they clock in. Mirrors upsertAndCheckIn but records
  // the student as their own checker-in and never downgrades an existing status
  // (an accepted/waitlisted signup keeps its status; a walk-in is created as
  // 'accepted').
  async selfCheckInSignup(eventId: number, userId: number, time?: Date): Promise<EventSignup> {
    const at = time ?? new Date();
    const existing = await this.getEventSignup(eventId, userId);
    if (existing) {
      const [row] = await db.update(eventSignups)
        .set({ checkedInAt: at, checkedOutAt: null, checkedInBy: userId })
        .where(eq(eventSignups.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(eventSignups)
      .values({ calendarEventId: eventId, userId, status: 'accepted', checkedInAt: at, checkedInBy: userId })
      .returning();
    return row;
  }

  // Self-service check-out from the time clock: clear the roster's "here now"
  // state. No-op if there is no signup row for this (event, user).
  async selfCheckOutSignup(eventId: number, userId: number, time?: Date): Promise<EventSignup | undefined> {
    const existing = await this.getEventSignup(eventId, userId);
    if (!existing) return undefined;
    const [row] = await db.update(eventSignups)
      .set({ checkedOutAt: time ?? new Date() })
      .where(eq(eventSignups.id, existing.id)).returning();
    return row;
  }

  async ensureRequirementsAndFundraising(): Promise<void> {
    // Note: DDL DEFAULTs can't be parameterized, so the JSON is inlined as a
    // literal. It contains only double quotes (safe inside single-quoted SQL).
    const defaultReq = JSON.stringify({
      fundraising: { enabled: false, goalCents: 0 },
      hours: [
        { key: "total", label: "Total Hours", enabled: false, categories: [...HOUR_CATEGORIES], phases: [{ label: "Season", start: null, end: null, requiredMinutes: 0 }] },
        { key: "shop", label: "Shop Time", enabled: false, categories: ["shop"], phases: [{ label: "Season", start: null, end: null, requiredMinutes: 0 }] },
        { key: "outreach", label: "Outreach", enabled: false, categories: ["outreach"], phases: [{ label: "Season", start: null, end: null, requiredMinutes: 0 }] },
        { key: "volunteer", label: "Volunteer", enabled: false, categories: ["volunteer"], phases: [{ label: "Season", start: null, end: null, requiredMinutes: 0 }] },
      ],
    });
    await db.execute(sql.raw(`ALTER TABLE team_settings ADD COLUMN IF NOT EXISTS requirements JSONB NOT NULL DEFAULT '${defaultReq}'::jsonb`));
    await db.execute(sql.raw(`ALTER TABLE team_settings ADD COLUMN IF NOT EXISTS fundraising_categories JSONB NOT NULL DEFAULT '["Concessions","Farmers Market","Parent Night Out","Sponsorship","Other"]'::jsonb`));

    // Backfill: 'class' and 'fundraising' were added to HOUR_CATEGORIES after
    // some teams already had an hour requirement configured with "all
    // categories". Their saved `categories` array predates the two new
    // values, so it silently excludes them. Only touch a requirement whose
    // categories are exactly the pre-existing full set — a coach who chose a
    // narrower list meant it, and should not have categories added for them.
    // This list is intentionally a frozen historical snapshot, not a color
    // map — unlike UpcomingCard.tsx / TeamManagement.tsx, it must NOT be
    // updated when a new category is added, or the backfill's "was this the
    // old full set" check would misfire on new data.
    //
    // This only widens `h.categories` — deliberately not `phases[i].categories`
    // (see server/routes/requirements.ts: phaseCategories). A per-phase area
    // override is always an explicit coach choice, never an implicit "all
    // categories"; widening it here would silently change what a phase counts.
    const PRE_EXISTING_ALL: readonly string[] = ["shop", "competition", "meeting", "volunteer", "outreach", "other"];
    const settingsRows = await db.select().from(teamSettings);
    for (const row of settingsRows) {
      const req: any = (row as any).requirements;
      if (!req?.hours?.length) continue;
      let changed = false;
      const hours = req.hours.map((h: any) => {
        const cats: string[] = Array.isArray(h.categories) ? h.categories : [];
        const isPreExistingFullSet =
          cats.length === PRE_EXISTING_ALL.length && PRE_EXISTING_ALL.every((c) => cats.includes(c));
        if (isPreExistingFullSet) {
          changed = true;
          return { ...h, categories: [...HOUR_CATEGORIES] };
        }
        return h;
      });
      if (changed) {
        await db.update(teamSettings)
          .set({ requirements: { ...req, hours } } as any)
          .where(eq(teamSettings.id, (row as any).id));
      }
    }
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS fundraising_goal_cents INTEGER`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS hour_requirement_overrides JSONB`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS fundraising_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount_cents INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'Other',
        description TEXT NOT NULL DEFAULT '',
        occurred_on TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'verified',
        verified_by INTEGER REFERENCES users(id),
        verified_at TIMESTAMPTZ,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // --- Fundraising ---
  async getFundraisingEntries(filter: { userId?: number; status?: string } = {}): Promise<FundraisingEntry[]> {
    let rows = await db.select().from(fundraisingEntries).orderBy(desc(fundraisingEntries.occurredOn));
    if (filter.userId !== undefined) rows = rows.filter((r) => r.userId === filter.userId);
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    return rows;
  }
  async getFundraisingEntry(id: number): Promise<FundraisingEntry | undefined> {
    const [row] = await db.select().from(fundraisingEntries).where(eq(fundraisingEntries.id, id));
    return row;
  }
  async createFundraisingEntry(data: InsertFundraisingEntry): Promise<FundraisingEntry> {
    const [row] = await db.insert(fundraisingEntries).values(data).returning();
    return row;
  }
  async updateFundraisingEntry(id: number, data: Partial<InsertFundraisingEntry>): Promise<FundraisingEntry | undefined> {
    const sanitized: any = { ...data }; delete sanitized.id; delete sanitized.createdAt;
    const [row] = await db.update(fundraisingEntries).set(sanitized).where(eq(fundraisingEntries.id, id)).returning();
    return row;
  }
  async deleteFundraisingEntry(id: number): Promise<void> {
    await db.delete(fundraisingEntries).where(eq(fundraisingEntries.id, id));
  }

  async ensureRecurringTasksTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recurring_task_templates (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        priority TEXT NOT NULL DEFAULT 'Medium',
        effort INTEGER,
        departments JSONB NOT NULL DEFAULT '[]',
        assignees JSONB NOT NULL DEFAULT '[]',
        dept_only BOOLEAN NOT NULL DEFAULT false,
        frequency TEXT NOT NULL DEFAULT 'weekly',
        due_offset_days INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT true,
        last_generated_date TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async getRecurringTemplates(): Promise<RecurringTaskTemplate[]> {
    return db.select().from(recurringTaskTemplates).orderBy(desc(recurringTaskTemplates.createdAt));
  }

  async getRecurringTemplate(id: number): Promise<RecurringTaskTemplate | undefined> {
    const [row] = await db.select().from(recurringTaskTemplates).where(eq(recurringTaskTemplates.id, id));
    return row;
  }

  async createRecurringTemplate(data: InsertRecurringTaskTemplate): Promise<RecurringTaskTemplate> {
    const [row] = await db.insert(recurringTaskTemplates).values(data).returning();
    return row;
  }

  async updateRecurringTemplate(id: number, data: Partial<InsertRecurringTaskTemplate>): Promise<RecurringTaskTemplate | undefined> {
    const sanitized: any = { ...data };
    delete sanitized.id;
    delete sanitized.createdAt;
    const [row] = await db.update(recurringTaskTemplates).set(sanitized).where(eq(recurringTaskTemplates.id, id)).returning();
    return row;
  }

  async deleteRecurringTemplate(id: number): Promise<void> {
    await db.delete(recurringTaskTemplates).where(eq(recurringTaskTemplates.id, id));
  }

  /**
   * Generate a fresh task from any recurring template that is due, then advance
   * its last_generated_date. Idempotent under concurrency: the guarded UPDATE
   * (WHERE last_generated_date IS unchanged) ensures only one caller generates
   * per interval even if several server instances run this at once.
   * Returns the number of tasks created.
   */
  async generateDueRecurringTasks(): Promise<number> {
    const settings = await this.getTeamSettings();
    const today = todayServerLocalStr((settings as any).timezone || 'America/Los_Angeles');
    const templates = await this.getRecurringTemplates();
    let created = 0;
    for (const t of templates) {
      if (!t.active) continue;
      const nextDate = nextRecurringDate(t.lastGeneratedDate, t.frequency);
      if (today < nextDate) continue; // not due yet

      // Atomically claim this generation: only proceed if last_generated_date
      // is still what we read (prevents duplicate tasks across instances/ticks).
      const claim = t.lastGeneratedDate === null
        ? await db.update(recurringTaskTemplates).set({ lastGeneratedDate: today })
            .where(and(eq(recurringTaskTemplates.id, t.id), isNull(recurringTaskTemplates.lastGeneratedDate))).returning()
        : await db.update(recurringTaskTemplates).set({ lastGeneratedDate: today })
            .where(and(eq(recurringTaskTemplates.id, t.id), eq(recurringTaskTemplates.lastGeneratedDate, t.lastGeneratedDate))).returning();
      if (claim.length === 0) continue; // another worker already generated

      const due = addDaysStr(today, t.dueOffsetDays || 0);
      await this.createTask({
        projectId: t.projectId,
        title: t.title,
        description: t.description || "",
        status: "Not Started",
        priority: t.priority,
        effort: t.effort ?? undefined,
        departments: (t.departments as string[]) || [],
        assignees: (t.assignees as number[]) || [],
        deptOnly: t.deptOnly,
        startDate: today,
        dueDate: due,
      } as InsertTask);
      created++;
    }
    return created;
  }

  async migrateCalendarTypes(): Promise<void> {
    await db.execute(sql`UPDATE calendar_events SET type = 'shop' WHERE type = 'practice'`);
  }

  async backfillNexusEventKeys(): Promise<void> {
    await db.execute(sql`
      UPDATE scout_events
      SET nexus_event_key = tba_event_key
      WHERE (nexus_event_key IS NULL OR nexus_event_key = '')
        AND tba_event_key IS NOT NULL
        AND tba_event_key != ''
    `);
  }

  /**
   * One-shot data migration, gated by schema_migrations — same class of bug
   * as ensureCompetitionUnification above: its NOT EXISTS guard checks the
   * destination only, so deleting a derived time_entries row makes a later
   * boot recreate it. Gating (rather than "safe to re-run") is what actually
   * lets a coach delete a bad outreach/volunteer entry and have it stay
   * deleted.
   */
  async backfillOutreachHours(): Promise<void> {
    const KEY = 'outreach_hours_backfill';

    // Retire on databases where this has already run (evidenced by any
    // event-derived time entry existing), so gating it doesn't run it "one
    // last time" on the first boot after this change ships.
    await db.execute(sql`
      INSERT INTO schema_migrations (key)
      SELECT ${KEY}
      WHERE EXISTS (
        SELECT 1 FROM time_entries WHERE calendar_event_id IS NOT NULL AND kind IN ('outreach', 'volunteer')
      )
      ON CONFLICT DO NOTHING
    `);

    if (!(await this.claimMigration(KEY))) return;

    console.log('backfillOutreachHours: running one-time event_signups backfill…');
    await db.execute(sql`
      INSERT INTO time_entries (user_id, check_in_at, check_out_at, status, rounded_minutes, kind, calendar_event_id)
      SELECT
        es.user_id,
        es.checked_in_at,
        es.checked_out_at,
        'completed',
        CEIL(
          EXTRACT(EPOCH FROM (es.checked_out_at - es.checked_in_at)) / 900.0
        )::int * 15,
        ce.type,
        ce.id
      FROM event_signups es
      JOIN calendar_events ce ON ce.id = es.calendar_event_id
      WHERE es.checked_in_at IS NOT NULL
        AND es.checked_out_at IS NOT NULL
        AND ce.type IN ('outreach', 'volunteer')
        AND NOT EXISTS (
          SELECT 1 FROM time_entries te
          WHERE te.calendar_event_id = ce.id
            AND te.user_id = es.user_id
        )
    `);
  }

  async patchCalendarEventDeletedDates(id: number, deletedDates: string[]): Promise<CalendarEvent | undefined> {
    const deduped = [...new Set(deletedDates)];
    const [row] = await db.update(calendarEvents)
      .set({ deletedDates: JSON.stringify(deduped) })
      .where(eq(calendarEvents.id, id))
      .returning();
    return row;
  }

  async seedCalendarEvents(createdBy: number): Promise<void> {
    const existing = await db.select().from(calendarEvents);
    if (existing.length > 0) return;
    const seeds = [
      { title: 'Shop Session', startDate: '2026-01-06', type: 'shop', location: 'Build Room', description: 'Biweekly shop session' },
      { title: 'Shop Session', startDate: '2026-01-10', type: 'shop', location: 'Build Room', description: 'Weekly shop session' },
      { title: 'San Diego Regional', startDate: '2026-03-05', endDate: '2026-03-08', type: 'competition', location: 'San Diego, CA', description: 'Week 1 Regional', attending: true },
      { title: 'LA Regional', startDate: '2026-03-19', endDate: '2026-03-22', type: 'competition', location: 'Los Angeles, CA', description: 'Week 3 Regional', attending: true },
      { title: 'CHS District Championship', startDate: '2026-04-09', endDate: '2026-04-12', type: 'competition', location: 'Virginia', description: 'District Championship', attending: true },
      { title: 'Strategy Meeting', startDate: '2026-03-01', type: 'meeting', location: 'Build Room', description: '' },
      { title: 'Robot Bag Deadline', startDate: '2026-02-18', type: 'other', location: '', description: 'Robot must be competition-ready' },
    ];
    for (const s of seeds) {
      await db.insert(calendarEvents).values({ ...s, createdBy } as InsertCalendarEvent);
    }
  }

  async getResources(category?: string): Promise<Resource[]> {
    const rows = await db.select().from(resources).orderBy(desc(resources.pinned), desc(resources.createdAt));
    if (category) return rows.filter(r => r.category === category);
    return rows;
  }

  async getResource(id: number): Promise<Resource | undefined> {
    const [row] = await db.select().from(resources).where(eq(resources.id, id));
    return row;
  }

  async createResource(data: InsertResource): Promise<Resource> {
    const sanitized: any = { ...data };
    delete sanitized.id;
    delete sanitized.createdAt;
    const [row] = await db.insert(resources).values(sanitized).returning();
    return row;
  }

  async updateResource(id: number, data: Partial<InsertResource>): Promise<Resource | undefined> {
    const sanitized: any = { ...data };
    delete sanitized.id;
    delete sanitized.createdAt;
    const [row] = await db.update(resources).set(sanitized).where(eq(resources.id, id)).returning();
    return row;
  }

  async deleteResource(id: number): Promise<void> {
    await db.delete(resources).where(eq(resources.id, id));
  }

  async seedResources(addedBy: number): Promise<void> {
    const existing = await db.select().from(resources);
    if (existing.length > 0) return;
    const seeds: Omit<InsertResource, 'addedBy'>[] = [
      { title: 'The Blue Alliance', url: 'https://www.thebluealliance.com', description: 'Official FRC match results, team info, event data, and historical records.', category: 'Competition', pinned: true },
      { title: 'FRC Nexus', url: 'https://frc.nexus', description: 'Live event queuing, announcements, and pit display coordination tool.', category: 'Competition', pinned: true },
      { title: 'FIRST Robotics Competition', url: 'https://www.firstinspires.org/robotics/frc', description: 'Official FIRST website — game manuals, season information, and registration.', category: 'Competition', pinned: false },
      { title: 'FRC Game Manual', url: 'https://www.firstinspires.org/resource-library/frc/competition-manual-qa-system', description: 'Current season game manual with all official rules and scoring criteria.', category: 'Competition', pinned: false },
      { title: 'WPILib Documentation', url: 'https://docs.wpilib.org', description: 'Official WPILib docs — the primary Java/C++ library for FRC robot programming.', category: 'Software', pinned: true },
      { title: 'PathPlanner', url: 'https://pathplanner.dev', description: 'Advanced autonomous path planning for FRC robots.', category: 'Software', pinned: false },
      { title: 'FRC 6328 Mechanical Advantage', url: 'https://github.com/Mechanical-Advantage', description: 'Open-source code, technical documentation, and build resources.', category: 'Software', pinned: false },
      { title: 'Limelight Vision', url: 'https://docs.limelightvision.io', description: 'FRC-targeted vision tracking system with detailed setup documentation.', category: 'Software', pinned: false },
      { title: 'FRC Driver Station Setup', url: 'https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-2/frc-game-tools.html', description: 'NI FRC driver station installation and configuration guide.', category: 'Software', pinned: false },
      { title: 'REV Robotics', url: 'https://docs.revrobotics.com', description: 'Control system components, SPARK MAX motor controllers, and documentation.', category: 'Vendor', pinned: false },
      { title: 'CTRE Phoenix Documentation', url: 'https://pro.docs.ctr-electronics.com', description: 'Talon SRX, Falcon 500, and Phoenix 6 documentation and API reference.', category: 'Vendor', pinned: false },
      { title: 'Playing With Fusion', url: 'https://www.playingwithfusion.com', description: 'Time-of-flight distance sensors and other FRC-legal sensors.', category: 'Vendor', pinned: false },
      { title: 'FRC Design Sourcebook', url: 'https://www.frcdesign.org', description: 'Open-source design guide covering mechanisms, systems, and fabrication.', category: 'Design', pinned: false },
      { title: 'Onshape FRC Library', url: 'https://cad.onshape.com/documents/7bfda6b4d5f79b44e17bbc9f', description: 'Community-maintained parts library for FRC design in Onshape.', category: 'Design', pinned: false },
      { title: 'FRC Statbotics', url: 'https://www.statbotics.io', description: 'Advanced FRC analytics, EPA ratings, and team performance statistics.', category: 'Training', pinned: false },
      { title: 'Spectrum 3847 Scouting Resources', url: 'https://spectrum3847.org', description: 'Strategy and scouting guides from one of FRC\'s most respected teams.', category: 'Training', pinned: false },
      { title: 'Chief Delphi', url: 'https://www.chiefdelphi.com', description: 'The primary FRC community forum for strategy, technical discussion, and build threads.', category: 'Other', pinned: false },
      { title: 'FRC YouTube Channel', url: 'https://www.youtube.com/@FIRSTRoboticsCompetition', description: 'Official FIRST YouTube channel with event streams, reveals, and highlights.', category: 'Other', pinned: false },
    ];
    for (const s of seeds) {
      await db.insert(resources).values({ ...s, addedBy } as InsertResource);
    }
  }

  async getMatchExceptions(eventId: number): Promise<MatchException[]> {
    return db.select().from(matchExceptions).where(eq(matchExceptions.eventId, eventId));
  }

  async upsertMatchException(data: { eventId: number; userId: number; matchNumber: number; type: string; createdBy: number }): Promise<MatchException> {
    const [row] = await db.insert(matchExceptions).values(data)
      .onConflictDoUpdate({ target: [matchExceptions.eventId, matchExceptions.userId, matchExceptions.matchNumber], set: { type: data.type, createdBy: data.createdBy } })
      .returning();
    return row;
  }

  async deleteMatchException(eventId: number, userId: number, matchNumber: number): Promise<void> {
    await db.delete(matchExceptions).where(and(eq(matchExceptions.eventId, eventId), eq(matchExceptions.userId, userId), eq(matchExceptions.matchNumber, matchNumber)));
  }

  private defaultTeamSettings(): InsertTeamSettings {
    return {
      teamNumber: 31130,
      teamName: 'ManeFrame',
      themeColor: '#4169e1',
      logoUrl: null,
      departments: [
        { name: 'Mechanical', color: '#f97316' },
        { name: 'Software', color: '#3b82f6' },
        { name: 'Modeling', color: '#8b5cf6' },
        { name: 'Logistics', color: '#22c55e' },
        { name: 'Electrical', color: '#eab308' },
        { name: 'Business', color: '#14b8a6' },
        { name: 'Leadership', color: '#ef4444' },
      ],
      roles: [
        { name: 'Coach', tier: 'leadership' },
        { name: 'Team Captain', tier: 'leadership' },
        { name: 'SCRUM Master', tier: 'leadership' },
        { name: 'Department Head', tier: 'lead' },
        { name: 'Trainer', tier: 'lead' },
        { name: 'Team Member', tier: 'member' },
        { name: 'Class Member', tier: 'member' },
      ],
    };
  }

  async getTeamSettings(): Promise<TeamSettings> {
    const [row] = await db.select().from(teamSettings);
    if (row) return row;
    const defaults = this.defaultTeamSettings();
    const [created] = await db.insert(teamSettings).values(defaults).returning();
    return created;
  }

  async upsertTeamSettings(data: Partial<Omit<TeamSettings, 'id' | 'updatedAt'>>): Promise<TeamSettings> {
    const existing = await db.select().from(teamSettings);
    if (existing.length > 0) {
      const [updated] = await db.update(teamSettings)
        .set({ ...(data as Partial<InsertTeamSettings>), updatedAt: new Date() })
        .where(eq(teamSettings.id, existing[0].id))
        .returning();
      return updated;
    }
    const merged: InsertTeamSettings = { ...this.defaultTeamSettings(), ...data };
    const [created] = await db.insert(teamSettings).values(merged).returning();
    return created;
  }

  async updateTeamSettingsWithDepartmentChanges(
    data: Partial<Omit<TeamSettings, 'id' | 'updatedAt'>>,
    declared: DepartmentChangeSet,
  ): Promise<{ settings: TeamSettings; propagation: DepartmentPropagationCounts }> {
    return db.transaction(async (tx) => {
      // Lock the settings row so two concurrent Coach saves can't both
      // validate against the same pre-state and have the second one silently
      // no-op its propagation while still writing a "successful" settings row.
      let [current] = await tx.select().from(teamSettings).for('update');
      if (!current) {
        const defaults = this.defaultTeamSettings();
        [current] = await tx.insert(teamSettings).values(defaults).returning();
      }

      const storedNames = (current.departments as { name: string; color: string }[]).map(d => d.name);
      const incomingNames = ((data.departments as { name: string; color: string }[] | undefined) ?? storedNames.map(n => ({ name: n }))).map((d: any) => d.name);
      const verdict = reconcileDepartmentChanges(storedNames, incomingNames, declared);
      // `'error' in verdict` (rather than `!verdict.ok`) because this repo's
      // tsconfig doesn't enable strictNullChecks, and discriminated-union
      // narrowing on a boolean literal tag is unreliable without it.
      if ('error' in verdict) throw new DepartmentChangeError(verdict.error);

      const norm = normalizeDepartmentChanges(verdict.changes);
      const affected = [...norm.renameMap.keys(), ...norm.removed];
      const counts: DepartmentPropagationCounts = { users: 0, projects: 0, tasks: 0, announcements: 0, recurringTemplates: 0, certifications: 0, trainerScopes: 0 };

      if (affected.length > 0) {
        const containsAny = (col: any) => or(...affected.map(n => sql`${col} @> ${JSON.stringify([n])}::jsonb`))!;

        // users.departments (jsonb string[])
        const userRows = await tx.select({ id: users.id, departments: users.departments }).from(users).where(containsAny(users.departments));
        for (const row of userRows) {
          const next = remapDepartmentList(row.departments as string[], norm);
          if (sameStringList(next, row.departments as string[])) continue;
          await tx.update(users).set({ departments: next }).where(eq(users.id, row.id));
          counts.users++;
        }

        // tasks.departments (jsonb string[]) — clearing the last department on
        // a dept-only task must also clear deptOnly, mirroring the invariant
        // TaskModal already enforces on manual save (a dept-only task with no
        // departments left is invisible on every board).
        const taskRows = await tx.select({ id: tasks.id, departments: tasks.departments, deptOnly: tasks.deptOnly }).from(tasks).where(containsAny(tasks.departments));
        for (const row of taskRows) {
          const next = remapDepartmentList(row.departments as string[], norm);
          if (sameStringList(next, row.departments as string[])) continue;
          const patch: { departments: string[]; deptOnly?: boolean } = { departments: next };
          if (row.deptOnly && next.length === 0) patch.deptOnly = false;
          await tx.update(tasks).set(patch).where(eq(tasks.id, row.id));
          counts.tasks++;
        }

        // recurring_task_templates.departments (jsonb string[]) — same deptOnly rule,
        // otherwise every future generated task would inherit the invisible state.
        const templateRows = await tx.select({ id: recurringTaskTemplates.id, departments: recurringTaskTemplates.departments, deptOnly: recurringTaskTemplates.deptOnly }).from(recurringTaskTemplates).where(containsAny(recurringTaskTemplates.departments));
        for (const row of templateRows) {
          const next = remapDepartmentList(row.departments as string[], norm);
          if (sameStringList(next, row.departments as string[])) continue;
          const patch: { departments: string[]; deptOnly?: boolean } = { departments: next };
          if (row.deptOnly && next.length === 0) patch.deptOnly = false;
          await tx.update(recurringTaskTemplates).set(patch).where(eq(recurringTaskTemplates.id, row.id));
          counts.recurringTemplates++;
        }

        // projects.department (text, nullable)
        const projRows = await tx.select({ id: projects.id, department: projects.department }).from(projects).where(inArray(projects.department, affected));
        for (const row of projRows) {
          const next = remapDepartmentName(row.department, norm);
          if (next === row.department) continue;
          await tx.update(projects).set({ department: next }).where(eq(projects.id, row.id));
          counts.projects++;
        }

        // certifications.department (text, nullable) — removal sets it to null,
        // which IS the General category, so a deleted department's certs stay
        // visible and simply move into the General ladder rather than vanishing.
        const certRows = await tx.select({ id: certifications.id, department: certifications.department })
          .from(certifications).where(inArray(certifications.department, affected));
        for (const row of certRows) {
          const next = remapDepartmentName(row.department, norm);
          if (next === row.department) continue;
          await tx.update(certifications).set({ department: next }).where(eq(certifications.id, row.id));
          counts.certifications++;
        }

        // trainer_scopes.department — renames follow, but a REMOVED department's
        // scopes are DELETED rather than remapped to null. Remapping would
        // silently promote a Manufacturing-only trainer into a General trainer,
        // widening their sign-off authority as a side effect of a settings edit.
        const scopeRows = await tx.select({ id: trainerScopes.id, department: trainerScopes.department })
          .from(trainerScopes).where(inArray(trainerScopes.department, affected));
        for (const row of scopeRows) {
          const next = remapDepartmentName(row.department, norm);
          if (next === row.department) continue;
          if (next === null) {
            await tx.delete(trainerScopes).where(eq(trainerScopes.id, row.id));
          } else {
            await tx.update(trainerScopes).set({ department: next }).where(eq(trainerScopes.id, row.id));
          }
          counts.trainerScopes++;
        }

        // announcements.targetDepartment (text, nullable) — removal sets it to
        // null and leaves `scope` alone (fail closed, never broadcast wider).
        const annRows = await tx.select({ id: announcements.id, targetDepartment: announcements.targetDepartment }).from(announcements).where(inArray(announcements.targetDepartment, affected));
        for (const row of annRows) {
          const next = remapDepartmentName(row.targetDepartment, norm);
          if (next === row.targetDepartment) continue;
          await tx.update(announcements).set({ targetDepartment: next }).where(eq(announcements.id, row.id));
          counts.announcements++;
        }
      }

      const [settings] = await tx.update(teamSettings)
        .set({ ...(data as Partial<InsertTeamSettings>), updatedAt: new Date() })
        .where(eq(teamSettings.id, current.id))
        .returning();

      return { settings, propagation: counts };
    });
  }

  async getDepartmentUsageCounts(): Promise<DepartmentUsageMap> {
    const settings = await this.getTeamSettings();
    const map: DepartmentUsageMap = {};
    for (const dept of settings.departments as { name: string }[]) {
      map[dept.name] = { users: 0, projects: 0, tasks: 0, announcements: 0, recurringTemplates: 0, certifications: 0, trainerScopes: 0, total: 0 };
    }
    const ensure = (name: string) => {
      if (!map[name]) map[name] = { users: 0, projects: 0, tasks: 0, announcements: 0, recurringTemplates: 0, certifications: 0, trainerScopes: 0, total: 0 };
      return map[name];
    };

    const textCount = async (table: any, column: any, key: keyof DepartmentPropagationCounts) => {
      const result = await db.execute(sql`SELECT ${column} AS name, count(*)::int AS n FROM ${table} WHERE ${column} IS NOT NULL GROUP BY 1`);
      for (const row of (result as any).rows as { name: string; n: number }[]) {
        ensure(row.name)[key] = row.n;
      }
    };
    const jsonbListCount = async (table: any, idColumn: any, column: any, key: keyof DepartmentPropagationCounts) => {
      // No FROM-clause alias here on purpose — aliasing `table` would put the
      // unaliased table name out of scope for `${idColumn}`/`${column}`,
      // since those embed the column's own table-qualified reference.
      const result = await db.execute(sql`
        SELECT elem AS name, count(DISTINCT ${idColumn})::int AS n
        FROM ${table}, LATERAL jsonb_array_elements_text(${column}) AS elem
        GROUP BY 1
      `);
      for (const row of (result as any).rows as { name: string; n: number }[]) {
        ensure(row.name)[key] = row.n;
      }
    };

    await Promise.all([
      textCount(projects, projects.department, 'projects'),
      textCount(announcements, announcements.targetDepartment, 'announcements'),
      textCount(certifications, certifications.department, 'certifications'),
      textCount(trainerScopes, trainerScopes.department, 'trainerScopes'),
      jsonbListCount(users, users.id, users.departments, 'users'),
      jsonbListCount(tasks, tasks.id, tasks.departments, 'tasks'),
      jsonbListCount(recurringTaskTemplates, recurringTaskTemplates.id, recurringTaskTemplates.departments, 'recurringTemplates'),
    ]);

    for (const usage of Object.values(map)) {
      usage.total = usage.users + usage.projects + usage.tasks + usage.announcements + usage.recurringTemplates + usage.certifications + usage.trainerScopes;
    }
    return map;
  }

  async seedDatabase(): Promise<void> {
    const existingUsers = await this.getUsers();
    if (existingUsers.length > 0) return;

    const defaultUsers = [
      {
        username: 'coach_mentor',
        password: 'changeme',
        name: 'Coach Mentor',
        roles: ['Coach'],
        departments: ['Leadership', 'Business'],
      },
      {
        username: 'team_captain',
        password: 'changeme',
        name: 'Team Captain',
        roles: ['Team Captain', 'SCRUM Master'],
        departments: ['Software', 'Leadership'],
      },
      {
        username: 'mech_lead',
        password: 'changeme',
        name: 'Mechanical Lead',
        roles: ['Department Head'],
        departments: ['Mechanical'],
      },
      {
        username: 'sw_lead',
        password: 'changeme',
        name: 'Software Lead',
        roles: ['Department Head'],
        departments: ['Software'],
      },
      {
        username: 'elec_lead',
        password: 'changeme',
        name: 'Electrical Lead',
        roles: ['Department Head'],
        departments: ['Electrical'],
      },
      {
        username: 'safety_trainer',
        password: 'changeme',
        name: 'Sam Trainer',
        roles: ['Trainer'],
        departments: ['Mechanical', 'Electrical'],
      },
      {
        username: 'member1',
        password: 'changeme',
        name: 'Team Member',
        roles: ['Team Member'],
        departments: ['Software'],
      },
    ];

    for (const user of defaultUsers) {
      await this.createUser({ ...user, password: await hashPassword(user.password) });
    }

    await this.createProject({
      name: 'Competition Robot',
      description: 'Main build-season project.',
      archived: false,
    });
  }

  async getGuestTokenByPin(pin: string): Promise<(GuestToken & { eventName: string }) | null> {
    const rows = await db
      .select({ token: guestTokens, eventName: scoutEvents.name })
      .from(guestTokens)
      .innerJoin(scoutEvents, eq(guestTokens.eventId, scoutEvents.id))
      .where(and(eq(guestTokens.pin, pin), eq(guestTokens.active, true)))
      .limit(1);
    if (!rows.length) return null;
    return { ...rows[0].token, eventName: rows[0].eventName };
  }

  async getActiveGuestToken(eventId: number): Promise<GuestToken | null> {
    const rows = await db
      .select()
      .from(guestTokens)
      .where(and(eq(guestTokens.eventId, eventId), eq(guestTokens.active, true)))
      .limit(1);
    return rows[0] || null;
  }

  async createGuestToken(eventId: number, pin: string, label: string, createdBy: number): Promise<GuestToken> {
    await db.update(guestTokens).set({ active: false }).where(eq(guestTokens.eventId, eventId));
    const [row] = await db.insert(guestTokens).values({ eventId, pin, label, active: true, createdBy }).returning();
    return row;
  }

  async deactivateGuestToken(eventId: number): Promise<void> {
    await db.update(guestTokens).set({ active: false }).where(eq(guestTokens.eventId, eventId));
  }
}

export const storage = new DatabaseStorage();
