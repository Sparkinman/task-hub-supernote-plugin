import {base64, buildVTodo, type TaskDraft} from './ical';
import {
  parseCollections,
  parseHrefProp,
  principalCandidates,
  userHomeUrl,
  type TaskCollection,
} from './discovery';
import {ensureInternet} from './permissions';
import {collectionsOwner, type ServerConfig} from './settings';

export {newUid} from './ical';
import {newUid, parseSteps} from './ical';
export type {TaskDraft} from './ical';

/**
 * CalDAV writes and collection discovery.
 *
 * Creating a task is a plain HTTP PUT of a single-VTODO calendar object to
 * <collection>/<uid>.ics — no MKCALENDAR involved, so the collection must
 * already exist.
 */

export function authHeader(config: ServerConfig): string {
  return 'Basic ' + base64(`${config.username}:${config.password}`);
}

const DISCOVERY_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<prop><displayname/><resourcetype/><C:supported-calendar-component-set/></prop>' +
  '</propfind>';

const PRINCIPAL_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>';

const HOME_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<prop><C:calendar-home-set/></prop></propfind>';

/** Thrown when the server refuses the credentials, so callers can say so plainly. */
export class AuthError extends Error {
  constructor() {
    super('The server rejected those credentials.');
    this.name = 'AuthError';
  }
}

async function propfind(
  url: string,
  config: ServerConfig,
  depth: '0' | '1',
  body: string,
): Promise<string | null> {
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(config),
      Depth: depth,
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body,
  });

  if (response.status === 401) {
    throw new AuthError();
  }
  // 207 Multi-Status is the success case; anything else means "not here",
  // which during the well-known walk is a reason to try the next candidate
  // rather than to fail outright.
  if (!response.ok && response.status !== 207) {
    return null;
  }
  return response.text();
}

/**
 * Find the collection home, preferring the standard walk over a path guess.
 *
 * An explicitly configured `owner` short-circuits this: it exists precisely
 * because the collections wanted are not the login's own, and the well-known
 * walk can only ever report where the *login's* calendars live.
 */
export async function resolveHome(config: ServerConfig): Promise<string> {
  const fallback = userHomeUrl(config.serverUrl, collectionsOwner(config));
  if (config.owner.trim()) {
    return fallback;
  }

  for (const candidate of principalCandidates(config.serverUrl)) {
    const principalXml = await propfind(candidate, config, '0', PRINCIPAL_BODY);
    if (!principalXml) {
      continue;
    }
    const principal = parseHrefProp(config.serverUrl, principalXml, 'current-user-principal');
    if (!principal) {
      continue;
    }

    const homeXml = await propfind(principal, config, '0', HOME_BODY);
    if (!homeXml) {
      continue;
    }
    const home = parseHrefProp(config.serverUrl, homeXml, 'calendar-home-set');
    if (home) {
      // A home is a collection; a trailing slash keeps relative joins honest.
      return home.endsWith('/') ? home : `${home}/`;
    }
  }

  return fallback;
}

/** Enumerate the user's VTODO-capable collections. */
export async function discoverCollections(
  config: ServerConfig,
): Promise<TaskCollection[]> {
  await ensureInternet();

  const home = await resolveHome(config);
  const xml = await propfind(home, config, '1', DISCOVERY_BODY);
  if (xml === null) {
    throw new Error(`Could not reach ${home}.`);
  }

  const collections = parseCollections(config.serverUrl, xml);
  if (collections.length === 0) {
    throw new Error(
      'No task lists found. If the server keeps them somewhere unusual, paste a collection URL instead.',
    );
  }
  return collections;
}

/** Writes into `collectionUrl`, or the configured default when omitted. */
export async function putTask(
  config: ServerConfig,
  task: TaskDraft,
  collectionUrl?: string,
): Promise<void> {
  await ensureInternet();
  await writeTask(config, task, collectionUrl);
}

/**
 * The write itself, without the permission check.
 *
 * Split out so a batch can check once instead of once per task. `ensureInternet`
 * is a round trip across the native bridge every time it is called, and writing
 * a task with five steps was making six of them for one save — the checks cost
 * more than the six HTTP requests they were guarding.
 *
 * Not exported: every caller must have checked, and keeping the guarded
 * `putTask` as the only public entry point is what makes that hard to forget.
 */
async function writeTask(
  config: ServerConfig,
  task: TaskDraft,
  collectionUrl?: string,
): Promise<void> {
  const collection = (collectionUrl ?? config.defaultCollectionUrl).trim().replace(/\/+$/, '');
  if (!collection) {
    throw new Error('No task list selected.');
  }
  const url = `${collection}/${encodeURIComponent(task.uid)}.ics`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      Authorization: authHeader(config),
      // Refuse to clobber an existing object with the same UID.
      'If-None-Match': '*',
    },
    body: buildVTodo(task),
  });

  if (!response.ok) {
    throw new Error(`The server rejected the task (HTTP ${response.status}).`);
  }
}

/**
 * Create one step per non-empty line, hung off `parentUid`.
 *
 * Deliberately the same contract as the Task Hub web page's own steps box: it
 * only ever ADDS. Nothing here renames or removes an existing step, and the box
 * is never pre-filled with the steps a task already has — which is what makes it
 * safe on a form somebody may save several times. Saving without typing in it
 * adds nothing at all.
 *
 * A leading "-" or "*" is stripped, so a list pasted or written as bullets does
 * not arrive with the bullet as part of the title.
 *
 * Each failure is counted rather than aborting the rest: losing four steps
 * because the third had a character Radicale disliked would be a poor trade for
 * somebody who typed all five.
 */
export async function addSteps(
  config: ServerConfig,
  parentUid: string,
  text: string,
  collectionUrl?: string,
  /** Due date applied to every step that does not name one of its own. */
  dueDate?: string,
  /** Time of day for those steps. Ignored when there is no date. */
  dueTime?: string,
): Promise<{made: number; failed: number}> {
  const steps = parseSteps(text);
  if (steps.length === 0) {
    return {made: 0, failed: 0};
  }

  // One permission check for the whole batch, then the writes together. Each
  // step is its own PUT to the server, and doing them in series is a round trip
  // per step that the user waits through.
  await ensureInternet();
  const results = await Promise.all(
    steps.map(async step => {
      try {
        await writeTask(
          config,
          {
            uid: newUid(),
            summary: step.summary.slice(0, 500),
            parentUid,
            // The step's own date if one was written on the line, otherwise the
            // date given for the batch — the parent task's, or one chosen for
            // the steps specifically.
            dueDate: step.dueDate ?? dueDate,
            // The batch time only applies to the batch date: a step that named
            // its own day did not name a time with it.
            dueTime: step.dueDate ? undefined : dueTime,
          },
          collectionUrl,
        );
        return true;
      } catch {
        // Counted rather than thrown: losing four steps because the third had a
        // character the server disliked would be a poor trade.
        return false;
      }
    }),
  );

  const made = results.filter(Boolean).length;
  return {made, failed: results.length - made};
}


/** What to append to a save confirmation about the steps that were added. */
export function saidAboutSteps(made: number, failed: number): string {
  if (failed) {
    return ` ${made} sub task${made === 1 ? '' : 's'} added, but ${failed} could not be saved.`;
  }
  if (made) {
    return ` With ${made} sub task${made === 1 ? '' : 's'}.`;
  }
  return '';
}

