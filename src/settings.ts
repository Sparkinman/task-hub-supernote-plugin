import type {TaskCollection} from './discovery';
import {DEFAULT_DAILY_NOTE, type DailyNoteConfig} from './dailynote';
import {
  DEFAULT_MONTH_NOTE,
  DEFAULT_QUARTER_NOTE,
  DEFAULT_WEEK_NOTE,
  DEFAULT_YEAR_NOTE,
  type PeriodNoteConfig,
} from './periodnote';
import {DEFAULT_MEETING_NOTE, type MeetingLinks, type MeetingNoteConfig} from './meetingnote';
import type {DateFormat, TimeFormat} from './format';

/** The hub's two tabs, named here because the stored settings carry the choice. */
export type StartTab = 'tasks' | 'calendar';
import type {MarkStyle} from './markstyle';
import type {CalendarFeed} from './feeds';

export interface ServerConfig {
  /** Server origin, e.g. https://host:5232 — not a collection URL. */
  serverUrl: string;
  username: string;
  password: string;
  /**
   * Whose collections to browse, when that differs from the login.
   *
   * A credential scoped by a server-side rights file (Radicale supports this) logs
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
  /**
   * Read-only `.ics` subscriptions shown alongside them.
   *
   * The route to Google and Outlook, neither of which a CalDAV client can reach
   * any more — see `feeds.ts`. Needs no server of the user's own, which is the
   * point: somebody running Task Hub's own server does not need these.
   */
  feeds: CalendarFeed[];
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  /**
   * Which tab the hub opens on.
   *
   * Somebody who runs no CalDAV server has an empty Tasks tab and everything
   * they use on the Calendar one, and opening on the empty tab every time is a
   * tap they never wanted. Defaults to tasks, which is what the plugin has
   * always done, so nobody's opening changes under them.
   */
  startTab: StartTab;
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
  /** Which of the documented marker colours the wash uses. See `markstyle.ts`. */
  markShadeColor: string;
  /**
   * The hours the day view shows as slots, inclusive of the first and exclusive
   * of nothing — 7 and 19 means a row for every hour from 07:00 to 19:00.
   *
   * Anything outside them is still shown, listed under the grid, so narrowing
   * the window hides nothing. All-day items stay above the grid regardless.
   */
  agendaStartHour: number;
  agendaEndHour: number;
  /** Write "Task Hub Task" under the boxed handwriting. */
  markLabel: boolean;
  /** Where per-day notes live and how their folders are laid out. */
  dailyNote: DailyNoteConfig;
  /**
   * Notes for a whole week, month or quarter, each configured independently of
   * the daily note and of each other — somebody who keeps a weekly review in one
   * folder and a quarterly plan in another should not have to pick one scheme
   * for all of them. See `periodnote.ts`.
   */
  weekNote: PeriodNoteConfig;
  monthNote: PeriodNoteConfig;
  quarterNote: PeriodNoteConfig;
  yearNote: PeriodNoteConfig;
  /** Where per-event notes live. Device-only; never written back to CalDAV. */
  meetingNote: MeetingNoteConfig;
  /** event UID -> note path. Keeps note filenames free of encoded ids. */
  meetingLinks: MeetingLinks;
  /**
   * The day the calendar was showing when the plugin last handed over to a note.
   *
   * A link inside a note cannot open a plugin — the SDK's link types are pages,
   * files, documents, images and URLs, and none of them is "come back here". So
   * the nearest thing to a back button is for the plugin to reopen on the day it
   * was left, which is what this remembers. Empty means "start on today".
   */
  lastDay: string;
}

export const EMPTY_CONFIG: ServerConfig = {
  serverUrl: '',
  username: '',
  password: '',
  owner: '',
  collectionUrls: [],
  defaultCollectionUrl: '',
  calendarUrls: [],
  feeds: [],
  dateFormat: 'iso',
  startTab: 'tasks',
  timeFormat: '24',
  markStyle: 'dashed',
  markShade: false,
  markShadeColor: 'light',
  agendaStartHour: 7,
  agendaEndHour: 21,
  markLabel: false,
  dailyNote: {...DEFAULT_DAILY_NOTE},
  weekNote: {...DEFAULT_WEEK_NOTE},
  monthNote: {...DEFAULT_MONTH_NOTE},
  quarterNote: {...DEFAULT_QUARTER_NOTE},
  yearNote: {...DEFAULT_YEAR_NOTE},
  meetingNote: {...DEFAULT_MEETING_NOTE},
  meetingLinks: {},
  lastDay: '',
};

