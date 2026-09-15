import {NativeModules} from 'react-native';

import {ensureFileAccess} from './permissions';
import {EMPTY_CONFIG, type ServerConfig} from './settings';
import {isMarkStyle, isShadeColor} from './markstyle';
import {DEFAULT_DAILY_NOTE, type DailyNoteConfig} from './dailynote';
import {
  DEFAULT_MONTH_NOTE,
  DEFAULT_QUARTER_NOTE,
  DEFAULT_WEEK_NOTE,
  DEFAULT_YEAR_NOTE,
  type PeriodNoteConfig,
} from './periodnote';
import {DEFAULT_MEETING_NOTE, type MeetingLinks, type MeetingNoteConfig} from './meetingnote';
import type {NoteFile} from './notesearch';
import {DEMO} from './demoflag';
import {demoConfig} from './demodata';
import type {CalendarFeed} from './feeds';
import {DEFAULT_SN_CONFIG, type SnConfig, type SnList} from './sncloud';

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
  /** Optional: absent from a build whose native module predates the cache. */
  readNamed?(name: string): Promise<string | null>;
  writeNamed?(name: string, contents: string): Promise<string>;
  location(): Promise<string>;
  externalRoot(): Promise<string>;
  makeDirs(relativePath: string): Promise<boolean>;
  listNotes(relativeRoot: string): Promise<string[]>;
  /** Optional: absent from a build whose native module predates the Find tab. */
  listNotesWithMeta?(relativeRoot: string): Promise<NoteFile[]>;
  listFiles?(relativeRoot: string, suffixes: string): Promise<string[]>;
  listFilesHere?(relativePath: string, suffixes: string): Promise<string[]>;
  listDirs(relativePath: string): Promise<string[]>;
  writeLinkImage(relativePath: string, base64: string, caption: string): Promise<string>;
  /** Optional: absent from a build whose native module predates Supernote Cloud. */
  hashHex?(algorithm: string, text: string): Promise<string>;
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
  config: Partial<ServerConfig>;
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
export function sanitise(raw: unknown): Partial<ServerConfig> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const value = raw as Partial<ServerConfig>;
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
    // Validated entry by entry rather than trusted: a hand-edited or truncated
    // settings.json must not be able to put a feed with no URL into the fetch
    // loop, and a name is what the calendar views label it with.
    feeds: Array.isArray(value.feeds)
      ? (value.feeds as unknown[])
          .filter(
            (f): f is CalendarFeed =>
              typeof f === 'object' &&
              f !== null &&
              typeof (f as CalendarFeed).url === 'string' &&
              (f as CalendarFeed).url.trim() !== '',
          )
          .map(f => ({url: f.url.trim(), name: String(f.name ?? '').trim() || f.url.trim()}))
      : undefined,
    supernote: sanitiseSupernote(value.supernote),
    defaultCollectionUrl:
      typeof value.defaultCollectionUrl === 'string' ? value.defaultCollectionUrl : undefined,
    dateFormat:
      value.dateFormat === 'iso' || value.dateFormat === 'us' || value.dateFormat === 'eu'
        ? value.dateFormat
        : undefined,
    timeFormat: value.timeFormat === '12' || value.timeFormat === '24' ? value.timeFormat : undefined,
    startTab:
      value.startTab === 'tasks' || value.startTab === 'calendar' ? value.startTab : undefined,
    markStyle: isMarkStyle(value.markStyle) ? value.markStyle : undefined,
    markShade: typeof value.markShade === 'boolean' ? value.markShade : undefined,
    markShadeColor: isShadeColor(value.markShadeColor)
      ? (value.markShadeColor as string)
      : undefined,
    agendaStartHour: asHour(value.agendaStartHour),
    agendaEndHour: asHour(value.agendaEndHour),
    markLabel: typeof value.markLabel === 'boolean' ? value.markLabel : undefined,
    dailyNote: sanitiseDailyNote(value.dailyNote),
    // A settings file written before these existed simply has no such key, and
    // each falls back to its own default rather than to the daily note's.
    weekNote: sanitisePeriodNote(value.weekNote, DEFAULT_WEEK_NOTE),
    monthNote: sanitisePeriodNote(value.monthNote, DEFAULT_MONTH_NOTE),
    quarterNote: sanitisePeriodNote(value.quarterNote, DEFAULT_QUARTER_NOTE),
    yearNote: sanitisePeriodNote(value.yearNote, DEFAULT_YEAR_NOTE),
    meetingNote: sanitiseMeetingNote(value.meetingNote),
    meetingLinks: sanitiseLinks(value.meetingLinks),
    lastDay:
      typeof value.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.lastDay)
        ? value.lastDay
        : undefined,
  });
}

