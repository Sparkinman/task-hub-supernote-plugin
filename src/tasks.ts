import {XMLParser} from 'fast-xml-parser';

import {
  buildVEvent,
  markCompleted,
  parseVEvents,
  parseVTodos,
  updateVEvent,
  updateVTodo,
  type EventDraft,
  type TaskEdit,
  type VEvent,
  type VTodo,
} from './ical';
import {authHeader} from './caldav';
import {resolveHref} from './discovery';
import {ensureInternet} from './permissions';
import {collectionName, type RadicaleConfig} from './settings';

/**
 * Reading and writing tasks across the watched collections.
 *
 * Listing uses a single REPORT calendar-query per collection rather than
 * PROPFIND-then-GET-each: one round trip returns every VTODO's full
 * calendar-data, which matters on a device where each request is slow.
 */

export interface RemoteTask extends VTodo {
  /** Absolute URL of this task's calendar object. */
  href: string;
  /** ETag, required for a safe conditional write. */
  etag?: string;
  /** Raw calendar object, edited in place when completing or editing. */
  raw: string;
  /** Which watched collection this came from. */
  collectionUrl: string;
  collectionLabel: string;
}

/** A watched collection the server no longer serves. */
export interface MissingCollection {
  url: string;
  label: string;
  status: number;
  kind: 'task' | 'calendar';
}

/**
 * Raised when one collection is gone, as distinct from a request that failed.
 *
 * 404/410 mean it was deleted; 403 means the credential lost its rights to it.
 * Either way the URL saved in settings will never work again, so retrying is
 * pointless and the user has to change the configuration. Everything else —
 * timeouts, 5xx, a captive portal — is transient and must keep failing loudly.
 */
export class CollectionGoneError extends Error {
  /**
   * Duck-typed marker instead of `instanceof`.
   *
   * Subclassing Error is unreliable once TypeScript downlevels it, and the
   * check would then silently fall through to the rethrow, which is exactly
   * the bug this class exists to fix.
   */
  readonly gone = true;

  constructor(
    readonly url: string,
    readonly label: string,
    readonly status: number,
    readonly kind: 'task' | 'calendar',
  ) {
    super(`"${label}" is no longer on the server (HTTP ${status}).`);
    this.name = 'CollectionGoneError';
  }
}

function isGone(err: unknown): err is CollectionGoneError {
  return typeof err === 'object' && err !== null && (err as {gone?: boolean}).gone === true;
}

/** True when a status means the collection itself is gone, not the request. */
function collectionIsGone(status: number): boolean {
  return status === 403 || status === 404 || status === 410;
}

/** What a list call returns: the items it could fetch, plus any dead lists. */
export interface ListResult<T> {
  items: T[];
  missing: MissingCollection[];
}

/**
 * Fold per-collection results into one set, keeping dead lists separate.
 *
 * A vanished collection must not take the whole refresh down with it — one
 * removed list used to blank tasks, calendars and note scans alike, because
 * they all share a Promise.all. Genuine failures still propagate.
 */
function collect<T>(settled: PromiseSettledResult<T[]>[]): ListResult<T> {
  const items: T[] = [];
  const missing: MissingCollection[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else if (isGone(result.reason)) {
      const {url, label, status, kind} = result.reason;
      missing.push({url, label, status, kind});
    } else {
      throw result.reason;
    }
  }
  return {items, missing};
}

/**
 * What to tell the user about lists that have vanished.
 *
 * Says plainly that the rest of the refresh worked, so a dead list does not
 * read as "sync is broken", and names the one action that stops the message.
 */
export function missingMessage(missing: MissingCollection[]): string {
  if (missing.length === 0) {
    return '';
  }
  const names = missing
    .map(m => `"${m.label}" (${m.kind === 'task' ? 'task list' : 'calendar'})`)
    .join(', ');
  const one = missing.length === 1;
  const lead = one
    ? `${names} is no longer on the server.`
    : `These are no longer on the server: ${names}.`;
  // 403 is not the same story as 404: the collection may well still exist.
  const why = missing.some(m => m.status === 403)
    ? one
      ? ' It was deleted, or this login has lost access to it.'
      : ' They were deleted, or this login has lost access to them.'
    : '';
  const fix = one ? 'untick it' : 'untick them';
  return (
    `${lead}${why} Everything else refreshed normally. ` +
    `Open Settings, tap Discover, and ${fix} to stop this message.`
  );
}

