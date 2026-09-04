/**
 * Sample data for the demo build.
 *
 * Exists so someone with no Radicale server — a reviewer, or anyone deciding
 * whether the plugin is worth setting up — can open Task Hub and actually use
 * it: complete a task, filter and sort, page through the calendar, see how a
 * multi-day task and a repeating meeting are drawn.
 *
 * Two rules shape everything here:
 *
 *   1. Every date is derived from "today" at call time, never hard-coded. A
 *      demo whose tasks are all months overdue looks broken rather than
 *      illustrative, and this build may be opened long after it was made.
 *   2. Nothing in this file is ever written anywhere. The demo blocks writes at
 *      the one place they all pass through, so these objects only ever go on
 *      screen. Their URLs are deliberately unreachable.
 *
 * The set is chosen to exercise the display paths that empty screens hide:
 * overdue and completed tasks, a task with no due date, a multi-day span, an
 * all-day event, a repeating meeting, a task captured from a note, and both
 * kinds of origin badge.
 */

import type {TaskCollection} from './discovery';
import type {RemoteEvent, RemoteTask} from './tasks';
import {EMPTY_CONFIG, type RadicaleConfig} from './settings';
import {toDateInput} from './ical';
import {dailyNotePath} from './dailynote';

/** Unreachable by construction: nothing should ever try, but if it did, it fails. */
const HOST = 'https://demo.invalid/tasks';
const WORK = `${HOST}/work`;
const PERSONAL = `${HOST}/personal`;
const CALENDAR = `${HOST}/calendar`;

/**
 * Every visible label says Demo.
 *
 * Both plugins can be installed at once, and a list called "Work" full of
 * invented tasks is indistinguishable from a real one at a glance — especially
 * in a screenshot, or on the device a week later.
 */
const DEMO_DAILY_ROOT = 'Note/Task Hub Demo/Daily';
const DEMO_MEETING_ROOT = 'Note/Task Hub Demo/Meetings';

const WORK_LABEL = 'Demo Work';
const PERSONAL_LABEL = 'Demo Personal';
const CALENDAR_LABEL = 'Demo Calendar';

export const DEMO_COLLECTIONS: TaskCollection[] = [
  {url: WORK, displayName: WORK_LABEL, components: ['VTODO']},
  {url: PERSONAL, displayName: PERSONAL_LABEL, components: ['VTODO']},
  {url: CALENDAR, displayName: CALENDAR_LABEL, components: ['VEVENT']},
];

/**
 * A configuration that looks like a working setup, minus the credentials.
 *
 * Username and password stay empty: showing a fake login invites someone to
 * believe it is real, and no code path in the demo build reads them.
 */
export const DEMO_CONFIG: RadicaleConfig = {
  ...EMPTY_CONFIG,
  serverUrl: HOST,
  collectionUrls: [WORK, PERSONAL],
  defaultCollectionUrl: WORK,
  calendarUrls: [CALENDAR],
  // Its own folder, so the demo's note paths can never be mistaken for — or
  // collide with — a real installation's.
  dailyNote: {...EMPTY_CONFIG.dailyNote, root: DEMO_DAILY_ROOT},
  meetingNote: {...EMPTY_CONFIG.meetingNote, root: DEMO_MEETING_ROOT},
  // Two events already have a note, so both halves of the feature are reachable:
  // tapping these opens the existing note, tapping any other offers to make one.
  meetingLinks: {
    'demo-e1': `${DEMO_MEETING_ROOT}/Team standup.note`,
    'demo-e3': `${DEMO_MEETING_ROOT}/Design review.note`,
  },
};

/** The notes those links point at, as the note scan would report them. */
export function demoMeetingFiles(): string[] {
  return Object.values(DEMO_CONFIG.meetingLinks);
}

/** Midnight on the day `offset` days from `today`, so nothing drifts by an hour. */
function dayFrom(today: Date, offset: number): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return d;
}

function iso(today: Date, offset: number): string {
  return toDateInput(dayFrom(today, offset));
}

