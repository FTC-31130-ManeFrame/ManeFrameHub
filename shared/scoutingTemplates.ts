// Shared scouting template model — the single source of truth for the flexible
// field system used by seasons/templates. Imported by both the server (schema
// migration, routes, storage) and the client (forms, analytics, QR, CSV).
//
// Design contract (mid-season resilience):
//   - Field keys are permanent and never reused; "deleting" a field archives it.
//   - Records store a full `data` blob keyed by field key; old blobs are never
//     rewritten, so archived field defs keep old values labeled.
//   - See docs/design/scouting-seasons-templates.md.

export type ScoutKind = 'pit' | 'match';

export type FieldType =
  | 'number'
  | 'counter'
  | 'boolean'
  | 'text'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'rating'   // 1..max stars
  | 'slider'   // 1..max range slider (built-ins use max 10)
  | 'photo';   // data-URL image

export interface TemplateField {
  key: string;            // stable, unique within a template
  label: string;
  type: FieldType;
  options?: string[];     // select / multiselect
  min?: number;           // counter / slider / rating
  max?: number;           // counter / slider / rating
  quickAdd?: number[];    // counter quick-add buttons, e.g. [5, 10]
  required?: boolean;
  section?: string;       // group heading in the form
  placeholder?: string;
  // Identity fields are locked in the builder: never archivable, always present.
  identity?: boolean;
  // A select whose options come from a runtime source (e.g. a team's pit auto
  // routines) rather than a fixed `options` list, and which allows free text.
  dynamicOptions?: 'pitAutoRoutines';
  allowCustom?: boolean;
  // Analytics hints. Numeric types take avg/sum/max; booleans take 'rate'
  // (share of records answered Yes — e.g. how often a robot parks).
  aggregate?: 'avg' | 'sum' | 'max' | 'rate' | 'none';
  showInSummary?: boolean; // show on the robot summary card
  rankMetric?: boolean;    // default sort/ranking metric
  // Soft-delete:
  archived?: boolean;
  archivedAt?: number;
}

export interface ScoutingTemplateShape {
  kind: ScoutKind;
  name: string;
  fields: TemplateField[];
}

/** Field types whose values are numeric and can be aggregated. */
export const NUMERIC_FIELD_TYPES: FieldType[] = ['number', 'counter', 'rating', 'slider'];

export function isNumericField(f: TemplateField): boolean {
  return NUMERIC_FIELD_TYPES.includes(f.type);
}

/**
 * A record's value for a field. When the record has a `data` blob it is the
 * whole truth: falling back to the legacy column for a missing key would show
 * that column's DB default (e.g. a rating of 5) as if someone had entered it.
 * Only a record with no blob at all reads its legacy columns.
 */
export function fieldValue(rec: any, key: string): any {
  const data = rec?.data;
  if (data && typeof data === 'object' && Object.keys(data).length > 0) return data[key];
  return rec?.[key];
}

export interface FieldAggregate {
  key: string;
  label: string;
  agg: NonNullable<TemplateField['aggregate']>;
  value: number;
  /** Ready to show: "4.5", "4/5", "80%". */
  display: string;
  /** "Avg", "Best", "Total" or "" for a rate. */
  prefix: string;
  n: number;
  showInSummary: boolean;
  rankMetric: boolean;
}

// ---------------------------------------------------------------------------
// Record helpers. Every view that reads scouting records goes through these
// and the event's template, so none of them hard-codes one game's fields.
// ---------------------------------------------------------------------------

/** Keys every record carries that identify it rather than observe anything. */
const RECORD_IDENTITY_KEYS = new Set(['teamNumber', 'teamName', 'matchNumber', 'matchType', 'alliance']);

/** Whether a stored value is an answer rather than a blank. */
export function isAnswered(v: any): boolean {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return !Number.isNaN(v);
  return true;
}