/** Same rules as a daily note, against whichever period's defaults apply. */
/**
 * The Supernote connection, field by field.
 *
 * Absent in a file written before this existed, which must mean off — nobody
 * gets connected to an account by updating the plugin.
 */
function sanitiseSupernote(raw: unknown): SnConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {...DEFAULT_SN_CONFIG};
  }
  const value = raw as Partial<SnConfig>;
  return {
    enabled: value.enabled === true,
    email: typeof value.email === 'string' ? value.email : '',
    token: typeof value.token === 'string' ? value.token : '',
    lists: Array.isArray(value.lists)
      ? (value.lists as unknown[])
          .filter(
            (l): l is SnList =>
              typeof l === 'object' &&
              l !== null &&
              typeof (l as SnList).id === 'string' &&
              (l as SnList).id.trim() !== '',
          )
          .map(l => ({id: l.id.trim(), name: String(l.name ?? '').trim() || 'Supernote'}))
      : [],
  };
}

/** An hour of the day, or undefined so the default applies. */
function asHour(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return undefined;
  }
  const hour = Math.round(raw);
  return hour >= 0 && hour <= 23 ? hour : undefined;
}

function sanitisePeriodNote(raw: unknown, fallback: PeriodNoteConfig): PeriodNoteConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {...fallback};
  }
  const value = raw as Partial<PeriodNoteConfig>;
  return {
    // Absent in a file written before the switches existed, which must mean on:
    // those users already have these notes and turning them off silently would
    // be a change nobody asked for.
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    root: typeof value.root === 'string' && value.root.trim() ? value.root : fallback.root,
    layout:
      typeof value.layout === 'string' && value.layout.trim() ? value.layout : fallback.layout,
    template: typeof value.template === 'string' ? value.template : '',
    // False for a settings file written before this existed: a note that has
    // never had a date written into it should not start getting one because
    // the plugin updated.
    dateHeading: typeof value.dateHeading === 'boolean' ? value.dateHeading : false,
  };
}

function sanitiseDailyNote(raw: unknown): DailyNoteConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {...DEFAULT_DAILY_NOTE};
  }
  const value = raw as Partial<DailyNoteConfig>;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    root: typeof value.root === 'string' && value.root.trim() ? value.root : DEFAULT_DAILY_NOTE.root,
    layout:
      typeof value.layout === 'string' && value.layout.trim()
        ? value.layout
        : DEFAULT_DAILY_NOTE.layout,
    template: typeof value.template === 'string' ? value.template : '',
    // False for a settings file written before this existed: a note that has
    // never had a date written into it should not start getting one because
    // the plugin updated.
    dateHeading: typeof value.dateHeading === 'boolean' ? value.dateHeading : false,
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
/**
 * Files under a folder with any of the given extensions.
 *
 * Separate from `listNotes`, which only reports `.note` files — the templates a
 * user keeps in MyStyle are images, and were invisible to it.
 *
 * Optional on the native side: a build without the method simply reports
 * nothing, so an older app.npk degrades to the built-in templates rather than
 * failing to open the settings screen.
 */
