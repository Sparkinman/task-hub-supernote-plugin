import {ensureInternet} from './permissions';
import {hashHex} from './storage';
import {
  SN_BASE_URL,
  SN_LIST_GROUPS,
  SN_LIST_TASKS,
  SN_MAX_RESULTS,
  SN_TASK,
  snFieldsFrom,
  snListsFrom,
  snTaskRead,
  snTruncated,
  type SnList,
  type SnTask,
} from './sncloud';

/**
 * The requests to Supernote Cloud.
 *
 * Transcribed from the Task Hub server's `app/connectors/supernote.py`, which
 * worked all of this out against a live account. Every comment here that sounds
 * like hard-won knowledge is exactly that, and none of it should be "tidied" on
 * the assumption that the obvious thing works — the obvious thing is what these
 * notes are warning about.
 *
 * `sncloud.ts` holds everything that can be decided without the network and is
 * unit-tested; this module only makes calls.
 */

const TAG = '[TaskHub]';

/** Raised when the session is gone, as distinct from a request that failed. */
export class SnAuthError extends Error {}

/**
 * Said if Supernote still holds to-dos back despite being asked for everything.
 *
 * A backstop rather than an expectation. Every read asks for `SN_MAX_RESULTS`
 * rows, which is far past any real account, so this should never be seen — but
 * it was written when the twenty-row default looked unfixable, and it stays
 * because the alternative is the plugin silently omitting to-dos again if that
 * ceiling ever moves. Unexplained absence is the failure this whole area has
 * been prone to.
 */
export const SN_CAPPED =
  'Supernote returned only part of your to-do list and would not give up the rest, so some to-dos are not shown here. Completing or deleting old ones on the tablet brings the newer ones into view.';

export const SN_EXPIRED =
  'Your Supernote sign-in has run out. It lasts thirty days and cannot renew itself, so sign in again in Settings.';

/**
 * One call.
 *
 * Two things here are not optional. **Their generic failure is HTTP 200 with
 * `success: false`**, so a status check alone treats every refusal as a success
 * — the same shape that made `createNote` look like it had worked. And 401/403
 * means the thirty-day session has run out, which is a different problem from
 * the request being wrong and has to be said differently.
 */
