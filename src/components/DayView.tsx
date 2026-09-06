/**
 * Single-day agenda: 24 hourly slots on the left, task panel on the right.
 *
 * Events sit in the slot matching their start hour. Overlapping events stack
 * within their slot rather than being positioned by pixel offset — absolute
 * positioning would need a fixed row height, and a title that wraps would then
 * be clipped instead of pushing the row taller.
 */

import React from 'react';
import {Pressable, Text, View} from 'react-native';

import {eventsOnDay, taskSpan, tasksOnDay, tasksRunningOn} from '../agenda';
import {arrange, visible} from '../subtasks';
import {WEEKDAYS_SHORT} from '../calendar';
import {formatDate, formatTime, type DateFormat, type TimeFormat} from '../format';
import {toDateInput} from '../ical';
import type {RemoteEvent, RemoteTask} from '../tasks';
import {styles} from './common';

/**
 * The hours the grid shows, from the user's chosen window.
 *
 * Always at least one row, and always in order, whatever pair of numbers the
 * settings hold — a window nobody can read is worse than a default one.
 */
function hoursBetween(startHour: number, endHour: number): number[] {
  const first = Math.min(Math.max(0, Math.round(startHour)), 23);
  const last = Math.min(Math.max(first, Math.round(endHour)), 23);
  return Array.from({length: last - first + 1}, (_, i) => first + i);
}

/** Minutes past midnight, or null when the day shown is not today. */
function nowMinutes(day: string): number | null {
  const now = new Date();
  return toDateInput(now) === day ? now.getHours() * 60 + now.getMinutes() : null;
}

function hourOf(event: RemoteEvent): number | null {
  if (event.allDay || !event.startTime) {
    return null;
  }
  const match = /^(\d{1,2}):/.exec(event.startTime);
  return match ? Number(match[1]) : null;
}

