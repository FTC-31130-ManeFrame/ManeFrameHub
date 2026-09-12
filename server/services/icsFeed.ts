import ical, { ICalEventRepeatingFreq, ICalWeekday } from "ical-generator";
import { getVtimezoneComponent } from "@touch4it/ical-timezones";
import type { CalendarEvent } from "../../shared/schema";
import { HOUR_CATEGORY_LABELS, isHourCategory } from "../../shared/hourCategories";
import { parseLocalDate } from "../../utils/dates";

// Builds an RFC 5545 (.ics) feed from a user's already visibility-filtered
// calendar events (see server/services/eventVisibility.ts — invite-only
// filtering happens before this file ever sees the rows). Only the weekly
// recurrence this app actually supports needs translating; everything else
// is a plain VEVENT.

const WEEKDAY_BY_INDEX: ICalWeekday[] = [
  ICalWeekday.SU, ICalWeekday.MO, ICalWeekday.TU, ICalWeekday.WE,
  ICalWeekday.TH, ICalWeekday.FR, ICalWeekday.SA,
];

/**
 * A Date built purely to CARRY wall-clock components — never to represent a
 * real instant. ical-generator's timed-event formatter reads a Date back
 * with LOCAL getters (getFullYear/getHours/...) and pairs them with the
 * TZID we ask for; it does not convert. So if we hand it a genuine instant
 * (e.g. "8:30 AM Pacific" converted to its correct UTC point), the output
 * is wrong on any server that isn't itself running in Pacific time — the
 * getters read back whatever wall-clock the SERVER's zone assigns to that
 * instant (production runs in UTC, so 8:30 AM Pacific = 15:30 UTC was
 * coming out the other end as "3:30 PM"). Building the Date from local
 * components instead means the getters read back exactly what we put in,
 * regardless of what timezone the Node process happens to run in.
 */
function wallClock(dateStr: string, timeStr: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

function parseDeletedDates(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Start/end/allDay for an event row, as wall-clock carrier Dates. */
function eventTiming(ev: Pick<CalendarEvent, "startDate" | "endDate" | "startTime" | "endTime">) {
  const allDay = !ev.startTime;
  if (allDay) {
    const start = parseLocalDate(ev.startDate);
    // iCal all-day DTEND is exclusive — use the day after the last day covered.
    const end = parseLocalDate(ev.endDate || ev.startDate);
    end.setDate(end.getDate() + 1);
    return { start, end, allDay: true as const };
  }
  const start = wallClock(ev.startDate, ev.startTime!);
  const end = ev.endTime ? wallClock(ev.endDate || ev.startDate, ev.endTime) : undefined;
  return { start, end, allDay: false as const };
}

function describe(ev: CalendarEvent): string | undefined {
  const parts: string[] = [];
  if (ev.description) parts.push(ev.description);
  if (ev.location) parts.push(`Location: ${ev.location}`);
  return parts.length ? parts.join("\n\n") : undefined;
}

function categoriesFor(ev: CalendarEvent) {
  return isHourCategory(ev.type) ? [{ name: HOUR_CATEGORY_LABELS[ev.type] }] : undefined;
}

export function buildCalendarFeed(events: CalendarEvent[], teamName: string, teamTimezone: string): string {
  const calendar = ical({
    name: `${teamName} Calendar`,
    // Passing a generator makes ical-generator emit a VTIMEZONE block, so
    // TZID actually resolves to a real, DST-aware zone definition instead of
    // a bare, unresolvable label — without it, a weekly recurring event's
    // wall-clock time would drift by an hour across the DST boundary.
    timezone: { name: teamTimezone, generator: getVtimezoneComponent },
    prodId: { company: "ManeFrame", product: "ManeFrame Hub Calendar Feed" },
  });

  const parents = events.filter((e) => !e.parentEventId);
  const overrides = events.filter((e) => e.parentEventId);
  const parentById = new Map(parents.map((p) => [p.id, p]));

  for (const ev of parents) {
    const { start, end, allDay } = eventTiming(ev);
    const isWeekly = ev.recurrenceType === "weekly" && !!ev.recurrenceEndsOn;

    let repeating: any;
    if (isWeekly) {
      const deleted = parseDeletedDates(ev.deletedDates);
      repeating = {
        freq: ICalEventRepeatingFreq.WEEKLY,
        byDay: [WEEKDAY_BY_INDEX[parseLocalDate(ev.startDate).getDay()]],
        until: allDay ? parseLocalDate(ev.recurrenceEndsOn!) : wallClock(ev.recurrenceEndsOn!, ev.startTime!),
        // An empty array is still truthy — ical-generator would emit a blank,
        // invalid `EXDATE:` line if we always set this key. Only include it
        // when there's something to exclude.
        ...(deleted.length > 0
          ? { exclude: deleted.map((d) => (allDay ? parseLocalDate(d) : wallClock(d, ev.startTime!))) }
          : {}),
      };
    }

    calendar.createEvent({
      id: `event-${ev.id}@maneframe-hub`,
      start,
      end,
      allDay,
      timezone: allDay ? undefined : teamTimezone,
      summary: ev.title,
      description: describe(ev),
      location: ev.location || undefined,
      categories: categoriesFor(ev),
      repeating,
    });
  }

  for (const ev of overrides) {
    const { start, end, allDay } = eventTiming(ev);
    const parent = parentById.get(ev.parentEventId!);
    // RECURRENCE-ID must reference the *originally scheduled* instance — the
    // parent's own time of day on this date — even if the override itself
    // moved to a different time. Falls back to the override's own time if the
    // parent isn't in this feed (e.g. visibility edge case).
    const parentAllDay = parent ? !parent.startTime : allDay;
    const recurrenceId = parent
      ? (parentAllDay ? parseLocalDate(ev.instanceDate!) : wallClock(ev.instanceDate!, parent.startTime!))
      : (allDay ? parseLocalDate(ev.instanceDate!) : wallClock(ev.instanceDate!, ev.startTime || "00:00"));

    calendar.createEvent({
      id: `event-${ev.parentEventId}@maneframe-hub`,
      recurrenceId,
      start,
      end,
      allDay,
      timezone: allDay ? undefined : teamTimezone,
      summary: ev.title,
      description: describe(ev),
      location: ev.location || undefined,
      categories: categoriesFor(ev),
    });
  }

  return calendar.toString();
}
