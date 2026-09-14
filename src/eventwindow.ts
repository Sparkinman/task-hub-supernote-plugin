/**
 * How much of the calendar is fetched from the server, and when to fetch more.
 *
 * The event query used to ask for every VEVENT in the collection, for all time.
 * That is downloaded in full iCal and then parsed in JavaScript on an e-ink CPU
 * on every single opening, and the set only ever grows — which is why the wait
 * got worse the longer the plugin was used. Asking for a range instead cuts the
 * transfer and the parse together, and is the single biggest thing that can be
 * done about a slow start.
 *
 * The window is deliberately not permanent. Navigating to a month outside it
 * widens it and fetches the rest in the background, so nothing becomes
 * unreachable — it only costs a moment the first time you go somewhere new.
 *
 * Pure module, no SDK import, so it can be unit-tested off the device.
 */

/** ISO 'YYYY-MM-DD' dates. `end` is EXCLUSIVE, as CalDAV time-range is. */
export interface DateRange {
  start: string;
  end: string;
}

/**
 * How far the opening fetch reaches.
 *
 * Asymmetric on purpose: what is coming matters more than what has been, and a
 * year ahead covers the year view for most of the year without a second fetch.
 * Three months back covers "what did I do last quarter" and the month view's
 * habit of showing the tail of the previous month in its first row.
 */
export const WINDOW_BACK_MONTHS = 3;
export const WINDOW_FORWARD_MONTHS = 12;

/**
 * Extra range taken whenever the window is widened.
 *
 * Without it, stepping from December into January would fetch January, and then
 * stepping to February would fetch again. A month of slack at each edge means
 * ordinary month-by-month paging crosses a boundary at most once.
 */
const MARGIN_MONTHS = 1;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ISO date for a year/month/day, with the month allowed to fall outside 1-12. */
function iso(year: number, month: number, day: number): string {
  // Normalised through Date.UTC so month 13 or 0 rolls the year, and so a day
  // of 0 means "last day of the previous month".
  const d = new Date(Date.UTC(year, month - 1, day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function parts(isoDate: string): {year: number; month: number; day: number} {
  return {
    year: Number(isoDate.slice(0, 4)),
    month: Number(isoDate.slice(5, 7)),
    day: Number(isoDate.slice(8, 10)),
  };
}

/** First of the month `delta` months from the month containing `isoDate`. */
function monthStart(isoDate: string, delta: number): string {
  const {year, month} = parts(isoDate);
  return iso(year, month + delta, 1);
}

/** The range fetched when the plugin opens on `today`. */
export function defaultWindow(today: string): DateRange {
  return {
    start: monthStart(today, -WINDOW_BACK_MONTHS),
    end: monthStart(today, WINDOW_FORWARD_MONTHS + 1),
  };
}

/**
 * What a view actually needs on screen.
 *
 * Judged per view rather than by a single rule such as "the whole year": in
 * September, the year containing today reaches back to January, which is
 * outside a three-month window, so a whole-year rule would widen the window the
 * instant the plugin opened and undo the point of having one.
 *
 * Generous at the edges because the grids are: a month view draws the tail of
 * the previous month and the head of the next in the same 42 cells, and those
 * cells carry event marks.
 */
export function viewRange(view: 'year' | 'quarter' | 'month' | 'week' | 'day', day: string): DateRange {
  const {year, month} = parts(day);
  if (view === 'year') {
    return {start: iso(year, 1, 1), end: iso(year + 1, 1, 1)};
  }
  if (view === 'quarter') {
    const firstOfQuarter = Math.floor((month - 1) / 3) * 3 + 1;
    return {start: iso(year, firstOfQuarter, 1), end: iso(year, firstOfQuarter + 3, 1)};
  }
  if (view === 'month') {
    // One month either side, for the leading and trailing cells of the grid.
    return {start: iso(year, month - 1, 1), end: iso(year, month + 2, 1)};
  }
  // Day and week both sit comfortably inside the month either side of them.
  return {start: iso(year, month, 1), end: iso(year, month + 1, 1)};
}

/** True when everything `needed` asks for has already been fetched. */
export function covers(window: DateRange, needed: DateRange): boolean {
  return window.start <= needed.start && window.end >= needed.end;
}

/** The smallest window covering both, plus the margin that stops it thrashing. */
export function widen(window: DateRange, needed: DateRange): DateRange {
  const start = needed.start < window.start ? monthStart(needed.start, -MARGIN_MONTHS) : window.start;
  const end = needed.end > window.end ? monthStart(needed.end, MARGIN_MONTHS) : window.end;
  return {start, end};
}

/**
 * The part of `next` that `previous` did not already hold.
 *
 * Widening extends one edge or the other, so the gap is a single range and can
 * be fetched on its own rather than downloading the whole widened window again.
 * A window that grew at both ends at once — which only happens if a view jumps
 * clean past both edges — falls back to refetching all of it, because two
 * separate REPORTs would be slower than one.
 */
export function gap(previous: DateRange, next: DateRange): DateRange {
  const grewBack = next.start < previous.start;
  const grewForward = next.end > previous.end;
  if (grewBack && !grewForward) {
    return {start: next.start, end: previous.start};
  }
  if (grewForward && !grewBack) {
    return {start: previous.end, end: next.end};
  }
  return next;
}

/**
 * A CalDAV time-range stamp: UTC, basic format, as RFC 4791 requires.
 *
 * Midnight UTC rather than local. The window's edges are whole months and the
 * margin is a month wide, so being a few hours out at the boundary cannot
 * exclude anything anybody is looking at.
 */
export function caldavStamp(isoDate: string): string {
  return `${isoDate.replace(/-/g, '')}T000000Z`;
}

/**
 * Two fetched ranges combined into one list.
 *
 * Widening fetches only the part that was missing, so the result has to be
 * merged into what is already on screen rather than replacing it. Anything in
 * both — a repeating event matches every range it recurs into, so it comes back
 * from each fetch — is taken from the newer one.
 */
export function mergeFetched<T>(
  existing: T[],
  incoming: T[],
  key: (item: T) => string,
  order: (a: T, b: T) => number,
): T[] {
  const byKey = new Map<string, T>();
  for (const item of existing) {
    byKey.set(key(item), item);
  }
  for (const item of incoming) {
    byKey.set(key(item), item);
  }
  return Array.from(byKey.values()).sort(order);
}
