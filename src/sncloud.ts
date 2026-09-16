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
 * How many task rows `SN_LIST_TASKS` will return, ever.
 *
 * **The endpoint is capped at twenty rows and takes no arguments.** It answers
 * with `nextPageToken` beside them when more exist, which reads like ordinary
 * pagination — but the request body is ignored outright: filtering by
 * `taskListId`, by `status`, or sending a deliberate nonsense key all return
 * the identical twenty rows, and so does every spelling of a page parameter in
 * the body, in the query string and in a header. Twenty-seven were tried.
 *
 * Proved on a live account: with 21 to-dos the newest was absent and
 * `nextPageToken` was `'2'`; after deleting the completed ones the account
 * returned 6 rows, `nextPageToken` was null, and the missing to-do appeared.
 * It had been on page two all along.
 *
 * So the second page cannot be asked for by any means found, and the only
 * honest thing left is to notice the cap and say so. `snTruncated` is what does
 * that. Do not replace this with a page walk unless a route is actually found —
 * a loop that re-requests a body-ignoring endpoint just fetches page one twice.
 *
 * The Task Hub server's connector has the same cap and does not yet know it.
 * See `app/connectors/supernote.py`.
 */
export const SN_PAGE_SIZE = 20;

/**
 * Whether the account holds more to-dos than this answer contains.
 *
 * True when `nextPageToken` is set, which is the server saying there is a page
 * two — a page nothing here can reach. It is the difference between "you have
 * six to-dos" and "you have six of your to-dos", and a user staring at a to-do
 * on their tablet that this plugin does not list deserves to be told which.
 */
export function snTruncated(body: unknown): boolean {
  const token = (body as {nextPageToken?: unknown})?.nextPageToken;
  const text = String(token ?? '').trim();
  return text !== '' && text !== 'null' && text !== 'undefined';
}
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

/**
 * Stand-in list for to-dos that belong to no list at all — what the tablet's
 * own To-Do app calls the **Inbox**.
 *
 * A task can arrive carrying `taskListId: null`, or naming a list that has
 * since been deleted. Either way it sits in the To-Do app's "All" view and in
 * none of its lists, so filtering tasks by list — the obvious implementation,
 * and the one this plugin shipped — drops it without a word. Rather than guess
 * a list for it, which would file it somewhere the user never chose, it is
 * offered as a list of its own that they can tick or ignore knowingly.
 *
 * The name is the tablet's, deliberately. The Task Hub server called it
 * "Unfiled tasks" first, which was accurate and unrecognisable: somebody
 * looking for the list they see on the device would not know it was the same
 * one. See `app/connectors/supernote.py`, which is the original of this.
 *
 * The id cannot collide with a real one: theirs are 32-character hex strings,
 * or the literal "1" for the default list.
 */
export const SN_UNFILED_ID = '__unfiled__';
export const SN_UNFILED_NAME = 'Inbox';

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
function iso(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/**
 * The instant Supernote stores, read back as the date it stands for.
 *
 * **A to-do carries a date and no time**, but the API transports it as an
 * instant, so something has to decide which calendar day that instant means —
 * and the two obvious answers disagree by a day for most of the world.
 *
 * Whichever reading lands on an exact midnight is the one that was meant. A
 * writer that thought in local time produced local midnight; one that thought
 * in UTC produced UTC midnight. Checking rather than assuming means a to-do
 * made on the tablet and one made here are both read correctly, without
 * knowing which produced it.
 *
 * Local is preferred when both are midnight, which happens only in UTC itself,
 * where they are the same date anyway.
 */
export function snDate(value: unknown): string {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    return '';
  }
  const at = new Date(ms);
  if (at.getUTCHours() === 0 && at.getUTCMinutes() === 0) {
    return iso(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  }
  return iso(at.getFullYear(), at.getMonth(), at.getDate());
}

/**
 * The reverse: a date as the instant the tablet will read it back as.
 *
 * **Midnight local, not midnight UTC.** Reported on device: a to-do created
 * here for tomorrow showed as today in the tablet's own To-Do app. Midnight UTC
 * falls on the previous day everywhere west of Greenwich, and the To-Do app
 * renders the instant in the device's own timezone — so the date the user chose
 * and the date they saw were a day apart.
 *
 * Worth knowing why no test caught it: the machine this is built on runs in
 * UTC, where the two are identical. The same shape as `new URL` — correct
 * everywhere it was checked, wrong everywhere it ran. `__tests__/sndates.test.ts`
 * therefore pins this under a non-UTC zone deliberately.
 */
export function snEpoch(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!match) {
    // 0 rather than null: the API uses it for "no due date", and null is
    // rejected outright on some paths.
    return 0;
  }
  const at = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    0,
    0,
    0,
    0,
  );
  const ms = at.getTime();
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
  // A to-do deleted on the tablet still comes back in `scheduleTask`, flagged
  // rather than absent. `snListsFrom` has always dropped deleted *lists*; this
  // is the same rule for tasks, which was missing — without it a to-do deleted
  // on the device stays on screen here indefinitely.
  if (snYes(r.isDeleted)) {
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
  return snTaskRead(body).tasks;
}

