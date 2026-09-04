import {PluginCommAPI, PluginFileAPI} from 'sn-plugin-lib';

import {dailyNotePath, parentDir, type DailyNoteConfig} from './dailynote';
import {
  meetingNotePath,
  proposeMeetingPath,
  type MeetingLinks,
  type MeetingNoteConfig,
} from './meetingnote';
import type {VEvent} from './ical';
import type {DateFormat} from './format';
import {ensureDir, externalRoot, listNotes} from './storage';

/**
 * Daily notes: create one for a date, or open the existing one.
 *
 * Path building is pure and lives in dailynote.ts; this module only bridges it
 * to the SDK and the filesystem module.
 */

// Deliberately ungated: buildPlugin always bundles with --dev false, so a
// __DEV__-guarded log is invisible on a real install. One tagged line per
// operation is what makes `adb logcat -s TaskHub` useful when a create fails.
const TAG = '[TaskHub]';

interface Loose {
  success?: boolean;
  result?: unknown;
  error?: {message?: string; code?: number};
}

/**
 * Narrow an SDK response, treating a falsy `result` as failure.
 *
 * createNote answers `{success: true, result: false}` when the file could not
 * be written — the call succeeded, the operation did not. Checking only
 * `success` silently reports a note that was never created.
 */
function unwrap<T>(res: unknown, what: string): T {
  const parsed = res as Loose | null | undefined;
  const raw = JSON.stringify(parsed ?? null);
  if (!parsed?.success) {
    console.log(`${TAG} ${what} failed: ${raw}`);
    throw new Error(`${what} failed: ${parsed?.error?.message ?? raw}`);
  }
  if (parsed.result === false || parsed.result === null || parsed.result === undefined) {
    console.log(`${TAG} ${what} returned no result: ${raw}`);
    throw new Error(`${what} returned ${raw}`);
  }
  return parsed.result as T;
}

/** Attempt createNote, resolving to the raw response rather than throwing. */
async function tryCreate(notePath: string, template: string): Promise<Loose | null> {
  console.log(`${TAG} createNote path="${notePath}" template="${template}"`);
  try {
    return (await PluginFileAPI.createNote({
      notePath,
      template,
      mode: 0,
      isPortrait: true,
    })) as Loose | null;
  } catch (err) {
    console.log(`${TAG} createNote threw: ${String(err)}`);
    return null;
  }
}

function created(res: Loose | null): boolean {
  return Boolean(res?.success) && res?.result !== false;
}

export interface NoteTemplate {
  name: string;
  /** Portrait template URI — what createNote wants when isPortrait is true. */
  vUri: string;
  hUri: string;
}

/**
 * Built-in note templates.
 *
 * Unlike most of the SDK this resolves to a bare array rather than an
 * APIResponse, so it is read directly.
 */
export async function listSystemTemplates(): Promise<NoteTemplate[]> {
  try {
    const res = await PluginCommAPI.getNoteSystemTemplates();
    if (!Array.isArray(res)) {
      return [];
    }
    return res
      .map(t => t as Partial<NoteTemplate>)
      .filter((t): t is NoteTemplate => typeof t?.vUri === 'string' && t.vUri.length > 0)
      .map(t => ({name: t.name || '(unnamed)', vUri: t.vUri, hUri: t.hUri ?? ''}));
  } catch (err) {
    console.log(`${TAG} getNoteSystemTemplates failed: ${String(err)}`);
    return [];
  }
}

/** ISO days under the configured root that already have a note. */
export async function findExistingNotes(config: DailyNoteConfig): Promise<string[]> {
  return listNotes(config.root);
}

async function absolute(relative: string): Promise<string> {
  const root = await externalRoot();
  if (!root) {
    throw new Error('Storage is unavailable in this build.');
  }
  return `${root}/${relative}`;
}

/** Open an absolute path at a page — used to jump back to a task's source. */
export async function openFileAt(absolutePath: string, page: number): Promise<void> {
  console.log(`${TAG} openFile ${absolutePath} page=${page}`);
  unwrap(await PluginFileAPI.openFile(absolutePath, page), 'openFile');
}