async function call(
  method: string,
  path: string,
  payload?: Record<string, unknown>,
  token = '',
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  if (token) {
    headers['x-access-token'] = token;
  }

  let response: Response;
  try {
    response = await fetch(`${SN_BASE_URL}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Could not reach Supernote Cloud — ${String(err)}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new SnAuthError(SN_EXPIRED);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `Supernote Cloud answered ${response.status} with something that was not JSON. The unofficial API it uses may have changed.`,
    );
  }
  if (typeof body !== 'object' || body === null) {
    throw new Error('Supernote Cloud returned an unexpected response.');
  }
  return body as Record<string, unknown>;
}

/** A call carrying the session, which also checks the `success: false` refusal. */
async function authed(
  method: string,
  path: string,
  token: string,
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!token) {
    throw new SnAuthError('No Supernote session is saved.');
  }
  await ensureInternet();
  const body = await call(method, path, payload, token);
  if (body.success === false) {
    throw new Error(String(body.errorMsg ?? `Supernote Cloud refused ${path}.`));
  }
  return body;
}

/**
 * Reading uses **POST**, not GET.
 *
 * Named for what it means rather than for the verb, as the server's connector
 * is, because every listing route on this API is a POST with a body.
 */
function read(
  path: string,
  token: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return authed('POST', path, token, payload);
}

/**
 * The password as the wire wants it.
 *
 * Hex MD5 of the password, then SHA-256 of that with the server's nonce. The
 * plain password never crosses the network, which is why signing in is a
 * two-step dance rather than one request.
 */
async function passwordDigest(password: string, randomCode: string): Promise<string> {
  const md5 = await hashHex('MD5', password);
  return hashHex('SHA-256', `${md5}${randomCode}`);
}

export interface SnSignInStart {
  /** Set when the account needed no emailed code — sign-in is already done. */
  token?: string;
  /** Set when a code has been emailed; both go back to `finishSignIn`. */
  validCodeKey?: string;
  timestamp?: unknown;
}

/**
 * Step one: offer the password, and ask for the emailed code.
 *
 * Some accounts come straight back with a token. Most answer `errorCode E1760`
 * — **as `success: false`, not as an HTTP error** — meaning a code is wanted.
 */
export async function beginSignIn(email: string, password: string): Promise<SnSignInStart> {
  await ensureInternet();
  const account = email.trim();

  const challenge = await call('POST', '/official/user/query/random/code', {
    countryCode: '1',
    account,
  });
  const randomCode = challenge.randomCode;
  const timestamp = challenge.timestamp;
  if (!randomCode) {
    throw new Error(
      String(challenge.errorMsg ?? 'Supernote Cloud would not start a sign-in.'),
    );
  }

  const result = await call('POST', '/official/user/account/login/new', {
    countryCode: 1,
    account,
    password: await passwordDigest(password, String(randomCode)),
    browser: 'Chrome107',
    equipment: '1',
    loginMethod: '1',
    timestamp,
    language: 'en',
  });
  if (result.token) {
    return {token: String(result.token)};
  }
  if (result.errorCode !== 'E1760') {
    throw new SnAuthError(
      String(result.errorMsg ?? 'Supernote Cloud refused those details.'),
    );
  }

  // A code is wanted. The endpoint that sends it is signed with a key the
  // server hides inside a token it hands out: the token's last character is an
  // index into its own dash-separated parts, and the part at that index is what
  // gets hashed with the address.
  const preAuth = await call('POST', '/user/validcode/pre-auth', {account});
  const preToken = String(preAuth.token ?? '');
  const index = Number(preToken.slice(-1));
  const parts = preToken.split('-');
  if (!preToken || !Number.isFinite(index) || index < 0 || index >= parts.length) {
    throw new Error(
      'Supernote Cloud returned a verification token in a shape this version does not recognise.',
    );
  }
  const realKey = parts[index];

  const sent = await call('POST', '/user/mail/validcode/send', {
    email: account,
    timestamp,
    token: preToken,
    sign: await hashHex('SHA-256', `${account}${realKey}`),
  });
  if (!sent.validCodeKey) {
    throw new Error(
      String(sent.errorMsg ?? 'Supernote Cloud would not send a verification code.'),
    );
  }
  return {validCodeKey: String(sent.validCodeKey), timestamp};
}

/** Step two: exchange the emailed code for a session token. */
export async function finishSignIn(
  email: string,
  code: string,
  validCodeKey: string,
  timestamp: unknown,
): Promise<string> {
  await ensureInternet();
  const result = await call('POST', '/official/user/sms/login', {
    email: email.trim(),
    // Upper-cased: the codes are issued that way and the server compares them
    // literally.
    validCode: code.trim().toUpperCase(),
    validCodeKey,
    timestamp,
    browser: 'Chrome107',
    equipment: '4',
  });
  const token = result.token;
  if (!token) {
    throw new SnAuthError(
      String(
        result.errorMsg ??
          'That verification code was not accepted. They expire quickly, so ask for a new one if it has been more than a few minutes.',
      ),
    );
  }
  return String(token);
}

/** Every live to-do list on the account. */
export async function listSnLists(token: string): Promise<SnList[]> {
  return snListsFrom(await read(SN_LIST_GROUPS, token, {maxResults: SN_MAX_RESULTS}));
}

/**
 * Every task on the account, in one request.
 *
 * The API returns them all at once and tags each with the list it belongs to,
 * so this is one call however many lists are being watched — unlike the CalDAV
 * side, which is a request per collection. `nextSyncToken` comes back and would
 * suggest a delta read, but replaying it under the obvious parameter name
 * returned everything unchanged, so the full set is what is asked for.
 */
export async function listSnTasks(token: string): Promise<SnTask[]> {
  return (await readSnTasks(token)).tasks;
}

/**
 * Every task the account will give up, and whether that is all of them.
 *
 * `truncated` is the important field. The endpoint returns at most twenty rows
 * and provides no way to ask for the rest — see `SN_PAGE_SIZE` in `sncloud.ts`
 * for what was tried — so on a busy account this answer is a sample, not the
 * set. Reporting that is the whole of the fix available: a to-do missing
 * without explanation is what cost this plugin an afternoon of its author's
 * time and several installs.
 */
export async function readSnTasks(token: string): Promise<{
  tasks: SnTask[];
  rows: number;
  dropped: number;
  truncated: boolean;
}> {
  const body = await read(SN_LIST_TASKS, token, {maxResults: SN_MAX_RESULTS});
  const batch = snTaskRead(body);
  return {...batch, truncated: snTruncated(body)};
}

/** The server's own row for one task, to lay an update over. */
async function taskRow(token: string, id: string): Promise<Record<string, unknown> | null> {
  const body = await read(SN_LIST_TASKS, token, {maxResults: SN_MAX_RESULTS});
  const rows = body.scheduleTask;
  if (!Array.isArray(rows)) {
    return null;
  }
  for (const row of rows) {
    if (typeof row === 'object' && row !== null) {
      const candidate = row as Record<string, unknown>;
      if (String(candidate.taskId ?? '').trim() === id) {
        return candidate;
      }
    }
  }
  return null;
}

export interface SnDraft {
  title: string;
  notes?: string;
  dueDate: string;
  completed: boolean;
  completedAt?: number;
}

/** Create a task in one list. Answers the new id. */
export async function createSnTask(
  token: string,
  listId: string,
  draft: SnDraft,
): Promise<string> {
  const body = await read(SN_TASK, token, {...snFieldsFrom(draft), taskListId: String(listId)});
  const id = String(body.taskId ?? '').trim();
  if (!id) {
    throw new Error('Supernote accepted the task but returned no id for it.');
  }
  return id;
}

/**
 * Change an existing task.
 *
 * Reads the server's own row first and lays the editable fields over it, so the
 * sort orders, reminder flags and recurrence blocks Supernote keeps for itself
 * come back untouched rather than blanked by omission.
 *
 * **Never falls back to POST when the row is missing.** POST inserts even when
 * the body carries a taskId, so "update the task that is not there" would
 * quietly become "make a second one" — and the user would be left with a
 * duplicate rather than an error.
 */
export async function updateSnTask(
  token: string,
  id: string,
  draft: SnDraft,
): Promise<void> {
  const current = await taskRow(token, id);
  if (current === null) {
    throw new Error(`Supernote no longer has a task with id ${id}.`);
  }
  const payload: Record<string, unknown> = {
    ...current,
    ...snFieldsFrom(draft),
    // PUT is refused outright without this, and the complaint names the list
    // rather than the task, which sends you looking in the wrong place.
    lastModified: Date.now(),
  };
  await authed('PUT', SN_TASK, token, payload);
}

/** Delete a task. The id goes in the path; as a body or query it answers 500. */
export async function deleteSnTask(token: string, id: string): Promise<void> {
  await authed('DELETE', `${SN_TASK}/${encodeURIComponent(id)}`, token);
}

/** Confirm a saved session still works, for the settings screen. */
export async function verifySnSession(token: string): Promise<number> {
  const lists = await listSnLists(token);
  console.log(`${TAG} Supernote session good, ${lists.length} list(s)`);
  return lists.length;
}
