/**
 * Turning a repeating event into the days it actually falls on.
 *
 * Without this the calendar showed a repeating event exactly once, on the day
 * it was first created, and never again: every view buckets by `startDate`, and
 * the server hands back one master VEVENT carrying an RRULE rather than one
 * object per occurrence. A weekly stand-up set up last year was therefore
 * invisible in the week it was actually happening.
 *
 * Expansion happens for display only. The events held in state stay exactly as
 * the server sent them, because that is what gets cached and what gets written
 * back — see `App.tsx`. Each copy made here carries an `occurrence` marker so
 * an edit opened from one cannot mistake the occurrence's own date for the
 * date the series starts on.
 *
 * Pure module, no SDK import, so the rules can be exercised off the device.
 */

import type {DateRange} from './eventwindow';
import type {VEvent} from './ical';

/** The parts of an RRULE this expander understands. */
export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  /** Every n-th day/week/month/year. RFC default is 1. */
  interval: number;
  /** Total occurrences including the first, when the rule is counted. */
  count?: number;
  /** Local 'YYYY-MM-DD' of the last day the rule may produce, inclusive. */
  until?: string;
  /** Weekdays (0 Sunday … 6 Saturday) for a weekly rule that names them. */
  byDay?: number[];
}

const WEEKDAY_CODES: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/**
 * A safety rail on how many occurrences one rule may produce.
 *
 * A malformed or hostile rule — `FREQ=DAILY;INTERVAL=0` say, or a window
 * widened to a decade — must not be able to lock the panel building a list
 * nobody asked for. The cap is far above any real calendar's density within a
 * fetched window.
 */
const MAX_OCCURRENCES = 750;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateOf(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/**
 * Read the parts of an RRULE that decide which days it lands on.
 *
 * Returns null for a rule this cannot honour rather than guessing at one.
 * Showing an event on the wrong days is worse than showing it only on its
 * start date, which is what a null falls back to.
 */
export function parseRrule(rrule?: string | null): RecurrenceRule | null {
  if (!rrule) {
    return null;
  }
  const parts = rrule.toUpperCase().replace(/^RRULE:/, '').trim().split(';');
  const fields: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }

  const freq = fields.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null;
  }

  // An INTERVAL of zero would never advance. Treated as absent rather than
  // rejected: the rest of the rule is still perfectly readable.
  const interval = Number(fields.INTERVAL);
  const count = Number(fields.COUNT);

  let until: string | undefined;
  const rawUntil = fields.UNTIL;
  if (rawUntil && /^\d{8}/.test(rawUntil)) {
    until = `${rawUntil.slice(0, 4)}-${rawUntil.slice(4, 6)}-${rawUntil.slice(6, 8)}`;
  }

  let byDay: number[] | undefined;
  if (fields.BYDAY) {
    const days = fields.BYDAY.split(',')
      // An ordinal prefix ("2TU" = the second Tuesday) is dropped rather than
      // honoured. Only weekly rules use byDay here, where RFC 5545 gives an
      // ordinal no meaning anyway.
      .map(code => WEEKDAY_CODES[code.replace(/^[+-]?\d+/, '').trim()])
      .filter((d): d is number => d !== undefined);
    if (days.length > 0) {
      byDay = days;
    }
  }

  return {
    freq,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    count: Number.isFinite(count) && count > 0 ? count : undefined,
    until,
    byDay,
  };
}

/**
 * The days a rule lands on, from its start, that fall inside `range`.
 *
 * Walks from the series' own start rather than from the window, because COUNT
 * and the interval are both measured from the start: a rule capped at ten
 * occurrences cannot be evaluated from the middle without knowing how many came
 * before. Exported for its tests — callers want `expandEvents`.
 */