function at(today: Date, offset: number, hh = 0, mm = 0): number {
  const d = dayFrom(today, offset);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

interface TaskSeed {
  uid: string;
  summary: string;
  /** Days from today; omitted for a task with no due date at all. */
  due?: number;
  dueTime?: string;
  /** Days from today, for a task that runs across a range. */
  start?: number;
  description?: string;
  completed?: boolean;
  origin?: string;
  originName?: string;
  sourcePath?: string;
  sourcePage?: number;
  list: 'work' | 'personal';
}

const TASK_SEEDS: TaskSeed[] = [
  {
    uid: 'demo-1',
    summary: 'Send the quarterly report',
    due: -2,
    list: 'work',
    origin: 'todoist',
    description: 'Chase Priya for the regional numbers first.',
  },
  {uid: 'demo-2', summary: 'Renew the parking permit', due: 0, dueTime: '17:00', list: 'personal'},
  {
    uid: 'demo-3',
    summary: 'Draft the onboarding checklist',
    due: 1,
    list: 'work',
    origin: 'supernote',
    originName: 'Supernote',
    // Shows the link-back chip. The demo blocks the jump rather than opening it.
    sourcePath: '/storage/emulated/0/Note/Meeting notes.note',
    sourcePage: 3,
  },
  {
    uid: 'demo-4',
    summary: 'Prepare conference talk',
    start: 2,
    due: 6,
    list: 'work',
    origin: 'google',
    description: 'Slides, demo, and a backup recording.',
  },
  {uid: 'demo-5', summary: 'Book the dentist', due: 4, list: 'personal'},
  {uid: 'demo-6', summary: 'Read the new Radicale release notes', list: 'personal'},
  {uid: 'demo-7', summary: 'Replace the kitchen bulb', due: 9, list: 'personal', origin: 'obsidian'},
  {uid: 'demo-8', summary: 'File expenses', due: -6, completed: true, list: 'work'},
  {
    uid: 'demo-9',
    summary: 'Confirm the venue booking',
    due: -1,
    completed: true,
    list: 'personal',
    origin: 'ticktick',
  },
];

/** The sample task list, dated relative to `today`. */
export function demoTasks(today: Date = new Date()): RemoteTask[] {
  return TASK_SEEDS.map(seed => {
    const url = seed.list === 'work' ? WORK : PERSONAL;
    const hasDue = seed.due !== undefined;
    return {
      uid: seed.uid,
      summary: seed.summary,
      description: seed.description,
      dueDate: hasDue ? iso(today, seed.due as number) : undefined,
      dueTime: seed.dueTime,
      dueAt: hasDue
        ? at(today, seed.due as number, ...timeParts(seed.dueTime))
        : null,
      startDate: seed.start === undefined ? undefined : iso(today, seed.start),
      startAt: seed.start === undefined ? null : at(today, seed.start),
      status: seed.completed ? 'COMPLETED' : 'NEEDS-ACTION',
      completed: !!seed.completed,
      sourcePath: seed.sourcePath,
      sourcePage: seed.sourcePage,
      origin: seed.origin,
      originName: seed.originName,
      href: `${url}/${seed.uid}.ics`,
      etag: `"${seed.uid}"`,
      raw: '',
      collectionUrl: url,
      collectionLabel: seed.list === 'work' ? WORK_LABEL : PERSONAL_LABEL,
    };
  });
}

function timeParts(time?: string): [number, number] {
  if (!time) {
    return [0, 0];
  }
  const [h, m] = time.split(':');
  return [Number(h) || 0, Number(m) || 0];
}

interface EventSeed {
  uid: string;
  summary: string;
  /** Days from today. */
  day: number;
  start?: string;
  end?: string;
  location?: string;
  recurring?: boolean;
  origin?: string;
  description?: string;
}

const EVENT_SEEDS: EventSeed[] = [
  {
    uid: 'demo-e1',
    summary: 'Team standup',
    day: 0,
    start: '09:30',
    end: '09:45',
    recurring: true,
    origin: 'google',
    location: 'Meeting room 2',
  },
  {uid: 'demo-e2', summary: 'One-to-one with Sam', day: 0, start: '14:00', end: '14:30'},
  {uid: 'demo-e3', summary: 'Design review', day: 1, start: '11:00', end: '12:00', origin: 'google'},
  {uid: 'demo-e4', summary: 'Dentist', day: 4, start: '08:15', end: '09:00'},
  {uid: 'demo-e5', summary: 'Company offsite', day: 5},
  {
    uid: 'demo-e6',
    summary: 'Sprint planning',
    day: 7,
    start: '10:00',
    end: '11:30',
    recurring: true,
  },
  {uid: 'demo-e7', summary: "Anna's birthday", day: 12},
  {uid: 'demo-e8', summary: 'Quarterly review', day: -3, start: '15:00', end: '16:00'},
];

/** The sample calendar, dated relative to `today`. */
export function demoEvents(today: Date = new Date()): RemoteEvent[] {
  return EVENT_SEEDS.map(seed => {
    const [h, m] = timeParts(seed.start);
    return {
      uid: seed.uid,
      summary: seed.summary,
      description: seed.description,
      location: seed.location,
      startDate: iso(today, seed.day),
      startTime: seed.start,
      endTime: seed.end,
      startAt: at(today, seed.day, h, m),
      allDay: !seed.start,
      recurring: !!seed.recurring,
      origin: seed.origin,
      calendarLabel: CALENDAR_LABEL,
      calendarUrl: CALENDAR,
      href: `${CALENDAR}/${seed.uid}.ics`,
      etag: `"${seed.uid}"`,
      raw: '',
    };
  }).sort((a, b) => a.startAt - b.startAt);
}

/**
 * Message shown when a demo build is asked to change something.
 *
 * Names the action so it does not read as a failure, and says what to do to get
 * the real thing.
 */
/**
 * Days that already have a daily note, so the month grid shows its N marker.
 *
 * Returned as note paths rather than dates because that is what the real scan
 * produces, and the same `daysWithNotes` matching then runs over both.
 */
export function demoNoteFiles(today: Date = new Date()): string[] {
  // Yesterday, today and two days out have notes; every other day does not, so
  // both "open the note" and "create a note" are reachable from the calendar.
  return [-1, 0, 2]
    .map(offset => dailyNotePath(DEMO_CONFIG.dailyNote, iso(today, offset), 'iso'))
    .filter(path => path.length > 0);
}

export const DEMO_BLOCKED =
  'Demo mode — nothing was changed. Install the full Task Hub and add your ' +
  'Radicale server to sync for real.';

export const DEMO_BANNER = 'TASK HUB DEMO — sample data, not synced to any server';
