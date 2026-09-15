import {parseVEvents} from './ical';
import {feedNameFromIcal, type CalendarFeed} from './feeds';
import {ensureInternet} from './permissions';
import {readNamed, writeNamed} from './storage';
import type {RemoteEvent} from './tasks';

/**
 * Fetching `.ics` subscriptions, and keeping what came back.
 *
 * A feed is the opposite trade to a CalDAV collection. The collection answers a
 * `time-range` REPORT, so only the window being looked at crosses the network;
 * the feed is one file containing every event the calendar has ever held, and
 * there is no way to ask for less. On an e-ink CPU that is exactly the cost the
 * 0.54–0.64 work removed, so it has to be bought back carefully:
 *
 * - **Conditional GET.** The stored `ETag` and `Last-Modified` go back as
 *   `If-None-Match` and `If-Modified-Since`, and a `304` means the body already
 *   on disk is current — no download and, much more importantly, no re-parse.
 * - **The body is kept on disk.** A cold open therefore has real events to draw
 *   before the network answers, and a feed that is unreachable shows what it
 *   last said rather than vanishing.
 * - **Parsing yields.** `parseVEvents` is synchronous over a file that can hold
 *   thousands of events, so feeds are parsed one at a time with a turn of the
 *   event loop between them. A resolved promise is a microtask and yields to
 *   nothing; `setTimeout` is what actually lets the panel draw.
 */

const TAG = '[TaskHub]';

/** Stored validators, keyed by feed URL. Bodies live in their own files. */
const INDEX_FILE = 'feeds.json';
const FORMAT = 1;

interface Validator {
  etag?: string;
  lastModified?: string;
  /** The file the body was written to, relative to the plugin's own folder. */
  body: string;
  /** The calendar's own name when it announced one. */
  name?: string;
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

/** A filename for one feed's body. Same djb2 reasoning as the page previews. */
function bodyName(url: string): string {
  /* eslint-disable no-bitwise */
  let hash = 5381;
  for (let i = 0; i < url.length; i += 1) {
    hash = ((hash * 33) ^ url.charCodeAt(i)) | 0;
  }
  return `feed-${(hash >>> 0).toString(36)}.ics`;
  /* eslint-enable no-bitwise */
}

/** Give the event loop a turn. A microtask would not. */
function breathe(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export interface FeedResult {
  events: RemoteEvent[];
  /** Feeds that could not be reached at all, by name, for reporting. */
  failed: string[];
  /** Names the feeds announced, so the settings list can show the real one. */
  names: Record<string, string>;
}

/**
 * Fetch every subscription and turn it into events.
 *
 * Nothing here throws: a feed is an addition to the calendar, and one that is
 * unreachable must not be able to stop the CalDAV collections — or the other
 * feeds — from being shown. Failures are collected and reported instead.
 */
export async function listFeedEvents(feeds: CalendarFeed[]): Promise<FeedResult> {
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
    let body: string | null = null;

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
        body = await readNamed(stored.body);
      } else if (response.ok) {
        body = await response.text();
        const name = bodyName(feed.url);
        await writeNamed(name, body);
        index[feed.url] = {
          etag: response.headers.get('etag') ?? undefined,
          lastModified: response.headers.get('last-modified') ?? undefined,
          body: name,
          name: feedNameFromIcal(body) || stored?.name,
        };
        changed = true;
      } else {
        console.log(`${TAG} feed ${feed.name} answered HTTP ${response.status}`);
      }
    } catch (err) {
      console.log(`${TAG} feed ${feed.name} failed: ${String(err)}`);
    }

    // Whatever happened above, fall back to the last body that was stored. A
    // calendar the user could see yesterday should not disappear because the
    // device is off the network today.
    if (body === null && stored) {
      body = await readNamed(stored.body);
    }
    if (body === null) {
      failed.push(feed.name);
      continue;
    }

    const announced = index[feed.url]?.name;
    if (announced) {
      names[feed.url] = announced;
    }
    const label = announced || feed.name;
    for (const event of parseVEvents(body)) {
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
 * Forget a feed's stored body and validators.
 *
 * Called when a subscription is removed, so unsubscribing actually reclaims the
 * space rather than leaving a stale `.ics` in the plugin's folder forever.
 */
export async function forgetFeed(url: string): Promise<void> {
  const index = decodeFeedIndex(await readNamed(INDEX_FILE));
  if (!index[url]) {
    return;
  }
  // The body file is emptied rather than deleted: the native module writes and
  // reads named files but has no remove, and an empty file parses to no events.
  await writeNamed(index[url].body, '');
  delete index[url];
  await writeNamed(INDEX_FILE, encodeFeedIndex(index));
}
