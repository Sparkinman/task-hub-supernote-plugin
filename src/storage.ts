import {NativeModules} from 'react-native';

import {ensureFileAccess} from './permissions';
import {EMPTY_CONFIG, type RadicaleConfig} from './settings';
import {isMarkStyle} from './markstyle';
import {DEFAULT_DAILY_NOTE, type DailyNoteConfig} from './dailynote';
import {DEFAULT_MEETING_NOTE, type MeetingLinks, type MeetingNoteConfig} from './meetingnote';

/**
 * Durable settings, stored as JSON in Document/TaskHub/settings.json.
 *
 * Written by the SettingsStoreModule Kotlin module — sn-plugin-lib has no
 * general file I/O, so there is no SDK route to this. The location is
 * user-visible storage rather than the plugin's private directory precisely so
 * it survives uninstalling or updating the plugin.
 */

interface SettingsStore {
  read(): Promise<string | null>;
  write(contents: string): Promise<string>;
  location(): Promise<string>;
  externalRoot(): Promise<string>;
  makeDirs(relativePath: string): Promise<boolean>;
  listNotes(relativeRoot: string): Promise<string[]>;
  listDirs(relativePath: string): Promise<string[]>;
  writeLinkImage(relativePath: string, base64: string, caption: string): Promise<string>;
}

// Absent when running against a build without the native module compiled in.
const store: SettingsStore | undefined = NativeModules.TaskHubSettingsStore;

export function storageAvailable(): boolean {
  return store !== undefined && store !== null;
}

/** Version tag, so a future format change can migrate rather than misread. */
const FORMAT = 1;

interface StoredShape {
  version: number;
  config: Partial<RadicaleConfig>;
}

/**
 * Drop keys whose value is undefined.
 *
 * `sanitise` names every field explicitly, so one missing from an older
 * settings.json comes back as `{key: undefined}` — and object spread copies that
 * over the default rather than falling through to it. A file written before
 * markStyle existed therefore loaded as `markStyle: undefined`, and the page
 * mark was requested with no style at all and never appeared.
 */
function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Exported for tests: the merge with EMPTY_CONFIG is where the bug lived. */
export function sanitise(raw: unknown): Partial<RadicaleConfig> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const value = raw as Partial<RadicaleConfig>;
  const asStrings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((u): u is string => typeof u === 'string') : [];

  // Take only known keys of the expected type. A hand-edited or truncated file
  // must not be able to inject arbitrary shapes into config state.
  return defined({
    serverUrl: typeof value.serverUrl === 'string' ? value.serverUrl : undefined,
    username: typeof value.username === 'string' ? value.username : undefined,
    password: typeof value.password === 'string' ? value.password : undefined,
    owner: typeof value.owner === 'string' ? value.owner : undefined,
    collectionUrls: asStrings(value.collectionUrls),
    calendarUrls: asStrings(value.calendarUrls),
    defaultCollectionUrl:
      typeof value.defaultCollectionUrl === 'string' ? value.defaultCollectionUrl : undefined,
    dateFormat:
      value.dateFormat === 'iso' || value.dateFormat === 'us' || value.dateFormat === 'eu'
        ? value.dateFormat
        : undefined,
    timeFormat: value.timeFormat === '12' || value.timeFormat === '24' ? value.timeFormat : undefined,
    markStyle: isMarkStyle(value.markStyle) ? value.markStyle : undefined,
    markShade: typeof value.markShade === 'boolean' ? value.markShade : undefined,
    markLabel: typeof value.markLabel === 'boolean' ? value.markLabel : undefined,
    dailyNote: sanitiseDailyNote(value.dailyNote),
    meetingNote: sanitiseMeetingNote(value.meetingNote),
    meetingLinks: sanitiseLinks(value.meetingLinks),
  });
}

function sanitiseDailyNote(raw: unknown): DailyNoteConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {...DEFAULT_DAILY_NOTE};
  }
  const value = raw as Partial<DailyNoteConfig>;
  return {
    root: typeof value.root === 'string' && value.root.trim() ? value.root : DEFAULT_DAILY_NOTE.root,
    layout:
      typeof value.layout === 'string' && value.layout.trim()
        ? value.layout
        : DEFAULT_DAILY_NOTE.layout,
    template: typeof value.template === 'string' ? value.template : '',
  };
}

