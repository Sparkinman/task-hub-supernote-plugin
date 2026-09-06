/**
 * Display formatting for dates and times.
 *
 * Storage stays canonical everywhere — dates are 'YYYY-MM-DD' and times are
 * 24-hour 'HH:MM' internally, and only ever converted at render time. Keeping
 * the preference out of the stored value means changing it reformats existing
 * tasks instead of corrupting them.
 */

export type DateFormat = 'iso' | 'us' | 'eu';
export type TimeFormat = '24' | '12';

export const DATE_FORMATS: {key: DateFormat; label: string; example: string}[] = [
  {key: 'iso', label: 'YYYY-MM-DD', example: '2026-09-10'},
  {key: 'us', label: 'MM/DD/YYYY', example: '09/10/2026'},
  {key: 'eu', label: 'DD/MM/YYYY', example: '10/09/2026'},
];

export const TIME_FORMATS: {key: TimeFormat; label: string; example: string}[] = [
  {key: '24', label: '24-hour', example: '14:05'},
  {key: '12', label: '12-hour', example: '2:05 PM'},
];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Render a canonical 'YYYY-MM-DD' in the user's chosen format. */
export function formatDate(iso: string | undefined, format: DateFormat): string {
  if (!iso) {
    return '';
  }
  const match = ISO_RE.exec(iso);
  if (!match) {
    return iso;
  }
  const [, y, m, d] = match;
  switch (format) {
    case 'us':
      return `${m}/${d}/${y}`;
    case 'eu':
      return `${d}/${m}/${y}`;
    default:
      return `${y}-${m}-${d}`;
  }
}

/** Render a canonical 24-hour 'HH:MM' in the user's chosen format. */
export function formatTime(time: string | undefined, format: TimeFormat): string {
  if (!time) {
    return '';
  }
  const match = TIME_RE.exec(time);
  if (!match) {
    return time;
  }
  const hours = Number(match[1]);
  const minutes = match[2];

  if (format === '24') {
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }
  // 00:xx is 12 AM and 12:xx is 12 PM — the two cases a naive % 12 gets wrong.
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

export function formatDue(
  date: string | undefined,
  time: string | undefined,
  dateFormat: DateFormat,
  timeFormat: TimeFormat,
): string {
  const day = formatDate(date, dateFormat);
  if (!day) {
    return '';
  }
  const clock = formatTime(time, timeFormat);
  return clock ? `${day} ${clock}` : day;
}

/** Shift a canonical 'HH:MM' by whole hours, wrapping at midnight. */
export function addHours(time: string, hours: number): string {
  const match = TIME_RE.exec(time);
  if (!match) {
    return time;
  }
  const shifted = (((Number(match[1]) + hours) % 24) + 24) % 24;
  return `${String(shifted).padStart(2, '0')}:${match[2]}`;
}

/**
 * Minutes between two HH:MM times, treating a smaller end as the next day.
 *
 * Used to keep an event's duration while its start moves: an event set to run
 * 90 minutes should still run 90 minutes after the start is nudged, rather than
 * silently becoming an hour because that is the default.
 */
export function minutesBetween(from: string, to: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) {
      return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
  };
  const start = parse(from);
  const end = parse(to);
  if (start === null || end === null) {
    return null;
  }
  return end >= start ? end - start : 24 * 60 - start + end;
}

/** Add whole minutes to an HH:MM time, wrapping at midnight. */
export function addMinutes(time: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) {
    return time;
  }
  const total = (Number(match[1]) * 60 + Number(match[2]) + minutes + 24 * 60) % (24 * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
