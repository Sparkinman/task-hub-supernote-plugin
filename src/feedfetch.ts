import type {VEvent} from './ical';
import {
  feedNameFromIcal,
  parseFeedBody,
  withinWindow,
  type CalendarFeed,
} from './feeds';
import {ensureInternet} from './permissions';
import {readNamed, writeNamed} from './storage';
import type {DateRange} from './eventwindow';
import type {RemoteEvent} from './tasks';

/**
 * Fetching `.ics` subscriptions, and keeping what came back.
 *
 * A feed is the opposite trade to a CalDAV collection. The collection answers a
 * `time-range` REPORT, so only the window being looked at crosses the network
 * and only that much is ever parsed. A feed is one file holding every event the
 * calendar has ever had, and there is no way to ask for less. On an e-ink CPU
 * that is exactly the cost the 0.54–0.64 work removed, so all of it has to be
 * bought back deliberately:
 *
 * 1. **Conditional GET.** The stored `ETag` and `Last-Modified` go back as
 *    `If-None-Match` / `If-Modified-Since`. A `304` means no download.
 * 2. **The parsed events are cached, not the iCal text.** This is the one that
 *    matters. Downloading is network time the user can wait through; parsing
 *    thousands of VEVENTs in JavaScript is CPU time that blocks the panel. So
 *    the parse result is stored as JSON and a `304` reloads *that*, never
 *    re-reading the iCal. `JSON.parse` of an array is an order of magnitude
 *    cheaper than walking iCalendar line by line.
 * 3. **The first parse is chunked.** `parseVEvents` is synchronous, so a large
 *    calendar parsed in one call freezes the panel outright. The body is split
 *    on `END:VEVENT` boundaries and parsed a few hundred events at a time with
 *    a turn of the event loop between — `setTimeout`, not an awaited promise,
 *    because a resolved promise is a microtask and yields to nothing.
 * 4. **Everything is windowed on the way out.** The file holds ten years; the
 *    calendar is showing three months back and twelve forward. Only that much
 *    reaches React state, which is what the month and year grids re-render
 *    against.
 *
 * The cached JSON is also what makes a cold open draw instantly and an offline
 * device keep showing the calendar it had yesterday.
 */

const TAG = '[TaskHub]';

/** Stored validators, keyed by feed URL. Parsed events live in their own files. */
const INDEX_FILE = 'feeds.json';
const FORMAT = 2;

interface Validator {
  etag?: string;
  lastModified?: string;
  /** File holding the parsed events as JSON, inside the plugin's own folder. */
  events: string;
  /** The calendar's own name when it announced one. */
  name?: string;
  /** How many events that file holds, for the log line. */
  count?: number;
}

interface IndexShape {
  version: number;
  feeds: Record<string, Validator>;
}

export function decodeFeedIndex(text: string | null | undefined): Record<string, Validator> {
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as IndexShape;
    // A version bump drops the old index rather than migrating it: the worst
    // case is one full re-fetch, and every feed can be fetched again.
    if (!parsed || parsed.version !== FORMAT || typeof parsed.feeds !== 'object') {
      return {};
    }
    return parsed.feeds ?? {};
  } catch {
    return {};
  }
}

export function encodeFeedIndex(feeds: Record<string, Validator>): string {
  return JSON.stringify({version: FORMAT, feeds} satisfies IndexShape);
}

/** A filename for one feed's events. Same djb2 reasoning as the page previews. */
function eventsName(url: string): string {
  /* eslint-disable no-bitwise */
  let hash = 5381;
  for (let i = 0; i < url.length; i += 1) {
    hash = ((hash * 33) ^ url.charCodeAt(i)) | 0;
  }
  return `feed-${(hash >>> 0).toString(36)}.json`;
  /* eslint-enable no-bitwise */
}

/** Give the event loop a turn. A microtask would not. */
function breathe(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export interface FeedResult {
  events: RemoteEvent[];
  /** Feeds that could not be reached and had nothing stored, by name. */
  failed: string[];
  /** Names the feeds announced, so the settings list can show the real one. */
  names: Record<string, string>;
}

interface StoredEvents {
  version: number;
  events: VEvent[];
}

async function readStored(name: string): Promise<VEvent[] | null> {
  const text = await readNamed(name);
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as StoredEvents;
    return parsed?.version === FORMAT && Array.isArray(parsed.events) ? parsed.events : null;
  } catch {
    return null;
  }
}

