import {MONTHS} from './calendar';
import {formatDate, type DateFormat} from './format';
import {dailyNotePath, type DailyNoteConfig} from './dailynote';

/**
 * Notes that belong to a stretch of time rather than to a day.
 *
 * A week, a month, a quarter and a year each get their own note, configured
 * independently of the daily note and of each other: somebody who keeps a
 * weekly review in one folder and a quarterly plan in another should not have to
 * accept one scheme for all of them.
 *
 * The day period is here too, but only so callers can treat all five uniformly.
 * It delegates to `dailyNotePath`, so a daily note's path is decided by exactly
 * the code that has always decided it and nothing about existing notes moves.
 *
 * **Weeks start on Sunday**, matching the week view the user is looking at when
 * they press the button. ISO-8601 would say Monday, but a note whose start does
 * not match the grid it was created from is a note filed under a date the user
 * did not pick.
 *
 * Pure on purpose: no SDK import, so jest can exercise the path rules
 * off-device.
 */

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** Same shape as a daily note's: a switch, a root, a token layout, a template. */
export type PeriodNoteConfig = DailyNoteConfig;

export const PERIODS: {key: Period; label: string; noun: string}[] = [
  {key: 'day', label: 'Day', noun: 'daily note'},
  {key: 'week', label: 'Week', noun: 'weekly note'},
  {key: 'month', label: 'Month', noun: 'monthly note'},
  {key: 'quarter', label: 'Quarter', noun: 'quarterly note'},
  {key: 'year', label: 'Year', noun: 'yearly note'},
];

export const DEFAULT_WEEK_NOTE: PeriodNoteConfig = {
  enabled: true,
  root: 'Note/Weekly',
  layout: '{YYYY}/W{WW}',
  template: '',
};

export const DEFAULT_MONTH_NOTE: PeriodNoteConfig = {
  enabled: true,
  root: 'Note/Monthly',
  layout: '{YYYY}/{MM}-{MMMM}',
  template: '',
};

export const DEFAULT_QUARTER_NOTE: PeriodNoteConfig = {
  enabled: true,
  root: 'Note/Quarterly',
  layout: '{YYYY}/{QQ}',
  template: '',
};

export const DEFAULT_YEAR_NOTE: PeriodNoteConfig = {
  enabled: true,
  root: 'Note/Yearly',
  layout: '{YYYY}',
  template: '',
};

/** Layout choices offered per period, mirroring the daily note's presets. */
export const PERIOD_LAYOUT_PRESETS: Record<
  Exclude<Period, 'day'>,
  {key: string; label: string; layout: string}[]
> = {
  week: [
    {key: 'y-w', label: 'Year / Week number', layout: '{YYYY}/W{WW}'},
    {key: 'y-m-w', label: 'Year / Month / Week', layout: '{YYYY}/{MM}-{MMMM}/W{WW}'},
    {key: 'y-start', label: 'Year / Week starting', layout: '{YYYY}/Week of {START}'},
    {key: 'flat', label: 'All in one folder', layout: '{YYYY}-W{WW}'},
  ],
  month: [
    {key: 'y-m', label: 'Year / Month', layout: '{YYYY}/{MM}-{MMMM}'},
    {key: 'y-name', label: 'Year / Month name', layout: '{YYYY}/{MMMM}'},
    {key: 'flat', label: 'All in one folder', layout: '{YYYY}-{MM}'},
  ],
  quarter: [
    {key: 'y-q', label: 'Year / Quarter', layout: '{YYYY}/{QQ}'},
    {key: 'y-q-months', label: 'Year / Quarter and months', layout: '{YYYY}/{QQ} {MMM}-{MMM_END}'},
    {key: 'flat', label: 'All in one folder', layout: '{YYYY}-{QQ}'},
  ],
  year: [
    {key: 'flat', label: 'All in one folder', layout: '{YYYY}'},
    {key: 'nested', label: 'Year folder', layout: '{YYYY}/{YYYY}'},
  ],
};

function safeSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim();
}

function tidyPath(value: string): string {
  return value
    .split('/')
    .map(part => part.trim())
    .filter(Boolean)
    .join('/');
}

function parseIso(iso: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : null;
}

function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The first day of the period a date falls in — the note's identity.
 *
 * Every day inside one week must produce the same path, or Tuesday and Thursday
 * get different "weekly" notes.
 */
export function periodStart(period: Period, iso: string): string {
  const date = parseIso(iso);
  if (!date) {
    return '';
  }
  switch (period) {
    case 'day':
      return iso;
    case 'week': {
      const start = new Date(date);
      start.setDate(start.getDate() - start.getDay());
      return toIso(start);
    }
    case 'month':
      return toIso(new Date(date.getFullYear(), date.getMonth(), 1));
    case 'quarter':
      return toIso(new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1));
    case 'year':
      return toIso(new Date(date.getFullYear(), 0, 1));
  }
}

/** The last day of the period, for ranges shown to the user. */
export function periodEnd(period: Period, iso: string): string {
  const start = parseIso(periodStart(period, iso));
  if (!start) {
    return '';
  }
  const end = new Date(start);
  switch (period) {
    case 'day':
      break;
    case 'week':
      end.setDate(end.getDate() + 6);
      break;
    case 'month':
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
      break;
    case 'quarter':
      end.setMonth(end.getMonth() + 3);
      end.setDate(0);
      break;
    case 'year':
      end.setMonth(end.getMonth() + 12);
      end.setDate(0);
      break;
  }
  return toIso(end);
}

