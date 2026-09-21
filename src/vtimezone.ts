/**
 * Resolving a TZID to a real offset, using the VTIMEZONE the file carries.
 *
 * A calendar object that names a zone — `DTSTART;TZID=America/New_York:20260921T120000`
 * — ships the rules for that zone alongside it, because RFC 5545 requires the
 * VTIMEZONE to travel with the event that references it. That is the whole
 * reason this works with no timezone database: the daylight-saving rules arrive
 * with the data, and Google, Apple and every CalDAV server send them.
 *
 * Before this existed the clock face was taken at face value and shown as the
 * device's own local time, so a meeting an Eastern colleague scheduled for noon
 * appeared at noon on a Mountain device — two hours late, every time. All-day
 * events were never affected, which is what kept it hidden for so long:
 * `VALUE=DATE` carries no zone to get wrong.
 *
 * `Intl.DateTimeFormat` with a `timeZone` option would be a tenth of this code
 * and is deliberately not used. It is the same trap as `new URL()`: full ICU
 * under Node makes every test pass, while Hermes on the panel may answer with a
 * silently wrong offset rather than throwing. Everything here is arithmetic on
 * values read out of the file, so what the tests prove is what the device does.
 */

/** One STANDARD or DAYLIGHT change from a VTIMEZONE. */
export interface ZoneRule {
  /** Offset in force before the change, in minutes east of UTC. */
  from: number;
  /** Offset in force from the change onwards, in minutes east of UTC. */
  to: number;
  /** When the change first happened, as a wall-clock value — see `wallTime`. */
  onset: number;
  /** For a yearly repeat, the month it lands in, 1-12. */
  month?: number;
  /** For a yearly repeat, the weekday it lands on, 0 = Sunday. */
  weekday?: number;
  /** 1 is the first such weekday of the month, -1 the last. */
  nth?: number;
  /** A repeat that has since stopped, as a real UTC instant. */
  until?: number;
}

/** Every zone a calendar object described, keyed by its TZID. */
export type ZoneTable = Record<string, ZoneRule[]>;

/**
 * A wall-clock date-time as a comparable number.
 *
 * `Date.UTC` is used here as plain calendar arithmetic and is never a claim
 * that the value is UTC. Building it with `new Date(y, m, d)` instead would
 * fold the *device's* timezone into a calculation whose entire purpose is to be
 * independent of it — which is the bug this file exists to fix, reintroduced
 * one level down.
 */
export function wallTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute);
}

