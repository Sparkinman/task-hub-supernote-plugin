import {EMPTY_CONFIG, type ServerConfig} from './settings';
import type {RemoteEvent, RemoteTask} from './tasks';

/**
 * The invented contents of the demo build.
 *
 * Everything is dated **relative to the moment it is read**, not baked in, so
 * the demo shows whatever month it is being recorded in and never goes stale.
 * That is the whole reason this is code rather than a file of fixtures.
 *
 * Pure: no SDK, no network, no storage. `DEMO` in `demoflag.ts` is what turns
 * it on.
 */

/** A local ISO date some days from today. */
function day(offset: number): string {
  const at = new Date();
  at.setHours(0, 0, 0, 0);
  at.setDate(at.getDate() + offset);
  return toIso(at);
}

/** The nth of the current month, clamped into it. */
function nth(n: number): string {
  const at = new Date();
  at.setHours(0, 0, 0, 0);
  const last = new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate();
  at.setDate(Math.min(n, last));
  return toIso(at);
}

function toIso(at: Date): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Epoch ms for a local date, optionally at a time. */
function moment(iso: string, hhmm?: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const [h, min] = hhmm ? hhmm.split(':').map(Number) : [0, 0];
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

const WORK = {url: 'demo:work', label: 'Work'};
const HOME = {url: 'demo:home', label: 'Home'};
const FAMILY = {url: 'demo:family', label: 'Family'};
const LIST = {url: 'demo:todo', label: 'To do'};
const PROJECTS = {url: 'demo:projects', label: 'Projects'};

interface EventOpts {
  start?: string;
  end?: string;
  cal?: {url: string; label: string};
  location?: string;
  description?: string;
  rrule?: string;
}

function event(uid: string, summary: string, iso: string, o: EventOpts = {}): RemoteEvent {
  const cal = o.cal ?? WORK;
  return {
    uid,
    summary,
    startDate: iso,
    startTime: o.start,
    endTime: o.end,
    startAt: moment(iso, o.start),
    allDay: !o.start,
    recurring: Boolean(o.rrule),
    rrule: o.rrule,
    location: o.location,
    description: o.description,
    calendarUrl: cal.url,
    calendarLabel: cal.label,
    href: '',
    raw: '',
  };
}

interface TaskOpts {
  due?: string;
  time?: string;
  list?: {url: string; label: string};
  priority?: number;
  description?: string;
  parentUid?: string;
  origin?: string;
  originName?: string;
  sourcePath?: string;
  sourcePage?: number;
}

function task(uid: string, summary: string, o: TaskOpts = {}): RemoteTask {
  const list = o.list ?? LIST;
  return {
    uid,
    summary,
    dueDate: o.due,
    dueTime: o.time,
    dueAt: o.due ? moment(o.due, o.time) : null,
    status: 'NEEDS-ACTION',
    completed: false,
    priority: o.priority,
    description: o.description,
    parentUid: o.parentUid,
    origin: o.origin,
    originName: o.originName,
    sourcePath: o.sourcePath,
    sourcePage: o.sourcePage,
    collectionUrl: list.url,
    collectionLabel: list.label,
    href: '',
    raw: '',
  };
}

/** A month's worth of calendar, built fresh each time it is asked for. */
export function demoEvents(): RemoteEvent[] {
  return [
    // Two series, so most weekdays carry something without listing forty rows.
    event('d-standup', 'Team stand-up', nth(1), {
      start: '09:15',
      end: '09:30',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    }),
    event('d-swim', 'Swim', nth(2), {
      start: '07:00',
      end: '08:00',
      cal: HOME,
      rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
    }),

    event('d-e1', 'Design review', nth(3), {start: '11:00', end: '12:30', location: 'Meeting room 2'}),
    event('d-e2', '1:1 with Sam', nth(4), {start: '14:00', end: '14:30'}),
    event('d-e3', 'Dentist', nth(5), {start: '08:30', end: '09:15', cal: HOME}),
    event('d-e4', 'Sprint planning', nth(8), {start: '10:00', end: '11:30'}),
    event('d-e5', 'Lunch with Ali', nth(9), {start: '12:30', end: '13:30', cal: HOME}),
    event('d-e6', 'Quarterly budget', nth(10), {
      start: '15:00',
      end: '16:30',
      description: 'Bring the Q3 figures.',
    }),
    event('d-e7', 'School play', nth(11), {start: '18:30', end: '20:00', cal: FAMILY}),
    event('d-e8', 'Client call — Northwind', nth(12), {start: '13:00', end: '14:00'}),
    event('d-e9', 'Car service', nth(15), {cal: HOME}),
    event('d-e10', 'Architecture workshop', nth(16), {start: '09:30', end: '16:00', location: 'Studio'}),
    event('d-e11', 'Retrospective', nth(17), {start: '16:00', end: '17:00'}),
    event('d-e12', "Mum's birthday", nth(18), {cal: FAMILY}),
    event('d-e13', 'Release 2.4', nth(19), {start: '10:00', end: '10:30'}),
    event('d-e14', 'Cinema', nth(19), {start: '19:45', end: '22:00', cal: HOME}),
    event('d-e15', 'Board meeting', nth(22), {start: '09:00', end: '12:00', location: 'Head office'}),
    event('d-e16', 'Supplier review', nth(23), {start: '14:00', end: '15:00'}),
    event('d-e17', 'Half term', nth(24), {cal: FAMILY}),
    event('d-e18', 'Conference — day one', nth(25), {}),
    event('d-e19', 'Conference — day two', nth(26), {}),
    event('d-e20', 'Dinner at the Anchor', nth(26), {start: '19:00', end: '21:30', cal: HOME}),
    event('d-e21', 'Roadmap sync', nth(29), {start: '11:00', end: '12:00'}),
    event('d-e22', 'Invoices due', nth(30), {}),

    // Around today, so the day view is never empty when it opens.
    event('d-t1', 'Morning triage', day(0), {start: '08:30', end: '09:00'}),
    event('d-t2', 'Write the release notes', day(0), {start: '10:00', end: '11:00'}),
    event('d-t3', 'Call with the printer', day(0), {start: '15:30', end: '16:00', cal: HOME}),
    event('d-t4', 'Interview — candidate B', day(1), {start: '11:00', end: '12:00'}),
    event('d-t5', 'Pick up the parcel', day(1), {cal: HOME}),
  ];
}

/** Tasks in every bucket, with steps, priorities and badges. */
export function demoTasks(): RemoteTask[] {
  return [
    task('d-od1', 'Send the signed contract back', {
      due: day(-6),
      priority: 1,
      description: 'Northwind. They have chased twice.',
    }),
    task('d-od2', 'Renew the domain', {due: day(-3), priority: 5}),
    task('d-od3', 'Reply to the accountant', {due: day(-1)}),

    task('d-td1', 'Draft the release notes', {due: day(0), time: '16:00', priority: 1}),
    task('d-td2', 'Book the meeting room for Thursday', {due: day(0)}),
    task('d-td3', 'Water the plants', {due: day(0), list: HOME}),

    task('d-wk1', 'Prepare the board pack', {due: day(2), list: PROJECTS, priority: 1}),
    task('d-wk2', 'Order more coffee', {due: day(3), list: HOME}),
    task('d-wk3', 'Review pull requests', {due: day(4), list: PROJECTS}),
    task('d-wk4', 'Confirm the hotel', {due: day(5)}),
    task('d-wk5', 'Back up the NAS', {due: day(6), priority: 9}),

    task('d-lt1', 'Renew the insurance', {due: day(18), priority: 5}),
    task('d-lt2', 'Plan the summer trip', {due: day(26), list: HOME}),
    task('d-lt3', 'Annual review paperwork', {due: day(40), list: PROJECTS}),

    task('d-nd1', "Read 'The Making of Prince of Persia'", {list: HOME}),
    task('d-nd2', 'Look into a standing desk'),
    task('d-nd3', 'Sort out the loft', {list: HOME}),

    // A family with steps, so the fold control has something to fold.
    task('d-parent', 'Launch the new site', {
      due: day(9),
      list: PROJECTS,
      priority: 1,
      description: 'Everything below has to land first.',
    }),
    task('d-s1', 'Finish the copy', {due: day(2), list: PROJECTS, parentUid: 'd-parent'}),
    task('d-s2', 'Compress the images', {due: day(4), list: PROJECTS, parentUid: 'd-parent'}),
    task('d-s3', 'Set up redirects', {due: day(6), list: PROJECTS, parentUid: 'd-parent'}),
    task('d-s4', 'Point the DNS', {due: day(8), list: PROJECTS, parentUid: 'd-parent'}),

    // Origin badges, so the list shows where things came from.
    task('d-or1', 'Chase the invoice', {due: day(1), origin: 'todoist', originName: 'Todoist'}),
    task('d-or2', 'Reply to Dad', {due: day(2), list: HOME, origin: 'google', originName: 'Google'}),
    task('d-or3', 'Buy stamps', {due: day(3), list: HOME, origin: 'supernote', originName: 'Supernote'}),
  ];
}

/**
 * The settings the demo build starts with.
 *
 * Note folders are under `Note/Demo/` so that creating one during a recording
 * cannot land anywhere near real notes, and the calendar is the opening tab
 * because that is where the demo has the most to show.
 */
export function demoConfig(): ServerConfig {
  return {
    ...EMPTY_CONFIG,
    // Non-empty so the views do not explain that no server is configured over
    // a screen that is full of events. Never contacted: the demo build makes
    // no request at all.
    collectionUrls: [LIST.url, HOME.url, PROJECTS.url],
    defaultCollectionUrl: LIST.url,
    calendarUrls: [WORK.url, HOME.url, FAMILY.url],
    dateFormat: 'iso',
    timeFormat: '12',
    startTab: 'calendar',
    markLabel: true,
    agendaStartHour: 8,
    agendaEndHour: 20,
    dailyNote: {...EMPTY_CONFIG.dailyNote, root: 'Note/Demo/Daily', dateHeading: true},
    weekNote: {...EMPTY_CONFIG.weekNote, root: 'Note/Demo/Weekly'},
    monthNote: {...EMPTY_CONFIG.monthNote, root: 'Note/Demo/Monthly'},
    quarterNote: {...EMPTY_CONFIG.quarterNote, root: 'Note/Demo/Quarterly'},
    yearNote: {...EMPTY_CONFIG.yearNote, root: 'Note/Demo/Yearly'},
    meetingNote: {...EMPTY_CONFIG.meetingNote, root: 'Note/Demo/Meetings'},
  };
}
