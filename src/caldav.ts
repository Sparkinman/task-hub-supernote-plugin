import {base64, buildVTodo, type TaskDraft} from './ical';
import {parseCollections, userHomeUrl, type TaskCollection} from './discovery';
import {ensureInternet} from './permissions';
import {collectionsOwner, type RadicaleConfig} from './settings';

export {newUid} from './ical';
import {newUid, parseSteps} from './ical';
export type {TaskDraft} from './ical';

/**
 * CalDAV writes and collection discovery for Radicale.
 *
 * Creating a task is a plain HTTP PUT of a single-VTODO calendar object to
 * <collection>/<uid>.ics — no MKCALENDAR involved, so the collection must
 * already exist.
 */

export function authHeader(config: RadicaleConfig): string {
  return 'Basic ' + base64(`${config.username}:${config.password}`);
}

const DISCOVERY_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<prop><displayname/><resourcetype/><C:supported-calendar-component-set/></prop>' +
  '</propfind>';

/** Enumerate the user's VTODO-capable collections. */
export async function discoverCollections(
  config: RadicaleConfig,
): Promise<TaskCollection[]> {
  await ensureInternet();

  const home = userHomeUrl(config.serverUrl, collectionsOwner(config));
  const response = await fetch(home, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(config),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: DISCOVERY_BODY,
  });

  if (response.status === 401) {
    throw new Error('Radicale rejected those credentials.');
  }
  if (!response.ok && response.status !== 207) {
    throw new Error(`Could not reach ${home} (HTTP ${response.status}).`);
  }

  const collections = parseCollections(config.serverUrl, await response.text());
  if (collections.length === 0) {
    throw new Error(
      'No task lists found. Radicale only auto-detects collections directly under /username/.',
    );
  }
  return collections;
}

/** Writes into `collectionUrl`, or the configured default when omitted. */
export async function putTask(
  config: RadicaleConfig,
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
  config: RadicaleConfig,
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
    throw new Error(`Radicale rejected the task (HTTP ${response.status}).`);
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
  config: RadicaleConfig,
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
  // step is its own PUT to Radicale, and doing them in series is a round trip
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
        // character Radicale disliked would be a poor trade.
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