export async function openNote(relativePath: string): Promise<void> {
  const path = await absolute(relativePath);
  console.log(`${TAG} openFile ${path}`);
  unwrap(await PluginFileAPI.openFile(path, 0), 'openFile');
}

/**
 * Create the note file for a day. Does not open it.
 *
 * Split from opening so the caller can dismiss the plugin view in between:
 * calling closePluginView after openFile leaves the host believing the plugin
 * is still showing, which makes the next button press merely close it — the
 * "have to press twice" symptom.
 *
 * Parent directories are made first — createNote does not build a missing tree
 * and fails opaquely when one is absent.
 */
export async function createDailyNote(
  config: DailyNoteConfig,
  iso: string,
  dateFormat: DateFormat,
): Promise<string> {
  const relative = dailyNotePath(config, iso, dateFormat);
  if (!relative) {
    throw new Error('Could not build a note path for that date.');
  }

  await createAt(relative, config.template);
  return relative;
}

/**
 * Create a note at a relative path, trying template forms until one works.
 *
 * The SDK documents `template` as a system template NAME while
 * getNoteSystemTemplates reports a URI, and which one the firmware accepts is
 * not documented — so the preferred value is tried both ways, then the host
 * default, then the first few built-ins. Every attempt is logged.
 */
async function createAt(relative: string, preferred: string): Promise<void> {
  await ensureDir(parentDir(relative));
  const path = await absolute(relative);

  const templates = await listSystemTemplates();
  const chosen = templates.find(t => t.vUri === preferred);

  const candidates: string[] = [];
  if (chosen) {
    candidates.push(chosen.name, chosen.vUri);
  } else if (preferred) {
    candidates.push(preferred);
  }
  candidates.push('');
  for (const t of templates.slice(0, 3)) {
    candidates.push(t.name, t.vUri);
  }

  let response: Loose | null = null;
  let used = '';
  for (const candidate of candidates) {
    response = await tryCreate(path, candidate);
    if (created(response)) {
      used = candidate;
      break;
    }
  }

  if (!created(response)) {
    const tried = candidates.map(c => `"${c}"`).join(', ');
    throw new Error(
      `createNote failed for ${path}. Tried templates: ${tried}. Last response: ${JSON.stringify(
        response ?? null,
      )}`,
    );
  }
  console.log(`${TAG} createNote succeeded with template="${used}"`);
}

/** Every .note under the meeting-note root. */
export async function findMeetingNotes(config: MeetingNoteConfig): Promise<string[]> {
  return listNotes(config.root);
}

/**
 * Create the note for an event and return its path, for the caller to link.
 *
 * The name comes from the meeting title; `existing` is consulted so a second
 * meeting with the same title gets " (2)" rather than sharing the first's note.
 */
export async function createMeetingNote(
  config: MeetingNoteConfig,
  event: VEvent,
  existing: string[],
): Promise<string> {
  const relative = proposeMeetingPath(config, event, existing);
  if (!relative) {
    throw new Error('That event has no UID, so a note cannot be linked to it.');
  }
  await createAt(relative, config.template);
  return relative;
}

export async function openMeetingNote(
  config: MeetingNoteConfig,
  event: VEvent,
  links: MeetingLinks,
  existing: string[],
): Promise<void> {
  const relative = meetingNotePath(config, event, links, existing);
  if (!relative) {
    throw new Error('No note is linked to that event yet.');
  }
  await openNote(relative);
}

/** Open a day's note. Call after the plugin view has been dismissed. */
export async function openDailyNote(
  config: DailyNoteConfig,
  iso: string,
  dateFormat: DateFormat,
): Promise<void> {
  const relative = dailyNotePath(config, iso, dateFormat);
  if (!relative) {
    throw new Error('Could not build a note path for that date.');
  }
  await openNote(relative);
}


