/* eslint-disable no-bitwise -- base64 encoding is inherently bitwise */
/**
 * Pure iCalendar / encoding helpers.
 *
 * Deliberately free of any sn-plugin-lib import: the SDK resolves a TurboModule
 * at import time, which only exists inside the on-device native binary. Keeping
 * this module SDK-free is what lets the formatting logic be unit-tested off-device.
 */

import {parsePriority} from './priority';

// Hermes has no global btoa, and RN does not polyfill it. Basic auth needs one.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(input: string): string {
  // Encode to UTF-8 bytes first — Radicale accepts non-ASCII credentials.
  const bytes: number[] = [];
  for (const char of input) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 0x3f];
  }
  return out;
}

/** RFC 5545 text escaping: backslash, semicolon, comma, newline. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold content lines to 75 octets per RFC 5545 §3.1. */
function fold(line: string): string {
  if (line.length <= 75) {
    return line;
  }
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length > 0) {
    parts.push(' ' + rest);
  }
  return parts.join('\r\n');
}

function utcStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Stamped on every task and event this plugin creates.
 *
 * Task Hub's documented enum has no Supernote value — items arriving over
 * CalDAV are all "radicale", which would make anything written here
 * indistinguishable from any other CalDAV client. A distinct value keeps the
 * provenance visible; Task Hub's own fallback table renders an unrecognised
 * value as "3rd party" until it learns this one.
 */
export const ORIGIN_PROPERTY = 'X-TASKHUB-ORIGIN';
export const ORIGIN_VALUE = 'supernote';
export const ORIGIN_NAME_PROPERTY = 'X-TASKHUB-ORIGIN-NAME';
export const ORIGIN_NAME_VALUE = 'Supernote';

/**
 * Where a captured task came from on the device.
 *
 * Custom properties rather than text in DESCRIPTION, so the description stays
 * the user's to write in and the link survives them editing it. Other CalDAV
 * clients ignore unknown X- properties, and our own edits preserve them.
 */
export const SOURCE_PROPERTY = 'X-TASKHUB-SOURCE';
export const SOURCE_PAGE_PROPERTY = 'X-TASKHUB-SOURCE-PAGE';

