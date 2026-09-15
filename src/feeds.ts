/**
 * Read-only calendar subscriptions: an `.ics` feed at an HTTPS address.
 *
 * This is how Task Hub reaches the two services a CalDAV client cannot:
 *
 * - **Google** withdrew basic-auth CalDAV in March 2025. Its CalDAV endpoint
 *   now requires a full OAuth application flow, so no password — app-specific
 *   or otherwise — will reach it.
 * - **Microsoft** retired CalDAV for Outlook.com and 365 altogether; the
 *   replacement is Graph, a REST API.
 *
 * Both still publish a private `.ics` address per calendar, and so do Apple,
 * Fastmail and Proton. Subscribing to one needs no account, no token and no
 * registered application — which is the whole point, because an OAuth client
 * secret cannot be shipped inside a GPL plugin without being extractable, and a
 * plugin that only runs while it is open cannot refresh a token in the
 * background. Anyone wanting genuine two-way sync with Google or Outlook should
 * put it in the Task Hub server, which can hold a secret and run on a schedule.
 *
 * The cost of a feed is that it is **read-only**. There is no href to PUT back
 * to, so an event from one can be read, filed under a meeting note, and nothing
 * else. That has to be visible in the UI rather than discovered by a write that
 * fails.
 *
 * Pure on purpose: no SDK and no fetch, so the URL rules and the setup-file
 * format are unit-tested off-device.
 */

import {parseVEvents, type VEvent} from './ical';
import type {DateRange} from './eventwindow';

/** One subscription, as the settings hold it. */
export interface CalendarFeed {
  /** Always https:// by the time it is stored. */
  url: string;
  /** What to call it in the calendar views. Never blank once stored. */
  name: string;
}

/** Why a URL was refused, in words the settings screen can show. */
export type FeedUrlError = 'empty' | 'insecure' | 'malformed';

export interface FeedUrlResult {
  url?: string;
  error?: FeedUrlError;
}

export const FEED_URL_MESSAGES: Record<FeedUrlError, string> = {
  empty: 'Paste the calendar address first.',
  // A feed address is the credential — anyone holding it can read the calendar
  // — so sending it in clear over the network is not a trade worth offering.
  insecure: 'Only https:// addresses are accepted. An http:// one is not private.',
  malformed: 'That does not look like a calendar address.',
};

/**
 * Normalise a subscription address, or say why it cannot be used.
 *
 * `webcal://` is the scheme calendar apps advertise and is plain HTTPS
 * underneath, so it is upgraded rather than rejected — a user who copied the
 * link a provider offered should not have to know that.
 */
