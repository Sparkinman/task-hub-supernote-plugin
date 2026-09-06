/**
 * How important a task is, as RFC 5545 records it and as a person picks it.
 *
 * iCalendar stores PRIORITY as a number 0–9: 0 means undefined, 1 is the
 * highest and 9 the lowest, and RFC 5545 §3.8.1.9 groups them as 1–4 high,
 * 5 medium, 6–9 low. Nobody wants to choose a number on a tablet, and other
 * clients write whatever they like within those bands — Task Hub itself writes
 * 1, 5 and 9 — so this module reads the whole range and offers three choices.
 *
 * The bands are the unit the UI works in, and the number is only what goes over
 * CalDAV. That way a task another client saved as PRIORITY:3 shows as High here
 * and stays 3 unless somebody actually changes it.
 *
 * Pure on purpose: no SDK import, so jest can exercise it off-device.
 */

export type PriorityBand = 'none' | 'high' | 'medium' | 'low';

/**
 * The choices offered, in the order they are shown, with the number each one
 * writes. Middle-of-band values rather than edge ones: writing 1 for High and 9
 * for Low leaves room either side for a client with finer gradations, and 5 is
 * the only value RFC 5545 calls medium.
 */
export const PRIORITY_BANDS: {key: PriorityBand; label: string; value: number}[] = [
  {key: 'none', label: 'None', value: 0},
  {key: 'high', label: 'High', value: 1},
  {key: 'medium', label: 'Medium', value: 5},
  {key: 'low', label: 'Low', value: 9},
];

/** Which band a stored PRIORITY number falls in. */
export function bandOf(priority?: number): PriorityBand {
  if (typeof priority !== 'number' || !Number.isFinite(priority)) {
    return 'none';
  }
  const value = Math.round(priority);
  // Anything outside 1–9 is undefined, which includes the 0 the spec uses for
  // "no priority" and the out-of-range values a careless client might write.
  if (value < 1 || value > 9) {
    return 'none';
  }
  if (value <= 4) {
    return 'high';
  }
  if (value === 5) {
    return 'medium';
  }
  return 'low';
}

/** The number to write for a chosen band. 0 means the property is dropped. */
export function valueOf(band: PriorityBand): number {
  return PRIORITY_BANDS.find(b => b.key === band)?.value ?? 0;
}

/** The word shown on a task's badge, or null when it has no priority set. */
export function priorityLabel(priority?: number): string | null {
  const band = bandOf(priority);
  return band === 'none' ? null : PRIORITY_BANDS.find(b => b.key === band)!.label;
}

/**
 * A PRIORITY value read from an iCalendar property, or undefined when the line
 * is missing or unusable.
 *
 * Out-of-range numbers are kept rather than discarded: `bandOf` already treats
 * them as no priority, and throwing the value away would silently rewrite
 * another client's data on the next edit.
 */
export function parsePriority(raw: string): number | undefined {
  const text = raw.trim();
  // Number('') is 0, not NaN — without this an empty PRIORITY line would be
  // recorded as a real value of zero rather than as no line at all.
  if (!text) {
    return undefined;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(value);
}

/**
 * Sort comparator: higher priority first, with unset tasks last.
 *
 * Not a sort order of its own — it breaks ties inside an existing order, so a
 * list stays sorted by date and only uses this to decide between two tasks due
 * the same day.
 */
export function comparePriority(a?: number, b?: number): number {
  const rank = (p?: number) => {
    const band = bandOf(p);
    return band === 'none' ? 4 : band === 'high' ? 1 : band === 'medium' ? 2 : 3;
  };
  return rank(a) - rank(b);
}