/**
 * The same, with a count of what was thrown away on the way through.
 *
 * Kept separate from the tasks themselves because it answers a different
 * question: "is this to-do not on my screen because the plugin filed it
 * somewhere unexpected, or because it never arrived at all?" Without the raw
 * row count those two look identical, and telling them apart has already cost
 * several installs.
 */
export function snTaskRead(body: unknown): {
  tasks: SnTask[];
  rows: number;
  dropped: number;
} {
  const rows = (body as {scheduleTask?: unknown})?.scheduleTask;
  if (!Array.isArray(rows)) {
    return {tasks: [], rows: 0, dropped: 0};
  }
  const tasks = rows.map(snTaskFrom).filter((t): t is SnTask => t !== null);
  return {tasks, rows: rows.length, dropped: rows.length - tasks.length};
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
 * Whether this task belongs to a list that still exists.
 *
 * It can fail two ways — no list id at all, or one naming a list that has since
 * been deleted. Both leave it invisible to a per-list read, so both are treated
 * the same and both belong in the Inbox.
 */
export function snFiledUnder(task: SnTask, liveIds: Set<string>): boolean {
  return task.listId !== '' && liveIds.has(task.listId);
}

/**
 * How many to-dos belong to no list, split by whether they are still open.
 *
 * Both halves are needed, and the completed half is the interesting one. The
 * Inbox is offered only for *open* unfiled to-dos, so an account whose only
 * unfiled to-do is completed sees no Inbox — which is correct, and completely
 * baffling to somebody looking straight at that to-do in the tablet's own
 * Inbox. Counting them separately is what lets Settings say so instead of
 * silently leaving the row out.
 */
export function snUnfiledCounts(
  lists: SnList[],
  tasks: SnTask[],
): {open: number; completed: number} {
  const live = new Set(lists.map(l => l.id));
  let open = 0;
  let completed = 0;
  for (const task of tasks) {
    if (snFiledUnder(task, live)) {
      continue;
    }
    if (task.completed) {
      completed += 1;
    } else {
      open += 1;
    }
  }
  return {open, completed};
}

/**
 * The lists to offer for ticking, with the Inbox appended when anything is
 * actually in it.
 *
 * Only offered when it holds an open to-do, so an account with every to-do
 * properly filed never sees a puzzling empty list it has to reason about, and
 * one whose unfiled to-dos are all completed is never offered a list that turns
 * out empty the moment it is ticked.
 */
export function snListsWithUnfiled(lists: SnList[], tasks: SnTask[]): SnList[] {
  if (snUnfiledCounts(lists, tasks).open === 0) {
    return lists;
  }
  return [...lists, {id: SN_UNFILED_ID, name: SN_UNFILED_NAME}];
}

/**
 * How many *open* to-dos each list holds, keyed by list id.
 *
 * Unfiled ones are counted under `SN_UNFILED_ID`, so the Inbox counts like any
 * other list. Shown against each row in Settings because "which list is my
 * to-do actually in?" is otherwise unanswerable from this screen — and it has
 * been the real question twice: the tablet's own names for its lists are not
 * always the names its API reports, so a to-do can be sitting in plain sight
 * under a heading you did not think to look under.
 */
export function snOpenCounts(
  lists: SnList[],
  tasks: SnTask[],
): Record<string, number> {
  const live = new Set(lists.map(l => l.id));
  const counts: Record<string, number> = {[SN_UNFILED_ID]: 0};
  for (const list of lists) {
    counts[list.id] = 0;
  }
  for (const task of tasks) {
    if (task.completed) {
      continue;
    }
    const key = snFiledUnder(task, live) ? task.listId : SN_UNFILED_ID;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * What to say after a refresh, when the Inbox is *not* among the lists.
 *
 * Null when there is nothing to explain. This exists because the absence of the
 * Inbox is indistinguishable from a broken feature: it has already cost one
 * round trip of "I have an item in my Inbox and the plugin does not show it",
 * where the answer was that the plugin was working exactly as asked. Feedback
 * shown far from the action is feedback nobody sees, and no feedback at all is
 * worse.
 */
export function snUnfiledNote(lists: SnList[], tasks: SnTask[]): string | null {
  const {open, completed} = snUnfiledCounts(lists, tasks);
  if (open > 0) {
    return null;
  }
  if (completed > 0) {
    const s = completed === 1 ? '' : 's';
    const it = completed === 1 ? 'It is' : 'They are';
    return (
      `No Inbox: the ${completed} to-do${s} that belong to no list ` +
      `${it.toLowerCase()} already completed, and completed to-dos are not brought over.`
    );
  }
  return 'No Inbox: every to-do on this account is in a list.';
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