/**
 * Week number within the year of the week's own Sunday.
 *
 * Counted from the week containing 1 January, which is the convention that goes
 * with Sunday-start weeks. A week straddling New Year belongs to the year its
 * Sunday is in, so `{YYYY}` and `{WW}` in a layout never disagree.
 */
export function weekNumber(iso: string): number {
  const start = parseIso(periodStart('week', iso));
  if (!start) {
    return 0;
  }
  const jan1 = new Date(start.getFullYear(), 0, 1);
  const dayOfYear = Math.round((start.getTime() - jan1.getTime()) / 86400000);
  return Math.floor((dayOfYear + jan1.getDay()) / 7) + 1;
}

/** 1–4. */
export function quarterNumber(iso: string): number {
  const date = parseIso(iso);
  return date ? Math.floor(date.getMonth() / 3) + 1 : 0;
}

/** How the period reads in a sentence, e.g. "week of 6 Sep" or "Q3 2026". */
export function periodLabel(period: Period, iso: string, dateFormat: DateFormat): string {
  const start = periodStart(period, iso);
  if (!start) {
    return '';
  }
  const date = parseIso(start)!;
  switch (period) {
    case 'day':
      return formatDate(start, dateFormat);
    case 'week':
      return `week of ${formatDate(start, dateFormat)}`;
    case 'month':
      return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    case 'quarter':
      return `Q${quarterNumber(start)} ${date.getFullYear()}`;
    case 'year':
      return String(date.getFullYear());
  }
}

/** Expand a layout for a period. Unknown tokens are left as written. */
export function expandPeriodLayout(
  period: Period,
  layout: string,
  iso: string,
  dateFormat: DateFormat,
): string {
  const start = periodStart(period, iso);
  const end = periodEnd(period, iso);
  const date = parseIso(start);
  if (!date) {
    return '';
  }
  const endDate = parseIso(end)!;
  const pad = (n: number) => String(n).padStart(2, '0');
  const month = MONTHS[date.getMonth()] ?? '';
  const endMonth = MONTHS[endDate.getMonth()] ?? '';
  const quarter = quarterNumber(start);

  const tokens: Record<string, string> = {
    '{YYYY}': String(date.getFullYear()),
    '{MM}': pad(date.getMonth() + 1),
    '{MMM}': month.slice(0, 3),
    '{MMMM}': month,
    '{MMM_END}': endMonth.slice(0, 3),
    '{MMMM_END}': endMonth,
    '{DD}': pad(date.getDate()),
    '{WW}': pad(weekNumber(start)),
    '{W}': String(weekNumber(start)),
    '{Q}': String(quarter),
    '{QQ}': `Q${quarter}`,
    '{ISO}': start,
    '{ISO_END}': end,
    '{START}': safeSegment(formatDate(start, dateFormat)),
    '{END}': safeSegment(formatDate(end, dateFormat)),
    '{DATE}': safeSegment(formatDate(start, dateFormat)),
  };

  let out = layout;
  for (const [token, value] of Object.entries(tokens)) {
    out = out.split(token).join(value);
  }

  return tidyPath(
    out
      .split('/')
      .map(segment => safeSegment(segment))
      .join('/'),
  );
}

/**
 * Full path for a period's note, relative to shared storage.
 *
 * The day case goes through `dailyNotePath` unchanged, so existing daily notes
 * keep exactly the paths they already have.
 */
export function periodNotePath(
  period: Period,
  config: PeriodNoteConfig,
  iso: string,
  dateFormat: DateFormat,
): string {
  if (period === 'day') {
    return dailyNotePath(config, iso, dateFormat);
  }
  const body = expandPeriodLayout(period, config.layout, iso, dateFormat);
  if (!body) {
    return '';
  }
  const root = tidyPath(config.root);
  if (!root) {
    return '';
  }
  return `${root}/${body}.note`;
}

/**
 * Whether this period's note already exists, given the paths already listed.
 *
 * Takes the known paths rather than asking the device, for the same reason
 * `daysWithNotes` does: a quarter view asks about three months at once and a
 * native call per cell would be visibly slow.
 */
export function hasPeriodNote(
  existing: string[],
  period: Period,
  config: PeriodNoteConfig,
  iso: string,
  dateFormat: DateFormat,
): boolean {
  const path = periodNotePath(period, config, iso, dateFormat);
  if (!path) {
    return false;
  }
  const known = new Set(existing.map(p => p.replace(/\\/g, '/').toLowerCase()));
  return known.has(path.toLowerCase());
}

/** The three months of the quarter `iso` falls in, as first-of-month dates. */
export function quarterMonths(iso: string): string[] {
  const start = parseIso(periodStart('quarter', iso));
  if (!start) {
    return [];
  }
  return [0, 1, 2].map(offset =>
    toIso(new Date(start.getFullYear(), start.getMonth() + offset, 1)),
  );
}

/** Shift an anchor date by whole quarters, keeping it on the first of a month. */
export function shiftQuarter(iso: string, quarters: number): string {
  const start = parseIso(periodStart('quarter', iso));
  if (!start) {
    return iso;
  }
  return toIso(new Date(start.getFullYear(), start.getMonth() + quarters * 3, 1));
}