/**
 * Fetch every subscription and turn it into events within `range`.
 *
 * Nothing here throws: a feed is an addition to the calendar, and one that is
 * unreachable must not stop the CalDAV collections — or the other feeds — from
 * being shown. Failures are collected and reported instead.
 */
export async function listFeedEvents(
  feeds: CalendarFeed[],
  range: DateRange,
): Promise<FeedResult> {
  if (feeds.length === 0) {
    return {events: [], failed: [], names: {}};
  }
  await ensureInternet();

  const index = decodeFeedIndex(await readNamed(INDEX_FILE));
  const events: RemoteEvent[] = [];
  const failed: string[] = [];
  const names: Record<string, string> = {};
  let changed = false;

  for (const feed of feeds) {
    const stored = index[feed.url];
    let parsed: VEvent[] | null = null;

    try {
      const headers: Record<string, string> = {Accept: 'text/calendar, text/plain;q=0.5'};
      if (stored?.etag) {
        headers['If-None-Match'] = stored.etag;
      }
      if (stored?.lastModified) {
        headers['If-Modified-Since'] = stored.lastModified;
      }
      // No Authorization header, ever. The secret is the address itself; a feed
      // that wanted credentials would be a CalDAV collection instead.
      const response = await fetch(feed.url, {headers});

      if (response.status === 304 && stored) {
        // The whole point of the conditional request: nothing downloaded, and
        // nothing re-parsed either.
        parsed = await readStored(stored.events);
      } else if (response.ok) {
        const body = await response.text();
        parsed = await parseFeedBody(body);
        const name = eventsName(feed.url);
        await writeNamed(name, JSON.stringify({version: FORMAT, events: parsed}));
        index[feed.url] = {
          etag: response.headers.get('etag') ?? undefined,
          lastModified: response.headers.get('last-modified') ?? undefined,
          events: name,
          name: feedNameFromIcal(body) || stored?.name,
          count: parsed.length,
        };
        changed = true;
        console.log(`${TAG} feed ${feed.name}: parsed ${parsed.length} events`);
      } else {
        console.log(`${TAG} feed ${feed.name} answered HTTP ${response.status}`);
      }
    } catch (err) {
      console.log(`${TAG} feed ${feed.name} failed: ${String(err)}`);
    }

    // Whatever happened above, fall back to what was last stored. A calendar the
    // user could see yesterday should not disappear because the device is off
    // the network today.
    if (parsed === null && stored) {
      parsed = await readStored(stored.events);
    }
    if (parsed === null) {
      failed.push(feed.name);
      continue;
    }

    const announced = index[feed.url]?.name;
    if (announced) {
      names[feed.url] = announced;
    }
    const label = announced || feed.name;
    for (const event of withinWindow(parsed, range)) {
      events.push({
        ...event,
        calendarLabel: label,
        calendarUrl: feed.url,
        // No href and no etag: there is nowhere to PUT this back to. `readOnly`
        // is what the UI keys off, rather than inferring it from an empty href,
        // so the reason is stated rather than deduced.
        href: '',
        raw: '',
        readOnly: true,
      });
    }
    await breathe();
  }

  if (changed) {
    await writeNamed(INDEX_FILE, encodeFeedIndex(index));
  }
  return {events, failed, names};
}

/**
 * Forget a feed's stored events and validators.
 *
 * Called when a subscription is removed, so unsubscribing reclaims the space
 * rather than leaving a stale cache in the plugin's folder forever.
 */
export async function forgetFeed(url: string): Promise<void> {
  const index = decodeFeedIndex(await readNamed(INDEX_FILE));
  if (!index[url]) {
    return;
  }
  // Emptied rather than deleted: the native module writes and reads named files
  // but has no remove, and an empty file decodes to nothing.
  await writeNamed(index[url].events, '');
  delete index[url];
  await writeNamed(INDEX_FILE, encodeFeedIndex(index));
}
