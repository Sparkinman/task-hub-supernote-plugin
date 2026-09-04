import {base64, buildVTodo, type TaskDraft} from './ical';
import {parseCollections, userHomeUrl, type TaskCollection} from './discovery';
import {ensureInternet} from './permissions';
import {collectionsOwner, type RadicaleConfig} from './settings';

export {newUid} from './ical';
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
