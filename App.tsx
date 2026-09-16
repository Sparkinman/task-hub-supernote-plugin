/**
 * Task Hub — plugin UI.
 *
 * Screens:
 *   save     — review and file the task just captured from a lasso
 *   hub      — Tasks / Calendar tabs over the watched collections
 *   settings — server, list and calendar selection, display preferences, guide
 *
 * The lasso button enters at `save`, the toolbar button opens `hub` directly
 * without needing a selection, and the config button enters at `settings`.
 *
 * Every write goes through `ask()`: confirm, push immediately, report success,
 * then reload everything. That one path means no screen can drift from the
 * server without saying so.
 *
 * @format
 */

/* eslint-disable no-void -- void marks deliberately un-awaited promises in handlers */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Dimensions,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  View,
  findNodeHandle,
  type KeyboardEvent,
} from 'react-native';

/**
 * The panel's height right now, read rather than assumed.
 *
 * Task Hub runs on every Supernote generation — A5X, A6X, A5X2, A6X2 and Manta —
 * and those differ in both pixel size and aspect. Anything that needs a share of
 * the screen asks for it here instead of carrying a number that happened to look
 * right on one device.
 */
function windowHeight(): number {
  return Dimensions.get('window').height || 0;
}
import {PluginManager} from 'sn-plugin-lib';

import {eventsOnDay, monthMarks, shiftDays, tasksOnDay} from './src/agenda';
import {addSteps, discoverCollections, newUid, putTask, saidAboutSteps} from './src/caldav';
import {APP_NAME} from './src/components/Brand';
import {
  Button,
  CheckRow,
  Choice,
  Confirm,
  CalendarIcon,
  Field,
  Fold,
  FolderIcon,
  Header,
  LoadingLine,
  Notice,
  Section,
  StatusLine,
  Tabs,
  TaskRow,
  SCREEN_HEIGHT,
  UI_SCALE,
  styles,
  type Status,
} from './src/components/common';
import {DateTimePicker} from './src/components/DateTimePicker';
import {DayView} from './src/components/DayView';
import {MonthView} from './src/components/MonthView';
import {QuarterView} from './src/components/QuarterView';
import {YearView} from './src/components/YearView';
import {WeekView, shiftWeek} from './src/components/WeekView';
import {acceptsEvents, acceptsTasks, type TaskCollection} from './src/discovery';
import {
  DATE_FORMATS,
  endForStart,
  endsBeforeStart,
  formatDate,
  formatTime,
  TIME_FORMATS,
  type DateFormat,
  type TimeFormat,
} from './src/format';
import {
  DEFAULT_SORT,
  DUE_BUCKETS,
  SORT_KEYS,
  dueBucket,
  searchTasks,
  sortTasks,
  toDateInput,
  type SortKey,
} from './src/ical';
import {arrange, visible} from './src/subtasks';
import {PRIORITY_BANDS, bandOf, valueOf, type PriorityBand} from './src/priority';
import {REPEAT_OPTIONS, repeatKey, repeatLabel, ruleFor, type RepeatKey} from './src/recurrence';
import {readLassoAsText, readSourceRef, type SourceRef} from './src/lasso';
import {TASK_LABEL, markPage, removePageMark} from './src/pagemark';
import {MARK_STYLES, SHADE_COLORS, type MarkStyle} from './src/markstyle';
import {PermissionDeniedError} from './src/permissions';
import {
  EMPTY_CONFIG,
  canDiscover,
  collectionName,
  collectionHint,
  getCollections,
  getConfig,
  hasCalendars,
  hasCollections,
  setCollections,
  setConfig,
  toggleCalendar,
  forgetCollections,
  pruneContainers,
  sameCollection,
  toggleCollection,
  type ServerConfig,
  type StartTab,
} from './src/settings';
import {
  completeTask,
  createEvent,
  editEvent,
  editTask,
  listEvents,
  listFeeds,
  listTasks,
  missingMessage,
  type MissingCollection,
  type RemoteEvent,
  type RemoteTask,
} from './src/tasks';
import {
  loadSettings,
  readNamed,
  listFilesHere,
  saveSettings,
  settingsLocation,
  storageAvailable,
  wipeSettings,
  writeNamed,
} from './src/storage';
import {CACHE_FILE, decodeCache, encodeCache} from './src/cache';
import {expandEvents} from './src/expand';
import {writeDateHeading} from './src/dateheading';
import {
  dayBackground,
  monthBackground,
  weekBackground,
  type Background,
  type DayAgenda,
  type PageSize,
  WEEKDAYS,
} from './src/background';
import {writeBackground} from './src/backgrounddraw';
import {
  covers,
  defaultWindow,
  gap,
  mergeFetched,
  viewRange,
  widen,
  type DateRange,
} from './src/eventwindow';
import {LAYOUT_PRESETS, dailyNotePath, daysWithNotes} from './src/dailynote';
import {
  PERIOD_LAYOUT_PRESETS,
  hasPeriodNote,
  periodLabel,
  periodNotePath,
  periodStart,
  type Period,
  SHARED_TREE_LAYOUTS,
  SHARED_TREE_ROOT,
} from './src/periodnote';
import {
  createDailyNote,
  createMeetingNote,
  deviceName,
  findExistingNotes,
  findPeriodNotes,
  createPeriodNote,
  openPeriodNote,
  findMeetingNotes,
  listAllTemplates,
  absoluteNotePath,
  openDailyNote,
  openMeetingNote,
  openFileAt,
  openNote,
  openNoteAt,
  type NoteTemplate,
} from './src/notes';
import {eventsWithNotes} from './src/meetingnote';
import {
  FEED_URL_MESSAGES,
  addFeed,
  defaultFeedName,
  mergeFeeds,
  normaliseFeedUrl,
  parseFeedList,
  pickFeedListFile,
  removeFeed,
} from './src/feeds';
import {forgetFeed} from './src/feedfetch';
import {APP_BUILD, APP_VERSION} from './src/version';
import {
  DEFAULT_SN_CONFIG,
  snDaysLeft,
  snListsWithUnfiled,
  snOpenCounts,
  snReady,
  snUnfiledNote,
  type SnList,
} from './src/sncloud';
import {
  SN_CAPPED,
  SN_EXPIRED,
  beginSignIn,
  finishSignIn,
  listSnLists,
  readSnTasks,
} from './src/snclient';
import {
  asRemoteTasks,
  isSnCollection,
  isSnTask,
  isSnUnfiled,
  snCollectionUrl,
} from './src/sntasks';
import {buildIndex, clearIndex, ensurePreview} from './src/noteindex';
import {
  countStarredPages,
  keywordHits,
  starHits,
  type IndexedNote,
  type SearchRoot,
} from './src/notesearch';
import {FindView, type FindSummary} from './src/components/FindView';
import {groupRows} from './src/subtasks';
import {TemplatePicker, TemplateSheet} from './src/components/TemplatePicker';
import {FolderPicker} from './src/components/FolderPicker';
import {MiniCalendar} from './src/components/MiniCalendar';
import {weekOf} from './src/components/WeekView';
import {monthGrid} from './src/calendar';

/** Where a list of calendar subscriptions is read from, inside Document/TaskHub. */
const FEED_LIST_FILE = 'calendars.txt';

const LASSO_BUTTON_ID = 200;
const TOOLBAR_BUTTON_ID = 100;

type Screen = 'idle' | 'save' | 'hub' | 'settings';
type Tab = 'tasks' | 'calendar' | 'find';

/**
 * Which of the six notes a chooser is acting on.
 *
 * The folder browser and the template grid are both mounted at the root of the
 * window rather than beside the settings row that opens them, so the row can
 * only say which note it belongs to; the root looks the rest up from the config.
 */
type NoteKind = 'daily' | 'week' | 'month' | 'quarter' | 'year' | 'meeting';

/** The config field holding each note's settings. */
const NOTE_CONFIG_KEY = {
  daily: 'dailyNote',
  week: 'weekNote',
  month: 'monthNote',
  quarter: 'quarterNote',
  year: 'yearNote',
  meeting: 'meetingNote',
} as const satisfies Record<NoteKind, keyof ServerConfig>;

/** What each note is called in a sheet's title. */
const NOTE_LABEL: Record<NoteKind, string> = {
  daily: 'Daily note',
  week: 'Weekly note',
  month: 'Monthly note',
  quarter: 'Quarterly note',
  year: 'Yearly note',
  meeting: 'Meeting note',
};
type CalView = 'year' | 'quarter' | 'month' | 'week' | 'day';

interface TaskDraftState {
  summary: string;
  description: string;
  dueDate: string;
  dueTime: string;
  /**
   * The band the user picked, not the RFC 5545 number. The number is worked out
   * on save, so a task edited without touching importance keeps whatever value
   * another client wrote inside the same band.
   */
  priority: PriorityBand;
  /**
   * The repeat the user picked. `custom` means the stored rule is one this
   * plugin's menu cannot name, and saving must leave it exactly as it is.
   */
  repeat: RepeatKey;
  /**
   * Steps to ADD, one per line. Never pre-filled with the steps a task already
   * has — the same contract as the web page's box, which is what makes it safe
   * to save the same form twice. See `addSteps`.
   */
  steps: string;
  /**
   * A date for the steps being added, when it should differ from the task's own.
   * Empty means "the same day as the task", which is what most steps want.
   */
  stepsDate: string;
  stepsTime: string;
}

interface EventDraftState {
  summary: string;
  description: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Same three-state repeat as a task. `custom` is shown but never rewritten. */
  repeat: RepeatKey;
}

/**
 * The hours offered for the agenda window.
 *
 * Every third hour rather than all 24: the picker is a row of chips on a narrow
 * panel, and nobody sets their working day to start at 04:00 rather than 03:00.
 */
const AGENDA_HOURS = [0, 3, 6, 7, 8, 9, 12, 15, 17, 18, 19, 21, 23];

/** An hour as the user writes times, e.g. "7am" or "07:00". */
function hourLabel(hour: number, timeFormat: TimeFormat): string {
  return formatTime(`${String(hour).padStart(2, '0')}:00`, timeFormat);
}

const EMPTY_TASK: TaskDraftState = {
  summary: '',
  description: '',
  dueDate: '',
  dueTime: '',
  priority: 'none',
  repeat: '',
  steps: '',
  stepsDate: '',
  stepsTime: '',
};

// A fetch that was not made now resolves to null rather than to an empty
// result, so a scoped reload can tell "nothing changed here" from "this list is
// genuinely empty" and leave the existing state alone.
const emptyEvent = (day: string): EventDraftState => ({
  summary: '',
  description: '',
  location: '',
  date: day,
  startTime: '',
  endTime: '',
  repeat: '',
});

/** A confirmed write: runs, then reports this message on success. */
interface Ask {
  title: string;
  /**
   * What this write changed, so the reload afterwards fetches only that. A
   * task edit does not change which days have notes.
   */
  reload?: 'all' | 'tasks' | 'events' | 'notes';
  body?: string;
  label: string;
  run: () => Promise<string>;
  /**
   * Dismiss the plugin once the success message has been seen.
   *
   * Capturing from a lasso is a one-shot errand — the user came from a note and
   * wants to go back to it, not linger on a form ready for another task.
   */
  closeAfter?: boolean;
}

