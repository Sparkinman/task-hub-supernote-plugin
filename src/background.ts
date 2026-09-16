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

function hairline(left: number, y: number, right: number): Rule {
  return {left, top: y, right, bottom: y};
}

function frame(page: PageSize) {
  const margin = Math.round(page.width * MARGIN_FRACTION);
  return {
    margin,
    left: margin,
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
  const spacing = ruleSpacing();
  const rules: Rule[] = [];
  for (let y = split + spacing; y <= f.bottom; y += spacing) {
    rules.push(hairline(f.left, y, f.right));
  }
  return {
    calendar: {left: f.left, top: f.top, right: f.right, bottom: split},
    notes: {left: f.left, top: split, right: f.right, bottom: f.bottom},
    noteRules: rules,
  };
}

/** Font sizes, as fractions of the page height. Small: labels get out of the way. */
const DATE_FONT = 0.014;
const HOUR_FONT = 0.012;
const TITLE_FONT = 0.013;

const fontPx = (page: PageSize, fraction: number) =>
  Math.max(18, Math.round(page.height * fraction));

/** One event as the day page needs it: a span of minutes and something to call it. */
export interface DayEntry {
  /** Minutes from midnight. Equal values mean an all-day or undated row. */
  startMin: number;
  endMin: number;
  title: string;
}

/**
 * The day page: an hour grid with the day's events drawn into it.
 *
 * The hour range is narrowed to what is actually used rather than running
 * midnight to midnight — a full day spends a third of the page on hours nobody
 * writes in. It widens to fit anything scheduled outside the default window, so
 * an early flight is never simply missing from the page.
 *
 * No notes area. The agenda *is* the content here, and ruled lines beneath it
 * would take space from the thing being written over.
 */
export function dayBackground(
  page: PageSize,
  entries: DayEntry[],
  fromHour = 7,
  toHour = 19,
): Background {
  const f = frame(page);
  const timed = entries.filter(e => e.endMin > e.startMin);
  // Everything with no hour to sit at: all-day events, and to-dos, which carry
  // a date and never a time. The first version dropped these on the floor — on
  // a day whose every event was all-day the page came out as bare hour rules,
  // which read as the feature not working at all.
  const untimed = entries.filter(e => e.endMin <= e.startMin);
  const first = timed.reduce((h, e) => Math.min(h, Math.floor(e.startMin / 60)), fromHour);
  const last = timed.reduce((h, e) => Math.max(h, Math.ceil(e.endMin / 60)), toHour);
  const hours = Math.max(1, last - first);

  const gutter = Math.round(page.width * 0.08);
  const body = {left: f.left + gutter, right: f.right};
  // A band at the top for the untimed rows, sized to what there is, so a day
  // with none of them gives the whole page to the hour grid.
  const bandFont = fontPx(page, TITLE_FONT);
  const bandLine = Math.round(bandFont * 1.7);
  const bandHeight = untimed.length > 0 ? untimed.length * bandLine + 16 : 0;
  const gridTop = f.top + bandHeight;
  const height = f.bottom - gridTop;
  const perHour = height / hours;
  const y = (minutes: number) => gridTop + ((minutes - first * 60) / 60) * perHour;

  const rules: Rule[] = [];
  const labels: Label[] = [];

  untimed.forEach((entry, i) => {
    labels.push({
      text: entry.title,
      left: f.left,
      top: f.top + i * bandLine,
      fontSize: bandFont,
    });
  });
  if (bandHeight > 0) {
    rules.push(hairline(f.left, gridTop - 8, f.right));
  }

  for (let h = first; h <= last; h++) {
    const top = Math.round(y(h * 60));
    rules.push(hairline(f.left, top, f.right));
    if (h < last) {
      labels.push({
        text: `${String(h).padStart(2, '0')}`,
        left: f.left,
        top: top + 4,
        fontSize: fontPx(page, HOUR_FONT),
      });
    }
  }

  // Each event gets a box at its real time and its title inside it. Drawn after
  // the hour rules so a meeting reads as sitting on the grid rather than under
  // it.
  for (const entry of timed) {
    const top = Math.round(y(entry.startMin));
    const bottom = Math.round(y(entry.endMin));
    rules.push(
      hairline(body.left, top, body.right),
      {left: body.left, top, right: body.left, bottom},
      hairline(body.left, bottom, body.right),
    );
    labels.push({
      text: entry.title,
      left: body.left + 8,
      top: top + 4,
      fontSize: fontPx(page, TITLE_FONT),
    });
  }

  return {
    mask: {left: 0, top: 0, right: page.width, bottom: page.height},
    rules,
    labels,
    writable: [{left: body.left, top: gridTop, right: f.right, bottom: f.bottom}],
  };
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
    // Ruled to fill the row, so the writing space is lined all the way down
    // rather than being one deep empty box per day.
    for (let y = top + spacing; y < bottom - 8; y += spacing) {
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
