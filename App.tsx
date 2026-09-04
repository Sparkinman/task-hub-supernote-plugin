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
import {Keyboard, Pressable, ScrollView, Text, View, findNodeHandle} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

import {eventsOnDay, monthMarks, shiftDays, tasksOnDay} from './src/agenda';
import {discoverCollections, newUid, putTask} from './src/caldav';
import {APP_NAME} from './src/components/Brand';
import {
  Button,
  CheckRow,
  Choice,
  Confirm,
  Field,
  Header,
  LoadingLine,
  Notice,
  Section,
  StatusLine,
  Tabs,
  TaskRow,
  styles,
  type Status,
} from './src/components/common';
import {DateTimePicker} from './src/components/DateTimePicker';
import {DayView} from './src/components/DayView';
import {MonthView} from './src/components/MonthView';
import {WeekView, shiftWeek} from './src/components/WeekView';
import {acceptsEvents, acceptsTasks, type TaskCollection} from './src/discovery';
import {
  DATE_FORMATS,
  TIME_FORMATS,
  addHours,
  formatDate,
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
import {readLassoAsText, readSourceRef, type SourceRef} from './src/lasso';
import {TASK_LABEL, markPage, removePageMark} from './src/pagemark';
import {MARK_STYLES, type MarkStyle} from './src/markstyle';
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
  type ListResult,
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
  createDailyNote,
  createMeetingNote,
  findExistingNotes,
  findMeetingNotes,
  listSystemTemplates,
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
type CalView = 'month' | 'week' | 'day';

interface TaskDraftState {
  summary: string;
  description: string;
  dueDate: string;
  dueTime: string;
}

interface EventDraftState {
  summary: string;
  description: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
  /**
   * Once the user types an end time themselves, stop deriving it from the
   * start — otherwise every nudge of the start hour would silently discard
   * a deliberate duration.
   */
  endTouched: boolean;
}

const EMPTY_TASK: TaskDraftState = {summary: '', description: '', dueDate: '', dueTime: ''};

/** Stand-ins for a fetch that was never made, so refresh has one result shape. */
const NO_TASKS: ListResult<RemoteTask> = {items: [], missing: []};
const NO_EVENTS: ListResult<RemoteEvent> = {items: [], missing: []};
const emptyEvent = (day: string): EventDraftState => ({
  summary: '',
  description: '',
  location: '',
  date: day,
  startTime: '',
  endTime: '',
  endTouched: false,
});

/** A confirmed write: runs, then reports this message on success. */
interface Ask {
  title: string;
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
  const [showHelp, setShowHelp] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [loading, setLoading] = useState(false);
  const [storePath, setStorePath] = useState<string | null>(null);
  const [noteFiles, setNoteFiles] = useState<string[]>([]);
  const [meetingFiles, setMeetingFiles] = useState<string[]>([]);
  const [pickingFolder, setPickingFolder] = useState<'daily' | 'meeting' | null>(null);
  const [pickingDate, setPickingDate] = useState<'day' | 'week' | null>(null);
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [restored, setRestored] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [query, setQuery] = useState('');

  const [taskForm, setTaskForm] = useState<TaskDraftState | null>(null);
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
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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

  const refresh = useCallback(async () => {
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
    setLoading(true);
    try {
      const [t, e, n, m] = await Promise.all([
        hasCollections(cfg) ? listTasks(cfg) : Promise.resolve(NO_TASKS),
        hasCalendars(cfg) ? listEvents(cfg) : Promise.resolve(NO_EVENTS),
        findExistingNotes(cfg.dailyNote),
        findMeetingNotes(cfg.meetingNote),
      ]);
      setTasks(t.items);
      setEvents(e.items);
      setNoteFiles(n);
      setMeetingFiles(m);
      // Surfaced rather than thrown: a list that has gone must not hide the
      // lists that are still working.
      setMissing([...t.missing, ...e.missing]);
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
    void PluginManager.closePluginView();
  }, []);

  /** Dismiss once the confirmation has been read, cancelling any earlier one. */
  const scheduleClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
    }
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      close();
    }, 1200);
  }, [close]);

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
      await refresh();
    } catch (err) {
      setStatus({kind: 'error', message: describe(err)});
    }
  }, [ask, refresh, scheduleClose, blockedInDemo]);

  const capture = useCallback(async () => {
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
        setStatus({kind: 'error', message: 'Choose a task list in settings before saving.'});
      }
    } catch (err) {
      setStatus({kind: 'error', message: describe(err)});
    }
  }, []);

  const openHub = useCallback(() => {
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
        void refresh();
      }
      setStorePath(await settingsLocation());
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
        setLocalConfig(getConfig());
        setLocalCollections(getCollections());
        setStatus(null);
        setScreen('settings');
        // Only this screen needs them, and the call is cheap.
        if (!DEMO) {
          void listSystemTemplates().then(setTemplates);
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
  const setCalView = useCallback((next: CalView) => {
    setCalViewRaw(prev => {
      if (prev !== next) {
        setViewHistory(h => [...h, prev]);
      }
      return next;
    });
  }, []);

  const goBackView = useCallback(() => {
    setViewHistory(h => {
      if (h.length === 0) {
        return h;
      }
      setCalViewRaw(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  /** Jump every calendar view back to today, whichever one is showing. */
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
    setAsk({
      title: 'Create task?',
      body: `"${summary}" will be added to ${names}.${marking}`,
      label: 'Yes, create',
      closeAfter: true,
      run: async () => {
        for (const url of targets) {
          // Separate UID per collection: the same UID in two collections is
          // legal but confuses clients that assume a UID names one object.
          await putTask(
            getConfig(),
            {
              uid: newUid(),
              summary,
              description: draft.description.trim() || undefined,
              dueDate: draft.dueDate || undefined,
              dueTime: draft.dueTime || undefined,
              // Carries the page the handwriting came from, so the task can
              // link back to it later. Kept off DESCRIPTION on purpose.
              sourcePath: source?.path,
              sourcePage: source?.page,
            },
            url,
          );
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
            });
          }
        }
        setDraft(EMPTY_TASK);
        setSource(undefined);
        return `Saved successfully — "${summary}" added to ${names}.${note}`;
      },
    });
  }, [draft, targets, source, config.markStyle]);

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
    setAsk({
      title: editing ? 'Save changes?' : 'Create task?',
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
        };
        if (editing) {
          await editTask(getConfig(), editing, payload);
        } else {
          for (const url of taskTargets) {
            await putTask(getConfig(), {uid: newUid(), ...payload}, url);
          }
        }
        setTaskForm(null);
        setEditingTask(null);
        return `Saved successfully — "${summary}".`;
      },
    });
  }, [taskForm, editingTask, taskTargets]);

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
            close();
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
          close();
          await openDailyNote(cfg.dailyNote, iso, cfg.dateFormat);
          return `Saved successfully — created ${path}.`;
        },
      });
    },
    [close, blockedInDemo],
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
          close();
          await openFileAt(task.sourcePath!, task.sourcePage ?? 0);
        } catch (err) {
          setStatus({kind: 'error', message: describe(err)});
        }
      })();
    },
    [close, blockedInDemo],
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

  const persistSettings = useCallback(async () => {
    if (blockedInDemo()) {
      return;
    }
    if (!hasCollections(config) && !hasCalendars(config)) {
      setStatus({kind: 'error', message: 'Tick at least one task list or calendar first.'});
      return;
    }
    setConfig(config);
    const summary = `${config.collectionUrls.length} task list(s) and ${config.calendarUrls.length} calendar(s)`;

    if (!storageAvailable()) {
      setStatus({kind: 'done', message: `Saved for this session — ${summary}.`});
      void refresh();
      return;
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
  }, [config, refresh, blockedInDemo]);

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
  const listed = useMemo(() => sortTasks(searchTasks(open, query), sortKey), [open, query, sortKey]);
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
      // An event loaded from the server already has a chosen duration.
      endTouched: true,
    });
    setStatus(null);
  };

  const openTaskEditor = (task: RemoteTask | null) => {
    setEditingTask(task);
    setTaskTargets(task ? [task.collectionUrl] : config.defaultCollectionUrl ? [config.defaultCollectionUrl] : []);
    setTaskForm(
      task
        ? {
            summary: task.summary,
            description: task.description ?? '',
            dueDate: task.dueDate ?? '',
            dueTime: task.dueTime ?? '',
          }
        : {...EMPTY_TASK},
    );
    setStatus(null);
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.root}
      keyboardShouldPersistTaps="handled"
      onLayout={() => setScrollHandle(findNodeHandle(scrollRef.current))}
      contentContainerStyle={[styles.content, keyboardUp && styles.contentKeyboard]}>
      {DEMO && (
        <View style={styles.demoBanner}>
          <Text style={styles.demoBannerText}>{DEMO_BANNER}</Text>
        </View>
      )}

      <FolderPicker
        visible={pickingFolder !== null}
        initialPath={
          pickingFolder === 'meeting' ? config.meetingNote.root : config.dailyNote.root
        }
        onCancel={() => setPickingFolder(null)}
        onPick={picked => {
          setLocalConfig(
            pickingFolder === 'meeting'
              ? {...config, meetingNote: {...config.meetingNote, root: picked}}
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
        // Held back while a confirm is up: two stacked modals on this panel
        // leave the user unsure which one the buttons belong to.
        visible={missing.length > 0 && ask === null}
        title="A list has gone"
        body={missingMessage(missing)}
        label="Got it"
        // Cleared only for this refresh. It comes back on the next one, and
        // keeps coming back, until the configuration is corrected.
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

      {screen === 'save' && (
        <>
          <Header title="New task" onClose={close} />
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
            date={draft.dueDate}
            time={draft.dueTime}
            timeFormat={timeFormat}
            onChange={(date, time) => setDraft(d => ({...d, dueDate: date, dueTime: time}))}
          />
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            label="Description"
            value={draft.description}
            multiline
            onChange={v => setDraft(d => ({...d, description: v}))}
          />

          <View style={styles.actions}>
            <Button label="Save task" primary onPress={askSaveCaptured} />
            <Button label="All Tasks" onPress={openHub} />
          </View>

          <StatusLine status={status} />
          <LoadingLine visible={loading} />

        </>
      )}

      {screen === 'hub' && taskForm && (
        <>
          <Header title={editingTask ? 'Edit task' : 'New task'} onClose={close} />
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
            date={taskForm.dueDate}
            time={taskForm.dueTime}
            timeFormat={timeFormat}
            onChange={(date, time) =>
              setTaskForm(d => (d ? {...d, dueDate: date, dueTime: time} : d))
            }
          />
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            label="Description"
            value={taskForm.description}
            multiline
            onChange={v => setTaskForm(d => (d ? {...d, description: v} : d))}
          />
          <View style={styles.actions}>
            <Button
              label={editingTask ? 'Save changes' : 'Create task'}
              primary
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
          <Header title={editingEvent ? 'Edit event' : 'New event'} onClose={close} />
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
            date={eventForm.date}
            time={eventForm.startTime}
            timeFormat={timeFormat}
            onChange={(date, time) =>
              setEventForm(d => {
                if (!d) {
                  return d;
                }
                const next = {...d, date, startTime: time};
                if (!d.endTouched) {
                  next.endTime = time ? addHours(time, 1) : '';
                }
                return next;
              })
            }
          />
          <Field
            scrollHandle={scrollHandle}
            onScrollTo={scrollFieldIntoView}
            compact
            label="End time (HH:MM)"
            value={eventForm.endTime}
            placeholder="13:00"
            onChange={v => setEventForm(d => (d ? {...d, endTime: v, endTouched: true} : d))}
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
              label={editingEvent ? 'Save changes' : 'Create event'}
              primary
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
          <Header title={APP_NAME} onClose={close} />
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

              <Field label="Search" value={query} placeholder="Filter tasks" onChange={setQuery} />
              <Text style={styles.label}>Sort</Text>
              <Choice options={SORT_KEYS} value={sortKey} onPick={k => setSortKey(k as SortKey)} />

              <StatusLine status={status} />
              <LoadingLine visible={loading} />

              {listed.length === 0 && !loading && (
                <Text style={styles.empty}>No open tasks match.</Text>
              )}
              {listed.map(task => (
                <TaskRow
                  key={task.uid}
                  task={task}
                  dateFormat={dateFormat}
                  timeFormat={timeFormat}
                  showNoDue
                  listLabel={task.collectionLabel}
                  onToggle={() => askComplete(task)}
                  onEdit={() => openTaskEditor(task)}
                  onOpenSource={() => openSource(task)}
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
                    setEditingEvent(null);
                    setEventTarget(config.calendarUrls[0] ?? '');
                    setEventForm(emptyEvent(day));
                    setStatus(null);
                  }}
                />
                <Button label="Today" onPress={goToday} />
                <Button label="Refresh" onPress={() => void refresh()} />
                {calView === 'day' && (
                  <Text style={styles.dayHeading}>{formatDate(day, dateFormat)}</Text>
                )}
              </View>

              <StatusLine status={status} />
              <LoadingLine visible={loading} />

              {!hasCalendars(config) && (
                <Text style={styles.note}>
                  No calendars selected — pick VEVENT collections in settings.
                </Text>
              )}

              {calView === 'month' && (
                <>
                  <MonthView
                    year={view.year}
                    month={view.month}
                    selected={day}
                    marks={marks}
                    onSelect={setDay}
                    onMonth={(year, month) => setView({year, month})}
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
                  {dayEvents.length === 0 && dayTasks.length === 0 && (
                    <Text style={styles.empty}>Nothing scheduled.</Text>
                  )}
                  {dayEvents.map(event => (
                    <View key={event.uid} style={styles.eventRow}>
                      <Pressable
                        style={[styles.grow, styles.agendaItem]}
                        onPress={() => openEventEditor(event)}>
                        <Text style={styles.agendaTitle}>{event.summary}</Text>
                        <Text style={styles.agendaMeta}>
                          {event.allDay ? 'All day' : event.startTime} · {event.calendarLabel}
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
                  {dayTasks.map(task => (
                    <TaskRow
                      key={task.uid}
                      task={task}
                      dateFormat={dateFormat}
                      timeFormat={timeFormat}
                      listLabel={task.collectionLabel}
                      onToggle={() => askComplete(task)}
                      onEdit={() => openTaskEditor(task)}
                    />
                  ))}
                </>
              )}

              {calView === 'week' && (
                <WeekView
                  anchor={day}
                  events={events}
                  tasks={tasks}
                  dateFormat={dateFormat}
                  timeFormat={timeFormat}
                  noteDays={weekNoteDays}
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
                  dateFormat={dateFormat}
                  timeFormat={timeFormat}
                  hasNote={dayHasNote}
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
          templates={templates}
          showHelp={showHelp}
          onToggleHelp={() => setShowHelp(v => !v)}
          onChange={setLocalConfig}
          onDiscover={() => void discover()}
          onSave={() => void persistSettings()}
          onWipe={askWipe}
          storePath={storePath}
          onClose={close}
        />
      )}
    </ScrollView>
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
  templates: NoteTemplate[];
  showHelp: boolean;
  onToggleHelp: () => void;
  onChange: (config: RadicaleConfig) => void;
  onDiscover: () => void;
  onSave: () => void;
  onWipe: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const {
    config,
    collections,
    status,
    scrollHandle,
    onScrollTo,
    storePath,
    onBrowse,
    onBrowseMeetings,
    templates,
    showHelp,
    onToggleHelp,
    onChange,
    onDiscover,
    onSave,
    onWipe,
    onClose,
  } = props;

  const taskLists = collections.filter(acceptsTasks);
  const calendars = collections.filter(acceptsEvents);

  return (
    <>
      <Header title="Setup" onClose={onClose} masthead />

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

      <Text style={styles.subheadingCompact}>Daily notes</Text>
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
          <Text style={styles.browseIcon}>🗀</Text>
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
      <TemplatePicker
        templates={templates}
        label="Daily note template"
        value={config.dailyNote.template}
        onPick={v => onChange({...config, dailyNote: {...config.dailyNote, template: v}})}
      />

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
          <Text style={styles.browseIcon}>🗀</Text>
          <Text style={styles.browseLabel}>Browse</Text>
        </Pressable>
      </View>
      <TemplatePicker
        templates={templates}
        label="Meeting note template"
        value={config.meetingNote.template}
        onPick={v => onChange({...config, meetingNote: {...config.meetingNote, template: v}})}
      />

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
            Experimental. Draws a marker stroke across the handwriting so a captured task
            stands out without being tapped, and removes it again when the task is completed.
            The shading is its own mark rather than part of the writing, so moving or copying
            the handwriting leaves it behind, and it then has to be erased by hand. The pen
            values were read from one device; on another model this may draw in the wrong
            colour or weight — undo in your note if it does.
          </Text>
        </>
      )}

      <Text style={styles.noteCompact}>
        {storePath
          ? `Saved to ${storePath} — survives plugin updates and reinstalls. Plain text on shared storage, so prefer a Radicale credential scoped to these collections.`
          : 'This build has no on-device storage, so settings last only for this session.'}
      </Text>

      <View style={styles.actionsTight}>
        <Button label="Save settings" primary onPress={onSave} />
      </View>

      <Text style={styles.subheadingCompact}>Start over</Text>
      <Text style={styles.noteCompact}>
        Uninstalling the plugin does not remove the saved file — it is kept outside the
        plugin's own storage so settings survive updates. This is the way to clear it.
      </Text>
      <View style={styles.actionsTight}>
        <Button label="Wipe All Save Data" onPress={onWipe} />
      </View>

      <StatusLine status={status} />
    </>
  );
}