const WEEKDAYS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/** `-0400` and `+053045` both occur; seconds are dropped as no zone needs them. */
function parseOffset(raw: string): number | null {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** `20070311T020000` — a VTIMEZONE DTSTART is always a floating wall time. */
function parseOnset(raw: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  return wallTime(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
  );
}

/** UNTIL inside a VTIMEZONE RRULE is a real UTC instant, and says so with a Z. */
function parseUntil(raw: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

/**
 * The day of the month the nth given weekday falls on.
 *
 * `nth` counts from the end when negative, so `BYDAY=-1SU` in October is the
 * last Sunday. A count that overruns the month — `BYDAY=5SU` where there are
 * only four — is pulled back to the last one, which is what it was written to
 * mean.
 */
function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (nth > 0) {
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    let day = 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
    while (day > daysInMonth) {
      day -= 7;
    }
    return day;
  }
  const lastDow = new Date(Date.UTC(year, month - 1, daysInMonth)).getUTCDay();
  let day = daysInMonth - ((lastDow - weekday + 7) % 7) + (nth + 1) * 7;
  while (day < 1) {
    day += 7;
  }
  return day;
}

/**
 * Every time this rule fires around the year in question.
 *
 * The year before is included because a wall time in January is governed by the
 * change that happened the previous autumn.
 */
function onsetsAround(rule: ZoneRule, year: number): number[] {
  if (rule.month === undefined || rule.weekday === undefined) {
    return [rule.onset];
  }
  const found = [rule.onset];
  for (const candidate of [year - 1, year]) {
    const day = nthWeekday(candidate, rule.month, rule.weekday, rule.nth ?? 1);
    const onset = wallTime(candidate, rule.month, day) + (rule.onset % 86400000);
    // A rule does not apply before it starts, and stops applying at its UNTIL —
    // which is a real instant, so the onset is converted out of the offset that
    // was in force up to it before the two are compared.
    if (onset < rule.onset) {
      continue;
    }
    if (rule.until !== undefined && onset - rule.from * 60000 > rule.until) {
      continue;
    }
    found.push(onset);
  }
  return found;
}

/**
 * The offset in force at a given wall-clock time, or null if the rules cannot say.
 *
 * The latest change at or before that time wins. A time earlier than every
 * change the file describes takes the offset that preceded the first of them,
 * which is what `TZOFFSETFROM` is for.
 *
 * Within the hour a change skips or repeats the answer may be the neighbouring
 * offset. Nothing better is possible from these rules alone, and an hour of
 * ambiguity twice a year is the accepted behaviour of every implementation.
 */
export function offsetAt(rules: ZoneRule[] | undefined, wall: number): number | null {
  if (!rules || rules.length === 0) {
    return null;
  }
  const year = new Date(wall).getUTCFullYear();
  let best: {onset: number; to: number} | null = null;
  let earliest: {onset: number; from: number} | null = null;

  for (const rule of rules) {
    for (const onset of onsetsAround(rule, year)) {
      if (earliest === null || onset < earliest.onset) {
        earliest = {onset, from: rule.from};
      }
      if (onset <= wall && (best === null || onset > best.onset)) {
        best = {onset, to: rule.to};
      }
    }
  }

  if (best !== null) {
    return best.to;
  }
  return earliest !== null ? earliest.from : null;
}

/**
 * Read every VTIMEZONE out of a calendar object.
 *
 * The text must already be unfolded. Anything that is not a VTIMEZONE is
 * ignored, so this can be handed a whole `.ics` file or just its header.
 */
export function parseTimezones(text: string): ZoneTable {
  const table: ZoneTable = {};
  let tzid: string | null = null;
  let rule: Partial<ZoneRule> | null = null;
  let rules: ZoneRule[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === 'BEGIN:VTIMEZONE') {
      tzid = null;
      rules = [];
      continue;
    }
    if (trimmed === 'END:VTIMEZONE') {
      if (tzid && rules.length > 0) {
        table[tzid] = rules;
      }
      tzid = null;
      rules = [];
      continue;
    }
    if (trimmed === 'BEGIN:STANDARD' || trimmed === 'BEGIN:DAYLIGHT') {
      rule = {};
      continue;
    }
    if (trimmed === 'END:STANDARD' || trimmed === 'END:DAYLIGHT') {
      // A change without both offsets and an onset cannot be placed on the
      // timeline at all, so it is dropped rather than half-applied.
      if (
        rule &&
        rule.from !== undefined &&
        rule.to !== undefined &&
        rule.onset !== undefined
      ) {
        rules.push(rule as ZoneRule);
      }
      rule = null;
      continue;
    }

    const colon = trimmed.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const name = trimmed.slice(0, colon).split(';')[0].toUpperCase();
    const value = trimmed.slice(colon + 1);

    if (name === 'TZID' && rule === null) {
      tzid = value.trim();
      continue;
    }
    if (rule === null) {
      continue;
    }
    switch (name) {
      case 'TZOFFSETFROM': {
        const offset = parseOffset(value);
        if (offset !== null) {
          rule.from = offset;
        }
        break;
      }
      case 'TZOFFSETTO': {
        const offset = parseOffset(value);
        if (offset !== null) {
          rule.to = offset;
        }
        break;
      }
      case 'DTSTART': {
        const onset = parseOnset(value);
        if (onset !== null) {
          rule.onset = onset;
        }
        break;
      }
      case 'RRULE': {
        for (const part of value.split(';')) {
          const [key, raw] = part.split('=');
          if (!key || raw === undefined) {
            continue;
          }
          switch (key.trim().toUpperCase()) {
            case 'BYMONTH':
              rule.month = Number(raw.split(',')[0]);
              break;
            case 'BYDAY': {
              const day = /^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(raw.split(',')[0].trim());
              if (day) {
                rule.weekday = WEEKDAYS[day[2].toUpperCase()];
                rule.nth = day[1] ? Number(day[1]) : 1;
              }
              break;
            }
            case 'UNTIL':
              rule.until = parseUntil(raw);
              break;
            default:
              break;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return table;
}

/**
 * The UTC instant a zoned wall-clock time denotes.
 *
 * Null when the file described no usable rules for that TZID, which leaves the
 * caller free to fall back to what it did before rather than invent an offset.
 * Falling back is always safe: it is the behaviour every build up to now had.
 */
export function instantInZone(
  zones: ZoneTable,
  tzid: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const wall = wallTime(year, month, day, hour, minute);
  const offset = offsetAt(zones[tzid], wall);
  if (offset === null) {
    return null;
  }
  return wall - offset * 60000;
}
