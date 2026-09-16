/**
 * Where everything sits on a calendar background page.
 *
 * Pure and SDK-free so it can be tested off the device, the same split as
 * `headinglayout.ts`: this half decides the geometry, `backgrounddraw.ts` talks
 * to the hardware. Worth pinning here because a rule placed wrong is a page
 * somebody cannot write on, and that is only discoverable by installing a build.
 *
 * The page is a snapshot laid over the note's own template, on a layer of its
 * own, so the user writes on the layers above it. Everything is expressed as a
 * fraction of the page rather than in pixels: a Nomad's page is smaller than a
 * Manta's in the same pixel space, so anything fixed comes out proportionally
 * larger on one of them.
 */

import type {PageSize, Rect} from './headinglayout';

export type {PageSize, Rect};

/** A straight rule to draw. */
export interface Rule {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A label to place, with the size it should be drawn at. */
export interface Label {
  text: string;
  left: number;
  top: number;
  fontSize: number;
}

/** Everything one background page consists of. */
export interface Background {
  /**
   * The full page.
   *
   * Kept after the mask it was named for turned out to be impossible — the SDK
   * has no usable picture element — because the calendar page now gets a blank
   * template of its own instead, and this is still the rectangle everything
   * must fit inside. The tests assert against it.
   */
  mask: Rect;
  rules: Rule[];
  labels: Label[];
  /** Where handwriting is expected to go, for the caller's own sanity checks. */
  writable: Rect[];
}

/**
 * The outer margin, as a fraction of the page width.
 *
 * Deliberately small. A ruled border costs six millimetres on every side for
 * decoration, and the whole point of this page is the writing on it.
 */
const MARGIN_FRACTION = 0.02;

/**
 * Extra room on the left, because the NOTE app's toolbar sits over it.
 *
 * Measured off a device screenshot: the toolbar covers roughly the first 120px
 * of the page. The hour labels on the first day page were drawn at x=38 and
 * were simply invisible — and so was the first rule of the week grid, which is
 * why that page appeared to start a column in. The page itself is fine and the
 * export would show them; they are just behind furniture the whole time anyone
 * is looking at it.
 *
 * Applied only to the left edge. The toolbar can be collapsed, so this is a
 * little width given up to make the page readable while it is not.
 */
const TOOLBAR_INSET = 150;

/**
 * The share of the page the calendar takes on a week or month page.
 *
 * The calendar takes precedence and the notes area gets what is left — a
 * quarter, which at a 7mm ruling is about seven lines. A notes area that grew
 * to fit its lines would eat the calendar it is meant to accompany.
 */
const CALENDAR_SHARE = 0.75;

/** Ruled spacing for a notes area, in millimetres. */
const RULE_MM = 7;

/**
 * Pixels per millimetre.
 *
 * A Manta is 1920px across a page about 162mm wide. Every panel in the range is
 * near enough the same density that deriving this from the page width would
 * change the ruling by less than the width of the line drawn.
 */
const PX_PER_MM = 11.85;

const ruleSpacing = () => Math.round(RULE_MM * PX_PER_MM);

/**
 * Ruled lines spread evenly between two edges, touching neither.
 *
 * Fixed 7mm steps from the top leave whatever does not divide as a ragged gap
 * at the bottom, and drop a line a hair above the edge below it. Fitting the
 * same number of lines and spacing them evenly puts the slack between every
 * line instead of all of it at the end, and never draws one on the boundary —
 * the boundary is already a line.
 */
function evenLines(top: number, bottom: number, spacing: number): number[] {
  const span = bottom - top;
  const count = Math.max(0, Math.floor(span / spacing) - 1);
  if (count <= 0) {
    return [];
  }
  const step = span / (count + 1);
  const out: number[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(Math.round(top + i * step));
  }
  return out;
}

function hairline(left: number, y: number, right: number): Rule {
  return {left, top: y, right, bottom: y};
}

function frame(page: PageSize) {
  const margin = Math.round(page.width * MARGIN_FRACTION);
  return {
    margin,
    left: margin + TOOLBAR_INSET,
    top: margin,
    right: page.width - margin,
    bottom: page.height - margin,
  };
}

/**
 * The lower notes area, ruled at 7mm, and the calendar area above it.
 *
 * Shared by the week and month pages, which differ only in what fills the part
 * above. The day page has no notes area at all — the agenda is the content, and
 * a band of ruled lines under it would take space from the thing being written
 * over.
 */
function splitForNotes(page: PageSize): {calendar: Rect; notes: Rect; noteRules: Rule[]} {
  const f = frame(page);
  const usable = f.bottom - f.top;
  const split = f.top + Math.round(usable * CALENDAR_SHARE);
  const rules: Rule[] = evenLines(split, f.bottom, ruleSpacing()).map(y =>
    hairline(f.left, y, f.right),
  );
  return {
    calendar: {left: f.left, top: f.top, right: f.right, bottom: split},
    notes: {left: f.left, top: split, right: f.right, bottom: f.bottom},
    noteRules: rules,
  };
}

/** Font sizes, as fractions of the page height. Small: labels get out of the way. */
const DATE_FONT = 0.014;
const TITLE_FONT = 0.013;

const fontPx = (page: PageSize, fraction: number) =>
  Math.max(18, Math.round(page.height * fraction));

/** A row on the day page: what it says, and what it belongs to. */
export interface AgendaRow {
  title: string;
  /** The calendar or list it came from, shown small underneath. */
  subtitle?: string;
  /** Minutes from midnight. Absent for an all-day event or a to-do. */
  startMin?: number;
  endMin?: number;
}

/** Everything the day page draws, in the shape the Day view already shows it. */
export interface DayAgenda {
  allDay: AgendaRow[];
  timed: AgendaRow[];
  dueToday: AgendaRow[];
  upcoming: {date: string; rows: AgendaRow[]}[];
}

/** How the clock is written, matching whatever the Day view is showing. */
export type ClockLabel = (minutes: number) => string;

/**
 * The share of the width the agenda takes, leaving the rest for tasks.
 *
 * The same split the Day view uses on screen. The point of this page is that it
 * looks like what you were just looking at, so the proportions are copied
 * rather than chosen.
 */
const AGENDA_SHARE = 0.58;

/**
 * The share of the day page given to notes at the foot.
 *
 * Smaller than the week and month pages' quarter: the agenda above it is the
 * content, and a deep band would push the hour grid into something too
 * compressed to write in.
 */
const DAY_NOTES_SHARE = 0.18;

/**
 * The day page: the Day view, on paper, to write over.
 *
 * Deliberately a copy of what is already on screen — all-day events in a band
 * at the top, an hour grid beneath them, and the day's tasks with what is
 * coming down the right. Somebody who has just looked at the Day view should
 * recognise the page without being told what it is.
 *
 * The hour range narrows to what is used and widens for anything outside it, so
 * a full day is never spent on hours nobody writes in and an early flight is
 * never simply missing.
 *
 * No notes area. The agenda is the thing being written over.
 */
export function dayBackground(
  page: PageSize,
  agenda: DayAgenda,
  clock: ClockLabel = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:00`,
  fromHour = 7,
  toHour = 19,
): Background {
  const f = frame(page);
  const rules: Rule[] = [];
  const labels: Label[] = [];
  const writable: Rect[] = [];

  // A notes band at the foot, across the full width — under both the agenda and
  // the tasks, because a thought at the end of the day belongs to the day
  // rather than to one column of it.
  const spacing = ruleSpacing();
  const notesTop = f.bottom - Math.round((f.bottom - f.top) * DAY_NOTES_SHARE);
  for (const ny of evenLines(notesTop, f.bottom, spacing)) {
    rules.push(hairline(f.left, ny, f.right));
  }
  const body = {top: f.top, bottom: notesTop - 12};

  const split = Math.round(f.left + (f.right - f.left) * AGENDA_SHARE);
  const titleFont = fontPx(page, TITLE_FONT);
  const smallFont = Math.round(titleFont * 0.8);
  const headFont = fontPx(page, DATE_FONT);
  const rowHeight = Math.round(titleFont * 1.5 + smallFont * 1.3);

  // The divider between the agenda and the tasks, as on screen.
  rules.push({left: split, top: body.top, right: split, bottom: body.bottom});

  // -- all day, in a band at the top of the agenda column ------------------
  const gutter = Math.round(page.width * 0.09);
  let y = f.top;
  if (agenda.allDay.length > 0) {
    labels.push({text: 'all day', left: f.left, top: y + 2, fontSize: smallFont});
    for (const row of agenda.allDay) {
      labels.push({text: row.title, left: f.left + gutter, top: y, fontSize: titleFont});
      if (row.subtitle) {
        labels.push({
          text: row.subtitle,
          left: f.left + gutter,
          top: y + titleFont + 4,
          fontSize: smallFont,
        });
      }
      y += rowHeight;
    }
    rules.push(hairline(f.left, y + 6, split));
    y += 18;
  }

  // -- the hour grid ------------------------------------------------------
  const timed = agenda.timed.filter(
    r => r.startMin !== undefined && r.endMin !== undefined && r.endMin > r.startMin,
  );
  const first = timed.reduce((h, r) => Math.min(h, Math.floor((r.startMin ?? 0) / 60)), fromHour);
  const last = timed.reduce((h, r) => Math.max(h, Math.ceil((r.endMin ?? 0) / 60)), toHour);
  const hours = Math.max(1, last - first);
  const perHour = (body.bottom - y) / hours;
  const at = (minutes: number) => y + ((minutes - first * 60) / 60) * perHour;

  for (let h = first; h <= last; h++) {
    const top = Math.round(at(h * 60));
    rules.push(hairline(f.left, top, split));
    if (h < last) {
      labels.push({text: clock(h * 60), left: f.left, top: top + 6, fontSize: smallFont});
    }
  }
  for (const row of timed) {
    const top = Math.round(at(row.startMin ?? 0));
    labels.push({text: row.title, left: f.left + gutter, top: top + 6, fontSize: titleFont});
    if (row.subtitle) {
      labels.push({
        text: row.subtitle,
        left: f.left + gutter,
        top: top + 6 + titleFont + 2,
        fontSize: smallFont,
      });
    }
  }
  writable.push({left: f.left + gutter, top: y, right: split, bottom: body.bottom});

  // -- tasks, down the right ----------------------------------------------
  const right = split + 24;
  let ty = f.top;
  labels.push({text: 'Tasks', left: right, top: ty, fontSize: headFont});
  ty += Math.round(headFont * 1.6);
  if (agenda.dueToday.length === 0) {
    labels.push({text: 'Nothing due.', left: right, top: ty, fontSize: smallFont});
    ty += rowHeight;
  }
  for (const row of agenda.dueToday) {
    labels.push({text: `[ ] ${row.title}`, left: right, top: ty, fontSize: titleFont});
    if (row.subtitle) {
      labels.push({text: row.subtitle, left: right + 20, top: ty + titleFont + 2, fontSize: smallFont});
    }
    ty += rowHeight;
  }

  if (agenda.upcoming.length > 0) {
    ty += 10;
    rules.push(hairline(right, ty, f.right));
    ty += 14;
    labels.push({text: 'Next 7 days', left: right, top: ty, fontSize: headFont});
    ty += Math.round(headFont * 1.6);
    for (const group of agenda.upcoming) {
      if (ty > body.bottom - rowHeight) {
        break;
      }
      labels.push({text: group.date, left: right, top: ty, fontSize: smallFont});
      ty += Math.round(smallFont * 1.5);
      for (const row of group.rows) {
        if (ty > body.bottom - rowHeight) {
          break;
        }
        labels.push({text: `[ ] ${row.title}`, left: right, top: ty, fontSize: titleFont});
        ty += Math.round(titleFont * 1.5);
      }
    }
  }
  writable.push(
    {left: right, top: ty, right: f.right, bottom: body.bottom},
    {left: f.left, top: notesTop, right: f.right, bottom: f.bottom},
  );

  return {mask: {left: 0, top: 0, right: page.width, bottom: page.height}, rules, labels, writable};
}

/** Sunday first, matching `monthGrid`. */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The week page: seven rows across the page, not seven columns down it.
 *
 * Columns were the first attempt and they are wrong for writing. A column is
 * about 270px wide on a Manta — three or four words a line — so a day's note
 * becomes a narrow ragged stack. Rows run the full width of the page, which is
 * how a paper week-to-view is laid out and for the same reason.
 *
 * The date sits in a gutter on the left, out of the way of the writing, and the
 * rest of each row is ruled at the same 7mm as the notes area so the lines
 * continue across the whole page rather than restarting per day.
 */
export function weekBackground(page: PageSize, days: {label: string}[]): Background {
  const {calendar, notes, noteRules} = splitForNotes(page);
  const rows = 7;
  const height = (calendar.bottom - calendar.top) / rows;
  const font = fontPx(page, DATE_FONT);
  const gutter = Math.round(page.width * 0.13);
  const spacing = ruleSpacing();
  const rules: Rule[] = [...noteRules];
  const labels: Label[] = [];
  const writable: Rect[] = [];

  // The gutter runs the height of the calendar, so the dates read as a column
  // rather than as seven unrelated marks.
  rules.push({
    left: calendar.left + gutter,
    top: calendar.top,
    right: calendar.left + gutter,
    bottom: calendar.bottom,
  });

  for (let i = 0; i < rows; i++) {
    const top = Math.round(calendar.top + i * height);
    const bottom = Math.round(calendar.top + (i + 1) * height);
    // The day's own line, heavier in intent than the rules inside it.
    rules.push(hairline(calendar.left, top, calendar.right));
    labels.push({
      text: days[i]?.label ?? '',
      left: calendar.left + 8,
      top: top + 6,
      fontSize: font,
    });
    // Ruled to fill the row, evenly, so the slack is shared between the lines
    // rather than left as a gap at the foot of each day — and never a line
    // sitting a hair above the day's own divider, which is already a line.
    for (const y of evenLines(top, bottom, spacing)) {
      rules.push(hairline(calendar.left + gutter, y, calendar.right));
    }
    writable.push({left: calendar.left + gutter, top, right: calendar.right, bottom});
  }
  rules.push(hairline(calendar.left, calendar.bottom, calendar.right));
  writable.push(notes);
  return {mask: {left: 0, top: 0, right: page.width, bottom: page.height}, rules, labels, writable};
}

/**
 * The month page: a grid of empty cells, each numbered in its top-left corner.
 *
 * The number goes in the corner rather than the middle because a centred date
 * sits exactly where the writing wants to be.
 */
export function monthBackground(
  page: PageSize,
  weeks: number,
  cells: string[],
): Background {
  const {calendar, notes, noteRules} = splitForNotes(page);
  const width = (calendar.right - calendar.left) / 7;
  const rules: Rule[] = [...noteRules];
  const labels: Label[] = [];
  const writable: Rect[] = [];
  const font = fontPx(page, DATE_FONT);

  // A header strip naming the days, so a grid of bare numbers can be read as a
  // week without counting columns.
  const headerHeight = Math.round(font * 1.8);
  const gridTop = calendar.top + headerHeight;
  const cellHeight = (calendar.bottom - gridTop) / weeks;
  for (let c = 0; c < 7; c++) {
    labels.push({
      text: WEEKDAYS[c],
      left: Math.round(calendar.left + c * width) + 8,
      top: calendar.top + 2,
      fontSize: font,
    });
  }
  rules.push(hairline(calendar.left, gridTop, calendar.right));

  for (let c = 0; c <= 7; c++) {
    const x = Math.round(calendar.left + c * width);
    rules.push({left: x, top: gridTop, right: x, bottom: calendar.bottom});
  }
  for (let r = 0; r <= weeks; r++) {
    const y = Math.round(gridTop + r * cellHeight);
    rules.push(hairline(calendar.left, y, calendar.right));
  }

  for (let i = 0; i < weeks * 7; i++) {
    const text = cells[i] ?? '';
    if (!text) {
      continue;
    }
    const x = Math.round(calendar.left + (i % 7) * width);
    const y = Math.round(gridTop + Math.floor(i / 7) * cellHeight);
    labels.push({text, left: x + 6, top: y + 4, fontSize: font});
    writable.push({
      left: x,
      top: y + font,
      right: Math.round(x + width),
      bottom: Math.round(y + cellHeight),
    });
  }
  writable.push(notes);
  return {mask: {left: 0, top: 0, right: page.width, bottom: page.height}, rules, labels, writable};
}

/**
 * The quarter page: three month columns, every date with a rule beside it.
 *
 * Three months on one page means roughly thirty-one rows per column, which on a
 * full-height page lands at about 7mm a row — the same ruling as a notes area,
 * and the reason this fits at all. A single list of ninety dates down one page
 * would give each about 2.5mm, which is not writing space.
 *
 * No notes area: every row already is one.
 */
export function quarterBackground(page: PageSize, months: string[][]): Background {
  const f = frame(page);
  const columns = Math.max(1, months.length);
  const width = (f.right - f.left) / columns;
  const font = fontPx(page, DATE_FONT);
  const dateGutter = Math.round(width * 0.14);
  const rules: Rule[] = [];
  const labels: Label[] = [];
  const writable: Rect[] = [];

  for (let c = 0; c < columns; c++) {
    const left = Math.round(f.left + c * width);
    const right = Math.round(f.left + (c + 1) * width);
    const dates = months[c] ?? [];
    const rows = Math.max(1, dates.length);
    const height = (f.bottom - f.top) / rows;

    for (let r = 0; r < rows; r++) {
      const y = Math.round(f.top + (r + 1) * height);
      // The rule sits beside the date, not under it, so the date is never
      // struck through by the line meant for writing next to it.
      rules.push(hairline(left + dateGutter, y, right - 8));
      labels.push({
        text: dates[r] ?? '',
        left: left + 4,
        top: Math.round(y - height + 2),
        fontSize: font,
      });
      writable.push({left: left + dateGutter, top: Math.round(y - height), right: right - 8, bottom: y});
    }
  }
  return {mask: {left: 0, top: 0, right: page.width, bottom: page.height}, rules, labels, writable};
}

/** How much work a page is, for deciding raster against vector. */
export function backgroundCost(bg: Background): {rules: number; labels: number; elements: number} {
  return {rules: bg.rules.length, labels: bg.labels.length, elements: bg.rules.length + bg.labels.length + 1};
}
