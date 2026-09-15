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
import {AuthError, authHeader} from './caldav';
import {resolveHref} from './discovery';
import {ensureInternet} from './permissions';
import {caldavStamp, type DateRange} from './eventwindow';
import {collectionName, type ServerConfig} from './settings';
import {listFeedEvents} from './feedfetch';
import {isSnTask, snIdOf} from './sntasks';
import {DEMO} from './demoflag';
import {demoEvents, demoTasks} from './demodata';
import {updateSnTask} from './snclient';

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
  /** Names of `.ics` subscriptions that answered with nothing usable. */
  feedsFailed?: string[];
  /** The name each feed announced for itself, by URL. See `X-WR-CALNAME`. */
  feedNames?: Record<string, string>;
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
  // Says what the button below it does, rather than sending the user to
  // Settings. The old wording told them to tap Discover and untick it, which
  // could not be done: the ticklists there are built from what discovery finds,
  // and a collection deleted on the server is not among them.
  const fix = one ? 'stop watching it' : 'stop watching them';
  return (
    `${lead}${why} Everything else refreshed normally. ` +
    `Remove will ${fix}; you can add ${one ? 'it' : 'them'} again from Settings if ${one ? 'it comes' : 'they come'} back.`
  );
}

/**
 * Events within a date range.
 *
 * The unfiltered form of this — every VEVENT in the collection, for all time —
 * was the largest single cost in opening the plugin: transferred in full iCal
 * and then parsed in JavaScript on an e-ink CPU, on every opening, for a set
 * that only ever grows. See `eventwindow.ts` for how the range is chosen and
 * widened.
 *
 * A time-range filter is expanded by the server, per RFC 4791 -- a weekly
 * meeting whose DTSTART is two years old still matches a window it recurs into,
 * so repeating events are not lost by narrowing the range.
 */
function eventQuery(range: DateRange): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    '<D:prop><D:getetag/><C:calendar-data/></D:prop>' +
    '<C:filter><C:comp-filter name="VCALENDAR">' +
    '<C:comp-filter name="VEVENT">' +
    `<C:time-range start="${caldavStamp(range.start)}" end="${caldavStamp(range.end)}"/>` +
    '</C:comp-filter>' +
    '</C:comp-filter></C:filter>' +
    '</C:calendar-query>'
  );
}

/** Every VEVENT, used only when a server rejects the filtered form above. */
const ALL_EVENT_QUERY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<D:prop><D:getetag/><C:calendar-data/></D:prop>' +
  '<C:filter><C:comp-filter name="VCALENDAR">' +
  '<C:comp-filter name="VEVENT"/>' +
  '</C:comp-filter></C:filter>' +
  '</C:calendar-query>';

/**
 * Every VTODO, used only as a fallback.
 *
 * See OPEN_TASK_QUERY for why the filtered form is tried first.
 */
const ALL_TASK_QUERY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<D:prop><D:getetag/><C:calendar-data/></D:prop>' +
  '<C:filter><C:comp-filter name="VCALENDAR">' +
  '<C:comp-filter name="VTODO"/>' +
  '</C:comp-filter></C:filter>' +
  '</C:calendar-query>';

/**
 * Open tasks only — completed ones are deliberately never downloaded.
 *
 * Pulling every VTODO ever written, in full, on every opening was a large part
 * of the wait before the task list appeared: it is transferred over the network
 * and then parsed in JS on an e-ink CPU, only for each completed task to be
 * added to the list and immediately filtered back out of it. The set grows for
 * as long as the user keeps using the plugin, so it got slower over time.
 *
 * Only `COMPLETED is-not-defined` is asked for, not a negated text-match on
 * STATUS. `is-not-defined` has one unambiguous meaning; a negated text-match
 * against a property that is absent altogether does not, and servers disagree
 * about it — a task with no STATUS line at all, which is most of them, could be
 * dropped by a server that reads it the other way. Under-filtering here is
 * harmless because the client filters again; over-filtering would hide open
 * tasks.
 *
 * The client-side filter therefore stays, and is not redundant: Task Hub counts
 * three separate signals as completed (STATUS, a COMPLETED stamp, or
 * PERCENT-COMPLETE) and this filter can only catch the second.
 */