export function newUid(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${rand()}${rand()}-taskhub`;
}

/** A task read back from the server. */
export interface VTodo {
  uid: string;
  summary: string;
  description?: string;
  /** Original DUE value, kept for display. */
  dueDate?: string;
  dueTime?: string;
  /** Epoch ms for sorting and filtering; null when the task has no due date. */
  dueAt: number | null;
  /**
   * Optional DTSTART. A VTODO carrying both DTSTART and DUE is a task that runs
   * across days, and the range is INCLUSIVE of the due date — unlike a VEVENT,
   * whose all-day DTEND is exclusive. Most tasks carry DUE alone.
   */
  startDate?: string;
  startAt?: number | null;
  status: string;
  completed: boolean;
  /** Note this task was captured from, when it came from a lasso on device. */
  sourcePath?: string;
  sourcePage?: number;
  /**
   * UID of the task this one is a step of, from RELATED-TO;RELTYPE=PARENT.
   *
   * A component may carry several RELATED-TO lines with different relationship
   * types — PARENT, CHILD and SIBLING are all legal — so the first one is not
   * necessarily the parent. An absent RELTYPE means PARENT by RFC 5545, which
   * is why that is the default rather than a reason to skip the line.
   */
  parentUid?: string;
  /**
   * RFC 5545 PRIORITY, 0–9, absent when the task carries no such line.
   *
   * Stored as the raw number rather than as a band so an edit that does not
   * touch importance writes back exactly what another client set. See
   * `priority.ts` for how the number becomes something a person can read.
   */
  priority?: number;
  /**
   * The RRULE value as stored, without the property name — e.g. `FREQ=WEEKLY`.
   *
   * Kept verbatim rather than reduced to one of the picker's choices, so a rule
   * this plugin cannot name survives an edit untouched. See `recurrence.ts`.
   */
  rrule?: string;
  /** Task Hub's X-TASKHUB-ORIGIN, absent when another client wrote the item. */
  origin?: string;
  /** Optional human-readable account label, X-TASKHUB-ORIGIN-NAME. */
  originName?: string;
}

/** Undo RFC 5545 line folding: CRLF (or LF) followed by one space or tab. */
function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, '');
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch) =>
    ch === 'n' || ch === 'N' ? '\n' : ch,
  );
}

/**
 * Parse DUE into local-ish display parts plus a sortable instant.
 *
 * Three shapes occur in the wild: VALUE=DATE (all-day), a UTC instant ending in
 * Z, and a floating local date-time with no zone at all.
 */
function parseDue(raw: string, isDateOnly: boolean): Pick<VTodo, 'dueDate' | 'dueTime' | 'dueAt'> {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(raw.trim());
  if (!match) {
    return {dueAt: null};
  }
  const [, y, m, d, hh, mm, , zulu] = match;

  if (isDateOnly || hh === undefined) {
    // All-day: anchor to local midnight so "today" comparisons behave.
    return {
      dueDate: `${y}-${m}-${d}`,
      dueAt: new Date(Number(y), Number(m) - 1, Number(d)).getTime(),
    };
  }

  const instant = zulu
    ? Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm))
    : new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)).getTime();

  const local = new Date(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dueDate: toDateInput(local),
    dueTime: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
    dueAt: instant,
  };
}

/** Extract every VTODO from one or more calendar objects. */
export function parseVTodos(text: string): VTodo[] {
  const lines = unfold(text).split(/\r?\n/);
  const todos: VTodo[] = [];
  let current: Partial<VTodo> | null = null;
  let completedStamp = false;
  let percentComplete = 0;

  for (const line of lines) {
    if (line === 'BEGIN:VTODO') {
      current = {};
      completedStamp = false;
      percentComplete = 0;
      continue;
    }
    if (line === 'END:VTODO') {
      if (current?.uid) {
        const status = current.status ?? 'NEEDS-ACTION';
        // Not every client writes STATUS:COMPLETED. Some record completion only
        // as a COMPLETED timestamp, others only as PERCENT-COMPLETE:100. Reading
        // just STATUS leaves those tasks looking open forever.
        const completed =
          status === 'COMPLETED' || completedStamp || percentComplete >= 100;
        todos.push({
          uid: current.uid,
          summary: current.summary ?? '(untitled)',
          description: current.description,
          dueDate: current.dueDate,
          dueTime: current.dueTime,
          dueAt: current.dueAt ?? null,
          startDate: current.startDate,
          startAt: current.startAt ?? null,
          status: completed ? 'COMPLETED' : status,
          completed,
          parentUid: current.parentUid,
          priority: current.priority,
          rrule: current.rrule,
          sourcePath: current.sourcePath,
          sourcePage: current.sourcePage,
          origin: current.origin,
          originName: current.originName,
        });
      }
      current = null;
      completedStamp = false;
      percentComplete = 0;
      continue;
    }
    if (!current) {
      continue;
    }

    const colon = line.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const rawName = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...params] = rawName.split(';');

    switch (name.toUpperCase()) {
      case 'UID':
        current.uid = value.trim();
        break;
      case 'SUMMARY':
        current.summary = unescapeText(value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(value);
        break;
      case 'RELATED-TO': {
        // Only a parent relationship makes this task a step of another. Taking
        // any RELATED-TO would hang tasks off their own siblings.
        const reltype = params
          .map(p => /^RELTYPE=(.*)$/i.exec(p.trim()))
          .find(Boolean)?.[1];
        if (!reltype || reltype.trim().toUpperCase() === 'PARENT') {
          const parent = value.trim();
          if (parent) {
            current.parentUid = parent;
          }
        }
        break;
      }
      case 'PRIORITY':
        current.priority = parsePriority(value);
        break;
      case 'RRULE':
        current.rrule = value.trim();
        break;
      case 'STATUS':
        current.status = value.trim().toUpperCase();
        break;
      case 'COMPLETED':
        completedStamp = value.trim().length > 0;
        break;
      case 'PERCENT-COMPLETE':
        percentComplete = Number(value.trim()) || 0;
        break;
      case 'X-TASKHUB-ORIGIN':
        current.origin = value.trim().toLowerCase();
        break;
      case 'X-TASKHUB-ORIGIN-NAME':
        current.originName = unescapeText(value);
        break;
      case 'X-TASKHUB-SOURCE':
        current.sourcePath = unescapeText(value);
        break;
      case 'X-TASKHUB-SOURCE-PAGE': {
        const page = Number(value.trim());
        current.sourcePage = Number.isFinite(page) ? page : undefined;
        break;
      }
      case 'DUE':
        Object.assign(
          current,
          parseDue(value, params.some(p => /VALUE=DATE$/i.test(p.trim()))),
        );
        break;
      case 'DTSTART': {
        const parsed = parseDue(value, params.some(p => /VALUE=DATE$/i.test(p.trim())));
        current.startDate = parsed.dueDate;
        current.startAt = parsed.dueAt;
        break;
      }
      default:
        break;
    }
  }

  return todos;
}

/**
 * Mark a task complete by editing its calendar object in place.
 *
 * Deliberately a surgical text edit rather than parse-and-reserialise: the
 * object may carry properties this plugin does not model (RRULE, ATTENDEE,
 * X- extensions), and round-tripping through our own model would drop them.
 */
export function markCompleted(raw: string, now: Date = new Date()): string {
  const stamp = utcStamp(now);
  const drop = /^(STATUS|COMPLETED|PERCENT-COMPLETE|LAST-MODIFIED):/i;

  const lines = unfold(raw).split(/\r?\n/).filter(l => l.length > 0);
  const out: string[] = [];
  let insideTodo = false;

  for (const line of lines) {
    if (line === 'BEGIN:VTODO') {
      insideTodo = true;
      out.push(line);
      continue;
    }
    if (line === 'END:VTODO') {
      out.push(
        'STATUS:COMPLETED',
        `COMPLETED:${stamp}`,
        'PERCENT-COMPLETE:100',
        `LAST-MODIFIED:${stamp}`,
        line,
      );
      insideTodo = false;
      continue;
    }
    if (insideTodo && drop.test(line)) {
      continue;
    }
    out.push(line);
  }

  return out.map(fold).join('\r\n') + '\r\n';
}

/** A calendar event read back from the server. */
export interface VEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** Local 'YYYY-MM-DD' of the start. */
  startDate: string;
  /** Local 'HH:MM', absent for all-day events. */
  startTime?: string;
  endTime?: string;
  startAt: number;
  allDay: boolean;
  /** True when the event carries an RRULE, i.e. it repeats. */
  recurring: boolean;
  /** The RRULE value as stored, without the property name. See `recurrence.ts`. */
  rrule?: string;
  origin?: string;
  originName?: string;
}

/**
 * Parse a DTSTART/DTEND value into an instant plus local display parts.
 *
 * Handles the three encodings that occur in practice: VALUE=DATE (all-day), a
 * UTC instant ending in Z, and a floating or TZID-qualified local time. TZID is
 * treated as device-local — resolving arbitrary Olson zones would need a
 * timezone database this plugin does not carry, and being an hour out on a
 * foreign-zone event is better than dropping it.
 */
function parseStamp(
  raw: string,
  isDateOnly: boolean,
): {date: string; time?: string; at: number; allDay: boolean} | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const [, y, m, d, hh, mm, , zulu] = match;

  if (isDateOnly || hh === undefined) {
    return {
      date: `${y}-${m}-${d}`,
      at: new Date(Number(y), Number(m) - 1, Number(d)).getTime(),
      allDay: true,
    };
  }

  const at = zulu
    ? Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm))
    : new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)).getTime();
  const local = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: toDateInput(local),
    time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
    at,
    allDay: false,
  };
}

/** Extract every VEVENT from one or more calendar objects. */
export function parseVEvents(text: string): VEvent[] {
  const lines = unfold(text).split(/\r?\n/);
  const events: VEvent[] = [];
  let current: Partial<VEvent> | null = null;
  let inside = false;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      inside = true;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.uid && current.startDate !== undefined) {
        events.push({
          uid: current.uid,
          summary: current.summary ?? '(untitled)',
          description: current.description,
          location: current.location,
          startDate: current.startDate,
          startTime: current.startTime,
          endTime: current.endTime,
          startAt: current.startAt ?? 0,
          allDay: current.allDay ?? false,
          recurring: current.recurring ?? false,
          rrule: current.rrule,
          origin: current.origin,
          originName: current.originName,
        });
      }
      current = null;
      inside = false;
      continue;
    }
    if (!inside || !current) {
      continue;
    }

    const colon = line.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const rawName = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...params] = rawName.split(';');
    const dateOnly = params.some(p => /VALUE=DATE$/i.test(p.trim()));

    switch (name.toUpperCase()) {
      case 'UID':
        current.uid = value.trim();
        break;
      case 'SUMMARY':
        current.summary = unescapeText(value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(value);
        break;
      case 'LOCATION':
        current.location = unescapeText(value);
        break;
      case 'RRULE':
        // Presence decides how notes are filed — a repeating event shares one
        // note across occurrences, a one-off gets its date in the filename —
        // and the rule itself is kept so the editor can show and preserve it.
        current.recurring = value.trim().length > 0;
        current.rrule = value.trim();
        break;
      case 'X-TASKHUB-ORIGIN':
        current.origin = value.trim().toLowerCase();
        break;
      case 'X-TASKHUB-ORIGIN-NAME':
        current.originName = unescapeText(value);
        break;
      case 'DTSTART': {
        const parsed = parseStamp(value, dateOnly);
        if (parsed) {
          current.startDate = parsed.date;
          current.startTime = parsed.time;
          current.startAt = parsed.at;
          current.allDay = parsed.allDay;
        }
        break;
      }
      case 'DTEND': {
        const parsed = parseStamp(value, dateOnly);
        if (parsed) {
          current.endTime = parsed.time;
        }
        break;
      }
      default:
        break;
    }
  }

  return events.sort((a, b) => a.startAt - b.startAt);
}

export interface EventDraft {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** Local 'YYYY-MM-DD'. Required — an event without a start is not an event. */
  date: string;
  /** Local 'HH:MM'. Omitted makes the event all-day. */
  startTime?: string;
  endTime?: string;
  /**
   * The RRULE to write, without the property name. Same three states as
   * `TaskEdit.rrule`: `undefined` leaves a stored rule alone, `''` removes it,
   * a value replaces it.
   */
  rrule?: string;
}

/** DTSTART/DTEND line, mirroring buildDue's date-vs-instant handling. */
function buildStamp(prop: string, date: string, time?: string): string | null {
  if (!isValidDate(date)) {
    return null;
  }
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)!;
  if (!time || !isValidTime(time)) {
    return `${prop};VALUE=DATE:${y}${m}${d}`;
  }
  const [, hh, mm] = /^(\d{1,2}):(\d{2})$/.exec(time)!;
  const local = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
  return `${prop}:${utcStamp(local)}`;
}

export function buildVEvent(draft: EventDraft, now: Date = new Date()): string {
  const stamp = utcStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Task Hub//Supernote//EN',
    'BEGIN:VEVENT',
    `UID:${draft.uid}`,
    `DTSTAMP:${stamp}`,
    `CREATED:${stamp}`,
    `SUMMARY:${escapeText(draft.summary)}`,
    `${ORIGIN_PROPERTY}:${ORIGIN_VALUE}`,
    `${ORIGIN_NAME_PROPERTY}:${ORIGIN_NAME_VALUE}`,
  ];

  const start = buildStamp('DTSTART', draft.date, draft.startTime);
  if (start) {
    lines.push(start);
  }
  // An all-day DTEND would have to be the *next* day to be correct, so it is
  // simply omitted: a bare all-day DTSTART already means the whole day.
  if (draft.startTime) {
    const end = buildStamp('DTEND', draft.date, draft.endTime || draft.startTime);
    if (end) {
      lines.push(end);
    }
  }
  if (draft.description) {
    lines.push(`DESCRIPTION:${escapeText(draft.description)}`);
  }
  if (draft.location) {
    lines.push(`LOCATION:${escapeText(draft.location)}`);
  }
  if (draft.rrule) {
    lines.push(`RRULE:${draft.rrule}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Rewrite an existing event's editable fields, preserving everything else. */
export function updateVEvent(
  raw: string,
  draft: Omit<EventDraft, 'uid'>,
  now: Date = new Date(),
): string {
  const stamp = utcStamp(now);
  const drop = /^(SUMMARY|DESCRIPTION|LOCATION|DTSTART|DTEND|DTSTAMP|LAST-MODIFIED)[;:]/i;
  // As in updateVTodo: an undefined rrule leaves the stored rule untouched, so
  // a rule the picker reports as custom is never rewritten by an edit that was
  // only meant to change the title.
  const touchesRepeat = draft.rrule !== undefined;
  const dropRule = /^RRULE[;:]/i;

  const lines = unfold(raw)
    .split(/\r?\n/)
    .filter(l => l.length > 0);
  const out: string[] = [];
  let inside = false;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inside = true;
      out.push(line);
      continue;
    }
    if (line === 'END:VEVENT') {
      out.push(`SUMMARY:${escapeText(draft.summary)}`);
      const start = buildStamp('DTSTART', draft.date, draft.startTime);
      if (start) {
        out.push(start);
      }
      if (draft.startTime) {
        const end = buildStamp('DTEND', draft.date, draft.endTime || draft.startTime);
        if (end) {
          out.push(end);
        }
      }
      if (draft.description) {
        out.push(`DESCRIPTION:${escapeText(draft.description)}`);
      }
      if (draft.location) {
        out.push(`LOCATION:${escapeText(draft.location)}`);
      }
      if (touchesRepeat && draft.rrule) {
        out.push(`RRULE:${draft.rrule}`);
      }
      out.push(`DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, line);
      inside = false;
      continue;
    }
    if (inside && drop.test(line)) {
      continue;
    }
    if (inside && touchesRepeat && dropRule.test(line)) {
      continue;
    }
    out.push(line);
  }

  return out.map(fold).join('\r\n') + '\r\n';
}

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'nodate';

export const DUE_FILTERS: {key: DueFilter; label: string}[] = [
  {key: 'all', label: 'All'},
  {key: 'overdue', label: 'Overdue'},
  {key: 'today', label: 'Today'},
  {key: 'week', label: '7 days'},
  {key: 'nodate', label: 'No date'},
];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function matchesFilter(todo: VTodo, filter: DueFilter, now: Date): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'nodate') {
    return todo.dueAt === null;
  }
  if (todo.dueAt === null) {
    return false;
  }

  const todayStart = startOfDay(now);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

  switch (filter) {
    case 'overdue':
      // A completed task is never chased.
      return !todo.completed && todo.dueAt < now.getTime();
    case 'today':
      return todo.dueAt >= todayStart && todo.dueAt < tomorrowStart;
    case 'week':
      return todo.dueAt >= todayStart && todo.dueAt < todayStart + 7 * 24 * 60 * 60 * 1000;
    default:
      return true;
  }
}

export type SortKey = 'due-desc' | 'due-asc' | 'name';

/**
 * Order matters: the first entry sits leftmost and is the default the task list
 * opens on. Earliest-first leads because that is the reading order of a to-do
 * list — overdue at the top, furthest out at the bottom.
 */
export const SORT_KEYS: {key: SortKey; label: string}[] = [
  {key: 'due-asc', label: 'Date ↑'},
  {key: 'due-desc', label: 'Date ↓'},
  {key: 'name', label: 'Name'},
];

/** What the task list sorts by until the user picks something else. */
export const DEFAULT_SORT: SortKey = 'due-asc';

/**
 * Undated tasks always sink to the bottom, in both directions — a task with no
 * due date is not "the furthest future one", and letting it lead a descending
 * sort buries everything that actually has a deadline.
 */
export function sortTasks<T extends VTodo>(todos: T[], key: SortKey = 'due-asc'): T[] {
  return [...todos].sort((a, b) => {
    if (key === 'name') {
      return a.summary.localeCompare(b.summary);
    }
    if (a.dueAt === null && b.dueAt === null) {
      return a.summary.localeCompare(b.summary);
    }
    if (a.dueAt === null) {
      return 1;
    }
    if (b.dueAt === null) {
      return -1;
    }
    if (a.dueAt === b.dueAt) {
      return a.summary.localeCompare(b.summary);
    }
    return key === 'due-desc' ? b.dueAt - a.dueAt : a.dueAt - b.dueAt;
  });
}

/** Case-insensitive substring match over title and description. */
export function searchTasks<T extends VTodo>(todos: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return todos;
  }
  return todos.filter(
    t =>
      t.summary.toLowerCase().includes(needle) ||
      (t.description ?? '').toLowerCase().includes(needle),
  );
}

/** The soonest open tasks — what the save screen shows after a capture. */
export function nextTasks<T extends VTodo>(todos: T[], limit: number): T[] {
  return sortTasks(
    todos.filter(t => !t.completed),
    'due-asc',
  ).slice(0, limit);
}

export interface TaskEdit {
  summary: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  /**
   * RFC 5545 PRIORITY to write, 0–9. 0 or absent removes the property, which is
   * what "None" means — an explicit PRIORITY:0 is legal but says the same thing
   * more obscurely.
   */
  priority?: number;
  /**
   * The RRULE to write, without the property name.
   *
   * Three states, and the difference matters: `undefined` leaves whatever rule
   * is already stored exactly as it is — which is what a rule this plugin cannot
   * name must get — `''` removes the rule, and a value replaces it.
   */
  rrule?: string;
}

/**
 * Rewrite the editable fields of an existing calendar object.
 *
 * Same surgical strategy as markCompleted: only the properties the user can
 * actually edit are replaced, so RRULE, ATTENDEE, X- extensions and anything
 * else the server holds pass through untouched. Clearing the due date removes
 * the DUE line rather than writing an empty one, which some parsers reject.
 */
export function updateVTodo(raw: string, edit: TaskEdit, now: Date = new Date()): string {
  const stamp = utcStamp(now);
  const drop = /^(SUMMARY|DESCRIPTION|DUE|PRIORITY)[;:]/i;
  const dropStamp = /^(LAST-MODIFIED|DTSTAMP):/i;
  // Only removed when the caller has something to say about it. An undefined
  // rrule means "leave the stored rule alone", which is how a custom rule this
  // plugin cannot name survives being edited here.
  const touchesRepeat = edit.rrule !== undefined;
  const dropRule = /^RRULE[;:]/i;

  const lines = unfold(raw)
    .split(/\r?\n/)
    .filter(l => l.length > 0);
  const out: string[] = [];
  let insideTodo = false;

  for (const line of lines) {
    if (line === 'BEGIN:VTODO') {
      insideTodo = true;
      out.push(line);
      continue;
    }
    if (line === 'END:VTODO') {
      out.push(`SUMMARY:${escapeText(edit.summary)}`);
      if (edit.description) {
        out.push(`DESCRIPTION:${escapeText(edit.description)}`);
      }
      const due = buildDue(edit.dueDate, edit.dueTime);
      if (due) {
        out.push(due);
      }
      // Written only when there is one. Choosing "None" drops the line, and the
      // old value went with the rest of the edited properties above.
      if (edit.priority && edit.priority > 0) {
        out.push(`PRIORITY:${Math.round(edit.priority)}`);
      }
      if (touchesRepeat && edit.rrule) {
        out.push(`RRULE:${edit.rrule}`);
      }
      out.push(`DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, line);
      insideTodo = false;
      continue;
    }
    if (insideTodo && (drop.test(line) || dropStamp.test(line))) {
      continue;
    }
    if (insideTodo && touchesRepeat && dropRule.test(line)) {
      continue;
    }
    out.push(line);
  }

  return out.map(fold).join('\r\n') + '\r\n';
}

