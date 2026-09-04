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
