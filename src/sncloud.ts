/**
 * Supernote Cloud: the tablet's own built-in To-Do app.
 *
 * This is the one thing in the plugin built on an API nobody published. Ratta
 * document none of it; the endpoints and every quirk below were read out of the
 * Partner app's compiled Dart and confirmed against a live account **for the
 * Task Hub server**, whose `app/connectors/supernote.py` is the original. This
 * module is a transcription of that work, not a rediscovery of it, and where
 * the two disagree the server is right.
 *
 * It exists for somebody who does **not** run the Task Hub server. With the
 * server, Supernote to-dos already reach this plugin as ordinary CalDAV tasks
 * and none of this is needed.
 *
 * What that inheritance buys, in traps avoided:
 *
 * - **`completedTime` is present on tasks that are not complete.** Every task on
 *   the account this was built against carried one while reporting
 *   `status: needsAction`. Reading completion from it would mark everything
 *   done — and, in a two-way sync, push that everywhere. Completion comes from
 *   `status` and nothing else; `completedTime` only dates a completion `status`
 *   has already established.
 * - **Their booleans are the strings `"Y"` and `"N"`.**
 * - **Their vocabulary is not ours.** A list is a "schedule task group", a task
 *   a "schedule task". Translated here so none of it leaks outwards.
 * - **`nextSyncToken` comes back but cannot be replayed.** Sent under the
 *   obvious parameter name it returned everything unchanged, so a delta read
 *   would look like "nothing ever changes". Always read the full set.
 *
 * Pure on purpose: no SDK, no fetch and no hashing, so the mapping and the
 * vocabulary are unit-tested off-device. The requests live in `snclient.ts`.
 */

/** Not cloud.supernote.com, which is the web file manager and has no schedule routes. */
export const SN_BASE_URL = 'https://viewer.supernote.com/api';

export const SN_LIST_GROUPS = '/file/schedule/group/all';
export const SN_LIST_TASKS = '/file/schedule/task/all';
/**
 * One task. The verb decides the operation, and each has a trap of its own.
 *
 * `POST` inserts, and inserts **even when the body carries a taskId** — it
 * answers with a brand new id and leaves the original untouched. So it must
 * never be used as a fallback for an update: that silently duplicates.
 *
 * `PUT` updates, and refuses a body without `lastModified`. Its complaint names
 * the *list* rather than the task, which sends you looking in the wrong place.
 *
 * `DELETE` takes the id in the path. As a body or a query parameter it answers
 * 500.
 */
export const SN_TASK = '/file/schedule/task';

/** Their status vocabulary happens to match Google Tasks exactly. */
const STATUS_FROM_REMOTE: Record<string, boolean> = {
  needsAction: false,
  completed: true,
};

/** One to-do list on the tablet. */
export interface SnList {
  id: string;
  name: string;
}

/** One task, as this plugin wants it. */
export interface SnTask {
  id: string;
  listId: string;
  title: string;
  notes?: string;
  completed: boolean;
  /** Local 'YYYY-MM-DD', or '' when the task has no date. */
  dueDate: string;
  completedAt?: number;
  updatedAt?: number;
}

/** Their booleans are the strings "Y" and "N". */
export function snYes(value: unknown): boolean {
  return String(value ?? '').trim().toUpperCase() === 'Y';
}

/**
 * Epoch milliseconds to a local date, or '' when there is none.
 *
 * Zero is treated as absent rather than as 1970: the API uses it for "no due
 * date", and a task with no date would otherwise be filed under January 1970
 * and sort above everything the user actually has to do.
 */
export function snDate(value: unknown): string {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    return '';
  }
  // Their dates are stored as an instant at midnight UTC, and the tablet shows
  // a date with no time — so the UTC calendar date is the one they mean. Read
  // locally, a user east of Greenwich would see the day before.
  const at = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** The reverse: a local 'YYYY-MM-DD' as midnight UTC, or 0 for "no due date". */
export function snEpoch(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    // 0 rather than null: the API uses it for "no due date", and null is
    // rejected outright on some paths.
    return 0;
  }
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * The notebook page a to-do was written on, when it came from one.
 *
 * A to-do made by circling handwriting keeps a link back to where it was
 * written. Worth carrying: the plugin can offer the same jump back the tablet
 * does, and it is the only part of a cloud task that ties it to a note.
 */
export function snNoteLink(links: unknown): {name: string; page?: number} | null {
  if (!Array.isArray(links)) {
    return null;
  }
  for (const entry of links) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const name = String(row.fileName ?? row.name ?? '').trim();
    if (!name) {
      continue;
    }
    const page = Number(row.pageNo ?? row.page);
    return Number.isFinite(page) && page > 0 ? {name, page} : {name};
  }
  return null;
}

/** One row of `scheduleTask`, as this plugin wants it. Null when unusable. */
export function snTaskFrom(row: unknown): SnTask | null {
  if (typeof row !== 'object' || row === null) {
    return null;
  }
  const r = row as Record<string, unknown>;
  const id = String(r.taskId ?? '').trim();
  if (!id) {
    return null;
  }

  const completed = STATUS_FROM_REMOTE[String(r.status ?? '')] === true;
  let notes = String(r.detail ?? '').trim();
  const source = snNoteLink(r.links);
  if (source) {
    const reference = source.page
      ? `From ${source.name}, page ${source.page}`
      : `From ${source.name}`;
    notes = notes ? `${notes}\n\n${reference}` : reference;
  }

  return {
    id,
    listId: String(r.taskListId ?? '').trim(),
    title: String(r.title ?? '').trim(),
    notes: notes || undefined,
    completed,
    dueDate: snDate(r.dueTime),
    // Only read once `status` has said the task is done. On its own this field
    // is present on tasks that are not.
    completedAt: completed ? Number(r.completedTime) || undefined : undefined,
    updatedAt: Number(r.lastModified) || undefined,
  };
}