/**
 * How many observations a record holds. A robot row created by the FIRST
 * import carries only identity, so it scores 0 — that is how "not yet pit
 * scouted" is told apart from "scouted". An unticked Yes/No isn't counted,
 * since an untouched form saves it as false too.
 */
export function observationCount(rec: any): number {
  const data = rec?.data || {};
  return Object.entries(data).filter(([k, v]) => !RECORD_IDENTITY_KEYS.has(k) && isAnswered(v) && v !== false).length;
}

/**
 * Combine two records of the same robot: `primary`'s answers win, its blanks
 * are filled from `other`, tag lists are unioned and differing notes kept.
 */
export function mergeScoutData(primary: Record<string, any> = {}, other: Record<string, any> = {}): Record<string, any> {
  const out: Record<string, any> = { ...primary };
  for (const [k, v] of Object.entries(other)) {
    const cur = out[k];
    if (Array.isArray(cur) && Array.isArray(v)) out[k] = Array.from(new Set([...cur, ...v]));
    else if (k === 'notes' && typeof cur === 'string' && typeof v === 'string' && cur && v && !cur.includes(v)) out[k] = `${cur}\n\n${v}`;
    else if (!isAnswered(cur) && isAnswered(v)) out[k] = v;
  }
  return out;
}

/** One value as text: Yes/No, tag lists joined, ratings shown out of their max. */
export function formatValue(f: TemplateField | undefined, v: any): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (!isAnswered(v)) return '—';
  if (f && (f.type === 'rating' || f.type === 'slider') && typeof v === 'number') {
    return `${v}/${f.max ?? (f.type === 'rating' ? 5 : 10)}`;
  }
  return String(v);
}

const observable = (fields: TemplateField[]) =>
  fields.filter(f => !f.archived && !f.identity && f.type !== 'photo');

/** "Label: value" for each answered field — used for AI reports. */
export function describeRecord(rec: any, fields: TemplateField[]): string[] {
  return observable(fields)
    .map(f => [f, fieldValue(rec, f.key)] as const)
    .filter(([, v]) => isAnswered(v))
    .map(([f, v]) => `${f.label}: ${formatValue(f, v)}`);
}

/**
 * The fields a record should be summarized by: the ones flagged "Summary",
 * else the numeric and Yes/No ones.
 */
export function summaryFields(fields: TemplateField[], limit = 4): TemplateField[] {
  const active = observable(fields);
  const flagged = active.filter(f => f.showInSummary);
  return (flagged.length ? flagged : active.filter(f => isNumericField(f) || f.type === 'boolean')).slice(0, limit);
}

/** A one-line summary of a record, e.g. "Auto Launched: 3 · Parked: Yes". */
export function summarizeRecord(rec: any, fields: TemplateField[], limit = 4): string {
  return summaryFields(fields, limit).map(f => `${f.label}: ${formatValue(f, fieldValue(rec, f.key))}`).join(' · ');
}

/** Aggregate every field flagged with a stat over a set of records. */
export function computeAggregates(records: any[], fields: TemplateField[]): FieldAggregate[] {
  return fields
    .filter(f => !f.archived && f.aggregate && f.aggregate !== 'none')
    .filter(f => (f.aggregate === 'rate' ? f.type === 'boolean' : isNumericField(f)))
    .map(f => {
      const agg = f.aggregate!;
      let value = 0;
      let n = 0;
      if (agg === 'rate') {
        const answers = records.map(r => fieldValue(r, f.key)).filter(v => typeof v === 'boolean');
        n = answers.length;
        value = n ? Math.round((answers.filter(Boolean).length / n) * 100) : 0;
      } else {
        const vals = records.map(r => fieldValue(r, f.key)).filter(v => typeof v === 'number' && !Number.isNaN(v)) as number[];
        n = vals.length;
        if (n) {
          if (agg === 'sum') value = vals.reduce((s, v) => s + v, 0);
          else if (agg === 'max') value = Math.max(...vals);
          else value = Math.round((vals.reduce((s, v) => s + v, 0) / n) * 10) / 10;
        }
      }
      const display = agg === 'rate' ? `${value}%` : f.type === 'rating' && f.max ? `${value}/${f.max}` : String(value);
      const prefix = agg === 'rate' ? '' : agg === 'max' ? 'Best' : agg === 'sum' ? 'Total' : 'Avg';
      return { key: f.key, label: f.label, agg, value, display, prefix, n, showInSummary: !!f.showInSummary, rankMetric: !!f.rankMetric };
    });
}