/**
 * Anything at all to draw on the Calendar tab.
 *
 * Subscriptions count. Somebody whose only calendar is a Google `.ics` feed has
 * no CalDAV collection ticked, and counting only those told them their calendar
 * was unconfigured while their events were sitting right there.
 */
export function hasCalendars(config: ServerConfig): boolean {
  return config.calendarUrls.length > 0 || (config.feeds?.length ?? 0) > 0;
}

/** Toggle a VEVENT collection in the watched calendar set. */
export function toggleCalendar(config: ServerConfig, url: string): ServerConfig {
  // Compared loosely, not by string equality: a URL that reached the settings
  // by a different route may differ only by a trailing slash, and an untick
  // that silently failed to match is how a dead collection became unremovable.
  return {
    ...config,
    calendarUrls: config.calendarUrls.some(u => sameCollection(u, url))
      ? config.calendarUrls.filter(u => !sameCollection(u, url))
      : [...config.calendarUrls, url],
  };
}

/** Enough to attempt discovery. */
export function canDiscover(config: ServerConfig): boolean {
  return /^https?:\/\//i.test(config.serverUrl.trim()) && collectionsOwner(config).length > 0;
}

/** The path segment collections live under: the owner if set, else the login. */
export function collectionsOwner(config: ServerConfig): string {
  return (config.owner.trim() || config.username.trim()).trim();
}

/** Enough to read tasks. */
export function hasCollections(config: ServerConfig): boolean {
  return config.collectionUrls.length > 0;
}

/** Enough to save a new task. */
export function isConfigured(config: ServerConfig): boolean {
  return /^https?:\/\//i.test(config.defaultCollectionUrl.trim());
}

/**
 * The form a collection URL is compared in.
 *
 * The listing code strips a trailing slash before it asks the server, so the
 * URL a "collection has gone" report carries need not match the one in the
 * settings character for character. Comparing raw strings therefore silently
 * failed to find the very collection the user was trying to get rid of.
 */
export function sameCollection(a: string, b: string): boolean {
  const tidy = (u: string) => u.trim().replace(/\/+$/, '');
  return tidy(a) === tidy(b);
}

/**
 * Drop a saved collection that merely contains the others.
 *
 * The calendar home is not a collection, but a `Depth: 1` PROPFIND describes
 * the collection it was sent to as well as its members, so earlier builds
 * offered it as a task list named after the last segment of its own URL — an
 * account name like `paul` sitting beside `paul-tasks`. Excluding it from
 * discovery stops it being offered again, but settings are durable and
 * independent of discovery: a tick saved before that fix survives it.
 *
 * This is the other half. A collection whose URL is a strict ancestor of
 * another saved one is a container, not a calendar — CalDAV servers put
 * calendars beside each other under the home, never inside one another — so it
 * can be dropped without asking and without a network round trip.
 *
 * Deliberately conservative: it only fires when there is a saved descendant to
 * prove the relationship. A home saved on its own with nothing under it is left
 * alone, because nothing here can tell it apart from an unusually-laid-out
 * server, and silently deleting somebody's only task list would be far worse
 * than showing one odd row.
 */
export function pruneContainers(config: ServerConfig): ServerConfig {
  const tidy = (u: string) => u.trim().replace(/\/+$/, '');
  const contains = (parent: string, child: string) =>
    parent !== child && child.startsWith(`${parent}/`);

  const prune = (urls: string[]) => {
    const tidied = urls.map(tidy);
    return urls.filter((_, i) => !tidied.some(other => contains(tidied[i], other)));
  };

  const collectionUrls = prune(config.collectionUrls);
  const calendarUrls = prune(config.calendarUrls);
  const target = collectionUrls.some(u => sameCollection(u, config.defaultCollectionUrl))
    ? config.defaultCollectionUrl
    : collectionUrls[0] ?? '';
  return {...config, collectionUrls, calendarUrls, defaultCollectionUrl: target};
}

