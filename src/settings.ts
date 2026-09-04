import type {TaskCollection} from './discovery';
import {DEFAULT_DAILY_NOTE, type DailyNoteConfig} from './dailynote';
import {DEFAULT_MEETING_NOTE, type MeetingLinks, type MeetingNoteConfig} from './meetingnote';
import type {DateFormat, TimeFormat} from './format';
import type {MarkStyle} from './markstyle';

export interface RadicaleConfig {
  /** Server origin, e.g. https://host:5232 — not a collection URL. */
  serverUrl: string;
  username: string;
  password: string;
  /**
   * Whose collections to browse, when that differs from the login.
   *
   * A Radicale credential scoped by a rights file logs in as one user while the
   * collections live under another's path — discovery must query the owner's
   * home, not the login's. Empty means they are the same.
   */
  owner: string;
  /** Every collection whose tasks are shown. Multiple lists can be watched at once. */
  collectionUrls: string[];
  /** Pre-ticked destination(s) when a new task is captured. */
  defaultCollectionUrl: string;
  /** VEVENT collections shown on the Calendar tab. */
  calendarUrls: string[];
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  /**
   * How a captured task marks the page it came from. Writes into the user's own
   * note, so it is configurable and can be turned off entirely.
   */
  markStyle: MarkStyle;
  /**
   * Also wash the handwriting with the marker pen, so a captured task reads as
   * one without being tapped. Off by default: it draws into the note with pen
   * values read from one device, and the box alone is already a clear marker.
   */
  markShade: boolean;
  /** Write "Task Hub Task" under the boxed handwriting. */
  markLabel: boolean;
  /** Where per-day notes live and how their folders are laid out. */
  dailyNote: DailyNoteConfig;
  /** Where per-event notes live. Device-only; never written back to CalDAV. */
  meetingNote: MeetingNoteConfig;
  /** event UID -> note path. Keeps note filenames free of encoded ids. */
  meetingLinks: MeetingLinks;
}

export const EMPTY_CONFIG: RadicaleConfig = {
  serverUrl: '',
  username: '',
  password: '',
  owner: '',
  collectionUrls: [],
  defaultCollectionUrl: '',
  calendarUrls: [],
  dateFormat: 'iso',
  timeFormat: '24',
  markStyle: 'dashed',
  markShade: false,
  markLabel: false,
  dailyNote: {...DEFAULT_DAILY_NOTE},
  meetingNote: {...DEFAULT_MEETING_NOTE},
  meetingLinks: {},
};

export function hasCalendars(config: RadicaleConfig): boolean {
  return config.calendarUrls.length > 0;
}

/** Toggle a VEVENT collection in the watched calendar set. */
export function toggleCalendar(config: RadicaleConfig, url: string): RadicaleConfig {
  return {
    ...config,
    calendarUrls: config.calendarUrls.includes(url)
      ? config.calendarUrls.filter(u => u !== url)
      : [...config.calendarUrls, url],
  };
}

/** Enough to attempt discovery. */
export function canDiscover(config: RadicaleConfig): boolean {
  return /^https?:\/\//i.test(config.serverUrl.trim()) && collectionsOwner(config).length > 0;
}

/** The path segment collections live under: the owner if set, else the login. */
export function collectionsOwner(config: RadicaleConfig): string {
  return (config.owner.trim() || config.username.trim()).trim();
}

/** Enough to read tasks. */
export function hasCollections(config: RadicaleConfig): boolean {
  return config.collectionUrls.length > 0;
}

/** Enough to save a new task. */
export function isConfigured(config: RadicaleConfig): boolean {
  return /^https?:\/\//i.test(config.defaultCollectionUrl.trim());
}

/**
 * Toggle a collection in the watched set.
 *
 * Deselecting the collection that new tasks go to would leave the target
 * dangling, so the target follows the selection: it falls back to whatever is
 * still selected, and a first selection claims it automatically.
 */
export function toggleCollection(config: RadicaleConfig, url: string): RadicaleConfig {
  const selected = config.collectionUrls.includes(url)
    ? config.collectionUrls.filter(u => u !== url)
    : [...config.collectionUrls, url];

  let target = config.defaultCollectionUrl;
  if (!selected.includes(target)) {
    target = selected[0] ?? '';
  }
  return {...config, collectionUrls: selected, defaultCollectionUrl: target};
}

/**
 * In-memory config, mirrored to disk by src/storage.ts.
 *
 * This module stays synchronous and SDK-free so every other module can read
 * config without awaiting; storage.ts owns the async load/save and calls
 * setConfig once on startup.
 *
 * The persisted file is plain text on shared storage and includes the password.
 * A plugin has no access to a keystore, so a Radicale credential scoped to just
 * these collections is safer than an account password — see the `owner` field.
 */
let current: RadicaleConfig = {...EMPTY_CONFIG};
let discovered: TaskCollection[] = [];

export function getConfig(): RadicaleConfig {
  return {
    ...current,
    collectionUrls: [...current.collectionUrls],
    calendarUrls: [...current.calendarUrls],
    dailyNote: {...current.dailyNote},
    meetingNote: {...current.meetingNote},
    meetingLinks: {...current.meetingLinks},
  };
}

export function setConfig(next: RadicaleConfig): void {
  current = {
    ...next,
    collectionUrls: [...next.collectionUrls],
    calendarUrls: [...next.calendarUrls],
    dailyNote: {...next.dailyNote},
    meetingNote: {...next.meetingNote},
    meetingLinks: {...next.meetingLinks},
  };
}

export function getCollections(): TaskCollection[] {
  return [...discovered];
}

export function setCollections(next: TaskCollection[]): void {
  discovered = [...next];
}

/** Human-readable name for a collection URL, for labelling tasks by list. */
export function collectionName(url: string): string {
  const match = discovered.find(c => c.url === url);
  if (match) {
    return match.displayName;
  }
  const segments = url.replace(/\/+$/, '').split('/');
  return decodeURIComponent(segments[segments.length - 1] ?? url);
}