function DayViewImpl(props: {
  day: string;
  events: RemoteEvent[];
  tasks: RemoteTask[];
  /** Parent UIDs whose steps are showing. Folded is the resting state. */
  openSteps: Set<string>;
  onToggleSteps: (uid: string) => void;
  /** Jump to the note page a task was captured from, when it has one. */
  onOpenSource: (task: RemoteTask) => void;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  hasNote: boolean;
  /** False when daily notes are switched off in settings. */
  notesEnabled: boolean;
  /** The hours to lay out as slots, from settings. */
  startHour: number;
  endHour: number;
  onShiftDay: (days: number) => void;
  onEditEvent: (event: RemoteEvent) => void;
  onCompleteTask: (task: RemoteTask) => void;
  onDailyNote: (iso: string, exists: boolean) => void;
  onPickDate: () => void;
  eventNotes: Set<string>;
  onEventNote: (event: RemoteEvent, exists: boolean) => void;
}): React.JSX.Element {
  const {
    day,
    events,
    tasks,
    openSteps,
    onToggleSteps,
    onOpenSource,
    dateFormat,
    timeFormat,
    hasNote,
    notesEnabled,
    startHour,
    endHour,
    onShiftDay,
    onEditEvent,
    onCompleteTask,
    onDailyNote,
    onPickDate,
    eventNotes,
    onEventNote,
  } = props;

  const dayEvents = eventsOnDay(events, day);
  const allDay = dayEvents.filter(e => hourOf(e) === null);
  const hours = hoursBetween(startHour, endHour);
  // Timed events outside the chosen window. Never dropped — narrowing the grid
  // decides what gets a row of its own, not what the day contains.
  //
  // Split by which end they fall off, and placed accordingly: something at
  // 06:00 belongs above a grid that starts at seven, next to the all-day items,
  // and something at 23:00 belongs after the last hour. Reading the column top
  // to bottom then stays in time order.
  const byTime = (a: RemoteEvent, b: RemoteEvent) =>
    (a.startTime ?? '').localeCompare(b.startTime ?? '');
  const timedOutside = dayEvents.filter(e => {
    const hour = hourOf(e);
    return hour !== null && (hour < hours[0] || hour > hours[hours.length - 1]);
  });
  const before = timedOutside.filter(e => (hourOf(e) ?? 0) < hours[0]).sort(byTime);
  const after = timedOutside
    .filter(e => (hourOf(e) ?? 0) > hours[hours.length - 1])
    .sort(byTime);

  // Completed tasks never appear in either panel.
  const openTasks = tasks.filter(t => !t.completed);
  // Families are built from ALL open tasks and only then filtered to this day.
  //
  // Filtering first was the bug: a parent due today had its steps removed before
  // arrange could see them, so it arrived with no children, no step count and no
  // fold arrow. A family is shown when the parent OR any of its steps falls on
  // this day, and opening it then reveals every step — including the ones due
  // another day, which is usually the point of opening it.
  const dueToday = new Set(tasksOnDay(openTasks, day).map(t => t.uid));
  const families = arrange(openTasks, 'due-asc');
  const familyOf = (row: (typeof families)[number]) =>
    row.depth === 0 ? row.todo.uid : (row.todo.parentUid ?? row.todo.uid);
  const shownFamilies = new Set(
    families.filter(row => dueToday.has(row.todo.uid)).map(familyOf),
  );
  const todays = visible(
    families.filter(row => shownFamilies.has(familyOf(row))),
    openSteps,
  );
  // Multi-day tasks passing through today, shown separately so they are not
  // mistaken for work due today.
  const running = tasksRunningOn(openTasks, day);

  // "Next 7 days" starts the day after the one being viewed.
  const start = new Date(`${day}T00:00:00`);
  const upcoming: {iso: string; items: RemoteTask[]}[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const iso = toDateInput(d);
    const items = tasksOnDay(openTasks, iso);
    if (items.length > 0) {
      upcoming.push({iso, items});
    }
  }

  const weekday = WEEKDAYS_SHORT[new Date(`${day}T00:00:00`).getDay()];
  const minutes = nowMinutes(day);

  return (
    <>
      <View style={styles.calendarNav}>
        <Pressable style={styles.nav} onPress={() => onShiftDay(-1)}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Pressable onPress={onPickDate} hitSlop={8}>
          <Text style={[styles.monthLabel, styles.tappableLabel]}>
            {weekday} {formatDate(day, dateFormat)} ▾
          </Text>
        </Pressable>
        <Pressable style={styles.nav} onPress={() => onShiftDay(1)}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      {notesEnabled && (
        <View style={styles.noteButtonRow}>
          <Pressable
            style={[styles.button, styles.buttonPrimary]}
            onPress={() => onDailyNote(day, hasNote)}>
            <Text style={styles.buttonTextPrimary}>
              {hasNote ? 'Open existing note' : 'Create daily note'}
            </Text>
          </Pressable>
        </View>
      )}

      <View style={styles.dayWrap}>
      <View style={styles.dayGrid}>
        {allDay.length > 0 && (
          <View style={styles.hourRow}>
            <Text style={styles.hourLabel}>all&nbsp;day</Text>
            <View style={styles.hourBody}>
              {allDay.map(event => (
                <View key={event.uid} style={styles.eventRow}>
                  <Pressable style={styles.grow} onPress={() => onEditEvent(event)}>
                    <Text style={styles.slotEvent}>{event.summary}</Text>
                    <Text style={styles.slotMeta}>{event.calendarLabel}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.noteChip}
                    onPress={() => onEventNote(event, eventNotes.has(event.uid))}>
                    <Text style={styles.noteChipText}>
                      {eventNotes.has(event.uid) ? '🗒' : '+🗒'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        {/*
          Timed events that fall before the window, sitting with the all-day
          items above the grid so the column still reads top to bottom in time
          order.
        */}
        {before.length > 0 && (
          <View style={styles.outsideBlock}>
            <Text style={styles.outsideHead}>
              Before {formatTime(`${String(hours[0]).padStart(2, '0')}:00`, timeFormat)}
            </Text>
            {before.map(event => (
              <View key={event.uid} style={styles.eventRow}>
                <Pressable style={styles.grow} onPress={() => onEditEvent(event)}>
                  <Text style={styles.slotEvent}>
                    {formatTime(event.startTime, timeFormat)}  {event.summary}
                  </Text>
                  <Text style={styles.slotMeta}>{event.calendarLabel}</Text>
                </Pressable>
                <Pressable
                  style={styles.noteChip}
                  onPress={() => onEventNote(event, eventNotes.has(event.uid))}>
                  <Text style={styles.noteChipText}>
                    {eventNotes.has(event.uid) ? '🗒' : '+🗒'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {hours.map(h => {
          const inSlot = dayEvents.filter(e => hourOf(e) === h);
          // The whole hour counts as past only once it has fully elapsed, so the
          // hour in progress still reads as active.
          const hourIsPast = minutes !== null && minutes >= (h + 1) * 60;
          const showNowLine = minutes !== null && minutes >= h * 60 && minutes < (h + 1) * 60;

          return (
            <View key={h} style={styles.hourSlot}>
              <View style={[styles.hourRow, styles.hourSlot]}>
                <Text style={[styles.hourLabel, hourIsPast && styles.pastText]}>
                  {formatTime(`${String(h).padStart(2, '0')}:00`, timeFormat)}
                </Text>
                <View style={styles.hourBody}>
                  {inSlot.map(event => {
                    const over =
                      minutes !== null &&
                      minutes >= h * 60 + Number(event.startTime?.slice(3) ?? 0);
                    return (
                      <View key={event.uid} style={styles.eventRow}>
                        <Pressable style={styles.grow} onPress={() => onEditEvent(event)}>
                          <Text style={[styles.slotEvent, over && styles.pastText]}>
                            {formatTime(event.startTime, timeFormat)}
                            {event.endTime ? `–${formatTime(event.endTime, timeFormat)}` : ''}{' '}
                            {event.summary}
                          </Text>
                          <Text style={[styles.slotMeta, over && styles.pastText]}>
                            {event.location ? `${event.location} · ` : ''}
                            {event.calendarLabel}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.noteChip}
                          onPress={() => onEventNote(event, eventNotes.has(event.uid))}>
                          <Text style={styles.noteChipText}>
                            {eventNotes.has(event.uid) ? '🗒' : '+🗒'}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              </View>
              {showNowLine && (
                <View style={styles.nowRow}>
                  <Text style={styles.nowLabel}>
                    now {formatTime(
                      `${String(Math.floor(minutes! / 60)).padStart(2, '0')}:${String(
                        minutes! % 60,
                      ).padStart(2, '0')}`,
                      timeFormat,
                    )}
                  </Text>
                  <View style={styles.nowLine} />
                </View>
              )}
            </View>
          );
        })}

        {/*
          Anything timed outside the chosen window, listed plainly under the
          grid. Narrowing the hours decides what gets a row of its own, not
          what the day contains — an event at 06:00 must not vanish because
          somebody set their day to start at seven.
        */}
        {after.length > 0 && (
          <View style={styles.outsideBlock}>
            <Text style={styles.outsideHead}>After {formatTime(
              `${String(hours[hours.length - 1] + 1).padStart(2, '0')}:00`,
              timeFormat,
            )}</Text>
            {after.map(event => (
              <View key={event.uid} style={styles.eventRow}>
                <Pressable style={styles.grow} onPress={() => onEditEvent(event)}>
                  <Text style={styles.slotEvent}>
                    {formatTime(event.startTime, timeFormat)}  {event.summary}
                  </Text>
                  <Text style={styles.slotMeta}>{event.calendarLabel}</Text>
                </Pressable>
                <Pressable
                  style={styles.noteChip}
                  onPress={() => onEventNote(event, eventNotes.has(event.uid))}>
                  <Text style={styles.noteChipText}>
                    {eventNotes.has(event.uid) ? '🗒' : '+🗒'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.dayTasks}>
        <Text style={styles.paneTitle}>Tasks · {formatDate(day, dateFormat)}</Text>
        {todays.length === 0 && <Text style={styles.weekEmpty}>Nothing due.</Text>}
        {todays.map(row => {
          const task = row.todo;
          const over = task.dueAt !== null && task.dueAt < Date.now();
          return (
            <View key={task.uid} style={styles.paneTaskRow}>
              {row.stepCount > 0 ? (
                <Pressable
                  onPress={() => onToggleSteps(task.uid)}
                  hitSlop={14}
                  style={styles.paneFoldHit}>
                  <Text style={styles.paneFold}>{openSteps.has(task.uid) ? '▾' : '▸'}</Text>
                </Pressable>
              ) : (
                // Keeps every tick box on one line whether or not a task has
                // steps, the same as the task list.
                <View style={styles.paneFoldHit} />
              )}
              <Pressable
                onPress={() => onCompleteTask(task)}
                style={[styles.grow, row.depth > 0 && styles.paneTaskStep]}>
                <Text style={[styles.paneTaskText, over && styles.pastText]}>
                  ☐ {task.dueTime ? `${formatTime(task.dueTime, timeFormat)} ` : ''}
                  {task.summary}
                </Text>
                <Text style={styles.slotMeta}>
                  {task.collectionLabel}
                  {row.stepCount > 0 ? `  ·  ${row.stepCount} steps` : ''}
                </Text>
              </Pressable>
              {/*
                A task captured by lassoing handwriting knows the page it came
                from. The chip goes back to it — the same affordance the Tasks
                tab has, which this pane was missing.
              */}
              {!!task.sourcePath && (
                <Pressable
                  style={styles.sourceChip}
                  onPress={() => onOpenSource(task)}
                  hitSlop={6}>
                  <Text style={styles.sourceChipText}>↩</Text>
                  <Text style={styles.sourceChipLabel}>page</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {running.length > 0 && (
          <>
            <Text style={styles.paneRunning}>Running through</Text>
            {running.map(task => {
              const span = taskSpan(task);
              return (
                <View key={task.uid} style={styles.paneTask}>
                  <Text style={styles.paneTaskText}>▸ {task.summary}</Text>
                  <Text style={styles.slotMeta}>
                    due {span ? formatDate(span.to, dateFormat) : ''} · {task.collectionLabel}
                  </Text>
                </View>
              );
            })}
          </>
        )}

        <View style={styles.paneSeparator} />

        <Text style={styles.paneTitle}>Next 7 days</Text>
        {upcoming.length === 0 && <Text style={styles.weekEmpty}>Nothing due.</Text>}
        {upcoming.map(group => (
          <View key={group.iso}>
            <Text style={styles.paneDate}>{formatDate(group.iso, dateFormat)}</Text>
            {group.items.map(task => (
              <Pressable
                key={task.uid}
                onPress={() => onCompleteTask(task)}
                style={styles.paneTask}>
                <Text style={styles.paneTaskText}>
                  ☐ {task.dueTime ? `${formatTime(task.dueTime, timeFormat)} ` : ''}
                  {task.summary}
                </Text>
                <Text style={styles.slotMeta}>{task.collectionLabel}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
      </View>
    </>
  );
}

/**
 * Memoised. These grids are pure functions of their props, and on an e-ink panel
 * an avoidable re-render is an avoidable full-panel repaint — the calendar was
 * rebuilding every view on any state change anywhere in the app.
 */
export const DayView = React.memo(DayViewImpl);