const OPEN_TASK_QUERY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<D:prop><D:getetag/><C:calendar-data/></D:prop>' +
  '<C:filter><C:comp-filter name="VCALENDAR">' +
  '<C:comp-filter name="VTODO">' +
  '<C:prop-filter name="COMPLETED"><C:is-not-defined/></C:prop-filter>' +
  '</C:comp-filter>' +
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

/**
 * How many calendar objects are parsed before handing the thread back.
 *
 * Parsing iCal is synchronous, and a collection of any size holds the JavaScript
 * thread for the whole of it — which is what made an opening feel like a freeze
 * rather than a wait: the panel had already drawn, but taps went nowhere until
 * the last object was done. Yielding to the event loop lets queued touches run
 * in between. 40 is small enough to keep the gaps short and large enough that
 * the yields themselves cost nothing measurable.
 */
const PARSE_CHUNK = 40;

/**
 * Hand the thread back so queued work — a tap, a render — can run.
 *
 * setTimeout rather than an awaited promise: a resolved promise is a microtask
 * and runs before the event loop gets a turn, so it would yield to nothing.
 */
function breathe(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** One REPORT against a collection. */
function report(config: ServerConfig, url: string, body: string): Promise<Response> {
  return fetch(url, {
    method: 'REPORT',
    headers: {
      Authorization: authHeader(config),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body,
  });
}

async function listOne(config: ServerConfig, collection: string): Promise<RemoteTask[]> {
  const url = collection.trim().replace(/\/+$/, '');
  let response = await report(config, url, OPEN_TASK_QUERY);

  // Checked before the retry below: neither is a complaint about the filter,
  // and asking again unfiltered would only produce the same answer more slowly
  // — or, for a bad password, a second permission-shaped failure to explain.
  if (response.status === 401) {
    throw new AuthError();
  }
  if (collectionIsGone(response.status)) {
    throw new CollectionGoneError(url, collectionName(url), response.status, 'task');
  }

  // A server that will not accept the prop-filter rejects the whole REPORT, and
  // an unhandled rejection here would empty the task list rather than slow it
  // down. One unfiltered retry costs a round trip on servers that need it and
  // nothing at all on servers that do not.
  if (!response.ok && response.status !== 207) {
    response = await report(config, url, ALL_TASK_QUERY);
  }

  if (response.status === 401) {
    throw new AuthError();
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

  let since = 0;
  for (const entry of asArray(doc?.multistatus?.response)) {
    if (++since >= PARSE_CHUNK) {
      since = 0;
      await breathe();
    }
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
export async function listTasks(config: ServerConfig): Promise<ListResult<RemoteTask>> {
  if (DEMO) {
    return {items: demoTasks(), missing: []};
  }
  await ensureInternet();

  const settled = await Promise.allSettled(
    config.collectionUrls.map(url => listOne(config, url)),
  );
  return collect(settled);
}

export interface RemoteEvent extends VEvent {
  calendarLabel: string;
  calendarUrl: string;
  /** Absolute URL of this event's calendar object. Empty for a feed event. */
  href: string;
  etag?: string;
  raw: string;
  /**
   * Came from an `.ics` subscription and cannot be written back.
   *
   * Stated rather than inferred from an empty href: the UI has to disable
   * editing everywhere an event can be tapped, and a rule that reads
   * `readOnly` is one somebody can follow. Meeting notes are still offered —
   * that link lives in the device's own settings and never touches the server.
   */
  readOnly?: boolean;
}

async function listEventsOne(
  config: ServerConfig,
  calendar: string,
  range: DateRange,
): Promise<RemoteEvent[]> {
  const url = calendar.trim().replace(/\/+$/, '');
  let response = await report(config, url, eventQuery(range));

  // Checked before the retry below, exactly as the task listing does: neither
  // is a complaint about the filter, and asking again unfiltered would only
  // produce the same failure more slowly.
  if (response.status === 401) {
    throw new AuthError();
  }
  if (collectionIsGone(response.status)) {
    throw new CollectionGoneError(url, collectionName(url), response.status, 'calendar');
  }

  // A server that will not accept a time-range rejects the whole REPORT. One
  // unfiltered retry costs a round trip on such a server and nothing at all on
  // one that handles the filter — and an empty calendar would be a worse
  // outcome than a slow one.
  if (!response.ok && response.status !== 207) {
    response = await report(config, url, ALL_EVENT_QUERY);
  }

  if (!response.ok && response.status !== 207) {
    throw new Error(`Could not list "${collectionName(url)}" (HTTP ${response.status}).`);
  }

  const doc = parser.parse(await response.text());
  const label = collectionName(url);
  const events: RemoteEvent[] = [];

  let since = 0;
  for (const entry of asArray(doc?.multistatus?.response)) {
    if (++since >= PARSE_CHUNK) {
      since = 0;
      await breathe();
    }
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

/** Every event across every watched calendar, within `range`. */
export async function listEvents(
  config: ServerConfig,
  range: DateRange,
): Promise<ListResult<RemoteEvent>> {
  // The demo build invents its calendar and asks the network for nothing, so it
  // never prompts for permission and never fails in front of an audience.
  if (DEMO) {
    return {items: demoEvents().sort((a, b) => a.startAt - b.startAt), missing: []};
  }
  await ensureInternet();
  const settled = await Promise.allSettled(
    config.calendarUrls.map(url => listEventsOne(config, url, range)),
  );
  const {items, missing} = collect(settled);
  return {items: items.sort((a, b) => a.startAt - b.startAt), missing};
}

/**
 * Subscriptions only, fetched separately from the CalDAV collections.
 *
 * Deliberately not folded into `listEvents`. A feed is a whole file where a
 * collection is a windowed query, so it is much the slower half — and awaiting
 * it before anything reached the screen meant a device with both sat on its
 * cached events until the slowest calendar in the list answered. Fetched on its
 * own, the collections draw as soon as they land and the subscriptions join
 * them a moment later.
 */
export async function listFeeds(
  config: ServerConfig,
  range: DateRange,
): Promise<ListResult<RemoteEvent>> {
  const feeds = await listFeedEvents(config.feeds ?? [], range);
  return {
    items: feeds.events.sort((a, b) => a.startAt - b.startAt),
    missing: [],
    feedsFailed: feeds.failed,
    feedNames: feeds.names,
  };
}

async function putCalendarObject(
  config: ServerConfig,
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

/**
 * Mark a task complete, wherever it lives.
 *
 * Routed here rather than at every call site: the Tasks tab, the day view, the
 * week view and the month panel all complete tasks, and each of them deciding
 * for itself which service a task belongs to is four chances to get it wrong.
 * A task knows where it came from; this asks it.
 */
export async function completeTask(config: ServerConfig, task: RemoteTask): Promise<void> {
  if (isSnTask(task)) {
    await updateSnTask(config.supernote.token, snIdOf(task), {
      title: task.summary,
      notes: task.description,
      dueDate: task.dueDate ?? '',
      completed: true,
      completedAt: Date.now(),
    });
    return;
  }
  await putCalendarObject(config, task, markCompleted(task.raw));
}

export async function editTask(
  config: ServerConfig,
  task: RemoteTask,
  edit: TaskEdit,
): Promise<void> {
  if (isSnTask(task)) {
    // The tablet's To-Do app shows a title and a date and nothing else, so
    // priority and repeat rules have nowhere to go. They are not silently
    // dropped — the editor hides them for a Supernote task rather than
    // offering a control that would do nothing.
    await updateSnTask(config.supernote.token, snIdOf(task), {
      title: edit.summary,
      notes: edit.description,
      dueDate: edit.dueDate ?? '',
      completed: task.completed,
      completedAt: task.completed ? Date.now() : undefined,
    });
    return;
  }
  await putCalendarObject(config, task, updateVTodo(task.raw, edit));
}

/** Write a brand-new event into a calendar collection. */
export async function createEvent(
  config: ServerConfig,
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
    throw new Error(`The server rejected the event (HTTP ${response.status}).`);
  }
}

export async function editEvent(
  config: ServerConfig,
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