function sanitiseLinks(raw: unknown): MeetingLinks {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const out: MeetingLinks = {};
  for (const [uid, path] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof path === 'string' && path) {
      out[uid] = path;
    }
  }
  return out;
}

function sanitiseMeetingNote(raw: unknown): MeetingNoteConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {...DEFAULT_MEETING_NOTE};
  }
  const value = raw as Partial<MeetingNoteConfig>;
  return {
    root:
      typeof value.root === 'string' && value.root.trim()
        ? value.root
        : DEFAULT_MEETING_NOTE.root,
    template: typeof value.template === 'string' ? value.template : '',
  };
}

/** Absolute path of shared storage, needed to build note paths for the SDK. */
export async function externalRoot(): Promise<string | null> {
  if (!store) {
    return null;
  }
  try {
    return await store.externalRoot();
  } catch {
    return null;
  }
}

export async function ensureDir(relativePath: string): Promise<void> {
  if (!store || !relativePath) {
    return;
  }
  await ensureFileAccess();
  await store.makeDirs(relativePath);
}

/** Immediate subfolders of a path, for the folder picker. */
export async function listDirs(relativePath: string): Promise<string[]> {
  if (!store) {
    return [];
  }
  try {
    await ensureFileAccess();
    return await store.listDirs(relativePath);
  } catch {
    return [];
  }
}

/** Every .note under the daily-note root, relative to shared storage. */
export async function listNotes(relativeRoot: string): Promise<string[]> {
  if (!store || !relativeRoot) {
    return [];
  }
  try {
    await ensureFileAccess();
    return await store.listNotes(relativeRoot);
  } catch {
    return [];
  }
}

/**
 * Read saved settings, or null when nothing is stored.
 *
 * Never throws: a missing module, denied permission or corrupt file all mean
 * "start with defaults", and none of them should stop the plugin opening.
 */
export async function loadSettings(): Promise<RadicaleConfig | null> {
  if (!store) {
    return null;
  }
  try {
    await ensureFileAccess();
    const text = await store.read();
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text) as StoredShape;
    if (parsed?.version !== FORMAT) {
      return null;
    }
    return {...EMPTY_CONFIG, ...sanitise(parsed.config)};
  } catch {
    return null;
  }
}

/** Save settings. Resolves to the path written, and throws so the UI can report. */
export async function saveSettings(config: RadicaleConfig): Promise<string> {
  if (!store) {
    throw new Error('This build has no settings storage — rebuild with the native module.');
  }
  await ensureFileAccess();
  const payload: StoredShape = {version: FORMAT, config};
  return store.write(JSON.stringify(payload, null, 2));
}

/**
 * Erase everything this plugin has saved on the device.
 *
 * Truncates the file rather than deleting it: removing a file needs
 * FILE:DELETE, which this plugin deliberately does not request, and a
 * zero-byte file is indistinguishable from a missing one to `loadSettings` —
 * an empty read already means "start with defaults". Nothing of the old
 * contents, credentials included, is left behind.
 *
 * Throws so the UI can report a failure rather than claiming a wipe that did
 * not happen.
 */
export async function wipeSettings(): Promise<void> {
  if (!store) {
    throw new Error('This build has no settings storage — nothing is saved on disk.');
  }
  await ensureFileAccess();
  await store.write('');
}

/**
 * Draw the image a page mark links to, and return its path.
 *
 * Composed natively so the caption stays sharp at whatever size the device's
 * viewer renders it. Resolves to null when it could not be written — the caller
 * falls back rather than failing.
 */
export async function writeLinkImage(
  relativePath: string,
  base64: string,
  caption: string,
): Promise<string | null> {
  if (!store) {
    return null;
  }
  try {
    await ensureFileAccess();
    return await store.writeLinkImage(relativePath, base64, caption);
  } catch {
    return null;
  }
}

export async function settingsLocation(): Promise<string | null> {
  if (!store) {
    return null;
  }
  try {
    return await store.location();
  } catch {
    return null;
  }
}
