/**
 * Calendar-grid maths for the date picker.
 *
 * Pure and SDK-free so the grid can be unit-tested — off-by-one week boundaries
 * are exactly the kind of bug that is invisible until someone taps the wrong day.
 */

export const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** Three-letter forms for the week view, where there is room for them. */
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface DayCell {
  /** Canonical 'YYYY-MM-DD', or null for a padding cell. */
  iso: string | null;
  day: number | null;
}

function iso(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

/**
 * A Sunday-first grid for the month, padded to whole weeks.
 *
 * Returns whole weeks only (7, 14, ... cells) so the caller can chunk by 7
 * without a ragged final row.
 */
export function monthGrid(year: number, month: number): DayCell[] {
  const leading = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);

  const cells: DayCell[] = [];
  for (let i = 0; i < leading; i++) {
    cells.push({iso: null, day: null});
  }
  for (let day = 1; day <= total; day++) {
    cells.push({iso: iso(year, month, day), day});
  }
  while (cells.length % 7 !== 0) {
    cells.push({iso: null, day: null});
  }
  return cells;
}

/** A grid cell that always names a real day, and says whose month it is. */
export interface FilledCell {
  iso: string;
  day: number;
  /** True for the days either side that only exist to square off the grid. */
  outside: boolean;
}

/**
 * The same grid, with the padding filled in from the neighbouring months.
 *
 * A month grid that stops dead at the 1st and the 30th leaves ragged white
 * corners, which is most of what makes a calendar look unfinished. Paper diaries
 * print the surrounding days in grey, and so does every calendar app worth
 * copying.
 *
 * Deliberately additive rather than a change to `monthGrid`: that function's
 * nulls are what the week-number gutter keys off, and its tests pin the
 * behaviour. This one is for drawing.
 */
export function monthGridFilled(year: number, month: number): FilledCell[] {
  return monthGrid(year, month).map((cell, index) => {
    if (cell.iso !== null && cell.day !== null) {
      return {iso: cell.iso, day: cell.day, outside: false};
    }
    // Padding: count from the 1st of the month by this cell's distance from it.
    const leading = new Date(year, month, 1).getDay();
    const date = new Date(year, month, 1 + (index - leading));
    return {
      iso: iso(date.getFullYear(), date.getMonth(), date.getDate()),
      day: date.getDate(),
      outside: true,
    };
  });
}

export function chunkWeeks<T>(cells: T[]): T[][] {
  const weeks: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/** Step a year/month pair by whole months, rolling the year over. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): {year: number; month: number} {
  const total = year * 12 + month + delta;
  return {year: Math.floor(total / 12), month: ((total % 12) + 12) % 12};
}