function describe(err: unknown): string {
  if (err instanceof PermissionDeniedError) {
    return `Network permission denied — ${APP_NAME} cannot reach your server.`;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('idle');
  const [tab, setTab] = useState<Tab>('tasks');
  const [calView, setCalViewRaw] = useState<CalView>('month');
  const [viewHistory, setViewHistory] = useState<CalView[]>([]);
  /**
   * Mirrors of the two above, so the switch handlers can read the current value
   * without nesting one state update inside another and without taking a
   * dependency that would make them a new function on every view change — the
   * calendar grids are memoised on those handlers holding still.
   */
  const calViewRef = useRef<CalView>('month');
  const viewHistoryRef = useRef<CalView[]>([]);
  calViewRef.current = calView;
  viewHistoryRef.current = viewHistory;
  const [status, setStatus] = useState<Status>(null);
  const [config, setLocalConfig] = useState<ServerConfig>(getConfig);
  const [collections, setLocalCollections] = useState<TaskCollection[]>(
    getCollections,
  );

  const [draft, setDraft] = useState<TaskDraftState>(EMPTY_TASK);
  const [targets, setTargets] = useState<string[]>([]);
  const [source, setSource] = useState<SourceRef | undefined>(undefined);
  const [tasks, setTasks] = useState<RemoteTask[]>([]);
  const [events, setEvents] = useState<RemoteEvent[]>([]);
  /**
   * The same two lists, readable without waiting for a render.
   *
   * The cache is written at the end of a fetch, which may have refreshed only
   * one of the two — the other has to come from somewhere, and reading state
   * there would read the value from before the setState.
   */
  const tasksRef = useRef<RemoteTask[]>([]);
  const eventsRef = useRef<RemoteEvent[]>([]);
  /**
   * How much of the calendar has been fetched.
   *
   * Reset to the default on every opening rather than carried over: a session
   * that wandered back to 2019 widened the window to reach it, and starting the
   * next opening with that width would undo the whole point of having one. A
   * ref as well as state, because a fetch started in the same tick as the
   * navigation that widened it has to see the new value.
   */
  const [eventWindow, setEventWindow] = useState<DateRange>(() =>
    defaultWindow(toDateInput(new Date())),
  );
  const eventWindowRef = useRef(eventWindow);
  const setWindow = useCallback((next: DateRange) => {
    eventWindowRef.current = next;
    setEventWindow(next);
  }, []);
  const [missing, setMissing] = useState<MissingCollection[]>([]);
  const [showDone, setShowDone] = useState(false);
  /**
   * Which tasks have had their steps opened. Folded is the resting state, so
   * this holds what was opened rather than what was closed — a task that gains
   * a step should not appear expanded because nobody had folded it yet.
   */
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  /**
   * Whether the month view's task list is open. Folded by default: the grid is
   * the point of that screen, and a day's tasks are a detail below it.
   */
  const toggleSteps = useCallback((uid: string) => {
    setOpenSteps(previous => {
      const next = new Set(previous);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  }, []);
  const [showHelp, setShowHelp] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * How many fetches are in flight.
   *
   * A count rather than the flag alone: the opening refresh and a widening
   * fetch for a month the user has paged to can run at the same time, and
   * whichever finished first would otherwise clear the loading line while the
   * other was still working — the plugin would look finished and then keep
   * changing under the user.
   */
  const busyCount = useRef(0);
  const startWork = useCallback(() => {
    busyCount.current += 1;
    setLoading(true);
  }, []);
  const endWork = useCallback(() => {
    busyCount.current = Math.max(0, busyCount.current - 1);
    setLoading(busyCount.current > 0);
  }, []);
  const [storePath, setStorePath] = useState<string | null>(null);
  /** The device's own name, shown in settings beside how the layout is scaled. */
  const [device, setDevice] = useState<string | null>(null);
  const [noteFiles, setNoteFiles] = useState<string[]>([]);
  /**
   * Note paths under each period's own root. Separate from `noteFiles` because
   * each period has its own configured folder, and a weekly note living beside
   * the daily ones is a configuration, not an assumption.
   */
  const [periodFiles, setPeriodFiles] = useState<
    Record<'week' | 'month' | 'quarter' | 'year', string[]>
  >({
    week: [],
    month: [],
    quarter: [],
    year: [],
  });
  const [meetingFiles, setMeetingFiles] = useState<string[]>([]);
  const [pickingFolder, setPickingFolder] = useState<NoteKind | null>(null);
  /**
   * Which note's template is being chosen, or null when the sheet is shut.
   *
   * Held here rather than inside the picker so the grid can be mounted at the
   * root of the window — see TemplateSheet. The settings form only says which
   * note the row belongs to; everything else is resolved from the config here.
   */
  const [pickingTemplate, setPickingTemplate] = useState<NoteKind | null>(null);
  const [pickingDate, setPickingDate] = useState<'day' | 'week' | null>(null);
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [restored, setRestored] = useState(false);
  /**
   * Whether the user has edited the settings form since it was last seeded.
   *
   * The restore below reads the settings file asynchronously, and on a device
   * that read is slow enough to finish *after* somebody has opened settings and
   * started typing. Applying it then wipes what they entered, which looks like
   * the fields clearing themselves. A ref rather than state: it must be readable
   * from inside that async callback without re-running the effect.
   */
  const settingsEditedRef = useRef(false);

  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [query, setQuery] = useState('');

  const [taskForm, setTaskForm] = useState<TaskDraftState | null>(null);
  /**
   * Whether the date picker for the steps being added is showing, and on which
   * form. Kept out of the draft state because it is about what is on screen,
   * not about the task being written.
   */
  const [stepsDateOpen, setStepsDateOpen] = useState<'task' | 'capture' | null>(null);
  const [editingTask, setEditingTask] = useState<RemoteTask | null>(null);
  const [taskTargets, setTaskTargets] = useState<string[]>([]);

  const [eventForm, setEventForm] = useState<EventDraftState | null>(null);
  /**
   * Whether the lasso is being captured as a task or as an event.
   *
   * One lasso button, two things it can become — rather than a second button on
   * the note app's lasso toolbar, which is shared real estate and already
   * crowded. The recognised handwriting, the source page it came from and the
   * page mark left behind are identical either way; only where it is saved and
   * which fields are asked for differ.
   */
  const [captureKind, setCaptureKind] = useState<'task' | 'event'>('task');
  const [captureEvent, setCaptureEvent] = useState<EventDraftState>(() =>
    emptyEvent(toDateInput(new Date())),
  );
  const [captureCalendar, setCaptureCalendar] = useState('');
  /**
   * Whether the capture screen's second half is showing.
   *
   * The screen is built to fit one panel without scrolling, which means the
   * fields beyond the essentials have to be somewhere. They are behind this,
   * and it swaps what is on the panel rather than extending it.
   */
  const [captureMore, setCaptureMore] = useState(false);
  /** The same fold for the task and event editors, which are the same shape. */
  const [taskMore, setTaskMore] = useState(false);
  const [eventMore, setEventMore] = useState(false);
  const [editingEvent, setEditingEvent] = useState<RemoteEvent | null>(null);
  const [eventTarget, setEventTarget] = useState('');

  /**
   * Keyboard-aware editing.
   *
   * The soft keyboard covers the lower half of the panel, and the host activity
   * owns the window's soft-input mode, so the plugin cannot rely on the window
   * resizing. Instead the focused field is scrolled near the top of the view,
   * which keeps it visible whichever mode the host uses.
   */
  const scrollRef = useRef<ScrollView>(null);
  const [scrollHandle, setScrollHandle] = useState<number | null>(null);
  /**
   * How tall the on-screen keyboard actually is, as the host reports it.
   *
   * Measured rather than assumed. This used to be a constant 420pt of bottom
   * padding, which is a guess that can only be right on one panel: an A5X and a
   * Manta differ in both resolution and physical size, and the keyboard is a
   * different height on each. Too small and the field being typed into cannot be
   * scrolled clear of the keyboard because there is nothing below it to scroll
   * into; too large and every form ends in a screen of blank space.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardUp = keyboardHeight > 0;

  useEffect(() => {
    const onShow = (event: KeyboardEvent) => {
      // Fall back to a share of the window when the host reports nothing, so a
      // firmware that omits the height still leaves room to scroll.
      const reported = event?.endCoordinates?.height ?? 0;
      setKeyboardHeight(reported > 0 ? reported : Math.round(windowHeight() * 0.4));
    };
    const show = Keyboard.addListener('keyboardDidShow', onShow);
    // The Supernote keyboard changes height when its layout changes (symbols,
    // handwriting). Following the frame keeps the padding honest.
    const change = Keyboard.addListener('keyboardDidChangeFrame', onShow);
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, []);

  /**
   * Bring the field being typed into view, above the keyboard.
   *
   * The field is scrolled close to the top of the panel rather than merely far
   * enough: on a device whose keyboard covers half the screen, "just above the
   * keyboard" leaves the field in the one band where the next field, the
   * confirmation and any error message are all hidden. Near the top, the field
   * and what follows it are both readable, on every panel size.
   *
   * This only works if there is somewhere to scroll to, which is what the
   * measured keyboard padding below the content provides.
   */
  const scrollFieldIntoView = useCallback((y: number) => {
    // A short delay lets the keyboard finish animating in before we scroll,
    // otherwise the scroll is undone by the layout change behind it.
    setTimeout(() => {
      scrollRef.current?.scrollTo({y: Math.max(0, y - 12), animated: false});
    }, 120);
  }, []);

  const [day, setDay] = useState(() => toDateInput(new Date()));
  const [view, setView] = useState(() => {
    const now = new Date();
    return {year: now.getFullYear(), month: now.getMonth()};
  });


  /**
   * How much of a reload to do.
   *
   * 'opening' is the pair the first screen actually shows; 'notes' is the six
   * folder walks behind the calendar's Open/Create buttons, which nothing on
   * the Tasks tab reads.
   */
  type Scope = 'all' | 'opening' | 'tasks' | 'events' | 'notes';

  /**
   * Fetch the Supernote Cloud to-dos and merge them into the tasks on screen.
   *
   * Its own errand for the same reason the subscriptions are: it talks to a
   * different service over a slower path, and making the CalDAV lists wait on
   * it would give back the opening speed the windowed fetch was built for.
   *
   * An expired session is reported once and then left alone. It cannot be
   * renewed in the background — there is no refresh endpoint at all — so
   * retrying on every refresh would only produce the same failure repeatedly.
   */
  const refreshSupernote = useCallback(
    async (cfg: ServerConfig) => {
      startWork();
      try {
        const [lists, cloudTasks] = await Promise.all([
          listSnLists(cfg.supernote.token),
          readSnTasks(cfg.supernote.token),
        ]);
        const mapped = asRemoteTasks(cloudTasks.tasks, lists, cfg.supernote.lists);
        // Said on the Tasks tab, not only in Settings: this is where the to-dos
        // are missing from, and a cap nobody is told about is how a to-do sits
        // on the tablet while the plugin quietly insists it does not exist.
        if (cloudTasks.truncated) {
          setStatus({kind: 'error', message: SN_CAPPED});
        }
        // Rebuilt from the answer only when the answer is the whole account.
        //
        // A complete read means a to-do missing from it has been deleted, or
        // sits in a list no longer ticked, and either way it should leave the
        // screen — `mergeFetched` only ever adds, so the Supernote tasks have
        // to be cleared first for that to happen.
        //
        // **A truncated read must never be treated that way.** Supernote caps
        // this endpoint at twenty rows, so on a busy account the answer is a
        // sample: to-dos beyond the cap are absent while being perfectly alive,
        // and clearing first would delete every one of them from the screen on
        // every refresh. Merging keeps what was seen before, which is the same
        // reasoning that makes the server mark its unfiled pull incremental.
        const kept = cloudTasks.truncated
          ? tasksRef.current
          : tasksRef.current.filter(task => !isSnTask(task));
        const merged = mergeFetched(
          kept,
          mapped,
          t => `${t.collectionUrl}|${t.uid}`,
          (a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity),
        );
        tasksRef.current = merged;
        setTasks(merged);
        void writeNamed(CACHE_FILE, encodeCache(merged, eventsRef.current));

        const left = snDaysLeft(cfg.supernote.token);
        if (left !== null && left <= 7) {
          setStatus({
            kind: 'error',
            message:
              left <= 0
                ? SN_EXPIRED
                : `Your Supernote sign-in runs out in ${left} day(s). It cannot renew itself — sign in again in Settings before it does.`,
          });
        }
      } catch (err) {
        console.log(`[TaskHub] Supernote failed: ${String(err)}`);
        setStatus({kind: 'error', message: `Supernote — ${describe(err)}`});
      } finally {
        endWork();
      }
    },
    [startWork, endWork],
  );

  /**
   * Fetch the `.ics` subscriptions and merge them into the events on screen.
   *
   * Its own errand, with its own place in the loading count, so the panel says
   * it is still working while the collections are already readable. Merged by
   * the same key the widening fetch uses, so a feed refreshed twice replaces
   * its own events rather than doubling them.
   */
  const refreshFeeds = useCallback(
    async (cfg: ServerConfig) => {
      startWork();
      try {
        const result = await listFeeds(cfg, eventWindowRef.current);
        const merged = mergeFetched(
          eventsRef.current,
          result.items,
          e => `${e.href}|${e.uid}|${e.startAt}`,
          (a, b) => a.startAt - b.startAt,
        );
        eventsRef.current = merged;
        setEvents(merged);
        void writeNamed(CACHE_FILE, encodeCache(tasksRef.current, merged));

        // A feed announces its own name in X-WR-CALNAME, the only place a
        // calendar's real name appears in an .ics file. Held in state and never
        // written back to settings: the events are already labelled with it by
        // the fetcher, so this is purely what the Settings list shows — and
        // writing it through `changeConfig` would mark the settings form edited
        // behind the user's back, on a refresh they did not ask for.
        if (result.feedNames && Object.keys(result.feedNames).length > 0) {
          setFeedNames(prev => ({...prev, ...result.feedNames}));
        }
        // Said out loud. A subscription that cannot be reached shows whatever it
        // last said, which is right — but silently serving stale events as if
        // they were current is how somebody misses a meeting that moved.
        if (result.feedsFailed && result.feedsFailed.length > 0) {
          setStatus({
            kind: 'error',
            message: `Could not reach ${result.feedsFailed.join(', ')}. Showing what was last fetched.`,
          });
        }
      } catch (err) {
        console.log(`[TaskHub] feeds failed: ${String(err)}`);
      } finally {
        endWork();
      }
    },
    [startWork, endWork],
  );

  /**
   * What a reload needs to fetch.
   *
   * A full refresh is eight operations: two CalDAV listings and six walks of
   * the note folders. Running all of them after saving one task is most of the
   * wait the user feels when they press Save — nothing about a new task changes
   * which days have notes. Each write says what it actually invalidated.
   */
  const runRefresh = useCallback(
    async (scope: Scope) => {

    const cfg = getConfig();
    // 'opening' is everything the first screen needs and nothing it does not.
    const wantTasks = scope === 'all' || scope === 'opening' || scope === 'tasks';
    const wantEvents = scope === 'all' || scope === 'opening' || scope === 'events';
    const wantNotes = scope === 'all' || scope === 'notes';
    startWork();
    try {
      const [t, e, n, m, wn, mn, qn, yn] = await Promise.all([
        wantTasks && hasCollections(cfg) ? listTasks(cfg) : Promise.resolve(null),
        wantEvents && hasCalendars(cfg)
          ? listEvents(cfg, eventWindowRef.current)
          : Promise.resolve(null),
        wantNotes ? findExistingNotes(cfg.dailyNote) : Promise.resolve(null),
        wantNotes ? findMeetingNotes(cfg.meetingNote) : Promise.resolve(null),
        wantNotes ? findPeriodNotes(cfg.weekNote) : Promise.resolve(null),
        wantNotes ? findPeriodNotes(cfg.monthNote) : Promise.resolve(null),
        wantNotes ? findPeriodNotes(cfg.quarterNote) : Promise.resolve(null),
        wantNotes ? findPeriodNotes(cfg.yearNote) : Promise.resolve(null),
      ]);
      if (t) {
        tasksRef.current = t.items;
        setTasks(t.items);
      }
      if (e) {
        eventsRef.current = e.items;
        setEvents(e.items);
      }
      // Subscriptions come in after the collections rather than with them, and
      // are merged into whatever is already on screen. A feed is a whole file
      // where a collection is a windowed query, so waiting for the slowest one
      // before drawing any calendar at all would give back the opening speed
      // the windowed fetch was built for.
      if (wantEvents && (cfg.feeds?.length ?? 0) > 0) {
        void refreshFeeds(cfg);
      }
      if (wantTasks && snReady(cfg.supernote)) {
        void refreshSupernote(cfg);
      }
      // Persisted so the next opening has something to draw before the server
      // answers. Deliberately not awaited and deliberately not on the closing
      // path: leaving the plugin to open a daily note must not wait on a file
      // write, and a failed write is only a slower opening next time.
      if (t || e) {
        void writeNamed(CACHE_FILE, encodeCache(tasksRef.current, eventsRef.current));
      }
      if (n) {
        setNoteFiles(n);
      }
      if (m) {
        setMeetingFiles(m);
      }
      if (wn && mn && qn && yn) {
        setPeriodFiles({week: wn, month: mn, quarter: qn, year: yn});
      }
      // Surfaced rather than thrown: a list that has gone must not hide the
      // lists that are still working. Only replaced for the parts just fetched,
      // so a scoped reload does not clear a warning about the other half.
      if (t || e) {
        setMissing([...(t?.missing ?? []), ...(e?.missing ?? [])]);
      }
    } catch (err) {
      setStatus({kind: 'error', message: describe(err)});
    } finally {
      endWork();
    }
    },
    [startWork, endWork, refreshFeeds, refreshSupernote],
  );

  /**
   * Refreshes already running, by scope.
   *
   * Opening the hub asks for the same refresh twice — once from the button
   * press in `openHub` and once from the effect that watches `screen` — and
   * neither alone covers both ways the plugin can be dismissed, so neither can
   * simply be deleted. Unjoined they raced, and every opening cost two CalDAV
   * listings instead of one. A caller arriving while the same scope is already
   * in flight now waits on that one rather than starting another.
   *
   * A ref, not state: the second caller runs in the same tick as the first and
   * must see it, which a re-render would be too late for.
   */
  const inFlight = useRef(new Map<Scope, Promise<void>>());

  const refresh = useCallback(
    (scope: Scope = 'all'): Promise<void> => {
      const running = inFlight.current.get(scope);
      if (running) {
        return running;
      }
      const started = runRefresh(scope).finally(() => {
        inFlight.current.delete(scope);
      });
      inFlight.current.set(scope, started);
      return started;
    },
    [runRefresh],
  );

  /**
   * Fetch the part of the calendar a view needs and the window does not hold.
   *
   * Only the missing range is asked for, and the result is merged into what is
   * already on screen, so paging back through the years costs one small fetch
   * per new stretch rather than re-downloading everything each time.
   *
   * Nothing here blocks the view. The grid has already drawn from what is in
   * hand; the events for the rest of it arrive when they arrive.
   */
  const widenEvents = useCallback(async (needed: DateRange) => {
    const current = eventWindowRef.current;
    if (covers(current, needed)) {
      return;
    }
    const next = widen(current, needed);
    const missingRange = gap(current, next);
    // Claimed before the fetch, not after: paging quickly through months would
    // otherwise start a fetch per month, each still seeing the old window.
    setWindow(next);
    const cfg = getConfig();
    if (!hasCalendars(cfg)) {
      return;
    }
    startWork();
    try {
      const more = await listEvents(cfg, missingRange);
      const merged = mergeFetched(
        eventsRef.current,
        more.items,
        // href and uid together are not enough: one calendar object can hold a
        // repeating event and its overridden occurrences, which share both.
        e => `${e.href}|${e.uid}|${e.startAt}`,
        (a, b) => a.startAt - b.startAt,
      );
      eventsRef.current = merged;
      setEvents(merged);
    } catch {
      // Deliberately silent, and the window is given back so the next visit
      // tries again. This runs because somebody paged to another month, not
      // because they asked for anything — an error banner over a calendar that
      // is drawing correctly would be the plugin complaining to itself.
      setWindow(current);
    } finally {
      endWork();
    }
  }, [setWindow, startWork, endWork]);

  /**
   * Whether the month grid's legend is showing.
   *
   * Open for the first few openings and shut after — long enough to be read,
   * not so long as to become furniture. Per session, not stored: it costs one
   * tap to open and nothing is lost by forgetting it.
   */
  const [legendOpen, setLegendOpen] = useState(false);

  /** Bumped once per opening, so per-opening effects fire on every one. */
  const [openings, setOpenings] = useState(0);
  /**
   * When this opening started.
   *
   * The clock the task list is cut against — see `sections`. A value rather
   * than a call inside the memo, so "which tasks are overdue" is something
   * React can actually tell has changed.
   */
  const [openedAt, setOpenedAt] = useState(() => Date.now());

  /**
   * Walk the note folders the first time the calendar is looked at.
   *
   * Deferred rather than skipped: the calendar needs them to say Open or Create
   * on every note button, but the Tasks tab never touches them, and doing six
   * directory walks before the first screen appears is a wait for nothing.
   */
  const notesLoaded = useRef(false);
  useEffect(() => {
    if (screen === 'hub' && tab === 'calendar' && !notesLoaded.current) {
      notesLoaded.current = true;
      void refresh('notes');
    }
  }, [screen, tab, openings, refresh]);

  /* ---------------------------------------------------------------- *
   * Find: keywords and starred pages across the note folders
   * ---------------------------------------------------------------- */

  const [findQuery, setFindQuery] = useState('');
  const [findNotes, setFindNotes] = useState<IndexedNote[]>([]);
  const [findRoots, setFindRoots] = useState<SearchRoot[]>([]);
  const [findSummary, setFindSummary] = useState<FindSummary | null>(null);
  const [findScanning, setFindScanning] = useState(false);
  const [findProgress, setFindProgress] = useState<{done: number; total: number} | null>(
    null,
  );
  const [previewMode, setPreviewMode] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewsPending, setPreviewsPending] = useState(0);
  /**
   * A one-off message with nothing to confirm.
   *
   * Separate from `ask`, which is a question, and from `status`, which is a line
   * about the last thing that happened. This is for telling somebody why the
   * thing they just tapped did not open.
   */
  const [notice, setNotice] = useState<{title: string; body: string} | null>(null);
  const [feedDraft, setFeedDraft] = useState('');
  /**
   * What the last subscription action said, shown inside its own fold.
   *
   * Not `status`: the settings screen renders that at the foot of a form many
   * screens long, hundreds of rows below the button being pressed, so a message
   * put there is a message nobody reads. Pressing Import appeared to do nothing
   * at all for exactly this reason. Feedback belongs where the action was.
   */
  const [feedMessage, setFeedMessage] = useState<string>('');
  const [feedBusy, setFeedBusy] = useState(false);
  /** The Supernote sign-in, which is two steps with an email in between. */
  const [snEmail, setSnEmail] = useState('');
  const [snPassword, setSnPassword] = useState('');
  const [snCode, setSnCode] = useState('');
  const [snPending, setSnPending] = useState<{validCodeKey: string; timestamp: unknown} | null>(
    null,
  );
  const [snLists, setSnLists] = useState<SnList[]>([]);
  /** Open to-dos per list, so a row can say what is in it before it is ticked. */
  const [snCounts, setSnCounts] = useState<Record<string, number>>({});
  const [snMessage, setSnMessage] = useState('');
  const [snBusy, setSnBusy] = useState(false);
  /**
   * How long the session has left, in words.
   *
   * Shown always rather than only when it is nearly out: the thirty-day expiry
   * is the most surprising thing about this connection, and somebody who reads
   * it once in Settings is not caught out by it later.
   */
  const snDaysLeftLabel = useMemo(() => {
    const left = snDaysLeft(config.supernote.token);
    if (left === null) {
      return '';
    }
    if (left <= 0) {
      return 'This session has run out — sign in again.';
    }
    return `This session lasts ${left} more day(s); Supernote cannot renew it.`;
  }, [config.supernote.token]);

  /**
   * Every list a new task can be saved into, CalDAV and Supernote alike.
   *
   * One list rather than two sections: from the user's side these are all
   * "places a task can go", and the pickers already handle several targets at
   * once. Where each one actually lives is decided by `writeTask`, which reads
   * the scheme off the URL.
   */
  /**
   * Whether the task being edited lives in Supernote's own To-Do app.
   *
   * It stores a title and a date and nothing else, so priority, repeats, sub
   * tasks and a time of day have nowhere to go. They are hidden rather than
   * shown and ignored: a control that silently does nothing is worse than an
   * absent one, because the user believes they have set something.
   */
  const editingSupernote = useMemo(
    () =>
      Boolean(
        taskForm &&
          ((editingTask && isSnTask(editingTask)) ||
            (!editingTask &&
              taskTargets.length > 0 &&
              taskTargets.every(isSnCollection))),
      ),
    [taskForm, editingTask, taskTargets],
  );

  /** The lasso is being saved only into Supernote lists. Same rule as above. */
  const capturingToSupernote = useMemo(
    () => targets.length > 0 && targets.every(isSnCollection),
    [targets],
  );

  const saveTargets = useMemo(() => {
    const places = config.collectionUrls.map(url => ({
      url,
      label: collectionName(url),
      hint: collectionHint(url, config.collectionUrls),
    }));
    if (snReady(config.supernote)) {
      for (const list of config.supernote.lists) {
        const url = snCollectionUrl(list.id);
        // The Inbox is read-only — a view of to-dos that belong to no list, so
        // there is nowhere in it for a new one to go. `writeTask` refuses it,
        // but offering it here and then failing would be feedback shown far
        // from the action, so it is never offered.
        if (isSnUnfiled(url)) {
          continue;
        }
        places.push({url, label: list.name, hint: 'Supernote To-Do'});
      }
    }
    return places;
  }, [config.collectionUrls, config.supernote]);
  /** Names the feeds announced for themselves, for the Settings list only. */
  const [feedNames, setFeedNames] = useState<Record<string, string>>({});

  /**
   * Keyword pages the reader has expanded, reported up from the Find view.
   *
   * Starred pages are all on screen at once, so the view can render them from
   * the hit list alone. A keyword's pages are behind a fold, and rendering a
   * page for every keyword in the index whether or not anybody opened it would
   * be exactly the unbounded work the index exists to avoid.
   */
  const [visibleKeywordPages, setVisibleKeywordPages] = useState<
    {path: string; page: number}[]
  >([]);

  /**
   * Read the note folders and index what is in them.
   *
   * The saved index does the heavy lifting: only notes whose modification time
   * or size has changed since last time are actually opened, so a second visit
   * costs a directory walk and little else. The first one, on a large tree, is
   * three native round trips per note and is why this is never done on opening.
   */
  const scanNotes = useCallback(async () => {
    setFindScanning(true);
    setFindProgress(null);
    try {
      const result = await buildIndex(getConfig(), setFindProgress);
      setFindNotes(result.notes);
      setFindRoots(result.roots);
      setFindSummary({
        found: result.found,
        failed: result.failed,
        walked: result.walked,
      });
    } catch (err) {
      // Reported where the user is looking, not only to logcat. An index that
      // silently produced nothing is indistinguishable from notes that have
      // nothing in them, which is the exact confusion the date-heading feature
      // shipped with the first time.
      console.log(`[TaskHub] note index failed: ${String(err)}`);
      setStatus({kind: 'error', message: `Could not read your notes — ${describe(err)}`});
    } finally {
      setFindScanning(false);
      setFindProgress(null);
    }
  }, []);

  /**
   * Index the first time Find is opened, and not before.
   *
   * Same deferral as the calendar's folder walk above, and for a stronger
   * reason: this one reads inside every note it finds.
   */
  const findLoaded = useRef(false);
  useEffect(() => {
    if (screen === 'hub' && tab === 'find' && !findLoaded.current) {
      findLoaded.current = true;
      void scanNotes();
    }
  }, [screen, tab, scanNotes]);

  /** Throw the index away and read every note again. */
  const rescanNotes = useCallback(() => {
    void (async () => {
      await clearIndex();
      await scanNotes();
    })();
  }, [scanNotes]);

  // Derived on every render from the index and the filter. Cheap enough to do
  // plainly: the work is grouping a few hundred entries, not reading files.
  const foundStars = useMemo(
    () => starHits(findNotes, findRoots, findQuery),
    [findNotes, findRoots, findQuery],
  );
  const foundKeywords = useMemo(
    () => keywordHits(findNotes, findRoots, findQuery),
    [findNotes, findRoots, findQuery],
  );

  /**
   * Render the starred pages that are on screen, one at a time.
   *
   * Sequential on purpose. Each page is a full render by the host, and firing
   * a few dozen at once would compete with the panel's own repainting for the
   * same hardware — the tiles would all arrive at the end rather than filling
   * in as they finish. Each one is published as it lands, so the grid becomes
   * useful before it is complete.
   *
   * Cancelled by the `live` flag rather than left to finish: leaving Previews,
   * or typing into the filter, should stop work on pages nobody is looking at.
   */
  useEffect(() => {
    if (!previewMode || screen !== 'hub' || tab !== 'find') {
      return;
    }
    const byPath = new Map(findNotes.map(note => [note.path, note.modified]));
    const wanted = [
      ...foundStars.flatMap(hit =>
        hit.pages.map(page => ({
          key: `${hit.path}:${page}`,
          path: hit.path,
          modified: hit.modified,
          page,
        })),
      ),
      ...visibleKeywordPages.map(item => ({
        key: `${item.path}:${item.page}`,
        path: item.path,
        // A keyword hit carries the note's modification time only through the
        // index, which is where the preview's cache name comes from too.
        modified: byPath.get(item.path) ?? 0,
        page: item.page,
      })),
    ].filter(
      (item, i, all) => all.findIndex(other => other.key === item.key) === i,
    );
    const undrawn = wanted.filter(item => !previews[item.key]);
    if (undrawn.length === 0) {
      setPreviewsPending(0);
      return;
    }

    let live = true;
    setPreviewsPending(undrawn.length);
    void (async () => {
      for (const item of undrawn) {
        if (!live) {
          return;
        }
        const uri = await ensurePreview(item.path, item.page, item.modified);
        if (!live) {
          return;
        }
        if (uri) {
          setPreviews(prev => ({...prev, [item.key]: uri}));
        }
        setPreviewsPending(n => Math.max(0, n - 1));
      }
    })();
    return () => {
      live = false;
    };
    // `previews` is deliberately not a dependency: it is written by this effect,
    // and depending on it would restart the loop after every tile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, screen, tab, foundStars, visibleKeywordPages, findNotes]);


  /**
   * Fetch more calendar when the view moves outside what has been fetched.
   *
   * Watches the view as well as the day because they need different amounts:
   * the year view needs a year of it and the day view needs a day, and asking
   * for a year's worth to draw one day would give back the cost that windowing
   * the fetch just saved.
   */
  useEffect(() => {
    if (screen !== 'hub' || tab !== 'calendar') {
      return;
    }
    void widenEvents(viewRange(calView, day));
  }, [screen, tab, calView, day, widenEvents]);

  /**
   * Pending auto-close, so it can be cancelled.
   *
   * If it fires after the user has already tapped ↩ Back to note, closePluginView
   * runs against a view the host has stopped showing; the host's idea of the
   * view then disagrees with reality and the next button press is spent
   * resyncing rather than opening — the double-tap.
   */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Whether the host is currently showing our view.
   *
   * closePluginView must be called exactly once per opening. Called a second
   * time — a stale timer, a confirmation that closes after something else
   * already did — it runs against a view the host has already dismissed, and
   * the host's idea of the view then disagrees with reality: the next button
   * press is spent resyncing rather than opening, which is the double-tap.
   *
   * A ref rather than state: it must be correct the instant close() is called,
   * not after the next render.
   */
  const viewShowing = useRef(true);

  const close = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setScreen('idle');
    setStatus(null);
    setAsk(null);
    setTaskForm(null);
    setEventForm(null);
    if (!viewShowing.current) {
      return;
    }
    viewShowing.current = false;
    void PluginManager.closePluginView();
  }, []);

  /**
   * Whether a form on screen holds work that has not been written.
   *
   * A title typed but not saved is the case that matters: the plugin closes
   * straight back to the note, and there is no draft kept anywhere, so leaving
   * silently loses it.
   */
  const formUnsaved =
    (!!taskForm && taskForm.summary.trim().length > 0) ||
    (screen === 'save' && draft.summary.trim().length > 0) ||
    (!!eventForm && eventForm.summary.trim().length > 0);

  /**
   * Leave the plugin, asking first when a form has unsaved work in it.
   *
   * Every ↩ Back to note goes through here rather than straight to `close`.
   */
  const closeGuarded = useCallback(() => {
    if (!formUnsaved) {
      close();
      return;
    }
    setAsk({
      title: 'Leave without saving?',
      body: 'What you have typed has not been saved, and leaving now discards it.',
      label: 'Yes, discard',
      run: async () => {
        close();
        return 'Discarded.';
      },
    });
  }, [close, formUnsaved]);


  /** Dismiss once the confirmation has been read, cancelling any earlier one. */
  const scheduleClose = useCallback((delayMs = 1200) => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
    }
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      close();
    }, delayMs);
  }, [close]);

  /**
   * True while a confirmed write is in flight.
   *
   * Every Save and every ↩ Back to note is held back until it clears, so a write
   * cannot be started twice by an impatient second tap and the plugin cannot be
   * closed with one half done. On a panel that takes a moment to redraw, a
   * button that looks unresponsive invites exactly that second tap.
   */
  const [writing, setWriting] = useState(false);

  /**
   * Run a write immediately, with no confirmation.
   *
   * The same path as runAsk — busy flag, status, scoped reload — minus the
   * dialog. Used for creating and editing a task, which is the write
   * done most often and the least consequential: it adds a row that can be
   * edited or ticked off in two taps. Making somebody confirm it turned every
   * save into a second full-screen repaint and a second press.
   *
   * Everything destructive still goes through runAsk: completing, wiping,
   * discarding unsaved work.
   */
  const runNow = useCallback(async (action: Ask) => {
    setStatus({kind: 'working', message: 'Saving…'});
    setWriting(true);
    try {
      const message = await action.run();
      setStatus({kind: 'done', message});
      if (action.closeAfter) {
        scheduleClose();
        return;
      }
      void refresh(action.reload ?? 'all');
    } catch (err) {
      setStatus({kind: 'error', message: describe(err)});
    } finally {
      setWriting(false);
    }
  }, [refresh, scheduleClose]);

  /** Confirm → push → success → reload. The single write path. */
  /**
   * Carry out one write, whether or not it was confirmed first.
   *
   * Every write in the plugin passes through here. Split from `runAsk` so an
   * action that does not need confirming can still get the same status
   * reporting, the same error handling and the same scoped reload — the
   * alternative was either a dialog on everything or a second, divergent path.
   */
  const perform = useCallback(async (pending: Ask) => {
    setStatus({kind: 'working', message: 'Saving…'});
    setWriting(true);
    try {
      const message = await pending.run();
      setStatus({kind: 'done', message});
      if (pending.closeAfter) {
        // Straight out, no reload: the user is on their way back to the note,
        // and refreshing a list about to be closed only delays the exit. The
        // next opening refreshes anyway.
        scheduleClose();
        return;
      }
      // Deliberately NOT awaited. The write has already succeeded and the
      // confirmation is on screen; making the user watch a re-listing of every
      // task before the form closes is most of what "saving is slow" was. The
      // list reconciles a moment later, in the background.
      void refresh(pending.reload ?? 'all');
    } catch (err) {
      setStatus({kind: 'error', message: describe(err)});
    } finally {
      setWriting(false);
    }
  }, [refresh, scheduleClose]);

  const runAsk = useCallback(async () => {
    const pending = ask;
    setAsk(null);
    if (pending) {
      await perform(pending);
    }
  }, [ask, perform]);

  const capture = useCallback(async () => {
    // The host is showing us again, so the next close is a real one.
    viewShowing.current = true;
    setScreen('save');
    const cfg = getConfig();
    setTargets(cfg.defaultCollectionUrl ? [cfg.defaultCollectionUrl] : []);
    setStatus({kind: 'working', message: 'Reading selection…'});
    try {
      const summary = await readLassoAsText();
      // Recorded on the task as its own properties, not written into the
      // description — that space stays empty for the user to write in.
      setSource(await readSourceRef());
      setDraft({...EMPTY_TASK, summary});
      // The same recognised text seeds both, so switching Task/Event after the
      // fact does not lose what was just read off the page.
      setCaptureEvent({...emptyEvent(toDateInput(new Date())), summary});
      setCaptureKind('task');
      setCaptureMore(false);
      setCaptureCalendar(cfg.calendarUrls[0] ?? '');
      // Deliberately no refresh. This screen shows the title, the lists to save
      // into (from settings) and a due date — none of which come from the
      // server. Fetching both collections and scanning for notes here put
      // several seconds between the lasso and being able to press Save.
      // Deliberately not a status message about there being no task list.
      // `cfg` here is whatever getConfig() held when the lasso was pressed, and
      // on a cold start that is before settings have come off disk — so the
      // warning fired for people who were perfectly well configured and then
      // stuck, because a one-shot status is never re-evaluated. The capture
      // screen renders that warning from the live config instead.
      setStatus(null);
    } catch (err) {
      setStatus({kind: 'error', message: describe(err)});
    }
  }, []);

  const openHub = useCallback(() => {
    viewShowing.current = true;
    setStatus(null);
    setTaskForm(null);
    setEventForm(null);
    // Let the note folders be walked again on this opening. The React tree
    // outlives a closing, so a ref set once per plugin load would keep reading
    // a note written in the NOTE app since as "Create". `openings` is what the
    // effect watches: `screen` alone does not change when the host dismissed
    // the view rather than our own close button, and `tab` does not change
    // when the calendar was already the tab in front.
    notesLoaded.current = false;
    setOpenedAt(Date.now());
    // The configured tab, read fresh each opening. getConfig rather than the
    // `config` state: on a cold start this runs before the settings load has
    // finished, and the restore below sets it again from what it read.
    setTab(getConfig().startTab);
    // Back to the default width. Last session may have paged to another year
    // and widened it; carrying that over would make every later opening as slow
    // as the widest thing that was ever looked at.
    setWindow(defaultWindow(toDateInput(new Date())));
    setOpenings(n => n + 1);
    setScreen('hub');
    // Refreshed here as well as by the screen effect below. The effect only
    // fires when `screen` changes, and `screen` stays 'hub' when the plugin is
    // dismissed by the host rather than by our own close button — so on the
    // next opening the effect saw no change and the list stayed as it was.
    // When both do fire they are coalesced into one fetch by `refresh`.
    //
    // 'opening', not the default: the six note-folder walks are not on this
    // screen, and doing them here defeated the deferral below.
    void refresh('opening');
  }, [refresh, setWindow]);

  /**
   * Reload whenever the hub comes up.
   *
   * The plugin's React tree stays mounted between openings, so state survives a
   * close. Without this, reopening showed whatever was last fetched — including
   * an empty list from before any collection was configured, which looked like
   * "my tasks are missing" until a manual refresh.
   *
   * The capture screen is deliberately excluded: it displays nothing that comes
   * from the server, and fetching there only delayed the Save button.
   */
  useEffect(() => {
    if (screen === 'hub') {
      void refresh('opening');
    }
  }, [screen, refresh]);

  /**
   * Restore settings from disk on first open.
   *
   * Runs before the first refresh has anything to fetch, and only once — a
   * reload here would overwrite edits the user is part-way through making.
   */
  useEffect(() => {
    if (restored || screen === 'idle') {
      return;
    }
    setRestored(true);
    void (async () => {
      // Before the settings, and before any network call: this is the only
      // thing that can put content on the first screen of a cold opening
      // rather than an empty list behind a loading line. Whatever the fetch
      // returns replaces it a moment later.
      //
      // Only seeded into empty state — a list already on screen is either from
      // this session's fetch or newer than the file, and must not be rolled
      // back to it.
      void (async () => {
        const cached = decodeCache(await readNamed(CACHE_FILE));
        if (!cached) {
          return;
        }
        if (tasksRef.current.length === 0 && cached.tasks.length > 0) {
          tasksRef.current = cached.tasks;
          setTasks(cached.tasks);
        }
        if (eventsRef.current.length === 0 && cached.events.length > 0) {
          eventsRef.current = cached.events;
          setEvents(cached.events);
        }
      })();

      const loaded = await loadSettings();
      // A tick saved on the account folder by a build that used to offer it
      // survives every later fix to discovery, because settings are durable and
      // independent of what discovery finds. Dropped here, where they arrive.
      const stored = loaded ? pruneContainers(loaded) : loaded;
      if (stored) {
        setConfig(stored);
        // The store is always updated, because getConfig() feeds capture and
        // the note paths. The visible form is only seeded when the user has
        // not already started editing it -- see settingsEditedRef.
        if (!settingsEditedRef.current) {
          setLocalConfig(stored);
        }
        // Seed the capture screen's list from the settings just loaded.
        //
        // capture() reads getConfig() when the lasso button is pressed, and on
        // a cold start that can happen before this load has finished — the
        // default list was then read from an empty config and nothing came out
        // pre-ticked. Only seeded when nothing has been chosen, so a choice
        // made in the meantime is not overwritten.
        // Set here as well as in openHub: on a cold start this load finishes
        // after the hub has already opened, so openHub saw an empty config.
        // Only on the one restore, so a tab switched by hand is never undone.
        setTab(stored.startTab);
        if (stored.defaultCollectionUrl) {
          setTargets(previous =>
            previous.length === 0 ? [stored.defaultCollectionUrl] : previous,
          );
          setTaskTargets(previous =>
            previous.length === 0 ? [stored.defaultCollectionUrl] : previous,
          );
        }
        // Reopen on the day the plugin was last left from, so coming back from
        // a note lands where it was rather than on today.
        if (stored.lastDay) {
          setDay(stored.lastDay);
          const d = new Date(`${stored.lastDay}T00:00:00`);
          setView({year: d.getFullYear(), month: d.getMonth()});
        }
        // Tasks and events only. The note folders are walked when the calendar
        // is first opened — four directory walks are a large part of what the
        // plugin does before it can show anything, and the Tasks tab does not
        // use a single one of them.
        void refresh('opening');
      }
      setStorePath(await settingsLocation());
      setDevice(await deviceName());
    })();
  }, [restored, screen, refresh]);

  useEffect(() => {
    const button = PluginManager.registerButtonListener({
      onButtonPress: event => {
        if (event.id === LASSO_BUTTON_ID) {
          void capture();
        } else if (event.id === TOOLBAR_BUTTON_ID) {
          openHub();
        }
      },
    });
    const configButton = PluginManager.registerConfigButtonListener({
      onClick: () => {
        viewShowing.current = true;
        settingsEditedRef.current = false;
        setLocalConfig(getConfig());
        setLocalCollections(getCollections());
        setStatus(null);
        setScreen('settings');
        // Only this screen needs them, and the call is cheap.
        void listAllTemplates().then(setTemplates);
      },
    });
    return () => {
      button.remove();
      configButton.remove();
    };
  }, [capture, openHub]);

  /**
   * Switch calendar view, remembering where we came from.
   *
   * Tapping a day in Month jumps to Day, which is a one-way trip without this —
   * the tab strip cannot express "the view I was just on".
   */
  /**
   * Move the selection to today when switching view, so a coarser or finer view
   * opens somewhere meaningful.
   *
   * Coming from the year view, the quarter used to open with its 1 January
   * highlighted — the anchor the year view passed, not a day anybody chose.
   * Today is what somebody switching view almost always wants to see, and it is
   * one tap to move off it.
   */
  /**
   * NOT for opening a particular day — use `openDayOn` / `openWeekOn` for that.
   *
   * This moves the selection to today, which is right for the view switcher and
   * wrong for everything else. Calling `setDay(iso)` and then this looks like it
   * should work and does not: the switch runs second and puts the day back to
   * today, so a month grid's "tap twice to open" opened today rather than the
   * day tapped. That shipped in 0.63.0.
   */
  const setCalView = useCallback((next: CalView) => {
    // The history push happens HERE, not inside the setCalViewRaw updater.
    // A state updater must be a pure function of its previous value: React is
    // free to call it more than once, and calling another setState from inside
    // it made switching view unreliable — the tap that should have shown Year
    // sometimes did nothing, and a second tap was needed. Reading the current
    // view through a ref keeps this a plain comparison with no nesting.
    const prev = calViewRef.current;
    if (prev !== next) {
      setViewHistory(h => [...h, prev]);
      setCalViewRaw(next);
      const today = toDateInput(new Date());
      setDay(today);
      const now = new Date();
      setView({year: now.getFullYear(), month: now.getMonth()});
    }
  }, []);

  const goBackView = useCallback(() => {
    const history = viewHistoryRef.current;
    if (history.length === 0) {
      return;
    }
    setCalViewRaw(history[history.length - 1]);
    setViewHistory(h => h.slice(0, -1));
  }, []);

  /** Jump every calendar view back to today, whichever one is showing. */
  /**
   * Remember the day being shown, then dismiss the plugin.
   *
   * Called on every path that hands over to a note. A link inside a note cannot
   * bring the plugin back — the SDK has no link type for it — so reopening on
   * the day you left is the nearest thing to a back button, and this is the
   * moment to record it: the user is leaving, and it is one write rather than
   * one per tap on the calendar.
   */
  const leaveForNote = useCallback(() => {
    const cfg = getConfig();
    if (cfg.lastDay !== day) {
      const next = {...cfg, lastDay: day};
      setConfig(next);
      // Never allowed to block or fail the handover: the note opening is what
      // the user asked for, and losing the bookmark is not worth a message.
      void saveSettings(next).catch(() => {});
    }
    close();
  }, [close, day]);

  /**
   * Stable navigation handlers.
   *
   * The calendar grids are memoised, and a memo only pays off if its props hold
   * still: an inline arrow is a new function on every render, so passing one
   * would defeat the memo and rebuild five hundred cells for nothing. These are
   * defined once and reused.
   */
  const openDayOn = useCallback((iso: string) => {
    setDay(iso);
    // Raw setter: this IS a deliberate choice of day, so it must not be moved
    // to today the way a plain view switch is.
    setCalViewRaw('day');
    setViewHistory(h => [...h, calViewRef.current]);
  }, []);
  const openWeekOn = useCallback((iso: string) => {
    setDay(iso);
    // Raw setter: this IS a deliberate choice of day, so it must not be moved
    // to today the way a plain view switch is.
    setCalViewRaw('week');
    setViewHistory(h => [...h, calViewRef.current]);
  }, []);
  const openQuarterOn = useCallback((iso: string) => {
    setDay(iso);
    // Raw setter: this IS a deliberate choice of day, so it must not be moved
    // to today the way a plain view switch is.
    setCalViewRaw('quarter');
    setViewHistory(h => [...h, calViewRef.current]);
  }, []);
  const openMonthAt = useCallback((year: number, month: number) => {
    setView({year, month});
    setCalViewRaw('month');
    setViewHistory(h => [...h, calViewRef.current]);
  }, []);
  const shiftToYear = useCallback(
    (year: number) => {
      const next = `${year}${day.slice(4)}`;
      setDay(next);
      setView(v => ({year, month: v.month}));
    },
    [day],
  );
  const shiftToQuarter = useCallback((iso: string) => {
    setDay(iso);
    const d = new Date(`${iso}T00:00:00`);
    setView({year: d.getFullYear(), month: d.getMonth()});
  }, []);

  /**
   * Whether the settings form differs from what is stored.
   *
   * Compared by value rather than tracked with a flag: the form is edited by
   * dozens of controls across a long page, and a flag would have to be set
   * correctly by every one of them. A whole-config comparison cannot be
   * forgotten by a setting added later — which is exactly the mistake that would
   * quietly discard somebody's work.
   */
  const settingsDirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(getConfig()),
    [config],
  );

  /**
   * Leave settings, asking first when there is unsaved work.
   *
   * Nothing on this page takes effect until Save, so closing with changes
   * pending throws them away. That is worth one question.
   */
  /** Leave settings without saving, after saying plainly what that means. */
  const cancelSettings = useCallback(() => {
    setAsk({
      title: 'Exit without saving?',
      body: 'Any changes you have made on this page will be discarded.',
      label: 'Yes, discard and exit',
      run: async () => {
        // Put the form back to what is stored, so reopening settings does not
        // show discarded edits as though they were still pending.
        settingsEditedRef.current = false;
        setLocalConfig(getConfig());
        close();
        return '';
      },
    });
  }, [close]);

  const closeSettings = useCallback(() => {
    if (!settingsDirty) {
      close();
      return;
    }
    setAsk({
      title: 'Leave without saving?',
      reload: 'notes',
      body: 'Your changes to these settings have not been saved, and leaving now discards them.',
      label: 'Yes, discard',
      run: async () => {
        // Put the form back to what is stored, so reopening settings does not
        // show discarded edits as though they were still pending.
        settingsEditedRef.current = false;
        setLocalConfig(getConfig());
        close();
        return 'Changes discarded.';
      },
    });
  }, [close, settingsDirty]);

  const goToday = useCallback(() => {
    const now = new Date();
    setDay(toDateInput(now));
    setView({year: now.getFullYear(), month: now.getMonth()});
  }, []);


  // ---- writes, all funnelled through ask() ----

  const askSaveCaptured = useCallback(() => {
    const summary = draft.summary.trim();
    if (!summary) {
      setStatus({kind: 'error', message: 'Give the task a title.'});
      return;
    }
    if (targets.length === 0) {
      setStatus({kind: 'error', message: 'Tick at least one list to save into.'});
      return;
    }
    const names = targets.map(collectionName).join(', ');
    const marking =
      source && config.markStyle !== 'off'
        ? ' The selected handwriting will be boxed on the page.'
        : '';
    void runNow({
      title: 'Create task?',
      reload: 'tasks',
      body: `"${summary}" will be added to ${names}.${marking}`,
      label: 'Yes, create',
      closeAfter: true,
      run: async () => {
        let made = 0;
        let failed = 0;
        for (const url of targets) {
          // Separate UID per collection: the same UID in two collections is
          // legal but confuses clients that assume a UID names one object.
          const uid = newUid();
          await putTask(
            getConfig(),
            {
              uid,
              summary,
              description: draft.description.trim() || undefined,
              dueDate: draft.dueDate || undefined,
              dueTime: draft.dueTime || undefined,
              priority: valueOf(draft.priority),
              rrule: ruleFor(draft.repeat) ?? undefined,
              // Carries the page the handwriting came from, so the task can
              // link back to it later. Kept off DESCRIPTION on purpose.
              sourcePath: source?.path,
              sourcePage: source?.page,
            },
            url,
          );
          // Steps go into the same list as the parent they belong to.
          const added = await addSteps(
            getConfig(),
            uid,
            draft.steps,
            url,
            draft.stepsDate || draft.dueDate || undefined,
            draft.stepsDate ? draft.stepsTime || undefined : draft.dueTime || undefined,
          );
          made += added.made;
          failed += added.failed;
        }
        // Mark the page LAST, and never let it fail the save: the task is
        // already on the server by now, and swallowing that confirmation over a
        // decoration would be the worse outcome. The lasso has to still be live
        // for this to work, which is why it happens inside the same errand.
        let note = '';
        const style = getConfig().markStyle ?? 'dashed';
        if (style !== 'off') {
          if (!source) {
            note = ' The page it came from could not be identified, so no mark was made.';
          } else {
            const cfg = getConfig();
            note = await markPage(source, {
              style,
              shade: cfg.markShade,
              label: cfg.markLabel,
              shadeColor: cfg.markShadeColor,
            });
          }
        }
        setDraft(EMPTY_TASK);
        setSource(undefined);
        return `Saved successfully — "${summary}" added to ${names}.${saidAboutSteps(
          made,
          failed,
        )}${note}`;
      },
    });
  }, [draft, targets, source, config.markStyle, runNow]);

  /**
   * Save the lassoed handwriting as a calendar event.
   *
   * Deliberately a sibling of `askSaveCaptured` rather than a branch inside it.
   * The two share the lasso, the source reference and the page mark, but they
   * validate different fields, write through different APIs and confirm with
   * different wording — folding them together would mean a function that is a
   * conditional from top to bottom.
   *
   * The page mark is made exactly as it is for a task, last and never fatal:
   * the event is already on the server by then, and losing the confirmation
   * over a decoration would be the worse trade.
   */
  const askSaveCapturedEvent = useCallback(() => {
    const summary = captureEvent.summary.trim();
    if (!summary) {
      setStatus({kind: 'error', message: 'Give the event a title.'});
      return;
    }
    if (!captureEvent.date) {
      setStatus({kind: 'error', message: 'Pick a date for the event.'});
      return;
    }
    if (!captureCalendar) {
      setStatus({kind: 'error', message: 'Choose a calendar to save into.'});
      return;
    }
    const where = collectionName(captureCalendar);
    const marking =
      source && config.markStyle !== 'off'
        ? ' The selected handwriting will be boxed on the page.'
        : '';
    void runNow({
      title: 'Create event?',
      reload: 'events',
      body: `"${summary}" on ${formatDate(captureEvent.date, config.dateFormat)}, in ${where}.${marking}`,
      label: 'Yes, create',
      closeAfter: true,
      run: async () => {
        await createEvent(getConfig(), captureCalendar, {
          uid: newUid(),
          summary,
          description: captureEvent.description.trim() || undefined,
          location: captureEvent.location.trim() || undefined,
          date: captureEvent.date,
          startTime: captureEvent.startTime || undefined,
          endTime: captureEvent.endTime || undefined,
          rrule: ruleFor(captureEvent.repeat) ?? undefined,
          // Same properties a captured task carries, so an event made from
          // handwriting can offer the same way back to the page.
          sourcePath: source?.path,
          sourcePage: source?.page,
        });

        let note = '';
        const style = getConfig().markStyle ?? 'dashed';
        if (style !== 'off') {
          if (!source) {
            note = ' The page it came from could not be identified, so no mark was made.';
          } else {
            const cfg = getConfig();
            note = await markPage(source, {
              style,
              shade: cfg.markShade,
              label: cfg.markLabel,
              shadeColor: cfg.markShadeColor,
            });
          }
        }
        setCaptureEvent(emptyEvent(toDateInput(new Date())));
        setSource(undefined);
        return `Saved successfully — "${summary}" added to ${where}.${note}`;
      },
    });
  }, [
    captureEvent,
    captureCalendar,
    source,
    config.markStyle,
    config.dateFormat,
    runNow,
  ]);


  const askSaveTaskForm = useCallback(() => {
    if (!taskForm) {
      return;
    }
    const summary = taskForm.summary.trim();
    if (!summary) {
      setStatus({kind: 'error', message: 'Give the task a title.'});
      return;
    }
    const editing = editingTask;
    if (!editing && taskTargets.length === 0) {
      setStatus({kind: 'error', message: 'Tick at least one list to save into.'});
      return;
    }
    void runNow({
      title: editing ? 'Save changes?' : 'Create task?',
      reload: 'tasks',
      body: editing
        ? `"${summary}" will be updated on the server.`
        : `"${summary}" will be added to ${taskTargets.map(collectionName).join(', ')}.`,
      label: editing ? 'Yes, save' : 'Yes, create',
      run: async () => {
        const payload = {
          summary,
          description: taskForm.description.trim() || undefined,
          dueDate: taskForm.dueDate || undefined,
          dueTime: taskForm.dueTime || undefined,
          // An untouched band writes back the number that was already there, so
          // editing a title does not quietly rewrite another client's
          // PRIORITY:3 as this plugin's PRIORITY:1. Only an actual change to
          // the chosen band picks a new number.
          priority:
            editing && taskForm.priority === bandOf(editing.priority)
              ? editing.priority
              : valueOf(taskForm.priority),
          // null means "the stored rule is one this menu cannot name" — leave
          // it alone. undefined is what the writers read as leave-alone.
          rrule: ruleFor(taskForm.repeat) ?? undefined,
        };
        let made = 0;
        let failed = 0;
        if (editing) {
          await editTask(getConfig(), editing, payload);
          const added = await addSteps(
            getConfig(),
            editing.uid,
            taskForm.steps,
            editing.collectionUrl,
            // Steps inherit the task's own due date unless a date was chosen for
            // them. A step of something due Friday is almost always due by
            // Friday too, and a line can still name its own date to override
            // either.
            taskForm.stepsDate || taskForm.dueDate || undefined,
            taskForm.stepsDate ? taskForm.stepsTime || undefined : taskForm.dueTime || undefined,
          );
          made = added.made;
          failed = added.failed;
        } else {
          // A separate UID per collection, so steps hang off the copy that
          // lives in the same list as their parent rather than off one of them
          // from all of them.
          // Collections are written together rather than one after another:
          // saving into two lists is two independent PUTs, and waiting for the
          // first to finish before starting the second doubles the wait for no
          // benefit. Steps still follow their own parent, so a step is never
          // written before the task it belongs to exists.
          const perTarget = await Promise.all(
            taskTargets.map(async url => {
              const uid = newUid();
              await putTask(getConfig(), {uid, ...payload}, url);
              return addSteps(
                getConfig(),
                uid,
                taskForm.steps,
                url,
                taskForm.stepsDate || taskForm.dueDate || undefined,
                taskForm.stepsDate
                  ? taskForm.stepsTime || undefined
                  : taskForm.dueTime || undefined,
              );
            }),
          );
          for (const added of perTarget) {
            made += added.made;
            failed += added.failed;
          }
        }
        setTaskForm(null);
        setEditingTask(null);
        return `Saved successfully — "${summary}".${saidAboutSteps(made, failed)}`;
      },
    });
  }, [taskForm, editingTask, taskTargets, runNow]);

  /**
   * The configured note settings for a period. Day keeps its own config so a
   * daily note's path is decided by exactly the settings that have always
   * decided it.
   */
  const noteConfigFor = useCallback(
    (period: Period, cfg: ServerConfig) =>
      period === 'day'
        ? cfg.dailyNote
        : period === 'week'
          ? cfg.weekNote
          : period === 'month'
            ? cfg.monthNote
            : cfg.quarterNote,
    [],
  );

  /**
   * Open the note for a week, month or quarter, or offer to create it.
   *
   * The same shape as `askDailyNote`: opening is not a write, so it goes
   * straight there, while creating asks first and names the path it will use.
   */
  const askPeriodNote = useCallback(
    (period: Period, iso: string, exists: boolean) => {
      const cfg = getConfig();
      const noteConfig = noteConfigFor(period, cfg);
      const path = periodNotePath(period, noteConfig, iso, cfg.dateFormat);
      if (!path) {
        setStatus({kind: 'error', message: 'Could not build a note path for that period.'});
        return;
      }
      const said = periodLabel(period, iso, cfg.dateFormat);

      if (exists) {
        setStatus({kind: 'working', message: 'Opening note…'});
        void (async () => {
          try {
            // Dismiss the plugin view BEFORE handing over, or the host keeps
            // believing it is still showing.
            leaveForNote();
            await openPeriodNote(period, noteConfig, iso, cfg.dateFormat);
          } catch (err) {
            setStatus({kind: 'error', message: describe(err)});
          }
        })();
        return;
      }

      setAsk({
        title: `Create a note for the ${period}?`,
        body: `A new note for ${said} will be created at ${path}.`,
        label: 'Yes, create',
        run: async () => {
          await createPeriodNote(period, noteConfig, iso, cfg.dateFormat);
          leaveForNote();
          await openPeriodNote(period, noteConfig, iso, cfg.dateFormat);
          return `Saved successfully — created ${path}.`;
        },
      });
    },
    [leaveForNote, noteConfigFor],
  );

  /**
   * Draw the day's agenda into its note, as a background to write over.
   *
   * Never automatic, and never into a note that does not exist — this writes
   * into somebody's own file, so it is a button they press on the day they are
   * looking at, confirmed before anything happens.
   *
   * The events and tasks are the ones already on screen. Nothing is fetched:
   * `eventsRef` and `tasksRef` hold the day's content by the time this button
   * can be pressed, so the page is a snapshot of exactly what the user is
   * looking at rather than a second, possibly different, read.
   */
  const askCalendarPage = useCallback(
    (iso: string, kind: 'day' | 'week' | 'month') => {
      // Built from what is already on screen, so the page is a copy of the Day
      // view rather than a second, possibly different, read of the data.
      const minutes = (hhmm?: string) => {
        const match = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
        return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
      };
      const dayEvents = eventsOnDay(eventsRef.current, iso);
      const agenda: DayAgenda = {
        allDay: dayEvents
          .filter(e => e.allDay || minutes(e.startTime) === undefined)
          .map(e => ({title: e.summary, subtitle: e.calendarLabel})),
        timed: dayEvents
          .filter(e => !e.allDay && minutes(e.startTime) !== undefined)
          .map(e => ({
            title: e.summary,
            subtitle: e.calendarLabel,
            startMin: minutes(e.startTime),
            endMin: minutes(e.endTime) ?? (minutes(e.startTime) ?? 0) + 60,
          })),
        dueToday: tasksOnDay(tasksRef.current, iso)
          .filter(t => !t.completed)
          .map(t => ({title: t.summary, subtitle: t.collectionLabel})),
        upcoming: [],
      };

      // The same seven days the Day view lists down its right-hand side.
      const soon = new Map<string, {title: string; subtitle?: string}[]>();
      for (let i = 1; i <= 7; i++) {
        const when = shiftDays(iso, i);
        const rows = tasksOnDay(tasksRef.current, when)
          .filter(t => !t.completed)
          .map(t => ({title: t.summary, subtitle: t.collectionLabel}));
        if (rows.length > 0) {
          soon.set(when, rows);
        }
      }
      agenda.upcoming = Array.from(soon.entries()).map(([date, rows]) => ({
        date: formatDate(date, getConfig().dateFormat),
        rows,
      }));

      // Week and month are deliberately empty boxes. The schedule is drawn only
      // on the day page, where the agenda is the thing being written over; a
      // month with every cell full has nowhere left to write, which is the
      // whole point of the page.
      const build = (page: PageSize): Background => {
        if (kind === 'week') {
          // Day name and date together, in the row's own gutter: "Mon 14".
          // The name has to be on the page somewhere and a header strip above
          // seven rows would cost a row's worth of writing space.
          return weekBackground(
            page,
            weekOf(iso).map(d => {
              const at = new Date(`${d}T00:00:00`);
              return {label: `${WEEKDAYS[at.getDay()]} ${at.getDate()}`};
            }),
          );
        }
        if (kind === 'month') {
          const at = new Date(`${iso}T00:00:00`);
          const cells = monthGrid(at.getFullYear(), at.getMonth());
          return monthBackground(
            page,
            cells.length / 7,
            cells.map((c: {day: number | null}) => (c.day === null ? '' : String(c.day))),
          );
        }
        return dayBackground(page, agenda, m =>
          formatTime(`${String(Math.floor(m / 60)).padStart(2, '0')}:00`, getConfig().timeFormat),
        );
      };

      setAsk({
        title: 'Add a calendar page?',
        // Into the note being read, because that is where the host can draw:
        // the insert writes the in-memory page, so the page it writes to is
        // whichever one is displayed.
        body:
          kind === 'day'
            ? `A blank page will be added to the note you are in, after the page you are on, carrying ${formatDate(iso, getConfig().dateFormat)}'s events and to-dos as a background to write over.`
            : `A blank page will be added to the note you are in, after the page you are on, with an empty ${kind} grid and a ruled notes area to write in.`,
        label: 'Yes, add it',
        run: async () => {
          const report = await writeBackground(build);
          if (report.error) {
            throw new Error(report.error);
          }
          // The timings are reported out loud on purpose, for this first build:
          // whether two hundred elements is fast enough decides whether the
          // quarter page is drawn or rastered, and guessing it is what this
          // whole exercise has been trying to avoid.
          // Everything worth knowing is said on screen rather than logged.
          // There is no adb on the machine this is built from, so a log line is
          // invisible to the only person who can see the device.
          return (
            `Saved successfully — ${report.elements} element(s) in ${report.ms}ms ` +
            `(${report.allocateMs}ms allocating). Template used: "${report.template}". ` +
            `Presets offered: ${report.presets.join(', ') || 'none'}.`
          );
        },
      });
    },
    [],
  );

  const askDailyNote = useCallback(
    (iso: string, exists: boolean) => {
      // Guarded here rather than in runAsk alone: the "already exists" branch
      // opens a file without going through a confirmation.
      const cfg = getConfig();
      const path = dailyNotePath(cfg.dailyNote, iso, cfg.dateFormat);
      if (!path) {
        setStatus({kind: 'error', message: 'Could not build a note path for that date.'});
        return;
      }

      if (exists) {
        // Opening is not a write, so it skips the confirmation and just goes.
        setStatus({kind: 'working', message: 'Opening note…'});
        void (async () => {
          try {
            // Dismiss the plugin view BEFORE handing over, or the host keeps
            // believing it is still showing and the next press only closes it.
            leaveForNote();
            await openDailyNote(cfg.dailyNote, iso, cfg.dateFormat);
          } catch (err) {
            setStatus({kind: 'error', message: describe(err)});
          }
        })();
        return;
      }

      setAsk({
        title: 'Create daily note?',
        body: `A new note will be created at ${path}.`,
        label: 'Yes, create',
        run: async () => {
          await createDailyNote(cfg.dailyNote, iso, cfg.dateFormat);

          // BEFORE the handover, and before the note is opened.
          //
          // This writes into the file, so it needs neither the note displayed
          // nor a lasso nor anything else the plugin view owns — and doing it
          // here means the plugin is still up to report what happened. The
          // first attempt ran after `leaveForNote`, which had already called
          // closePluginView, and the date silently never appeared.
          let note = '';
          if (cfg.dailyNote.dateHeading) {
            const failure = await writeDateHeading(
              await absoluteNotePath(path),
              formatDate(iso, cfg.dateFormat),
            );
            if (failure) {
              console.log(`[TaskHub] date heading failed — ${failure}`);
              // Said out loud rather than only logged. A silent no-op is
              // indistinguishable from the setting not working at all, which is
              // exactly how the first attempt at this failed.
              note = ` The date could not be written — ${failure}.`;
            }
          }

          // Close first, then open — the host keeps believing the plugin view
          // is up if closePluginView runs after openFile.
          leaveForNote();
          await openDailyNote(cfg.dailyNote, iso, cfg.dateFormat);
          return `Saved successfully — created ${path}.${note}`;
        },
      });
    },
    [leaveForNote],
  );

  /**
   * Jump to the note a task was captured from.
   *
   * Not a write, so no confirmation — but the plugin view is dismissed first,
   * for the same host-state reason as opening a daily note.
   */
  const openSource = useCallback(
    (task: RemoteTask) => {
      if (!task.sourcePath) {
        return;
      }
      setStatus({kind: 'working', message: 'Opening source page…'});
      void (async () => {
        try {
          // Same bookmark as the note paths: jumping to a task's source page is
          // also leaving the plugin, and coming back should land where it was.
          leaveForNote();
          await openFileAt(task.sourcePath!, task.sourcePage ?? 0);
        } catch (err) {
          setStatus({kind: 'error', message: describe(err)});
        }
      })();
    },
    [leaveForNote],
  );

  /**
   * Open the note a result points at, on that page.
   *
   * Not a write, so no confirmation — but the plugin view is dismissed first,
   * for the same host-state reason as every other handover to the note app.
   */
  const openFound = useCallback(
    (path: string, page: number) => {
      setStatus({kind: 'working', message: 'Opening note…'});
      void (async () => {
        try {
          leaveForNote();
          await openNoteAt(path, page);
        } catch (err) {
          setStatus({kind: 'error', message: describe(err)});
        }
      })();
    },
    [leaveForNote],
  );

  const askEventNote = useCallback(
    (event: RemoteEvent, exists: boolean) => {
      const cfg = getConfig();
      if (exists) {
        setStatus({kind: 'working', message: 'Opening note…'});
        void (async () => {
          try {
            close();
            await openMeetingNote(cfg.meetingNote, event, cfg.meetingLinks, meetingFiles);
          } catch (err) {
            setStatus({kind: 'error', message: describe(err)});
          }
        })();
        return;
      }

      setAsk({
        title: 'Create meeting note?',
        body: `A note will be linked to "${event.summary}". Every occurrence of a repeating event shares it.`,
        label: 'Yes, create',
        run: async () => {
          const created = await createMeetingNote(cfg.meetingNote, event, meetingFiles);
          // Record the link before opening: the map is what makes the note
          // findable again, and it must survive even if opening misbehaves.
          const linked = {...getConfig(), meetingLinks: {...cfg.meetingLinks, [event.uid]: created}};
          setConfig(linked);
          setLocalConfig(linked);
          await saveSettings(linked).catch(() => undefined);
          close();
          await openNote(created);
          return `Saved successfully — note created for "${event.summary}".`;
        },
      });
    },
    [close, meetingFiles],
  );

  const askComplete = useCallback((task: RemoteTask) => {
    // A task captured from handwriting leaves a box on that page. Once it is
    // done the box is stale, so completing the task clears it — and the
    // confirmation says so, because it edits the user's own note.
    const marked = !!task.sourcePath;
    const action: Ask = {
      title: 'Mark task complete?',
      reload: 'tasks',
      body: marked
        ? `"${task.summary}" will be marked complete on the server, and the box removed from the page it came from.`
        : `"${task.summary}" will be marked complete on the server.`,
      label: 'Yes, complete',
      run: async () => {
        await completeTask(getConfig(), task);

        let note = '';
        if (marked) {
          const failure = await removePageMark({
            path: task.sourcePath as string,
            page: task.sourcePage ?? 0,
          });
          // Only the failure is worth saying. Removing the box is the expected
          // outcome of completing a captured task, and announcing it every time
          // is noise — kept here in case it is wanted back.
          // note = ' Box removed from the page.';
          note = failure ? ` The box on the page could not be removed — ${failure}.` : '';
        }
        return `Saved successfully — "${task.summary}" completed.${note}`;
      },
    };
    // Only a captured task asks first, and only because completing it edits the
    // user's own note by removing the box from the page. Ticking an ordinary
    // task changes nothing but the task, and a dialog confirming what the tap
    // already said is friction on the most common action in the plugin.
    if (marked) {
      setAsk(action);
    } else {
      void perform(action);
    }
  }, [perform]);

  const askSaveEvent = useCallback(() => {
    if (!eventForm) {
      return;
    }
    const summary = eventForm.summary.trim();
    if (!summary) {
      setStatus({kind: 'error', message: 'Give the event a title.'});
      return;
    }
    if (!eventForm.date) {
      setStatus({kind: 'error', message: 'Pick a date for the event.'});
      return;
    }
    const editing = editingEvent;
    if (!editing && !eventTarget) {
      setStatus({kind: 'error', message: 'Choose a calendar to save into.'});
      return;
    }
    setAsk({
      title: editing ? 'Save changes?' : 'Create event?',
      reload: 'events',
      body: `"${summary}" on ${formatDate(eventForm.date, config.dateFormat)}.`,
      label: editing ? 'Yes, save' : 'Yes, create',
      run: async () => {
        const payload = {
          summary,
          description: eventForm.description.trim() || undefined,
          location: eventForm.location.trim() || undefined,
          date: eventForm.date,
          startTime: eventForm.startTime || undefined,
          endTime: eventForm.endTime || undefined,
          rrule: ruleFor(eventForm.repeat) ?? undefined,
        };
        if (editing) {
          await editEvent(getConfig(), editing, payload);
        } else {
          await createEvent(getConfig(), eventTarget, {uid: newUid(), ...payload});
        }
        setEventForm(null);
        setEditingEvent(null);
        return `Saved successfully — "${summary}".`;
      },
    });
  }, [eventForm, editingEvent, eventTarget, config.dateFormat]);

  /**
   * The settings form's change handler.
   *
   * Marks the form as edited before forwarding, so a settings load still in
   * flight does not overwrite what is being typed.
   */
  const changeConfig = useCallback<React.Dispatch<React.SetStateAction<ServerConfig>>>(
    update => {
      settingsEditedRef.current = true;
      setLocalConfig(update);
    },
    [],
  );

  /**
   * Subscribe to the address in the box.
   *
   * The name is the host until the first fetch reads the calendar's own
   * `X-WR-CALNAME`, at which point `refresh` renames it — so nobody has to type
   * a name, and the list still ends up saying "Work" rather than
   * "calendar.google.com".
   */
  const addFeedFromDraft = useCallback(() => {
    const {url, error} = normaliseFeedUrl(feedDraft);
    if (!url) {
      setFeedMessage(FEED_URL_MESSAGES[error ?? 'malformed']);
      return;
    }
    changeConfig(c => ({...c, feeds: addFeed(c.feeds, {url, name: defaultFeedName(url)})}));
    setFeedDraft('');
    setFeedMessage('Calendar added. Press Save settings, then Refresh on the Calendar tab.');
  }, [feedDraft, changeConfig]);

  /**
   * Subscribe to every address in `Document/TaskHub/calendars.txt`.
   *
   * A fixed path rather than a file browser, deliberately. The file exists at
   * all because a private calendar address is about a hundred characters of
   * random and typing one here is miserable — so the flow is "drop a file on
   * the device over USB, press one button", and a browser to find it again
   * would put back some of the fiddling the file was meant to remove.
   */
  const importFeedFile = useCallback(() => {
    setFeedBusy(true);
    setFeedMessage('Looking for the file…');
    void (async () => {
      const folder = 'Document/TaskHub';
      try {
        // Listed rather than opened blind. Asking for one exact filename could
        // only ever say "no file", which is the same answer whether it is
        // missing, named Calendars.TXT, or in the wrong folder.
        const names = await listFilesHere(folder, ['.txt']);
        const chosen = pickFeedListFile(names, FEED_LIST_FILE);

        if (!chosen) {
          setFeedMessage(
            names.length === 0
              ? `No .txt file in ${folder}. Put ${FEED_LIST_FILE} there — the same folder as settings.json — and try again.`
              : `Could not tell which file to use. ${folder} holds: ${names.join(', ')}. Rename the right one to ${FEED_LIST_FILE}.`,
          );
          return;
        }

        const text = await readNamed(chosen);
        if (text === null) {
          setFeedMessage(
            `${folder}/${chosen} could not be read. If ${APP_NAME} has asked for file permission, allow it and try again.`,
          );
          return;
        }
        if (text.trim() === '') {
          setFeedMessage(`${folder}/${chosen} is empty.`);
          return;
        }

        const {feeds: found, skipped, firstBad} = parseFeedList(text);
        if (found.length === 0) {
          // The offending line is quoted back. "Nothing usable" on its own
          // leaves somebody re-reading a file that looks fine to them, when the
          // answer is usually an http:// address or a stray character.
          setFeedMessage(
            firstBad
              ? `No usable address in ${chosen}. Every line needs an https:// address; this one is not — "${firstBad.slice(0, 80)}"`
              : `No usable address in ${chosen}. Every line needs an https:// address.`,
          );
          return;
        }

        let added = 0;
        changeConfig(c => {
          const merged = mergeFeeds(c.feeds, found);
          added = merged.added;
          return {...c, feeds: merged.feeds};
        });
        const already = found.length - added;
        const dupes = already > 0 ? ` ${already} already subscribed.` : '';
        const ignored =
          skipped > 0 ? ` ${skipped} line(s) were not addresses and were ignored.` : '';
        setFeedMessage(
          `Read ${found.length} address(es) from ${chosen}. Added ${added}.${dupes}${ignored} Press Save settings, then delete the file.`,
        );
      } catch (err) {
        // Nothing may fail silently here. An import that throws and says
        // nothing is indistinguishable from a button that is not wired up,
        // which is exactly how this looked on device.
        setFeedMessage(`Could not read ${folder} — ${describe(err)}`);
      } finally {
        setFeedBusy(false);
      }
    })();
  }, [changeConfig]);

  /**
   * Fetch the account's to-do lists, so there is something to tick.
   *
   * Separate from signing in: a session saved on a previous visit is still
   * good, and the lists have to be fetched again to show it.
   */
  const loadSnLists = useCallback(
    async (token: string) => {
      try {
        // The tasks are read as well as the lists, only so the Inbox can be
        // offered when — and only when — something is actually in it. It is one
        // extra request, on a screen the user asked to refresh: a cheaper place
        // to pay for it than the opening screen.
        const [live, read] = await Promise.all([listSnLists(token), readSnTasks(token)]);
        const loaded = read.tasks;
        const lists = snListsWithUnfiled(live, loaded);
        setSnLists(lists);
        setSnCounts(snOpenCounts(live, loaded));
        // Why the Inbox is absent, when it is. Said here rather than left to be
        // inferred: a missing row looks identical to a broken feature.
        const why = snUnfiledNote(live, loaded);
        setSnMessage(
          lists.length === 0
            ? 'Signed in, but this account has no to-do lists.'
            : `Signed in. Tick the lists to show, then Save settings.${why ? ` ${why}` : ''}${
                read.truncated ? ` ${SN_CAPPED}` : ''
              }`,
        );
      } catch (err) {
        setSnMessage(describe(err));
      }
    },
    [],
  );

  /** Step one: offer the password and ask for the emailed code. */
  const snSignIn = useCallback(() => {
    setSnBusy(true);
    setSnMessage('Signing in…');
    void (async () => {
      try {
        const started = await beginSignIn(snEmail, snPassword);
        // The password has done its job. It is not kept for a moment longer
        // than the request that used it: settings.json is plain text on shared
        // storage, and a token that expires in thirty days is a far smaller
        // thing to leak than an account password that does not.
        setSnPassword('');
        if (started.token) {
          changeConfig(c => ({
            ...c,
            supernote: {...c.supernote, enabled: true, email: snEmail.trim(), token: started.token as string},
          }));
          await loadSnLists(started.token);
          return;
        }
        setSnPending({
          validCodeKey: started.validCodeKey ?? '',
          timestamp: started.timestamp,
        });
        setSnMessage(
          `A verification code has been emailed to ${snEmail.trim()}. Type it below — they expire quickly.`,
        );
      } catch (err) {
        setSnMessage(describe(err));
      } finally {
        setSnBusy(false);
      }
    })();
  }, [snEmail, snPassword, changeConfig, loadSnLists]);

  /** Step two: exchange the emailed code for the thirty-day session. */
  const snVerify = useCallback(() => {
    if (!snPending) {
      return;
    }
    setSnBusy(true);
    setSnMessage('Checking the code…');
    void (async () => {
      try {
        const token = await finishSignIn(
          snEmail,
          snCode,
          snPending.validCodeKey,
          snPending.timestamp,
        );
        changeConfig(c => ({
          ...c,
          supernote: {...c.supernote, enabled: true, email: snEmail.trim(), token},
        }));
        setSnPending(null);
        setSnCode('');
        await loadSnLists(token);
      } catch (err) {
        setSnMessage(describe(err));
      } finally {
        setSnBusy(false);
      }
    })();
  }, [snEmail, snCode, snPending, changeConfig, loadSnLists]);

  /**
   * Forget the session.
   *
   * Only this device forgets it. Nothing is changed on the Supernote account,
   * no to-do is touched, and signing in again restores exactly what was here.
   */
  const snSignOut = useCallback(() => {
    changeConfig(c => ({...c, supernote: {...DEFAULT_SN_CONFIG}}));
    setSnLists([]);
    setSnPending(null);
    setSnCode('');
    setSnMessage('Signed out on this device. Nothing on your Supernote account was changed.');
  }, [changeConfig]);

  /** Unsubscribe, and throw away the copy of the feed kept on disk. */
  const removeFeedByUrl = useCallback(
    (url: string) => {
      changeConfig(c => ({...c, feeds: removeFeed(c.feeds, url)}));
      void forgetFeed(url).catch(() => undefined);
    },
    [changeConfig],
  );

  // ---- settings ----

  const discover = useCallback(async () => {
    setConfig(config);
    if (!canDiscover(config)) {
      setStatus({kind: 'error', message: 'Enter the server URL and username first.'});
      return;
    }
    setStatus({kind: 'working', message: 'Looking for collections…'});
    try {
      const {collections: found, home} = await discoverCollections(config);
      setCollections(found);
      setLocalCollections(found);
      // The calendar home is not a collection, but earlier builds listed it as
      // one — a Depth:1 enumeration always describes the collection it was sent
      // to — so a tick on it may already be saved. Discovery is the only moment
      // the home's URL is known, and so the only chance to prune it.
      let dropped = 0;
      changeConfig(c => {
        const pruned = forgetCollections(c, [home]);
        dropped =
          c.collectionUrls.length +
          c.calendarUrls.length -
          (pruned.collectionUrls.length + pruned.calendarUrls.length);
        return pruned;
      });
      setStatus({
        kind: 'done',
        message:
          `Found ${found.length} collection(s). Tick what to use, then Save settings.` +
          (dropped > 0
            ? ' Your account folder was removed from the list — it is where your'
              + ' collections live, not one of them.'
            : ''),
      });
    } catch (err) {
      setStatus({kind: 'error', message: describe(err)});
    }
  }, [config, changeConfig]);

  /**
   * Write the settings, reporting whether they were stored.
   *
   * Returns false when nothing was saved — a storage failure — so the caller
   * can decline to say "Setup saved" and leave.
   */
  const persistSettings = useCallback(async (): Promise<boolean> => {
    // Deliberately no requirement to have ticked anything. The note features —
    // daily, weekly, monthly, quarterly and yearly notes, meeting notes, the
    // templates and folders they use — need no server at all, and refusing to
    // save settings until a task list was chosen made those unreachable for
    // anybody not running a CalDAV server.
    setConfig(config);
    const summary =
      hasCollections(config) || hasCalendars(config)
        ? `${config.collectionUrls.length} task list(s) and ${config.calendarUrls.length} calendar(s)`
        : 'note settings (no server configured)';

    if (!storageAvailable()) {
      setStatus({kind: 'done', message: `Saved for this session — ${summary}.`});
      void refresh();
      return true;
    }

    setStatus({kind: 'working', message: 'Saving settings…'});
    try {
      const path = await saveSettings(config);
      setStorePath(path);
      setStatus({kind: 'done', message: `Saved successfully — ${summary}. Stored on device.`});
    } catch (err) {
      // The settings still apply this session even if the file could not be
      // written, so say exactly that rather than implying nothing happened.
      setStatus({
        kind: 'error',
        message: `Applied for this session, but could not save to disk: ${describe(err)}`,
      });
    }
    void refresh();
    return true;
  }, [config, refresh]);

  /**
   * Save the settings, say so, and leave.
   *
   * The confirmation is shown before the plugin closes rather than after —
   * "Setup saved" is the whole point of pressing the button, and a message that
   * flashes past as the view disappears has not been read.
   */
  const saveSettingsAndExit = useCallback(() => {
    void (async () => {
      const ok = await persistSettings();
      if (!ok) {
        // persistSettings has already said what went wrong; staying on the page
        // is what lets the user do something about it.
        return;
      }
      setStatus({kind: 'done', message: 'Settings saved'});
      // Just long enough for the message to register. 2.5s was tried and felt
      // like waiting for the plugin rather than reading a confirmation — on a
      // panel that redraws slowly, the redraw is already most of the pause.
      scheduleClose(900);
    })();
  }, [persistSettings, scheduleClose]);


  /**
   * Erase everything stored on the device.
   *
   * Uninstalling the plugin leaves the settings file behind by design — it
   * lives outside the plugin's private directory so it survives updates — so
   * this is the only way to get back to a clean install.
   */
  /**
   * Put every kind of note in one dated tree.
   *
   * Sets the six roots to the same folder and the five layouts to the ones that
   * nest inside each other. Confirmed first, because it overwrites folder and
   * layout settings the user may have arranged deliberately — and because the
   * consequence worth saying out loud is that existing notes are not moved.
   */
  const askShareTree = useCallback(() => {
    setAsk({
      title: 'Use one folder for all notes?',
      body:
        `Sets every note type's folder to ${SHARED_TREE_ROOT} and its layout to the ` +
        'matching dated scheme, so the year, quarter, month, week and daily notes ' +
        'all nest in one tree. Notes you already have are NOT moved: until you ' +
        'move them yourself they will show as "Create" rather than "Open". ' +
        'Nothing is written until you save these settings.',
      label: 'Use one folder',
      run: async () => {
        changeConfig(c => ({
          ...c,
          dailyNote: {...c.dailyNote, root: SHARED_TREE_ROOT, layout: SHARED_TREE_LAYOUTS.day},
          weekNote: {...c.weekNote, root: SHARED_TREE_ROOT, layout: SHARED_TREE_LAYOUTS.week},
          monthNote: {...c.monthNote, root: SHARED_TREE_ROOT, layout: SHARED_TREE_LAYOUTS.month},
          quarterNote: {
            ...c.quarterNote,
            root: SHARED_TREE_ROOT,
            layout: SHARED_TREE_LAYOUTS.quarter,
          },
          yearNote: {...c.yearNote, root: SHARED_TREE_ROOT, layout: SHARED_TREE_LAYOUTS.year},
          // Meeting notes join the tree but keep their own layout: theirs is
          // built from an event's title, not from a date alone, so there is no
          // dated scheme here that would fit them.
          meetingNote: {...c.meetingNote, root: SHARED_TREE_ROOT},
        }));
        return 'Every note type now uses one folder. Save to keep it.';
      },
    });
  }, [changeConfig]);

  /**
   * Stop watching the collections the server no longer has.
   *
   * Written straight out rather than staged into the settings form: the user is
   * answering a warning on the hub, not editing settings, and leaving it unsaved
   * would bring the same warning back on the next refresh.
   */
  const forgetMissing = useCallback(() => {
    const gone = missing.map(m => m.url);
    const next = forgetCollections(getConfig(), gone);
    setConfig(next);
    setLocalConfig(next);
    setMissing([]);
    void saveSettings(next).catch(() => undefined);
    setStatus({
      kind: 'done',
      message:
        gone.length === 1
          ? `Removed "${missing[0].label}". It is no longer watched.`
          : `Removed ${gone.length} collections that are no longer on the server.`,
    });
    void refresh('opening');
  }, [missing, refresh]);

  const askWipe = useCallback(() => {
    setAsk({
      title: 'Wipe all saved data?',
      body:
        'Clears the server address, username, password, chosen task lists and ' +
        'calendars, date and time formats, note folders, and the links between ' +
        'calendar events and their meeting notes. Your notes and everything on ' +
        'the server are left alone. This cannot be undone.',
      label: 'Yes, wipe',
      run: async () => {
        await wipeSettings();
        setConfig(EMPTY_CONFIG);
        settingsEditedRef.current = false;
        setLocalConfig(EMPTY_CONFIG);
        setCollections([]);
        setLocalCollections([]);
        setTasks([]);
        setEvents([]);
        // Dead-list warnings belonged to the configuration just erased.
        setMissing([]);
        setTargets([]);
        setTaskTargets([]);
        setEventTarget('');
        return 'Wiped successfully — no saved data remains on this device.';
      },
    });
  }, []);

  // ---- derived ----

  const open = useMemo(() => tasks.filter(t => !t.completed), [tasks]);
  const done = useMemo(() => tasks.filter(t => t.completed), [tasks]);
  // Arranged into families rather than a flat sort: Task Hub writes
  // RELATED-TO onto a task that is a step of another, and without this a piece
  // of work arrives as several unrelated rows.
  const listed = useMemo(
    () => visible(arrange(searchTasks(open, query), sortKey), openSteps),
    [open, query, sortKey, openSteps],
  );
  /**
   * The same rows, cut into Overdue / Today / Next 7 days / Later / No date.
   *
   * The flat sort meant "what is late" — the question most people open a to-do
   * list to ask — had to be worked out by reading dates down the page. The cuts
   * are the ones `DUE_FILTERS` already named and nothing used.
   *
   * Cut against `openedAt` rather than a fresh `new Date()` so the sections are
   * a real function of their inputs: the React tree outlives a close, and a
   * plugin left loaded overnight would otherwise still be calling yesterday
   * "today" until something unrelated happened to re-render it.
   */
  const sections = useMemo(
    () =>
      groupRows(
        listed,
        DUE_BUCKETS.map(b => b.key),
        todo => dueBucket(todo, new Date(openedAt)),
      ),
    [listed, openedAt],
  );
  // Finished steps stay with the other finished things rather than under a
  // parent that may still be open: this section exists to be opened and
  // un-ticked, and a step hidden behind a fold could not be reached.
  const listedDone = useMemo(
    () => sortTasks(searchTasks(done, query), sortKey),
    [done, query, sortKey],
  );
  const monthDays = useMemo(() => {
    const cells: string[] = [];
    const total = new Date(view.year, view.month + 1, 0).getDate();
    for (let d = 1; d <= total; d++) {
      cells.push(toDateInput(new Date(view.year, view.month, d)));
    }
    return cells;
  }, [view]);

  /**
   * Whether the period covering the selected day already has a note. Computed
   * from the paths already listed rather than asked of the device per render.
   */
  /**
   * Which weeks in the month on screen already have a note, keyed by their
   * Sunday. Computed once for the grid rather than per row, and from the paths
   * already listed rather than by asking the device.
   */
  const weekNotesInView = useMemo(() => {
    const found = new Set<string>();
    for (const iso of monthDays) {
      const start = periodStart('week', iso);
      if (
        start &&
        !found.has(start) &&
        hasPeriodNote(periodFiles.week, 'week', config.weekNote, start, config.dateFormat)
      ) {
        found.add(start);
      }
    }
    return found;
  }, [monthDays, periodFiles.week, config.weekNote, config.dateFormat]);

  const hasWeekNote = useMemo(
    () => hasPeriodNote(periodFiles.week, 'week', config.weekNote, day, config.dateFormat),
    [periodFiles.week, config.weekNote, day, config.dateFormat],
  );
  const hasMonthNote = useMemo(
    () => hasPeriodNote(periodFiles.month, 'month', config.monthNote, day, config.dateFormat),
    [periodFiles.month, config.monthNote, day, config.dateFormat],
  );
  const hasYearNote = useMemo(
    () => hasPeriodNote(periodFiles.year, 'year', config.yearNote, day, config.dateFormat),
    [periodFiles.year, config.yearNote, day, config.dateFormat],
  );
  const hasQuarterNote = useMemo(
    () =>
      hasPeriodNote(periodFiles.quarter, 'quarter', config.quarterNote, day, config.dateFormat),
    [periodFiles.quarter, config.quarterNote, day, config.dateFormat],
  );

  const noteDays = useMemo(
    () => daysWithNotes(noteFiles, monthDays, config.dailyNote, config.dateFormat),
    [noteFiles, monthDays, config.dailyNote, config.dateFormat],
  );

  // The week view can straddle two months, so it needs its own lookup.
  const weekNoteDays = useMemo(
    () => daysWithNotes(noteFiles, weekOf(day), config.dailyNote, config.dateFormat),
    [noteFiles, day, config.dailyNote, config.dateFormat],
  );

  const dayHasNote = useMemo(
    () => daysWithNotes(noteFiles, [day], config.dailyNote, config.dateFormat).has(day),
    [noteFiles, day, config.dailyNote, config.dateFormat],
  );

  /**
   * The events every view actually draws: repeats turned into the days they
   * fall on.
   *
   * Derived rather than stored. `events` stays exactly as the server sent it —
   * one master VEVENT per series — because that is what gets cached, merged
   * when the window widens, and written back on an edit. Expanding into state
   * would put invented objects on all three of those paths.
   */
  const shownEvents = useMemo(
    () => expandEvents(events, eventWindow),
    [events, eventWindow],
  );

  const eventNotes = useMemo(
    () => eventsWithNotes(meetingFiles, shownEvents, config.meetingNote, config.meetingLinks),
    [meetingFiles, shownEvents, config.meetingNote, config.meetingLinks],
  );

  const marks = useMemo(
    () => monthMarks(shownEvents, tasks, noteDays),
    [shownEvents, tasks, noteDays],
  );
  const dayEvents = useMemo(() => eventsOnDay(shownEvents, day), [shownEvents, day]);
  const dayTasks = useMemo(() => tasksOnDay(open, day), [open, day]);

  if (screen === 'idle') {
    return <View style={styles.root} />;
  }

  const {dateFormat, timeFormat} = config;
  const calendars = collections.filter(acceptsEvents);

  const openEventEditor = (event: RemoteEvent) => {
    // A subscribed calendar is one file fetched over HTTPS; there is no address
    // to write an edit back to. Said here, where the user tapped, rather than
    // discovered by a save that fails — and said in terms of the calendar
    // rather than of the plugin, because the limit is the subscription's.
    if (event.readOnly) {
      setNotice({
        title: 'Subscribed calendar',
        body: `"${event.summary}" comes from ${event.calendarLabel}, which Task Hub subscribes to and can only read. Change it in the calendar it belongs to. You can still attach a note to it.`,
      });
      return;
    }
    setEditingEvent(event);
    setEventTarget(event.calendarUrl);
    setEventMore(false);
    setEventForm({
      summary: event.summary,
      description: event.description ?? '',
      location: event.location ?? '',
      // The SERIES' start date, not the occurrence's.
      //
      // A repeating event is one object on the server, and saving this form
      // writes that object's DTSTART. Seeding the form with the occurrence the
      // user happened to tap would move the whole series onto that date the
      // moment they saved anything at all — change the title on the 14th and
      // every past occurrence silently jumps. The occurrence marker is set
      // only by `expandEvents`, so a one-off event is unaffected.
      date: event.occurrence?.seriesStartDate ?? event.startDate,
      startTime: event.occurrence?.seriesStartTime ?? event.startTime ?? '',
      endTime: event.endTime ?? '',
      repeat: repeatKey(event.rrule),
    });
    setStatus(null);
  };

  const openTaskEditor = (task: RemoteTask | null) => {
    // Always on the first page: an editor that opened onto the fold it was last
    // left showing would hide the title of the task you just tapped.
    setTaskMore(false);
    // The mirror of the New event button: clear the other form so neither can
    // shadow the one being opened.
    setEventForm(null);
    setEditingEvent(null);
    setEditingTask(task);
    setTaskTargets(task ? [task.collectionUrl] : config.defaultCollectionUrl ? [config.defaultCollectionUrl] : []);
    setTaskForm(
      task
        ? {
            summary: task.summary,
            description: task.description ?? '',
            dueDate: task.dueDate ?? '',
            dueTime: task.dueTime ?? '',
            priority: bandOf(task.priority),
            repeat: repeatKey(task.rrule),
            // Always blank: this box adds steps, it does not list them.
            steps: '',
            stepsDate: '',
            stepsTime: '',
          }
        : {...EMPTY_TASK},
    );
    setStatus(null);
  };

  return (
    <View style={styles.appRoot}>
    <ScrollView
      ref={scrollRef}
      style={styles.root}
      keyboardShouldPersistTaps="handled"
      // Detaches views scrolled out of sight. The settings page and a long task
      // list are both far taller than the panel, and every offscreen row still
      // costs layout on each pass without this.
      removeClippedSubviews
      // A slower scroll event is plenty: nothing here follows the scroll
      // position, and on e-ink the panel cannot repaint faster than this
      // anyway.
      scrollEventThrottle={64}
      onLayout={() => setScrollHandle(findNodeHandle(scrollRef.current))}
      contentContainerStyle={[
        styles.content,
        // Room to scroll the focused field clear of the keyboard, sized from
        // what the host reported rather than from a constant.
        keyboardUp && {paddingBottom: keyboardHeight + 24},
      ]}>

      {/*
        The capture screen, built to fit one panel rather than to scroll.

        It used to be a single column roughly two panels tall: title, lists,
        due, priority, repeats, description, sub tasks, their date, and only
        then the buttons. Everything past the due date was below the fold, and
        the lasso that opened it is a two-second gesture — so the screen it led
        to asked for a scroll before it could be finished.

        Now the essentials sit on the first panel and everything else is behind
        More, which swaps the body rather than lengthening it. The action bar is
        a sibling of the ScrollView pinned at the foot, the same arrangement the
        settings screen uses, so Save is reachable whatever the body is showing.
        The ScrollView itself stays as a safety net: a panel smaller than any
        measured here, or a keyboard over a short screen, must not be able to
        put a control out of reach entirely.
      */}
      {screen === 'save' && (
        <>
          <Header
            title={captureKind === 'event' ? 'New event' : 'New task'}
            onClose={closeGuarded}
            closeDisabled={writing}
          />

          {/*
            What the handwriting becomes. First thing on the screen, because it
            decides what every field under it means.
          */}
          <Choice
            options={[
              {key: 'task', label: 'Task'},
              {key: 'event', label: 'Event'},
            ]}
            value={captureKind}
            onPick={k => setCaptureKind(k as 'task' | 'event')}
          />

          {captureKind === 'task' ? (
            <>
              <Field
                scrollHandle={scrollHandle}
                onScrollTo={scrollFieldIntoView}
                label="Title"
                value={draft.summary}
                multiline
                onChange={v => setDraft(d => ({...d, summary: v}))}
              />

              {!captureMore && (
                <>
                  {config.collectionUrls.length === 0 && (
                    <Text style={styles.noteCompact}>
                      Saving a task needs a task list. Add a CalDAV server in Settings, or
                      use the note features, which work without one.
                    </Text>
                  )}
                  {saveTargets.length > 0 && (
                    <>
                      <Text style={styles.label}>Save to</Text>
                      {saveTargets.map(target => (
                        <CheckRow
                          compact
                          key={target.url}
                          label={target.label}
                          hint={target.hint}
                          checked={targets.includes(target.url)}
                          onToggle={() =>
                            setTargets(prev =>
                              prev.includes(target.url)
                                ? prev.filter(u => u !== target.url)
                                : [...prev, target.url],
                            )
                          }
                        />
                      ))}
                    </>
                  )}

                  <Text style={styles.label}>Due</Text>
                  <DateTimePicker
                    dateOnly={capturingToSupernote}
                    date={draft.dueDate}
                    time={draft.dueTime}
                    timeFormat={timeFormat}
                    onChange={(date, time) =>
                      setDraft(d => ({...d, dueDate: date, dueTime: time}))
                    }
                  />
                </>
              )}

              {captureMore && capturingToSupernote && (
                <>
                  <Text style={styles.noteCompact}>
                    {`A Supernote to-do holds a title, a date and a note. Priority, repeats and sub tasks are not offered — the tablet's To-Do app has nowhere to put them. The note is kept, but only ${APP_NAME} displays it.`}
                  </Text>
                  <Field
                    compact
                    scrollHandle={scrollHandle}
                    onScrollTo={scrollFieldIntoView}
                    label="Note"
                    value={draft.description}
                    multiline
                    onChange={v => setDraft(d => ({...d, description: v}))}
                  />
                </>
              )}

              {captureMore && !capturingToSupernote && (
                <>
                  <Text style={styles.label}>Priority</Text>
                  <Choice
                    options={PRIORITY_BANDS.map(pr => ({key: pr.key, label: pr.label}))}
                    value={draft.priority}
                    onPick={k => setDraft(d => ({...d, priority: k as PriorityBand}))}
                  />
                  <Text style={styles.label}>Repeats</Text>
                  {draft.repeat === 'custom' && (
                    <Text style={styles.noteCompact}>
                      {repeatLabel('custom')} — a rule set in another app, which this menu
                      cannot describe. It is kept exactly as it is unless you choose one
                      below.
                    </Text>
                  )}
                  <Choice
                    options={REPEAT_OPTIONS.map(r => ({key: r.key, label: r.label}))}
                    value={draft.repeat}
                    onPick={k => setDraft(d => ({...d, repeat: k as RepeatKey}))}
                  />
                  <Field
                    compact
                    scrollHandle={scrollHandle}
                    onScrollTo={scrollFieldIntoView}
                    label="Description"
                    value={draft.description}
                    multiline
                    onChange={v => setDraft(d => ({...d, description: v}))}
                  />
                  <Field
                    compact
                    scrollHandle={scrollHandle}
                    onScrollTo={scrollFieldIntoView}
                    label="Add sub tasks (one per line)"
                    value={draft.steps}
                    multiline
                    onChange={v => setDraft(d => ({...d, steps: v}))}
                  />
                  <View style={styles.stepsDateRow}>
                    <Pressable
                      style={styles.stepsDateButton}
                      onPress={() =>
                        setStepsDateOpen(stepsDateOpen === 'capture' ? null : 'capture')
                      }>
                      <CalendarIcon />
                      <Text style={styles.stepsDateLabel}>
                        {draft.stepsDate
                          ? `Steps due ${formatDate(draft.stepsDate, dateFormat)}${
                              draft.stepsTime
                                ? ` at ${formatTime(draft.stepsTime, timeFormat)}`
                                : ''
                            }`
                          : 'Steps due: same day as the task'}
                      </Text>
                    </Pressable>
                    {!!draft.stepsDate && (
                      <Pressable
                        onPress={() => setDraft(d => ({...d, stepsDate: '', stepsTime: ''}))}
                        hitSlop={8}>
                        <Text style={styles.clearLink}>Clear</Text>
                      </Pressable>
                    )}
                  </View>
                  {stepsDateOpen === 'capture' && (
                    <DateTimePicker
                      date={draft.stepsDate}
                      time={draft.stepsTime}
                      timeFormat={timeFormat}
                      onChange={(date, time) => {
                        setDraft(d => ({...d, stepsDate: date, stepsTime: time}));
                      }}
                    />
                  )}
                  <Text style={styles.noteCompact}>
                    Each line becomes a step, due the same day as the task. End a line with
                    @2026-09-10 to give that step its own date.
                  </Text>
                </>
              )}
            </>
          ) : (
            <>
              <Field
                scrollHandle={scrollHandle}
                onScrollTo={scrollFieldIntoView}
                label="Title"
                value={captureEvent.summary}
                multiline
                onChange={v => setCaptureEvent(d => ({...d, summary: v}))}
              />

              {!captureMore && (
                <>
                  {config.calendarUrls.length > 0 ? (
                    <>
                      <Text style={styles.label}>Calendar</Text>
                      <Choice
                        options={config.calendarUrls.map(url => ({
                          key: url,
                          label: collectionName(url),
                        }))}
                        value={captureCalendar}
                        onPick={setCaptureCalendar}
                      />
                    </>
                  ) : (
                    <Text style={styles.noteCompact}>
                      No calendars are ticked in Settings, so there is nowhere to save an
                      event. Tick one under Task lists and calendars.
                    </Text>
                  )}

                  <Text style={styles.label}>Date and start time</Text>
                  <DateTimePicker
                    date={captureEvent.date}
                    time={captureEvent.startTime}
                    timeFormat={timeFormat}
                    onChange={(date, time) =>
                      setCaptureEvent(d => ({
                        ...d,
                        date,
                        startTime: time,
                        // The same rule the event editor uses: hold the
                        // duration, default to an hour, drop it entirely when
                        // the event becomes all-day.
                        endTime: endForStart(d.startTime, d.endTime, time),
                      }))
                    }
                  />
                  {/*
                    Leaving the start empty makes it an all-day event, which has
                    no end to set. `hideCalendar` keeps this to a time: the end
                    is always on the event's own day, and a second calendar here
                    would invite an end date the format cannot store.
                  */}
                  {!!captureEvent.startTime && (
                    <>
                      <Text style={styles.label}>Ends</Text>
                      <DateTimePicker
                        date={captureEvent.date}
                        time={captureEvent.endTime}
                        timeFormat={timeFormat}
                        hideCalendar
                        onChange={(_date, time) =>
                          setCaptureEvent(d => ({...d, endTime: time}))
                        }
                      />
                      {endsBeforeStart(captureEvent.startTime, captureEvent.endTime) && (
                        <Text style={styles.noteCompact}>
                          This ends before it starts. An event carries one date, so it
                          will be stored that way rather than as running overnight.
                        </Text>
                      )}
                    </>
                  )}
                </>
              )}

              {captureMore && (
                <>
                  <Text style={styles.label}>Repeats</Text>
                  {captureEvent.repeat === 'custom' && (
                    <Text style={styles.noteCompact}>
                      {repeatLabel('custom')} — a rule set in another app, which this menu
                      cannot describe.
                    </Text>
                  )}
                  <Choice
                    options={REPEAT_OPTIONS.map(r => ({key: r.key, label: r.label}))}
                    value={captureEvent.repeat}
                    onPick={k => setCaptureEvent(d => ({...d, repeat: k as RepeatKey}))}
                  />
                  <Field
                    compact
                    scrollHandle={scrollHandle}
                    onScrollTo={scrollFieldIntoView}
                    label="Location"
                    value={captureEvent.location}
                    onChange={v => setCaptureEvent(d => ({...d, location: v}))}
                  />
                  <Field
                    compact
                    scrollHandle={scrollHandle}
                    onScrollTo={scrollFieldIntoView}
                    label="Description"
                    value={captureEvent.description}
                    multiline
                    onChange={v => setCaptureEvent(d => ({...d, description: v}))}
                  />
                </>
              )}
            </>
          )}

          <StatusLine status={status} />
          <LoadingLine visible={loading} />
        </>
      )}

      {/*
        The task editor, built to fit one panel like the capture screen.

        It was a single column two panels tall and the actions were at the
        bottom of it, so saving an edit meant scrolling past every field to
        reach Save. Same treatment: essentials first, the rest behind More,
        actions pinned at the foot.
      */}
      {screen === 'hub' && taskForm && (
        <>
          <Header
            title={editingTask ? 'Edit task' : 'New task'}
            onClose={closeGuarded}
            closeDisabled={writing}
          />
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            label="Title"
            value={taskForm.summary}
            multiline
            onChange={v => setTaskForm(d => (d ? {...d, summary: v} : d))}
          />

          {!taskMore && (
            <>
              {!editingTask && saveTargets.length > 0 && (
                <>
                  <Text style={styles.label}>Save to</Text>
                  {saveTargets.map(target => (
                    <CheckRow
                      compact
                      key={target.url}
                      label={target.label}
                      hint={target.hint}
                      checked={taskTargets.includes(target.url)}
                      onToggle={() =>
                        setTaskTargets(prev =>
                          prev.includes(target.url)
                            ? prev.filter(u => u !== target.url)
                            : [...prev, target.url],
                        )
                      }
                    />
                  ))}
                </>
              )}
              <Text style={styles.label}>Due</Text>
              <DateTimePicker
                dateOnly={editingSupernote}
                date={taskForm.dueDate}
                time={taskForm.dueTime}
                timeFormat={timeFormat}
                onChange={(date, time) =>
                  setTaskForm(d => (d ? {...d, dueDate: date, dueTime: time} : d))
                }
              />
            </>
          )}

          {taskMore && editingSupernote && (
            <>
              <Text style={styles.noteCompact}>
                {`A Supernote to-do holds a title, a date and a note. Priority, repeats and sub tasks are not offered for this one — the tablet's To-Do app has nowhere to put them, so they would be discarded rather than saved.

The note is kept and comes back here, but the To-Do app does not display one, so it is only visible in ${APP_NAME}.`}
              </Text>
              <Field
                compact
                scrollHandle={scrollHandle}
                onScrollTo={scrollFieldIntoView}
                label="Note"
                value={taskForm.description}
                multiline
                onChange={v => setTaskForm(d => (d ? {...d, description: v} : d))}
              />
            </>
          )}

          {taskMore && !editingSupernote && (
            <>
              <Text style={styles.label}>Priority</Text>
              <Choice
                options={PRIORITY_BANDS.map(p => ({key: p.key, label: p.label}))}
                value={taskForm.priority}
                onPick={k => setTaskForm(d => (d ? {...d, priority: k as PriorityBand} : d))}
              />
              <Text style={styles.label}>Repeats</Text>
              {taskForm.repeat === 'custom' && (
                <Text style={styles.noteCompact}>
                  {repeatLabel('custom')} — a rule set in another app, which this menu cannot
                  describe. It is kept exactly as it is unless you choose one below.
                </Text>
              )}
              <Choice
                options={REPEAT_OPTIONS.map(r => ({key: r.key, label: r.label}))}
                value={taskForm.repeat}
                onPick={k => setTaskForm(d => (d ? {...d, repeat: k as RepeatKey} : d))}
              />
              <Field
                compact
                scrollHandle={scrollHandle}
                onScrollTo={scrollFieldIntoView}
                label="Description"
                value={taskForm.description}
                multiline
                onChange={v => setTaskForm(d => (d ? {...d, description: v} : d))}
              />
              <Field
                compact
                scrollHandle={scrollHandle}
                onScrollTo={scrollFieldIntoView}
                label="Add sub tasks (one per line)"
                value={taskForm.steps}
                multiline
                placeholder={'Draft the notes\nBump the version'}
                onChange={v => setTaskForm(d => (d ? {...d, steps: v} : d))}
              />
              <View style={styles.stepsDateRow}>
                <Pressable
                  style={styles.stepsDateButton}
                  onPress={() => setStepsDateOpen(stepsDateOpen === 'task' ? null : 'task')}>
                  <CalendarIcon />
                  <Text style={styles.stepsDateLabel}>
                    {taskForm.stepsDate
                      ? `Steps due ${formatDate(taskForm.stepsDate, dateFormat)}${
                          taskForm.stepsTime
                            ? ` at ${formatTime(taskForm.stepsTime, timeFormat)}`
                            : ''
                        }`
                      : 'Steps due: same day as the task'}
                  </Text>
                </Pressable>
                {!!taskForm.stepsDate && (
                  <Pressable
                    onPress={() =>
                      setTaskForm(d => (d ? {...d, stepsDate: '', stepsTime: ''} : d))
                    }
                    hitSlop={8}>
                    <Text style={styles.clearLink}>Clear</Text>
                  </Pressable>
                )}
              </View>
              {stepsDateOpen === 'task' && (
                <DateTimePicker
                  date={taskForm.stepsDate}
                  time={taskForm.stepsTime}
                  timeFormat={timeFormat}
                  onChange={(date, time) => {
                    setTaskForm(d => (d ? {...d, stepsDate: date, stepsTime: time} : d));
                  }}
                />
              )}
              <Text style={styles.noteCompact}>
                {`Each line becomes a step of this task, due the same day as the task itself.
End a line with @2026-09-10 to give that step its own date instead.

This box only adds — it never lists or removes the steps a task already has, so saving twice
will not duplicate them.`}
              </Text>
            </>
          )}

          <StatusLine status={status} />
        </>
      )}

      {screen === 'hub' && eventForm && (
        <>
          <Header
            title={editingEvent ? 'Edit event' : 'New event'}
            onClose={closeGuarded}
            closeDisabled={writing}
          />
          {/*
            Said before anything is typed, because the consequence is invisible
            otherwise: a repeat is one object on the server, so this form edits
            every occurrence at once and the date below is the series' own
            start, not the day that was tapped to get here.
          */}
          {!!editingEvent?.occurrence && (
            <Text style={styles.noteCompact}>
              {`This event repeats — you are editing the whole series, not one occurrence. The date below is when the series starts (${formatDate(editingEvent.occurrence.seriesStartDate, dateFormat)}), and changing it moves every occurrence.`}
            </Text>
          )}
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            compact
            label="Title"
            value={eventForm.summary}
            onChange={v => setEventForm(d => (d ? {...d, summary: v} : d))}
          />
          {!editingEvent && calendars.length > 0 && (
            <>
              <Text style={styles.label}>Calendar</Text>
              <Choice
                options={config.calendarUrls.map(url => ({key: url, label: collectionName(url)}))}
                value={eventTarget}
                onPick={setEventTarget}
              />
            </>
          )}
          {!eventMore && (
            <>
          <Text style={styles.labelCompact}>Date and start time</Text>
          <DateTimePicker
            date={eventForm.date}
            time={eventForm.startTime}
            timeFormat={timeFormat}
            onChange={(date, time) =>
              setEventForm(d =>
                d
                  ? {
                      ...d,
                      date,
                      startTime: time,
                      endTime: endForStart(d.startTime, d.endTime, time),
                    }
                  : d,
              )
            }
          />
          {/*
            The same control as the start, not a bare text box: it was the one
            place left that demanded a 24-hour time whatever the clock setting
            said. The date is fixed to the event's own, so this only ever picks
            a time.
          */}
          <Text style={styles.label}>Ends</Text>
          <DateTimePicker
            date={eventForm.date}
            time={eventForm.endTime}
            timeFormat={timeFormat}
            hideCalendar
            onChange={(_date, time) =>
              setEventForm(d => (d ? {...d, endTime: time} : d))
            }
          />
            </>
          )}

          {eventMore && (
            <>
              <Text style={styles.label}>Repeats</Text>
              {eventForm.repeat === 'custom' && (
                <Text style={styles.noteCompact}>
                  {repeatLabel('custom')} — a rule set in another app, which this menu cannot
                  describe. It is kept exactly as it is unless you choose one below.
                </Text>
              )}
              <Choice
                options={REPEAT_OPTIONS.map(r => ({key: r.key, label: r.label}))}
                value={eventForm.repeat}
                onPick={k => setEventForm(d => (d ? {...d, repeat: k as RepeatKey} : d))}
              />
              <Field
                scrollHandle={scrollHandle}
                onScrollTo={scrollFieldIntoView}
                compact
                label="Location"
                value={eventForm.location}
                onChange={v => setEventForm(d => (d ? {...d, location: v} : d))}
              />
              <Field
                scrollHandle={scrollHandle}
                onScrollTo={scrollFieldIntoView}
                compact
                label="Description"
                value={eventForm.description}
                multiline
                onChange={v => setEventForm(d => (d ? {...d, description: v} : d))}
              />
            </>
          )}

          <StatusLine status={status} />
        </>
      )}

      {screen === 'hub' && !taskForm && !eventForm && (
        <>
          <Header title={APP_NAME} onClose={close} closeDisabled={writing} />
          <Tabs
            tabs={[
              {key: 'tasks', label: 'Tasks'},
              {key: 'calendar', label: 'Calendar'},
              {key: 'find', label: 'Find'},
            ]}
            value={tab}
            onPick={k => setTab(k as Tab)}
          />

          {tab === 'tasks' && (
            <>
              <View style={styles.actions}>
                <Button label="+ New task" primary onPress={() => openTaskEditor(null)} />
                <Button label="Refresh" onPress={() => void refresh()} />
              </View>

              <Field
                scrollHandle={scrollHandle}
                onScrollTo={scrollFieldIntoView}
                label="Search"
                value={query}
                placeholder="Filter tasks"
                onChange={setQuery}
              />
              <Text style={styles.label}>Sort</Text>
              <Choice options={SORT_KEYS} value={sortKey} onPick={k => setSortKey(k as SortKey)} />

              <StatusLine status={status} />
              <LoadingLine
                visible={loading}
                // Prominent only while the screen is otherwise empty: once
                // there is a list to look at, a big box in the middle of it is
                // in the way.
                prominent={tasks.length === 0 && events.length === 0}
                // What is on screen came from the cache and is real, if
                // possibly a few minutes old. "Loading" over it reads as "this
                // is not ready yet", which would be a lie about content the
                // user can already act on.
                label={
                  tasks.length === 0 && events.length === 0 ? undefined : 'Updating…'
                }
              />

              {listed.length === 0 && !loading && !hasCollections(config) && (
                <Text style={styles.note}>
                  No task server is set up, so there are no tasks to show. Tasks need a CalDAV
                  server such as Task Hub — the Calendar tab and everything it creates (daily,
                  weekly, monthly, quarterly and yearly notes, and meeting notes) works without
                  one.
                </Text>
              )}

              {listed.length === 0 && !loading && hasCollections(config) && (
                <Text style={styles.empty}>No open tasks match.</Text>
              )}
              {sections.map(section => (
                <View key={section.key}>
                  {/*
                    The count is on the heading because it is the answer on its
                    own: "Overdue · 3" is often all somebody needs from this
                    screen.
                  */}
                  <Text
                    style={[
                      styles.dueHead,
                      section.key === 'overdue' && styles.dueHeadUrgent,
                    ]}>
                    {DUE_BUCKETS.find(b => b.key === section.key)?.label} ·{' '}
                    {section.rows.filter(r => r.depth === 0).length}
                  </Text>
                  {section.rows.map(row => (
                    <TaskRow
                      key={row.todo.uid}
                      task={row.todo}
                      depth={row.depth}
                      stepCount={row.stepCount}
                      stepsDone={row.stepsDone}
                      stepsOpen={openSteps.has(row.todo.uid)}
                      onToggleSteps={
                        row.stepCount > 0 ? () => toggleSteps(row.todo.uid) : undefined
                      }
                      dateFormat={dateFormat}
                      timeFormat={timeFormat}
                      showNoDue
                      listLabel={row.todo.collectionLabel}
                      onToggle={() => askComplete(row.todo)}
                      onEdit={() => openTaskEditor(row.todo)}
                      onOpenSource={() => openSource(row.todo)}
                    />
                  ))}
                </View>
              ))}

              {listedDone.length > 0 && (
                <Section
                  title="Completed"
                  count={listedDone.length}
                  open={showDone}
                  onToggle={() => setShowDone(v => !v)}>
                  {listedDone.map(task => (
                    <TaskRow
                      key={task.uid}
                      task={task}
                      dateFormat={dateFormat}
                      timeFormat={timeFormat}
                      listLabel={task.collectionLabel}
                      onEdit={() => openTaskEditor(task)}
                      onOpenSource={() => openSource(task)}
                    />
                  ))}
                </Section>
              )}
            </>
          )}

          {tab === 'calendar' && (
            <>
              {/*
                View switch sits between the tabs above and the actions below,
                with breathing room on both sides — pressed against the action
                row it read as a fourth group of buttons.
              */}
              <View style={styles.viewSwitchRow}>
                <Choice
                  options={[
                    {key: 'year', label: 'Year'},
                    {key: 'quarter', label: 'Quarter'},
                    {key: 'month', label: 'Month'},
                    {key: 'week', label: 'Week'},
                    {key: 'day', label: 'Day'},
                  ]}
                  value={calView}
                  onPick={k => setCalView(k as CalView)}
                />
                {viewHistory.length > 0 && (
                  <Pressable style={styles.backButton} onPress={goBackView}>
                    <Text style={styles.backIcon}>‹</Text>
                    <Text style={styles.backLabel}>Back</Text>
                  </Pressable>
                )}
              </View>

              <View style={styles.actions}>
                <Button
                  label="+ New event"
                  primary
                  onPress={() => {
                    // Clear the task form as well. Both forms render from the
                    // same screen and the task one is checked first, so a task
                    // form left over from earlier would win and "New event"
                    // would open a task.
                    setTaskForm(null);
                    setEditingTask(null);
                    setEditingEvent(null);
                    setEventTarget(config.calendarUrls[0] ?? '');
                    setEventForm(emptyEvent(day));
                    setStatus(null);
                  }}
                />
                {/*
                  The same task dialog the Tasks tab opens, reachable from every
                  calendar view: a task thought of while looking at a week is a
                  task that should be writable without changing tab first. It
                  carries the list picker with it, so a task added here still
                  chooses which collection it goes into.
                */}
                <Button label="+ New task" onPress={() => openTaskEditor(null)} />
                <Button label="Today" onPress={goToday} />
                <Button label="Refresh" onPress={() => void refresh()} />
                {/*
                  Here rather than beside the note buttons, for two reasons.
                  It is always visible — the note-button row is gated on daily
                  notes being switched on and sits under a scroll on a busy day
                  — and one button serves all three views, because what it
                  draws follows whichever one is showing.
                */}
                {(calView === 'day' || calView === 'week' || calView === 'month') && (
                  <Button
                    // "Calendar page" said what it made, not what pressing it
                    // does, which is the usual way a button ends up meaning
                    // nothing until you have already pressed it once.
                    label="Insert snapshot"
                    onPress={() => askCalendarPage(day, calView)}
                  />
                )}
                {calView === 'day' && (
                  <Text style={styles.dayHeading}>{formatDate(day, dateFormat)}</Text>
                )}
              </View>

              <StatusLine status={status} />
              <LoadingLine
                visible={loading}
                // Prominent only while the screen is otherwise empty: once
                // there is a list to look at, a big box in the middle of it is
                // in the way.
                prominent={tasks.length === 0 && events.length === 0}
                // What is on screen came from the cache and is real, if
                // possibly a few minutes old. "Loading" over it reads as "this
                // is not ready yet", which would be a lie about content the
                // user can already act on.
                label={
                  tasks.length === 0 && events.length === 0 ? undefined : 'Updating…'
                }
              />

              {!hasCalendars(config) && (
                <Text style={styles.note}>
                  No calendar server is set up, so no events are shown. Everything else on this
                  tab works without one: the day, week, month, quarter and year views, and the
                  notes each of them creates. Add a CalDAV calendar in settings to see events
                  here too.
                </Text>
              )}

              {calView === 'year' && (
                <YearView
                  year={Number(day.slice(0, 4))}
                  selected={day}
                  marks={marks}
                  hasNote={hasYearNote}
                  notesEnabled={config.yearNote.enabled}
                  onSelect={openDayOn}
                  onYear={shiftToYear}
                  onOpenMonth={openMonthAt}
                  onOpenQuarter={openQuarterOn}
                  onOpenWeek={openWeekOn}
                  onToday={goToday}
                  onYearNote={(iso, exists) => askPeriodNote('year', iso, exists)}
                />
              )}

              {calView === 'quarter' && (
                <QuarterView
                  anchor={day}
                  selected={day}
                  marks={marks}
                  hasNote={hasQuarterNote}
                  notesEnabled={config.quarterNote.enabled}
                  onSelect={openDayOn}
                  onQuarter={shiftToQuarter}
                  onOpenMonth={openMonthAt}
                  onQuarterNote={(iso, exists) => askPeriodNote('quarter', iso, exists)}
                />
              )}

              {calView === 'month' && (
                <>
                  {config.monthNote.enabled && (
                    <View style={styles.noteButtonRow}>
                      <Pressable
                        style={[styles.button, styles.buttonPrimary]}
                        onPress={() => askPeriodNote('month', day, hasMonthNote)}>
                        <Text style={styles.buttonTextPrimary}>
                          {hasMonthNote ? 'Open month note' : 'Create month note'}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                  <MonthView
                    year={view.year}
                    month={view.month}
                    selected={day}
                    marks={marks}
                    onSelect={setDay}
                    onMonth={(year, month) => setView({year, month})}
                    weekNotes={config.weekNote.enabled ? weekNotesInView : undefined}
                    onWeekNote={(iso, exists) => askPeriodNote('week', iso, exists)}
                    onPickMonth={() => setPickingDate('day')}
                    // openDayOn, not setCalView: a plain view switch deliberately
                    // moves the selection to today, so setting the day and then
                    // switching had the switch undo the set and the second tap
                    // opened today instead of the day tapped.
                    onOpenDay={openDayOn}
                  />
                  {/*
                    Folded, and shut by default after the first few openings.
                    Three letters and a gesture are learned once and then read
                    forever, and a permanent line of instructions under the grid
                    is a line of the panel spent on somebody who already knows.
                  */}
                  <Pressable onPress={() => setLegendOpen(v => !v)} hitSlop={8}>
                    <Text style={styles.legendToggle}>
                      {legendOpen ? '▾ What the marks mean' : '▸ What the marks mean'}
                    </Text>
                  </Pressable>
                  {legendOpen && (
                    <Text style={styles.legend}>
                      <Text style={styles.markLegend}>C</Text> event ·{' '}
                      <Text style={styles.markLegend}>T</Text> task due ·{' '}
                      <Text style={styles.markLegend}>N</Text> daily note · tap a day twice to
                      open it
                    </Text>
                  )}

                  {/*
                    The selected day's note, below the grid with the rest of that
                    day's detail rather than up beside the month's own note —
                    they act on different things and sat together looking like a
                    pair.
                  */}
                  {config.dailyNote.enabled && (
                    <View style={styles.noteButtonRow}>
                      <Pressable
                        style={[styles.button, styles.buttonPrimary]}
                        onPress={() => askDailyNote(day, dayHasNote)}>
                        <Text style={styles.buttonTextPrimary}>
                          {dayHasNote ? 'Open note for this day' : 'Create note for this day'}
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  {/*
                    Tasks and appointments side by side, each in its own column.
                    Stacked, the appointments sat below the fold under a whole
                    month grid, so the answer to "what is on that day" needed a
                    scroll after every tap — and the tasks had to be folded away
                    to make even that much fit.
                  */}
                  {/*
                    Schedule on the left, to-dos on the right — the same way
                    round as the Day view, so moving between the two views does
                    not move the two lists. Stacked, the appointments sat below
                    the fold under a whole month grid, so the answer to "what is
                    on that day" needed a scroll after every tap.
                  */}
                  <View style={styles.dayPanel}>
                    <View style={styles.dayPanelSchedule}>
                      <Text style={styles.dayPanelTitle}>
                        Appointments{dayEvents.length > 0 ? ` · ${dayEvents.length}` : ''}
                      </Text>
                      {dayEvents.length === 0 && (
                        <Text style={styles.dayPanelEmpty}>Nothing scheduled.</Text>
                      )}
                      {dayEvents.map(event => (
                        <View key={event.uid} style={[styles.dayPanelRow, styles.eventRow]}>
                          <Pressable style={styles.grow} onPress={() => openEventEditor(event)}>
                            {/*
                              The time leads, as it does on a printed agenda:
                              what somebody scanning a day wants first is when,
                              not what.
                            */}
                            <Text style={styles.dayPanelTime}>
                              {event.allDay
                                ? 'All day'
                                : formatTime(event.startTime, timeFormat)}
                            </Text>
                            <Text style={styles.dayPanelTitleText}>{event.summary}</Text>
                            <Text style={styles.dayPanelWhere}>
                              {event.location ? `${event.location} · ` : ''}
                              {event.calendarLabel}
                            </Text>
                          </Pressable>
                          <Pressable
                            style={styles.noteChip}
                            onPress={() => askEventNote(event, eventNotes.has(event.uid))}>
                            <Text style={styles.noteChipText}>
                              {eventNotes.has(event.uid) ? '🗒' : '+🗒'}
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>

                    <View style={styles.dayPanelTasks}>
                      <Text style={styles.dayPanelTitle}>
                        Tasks{dayTasks.length > 0 ? ` · ${dayTasks.length}` : ''}
                      </Text>
                      {dayTasks.length === 0 && (
                        <Text style={styles.dayPanelEmpty}>Nothing due.</Text>
                      )}
                      {dayTasks.map(task => (
                        <View key={task.uid} style={styles.dayPanelRow}>
                          <View style={styles.dayPanelTaskRow}>
                            {/*
                              The box was drawn but not tappable, so this panel
                              could open a task and never complete one.
                            */}
                            <Pressable
                              onPress={() => askComplete(task)}
                              style={styles.paneCheckHit}
                              hitSlop={8}>
                              <Text style={styles.dayPanelCheck}>
                                {task.completed ? '☑' : '☐'}
                              </Text>
                            </Pressable>
                            <Pressable
                              style={styles.grow}
                              onPress={() => openTaskEditor(task)}>
                              <Text style={styles.dayPanelTitleText}>{task.summary}</Text>
                              <Text style={styles.dayPanelWhere}>
                                {task.dueTime ? `${formatTime(task.dueTime, timeFormat)} · ` : ''}
                                {task.collectionLabel}
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                </>
              )}

              {calView === 'week' && config.weekNote.enabled && (
                <View style={styles.noteButtonRow}>
                  <Pressable
                    style={[styles.button, styles.buttonPrimary]}
                    onPress={() => askPeriodNote('week', day, hasWeekNote)}>
                    <Text style={styles.buttonTextPrimary}>
                      {hasWeekNote ? 'Open week note' : 'Create week note'}
                    </Text>
                  </Pressable>
                </View>
              )}

              {calView === 'week' && (
                <WeekView
                  onEditTask={openTaskEditor}
                  onCompleteTask={askComplete}
                  anchor={day}
                  events={shownEvents}
                  tasks={tasks}
                  marks={marks}
                  selected={day}
                  dateFormat={dateFormat}
                  timeFormat={timeFormat}
                  noteDays={weekNoteDays}
                  onOpenSource={openSource}
                  onDailyNote={askDailyNote}
                  eventNotes={eventNotes}
                  onEventNote={askEventNote}
                  onPickWeek={() => setPickingDate('week')}
                  onShiftWeek={weeks => setDay(prev => shiftWeek(prev, weeks))}
                  // Select, then open — the same rule as the month grid, so the
                  // two calendars answer a tap the same way. Tapping a day that
                  // is already chosen is what opens it; the first tap moves the
                  // highlight and the columns' day headings with it.
                  onSelectDay={iso => {
                    if (iso === day) {
                      // openDayOn for the same reason as the month grid's: a
                      // plain view switch moves the selection to today, which
                      // would open today rather than the day being opened.
                      openDayOn(iso);
                    } else {
                      setDay(iso);
                    }
                  }}
                  onEditEvent={openEventEditor}
                />
              )}

              {calView === 'day' && (
                <DayView
                  day={day}
                  events={shownEvents}
                  tasks={tasks}
                  openSteps={openSteps}
                  onToggleSteps={toggleSteps}
                  onOpenSource={openSource}
                  dateFormat={dateFormat}
                  timeFormat={timeFormat}
                  hasNote={dayHasNote}
                  notesEnabled={config.dailyNote.enabled}
                  startHour={config.agendaStartHour}
                  endHour={config.agendaEndHour}
                  onDailyNote={askDailyNote}
                  onCalendarPage={d => askCalendarPage(d, 'day')}
                  onPickDate={() => setPickingDate('day')}
                  eventNotes={eventNotes}
                  onEventNote={askEventNote}
                  onShiftDay={days => setDay(prev => shiftDays(prev, days))}
                  onEditEvent={openEventEditor}
                  onCompleteTask={askComplete}
                  onEditTask={openTaskEditor}
                />
              )}
            </>
          )}

          {tab === 'find' && (
            <FindView
              query={findQuery}
              onQuery={setFindQuery}
              stars={foundStars}
              previewMode={previewMode}
              onTogglePreviews={() => setPreviewMode(v => !v)}
              previews={previews}
              previewsPending={previewsPending}
              onVisiblePages={setVisibleKeywordPages}
              keywords={foundKeywords}
              starredPages={countStarredPages(foundStars)}
              scanning={findScanning}
              progress={findProgress}
              summary={findSummary}
              onOpen={openFound}
              onRescan={rescanNotes}
              scrollHandle={scrollHandle}
              onScrollTo={scrollFieldIntoView}
            />
          )}
        </>
      )}

      {screen === 'settings' && (
        <SettingsScreen
          feedDraft={feedDraft}
          setFeedDraft={setFeedDraft}
          onAddFeed={addFeedFromDraft}
          onRemoveFeed={removeFeedByUrl}
          onImportFeeds={importFeedFile}
          feedMessage={feedMessage}
          feedBusy={feedBusy}
          snEmail={snEmail}
          setSnEmail={setSnEmail}
          snPassword={snPassword}
          setSnPassword={setSnPassword}
          snCode={snCode}
          setSnCode={setSnCode}
          snPending={snPending !== null}
          snLists={snLists}
          snCounts={snCounts}
          snMessage={snMessage}
          snBusy={snBusy}
          snDaysLeftLabel={snDaysLeftLabel}
          onSnSignIn={snSignIn}
          onSnVerify={snVerify}
          onSnSignOut={snSignOut}
          onSnRefreshLists={() => void loadSnLists(config.supernote.token)}
          feedNames={feedNames}
          config={config}
          collections={collections}
          status={status}
          scrollHandle={scrollHandle}
          onScrollTo={scrollFieldIntoView}
          onBrowseFolder={setPickingFolder}
          onBrowseTemplate={setPickingTemplate}
          onShareTree={askShareTree}
          templates={templates}
          showHelp={showHelp}
          onToggleHelp={() => setShowHelp(v => !v)}
          onChange={changeConfig}
          onDiscover={() => void discover()}
          device={device}
          dirty={settingsDirty}
          onWipe={askWipe}
          storePath={storePath}
          onClose={closeSettings}
        />
      )}
    </ScrollView>

    {/*
      Save and Cancel, pinned, for the whole time settings are open.
      The settings form is many screens long and the only way out used to be a
      pair of buttons roughly two thirds of the way down it, between the note
      settings and the device fold — so "save and exit" was something you had to
      go looking for, and anyone who scrolled past it had no way out at all.
      Being a sibling of the ScrollView rather than an overlay, it also cannot
      cover the form's last row.
    */}
    {screen === 'settings' && (
      <View style={styles.pinnedBar}>
        <Button label="Cancel setup" onPress={cancelSettings} />
        <Button
          label={settingsDirty ? 'Save and exit •' : 'Save and exit'}
          primary
          onPress={saveSettingsAndExit}
        />
      </View>
    )}

    {screen === 'hub' && eventForm && (
      <View style={styles.pinnedBar}>
        <Button
          label={eventMore ? '‹ Back' : 'More…'}
          onPress={() => setEventMore(v => !v)}
        />
        <Button
          label="Cancel"
          onPress={() => {
            setEventForm(null);
            setEditingEvent(null);
          }}
        />
        <Button
          label={writing ? 'Saving…' : editingEvent ? 'Save changes' : 'Create event'}
          primary
          disabled={writing}
          onPress={askSaveEvent}
        />
      </View>
    )}

    {/*
      The task editor's bar. Same arrangement as the capture screen: More swaps
      the body between the essentials and the rest, so it belongs beside Save
      rather than inside the thing it is paging.
    */}
    {screen === 'hub' && taskForm && (
      <View style={styles.pinnedBar}>
        <Button
          label={taskMore ? '‹ Back' : 'More…'}
          onPress={() => setTaskMore(v => !v)}
        />
        <Button
          label="Cancel"
          onPress={() => {
            setTaskForm(null);
            setEditingTask(null);
          }}
        />
        <Button
          label={writing ? 'Saving…' : editingTask ? 'Save changes' : 'Create task'}
          primary
          disabled={writing}
          onPress={askSaveTaskForm}
        />
      </View>
    )}

    {/*
      The capture screen's own pinned bar, the same arrangement settings uses.
      More swaps the body between the essentials and the rest, so it belongs
      beside Save rather than inside the thing it is paging.
    */}
    {screen === 'save' && (
      <View style={styles.pinnedBar}>
        <Button
          label={captureMore ? '‹ Back' : 'More…'}
          onPress={() => setCaptureMore(v => !v)}
        />
        <Button label="All Tasks" onPress={openHub} />
        <Button
          label={
            writing ? 'Saving…' : captureKind === 'event' ? 'Save event' : 'Save task'
          }
          primary
          disabled={writing}
          onPress={captureKind === 'event' ? askSaveCapturedEvent : askSaveCaptured}
        />
      </View>
    )}

    {/*
      Outside the ScrollView on purpose: these cover the window, so they must
      be positioned against the root rather than against scrolling content —
      inside it they would scroll away with the page underneath them.
    */}
    <FolderPicker
      visible={pickingFolder !== null}
      initialPath={pickingFolder ? config[NOTE_CONFIG_KEY[pickingFolder]].root : ''}
      onCancel={() => setPickingFolder(null)}
      onPick={picked => {
        const kind = pickingFolder;
        if (kind) {
          // changeConfig, not setLocalConfig: browsing to a folder is an edit
          // like typing one, and a settings load still in flight must not
          // overwrite it.
          changeConfig(c => ({
            ...c,
            [NOTE_CONFIG_KEY[kind]]: {...c[NOTE_CONFIG_KEY[kind]], root: picked},
          }));
        }
        setPickingFolder(null);
      }}
    />

    {/*
      The template grid belongs here and not beside the settings row that opens
      it. It is an absolutely positioned overlay, and inside the settings
      ScrollView it was positioned against that row instead of against the
      window: it drew over the settings underneath it, scrolled with the page,
      and Android refused to deliver touches to the tiles that fell outside the
      row's own bounds — so most of the grid could be seen but not chosen.
    */}
    <TemplateSheet
      visible={pickingTemplate !== null}
      templates={templates}
      label={pickingTemplate ? `${NOTE_LABEL[pickingTemplate]} template` : ''}
      value={pickingTemplate ? config[NOTE_CONFIG_KEY[pickingTemplate]].template : ''}
      onCancel={() => setPickingTemplate(null)}
      onPick={picked => {
        const kind = pickingTemplate;
        if (kind) {
          changeConfig(c => ({
            ...c,
            [NOTE_CONFIG_KEY[kind]]: {...c[NOTE_CONFIG_KEY[kind]], template: picked},
          }));
        }
        setPickingTemplate(null);
      }}
    />

    <MiniCalendar
      visible={pickingDate !== null}
      anchor={day}
      mode={pickingDate === 'week' ? 'week' : 'day'}
      onCancel={() => setPickingDate(null)}
      onPickDay={iso => {
        setDay(iso);
        const d = new Date(`${iso}T00:00:00`);
        setView({year: d.getFullYear(), month: d.getMonth()});
        setPickingDate(null);
      }}
      onPickWeek={iso => {
        // Stays in the week view — the sheet moves it, it does not switch view.
        setDay(iso);
        const d = new Date(`${iso}T00:00:00`);
        setView({year: d.getFullYear(), month: d.getMonth()});
        setPickingDate(null);
      }}
    />

    <Notice
      visible={notice !== null && ask === null}
      title={notice?.title ?? ''}
      body={notice?.body}
      label="OK"
      onDismiss={() => setNotice(null)}
    />

    <Notice
      // Held back while a confirm is up: two stacked sheets on this panel leave
      // the user unsure which one the buttons belong to. It cannot appear on the
      // idle screen — this whole tree only renders once a screen is chosen — so
      // it is not what makes a reopening take two taps.
      visible={missing.length > 0 && ask === null}
      title="A list has gone"
      body={missingMessage(missing)}
      label="Not now"
      // The fix, offered where the problem is named. Sending the user to
      // Settings to untick something was advice they could not act on: the
      // ticklists there are built from what discovery finds, and a collection
      // deleted on the server is not in that list.
      action={{label: 'Remove', onPress: forgetMissing}}
      // Cleared only for this refresh. It comes back on the next one, and keeps
      // coming back, until the configuration is corrected.
      onDismiss={() => setMissing([])}
    />

    <Confirm
      visible={ask !== null}
      title={ask?.title ?? ''}
      body={ask?.body}
      confirmLabel={ask?.label}
      onConfirm={() => void runAsk()}
      onCancel={() => setAsk(null)}
    />
    </View>
  );
}


/**
 * Settings for one period's note: where it lives, how the path is built, and
 * which template a new one starts from.
 *
 * Written once and used for the week, the month and the quarter. The daily note
 * keeps its own inline block: its tokens differ, its wording is established, and
 * generalising it would mean editing the one part of this screen every existing
 * user has already set up.
 */
function PeriodNoteSettings(props: {
  title: string;
  period: Period;
  noteKey: 'weekNote' | 'monthNote' | 'quarterNote' | 'yearNote';
  hint: string;
  tokens: string;
  config: ServerConfig;
  templates: NoteTemplate[];
  scrollHandle: number | null;
  onScrollTo: (y: number) => void;
  onBrowse: () => void;
  onBrowseTemplate: () => void;
  onChange: React.Dispatch<React.SetStateAction<ServerConfig>>;
}): React.JSX.Element {
  const {
    title,
    period,
    noteKey,
    hint,
    tokens,
    config,
    templates,
    scrollHandle,
    onScrollTo,
    onBrowse,
    onBrowseTemplate,
    onChange,
  } = props;
  const note = config[noteKey];
  const set = (next: Partial<typeof note>) =>
    onChange(c => ({...c, [noteKey]: {...c[noteKey], ...next}}));
  const presets = PERIOD_LAYOUT_PRESETS[period as 'week' | 'month' | 'quarter' | 'year'];
  const today = toDateInput(new Date());

  return (
    <>
      <Text style={styles.subheadingCompact}>{title}</Text>
      <Text style={styles.noteCompact}>{hint}</Text>
      <CheckRow
        compact
        label={`${title} enabled`}
        checked={note.enabled}
        onToggle={() => set({enabled: !note.enabled})}
      />
      {!note.enabled && (
        <Text style={styles.noteCompact}>
          Switched off, so its buttons are hidden from the calendar views. These settings are
          kept, and turning it back on restores them exactly as they are.
        </Text>
      )}
      {note.enabled && (
      <>
      <View style={styles.browseRow}>
        <View style={styles.grow}>
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={onScrollTo}
            compact
            label="Folder under device storage"
            value={note.root}
            onChange={v => set({root: v})}
          />
        </View>
        <Pressable style={styles.browseButton} onPress={onBrowse}>
          <FolderIcon />
          <Text style={styles.browseLabel}>Browse</Text>
        </Pressable>
      </View>
      <Text style={styles.noteCompact}>
        The folder above is relative to the device's own storage, so "Note/Weekly" means the
        Weekly folder inside Note. Browse picks an existing one.
      </Text>
      <Text style={styles.labelCompact}>Folder layout</Text>
      <Text style={styles.noteCompact}>
        How the path below that folder is built. Tokens in braces are replaced when the note is
        made — the line under the box shows exactly what today would produce.
      </Text>
      <Choice
        options={presets.map(preset => ({key: preset.layout, label: preset.label}))}
        value={note.layout}
        onPick={k => set({layout: k})}
      />
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label={`Custom layout — ${tokens}`}
        value={note.layout}
        onChange={v => set({layout: v})}
      />
      <Text style={styles.noteCompact}>
        {`This ${period} would be: ${
          periodNotePath(period, note, today, config.dateFormat) || '(invalid layout)'
        }`}
      </Text>
      <Text style={styles.labelCompact}>Template for a new note</Text>
      <Text style={styles.noteCompact}>
        {`The page style a newly created ${period} note starts with — ruled, dotted, blank, or one of your own from MyStyle. It is applied once, at the moment the note is created; changing it later does not restyle notes you already have. "Device default" uses whatever the device would use for a new note.`}
      </Text>
      <TemplatePicker
        templates={templates}
        label={`${title} template`}
        value={note.template}
        onOpen={onBrowseTemplate}
      />
      </>
      )}
    </>
  );
}

function SettingsScreen(props: {
  /** The address being typed into the subscription box, before it is added. */
  feedDraft: string;
  setFeedDraft: (value: string) => void;
  onAddFeed: () => void;
  onRemoveFeed: (url: string) => void;
  onImportFeeds: () => void;
  feedMessage: string;
  feedBusy: boolean;
  /** The Supernote sign-in, which is two steps with an email in between. */
  snEmail: string;
  setSnEmail: (v: string) => void;
  snPassword: string;
  setSnPassword: (v: string) => void;
  snCode: string;
  setSnCode: (v: string) => void;
  snPending: boolean;
  snLists: SnList[];
  snCounts: Record<string, number>;
  snMessage: string;
  snBusy: boolean;
  snDaysLeftLabel: string;
  onSnSignIn: () => void;
  onSnVerify: () => void;
  onSnSignOut: () => void;
  onSnRefreshLists: () => void;
  feedNames: Record<string, string>;
  config: ServerConfig;
  collections: TaskCollection[];
  status: Status;
  scrollHandle: number | null;
  onScrollTo: (y: number) => void;
  storePath: string | null;
  /** Open the folder browser for one note. */
  onBrowseFolder: (kind: NoteKind) => void;
  /** Open the template grid for one note. It is drawn at the window root. */
  onBrowseTemplate: (kind: NoteKind) => void;
  /** Put every note type in one dated tree. Asks first — it moves nothing. */
  onShareTree: () => void;
  templates: NoteTemplate[];
  showHelp: boolean;
  onToggleHelp: () => void;
  onChange: React.Dispatch<React.SetStateAction<ServerConfig>>;
  onDiscover: () => void;
  /**
   * True when the form differs from what is stored.
   *
   * Only the warning at the head of the page reads it here — saving and
   * cancelling live in the bar pinned to the foot of the window.
   */
  dirty: boolean;
  /** The device's own name, or null when the host does not report one. */
  device: string | null;
  onWipe: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const {feedDraft, setFeedDraft, onAddFeed, onRemoveFeed, onImportFeeds, feedNames} = props;
  const {feedMessage, feedBusy} = props;
  const {
    snEmail,
    setSnEmail,
    snPassword,
    setSnPassword,
    snCode,
    setSnCode,
    snPending,
    snLists,
    snCounts,
    snMessage,
    snBusy,
    snDaysLeftLabel,
    onSnSignIn,
    onSnVerify,
    onSnSignOut,
    onSnRefreshLists,
  } = props;
  /**
   * Which settings groups are open.
   *
   * Independent rather than an accordion: somebody comparing the weekly and
   * monthly note layouts wants both on screen, and closing one to open another
   * is a repaint they did not ask for. The server group opens by default
   * because it is the one thing a new user must decide about.
   */
  const [openFolds, setOpenFolds] = useState<Set<string>>(() => new Set(['server']));
  const toggleFold = (key: string) =>
    setOpenFolds(previous => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const {
    config,
    collections,
    status,
    scrollHandle,
    onScrollTo,
    storePath,
    onBrowseFolder,
    onBrowseTemplate,
    onShareTree,
    templates,
    showHelp,
    onToggleHelp,
    onChange,
    onDiscover,
    dirty,
    device,
    onWipe,
    onClose,
  } = props;

  /**
   * The rows to show, which is not the same as what discovery found.
   *
   * A collection still in the settings but no longer on the server is not in
   * the discovered list, so it used to have no row — and therefore no box to
   * untick. That made the "no longer on the server" warning impossible to act
   * on: it told the user to untick something the screen would not show them.
   * Stale entries are listed here too, marked, so there is always somewhere to
   * turn one off.
   */
  const withStale = (
    found: TaskCollection[],
    configured: string[],
  ): {url: string; displayName: string; stale: boolean}[] => {
    const rows = found.map(c => ({url: c.url, displayName: c.displayName, stale: false}));
    for (const url of configured) {
      if (!rows.some(r => sameCollection(r.url, url))) {
        rows.push({url, displayName: collectionName(url), stale: true});
      }
    }
    return rows;
  };

  const taskLists = withStale(collections.filter(acceptsTasks), config.collectionUrls);
  const calendars = withStale(collections.filter(acceptsEvents), config.calendarUrls);

  return (
    <>
      <Header title="Setup" onClose={onClose} masthead hideClose />

      {dirty && (
        <Text style={styles.noteCompact}>
          You have unsaved changes. Nothing here takes effect until you save and exit, at the
          foot of this page.
        </Text>
      )}

      <Section title="How to set this up" count={5} open={showHelp} onToggle={onToggleHelp}>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>1. Server URL. </Text>
          Just the origin of your CalDAV server — host and port, nothing after it, e.g.
          https://dav.example.com. Radicale installs usually use port 5232. Do not paste a
          collection address here; {APP_NAME} finds those for you in step 3.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>2. Username and password. </Text>
          The login whose collections you want. If your server supports app passwords,
          make one scoped to these collections rather than using your account password —
          credentials are held in memory only and are not stored in an encrypted keystore.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>3. Find collections. </Text>
          Asks the server where your calendars live and lists what it finds. This works with any
          standards-compliant CalDAV server. If yours keeps collections somewhere unusual, or one
          is nested deeper than the rest, paste its full address into the manual field instead.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>4. Tick task lists and calendars. </Text>
          Task lists (VTODO) feed the Tasks tab; calendars (VEVENT) feed the Calendar tab. A
          collection that accepts both appears in both sections. The list marked "new tasks" is
          pre-ticked when you capture handwriting, though you can send one task to several lists.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>5. Save settings. </Text>
          Nothing takes effect until you press it. The first time {APP_NAME} touches the network,
          Android asks for permission — decline it and every request fails silently, so allow it.
        </Text>
      </Section>

      {/*
        Which build this is, at the top of Settings where it can be read
        without opening anything. A plugin that cannot say its own version
        makes "is the feature missing or is the build missing?" cost an
        install to answer, and it has done exactly that.
      */}
      <Text style={styles.noteCompact}>{`${APP_NAME} ${APP_VERSION} (build ${APP_BUILD})`}</Text>

      {/*
        Outside every fold, and first.
        This lived under "Date and time format" for a release, where it was
        never found: the fold is named for how dates are written, which is not
        where anybody looks for which tab the plugin opens on. It is one line,
        so it costs the page almost nothing to be in the open.
      */}
      <Text style={styles.subheadingCompact}>Open on</Text>
      <Text style={styles.noteCompact}>
        Which tab you land on when the plugin opens. Without a CalDAV server the Tasks tab is
        empty and everything you use is on the Calendar one, so opening on Tasks is a tap you
        never wanted.
      </Text>
      <Choice
        options={[
          {key: 'tasks', label: 'Tasks'},
          {key: 'calendar', label: 'Calendar'},
        ]}
        value={config.startTab}
        onPick={k => onChange(c => ({...c, startTab: k as StartTab}))}
      />

      <Fold
        title="Task and calendar server"
        hint={'Optional. Task Hub or any CalDAV server gives you tasks and calendar events. It is recommended for task management and calendars, but it is NOT required — every note feature below works without it.'}
        open={openFolds.has('server')}
        onToggle={() => toggleFold('server')}
        always={
          // Outside the fold body on purpose: an address you must open a
          // section to discover is no use to somebody deciding whether they
          // need a server at all.
          <>
            <Text style={styles.noteCompact}>
              {`Task Hub is the server this plugin is built alongside — self-hosted, one command
to install, and it runs on a Raspberry Pi:`}
            </Text>
            <Text selectable style={styles.linkText}>
              https://github.com/Sparkinman/task-hub
            </Text>
          </>
        }>
      {/*
        Said plainly, and said here rather than only in the help: somebody who
        does not run a server should be able to stop reading at this point and
        still have a working plugin.
      */}
      <Text style={styles.noteCompact}>
        {`A CalDAV server is RECOMMENDED for task management and calendars, and is NOT required
for the plugin's note features. Without one you still get the day, week, month, quarter and
year views and every note they create, page marks on captured handwriting, and templates.
What needs a server: tasks, calendar events, and capturing handwriting as a task.`}
      </Text>
      <Text style={styles.noteCompact}>
        Any CalDAV server works — Radicale, Nextcloud, Baikal, Fastmail, or anything else
        that speaks the protocol. The fields below are the same either way.
      </Text>

      <Text style={styles.subheadingCompact}>Server</Text>
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Server URL"
        value={config.serverUrl}
        placeholder="https://dav.example.com"
        onChange={v => onChange(c => ({...c, serverUrl: v}))}
      />
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Username"
        value={config.username}
        onChange={v => onChange(c => ({...c, username: v}))}
      />
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Password"
        value={config.password}
        secure
        onChange={v => onChange(c => ({...c, password: v}))}
      />
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Collections owner (only if different from username)"
        value={config.owner}
        placeholder={config.username || 'your-username'}
        onChange={v => onChange(c => ({...c, owner: v}))}
      />

      <View style={styles.actionsTight}>
        <Button label="Find collections" onPress={onDiscover} />
      </View>

      <Text style={styles.subheadingCompact}>Task lists (VTODO)</Text>
      {taskLists.length === 0 && (
        <Text style={styles.noteCompact}>None yet — press "Find collections" above.</Text>
      )}
      {taskLists.map(collection => {
        const checked = config.collectionUrls.some(u => sameCollection(u, collection.url));
        const isDefault = sameCollection(config.defaultCollectionUrl, collection.url);
        return (
          <View key={collection.url} style={styles.checkRowCompact}>
            <Pressable
              style={styles.grow}
              onPress={() => onChange(toggleCollection(config, collection.url))}>
              <Text style={styles.optionTextCompact}>
                {checked ? '☑' : '☐'} {collection.displayName}
                {isDefault ? '  · new tasks' : ''}
                {collection.stale ? '  · not on the server' : ''}
              </Text>
            </Pressable>
            {checked && !isDefault && (
              <Pressable
                style={styles.tinyButton}
                onPress={() => onChange(c => ({...c, defaultCollectionUrl: collection.url}))}>
                <Text style={styles.tinyButtonText}>Set</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      <Text style={styles.subheadingCompact}>Calendars (VEVENT)</Text>
      {calendars.length === 0 && (
        <Text style={styles.noteCompact}>None yet — press "Find collections" above.</Text>
      )}
      {calendars.map(collection => (
        <CheckRow
          key={collection.url}
          compact
          label={
            collection.stale
              ? `${collection.displayName}  · not on the server`
              : collection.displayName
          }
          checked={config.calendarUrls.some(u => sameCollection(u, collection.url))}
          onToggle={() => onChange(toggleCalendar(config, collection.url))}
        />
      ))}
      {(taskLists.some(c => c.stale) || calendars.some(c => c.stale)) && (
        <Text style={styles.noteCompact}>
          Anything marked "not on the server" was found in these settings but not on the
          server — deleted, renamed, or no longer readable by this login. Untick it to stop
          the plugin looking for it.
        </Text>
      )}

      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Or paste a task collection URL"
        value={config.defaultCollectionUrl}
        placeholder="https://dav.example.com/calendars/user/tasks/"
        onChange={v =>
          onChange({
            ...config,
            defaultCollectionUrl: v,
            collectionUrls: config.collectionUrls.includes(v)
              ? config.collectionUrls
              : [...config.collectionUrls.filter(u => u !== config.defaultCollectionUrl), v].filter(
                  Boolean,
                ),
          })
        }
      />

      </Fold>

      {/*
        A sibling of the server fold, deliberately not an alternative to it.

        Both can be in use at once and often should be: tasks (VTODO) only ever
        come from CalDAV, so somebody running Radicale for their tasks may still
        want their work Outlook calendar beside it. Making this a choice between
        the two would have forbidden that combination for no reason.
      */}
      <Fold
        title="ICS Calendars and Supernote To-Dos"
        hint={
          'Two ways to see things without running a server of your own: subscribe to a calendar any service publishes, and connect the tablet’s own To-Do app.'
        }
        open={openFolds.has('feeds')}
        onToggle={() => toggleFold('feeds')}>
        <Text style={styles.noteCompact}>
          {`Google withdrew password access to its CalDAV service in March 2025 and Microsoft retired CalDAV for Outlook altogether, so neither can be connected the way a CalDAV server is. Both still publish a private web address for each calendar, and so do Apple, Fastmail and Proton. Subscribing to one shows its events here.

Events from a subscription can be read and can have a note attached, but cannot be edited or deleted — change them in the calendar they belong to. For two-way sync with Google or Outlook, run the Task Hub server and let it do the syncing.`}
        </Text>

        <Text style={styles.subheadingCompact}>Subscribed calendars (.ics)</Text>
        <Text style={styles.noteCompact}>
          Read-only. The way to see a Google or Outlook calendar, neither of which any CalDAV
          client can reach any more. Needs no account — just the address the calendar
          publishes.
        </Text>

        <Text style={styles.subheadingCompact}>Where to find the address</Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>Google: </Text>
          Calendar → Settings → pick the calendar → Integrate calendar → "Secret address in iCal
          format". Not the public page and not the browser address.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>Outlook: </Text>
          Calendar → Settings → Shared calendars → Publish a calendar → pick "Can view all
          details" → copy the ICS link.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>Apple: </Text>
          iCloud Calendar → the share icon beside a calendar → Public Calendar → copy the link.
        </Text>
        <Text style={styles.noteCompact}>
          Treat these addresses like passwords: anyone who has one can read that calendar. Task
          Hub only accepts https:// ones, so they are never sent in the clear.
        </Text>

        <Text style={styles.subheadingCompact}>Add one</Text>
        <Text style={styles.noteCompact}>
          {'A private calendar address is around a hundred characters of random. Typing one on this keyboard is miserable, so the easier route is a plain text file you write on a computer and copy across.'}
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>1. </Text>
          On a computer, make a plain text file named exactly {FEED_LIST_FILE}.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>2. </Text>
          Put one calendar address on each line. To name a calendar, put the name first and a
          bar before the address — otherwise the name is read from the calendar itself:
        </Text>
        <Text selectable style={styles.codeBlock}>
          {`Work|https://calendar.google.com/calendar/ical/.../basic.ics
https://outlook.office365.com/owa/calendar/.../calendar.ics`}
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>3. </Text>
          Copy it onto the device over USB, into the same folder as settings.json:
        </Text>
        <Text selectable style={styles.codeBlock}>
          {`Document/TaskHub/${FEED_LIST_FILE}`}
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>4. </Text>
          Press the button below, then Save settings.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>5. </Text>
          Delete the file from the device. Those addresses are as good as passwords, and Task
          Hub has already stored what it needs.
        </Text>
        <View style={styles.actions}>
          <Button
            label={feedBusy ? 'Reading…' : `Import ${FEED_LIST_FILE}`}
            onPress={onImportFeeds}
            disabled={feedBusy}
          />
        </View>
        <Field
          scrollHandle={scrollHandle}
          onScrollTo={onScrollTo}
          compact
          label="…or paste one address"
          value={feedDraft}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          onChange={setFeedDraft}
        />
        <View style={styles.actions}>
          <Button label="Add calendar" onPress={onAddFeed} />
        </View>

        {/*
          Directly beneath the two buttons, not at the foot of the page. The
          shared StatusLine sits hundreds of rows below this fold, so a message
          sent there made pressing Import look like it did nothing at all.
        */}
        {!!feedMessage && <Text style={styles.feedMessage}>{feedMessage}</Text>}

        <Text style={styles.subheadingCompact}>Subscribed</Text>
        {config.feeds.length === 0 ? (
          <Text style={styles.noteCompact}>None yet.</Text>
        ) : (
          config.feeds.map(feed => (
            <View key={feed.url} style={styles.feedRow}>
              <View style={styles.grow}>
                <Text style={styles.feedName}>{feedNames[feed.url] || feed.name}</Text>
                {/*
                  Shown, because a list of calendars all called "calendar.google.com"
                  is no list at all — and because seeing the address is how somebody
                  checks they pasted the right one.
                */}
                <Text style={styles.feedUrl} numberOfLines={1}>
                  {feed.url}
                </Text>
              </View>
              <Button label="Remove" onPress={() => onRemoveFeed(feed.url)} />
            </View>
          ))
        )}

        {/*
          The tablet's own To-Do app, in the same fold as the subscriptions
          because both answer the same question: what can this plugin reach
          without a server of your own.
        */}
        <Text style={styles.subheadingCompact}>Supernote To-Dos</Text>
        <Text style={styles.noteCompact}>
          {`The to-do list built into your Supernote, read and written through Supernote Cloud. Off until you switch it on.

This is the one thing here built on an API Ratta never published. It was worked out against a live account and it works, but nothing about it is promised: a Partner app update could change it, and the first sign would be this failing. Everything else in ${APP_NAME} uses an open standard.

If you run the Task Hub server, you do not want this — it already syncs these to-dos into your task lists, both ways, and keeps working when this cannot.`}
        </Text>

        <CheckRow
          compact
          label="Connect the Supernote To-Do app"
          checked={config.supernote.enabled}
          onToggle={() =>
            onChange(c => ({...c, supernote: {...c.supernote, enabled: !c.supernote.enabled}}))
          }
        />

        {config.supernote.enabled && (
          <>
            {!config.supernote.token ? (
              <>
                <Text style={styles.noteCompact}>
                  {`Sign in with the account your tablet uses. ${APP_NAME} stores only the session it gets back, never your password — and that session lasts thirty days, after which Supernote requires a fresh sign-in with a code emailed to you. There is no way around that; their service offers nothing to renew it.`}
                </Text>
                <Field
                  compact
                  scrollHandle={scrollHandle}
                  onScrollTo={onScrollTo}
                  label="Supernote account email"
                  value={snEmail}
                  onChange={setSnEmail}
                />
                {!snPending ? (
                  <>
                    <Field
                      compact
                      secure
                      scrollHandle={scrollHandle}
                      onScrollTo={onScrollTo}
                      label="Password"
                      value={snPassword}
                      onChange={setSnPassword}
                    />
                    <View style={styles.actions}>
                      <Button
                        label={snBusy ? 'Signing in…' : 'Sign in'}
                        primary
                        disabled={snBusy}
                        onPress={onSnSignIn}
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <Field
                      compact
                      scrollHandle={scrollHandle}
                      onScrollTo={onScrollTo}
                      label="Verification code from your email"
                      value={snCode}
                      onChange={setSnCode}
                    />
                    <View style={styles.actions}>
                      <Button
                        label={snBusy ? 'Checking…' : 'Verify and finish'}
                        primary
                        disabled={snBusy}
                        onPress={onSnVerify}
                      />
                      <Button label="Start again" onPress={onSnSignOut} />
                    </View>
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={styles.noteCompact}>
                  {`Signed in as ${config.supernote.email || 'your Supernote account'}.${
                    snDaysLeftLabel ? ` ${snDaysLeftLabel}` : ''
                  }`}
                </Text>
                <View style={styles.actions}>
                  <Button label="Refresh lists" onPress={onSnRefreshLists} />
                  <Button label="Sign out" onPress={onSnSignOut} />
                </View>

                <Text style={styles.label}>To-do lists to show</Text>
                {snLists.length === 0 ? (
                  <Text style={styles.noteCompact}>
                    No lists loaded yet — press Refresh lists.
                  </Text>
                ) : (
                  snLists.map(list => (
                    <CheckRow
                      compact
                      key={list.id}
                      // The count is what answers "which list is it actually
                      // in?" without ticking each one in turn and saving.
                      label={`${list.name} — ${snCounts[list.id] ?? 0} open`}
                      checked={config.supernote.lists.some(l => l.id === list.id)}
                      onToggle={() =>
                        onChange(c => ({
                          ...c,
                          supernote: {
                            ...c.supernote,
                            lists: c.supernote.lists.some(l => l.id === list.id)
                              ? c.supernote.lists.filter(l => l.id !== list.id)
                              : [...c.supernote.lists, list],
                          },
                        }))
                      }
                    />
                  ))
                )}
                <Text style={styles.noteCompact}>
                  Ticked lists appear beside your other task lists, and can be completed,
                  edited and added to from here. Priority and repeats are not offered for
                  them: the tablet's To-Do app stores a title and a date and nothing else.
                </Text>
                {snLists.some(list => isSnUnfiled(snCollectionUrl(list.id))) && (
                  <Text style={styles.noteCompact}>
                    Inbox holds the to-dos that belong to no list — the ones in the To-Do
                    app's All view and nowhere else. It is shown only while something is
                    in it, and nothing can be added to it: file a to-do on the tablet and
                    it moves to that list here too.
                  </Text>
                )}
              </>
            )}

            {!!snMessage && <Text style={styles.feedMessage}>{snMessage}</Text>}
          </>
        )}
      </Fold>

      <Fold
        title="Notes"
        hint={'Daily, weekly, monthly, quarterly, yearly and meeting notes: where each lives, how its path is built, and which template a new one starts from. None of this needs a server.'}
        open={openFolds.has('notes')}
        onToggle={() => toggleFold('notes')}>
      {/*
        One tap for the arrangement most people want, because getting it by hand
        means setting six roots and five layouts to values that have to agree
        with each other — and a single mismatch scatters the notes across two
        trees without saying so.
      */}
      <Text style={styles.subheadingCompact}>One folder for everything</Text>
      <Text style={styles.noteCompact}>
        {`Puts every kind of note in one calendar tree under ${SHARED_TREE_ROOT}, nested by date and named for what it is:

${SHARED_TREE_ROOT}/2026/Year.note
${SHARED_TREE_ROOT}/2026/Q3/Quarter.note
${SHARED_TREE_ROOT}/2026/September/Month.note
${SHARED_TREE_ROOT}/2026/September/Week 38.note
${SHARED_TREE_ROOT}/2026/September/14/Daily.note

Notes you already have are not moved, and the plugin looks for notes where the settings say they are — so after this, existing notes filed under the old scheme show as "Create" rather than "Open" until you move them.`}
      </Text>
      <View style={styles.actionsTight}>
        <Button label="Use one folder for all notes" onPress={onShareTree} />
      </View>

      <Text style={styles.subheadingCompact}>Daily notes</Text>
      <Text style={styles.noteCompact}>
        One note per day, created and opened from the Day, Week and Month views. The button on
        those views says "Create" or "Open" depending on whether the day already has one.
      </Text>
      <CheckRow
        compact
        label="Daily notes enabled"
        checked={config.dailyNote.enabled}
        onToggle={() =>
          onChange({
            ...config,
            dailyNote: {...config.dailyNote, enabled: !config.dailyNote.enabled},
          })
        }
      />
      <View style={styles.browseRow}>
        <View style={styles.grow}>
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={onScrollTo}
            compact
            label="Folder under device storage"
            value={config.dailyNote.root}
            placeholder="Note/Daily"
            onChange={v => onChange(c => ({...c, dailyNote: {...c.dailyNote, root: v}}))}
          />
        </View>
        <Pressable style={styles.browseButton} onPress={() => onBrowseFolder('daily')}>
          <FolderIcon />
          <Text style={styles.browseLabel}>Browse</Text>
        </Pressable>
      </View>
      <Text style={styles.labelCompact}>Folder layout</Text>
      <Choice
        options={LAYOUT_PRESETS.map(p => ({key: p.layout, label: p.label}))}
        value={config.dailyNote.layout}
        onPick={k => onChange(c => ({...c, dailyNote: {...c.dailyNote, layout: k}}))}
      />
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Custom layout — {YYYY} {MM} {MMM} {MMMM} {DD} {DATE} {ISO}"
        value={config.dailyNote.layout}
        onChange={v => onChange(c => ({...c, dailyNote: {...c.dailyNote, layout: v}}))}
      />
      <Text style={styles.noteCompact}>
        {`Today would be: ${
          dailyNotePath(config.dailyNote, toDateInput(new Date()), config.dateFormat) ||
          '(invalid layout)'
        }`}
      </Text>
      <CheckRow
        compact
        label="Write the date at the top of a new daily note"
        checked={config.dailyNote.dateHeading}
        onToggle={() =>
          onChange(c => ({
            ...c,
            dailyNote: {...c.dailyNote, dateHeading: !c.dailyNote.dateHeading},
          }))
        }
      />
      <Text style={styles.noteCompact}>
        {`Puts the date in a text box at the head of the first page, in the format chosen above — today would read "${formatDate(toDateInput(new Date()), config.dateFormat)}". Only when the note is created, never when an existing one is opened, so it cannot write into a page twice. Leave it off if your template already prints the date.`}
      </Text>

      <Text style={styles.labelCompact}>Template for a new note</Text>
      <Text style={styles.noteCompact}>
        The page style a newly created daily note starts with. Applied once, when the note is
        made — changing it does not restyle notes you already have.
      </Text>
      <TemplatePicker
        templates={templates}
        label="Daily note template"
        value={config.dailyNote.template}
        onOpen={() => onBrowseTemplate('daily')}
      />

      <PeriodNoteSettings
        title="Weekly notes"
        period="week"
        noteKey="weekNote"
        hint="One note per week, separate from the daily notes. Created from the week view; every day of that week opens the same note."
        tokens="{YYYY} {WW} {MM} {MMMM} {START} {END}"
        config={config}
        templates={templates}
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        onBrowse={() => onBrowseFolder('week')}
        onBrowseTemplate={() => onBrowseTemplate('week')}
        onChange={onChange}
      />

      <PeriodNoteSettings
        title="Monthly notes"
        period="month"
        noteKey="monthNote"
        hint="One note per month, created from the month view."
        tokens="{YYYY} {MM} {MMM} {MMMM}"
        config={config}
        templates={templates}
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        onBrowse={() => onBrowseFolder('month')}
        onBrowseTemplate={() => onBrowseTemplate('month')}
        onChange={onChange}
      />

      <PeriodNoteSettings
        title="Quarterly notes"
        period="quarter"
        noteKey="quarterNote"
        hint="One note per quarter, created from the quarter view."
        tokens="{YYYY} {Q} {QQ} {MMM} {MMM_END}"
        config={config}
        templates={templates}
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        onBrowse={() => onBrowseFolder('quarter')}
        onBrowseTemplate={() => onBrowseTemplate('quarter')}
        onChange={onChange}
      />

      <PeriodNoteSettings
        title="Yearly notes"
        period="year"
        noteKey="yearNote"
        hint="One note per year, created from the year view."
        tokens="{YYYY}"
        config={config}
        templates={templates}
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        onBrowse={() => onBrowseFolder('year')}
        onBrowseTemplate={() => onBrowseTemplate('year')}
        onChange={onChange}
      />

      </Fold>

      <Fold
        title="Meeting notes"
        hint={
          'Notes attached to a calendar event. These need a calendar, so they are the one ' +
          'kind of note that does depend on a server.'
        }
        open={openFolds.has('meetings')}
        onToggle={() => toggleFold('meetings')}>
      <Text style={styles.subheadingCompact}>Meeting notes</Text>
      <Text style={styles.noteCompact}>
        Notes linked to calendar events. Stored on this device only — nothing is written back
        to the server. Every occurrence of a repeating event shares one note.
      </Text>
      <View style={styles.browseRow}>
        <View style={styles.grow}>
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={onScrollTo}
            compact
            label="Folder under device storage"
            value={config.meetingNote.root}
            placeholder="Note/Meetings"
            onChange={v => onChange(c => ({...c, meetingNote: {...c.meetingNote, root: v}}))}
          />
        </View>
        <Pressable style={styles.browseButton} onPress={() => onBrowseFolder('meeting')}>
          <FolderIcon />
          <Text style={styles.browseLabel}>Browse</Text>
        </Pressable>
      </View>
      <Text style={styles.labelCompact}>Template for a new note</Text>
      <Text style={styles.noteCompact}>
        The page style a newly created meeting note starts with. Applied once, when the note is
        made — changing it does not restyle notes you already have.
      </Text>
      <TemplatePicker
        templates={templates}
        label="Meeting note template"
        value={config.meetingNote.template}
        onOpen={() => onBrowseTemplate('meeting')}
      />

      </Fold>

      <Fold
        title="Date and time format"
        hint={'How dates and times are written throughout the plugin.'}
        open={openFolds.has('formats')}
        onToggle={() => toggleFold('formats')}>
      <Text style={styles.subheadingCompact}>Agenda hours</Text>
      <Text style={styles.noteCompact}>
        Which hours the Day view lays out as rows. Anything timed outside them is still
        listed, plainly, under the grid — narrowing this decides what gets a row of its own,
        not what the day contains. All-day items stay at the top whatever you choose.
      </Text>
      <Text style={styles.labelCompact}>Day starts at</Text>
      <Choice
        options={AGENDA_HOURS.map(h => ({key: String(h), label: hourLabel(h, config.timeFormat)}))}
        value={String(config.agendaStartHour)}
        onPick={k => onChange(c => ({...c, agendaStartHour: Number(k)}))}
      />
      <Text style={styles.labelCompact}>Day ends at</Text>
      <Choice
        options={AGENDA_HOURS.map(h => ({key: String(h), label: hourLabel(h, config.timeFormat)}))}
        value={String(config.agendaEndHour)}
        onPick={k => onChange(c => ({...c, agendaEndHour: Number(k)}))}
      />
      {config.agendaEndHour < config.agendaStartHour && (
        <Text style={styles.noteCompact}>
          The end is before the start, so the Day view shows the starting hour only. Everything
          else appears under the grid.
        </Text>
      )}

      <Text style={styles.subheadingCompact}>Date format</Text>
      <Choice
        options={DATE_FORMATS.map(f => ({key: f.key, label: `${f.label}  ${f.example}`}))}
        value={config.dateFormat}
        onPick={k => onChange(c => ({...c, dateFormat: k as DateFormat}))}
      />

      <Text style={styles.subheadingCompact}>Time format</Text>
      <Choice
        options={TIME_FORMATS.map(f => ({key: f.key, label: `${f.label}  ${f.example}`}))}
        value={config.timeFormat}
        onPick={k => onChange(c => ({...c, timeFormat: k as TimeFormat}))}
      />

      </Fold>

      <Fold
        title="Marks left on a captured page"
        hint={'What the plugin draws on a note page when handwriting there becomes a task.'}
        open={openFolds.has('marks')}
        onToggle={() => toggleFold('marks')}>
      <Text style={styles.subheadingCompact}>Mark the page a task came from</Text>
      <Text style={styles.noteCompact}>
        When you lasso handwriting into a task, the strokes are boxed on the page so you can
        see one was made from them, and tapping the box shows the Task Hub logo so it is
        clear what took it. Completing the task removes the box again. This writes a link
        into your note; choose No mark to leave your pages untouched.
      </Text>
      <Choice
        options={MARK_STYLES.map(m => ({key: m.key, label: m.label}))}
        value={config.markStyle}
        onPick={k => onChange(c => ({...c, markStyle: k as MarkStyle}))}
      />
      {config.markStyle !== 'off' && (
        <>
          <CheckRow
            compact
            label={`Also write "${TASK_LABEL}" underneath`}
            checked={config.markLabel}
            onToggle={() => onChange(c => ({...c, markLabel: !c.markLabel}))}
          />
          <Text style={styles.noteCompact}>
            A short caption under the boxed writing, so the box explains itself without being
            tapped. It is a link like the box, so completing the task removes it too.
          </Text>
          <CheckRow
            compact
            label="Also shade it with the marker pen"
            checked={config.markShade}
            onToggle={() => onChange(c => ({...c, markShade: !c.markShade}))}
          />
          <Text style={styles.noteCompact}>
            Draws marker passes across the handwriting so a captured task stands out without
            being tapped, and removes them again when the task is completed. The shading is its
            own mark rather than part of the writing, so moving or copying the handwriting
            leaves it behind, and it then has to be erased by hand.
          </Text>
          {config.markShade && (
            <>
              <Text style={styles.labelCompact}>Shading colour</Text>
              <Choice
                options={SHADE_COLORS.map(c => ({key: c.key, label: c.label}))}
                value={config.markShadeColor}
                onPick={k => onChange(c => ({...c, markShadeColor: k}))}
              />
              <Text style={styles.noteCompact}>
                Light grey is the easiest to read handwriting through. Black draws a real
                strike-through rather than a highlight. These are the only colours the
                device's own drawing API accepts.
              </Text>
            </>
          )}
        </>
      )}
      </Fold>

      {/* Outside every fold: where the settings are kept is not something to
          have to open a section to read. Save and Cancel are no longer here —
          they are pinned to the foot of the window, so they are reachable from
          anywhere in this page rather than only from this point in it. */}
      <Text style={styles.noteCompact}>
        {storePath
          ? `Saved to ${storePath} — survives plugin updates and reinstalls. Plain text on shared storage, so prefer an app password or a credential scoped to these collections.`
          : 'This build has no on-device storage, so settings last only for this session.'}
      </Text>

      <Fold
        title="This device"
        hint={'What the plugin has detected, and how it has sized itself to suit.'}
        open={openFolds.has('device')}
        onToggle={() => toggleFold('device')}>
        <Text style={styles.noteCompact}>
          {`Model: ${device ?? 'not reported by the host'}
Panel height: ${Math.round(SCREEN_HEIGHT)}
Text scale: ${Math.round(UI_SCALE * 100)}%`}
        </Text>
        <Text style={styles.noteCompact}>
          Type is scaled from the height the panel reports, so a smaller device such as the
          Nomad fits the same amount on screen instead of needing more scrolling. The scale is
          calibrated against real measurements — a Manta reports 1365 and reads well at full
          size, a Nomad reports 998 and reads well at 70% — and anything between is
          interpolated.
          Borders and the controls you tap are left at full size: a shrunken fold arrow is
          harder to hit, which would be the opposite of the point.
        </Text>
      </Fold>

      <Fold
        title="Storage and starting over"
        hint={'Where these settings are kept on the device, and how to clear them.'}
        open={openFolds.has('storage')}
        onToggle={() => toggleFold('storage')}>
        <Text style={styles.subheadingCompact}>Start over</Text>
        <Text style={styles.noteCompact}>
          Uninstalling the plugin does not remove the saved file — it is kept outside the
          plugin's own storage so settings survive updates. This is the way to clear it.
        </Text>
        <View style={styles.actionsTight}>
          <Button label="Wipe All Save Data" onPress={onWipe} />
        </View>
      </Fold>

      <StatusLine status={status} />
    </>
  );
}