/**
 * Forget collections that are no longer on the server.
 *
 * Removing them from the settings form is the only way to stop the warning
 * about them, and until this existed there was no way to do it at all: the
 * ticklists in Settings are built from what discovery finds, so a collection
 * deleted on the server has no row and therefore no box to untick. The advice
 * the warning gave — "tap Discover, and untick it" — could not be followed.
 *
 * The default task list follows the removal rather than being left dangling,
 * exactly as `toggleCollection` does when the same list is unticked by hand.
 */
export function forgetCollections(config: ServerConfig, urls: string[]): ServerConfig {
  const gone = (url: string) => urls.some(u => sameCollection(u, url));
  const collectionUrls = config.collectionUrls.filter(u => !gone(u));
  const calendarUrls = config.calendarUrls.filter(u => !gone(u));
  const target = collectionUrls.some(u => sameCollection(u, config.defaultCollectionUrl))
    ? config.defaultCollectionUrl
    : collectionUrls[0] ?? '';
  return {...config, collectionUrls, calendarUrls, defaultCollectionUrl: target};
}

/**
 * Toggle a collection in the watched set.
 *
 * Deselecting the collection that new tasks go to would leave the target
 * dangling, so the target follows the selection: it falls back to whatever is
 * still selected, and a first selection claims it automatically.
 */
export function toggleCollection(config: ServerConfig, url: string): ServerConfig {
  const selected = config.collectionUrls.some(u => sameCollection(u, url))
    ? config.collectionUrls.filter(u => !sameCollection(u, url))
    : [...config.collectionUrls, url];

  let target = config.defaultCollectionUrl;
  if (!selected.some(u => sameCollection(u, target))) {
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
let current: ServerConfig = {...EMPTY_CONFIG};
let discovered: TaskCollection[] = [];

export function getConfig(): ServerConfig {
  return {
    ...current,
    collectionUrls: [...current.collectionUrls],
    calendarUrls: [...current.calendarUrls],
    feeds: current.feeds.map(f => ({...f})),
    dailyNote: {...current.dailyNote},
    weekNote: {...current.weekNote},
    monthNote: {...current.monthNote},
    quarterNote: {...current.quarterNote},
    yearNote: {...current.yearNote},
    meetingNote: {...current.meetingNote},
    meetingLinks: {...current.meetingLinks},
  };
}

export function setConfig(next: ServerConfig): void {
  current = {
    ...next,
    collectionUrls: [...next.collectionUrls],
    calendarUrls: [...next.calendarUrls],
    feeds: next.feeds.map(f => ({...f})),
    dailyNote: {...next.dailyNote},
    weekNote: {...next.weekNote},
    monthNote: {...next.monthNote},
    quarterNote: {...next.quarterNote},
    yearNote: {...next.yearNote},
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
  return lastSegment(url);
}

function lastSegment(url: string): string {
  const segments = url.replace(/\/+$/, '').split('/');
  const last = segments[segments.length - 1] ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * The path to show beside a collection's name, or '' when the name is enough.
 *
 * A server that supplies no `displayname` leaves discovery naming the
 * collection after the last segment of its own URL, which can be something as
 * uninformative as an account name or a UUID — a row labelled `paul` says
 * nothing about where saving to it would put anything. The same is true when
 * two watched collections happen to share a name.
 *
 * Shown only in those two cases. A list the server has properly named needs no
 * URL beside it, and putting one there on every row would turn a short pick
 * list into a wall of addresses.
 */
export function collectionHint(url: string, among: string[]): string {
  const name = collectionName(url);
  const named = discovered.some(c => c.url === url && c.displayName !== lastSegment(c.url));
  const duplicated =
    among.filter(other => other !== url && collectionName(other) === name).length > 0;
  if (named && !duplicated) {
    return '';
  }
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
}
