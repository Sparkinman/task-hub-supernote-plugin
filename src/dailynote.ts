import {MONTHS} from './calendar';
import {formatDate, type DateFormat} from './format';

/**
 * Where a day's note lives.
 *
 * The layout is a token template rather than a fixed scheme so the folder tree
 * can match whatever convention the user already keeps on the device. Paths are
 * built here, in pure code, so the rules are testable without hardware.
 */

export interface DailyNoteConfig {
  /**
   * Whether this kind of note is offered at all.
   *
   * Turning one off hides its buttons from the views rather than deleting
   * anything: somebody who keeps a weekly review but no monthly one should not
   * have a Create month note button on the screen they use every day, and the
   * settings for it are still there if they change their mind.
   *
   * Always set — the sanitiser fills it in as true for a settings file written
   * before the switches existed, since those users already have these notes.
   */
  enabled: boolean;
  /** Folder under shared storage, e.g. 'Note/Daily'. */
  root: string;
  /** Token template for the path below the root, without the .note extension. */
  layout: string;
  /** Optional .note template path passed to createNote; blank means the default. */
  template: string;
}

export const DEFAULT_DAILY_NOTE: DailyNoteConfig = {
  enabled: true,
  root: 'Note/Daily',
  layout: '{YYYY}/{MM}-{MMMM}/{DATE}',
  template: '',
};

export const LAYOUT_PRESETS: {key: string; label: string; layout: string}[] = [
  {key: 'ymd', label: 'Year / Month / Date', layout: '{YYYY}/{MM}-{MMMM}/{DATE}'},
  {key: 'ym', label: 'Year-Month / Date', layout: '{YYYY}-{MM}/{DATE}'},
  {key: 'y', label: 'Year / Date', layout: '{YYYY}/{DATE}'},
  {key: 'flat', label: 'All in one folder', layout: '{DATE}'},
];

/**
 * Characters that cannot appear in a path segment.
 *
 * `/` matters most: a user whose display format is MM/DD/YYYY would otherwise
 * turn {DATE} into three nested directories.
 */
function safeSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim();
}

/** Collapse repeated and trailing slashes without touching the segments. */
function tidyPath(value: string): string {
  return value
    .split('/')
    .map(part => part.trim())
    .filter(Boolean)
    .join('/');
}

export function expandLayout(layout: string, iso: string, dateFormat: DateFormat): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return '';
  }
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1] ?? month;

  const tokens: Record<string, string> = {
    '{YYYY}': year,
    '{MM}': month,
    '{MMM}': monthName.slice(0, 3),
    '{MMMM}': monthName,
    '{DD}': day,
    '{ISO}': iso,
    // The user's chosen display format, made path-safe.
    '{DATE}': safeSegment(formatDate(iso, dateFormat)),
  };

  let out = layout;
  for (const [token, value] of Object.entries(tokens)) {
    out = out.split(token).join(value);
  }

  // Sanitise each segment, but only after expansion, so the template's own
  // slashes still separate folders.
  return tidyPath(
    out
      .split('/')
      .map(segment => safeSegment(segment))
      .join('/'),
  );
}

/** Full path relative to shared storage, including the .note extension. */
export function dailyNotePath(
  config: DailyNoteConfig,
  iso: string,
  dateFormat: DateFormat,
): string {
  const body = expandLayout(config.layout, iso, dateFormat);
  if (!body) {
    return '';
  }
  return `${tidyPath(config.root)}/${body}.note`;
}

/** Directory portion of a note path, for creating the tree before writing. */
export function parentDir(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

/**
 * Which of `days` already have a note.
 *
 * Compares against a set of known paths rather than asking the device per day:
 * a month grid covers 42 days, and that many native calls per render would be
 * visibly slow.
 */
export function daysWithNotes(
  existing: string[],
  days: string[],
  config: DailyNoteConfig,
  dateFormat: DateFormat,
): Set<string> {
  // Normalise separators — the device reports paths with forward slashes, but
  // be tolerant of backslashes rather than silently matching nothing.
  const known = new Set(existing.map(p => p.replace(/\\/g, '/').toLowerCase()));
  const found = new Set<string>();
  for (const iso of days) {
    const path = dailyNotePath(config, iso, dateFormat);
    if (path && known.has(path.toLowerCase())) {
      found.add(iso);
    }
  }
  return found;
}
