/**
 * The FTC season a date falls in, as FIRST's API names it: by its start year.
 * Seasons roll over in September, so 2026-10-22 → 2026 (the 2026–27 season)
 * and 2026-03-01 → 2025.
 *
 * Date-only strings are read at local noon so a "2026-09-01" event isn't
 * shifted into August by a timezone offset.
 */
export function ftcSeasonFor(date: string | Date | null | undefined = new Date()): number {
  let d: Date;
  if (!date) d = new Date();
  else if (typeof date === 'string') d = new Date(`${date.slice(0, 10)}T12:00:00`);
  else d = date;
  if (Number.isNaN(d.getTime())) d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
}