const EVENT_QUERY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<D:prop><D:getetag/><C:calendar-data/></D:prop>' +
  '<C:filter><C:comp-filter name="VCALENDAR">' +
  '<C:comp-filter name="VEVENT"/>' +
  '</C:comp-filter></C:filter>' +
  '</C:calendar-query>';

const CALENDAR_QUERY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<D:prop><D:getetag/><C:calendar-data/></D:prop>' +
  '<C:filter><C:comp-filter name="VCALENDAR">' +
  '<C:comp-filter name="VTODO"/>' +
  '</C:comp-filter></C:filter>' +
  '</C:calendar-query>';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

async function listOne(config: RadicaleConfig, collection: string): Promise<RemoteTask[]> {
  const url = collection.trim().replace(/\/+$/, '');
  const response = await fetch(url, {
    method: 'REPORT',
    headers: {
      Authorization: authHeader(config),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: CALENDAR_QUERY,
  });

  if (response.status === 401) {
    throw new Error('Radicale rejected those credentials.');
  }
  if (collectionIsGone(response.status)) {
    throw new CollectionGoneError(url, collectionName(url), response.status, 'task');
  }
  if (!response.ok && response.status !== 207) {
    throw new Error(`Could not list "${collectionName(url)}" (HTTP ${response.status}).`);
  }

  const doc = parser.parse(await response.text());
  const label = collectionName(url);
  const tasks: RemoteTask[] = [];

  for (const entry of asArray(doc?.multistatus?.response)) {
    const href = typeof entry?.href === 'string' ? entry.href : '';
    if (!href) {
      continue;
    }

    for (const propstat of asArray(entry.propstat)) {
      const status = String(propstat?.status ?? '');
      if (status && !status.includes('200')) {
        continue;
      }

      const raw = propstat?.prop?.['calendar-data'];
      if (typeof raw !== 'string' || !raw.includes('BEGIN:VTODO')) {
        continue;
      }

      const etag = propstat?.prop?.getetag;
      for (const todo of parseVTodos(raw)) {
        tasks.push({
          ...todo,
          href: resolveHref(config.serverUrl || url, href),
          etag: typeof etag === 'string' ? etag : undefined,
          raw,
          collectionUrl: url,
          collectionLabel: label,
        });
      }
    }
  }

  return tasks;
}

/**
 * Every task across every watched collection.
 *
 * Collections are queried in parallel — on a slow device, serialising four
 * lists would be four round trips of latency instead of one. A failure in any
 * one list surfaces rather than silently yielding a partial set, which would
 * look identical to "those tasks were completed elsewhere".
 */
export async function listTasks(config: RadicaleConfig): Promise<ListResult<RemoteTask>> {
  await ensureInternet();

  const settled = await Promise.allSettled(
    config.collectionUrls.map(url => listOne(config, url)),
  );
  return collect(settled);
}

export interface RemoteEvent extends VEvent {
  calendarLabel: string;
  calendarUrl: string;
  /** Absolute URL of this event's calendar object. */
  href: string;
  etag?: string;
  raw: string;
}

async function listEventsOne(config: RadicaleConfig, calendar: string): Promise<RemoteEvent[]> {
  const url = calendar.trim().replace(/\/+$/, '');
  const response = await fetch(url, {
    method: 'REPORT',
    headers: {
      Authorization: authHeader(config),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: EVENT_QUERY,
  });

  if (response.status === 401) {
    throw new Error('Radicale rejected those credentials.');
  }
  if (collectionIsGone(response.status)) {
    throw new CollectionGoneError(url, collectionName(url), response.status, 'calendar');
  }
  if (!response.ok && response.status !== 207) {
    throw new Error(`Could not list "${collectionName(url)}" (HTTP ${response.status}).`);
  }

  const doc = parser.parse(await response.text());
  const label = collectionName(url);
  const events: RemoteEvent[] = [];

  for (const entry of asArray(doc?.multistatus?.response)) {
    const href = typeof entry?.href === 'string' ? entry.href : '';
    if (!href) {
      continue;
    }
    for (const propstat of asArray(entry.propstat)) {
      const status = String(propstat?.status ?? '');
      if (status && !status.includes('200')) {
        continue;
      }
      const raw = propstat?.prop?.['calendar-data'];
      if (typeof raw !== 'string' || !raw.includes('BEGIN:VEVENT')) {
        continue;
      }
      const etag = propstat?.prop?.getetag;
      for (const event of parseVEvents(raw)) {
        events.push({
          ...event,
          calendarLabel: label,
          calendarUrl: url,
          href: resolveHref(config.serverUrl || url, href),
          etag: typeof etag === 'string' ? etag : undefined,
          raw,
        });
      }
    }
  }
  return events;
}

/** Every event across every watched calendar. */
export async function listEvents(config: RadicaleConfig): Promise<ListResult<RemoteEvent>> {
  await ensureInternet();
  const settled = await Promise.allSettled(
    config.calendarUrls.map(url => listEventsOne(config, url)),
  );
  const {items, missing} = collect(settled);
  return {items: items.sort((a, b) => a.startAt - b.startAt), missing};
}

async function putCalendarObject(
  config: RadicaleConfig,
  task: RemoteTask,
  body: string,
): Promise<void> {
  await ensureInternet();

  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8',
    Authorization: authHeader(config),
  };
  // Conditional write: if the object changed elsewhere since we listed it, fail
  // loudly with 412 rather than silently overwriting the other change.
  if (task.etag) {
    headers['If-Match'] = task.etag;
  }

  const response = await fetch(task.href, {method: 'PUT', headers, body});

  if (response.status === 412) {
    throw new Error('That task changed on the server. Refresh and try again.');
  }
  if (!response.ok) {
    throw new Error(`Could not update the task (HTTP ${response.status}).`);
  }
}

export async function completeTask(config: RadicaleConfig, task: RemoteTask): Promise<void> {
  await putCalendarObject(config, task, markCompleted(task.raw));
}

export async function editTask(
  config: RadicaleConfig,
  task: RemoteTask,
  edit: TaskEdit,
): Promise<void> {
  await putCalendarObject(config, task, updateVTodo(task.raw, edit));
}

/** Write a brand-new event into a calendar collection. */
export async function createEvent(
  config: RadicaleConfig,
  calendarUrl: string,
  draft: EventDraft,
): Promise<void> {
  await ensureInternet();

  const collection = calendarUrl.trim().replace(/\/+$/, '');
  if (!collection) {
    throw new Error('No calendar selected.');
  }
  const response = await fetch(`${collection}/${encodeURIComponent(draft.uid)}.ics`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      Authorization: authHeader(config),
      'If-None-Match': '*',
    },
    body: buildVEvent(draft),
  });

  if (!response.ok) {
    throw new Error(`Radicale rejected the event (HTTP ${response.status}).`);
  }
}

export async function editEvent(
  config: RadicaleConfig,
  event: RemoteEvent,
  draft: Omit<EventDraft, 'uid'>,
): Promise<void> {
  await ensureInternet();

  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8',
    Authorization: authHeader(config),
  };
  if (event.etag) {
    headers['If-Match'] = event.etag;
  }

  const response = await fetch(event.href, {
    method: 'PUT',
    headers,
    body: updateVEvent(event.raw, draft),
  });

  if (response.status === 412) {
    throw new Error('That event changed on the server. Refresh and try again.');
  }
  if (!response.ok) {
    throw new Error(`Could not update the event (HTTP ${response.status}).`);
  }
}
