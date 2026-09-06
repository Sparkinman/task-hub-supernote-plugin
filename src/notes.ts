import {PluginCommAPI, PluginFileAPI, PluginManager} from 'sn-plugin-lib';

import {dailyNotePath, parentDir, type DailyNoteConfig} from './dailynote';
import {periodNotePath, type Period, type PeriodNoteConfig} from './periodnote';
import {
  meetingNotePath,
  proposeMeetingPath,
  type MeetingLinks,
  type MeetingNoteConfig,
} from './meetingnote';
import type {VEvent} from './ical';
import type {DateFormat} from './format';
import {ensureDir, externalRoot, listFiles, listNotes} from './storage';

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
  /**
   * Set only for a user's own template from MyStyle: its path relative to
   * shared storage. `createAt` tries this as well as the name, because which
   * form the firmware accepts for a custom template is undocumented.
   */
  userPath?: string;
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

/**
 * Where the device keeps the templates a user has added themselves.
 *
 * MyStyle is the folder the Supernote uses for user content of this kind — it
 * is also where a .snplg is dropped to install a plugin. The templates in it are
 * images, which is why `listNotes` could never see them.
 */
export const MY_STYLE_ROOT = 'MyStyle';
/**
 * The image formats Ratta's SDK accepts as a custom template. PDF is not one of
 * them — `insertImage` and the `Picture` type both say png, jpg and jpeg only.
 */
const TEMPLATE_SUFFIXES = ['.png', '.jpg', '.jpeg'];

/**
 * The user's own templates, from MyStyle, alongside the built-in ones.
 *
 * A custom template is offered by name, and `createAt` already tries several
 * forms of whatever it is given — bare name, URI, path — because which one the
 * firmware accepts is undocumented. The file path is carried in `vUri` so the
 * picker can show a real thumbnail of a PNG template rather than a placeholder.
 *
 * Nothing here fails loudly: a device with no MyStyle folder, or an app.npk too
 * old to have the native lister, simply offers the built-in templates.
 */
export async function listUserTemplates(): Promise<NoteTemplate[]> {
  const files = await listFiles(MY_STYLE_ROOT, TEMPLATE_SUFFIXES);
  const root = await externalRoot();
  return files
    .filter(path => !path.toLowerCase().endsWith('.snplg'))
    .map(path => {
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
      const uri = root ? `file://${root}/${path}` : '';
      return {name, vUri: uri, hUri: uri, userPath: path};
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Built-in templates first, then the user's own from MyStyle. */
export async function listAllTemplates(): Promise<NoteTemplate[]> {
  const [system, user] = await Promise.all([listSystemTemplates(), listUserTemplates()]);
  // A user template whose name collides with a built-in still appears: they are
  // different files, and silently dropping one would be worse than two rows
  // with the same label.
  return [...system, ...user];
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

  // User templates are included in the search so a MyStyle choice is recognised
  // and its several possible spellings are all tried, rather than falling
  // straight through to the host default.
  const templates = await listAllTemplates();
  const chosen = templates.find(t => t.vUri === preferred);

  const candidates: string[] = [];
  if (chosen?.userPath) {
    // createNote documents a custom template as "a custom template image path",
    // so the path forms go first — the absolute one, then the one relative to
    // shared storage. The name and URI follow only as fallbacks, since which
    // spelling a given firmware accepts is not documented.
    const absoluteRoot = await externalRoot();
    if (absoluteRoot) {
      candidates.push(`${absoluteRoot}/${chosen.userPath}`);
    }
    candidates.push(chosen.userPath, chosen.name, chosen.vUri);
  } else if (chosen) {
    // A built-in template is chosen by name, per the same documentation.
    candidates.push(chosen.name, chosen.vUri);
  } else if (preferred) {
    // A template chosen through the file browser is stored as a file:// URI and
    // is in no list to look up. createNote wants a path, so the bare path is
    // tried first and the URI kept only as a fallback.
    if (preferred.startsWith('file://')) {
      const absolutePath = preferred.slice('file://'.length);
      candidates.push(absolutePath);
      const storageRoot = await externalRoot();
      if (storageRoot && absolutePath.startsWith(`${storageRoot}/`)) {
        candidates.push(absolutePath.slice(storageRoot.length + 1));
      }
      candidates.push(absolutePath.slice(absolutePath.lastIndexOf('/') + 1));
    }
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

/**
 * Create the note for a week, month or quarter (or a day, which routes through
 * the daily note rules unchanged).
 *
 * Split from opening for the same reason `createDailyNote` is: the caller has to
 * dismiss the plugin view between the two, or the host keeps believing the
 * plugin is still showing and the next press merely closes it.
 */
export async function createPeriodNote(
  period: Period,
  config: PeriodNoteConfig,
  iso: string,
  dateFormat: DateFormat,
): Promise<string> {
  const relative = periodNotePath(period, config, iso, dateFormat);
  if (!relative) {
    throw new Error('Could not build a note path for that period.');
  }
  await createAt(relative, config.template);
  return relative;
}

/** Open an existing period note. */
export async function openPeriodNote(
  period: Period,
  config: PeriodNoteConfig,
  iso: string,
  dateFormat: DateFormat,
): Promise<void> {
  const relative = periodNotePath(period, config, iso, dateFormat);
  if (!relative) {
    throw new Error('Could not build a note path for that period.');
  }
  await openNote(relative);
}

/** Every note path under a period's configured root, for existence checks. */
export async function findPeriodNotes(config: PeriodNoteConfig): Promise<string[]> {
  return listNotes(config.root);
}

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

/** Device models, as PointUtils numbers them. */
const MACHINE_NAMES: Record<number, string> = {
  0: 'A5',
  1: 'A6',
  2: 'A6X',
  3: 'A5X',
  4: 'Nomad',
  5: 'Manta',
};

/**
 * Which Supernote this is, by name, or null when the host will not say.
 *
 * Read for display only. The interface scales from the height the window
 * reports rather than from this: that number is available synchronously, when
 * the stylesheet is built, and this is not.
 */
export async function deviceName(): Promise<string | null> {
  try {
    const type = await PluginManager.getDeviceType();
    const value = typeof type === 'number' ? type : (type as {result?: number})?.result;
    return typeof value === 'number' ? (MACHINE_NAMES[value] ?? `type ${value}`) : null;
  } catch {
    return null;
  }
}