// ---------------------------------------------------------------------------
// Built-in templates — mirror the legacy hard-coded forms exactly so that the
// backfilled `data` blob maps 1:1 to the old columns and day-one behavior is
// unchanged. Field `key` == the legacy column name. Columns the live forms no
// longer collect enter as `archived` fields (kept for old rows + CSV history).
// ---------------------------------------------------------------------------

export const BUILTIN_PIT_FIELDS: TemplateField[] = [
  { key: 'teamNumber', label: 'Team Number', type: 'number', identity: true, required: true, section: 'Identity' },
  { key: 'drivetrain', label: 'Drivetrain', type: 'select', options: ['Tank', 'Swerve', 'Mecanum', 'Other'], section: 'Robot' },
  { key: 'autonomousRoutine', label: 'Autonomous Routine', type: 'textarea', section: 'Autonomous', placeholder: 'Describe autonomous routine…' },
  { key: 'capabilities', label: 'Capabilities', type: 'multiselect', section: 'Robot', placeholder: 'Add capability and press Enter' },
  { key: 'deficiencies', label: 'Weaknesses / Deficiencies', type: 'multiselect', section: 'Robot', placeholder: 'Add weakness and press Enter' },
  { key: 'notes', label: 'Notes', type: 'textarea', section: 'Notes', placeholder: 'Additional observations…' },
  { key: 'photoUrl', label: 'Robot Photo', type: 'photo', section: 'Robot' },
  { key: 'offenseRating', label: 'Offense Rating', type: 'slider', min: 1, max: 10, aggregate: 'avg', showInSummary: true, section: 'Ratings' },
  { key: 'defenseRating', label: 'Defense Rating', type: 'slider', min: 1, max: 10, aggregate: 'avg', showInSummary: true, section: 'Ratings' },
  { key: 'overallRating', label: 'Overall Rating', type: 'slider', min: 1, max: 10, aggregate: 'avg', showInSummary: true, rankMetric: true, section: 'Ratings' },
  { key: 'coreValuesRating', label: 'Alliance Interest', type: 'rating', max: 3, aggregate: 'avg', section: 'Ratings' },
  // Archived — legacy columns the current pit form does not collect.
  { key: 'teamName', label: 'Team Name', type: 'text', archived: true },
  { key: 'robotName', label: 'Robot Name', type: 'text', archived: true },
  { key: 'weight', label: 'Weight', type: 'number', archived: true },
  { key: 'speed', label: 'Speed', type: 'number', archived: true },
  { key: 'height', label: 'Height', type: 'number', archived: true },
  { key: 'fuelCapacity', label: 'Fuel Capacity', type: 'number', archived: true },
  { key: 'traversalAbility', label: 'Traversal Ability', type: 'text', archived: true },
  { key: 'shooterType', label: 'Shooter Type', type: 'text', archived: true },
  { key: 'autoOptions', label: 'Auto Options', type: 'multiselect', archived: true },
];