export async function listFiles(
  relativeRoot: string,
  suffixes: string[],
): Promise<string[]> {
  if (!store?.listFiles || !relativeRoot) {
    return [];
  }
  try {
    await ensureFileAccess();
    return await store.listFiles(relativeRoot, suffixes.join(','));
  } catch {
    return [];
  }
}

/**
 * Matching files in one directory, not descending into it.
 *
 * For the template picker's file browser, which shows a directory at a time
 * beside `listDirs`. Optional on the native side for the same reason as
 * `listFiles`: an older app.npk reports nothing rather than failing.
 */
export async function listFilesHere(
  relativePath: string,
  suffixes: string[],
): Promise<string[]> {
  if (!store?.listFilesHere) {
    return [];
  }
  try {
    await ensureFileAccess();
    return await store.listFilesHere(relativePath, suffixes.join(','));
  } catch {
    return [];
  }
}

/**
 * Every .note under a folder, with the modification time and size of each.
 *
 * What the Find tab's index compares against to decide whether a note still
 * needs reading. Optional on the native side for the same reason as
 * `listFiles`: an older app.npk reports nothing, so the Find tab shows its
 * empty state rather than failing to render.
 */
/**
 * Hex digest of a string, using the JDK's MessageDigest.
 *
 * React Native has no crypto, and the Supernote Cloud sign-in needs MD5 and
 * SHA-256. Throws rather than resolving to null: a sign-in that silently
 * hashed nothing would send a wrong password and report "refused those
 * details", which is the least useful thing it could say.
 */
export async function hashHex(algorithm: 'MD5' | 'SHA-256', text: string): Promise<string> {
  if (!store?.hashHex) {
    throw new Error('This build cannot sign in to Supernote Cloud — its native module is older than the feature.');
  }
  return store.hashHex(algorithm, text);
}

export async function listNotesWithMeta(relativeRoot: string): Promise<NoteFile[]> {
  if (!store?.listNotesWithMeta || !relativeRoot) {
    return [];
  }
  try {
    await ensureFileAccess();
    const raw = await store.listNotesWithMeta(relativeRoot);
    return (Array.isArray(raw) ? raw : []).filter(
      (file): file is NoteFile =>
        typeof file?.path === 'string' &&
        typeof file?.modified === 'number' &&
        typeof file?.size === 'number',
    );
  } catch {
    return [];
  }
}

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
export async function loadSettings(): Promise<ServerConfig | null> {
  // Its own invented settings, never the real plugin's. Both installs share
  // Document/TaskHub, so reading the file here would show a recording somebody's
  // actual server address.
  if (DEMO) {
    return demoConfig();
  }
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
export async function saveSettings(config: ServerConfig): Promise<string> {
  // Accepted and discarded. Settings can be opened and changed on camera, and
  // nothing is written — so the demo is identical every time it is launched.
  if (DEMO) {
    return 'Document/TaskHubDemo (nothing is written by the demo build)';
  }
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

/**
 * Read one of the plugin's own files in Document/TaskHub, by bare name.
 *
 * Resolves to null on any failure, including a native module too old to have
 * the method. Only the cache uses this, and a cache that cannot be read is a
 * slow opening rather than a broken one.
 */
export async function readNamed(name: string): Promise<string | null> {
  // The demo build owns no files. Reading none means it cannot pick up a cache
  // or an index belonging to the real plugin, which shares this folder.
  if (DEMO) {
    return null;
  }
  if (!store?.readNamed) {
    return null;
  }
  try {
    await ensureFileAccess();
    return await store.readNamed(name);
  } catch {
    return null;
  }
}

/** Write one of the plugin's own files. Resolves false if it did not happen. */
export async function writeNamed(name: string, contents: string): Promise<boolean> {
  // Writing none means it cannot overwrite the real plugin's either. This is
  // the whole of what keeps the two installs from treading on each other.
  if (DEMO) {
    return true;
  }
  if (!store?.writeNamed) {
    return false;
  }
  try {
    await ensureFileAccess();
    await store.writeNamed(name, contents);
    return true;
  } catch {
    return false;
  }
}