export function normaliseFeedUrl(raw: string): FeedUrlResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return {error: 'empty'};
  }
  let upgraded = trimmed.replace(/^webcal:\/\//i, 'https://');
  // Protocol-relative, e.g. "//calendar.google.com/…". Some places that offer a
  // calendar link hand one out this way, and a person copying it has no reason
  // to know it is missing a scheme. It can only mean https here.
  if (/^\/\/[^/]/.test(upgraded)) {
    upgraded = `https:${upgraded}`;
  }
  if (/^http:\/\//i.test(upgraded)) {
    return {error: 'insecure'};
  }
  // Matched rather than parsed with `new URL`.
  //
  // React Native ships an incomplete URL polyfill: `new URL(...)` does not
  // throw on rubbish and `hostname` comes back empty, so a check written
  // against it passes every unit test under Node and rejects every real
  // address on the device. This cost a build cycle — the whole feature looked
  // broken because no address could be added. Anything here that needs a piece
  // of a URL takes it with a regex.
  //
  // scheme, a host with at least one dot and no whitespace, then anything.
  const match = /^https:\/\/([^/\s?#]+)(?:[/?#]\S*)?$/i.exec(upgraded);
  if (!match || !match[1].includes('.') || match[1].startsWith('.')) {
    return {error: 'malformed'};
  }
  return {url: upgraded};
}

/**
 * A readable name for a feed nobody has named.
 *
 * Providers hide the calendar's real name inside an opaque path — Google's
 * export ends `/basic.ics` under a long random id — so the last path segment is
 * usually useless. The host is at least recognisable, and the name is editable
 * afterwards. The feed's own `X-WR-CALNAME` is better still and replaces this
 * once the first fetch has happened.
 */
export function defaultFeedName(url: string): string {
  // Regex, not `new URL` — see the note in `normaliseFeedUrl`.
  const match = /^https?:\/\/([^/\s?#:]+)/i.exec((url ?? '').trim());
  const host = match ? match[1].replace(/^www\./i, '') : '';
  return host || 'Subscribed calendar';
}

/**
 * The calendar's own name, from `X-WR-CALNAME`.
 *
 * Non-standard but universal: Google, Apple, Outlook and Fastmail all write it,
 * and it is the only thing in an `.ics` file that says what the calendar is
 * called. Returns '' when absent, which leaves whatever name is already stored
 * alone.
 */
export function feedNameFromIcal(text: string): string {
  const match = /^X-WR-CALNAME(?:;[^:\r\n]*)?:(.*)$/im.exec(text ?? '');
  return match ? match[1].trim().replace(/\\,/g, ',').replace(/\\\\/g, '\\') : '';
}

/**
 * Feeds listed in a plain text file, one per line.
 *
 * The reason this exists rather than only a text box: a private feed address is
 * around a hundred characters of random, and typing one on an e-ink keyboard is
 * miserable enough that people give up. Dropping a file on the device over USB
 * and importing it is the difference between the feature being usable and not.
 *
 * `Name|https://…` names the calendar; a bare URL takes its host as a name
 * until the first fetch reads `X-WR-CALNAME`. Blank lines and `#` comments are
 * skipped, and a line that is not a usable address is skipped rather than
 * failing the whole import — one typo should not discard the other nine.
 */
export function parseFeedList(text: string): {
  feeds: CalendarFeed[];
  skipped: number;
  /** The first line that was not usable, verbatim, so it can be shown back. */
  firstBad?: string;
} {
  const feeds: CalendarFeed[] = [];
  let skipped = 0;
  let firstBad: string | undefined;
  // A leading byte-order mark is invisible and makes the first line fail
  // `^https://` — Windows Notepad writes one by default, so the commonest way
  // to produce this file is also the one that silently breaks it.
  const body = (text ?? '').replace(/^\uFEFF/, '');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^\uFEFF/, '');
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const split = splitFeedLine(trimmed);
    if (!split) {
      skipped += 1;
      if (firstBad === undefined) {
        firstBad = trimmed;
      }
      continue;
    }
    feeds.push(split);
  }
  return {feeds, skipped, firstBad};
}

/**
 * Which file in the Task Hub folder to import from.
 *
 * `calendars.txt` is what the instructions say, but the instructions are
 * followed by somebody typing a filename on a computer, so it is matched
 * case-insensitively — and when it is absent but exactly one `.txt` file is
 * there, that one is used. A person who saved `Calendars.TXT`, or named it
 * after their own calendar, meant the file they put in the folder.
 *
 * Returns '' when there is nothing to choose, so the caller can say what it
 * looked for rather than failing silently.
 */
export function pickFeedListFile(names: string[], wanted: string): string {
  const texts = names.filter(n => n.toLowerCase().endsWith('.txt'));
  const exact = texts.find(n => n.toLowerCase() === wanted.toLowerCase());
  if (exact) {
    return exact;
  }
  return texts.length === 1 ? texts[0] : '';
}

/**
 * One line of a setup file, split into a name and an address.
 *
 * Three attempts, most specific first, because people write this file by hand
 * and every reasonable reading should work:
 *
 * 1. **After the last bar.** A URL cannot hold an unescaped `|` — it has to be
 *    percent-encoded — but a calendar name readily can ("Work | Home").
 * 2. **After the first bar.** Covers a name that itself contains a bar in a
 *    line whose address somehow does too.
 * 3. **The whole line.** Covers an address that merely happens to contain one,
 *    and a line with no name at all.
 *
 * Returns null when none of the three yields a usable address, which is what
 * makes the line worth reporting back to the user rather than silently dropping.
 */
export function splitFeedLine(line: string): CalendarFeed | null {
  const trimmed = line.trim();
  const attempts: {name: string; raw: string}[] = [];

  const last = trimmed.lastIndexOf('|');
  if (last >= 0) {
    attempts.push({name: trimmed.slice(0, last).trim(), raw: trimmed.slice(last + 1).trim()});
  }
  const first = trimmed.indexOf('|');
  if (first >= 0 && first !== last) {
    attempts.push({name: trimmed.slice(0, first).trim(), raw: trimmed.slice(first + 1).trim()});
  }
  attempts.push({name: '', raw: trimmed});

  for (const attempt of attempts) {
    const {url} = normaliseFeedUrl(attempt.raw);
    if (url) {
      return {url, name: attempt.name || defaultFeedName(url)};
    }
  }
  return null;
}

/** Feeds compare by URL, ignoring a trailing slash, as collections do. */
export function sameFeed(a: string, b: string): boolean {
  const tidy = (u: string) => u.trim().replace(/\/+$/, '');
  return tidy(a) === tidy(b);
}

/** Add a feed, or replace the name of one already subscribed. */
export function addFeed(feeds: CalendarFeed[], feed: CalendarFeed): CalendarFeed[] {
  const existing = feeds.findIndex(f => sameFeed(f.url, feed.url));
  if (existing < 0) {
    return [...feeds, feed];
  }
  const next = [...feeds];
  next[existing] = {...next[existing], name: feed.name};
  return next;
}

export function removeFeed(feeds: CalendarFeed[], url: string): CalendarFeed[] {
  return feeds.filter(f => !sameFeed(f.url, url));
}

/** Merge an imported list into the stored one, reporting what was new. */
export function mergeFeeds(
  current: CalendarFeed[],
  incoming: CalendarFeed[],
): {feeds: CalendarFeed[]; added: number} {
  let feeds = current;
  let added = 0;
  for (const feed of incoming) {
    const before = feeds.length;
    feeds = addFeed(feeds, feed);
    if (feeds.length > before) {
      added += 1;
    }
  }
  return {feeds, added};
}

/* ------------------------------------------------------------------ *
 * Reading a feed's body
 * ------------------------------------------------------------------ */

/** VEVENTs parsed between yields. Big enough to be worth it, small enough to yield. */
const PARSE_CHUNK = 200;

/** Give the event loop a turn. A microtask would not. */
function breathe(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Parse a whole `.ics` body without blocking the panel.
 *
 * `parseVEvents` is synchronous, so a calendar holding thousands of events
 * parsed in one call freezes the panel outright — and unlike a CalDAV REPORT
 * there is no way to have asked for less. The body is therefore cut at
 * `END:VEVENT` boundaries and parsed a few hundred events at a time, with a
 * turn of the event loop between. `setTimeout`, not an awaited promise: a
 * resolved promise is a microtask and yields to nothing.
 *
 * This works because `parseVEvents` collects whatever lies between
 * `BEGIN:VEVENT` and `END:VEVENT` and ignores everything else — it does not
 * need the `VCALENDAR` wrapper, which only the first chunk has.
 */
export async function parseFeedBody(body: string): Promise<VEvent[]> {
  const events: VEvent[] = [];
  let chunk: string[] = [];
  let seen = 0;

  for (const line of (body ?? '').split(/\r?\n/)) {
    chunk.push(line);
    if (line.startsWith('END:VEVENT')) {
      seen += 1;
      if (seen >= PARSE_CHUNK) {
        events.push(...parseVEvents(chunk.join('\r\n')));
        chunk = [];
        seen = 0;
        await breathe();
      }
    }
  }
  if (chunk.length > 0) {
    events.push(...parseVEvents(chunk.join('\r\n')));
  }
  return events;
}

/**
 * Cut parsed events down to the window being looked at.
 *
 * The file holds every event the calendar has ever had; the views show three
 * months back and twelve forward. Only that much should reach React state,
 * which is what the month and year grids re-render against.
 *
 * A repeating event is kept whatever its start date, because the master is what
 * `expand.ts` derives the visible occurrences from — a weekly stand-up begun in
 * 2019 still happens this week, and dropping it for being old would silently
 * empty the calendar of everything regular.
 *
 * An unparseable range keeps everything rather than guessing: showing too much
 * is slow, showing nothing looks broken.
 */
export function withinWindow<T extends VEvent>(events: T[], range: DateRange): T[] {
  const from = Date.parse(`${range.start}T00:00:00`);
  const to = Date.parse(`${range.end}T00:00:00`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return events;
  }
  return events.filter(e => e.recurring || (e.startAt >= from && e.startAt < to));
}