export const BUILTIN_MATCH_FIELDS: TemplateField[] = [
  { key: 'matchNumber', label: 'Match Number', type: 'number', identity: true, required: true, section: 'Match' },
  { key: 'matchType', label: 'Match Type', type: 'select', options: ['practice', 'qualification', 'elimination'], identity: true, section: 'Match' },
  { key: 'teamNumber', label: 'Team Number', type: 'number', identity: true, required: true, section: 'Match' },
  { key: 'alliance', label: 'Alliance', type: 'select', options: ['Red', 'Blue'], identity: true, section: 'Match' },
  { key: 'autoUsed', label: 'Auto Routine Used', type: 'select', dynamicOptions: 'pitAutoRoutines', allowCustom: true, section: 'Autonomous' },
  { key: 'autoFuelTotal', label: 'Auto Period Fuel', type: 'counter', min: 0, quickAdd: [5, 10], aggregate: 'avg', showInSummary: true, section: 'Auto' },
  { key: 'teleopFuelTotal', label: 'Tele-Op Period Fuel', type: 'counter', min: 0, quickAdd: [5, 10], aggregate: 'avg', showInSummary: true, rankMetric: true, section: 'Tele-Op' },
  { key: 'coralScored', label: 'Fuel Accuracy (1 = always misses → 5 = always hits)', type: 'rating', max: 5, aggregate: 'avg', showInSummary: true, section: 'Scoring' },
  { key: 'endClimbLevel', label: 'Climb Level (0 = no climb)', type: 'counter', min: 0, max: 3, aggregate: 'avg', showInSummary: true, section: 'Endgame' },
  { key: 'penalties', label: 'Penalties', type: 'counter', min: 0, aggregate: 'avg', section: 'Match' },
  { key: 'drivingSkillRating', label: 'Driving Skill Rating', type: 'rating', max: 5, aggregate: 'avg', section: 'Ratings' },
  { key: 'notes', label: 'Notes', type: 'textarea', section: 'Notes', placeholder: 'Match observations…' },
  // Archived — legacy columns the current match form does not collect.
  { key: 'autoScore', label: 'Auto Score', type: 'number', archived: true },
  { key: 'teleopScore', label: 'Teleop Score', type: 'number', archived: true },
  { key: 'endgameScore', label: 'Endgame Score', type: 'number', archived: true },
  { key: 'algaeScored', label: 'Algae Scored', type: 'number', archived: true },
  { key: 'autoClimb', label: 'Auto Climb', type: 'boolean', archived: true },
  { key: 'humanPlayerScore', label: 'Human Player Score', type: 'number', archived: true },
  { key: 'matchDefenseRating', label: 'Defense Rating (legacy)', type: 'rating', max: 3, archived: true },
  { key: 'matchCoreValuesRating', label: 'Core Values (legacy)', type: 'rating', max: 3, archived: true },
];

export const BUILTIN_TEMPLATES: Record<ScoutKind, ScoutingTemplateShape> = {
  pit: { kind: 'pit', name: 'Built-in Pit (Legacy)', fields: BUILTIN_PIT_FIELDS },
  match: { kind: 'match', name: 'Built-in Match (Legacy)', fields: BUILTIN_MATCH_FIELDS },
};

// ---------------------------------------------------------------------------
// Game presets. BUILTIN_* above is frozen: it is the legacy column mapping and
// must not change. Presets are what new seasons and the template builder start
// from. Keys shared with the built-ins reuse the built-in type deliberately, so
// switching a season to a preset carries those fields' old data forward.
//
// BIOBUZZ (FTC 2026–27) fields follow the official Competition Manual §10.5
// (TU05): LEAVE 3 / AUTO PARK 5 / HIVE TIP 20 (auto+teleop) / POLLEN-NECTAR
// left in an upward CELL 2 / owned FLOWER 2 each / Bottom NECTAR Bonus 5 /
// GARDEN 1 / end PARK 5; SWARM RP = LEAVE+PARK points ≥ 16, POLLINATOR RPs =
// HIVE TIPS ≥ 4 and ≥ 7. Scouting tracks per-robot contributions to those.
// ---------------------------------------------------------------------------

const MATCH_IDENTITY_FIELDS: TemplateField[] = BUILTIN_MATCH_FIELDS.filter(f => f.identity);
const PIT_IDENTITY_FIELDS: TemplateField[] = BUILTIN_PIT_FIELDS.filter(f => f.identity);
const builtin = (fields: TemplateField[], key: string) => fields.find(f => f.key === key)!;