export function occurrencesIn(
  startDate: string,
  rule: RecurrenceRule,
  range: DateRange,
  exdates: string[] = [],
): string[] {
  const skip = new Set(exdates);
  const out: string[] = [];
  const start = dateOf(startDate);
  /** Occurrences the rule has produced so far, which is what COUNT limits. */
  let produced = 0;

  /**
   * Offer one day to the rule.
   *
   * Returns false once the rule is spent — past UNTIL or over COUNT — so the
   * caller stops rather than walking to the end of the window. A day outside
   * the window still counts against COUNT: the rule produced it, we simply are
   * not looking at that part of the calendar.
   */
  const emit = (iso: string): boolean => {
    if (rule.until && iso > rule.until) {
      return false;
    }
    produced += 1;
    if (rule.count && produced > rule.count) {
      return false;
    }
    if (iso >= range.start && iso < range.end && !skip.has(iso)) {
      out.push(iso);
    }
    return true;
  };

  /**
   * Named weekdays: the whole week is generated at a time.
   *
   * Handled separately because the unit of stepping is the week while the unit
   * of occurrence is the day, and a rule starting on a Wednesday with
   * BYDAY=MO,WE must not emit that week's Monday.
   */
  if (rule.freq === 'WEEKLY' && rule.byDay) {
    const sunday = new Date(start);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const weekdays = [...rule.byDay].sort((a, b) => a - b);
    for (let step = 0; step < MAX_OCCURRENCES; step++) {
      const weekStart = new Date(sunday);
      weekStart.setDate(weekStart.getDate() + step * 7 * rule.interval);
      // Every day of a week that starts past the window is past it too.
      if (isoOf(weekStart) >= range.end) {
        break;
      }
      for (const weekday of weekdays) {
        const day = new Date(weekStart);
        day.setDate(day.getDate() + weekday);
        const iso = isoOf(day);
        if (iso < startDate) {
          continue;
        }
        if (!emit(iso)) {
          return out;
        }
      }
    }
    return out;
  }

  /**
   * Every other frequency computes its n-th occurrence straight from the start
   * date rather than advancing a cursor.
   *
   * A cursor drifts: stepping a year on from 29 February lands on 1 March,
   * and every step after that is anchored to the wrong day. Recomputing from
   * the start each time cannot drift, and makes "this month has no 31st" a
   * skip rather than a correction.
   */
  for (let step = 0; step < MAX_OCCURRENCES; step++) {
    let day: Date;
    switch (rule.freq) {
      case 'DAILY':
        day = new Date(start);
        day.setDate(day.getDate() + step * rule.interval);
        break;
      case 'WEEKLY':
        day = new Date(start);
        day.setDate(day.getDate() + step * 7 * rule.interval);
        break;
      case 'MONTHLY':
        day = new Date(start.getFullYear(), start.getMonth() + step * rule.interval, start.getDate());
        break;
      case 'YEARLY':
        day = new Date(start.getFullYear() + step * rule.interval, start.getMonth(), start.getDate());
        break;
    }

    // A month or year without that date — February for a rule on the 31st, a
    // common year for one on 29 February — produces no occurrence at all, as
    // RFC 5545 requires. Date rolls it into the next month, which is the tell.
    //
    // Only for the frequencies anchored to a day of the month: a daily or
    // weekly rule changes the day of the month every single time by design.
    const anchored = rule.freq === 'MONTHLY' || rule.freq === 'YEARLY';
    if (anchored && day.getDate() !== start.getDate()) {
      continue;
    }

    const iso = isoOf(day);
    if (iso >= range.end) {
      break;
    }
    if (!emit(iso)) {
      break;
    }
  }

  return out;
}

/** Epoch milliseconds for a local day and optional 'HH:MM'. */
function atOf(iso: string, time?: string): number {
  return new Date(`${iso}T${time ?? '00:00'}:00`).getTime();
}

/**
 * Every event as the days it actually falls on, within `range`.
 *
 * A non-repeating event, and any repeat whose rule cannot be read, is passed
 * through untouched — so a rule this expander does not understand costs the old
 * behaviour rather than a wrong one.
 *
 * Occurrences keep the master's `uid`. That is deliberate and matches what the
 * rest of the plugin already assumes: a repeating event shares one meeting note
 * across its occurrences.
 */
export function expandEvents<T extends VEvent>(events: T[], range: DateRange): T[] {
  const out: T[] = [];
  for (const event of events) {
    const rule = event.recurring ? parseRrule(event.rrule) : null;
    if (!rule) {
      out.push(event);
      continue;
    }
    const days = occurrencesIn(event.startDate, rule, range, event.exdates ?? []);
    if (days.length === 0) {
      // Every occurrence falls outside the window. The master is still dropped
      // rather than shown on its own start date, which would put a stand-up
      // from two years ago into a month it does not belong in.
      continue;
    }
    for (const day of days) {
      out.push({
        ...event,
        startDate: day,
        startAt: atOf(day, event.startTime),
        occurrence: {
          seriesStartDate: event.startDate,
          seriesStartTime: event.startTime,
        },
      });
    }
  }
  return out.sort((a, b) => a.startAt - b.startAt);
}