/** Every usable task in a `scheduleTask` response. */
export function snTasksFrom(body: unknown): SnTask[] {
  const rows = (body as {scheduleTask?: unknown})?.scheduleTask;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map(snTaskFrom).filter((t): t is SnTask => t !== null);
}

/** Every live list in a `scheduleTaskGroup` response, deleted ones dropped. */
export function snListsFrom(body: unknown): SnList[] {
  const rows = (body as {scheduleTaskGroup?: unknown})?.scheduleTaskGroup;
  if (!Array.isArray(rows)) {
    return [];
  }
  const lists: SnList[] = [];
  for (const entry of rows) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (snYes(row.isDeleted)) {
      continue;
    }
    const id = String(row.taskListId ?? '').trim();
    if (!id) {
      continue;
    }
    lists.push({id, name: String(row.title ?? '').trim() || 'Untitled list'});
  }
  return lists;
}

/**
 * The fields this plugin is allowed to set on a task.
 *
 * Deliberately not a whole task: an update sends the row the server already
 * holds with these laid over the top, so the sort orders, reminder flags and
 * recurrence blocks Supernote maintains for itself come back untouched rather
 * than blanked by omission.
 */
export function snFieldsFrom(task: {
  title: string;
  notes?: string;
  dueDate: string;
  completed: boolean;
  completedAt?: number;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    title: task.title ?? '',
    detail: task.notes || null,
    dueTime: snEpoch(task.dueDate),
    status: task.completed ? 'completed' : 'needsAction',
  };
  if (task.completed) {
    fields.completedTime = task.completedAt ?? Date.now();
  }
  return fields;
}

/**
 * When the session runs out, read from inside the token.
 *
 * The session is a JWT valid for thirty days with **no renewal endpoint of any
 * kind** — `/user/info`, `/quickLogin` and a `login/new2` were all tried
 * against the live account and none exist. So it cannot be refreshed in the
 * background: it expires and a person has to sign in again with a code emailed
 * to them. The expiry being legible here is what lets the plugin warn before
 * the day arrives rather than after.
 */
export function snTokenExpiry(token: string): number | null {
  const parts = (token ?? '').split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(decodeBase64(payload)) as {exp?: unknown};
    const exp = Number(claims?.exp);
    if (!Number.isFinite(exp) || exp <= 0) {
      return null;
    }
    // Seconds or milliseconds; both appear in this API depending on the field.
    return exp > 1e11 ? exp : exp * 1000;
  } catch {
    return null;
  }
}

/**
 * Base64 without `atob`, which Hermes does not provide.
 *
 * Same lesson as `new URL`: reaching for a browser global here passes every
 * test under Node and fails on the device. Decoded by hand so it cannot.
 */
/* eslint-disable no-bitwise -- base64 decoding is inherently bitwise */
function decodeBase64(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      continue;
    }
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  // JWT payloads are UTF-8; decodeURIComponent turns the bytes back into it so
  // an account name with an accent in it does not come back mangled.
  try {
    return decodeURIComponent(
      out
        .split('')
        .map(c => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    );
  } catch {
    return out;
  }
}
/* eslint-enable no-bitwise */

/** Days until the session expires, or null when that cannot be read. */
export function snDaysLeft(token: string, now: number = Date.now()): number | null {
  const expiry = snTokenExpiry(token);
  if (expiry === null) {
    return null;
  }
  return Math.floor((expiry - now) / 86400000);
}

/* ------------------------------------------------------------------ *
 * What the settings hold
 * ------------------------------------------------------------------ */

/**
 * The saved Supernote Cloud connection.
 *
 * **Off by default.** This talks to an API nobody published, against the user's
 * real Supernote account, and nothing should reach for that unasked.
 *
 * The **token is stored, never the password**. Sign-in exchanges the password
 * for a thirty-day session and the password is not needed again, so it is not
 * kept — which matters more here than elsewhere, because `settings.json` is
 * plain text on shared storage and a plugin has no keystore. A leaked token
 * expires; a leaked password does not.
 */
export interface SnConfig {
  enabled: boolean;
  /** Only to show whose account it is, and to sign in again when it expires. */
  email: string;
  /** The thirty-day session. Empty means "not signed in". */
  token: string;
  /**
   * Which of the account's to-do lists to show.
   *
   * The name is stored beside the id, as a subscription's is, so a list can be
   * labelled before anything has been fetched — the settings screen, the task
   * rows and the "save to" picker all need a name, and only one of them is in a
   * position to go and ask for it.
   */
  lists: SnList[];
}

export const DEFAULT_SN_CONFIG: SnConfig = {
  enabled: false,
  email: '',
  token: '',
  lists: [],
};

/** Signed in and switched on, so it is worth making a request. */
export function snReady(config: SnConfig | undefined): boolean {
  return Boolean(config?.enabled && config.token && config.lists.length > 0);
}