export const BIOBUZZ_MATCH_FIELDS: TemplateField[] = [
  ...MATCH_IDENTITY_FIELDS,
  builtin(BUILTIN_MATCH_FIELDS, 'autoUsed'),
  { key: 'autoLeave', label: 'Left the Wall (LEAVE)', type: 'boolean', aggregate: 'rate', showInSummary: true, section: 'Auto' },
  { key: 'autoPark', label: 'Parked in Loading Zone (AUTO PARK)', type: 'boolean', aggregate: 'rate', section: 'Auto' },
  { key: 'autoLaunched', label: 'Auto Pollen Launched into Cell', type: 'counter', min: 0, aggregate: 'avg', showInSummary: true, section: 'Auto' },
  { key: 'autoTips', label: 'Auto Hive Tips', type: 'counter', min: 0, aggregate: 'avg', section: 'Auto' },
  { key: 'teleopLaunched', label: 'Tele-Op Pollen Launched into Cell', type: 'counter', min: 0, quickAdd: [5], aggregate: 'avg', showInSummary: true, rankMetric: true, section: 'Tele-Op' },
  { key: 'teleopTips', label: 'Tele-Op Hive Tips', type: 'counter', min: 0, aggregate: 'avg', showInSummary: true, section: 'Tele-Op' },
  { key: 'gardenPlaced', label: 'Pollen / Nectar into Garden', type: 'counter', min: 0, aggregate: 'avg', section: 'Tele-Op' },
  { key: 'flowerPlaced', label: 'Pollen / Nectar into Flowers (last 60s)', type: 'counter', min: 0, aggregate: 'avg', showInSummary: true, section: 'Endgame' },
  { key: 'flowerOwned', label: 'Placed the Top Nectar (owned a Flower)', type: 'boolean', aggregate: 'rate', section: 'Endgame' },
  { key: 'endPark', label: 'Parked in Loading Zone at End', type: 'boolean', aggregate: 'rate', showInSummary: true, section: 'Endgame' },
  { key: 'launchAccuracy', label: 'Launch Accuracy (1 = always misses → 5 = always hits)', type: 'rating', max: 5, aggregate: 'avg', section: 'Ratings' },
  builtin(BUILTIN_MATCH_FIELDS, 'drivingSkillRating'),
  builtin(BUILTIN_MATCH_FIELDS, 'penalties'),
  builtin(BUILTIN_MATCH_FIELDS, 'notes'),
];

export const BIOBUZZ_PIT_FIELDS: TemplateField[] = [
  ...PIT_IDENTITY_FIELDS,
  { ...builtin(BUILTIN_PIT_FIELDS, 'drivetrain'), options: ['Mecanum', 'Tank', 'Swerve', 'X-Drive', 'Other'] },
  { key: 'canLaunch', label: 'Can launch into Cells', type: 'boolean', section: 'Capabilities' },
  { key: 'canFlower', label: 'Can place into Flowers', type: 'boolean', section: 'Capabilities' },
  { key: 'canGarden', label: 'Can score in the Garden', type: 'boolean', section: 'Capabilities' },
  { key: 'reliablePark', label: 'Reliably parks in the Loading Zone', type: 'boolean', section: 'Capabilities' },
  { key: 'cycleTime', label: 'Estimated cycle time (seconds)', type: 'number', aggregate: 'avg', section: 'Capabilities' },
  { ...builtin(BUILTIN_PIT_FIELDS, 'autoOptions'), label: 'Auto Routines', section: 'Autonomous', placeholder: 'Add a routine and press Enter', archived: undefined },
  builtin(BUILTIN_PIT_FIELDS, 'autonomousRoutine'),
  builtin(BUILTIN_PIT_FIELDS, 'capabilities'),
  builtin(BUILTIN_PIT_FIELDS, 'deficiencies'),
  builtin(BUILTIN_PIT_FIELDS, 'photoUrl'),
  builtin(BUILTIN_PIT_FIELDS, 'offenseRating'),
  builtin(BUILTIN_PIT_FIELDS, 'defenseRating'),
  builtin(BUILTIN_PIT_FIELDS, 'overallRating'),
  builtin(BUILTIN_PIT_FIELDS, 'coreValuesRating'),
  builtin(BUILTIN_PIT_FIELDS, 'notes'),
];

