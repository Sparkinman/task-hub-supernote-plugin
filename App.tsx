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
  TIME_FORMATS,
  addMinutes,
  formatDate,
  formatTime,
  minutesBetween,
  type DateFormat,
  type TimeFormat,
} from './src/format';
import {
  DEFAULT_SORT,
  SORT_KEYS,
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
import {DEMO} from './src/mode';
import {
  DEMO_BANNER,
  DEMO_BLOCKED,
  DEMO_COLLECTIONS,
  DEMO_CONFIG,
  demoEvents,
  demoMeetingFiles,
  demoNoteFiles,
  demoTasks,
} from './src/demo';
import {PermissionDeniedError} from './src/permissions';
import {
  EMPTY_CONFIG,
  canDiscover,
  collectionName,
  getCollections,
  getConfig,
  hasCalendars,
  hasCollections,
  isConfigured,
  setCollections,
  setConfig,
  toggleCalendar,
  toggleCollection,
  type RadicaleConfig,
} from './src/settings';
import {
  completeTask,
  createEvent,
  editEvent,
  editTask,
  listEvents,
  listTasks,
  missingMessage,
  type MissingCollection,
  type RemoteEvent,
  type RemoteTask,
} from './src/tasks';
import {
  loadSettings,
  saveSettings,
  settingsLocation,
  storageAvailable,
  wipeSettings,
} from './src/storage';
import {LAYOUT_PRESETS, dailyNotePath, daysWithNotes} from './src/dailynote';
import {
  PERIOD_LAYOUT_PRESETS,
  hasPeriodNote,
  periodLabel,
  periodNotePath,
  periodStart,
  type Period,
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
  openDailyNote,
  openMeetingNote,
  openFileAt,
  openNote,
  type NoteTemplate,
} from './src/notes';
import {eventsWithNotes} from './src/meetingnote';
import {TemplatePicker} from './src/components/TemplatePicker';
import {FolderPicker} from './src/components/FolderPicker';
import {MiniCalendar} from './src/components/MiniCalendar';
import {weekOf} from './src/components/WeekView';

const LASSO_BUTTON_ID = 200;
const TOOLBAR_BUTTON_ID = 100;

type Screen = 'idle' | 'save' | 'hub' | 'settings';
type Tab = 'tasks' | 'calendar';
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
  const [config, setLocalConfig] = useState<RadicaleConfig>(DEMO ? DEMO_CONFIG : getConfig);
  const [collections, setLocalCollections] = useState<TaskCollection[]>(
    DEMO ? DEMO_COLLECTIONS : getCollections,
  );

  const [draft, setDraft] = useState<TaskDraftState>(EMPTY_TASK);
  const [targets, setTargets] = useState<string[]>([]);
  const [source, setSource] = useState<SourceRef | undefined>(undefined);
  const [tasks, setTasks] = useState<RemoteTask[]>([]);
  const [events, setEvents] = useState<RemoteEvent[]>([]);
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
  const [monthTasksOpen, setMonthTasksOpen] = useState(false);
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
  const [pickingFolder, setPickingFolder] = useState<
    'daily' | 'week' | 'month' | 'quarter' | 'year' | 'meeting' | null
  >(null);
  const [pickingDate, setPickingDate] = useState<'day' | 'week' | null>(null);
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [restored, setRestored] = useState(false);

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
   * Refuse an action in the demo build and say so.
   *
   * Returns true when it handled the call, so every guarded handler reads as
   * `if (blockedInDemo()) { return; }`.
   */
  const blockedInDemo = useCallback((): boolean => {
    if (!DEMO) {
      return false;
    }
    setAsk(null);
    setStatus({kind: 'done', message: DEMO_BLOCKED});
    return true;
  }, []);

  /**
   * What a reload needs to fetch.
   *
   * A full refresh is eight operations: two CalDAV listings and six walks of
   * the note folders. Running all of them after saving one task is most of the
   * wait the user feels when they press Save — nothing about a new task changes
   * which days have notes. Each write says what it actually invalidated.
   */
  const refresh = useCallback(async (scope: 'all' | 'tasks' | 'events' | 'notes' = 'all') => {
    if (DEMO) {
      // Sample data, generated fresh so it is always dated around today. No
      // network call is made, and none can be: the demo build does not declare
      // the INTERNET permission.
      const now = new Date();
      setTasks(demoTasks(now));
      setEvents(demoEvents(now));
      setMissing([]);
      // A few days already have notes, so the month grid's N marker and the
      // "open" rather than "create" path are both reachable in the demo.
      setNoteFiles(demoNoteFiles(now));
      setMeetingFiles(demoMeetingFiles());
      return;
    }

    const cfg = getConfig();
    const wantTasks = scope === 'all' || scope === 'tasks';
    const wantEvents = scope === 'all' || scope === 'events';
    const wantNotes = scope === 'all' || scope === 'notes';
    setLoading(true);
    try {
      const [t, e, n, m, wn, mn, qn, yn] = await Promise.all([
        wantTasks && hasCollections(cfg) ? listTasks(cfg) : Promise.resolve(null),
        wantEvents && hasCalendars(cfg) ? listEvents(cfg) : Promise.resolve(null),
        wantNotes ? findExistingNotes(cfg.dailyNote) : Promise.resolve(null),
        wantNotes ? findMeetingNotes(cfg.meetingNote) : Promise.resolve(null),
        wantNotes ? findPeriodNotes(cfg.weekNote) : Promise.resolve(null),
        wantNotes ? findPeriodNotes(cfg.monthNote) : Promise.resolve(null),
        wantNotes ? findPeriodNotes(cfg.quarterNote) : Promise.resolve(null),
        wantNotes ? findPeriodNotes(cfg.yearNote) : Promise.resolve(null),
      ]);
      if (t) {
        setTasks(t.items);
      }
      if (e) {
        setEvents(e.items);
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
      setLoading(false);
    }
  }, []);

  /**
   * Pending auto-close, so it can be cancelled.
   *
   * If it fires after the user has already tapped Done & Exit, closePluginView
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
   * Every Done & Exit goes through here rather than straight to `close`.
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
   * Every Save and every Done & Exit is held back until it clears, so a write
   * cannot be started twice by an impatient second tap and the plugin cannot be
   * closed with one half done. On a panel that takes a moment to redraw, a
   * button that looks unresponsive invites exactly that second tap.
   */
  const [writing, setWriting] = useState(false);

  /**
   * Run a write immediately, with no confirmation.
   *
   * The same path as runAsk — demo guard, busy flag, status, scoped reload —
   * minus the dialog. Used for creating and editing a task, which is the write
   * done most often and the least consequential: it adds a row that can be
   * edited or ticked off in two taps. Making somebody confirm it turned every
   * save into a second full-screen repaint and a second press.
   *
   * Everything destructive still goes through runAsk: completing, wiping,
   * discarding unsaved work.
   */
  const runNow = useCallback(async (action: Ask) => {
    if (blockedInDemo()) {
      return;
    }
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
  }, [blockedInDemo, refresh, scheduleClose]);

  /** Confirm → push → success → reload. The single write path. */
  const runAsk = useCallback(async () => {
    // Every write in the plugin passes through here, which is what makes one
    // guard enough to guarantee the demo changes nothing.
    if (blockedInDemo()) {
      return;
    }
    const pending = ask;
    setAsk(null);
    if (!pending) {
      return;
    }
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
  }, [ask, refresh, scheduleClose, blockedInDemo]);

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
      // Deliberately no refresh. This screen shows the title, the lists to save
      // into (from settings) and a due date — none of which come from the
      // server. Fetching both collections and scanning for notes here put
      // several seconds between the lasso and being able to press Save.
      if (isConfigured(cfg)) {
        setStatus(null);
      } else {
        // Not an error in the sense of something having gone wrong: capturing a
        // task is the one feature that genuinely needs a server to put it on.
        setStatus({
          kind: 'error',
          message:
            'Saving a task needs a task list. Add a CalDAV server in settings, or use the note features, which work without one.',
        });
      }
    } catch (err) {
      setStatus({kind: 'error', message: describe(err)});
    }
  }, []);

  const openHub = useCallback(() => {
    viewShowing.current = true;
    setStatus(null);
    setTaskForm(null);
    setEventForm(null);
    setScreen('hub');
    // Refreshed here as well as by the screen effect below. The effect only
    // fires when `screen` changes, and `screen` stays 'hub' when the plugin is
    // dismissed by the host rather than by our own close button — so on the
    // next opening the effect saw no change and the list stayed as it was.
    void refresh();
  }, [refresh]);

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
      void refresh();
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
    if (DEMO) {
      // Nothing is read from or written to disk in the demo build, so a real
      // installation's settings sitting next to it are left untouched.
      void refresh();
      return;
    }
    void (async () => {
      const stored = await loadSettings();
      if (stored) {
        setConfig(stored);
        setLocalConfig(stored);
        // Seed the capture screen's list from the settings just loaded.
        //
        // capture() reads getConfig() when the lasso button is pressed, and on
        // a cold start that can happen before this load has finished — the
        // default list was then read from an empty config and nothing came out
        // pre-ticked. Only seeded when nothing has been chosen, so a choice
        // made in the meantime is not overwritten.
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
        void refresh();
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
        setLocalConfig(getConfig());
        setLocalCollections(getCollections());
        setStatus(null);
        setScreen('settings');
        // Only this screen needs them, and the call is cheap.
        if (!DEMO) {
          void listAllTemplates().then(setTemplates);
        }
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
        ? `"${summary}" will be updated on Radicale.`
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
    (period: Period, cfg: RadicaleConfig) =>
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
      if (blockedInDemo()) {
        return;
      }
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
    [leaveForNote, blockedInDemo, noteConfigFor],
  );

  const askDailyNote = useCallback(
    (iso: string, exists: boolean) => {
      // Guarded here rather than in runAsk alone: the "already exists" branch
      // opens a file without going through a confirmation.
      if (blockedInDemo()) {
        return;
      }
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
          // Close first, then open — the host keeps believing the plugin view
          // is up if closePluginView runs after openFile.
          leaveForNote();
          await openDailyNote(cfg.dailyNote, iso, cfg.dateFormat);
          return `Saved successfully — created ${path}.`;
        },
      });
    },
    [leaveForNote, blockedInDemo],
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
      // The demo's source path names a note that does not exist.
      if (blockedInDemo()) {
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
    [leaveForNote, blockedInDemo],
  );

  const askEventNote = useCallback(
    (event: RemoteEvent, exists: boolean) => {
      if (blockedInDemo()) {
        return;
      }
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
    [close, meetingFiles, blockedInDemo],
  );

  const askComplete = useCallback((task: RemoteTask) => {
    // A task captured from handwriting leaves a box on that page. Once it is
    // done the box is stale, so completing the task clears it — and the
    // confirmation says so, because it edits the user's own note.
    const marked = !!task.sourcePath;
    setAsk({
      title: 'Mark task complete?',
      reload: 'tasks',
      body: marked
        ? `"${task.summary}" will be marked complete on Radicale, and the box removed from the page it came from.`
        : `"${task.summary}" will be marked complete on Radicale.`,
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
    });
  }, []);

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

  // ---- settings ----

  const discover = useCallback(async () => {
    if (blockedInDemo()) {
      return;
    }
    setConfig(config);
    if (!canDiscover(config)) {
      setStatus({kind: 'error', message: 'Enter the server URL and username first.'});
      return;
    }
    setStatus({kind: 'working', message: 'Looking for collections…'});
    try {
      const found = await discoverCollections(config);
      setCollections(found);
      setLocalCollections(found);
      setStatus({
        kind: 'done',
        message: `Found ${found.length} collection(s). Tick what to use, then Save settings.`,
      });
    } catch (err) {
      setStatus({kind: 'error', message: describe(err)});
    }
  }, [config, blockedInDemo]);

  /**
   * Write the settings, reporting whether they were stored.
   *
   * Returns false when nothing was saved — the demo build, or a storage
   * failure — so the caller can decline to say "Setup saved" and leave.
   */
  const persistSettings = useCallback(async (): Promise<boolean> => {
    if (blockedInDemo()) {
      return false;
    }
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
  }, [config, refresh, blockedInDemo]);

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
  const askWipe = useCallback(() => {
    setAsk({
      title: 'Wipe all saved data?',
      body:
        'Clears the server address, username, password, chosen task lists and ' +
        'calendars, date and time formats, note folders, and the links between ' +
        'calendar events and their meeting notes. Your notes and everything on ' +
        'Radicale are left alone. This cannot be undone.',
      label: 'Yes, wipe',
      run: async () => {
        await wipeSettings();
        setConfig(EMPTY_CONFIG);
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

  const eventNotes = useMemo(
    () => eventsWithNotes(meetingFiles, events, config.meetingNote, config.meetingLinks),
    [meetingFiles, events, config.meetingNote, config.meetingLinks],
  );

  const marks = useMemo(
    () => monthMarks(events, tasks, noteDays),
    [events, tasks, noteDays],
  );
  const dayEvents = useMemo(() => eventsOnDay(events, day), [events, day]);
  const dayTasks = useMemo(() => tasksOnDay(open, day), [open, day]);

  if (screen === 'idle') {
    return <View style={styles.root} />;
  }

  const {dateFormat, timeFormat} = config;
  const calendars = collections.filter(acceptsEvents);

  const openEventEditor = (event: RemoteEvent) => {
    setEditingEvent(event);
    setEventTarget(event.calendarUrl);
    setEventForm({
      summary: event.summary,
      description: event.description ?? '',
      location: event.location ?? '',
      date: event.startDate,
      startTime: event.startTime ?? '',
      endTime: event.endTime ?? '',
      repeat: repeatKey(event.rrule),
    });
    setStatus(null);
  };

  const openTaskEditor = (task: RemoteTask | null) => {
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
      onLayout={() => setScrollHandle(findNodeHandle(scrollRef.current))}
      contentContainerStyle={[
        styles.content,
        // Room to scroll the focused field clear of the keyboard, sized from
        // what the host reported rather than from a constant.
        keyboardUp && {paddingBottom: keyboardHeight + 24},
      ]}>
      {DEMO && (
        <View style={styles.demoBanner}>
          <Text style={styles.demoBannerText}>{DEMO_BANNER}</Text>
        </View>
      )}

      {screen === 'save' && (
        <>
          <Header
            title="New task"
            onClose={closeGuarded}
            closeDisabled={writing}
            action={{
              label: writing ? 'Saving…' : 'Save task',
              onPress: askSaveCaptured,
              disabled: writing,
            }}
          />
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            label="Title"
            value={draft.summary}
            multiline
            onChange={v => setDraft(d => ({...d, summary: v}))}
          />

          {config.collectionUrls.length > 0 && (
            <>
              <Text style={styles.label}>Save to</Text>
              {config.collectionUrls.map(url => (
                <CheckRow
                  key={url}
                  label={collectionName(url)}
                  checked={targets.includes(url)}
                  onToggle={() =>
                    setTargets(prev =>
                      prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url],
                    )
                  }
                />
              ))}
            </>
          )}

          <Text style={styles.label}>Due</Text>
          <DateTimePicker
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            date={draft.dueDate}
            time={draft.dueTime}
            timeFormat={timeFormat}
            onChange={(date, time) => setDraft(d => ({...d, dueDate: date, dueTime: time}))}
          />
          <Text style={styles.label}>Priority</Text>
          <Choice
            options={PRIORITY_BANDS.map(p => ({key: p.key, label: p.label}))}
            value={draft.priority}
            onPick={k => setDraft(d => ({...d, priority: k as PriorityBand}))}
          />
          <Text style={styles.label}>Repeats</Text>
          {draft.repeat === 'custom' && (
            <Text style={styles.noteCompact}>
              {repeatLabel('custom')} — a rule set in another app, which this menu cannot
              describe. It is kept exactly as it is unless you choose one below.
            </Text>
          )}
          <Choice
            options={REPEAT_OPTIONS.map(r => ({key: r.key, label: r.label}))}
            value={draft.repeat}
            onPick={k => setDraft(d => ({...d, repeat: k as RepeatKey}))}
          />

          <Field
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            label="Description"
            value={draft.description}
            multiline
            onChange={v => setDraft(d => ({...d, description: v}))}
          />
          <Field
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
              onPress={() => setStepsDateOpen(stepsDateOpen === 'capture' ? null : 'capture')}>
              <CalendarIcon />
              <Text style={styles.stepsDateLabel}>
                {draft.stepsDate
                  ? `Steps due ${formatDate(draft.stepsDate, dateFormat)}${
                      draft.stepsTime ? ` at ${formatTime(draft.stepsTime, timeFormat)}` : ''
                    }`
                  : 'Steps due: same day as the task'}
              </Text>
            </Pressable>
            {!!draft.stepsDate && (
              <Pressable onPress={() => setDraft(d => ({...d, stepsDate: '', stepsTime: ''}))} hitSlop={8}>
                <Text style={styles.clearLink}>Clear</Text>
              </Pressable>
            )}
          </View>
          {stepsDateOpen === 'capture' && (
            <DateTimePicker
              scrollHandle={scrollHandle}
              onScrollTo={scrollFieldIntoView}
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

          <View style={styles.actions}>
            <Button
              label={writing ? 'Saving…' : 'Save task'}
              primary
              disabled={writing}
              onPress={askSaveCaptured}
            />
            <Button label="All Tasks" onPress={openHub} />
          </View>

          <StatusLine status={status} />
          <LoadingLine visible={loading} />

        </>
      )}

      {screen === 'hub' && taskForm && (
        <>
          <Header
            title={editingTask ? 'Edit task' : 'New task'}
            onClose={closeGuarded}
            closeDisabled={writing}
            action={{
              label: writing ? 'Saving…' : editingTask ? 'Save' : 'Create',
              onPress: askSaveTaskForm,
              disabled: writing,
            }}
          />
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            label="Title"
            value={taskForm.summary}
            multiline
            onChange={v => setTaskForm(d => (d ? {...d, summary: v} : d))}
          />
          {!editingTask && config.collectionUrls.length > 0 && (
            <>
              <Text style={styles.label}>Save to</Text>
              {config.collectionUrls.map(url => (
                <CheckRow
                  key={url}
                  label={collectionName(url)}
                  checked={taskTargets.includes(url)}
                  onToggle={() =>
                    setTaskTargets(prev =>
                      prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url],
                    )
                  }
                />
              ))}
            </>
          )}
          <Text style={styles.label}>Due</Text>
          <DateTimePicker
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            date={taskForm.dueDate}
            time={taskForm.dueTime}
            timeFormat={timeFormat}
            onChange={(date, time) =>
              setTaskForm(d => (d ? {...d, dueDate: date, dueTime: time} : d))
            }
          />
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
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            label="Description"
            value={taskForm.description}
            multiline
            onChange={v => setTaskForm(d => (d ? {...d, description: v} : d))}
          />
          <Field
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
                      taskForm.stepsTime ? ` at ${formatTime(taskForm.stepsTime, timeFormat)}` : ''
                    }`
                  : 'Steps due: same day as the task'}
              </Text>
            </Pressable>
            {!!taskForm.stepsDate && (
              <Pressable onPress={() => setTaskForm(d => (d ? {...d, stepsDate: '', stepsTime: ''} : d))} hitSlop={8}>
                <Text style={styles.clearLink}>Clear</Text>
              </Pressable>
            )}
          </View>
          {stepsDateOpen === 'task' && (
            <DateTimePicker
              scrollHandle={scrollHandle}
              onScrollTo={scrollFieldIntoView}
              date={taskForm.stepsDate}
              time={taskForm.stepsTime}
              timeFormat={timeFormat}
              onChange={(date, time) => {
                setTaskForm(d => (d ? {...d, stepsDate: date, stepsTime: time} : d));
              }}
            />
          )}
          <Text style={styles.noteCompact}>
            {`Each line becomes a step of this task, due the same day as the task itself. End a
line with @2026-09-10 to give that step its own date instead.

This box only adds — it never lists or removes the steps a task already has, so saving twice
will not duplicate them.`}
          </Text>
          <View style={styles.actions}>
            <Button
              label={writing ? 'Saving…' : editingTask ? 'Save changes' : 'Create task'}
              primary
              disabled={writing}
              onPress={askSaveTaskForm}
            />
            <Button
              label="Cancel"
              onPress={() => {
                setTaskForm(null);
                setEditingTask(null);
              }}
            />
          </View>
          <StatusLine status={status} />
        </>
      )}

      {screen === 'hub' && eventForm && (
        <>
          <Header
            title={editingEvent ? 'Edit event' : 'New event'}
            onClose={closeGuarded}
            closeDisabled={writing}
            action={{
              label: writing ? 'Saving…' : editingEvent ? 'Save' : 'Create',
              onPress: askSaveEvent,
              disabled: writing,
            }}
          />
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
          <Text style={styles.labelCompact}>Date and start time</Text>
          <DateTimePicker
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            date={eventForm.date}
            time={eventForm.startTime}
            timeFormat={timeFormat}
            onChange={(date, time) =>
              setEventForm(d => {
                if (!d) {
                  return d;
                }
                const next = {...d, date, startTime: time};
                if (time) {
                  // The end follows the start on every change, keeping whatever
                  // duration the event already had — 90 minutes stays 90
                  // minutes when the start is nudged — and defaulting to an
                  // hour when there is nothing to keep.
                  const held =
                    d.startTime && d.endTime ? minutesBetween(d.startTime, d.endTime) : null;
                  next.endTime = addMinutes(time, held && held > 0 ? held : 60);
                } else {
                  // No start means an all-day event, which cannot carry an end
                  // time.
                  next.endTime = '';
                }
                return next;
              })
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
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            date={eventForm.date}
            time={eventForm.endTime}
            timeFormat={timeFormat}
            hideCalendar
            onChange={(_date, time) =>
              setEventForm(d => (d ? {...d, endTime: time} : d))
            }
          />
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
          <View style={styles.actionsTight}>
            <Button
              label={writing ? 'Saving…' : editingEvent ? 'Save changes' : 'Create event'}
              primary
              disabled={writing}
              onPress={askSaveEvent}
            />
            <Button
              label="Cancel"
              onPress={() => {
                setEventForm(null);
                setEditingEvent(null);
              }}
            />
          </View>
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
              {listed.map(row => (
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
                    <Text style={styles.backIcon}>↩</Text>
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
                  chooses which Radicale collection it goes into.
                */}
                <Button label="+ New task" onPress={() => openTaskEditor(null)} />
                <Button label="Today" onPress={goToday} />
                <Button label="Refresh" onPress={() => void refresh()} />
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
                  />
                  <Text style={styles.legend}>
                    <Text style={styles.markLegend}>C</Text> event ·{' '}
                    <Text style={styles.markLegend}>T</Text> task due ·{' '}
                    <Text style={styles.markLegend}>N</Text> daily note
                  </Text>

                  <Pressable onPress={() => setCalView('day')}>
                    <Text style={styles.subheadingLink}>
                      {formatDate(day, dateFormat)} — open day view ›
                    </Text>
                  </Pressable>
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
                  {dayEvents.length === 0 && dayTasks.length === 0 && (
                    <Text style={styles.empty}>Nothing scheduled.</Text>
                  )}
                  {dayEvents.map(event => (
                    <View key={event.uid} style={styles.eventRow}>
                      <Pressable
                        style={[styles.grow, styles.agendaItemTight]}
                        onPress={() => openEventEditor(event)}>
                        {/*
                          Smaller than the day view's rows on purpose: this list
                          sits under a whole month grid, and the point of it is
                          seeing what a day holds without scrolling past the
                          calendar to find out.
                        */}
                        <Text style={styles.agendaTitleTight}>{event.summary}</Text>
                        <Text style={styles.agendaMetaTight}>
                          {event.allDay
                            ? 'All day'
                            : formatTime(event.startTime, timeFormat)}{' '}
                          · {event.calendarLabel}
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
                  {/*
                    Folded away by default, and in the same tight type as the
                    events above. A month grid plus a full-size task list pushed
                    everything that matters off the bottom of the panel; the
                    count says whether opening it is worth the tap.
                  */}
                  {dayTasks.length > 0 && (
                    <>
                      <Pressable
                        style={styles.monthTasksHead}
                        onPress={() => setMonthTasksOpen(v => !v)}
                        hitSlop={8}>
                        <Text style={styles.monthTasksHeadText}>
                          {monthTasksOpen ? '▾' : '▸'} Tasks ({dayTasks.length})
                        </Text>
                      </Pressable>
                      {monthTasksOpen &&
                        dayTasks.map(task => (
                          <Pressable
                            key={task.uid}
                            style={styles.agendaItemTight}
                            onPress={() => openTaskEditor(task)}>
                            <Text style={styles.agendaTitleTight}>
                              {task.completed ? '☑' : '☐'} {task.summary}
                            </Text>
                            <Text style={styles.agendaMetaTight}>
                              {task.dueTime ? `${formatTime(task.dueTime, timeFormat)} · ` : ''}
                              {task.collectionLabel}
                            </Text>
                          </Pressable>
                        ))}
                    </>
                  )}
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
                  anchor={day}
                  events={events}
                  tasks={tasks}
                  dateFormat={dateFormat}
                  timeFormat={timeFormat}
                  noteDays={weekNoteDays}
                  onOpenSource={openSource}
                  onDailyNote={askDailyNote}
                  eventNotes={eventNotes}
                  onEventNote={askEventNote}
                  onPickWeek={() => setPickingDate('week')}
                  onShiftWeek={weeks => setDay(prev => shiftWeek(prev, weeks))}
                  onSelectDay={iso => {
                    setDay(iso);
                    setCalView('day');
                  }}
                  onEditEvent={openEventEditor}
                />
              )}

              {calView === 'day' && (
                <DayView
                  day={day}
                  events={events}
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
                  onPickDate={() => setPickingDate('day')}
                  eventNotes={eventNotes}
                  onEventNote={askEventNote}
                  onShiftDay={days => setDay(prev => shiftDays(prev, days))}
                  onEditEvent={openEventEditor}
                  onCompleteTask={askComplete}
                />
              )}
            </>
          )}
        </>
      )}

      {screen === 'settings' && (
        <SettingsScreen
          config={config}
          collections={collections}
          status={status}
          scrollHandle={scrollHandle}
          onScrollTo={scrollFieldIntoView}
          onBrowse={() => !blockedInDemo() && setPickingFolder('daily')}
          onBrowseMeetings={() => !blockedInDemo() && setPickingFolder('meeting')}
          onBrowsePeriod={period => !blockedInDemo() && setPickingFolder(period)}
          templates={templates}
          showHelp={showHelp}
          onToggleHelp={() => setShowHelp(v => !v)}
          onChange={setLocalConfig}
          onDiscover={() => void discover()}
          onSave={saveSettingsAndExit}
          onCancel={cancelSettings}
          device={device}
          dirty={settingsDirty}
          onWipe={askWipe}
          storePath={storePath}
          onClose={closeSettings}
        />
      )}
    </ScrollView>

    {/*
      Outside the ScrollView on purpose: these cover the window, so they must
      be positioned against the root rather than against scrolling content —
      inside it they would scroll away with the page underneath them.
    */}
    <FolderPicker
      visible={pickingFolder !== null}
      initialPath={
        pickingFolder === 'meeting'
          ? config.meetingNote.root
          : pickingFolder === 'week'
            ? config.weekNote.root
            : pickingFolder === 'month'
              ? config.monthNote.root
              : pickingFolder === 'quarter'
                ? config.quarterNote.root
                : pickingFolder === 'year'
                  ? config.yearNote.root
                  : config.dailyNote.root
      }
      onCancel={() => setPickingFolder(null)}
      onPick={picked => {
        setLocalConfig(
          pickingFolder === 'meeting'
            ? {...config, meetingNote: {...config.meetingNote, root: picked}}
            : pickingFolder === 'week'
              ? {...config, weekNote: {...config.weekNote, root: picked}}
              : pickingFolder === 'month'
                ? {...config, monthNote: {...config.monthNote, root: picked}}
                : pickingFolder === 'quarter'
                  ? {...config, quarterNote: {...config.quarterNote, root: picked}}
                  : pickingFolder === 'year'
                    ? {...config, yearNote: {...config.yearNote, root: picked}}
                    : {...config, dailyNote: {...config.dailyNote, root: picked}},
        );
        setPickingFolder(null);
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
      // Held back while a confirm is up: two stacked sheets on this panel leave
      // the user unsure which one the buttons belong to. It cannot appear on the
      // idle screen — this whole tree only renders once a screen is chosen — so
      // it is not what makes a reopening take two taps.
      visible={missing.length > 0 && ask === null}
      title="A list has gone"
      body={missingMessage(missing)}
      label="Got it"
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
  config: RadicaleConfig;
  templates: NoteTemplate[];
  scrollHandle: number | null;
  onScrollTo: (y: number) => void;
  onBrowse: () => void;
  onChange: (config: RadicaleConfig) => void;
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
    onChange,
  } = props;
  const note = config[noteKey];
  const set = (next: Partial<typeof note>) => onChange({...config, [noteKey]: {...note, ...next}});
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
        onPick={v => set({template: v})}
      />
      </>
      )}
    </>
  );
}

function SettingsScreen(props: {
  config: RadicaleConfig;
  collections: TaskCollection[];
  status: Status;
  scrollHandle: number | null;
  onScrollTo: (y: number) => void;
  storePath: string | null;
  onBrowse: () => void;
  onBrowseMeetings: () => void;
  onBrowsePeriod: (period: 'week' | 'month' | 'quarter' | 'year') => void;
  templates: NoteTemplate[];
  showHelp: boolean;
  onToggleHelp: () => void;
  onChange: (config: RadicaleConfig) => void;
  onDiscover: () => void;
  onSave: () => void;
  /** True when the form differs from what is stored, which the Save reports. */
  dirty: boolean;
  /** Leave without saving, after confirming. */
  onCancel: () => void;
  /** The device's own name, or null when the host does not report one. */
  device: string | null;
  onWipe: () => void;
  onClose: () => void;
}): React.JSX.Element {
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
    onBrowse,
    onBrowseMeetings,
    onBrowsePeriod,
    templates,
    showHelp,
    onToggleHelp,
    onChange,
    onDiscover,
    onSave,
    dirty,
    onCancel,
    device,
    onWipe,
    onClose,
  } = props;

  const taskLists = collections.filter(acceptsTasks);
  const calendars = collections.filter(acceptsEvents);

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
          Just the origin of your Radicale server — host and port, nothing after it. For a default
          install that is port 5232, e.g. https://radicale.example.com:5232. Do not paste a
          collection address here; {APP_NAME} finds those for you in step 3.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>2. Username and password. </Text>
          The Radicale login whose collections you want. If your server supports app passwords,
          make one scoped to these collections rather than using your account password —
          credentials are held in memory only and are not stored in an encrypted keystore.
        </Text>
        <Text style={styles.helpStepCompact}>
          <Text style={styles.helpNum}>3. Find collections. </Text>
          Queries the server for everything it advertises. Radicale only lists collections directly
          under /username/, so anything nested deeper will not appear — paste its full address into
          the manual field instead.
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
        Any other CalDAV server works too — Radicale, or anything that speaks the same
        protocol. The fields below are the same either way.
      </Text>

      <Text style={styles.subheadingCompact}>Server</Text>
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Server URL"
        value={config.serverUrl}
        placeholder="https://host:5232"
        onChange={v => onChange({...config, serverUrl: v})}
      />
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Username"
        value={config.username}
        onChange={v => onChange({...config, username: v})}
      />
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Password"
        value={config.password}
        secure
        onChange={v => onChange({...config, password: v})}
      />
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Collections owner (only if different from username)"
        value={config.owner}
        placeholder={config.username || 'your-username'}
        onChange={v => onChange({...config, owner: v})}
      />

      <View style={styles.actionsTight}>
        <Button label="Find collections" onPress={onDiscover} />
      </View>

      <Text style={styles.subheadingCompact}>Task lists (VTODO)</Text>
      {taskLists.length === 0 && (
        <Text style={styles.noteCompact}>None yet — press "Find collections" above.</Text>
      )}
      {taskLists.map(collection => {
        const checked = config.collectionUrls.includes(collection.url);
        const isDefault = config.defaultCollectionUrl === collection.url;
        return (
          <View key={collection.url} style={styles.checkRowCompact}>
            <Pressable
              style={styles.grow}
              onPress={() => onChange(toggleCollection(config, collection.url))}>
              <Text style={styles.optionTextCompact}>
                {checked ? '☑' : '☐'} {collection.displayName}
                {isDefault ? '  · new tasks' : ''}
              </Text>
            </Pressable>
            {checked && !isDefault && (
              <Pressable
                style={styles.tinyButton}
                onPress={() => onChange({...config, defaultCollectionUrl: collection.url})}>
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
          label={collection.displayName}
          checked={config.calendarUrls.includes(collection.url)}
          onToggle={() => onChange(toggleCalendar(config, collection.url))}
        />
      ))}

      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Or paste a task collection URL"
        value={config.defaultCollectionUrl}
        placeholder="https://host:5232/username/tasks/"
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

      <Fold
        title="Notes"
        hint={'Daily, weekly, monthly, quarterly, yearly and meeting notes: where each lives, how its path is built, and which template a new one starts from. None of this needs a server.'}
        open={openFolds.has('notes')}
        onToggle={() => toggleFold('notes')}>
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
            onChange={v => onChange({...config, dailyNote: {...config.dailyNote, root: v}})}
          />
        </View>
        <Pressable style={styles.browseButton} onPress={onBrowse}>
          <FolderIcon />
          <Text style={styles.browseLabel}>Browse</Text>
        </Pressable>
      </View>
      <Text style={styles.labelCompact}>Folder layout</Text>
      <Choice
        options={LAYOUT_PRESETS.map(p => ({key: p.layout, label: p.label}))}
        value={config.dailyNote.layout}
        onPick={k => onChange({...config, dailyNote: {...config.dailyNote, layout: k}})}
      />
      <Field
        scrollHandle={scrollHandle}
        onScrollTo={onScrollTo}
        compact
        label="Custom layout — {YYYY} {MM} {MMM} {MMMM} {DD} {DATE} {ISO}"
        value={config.dailyNote.layout}
        onChange={v => onChange({...config, dailyNote: {...config.dailyNote, layout: v}})}
      />
      <Text style={styles.noteCompact}>
        {`Today would be: ${
          dailyNotePath(config.dailyNote, toDateInput(new Date()), config.dateFormat) ||
          '(invalid layout)'
        }`}
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
        onPick={v => onChange({...config, dailyNote: {...config.dailyNote, template: v}})}
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
        onBrowse={() => onBrowsePeriod('week')}
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
        onBrowse={() => onBrowsePeriod('month')}
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
        onBrowse={() => onBrowsePeriod('quarter')}
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
        onBrowse={() => onBrowsePeriod('year')}
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
        to Radicale. Every occurrence of a repeating event shares one note.
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
            onChange={v => onChange({...config, meetingNote: {...config.meetingNote, root: v}})}
          />
        </View>
        <Pressable style={styles.browseButton} onPress={onBrowseMeetings}>
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
        onPick={v => onChange({...config, meetingNote: {...config.meetingNote, template: v}})}
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
        onPick={k => onChange({...config, agendaStartHour: Number(k)})}
      />
      <Text style={styles.labelCompact}>Day ends at</Text>
      <Choice
        options={AGENDA_HOURS.map(h => ({key: String(h), label: hourLabel(h, config.timeFormat)}))}
        value={String(config.agendaEndHour)}
        onPick={k => onChange({...config, agendaEndHour: Number(k)})}
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
        onPick={k => onChange({...config, dateFormat: k as DateFormat})}
      />

      <Text style={styles.subheadingCompact}>Time format</Text>
      <Choice
        options={TIME_FORMATS.map(f => ({key: f.key, label: `${f.label}  ${f.example}`}))}
        value={config.timeFormat}
        onPick={k => onChange({...config, timeFormat: k as TimeFormat})}
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
        onPick={k => onChange({...config, markStyle: k as MarkStyle})}
      />
      {config.markStyle !== 'off' && (
        <>
          <CheckRow
            compact
            label={`Also write "${TASK_LABEL}" underneath`}
            checked={config.markLabel}
            onToggle={() => onChange({...config, markLabel: !config.markLabel})}
          />
          <Text style={styles.noteCompact}>
            A short caption under the boxed writing, so the box explains itself without being
            tapped. It is a link like the box, so completing the task removes it too.
          </Text>
          <CheckRow
            compact
            label="Also shade it with the marker pen"
            checked={config.markShade}
            onToggle={() => onChange({...config, markShade: !config.markShade})}
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
                onPick={k => onChange({...config, markShadeColor: k})}
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

      {/* Outside every fold: the bottom Save has to be reachable whatever is
          open, the same as the one at the top. */}
      <Text style={styles.noteCompact}>
        {storePath
          ? `Saved to ${storePath} — survives plugin updates and reinstalls. Plain text on shared storage, so prefer a Radicale credential scoped to these collections.`
          : 'This build has no on-device storage, so settings last only for this session.'}
      </Text>

      <View style={styles.actions}>
        <Button
          label={dirty ? 'Save and exit •' : 'Save and exit'}
          primary
          onPress={onSave}
        />
        {/*
          Not filled: leaving without saving should not look like the thing to
          press. It is the same weight as the other secondary buttons.
        */}
        <Button label="Cancel setup" onPress={onCancel} />
      </View>

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
