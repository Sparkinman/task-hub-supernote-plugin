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
  const upgraded = trimmed.replace(/^webcal:\/\//i, 'https://');
  if (/^http:\/\//i.test(upgraded)) {
    return {error: 'insecure'};
  }
  if (!/^https:\/\//i.test(upgraded)) {
    return {error: 'malformed'};
  }
  try {
    // Constructing it is the check: a bare "https://" or a space in the host
    // throws here rather than failing later inside fetch.
    const parsed = new URL(upgraded);
    if (!parsed.hostname.includes('.')) {
      return {error: 'malformed'};
    }
    return {url: parsed.toString()};
  } catch {
    return {error: 'malformed'};
  }
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
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    return host || 'Subscribed calendar';
  } catch {
    return 'Subscribed calendar';
  }
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
export function parseFeedList(text: string): {feeds: CalendarFeed[]; skipped: number} {
  const feeds: CalendarFeed[] = [];
  let skipped = 0;
  for (const line of (text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    // Split on the LAST bar. A URL cannot contain an unescaped one — it has to
    // be percent-encoded — but a calendar name readily can ("Work | Home"), so
    // splitting on the first would cut such a name in half and leave the
    // remainder of it glued to the front of the address.
    const bar = trimmed.lastIndexOf('|');
    const rawName = bar >= 0 ? trimmed.slice(0, bar).trim() : '';
    const rawUrl = bar >= 0 ? trimmed.slice(bar + 1).trim() : trimmed;
    const {url} = normaliseFeedUrl(rawUrl);
    if (!url) {
      skipped += 1;
      continue;
    }
    feeds.push({url, name: rawName || defaultFeedName(url)});
  }
  return {feeds, skipped: skipped};
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