export interface ScoutingPreset {
  id: string;
  label: string;
  fields: Record<ScoutKind, TemplateField[]>;
}

export const SCOUTING_PRESETS: ScoutingPreset[] = [
  { id: 'biobuzz', label: 'BIOBUZZ — FTC 2026–27', fields: { pit: BIOBUZZ_PIT_FIELDS, match: BIOBUZZ_MATCH_FIELDS } },
  { id: 'blank', label: 'Blank (identity fields only)', fields: { pit: PIT_IDENTITY_FIELDS, match: MATCH_IDENTITY_FIELDS } },
];

/** What a new season starts with, and what an event with no season scouts with. */
export const DEFAULT_PRESET_ID = 'biobuzz';
export const DEFAULT_TEMPLATES: Record<ScoutKind, ScoutingTemplateShape> = {
  pit: { kind: 'pit', name: 'BIOBUZZ Pit', fields: BIOBUZZ_PIT_FIELDS },
  match: { kind: 'match', name: 'BIOBUZZ Match', fields: BIOBUZZ_MATCH_FIELDS },
};

/**
 * Switch a template to a preset without breaking its existing records. Keys are
 * permanent, so a previously saved field the preset doesn't use is archived
 * rather than dropped, and a saved field always keeps its saved type even when
 * the preset defines that key differently — old `data` blobs stay readable.
 */
export function applyPreset(saved: TemplateField[], preset: TemplateField[]): TemplateField[] {
  const savedByKey = new Map(saved.map(f => [f.key, f]));
  const presetKeys = new Set(preset.map(f => f.key));
  const fields: TemplateField[] = preset.map(p => {
    const prev = savedByKey.get(p.key);
    const base = prev && prev.type !== p.type ? prev : p;
    return { ...base, archived: undefined, archivedAt: undefined };
  });
  for (const f of saved) {
    if (!presetKeys.has(f.key)) fields.push({ ...f, archived: true, archivedAt: f.archivedAt ?? Date.now() });
  }
  return fields;
}

// The two legacy match columns `defense_rating` / `core_values_rating` collide
// by camelCase name with pit keys but, more importantly, are not collected by
// the live match form. Their data-blob keys differ from the DB column so the
// mapping below is explicit rather than a blind 1:1 for those two.
const MATCH_LEGACY_KEY_TO_COLUMN: Record<string, string> = {
  matchDefenseRating: 'defenseRating',
  matchCoreValuesRating: 'coreValuesRating',
};
const MATCH_COLUMN_TO_LEGACY_KEY: Record<string, string> = {
  defenseRating: 'matchDefenseRating',
  coreValuesRating: 'matchCoreValuesRating',
};

/** Field keys (active + archived) for a built-in kind, in template order. */
export function builtinFieldKeys(kind: ScoutKind): string[] {
  return BUILTIN_TEMPLATES[kind].fields.map(f => f.key);
}

// Row meta columns that are NOT part of the field `data` blob.
const META_COLUMNS = new Set([
  'id', 'eventId', 'scoutedBy', 'createdAt', 'updatedAt', 'templateId', 'data',
]);

/**
 * Build the `data` blob for a legacy scout row by reading its columns. Keys of
 * the blob are the built-in field keys; values come straight from the matching
 * column (with the two remapped match columns handled explicitly). Undefined
 * columns are skipped so the blob stays sparse and honest.
 */
