/**
 * Where an item came from, per Task Hub's `X-TASKHUB-ORIGIN` property.
 *
 * Task Hub stamps every VTODO and VEVENT it writes with the service the item
 * originally came from. A missing property is meaningful rather than unknown:
 * it means the item was written by some other CalDAV client and never went
 * through Task Hub's sync engine, which Task Hub labels "3rd party".
 *
 * The mapping is a table rather than a switch so adding a service later is a
 * one-line data change. Several values collapse to "3rd party" today only
 * because they have not been tested against live accounts — the raw value is
 * preserved on the item if they need telling apart later.
 */

export const ORIGIN_LABELS: Record<string, string> = {
  google: 'Google',
  todoist: 'Todoist',
  ticktick: 'TickTick',
  local: 'Task Hub',
  obsidian: 'Obsidian',
  // Written by this plugin; Task Hub recognises it and badges it teal.
  supernote: 'Supernote',
  apple: '3rd party',
  microsoft: '3rd party',
  things3: '3rd party',
  radicale: '3rd party',
};

export const THIRD_PARTY = '3rd party';

/**
 * Badge text for an item's origin.
 *
 * Anything unrecognised — including a service added to Task Hub after this
 * build — falls back to the third-party badge rather than showing a raw slug.
 */
export function originLabel(origin?: string): string {
  const key = (origin ?? '').trim().toLowerCase();
  if (!key) {
    return THIRD_PARTY;
  }
  return ORIGIN_LABELS[key] ?? THIRD_PARTY;
}

/**
 * Whether the badge deserves visual emphasis.
 *
 * Task Hub distinguishes origins by colour, which a monochrome e-ink panel
 * cannot reproduce. Named services get a solid badge and the generic
 * third-party ones an outline, which is the closest equivalent that survives
 * a 1-bit display.
 */
export function originIsNamed(origin?: string): boolean {
  return originLabel(origin) !== THIRD_PARTY;
}
