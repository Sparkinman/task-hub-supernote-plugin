import {snEpoch, type SnList, type SnTask} from './sncloud';
import type {RemoteTask} from './tasks';

/**
 * Supernote Cloud tasks, wearing the shape the rest of the plugin already
 * understands.
 *
 * The Tasks tab, the day view, the buckets, the sorting and the search all work
 * on `RemoteTask`. Rather than teach every one of them about a second kind of
 * task, a cloud task is converted into that shape on the way in and recognised
 * again on the way out. Nothing downstream needs to change.
 *
 * Recognition is by `collectionUrl`, which carries a `supernote:` scheme no
 * CalDAV collection can have. That is also what makes it safe: a URL is what
 * every write path already keys on, so a task that came from the cloud cannot
 * accidentally be PUT at a CalDAV address.
 */

/** The scheme that marks a collection as living in Supernote Cloud, not CalDAV. */
export const SN_SCHEME = 'supernote:';

export function snCollectionUrl(listId: string): string {
  return `${SN_SCHEME}${listId}`;
}

/** Whether this collection — or task — came from Supernote Cloud. */
export function isSnCollection(url: string): boolean {
  return (url ?? '').startsWith(SN_SCHEME);
}

export function isSnTask(task: {collectionUrl: string}): boolean {
  return isSnCollection(task.collectionUrl);
}

/** The list id inside a Supernote collection URL. */
export function snListId(url: string): string {
  return isSnCollection(url) ? url.slice(SN_SCHEME.length) : '';
}

/**
 * One cloud task as a `RemoteTask`.
 *
 * `href` and `raw` are empty and must stay that way. A CalDAV write is a PUT to
 * `href` against `raw`; leaving either populated with something plausible would
 * let a cloud task fall into that path and be written to the wrong place
 * entirely. Empty is the signal that it has no CalDAV identity, and
 * `collectionUrl` is what says where it really lives.
 */
export function asRemoteTask(task: SnTask, listName: string): RemoteTask {
  return {
    // Prefixed so it cannot collide with a CalDAV UID, and stable across
    // refreshes because it is the server's own id.
    uid: `supernote-${task.id}`,
    summary: task.title,
    description: task.notes,
    dueDate: task.dueDate || undefined,
    dueAt: task.dueDate ? snEpoch(task.dueDate) : null,
    status: task.completed ? 'COMPLETED' : 'NEEDS-ACTION',
    completed: task.completed,
    // Task Hub's own badge vocabulary already has a word for this.
    origin: 'supernote',
    originName: 'Supernote',
    href: '',
    raw: '',
    collectionUrl: snCollectionUrl(task.listId),
    collectionLabel: listName,
  };
}

/** Every watched cloud task, labelled by the list it belongs to. */
export function asRemoteTasks(
  tasks: SnTask[],
  lists: SnList[],
  watched: SnList[],
): RemoteTask[] {
  // The live names win over the stored ones: a list renamed on the tablet
  // should read by its new name here without anybody re-ticking it.
  const names = new Map(watched.map(l => [l.id, l.name]));
  for (const list of lists) {
    names.set(list.id, list.name);
  }
  const wanted = new Set(watched.map(l => l.id));
  return tasks
    .filter(task => wanted.has(task.listId))
    .map(task => asRemoteTask(task, names.get(task.listId) ?? 'Supernote'));
}

/** The id a `RemoteTask` carries back to the cloud, or '' if it is not one. */
export function snIdOf(task: {uid: string; collectionUrl: string}): string {
  if (!isSnTask(task)) {
    return '';
  }
  return task.uid.startsWith('supernote-') ? task.uid.slice('supernote-'.length) : '';
}