export function dataFromLegacyRow(kind: ScoutKind, row: Record<string, any>): Record<string, any> {
  const data: Record<string, any> = {};
  for (const field of BUILTIN_TEMPLATES[kind].fields) {
    const column = kind === 'match' && MATCH_LEGACY_KEY_TO_COLUMN[field.key]
      ? MATCH_LEGACY_KEY_TO_COLUMN[field.key]
      : field.key;
    if (row[column] !== undefined && row[column] !== null && !META_COLUMNS.has(column)) {
      data[field.key] = row[column];
    }
  }
  return data;
}

/**
 * Inverse of dataFromLegacyRow: derive legacy column values from a `data` blob
 * for the built-in template, so writes can dual-write legacy columns (rollback
 * safety) during the transition. Only known built-in keys are mapped; unknown
 * (custom-template) keys are ignored here and live only in `data`.
 */
export function legacyColumnsFromData(kind: ScoutKind, data: Record<string, any>): Record<string, any> {
  const cols: Record<string, any> = {};
  if (!data) return cols;
  for (const field of BUILTIN_TEMPLATES[kind].fields) {
    if (data[field.key] === undefined) continue;
    const column = kind === 'match' && MATCH_LEGACY_KEY_TO_COLUMN[field.key]
      ? MATCH_LEGACY_KEY_TO_COLUMN[field.key]
      : field.key;
    cols[column] = data[field.key];
  }
  return cols;
}

export { MATCH_COLUMN_TO_LEGACY_KEY };

// ---------------------------------------------------------------------------
// Template edit validation — enforces the mid-season resilience contract.
// ---------------------------------------------------------------------------

/** Identity field keys that must always be present and are never archivable. */
export const IDENTITY_KEYS: Record<ScoutKind, string[]> = {
  pit: ['teamNumber'],
  match: ['matchNumber', 'matchType', 'teamNumber', 'alliance'],
};

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export interface TemplateValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate a proposed set of fields for a template of `kind`. When `previous`
 * is provided (an edit), enforces append-only: no previously-saved key may be
 * dropped, and a saved key's `type` may not change. Archiving (setting
 * archived:true) is allowed; removing the entry entirely is not.
 */
export function validateTemplateFields(
  kind: ScoutKind,
  fields: TemplateField[],
  previous?: TemplateField[],
): TemplateValidationResult {
  if (!Array.isArray(fields)) return { ok: false, error: 'fields must be an array' };

  const seen = new Set<string>();
  for (const f of fields) {
    if (!f || typeof f.key !== 'string' || !KEY_RE.test(f.key)) {
      return { ok: false, error: `Invalid field key: ${JSON.stringify(f?.key)}` };
    }
    if (seen.has(f.key)) return { ok: false, error: `Duplicate field key: ${f.key}` };
    seen.add(f.key);
    if (typeof f.label !== 'string' || !f.label.trim()) {
      return { ok: false, error: `Field ${f.key} needs a label` };
    }
  }

  // Identity fields must be present and not archived.
  for (const idKey of IDENTITY_KEYS[kind]) {
    const f = fields.find(x => x.key === idKey);
    if (!f) return { ok: false, error: `Missing required identity field: ${idKey}` };
    if (f.archived) return { ok: false, error: `Identity field cannot be archived: ${idKey}` };
  }

  if (previous) {
    const byKey = new Map(fields.map(f => [f.key, f]));
    for (const prev of previous) {
      const next = byKey.get(prev.key);
      if (!next) {
        return { ok: false, error: `Field "${prev.key}" cannot be removed — archive it instead` };
      }
      if (next.type !== prev.type) {
        return { ok: false, error: `Field "${prev.key}" type cannot change (${prev.type} → ${next.type})` };
      }
    }
  }

  return { ok: true };
}

/** Generate a stable snake_case key from a label, uniquified against `taken`. */
export function keyFromLabel(label: string, taken: Set<string> = new Set()): string {
  let base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base || !/^[a-z]/.test(base)) base = `field_${base}`;
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}