export interface TaskDraft {
  uid: string;
  summary: string;
  /** Note and page this was captured from, linked back to on the task. */
  sourcePath?: string;
  sourcePage?: number;
  /** Free-text note recorded on the task, e.g. the originating note page. */
  description?: string;
  /** Local calendar date, 'YYYY-MM-DD'. */
  dueDate?: string;
  /** Local wall-clock time, 'HH:MM'. Ignored unless dueDate is set. */
  dueTime?: string;
  /** RFC 5545 PRIORITY, 0–9. Omitted or 0 writes no PRIORITY line at all. */
  priority?: number;
  /** RRULE without the property name, e.g. `FREQ=WEEKLY`. Omitted writes none. */
  rrule?: string;
  /**
   * UID of the task this one is a step of. Written as
   * `RELATED-TO;RELTYPE=PARENT`, the same property Task Hub writes, so a step
   * created here nests in the web view too.
   */
  parentUid?: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Local calendar date as 'YYYY-MM-DD' — not toISOString, which shifts to UTC. */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function shiftDays(base: Date, days: number): Date {
  const next = new Date(base.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function isValidDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) {
    return false;
  }
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  // Rejects 2026-02-31, which Date would silently roll into March.
  return (
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(m) - 1 &&
    date.getDate() === Number(d)
  );
}

export function isValidTime(value: string): boolean {
  const match = TIME_RE.exec(value);
  if (!match) {
    return false;
  }
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

/**
 * Builds the DUE property line, or null when there is no usable date.
 *
 * Date alone becomes a floating VALUE=DATE, which is what a task due "on the
 * 10th" means. Adding a time makes it a real instant, so it is converted from
 * the device's local zone to UTC.
 */
export function buildDue(dueDate?: string, dueTime?: string): string | null {
  if (!dueDate || !isValidDate(dueDate)) {
    return null;
  }

  const [, y, m, d] = DATE_RE.exec(dueDate)!;

  if (!dueTime || !isValidTime(dueTime)) {
    return `DUE;VALUE=DATE:${y}${m}${d}`;
  }

  const [, hh, mm] = TIME_RE.exec(dueTime)!;
  const local = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
  return `DUE:${utcStamp(local)}`;
}

export function buildVTodo(task: TaskDraft, now: Date = new Date()): string {
  const stamp = utcStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//task-sync//Supernote//EN',
    'BEGIN:VTODO',
    `UID:${task.uid}`,
    `DTSTAMP:${stamp}`,
    `CREATED:${stamp}`,
    `SUMMARY:${escapeText(task.summary)}`,
    'STATUS:NEEDS-ACTION',
    `${ORIGIN_PROPERTY}:${ORIGIN_VALUE}`,
    `${ORIGIN_NAME_PROPERTY}:${ORIGIN_NAME_VALUE}`,
  ];
  if (task.description) {
    lines.push(`DESCRIPTION:${escapeText(task.description)}`);
  }

  const due = buildDue(task.dueDate, task.dueTime);
  if (due) {
    lines.push(due);
  }
  if (task.priority && task.priority > 0) {
    lines.push(`PRIORITY:${Math.round(task.priority)}`);
  }
  if (task.rrule) {
    lines.push(`RRULE:${task.rrule}`);
  }
  // RELTYPE is written explicitly even though PARENT is the RFC 5545 default:
  // a reader that assumes a different default would otherwise hang this task
  // off the wrong end of the relationship.
  if (task.parentUid) {
    lines.push(`RELATED-TO;RELTYPE=PARENT:${task.parentUid}`);
  }
  if (task.sourcePath) {
    lines.push(`${SOURCE_PROPERTY}:${escapeText(task.sourcePath)}`);
    if (task.sourcePage !== undefined) {
      lines.push(`${SOURCE_PAGE_PROPERTY}:${task.sourcePage}`);
    }
  }

  lines.push('END:VTODO', 'END:VCALENDAR');

  // iCalendar requires CRLF line endings; Radicale rejects bare LF.
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** One step to create: its title, and a date if the line named one. */
export interface StepDraft {
  summary: string;
  dueDate?: string;
}

/**
 * Read the steps box into a list of steps, with dates.
 *
 * One step per line, with a leading "-" or "*" stripped so a list written or
 * pasted as bullets does not arrive with the bullet in its title.
 *
 * A line may end with a date, written as `@YYYY-MM-DD`, which becomes that
 * step's due date:
 *
 *     Draft the release notes @2026-09-10
 *     Bump the version
 *
 * ISO order rather than the user's display format, deliberately: this text is
 * typed, and 03/04 is a different day depending on where you learned to write
 * dates. A line whose trailing @… is not a real date keeps it as part of the
 * title rather than silently dropping it — somebody writing "email @dave" meant
 * the words.
 *
 * Steps that name no date fall back to whatever the caller passes, which is
 * normally the parent task's own due date.
 */
export function parseSteps(text: string): StepDraft[] {
  const out: StepDraft[] = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]+/, '').trim();
    if (!line) {
      continue;
    }
    const dated = /^(.*?)\s+@(\d{4}-\d{2}-\d{2})$/.exec(line);
    if (dated && isValidDate(dated[2]) && dated[1].trim()) {
      out.push({summary: dated[1].trim(), dueDate: dated[2]});
    } else {
      out.push({summary: line});
    }
  }
  return out;
}
