/**
 * Seven-day view: a horizontal strip of days, then the week's schedule and
 * to-dos in two columns.
 *
 * It used to be seven stacked day blocks, which read as a list rather than as a
 * week — you could not see the shape of the week, and Saturday was a scroll away
 * from Sunday. The strip is the calendar and the columns are what is in it, the
 * same division the Day and Month views use, and in the same order: schedule on
 * the left, to-dos on the right.
 *
 * Days already past are greyed but still selectable. Last Tuesday is exactly
 * where somebody goes to write up what happened, and a week view that would not
 * let them would be useless for the half of the week it is right about.
 */

import React from 'react';
import {Pressable, Text, View} from 'react-native';
import type {StyleProp, TextStyle} from 'react-native';

import type {DayMarks} from '../agenda';
import {eventsOnDay, taskSpan, tasksOnDay, tasksRunningOn} from '../agenda';
import {MONTHS, WEEKDAYS, WEEKDAYS_SHORT} from '../calendar';
import {formatDate, formatTime, type DateFormat, type TimeFormat} from '../format';
import {toDateInput} from '../ical';
import type {RemoteEvent, RemoteTask} from '../tasks';
import {styles} from './common';

/** The seven ISO days of the week containing `iso`, Sunday first. */
export function weekOf(iso: string): string[] {
  const anchor = new Date(`${iso}T00:00:00`);
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({length: 7}, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return toDateInput(d);
  });
}

/** Shift an anchor date by whole weeks. */
export function shiftWeek(iso: string, weeks: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  return toDateInput(d);
}

function WeekViewImpl(props: {
  anchor: string;
  events: RemoteEvent[];
  tasks: RemoteTask[];
  /** Per-day markers, so the strip carries the same discs the month grid does. */
  marks: Record<string, DayMarks>;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  /** ISO days that already have a daily note. */
  noteDays: Set<string>;
  /** The day the strip shows as chosen, which the columns scroll no further for. */
  selected: string;
  onShiftWeek: (weeks: number) => void;
  onSelectDay: (iso: string) => void;
  onEditEvent: (event: RemoteEvent) => void;
  /** Same split as the day view: the tick completes, the rest opens. */
  onEditTask: (task: RemoteTask) => void;
  onCompleteTask: (task: RemoteTask) => void;
  onDailyNote: (iso: string, exists: boolean) => void;
  /** Jump to the note page a task was captured from, when it has one. */
  onOpenSource: (task: RemoteTask) => void;
  /** Event UIDs that already have a meeting note. */
  eventNotes: Set<string>;
  onEventNote: (event: RemoteEvent, exists: boolean) => void;
  onPickWeek: () => void;
}): React.JSX.Element {
  const {
    anchor,
    events,
    tasks,
    marks,
    dateFormat,
    timeFormat,
    noteDays,
    selected,
    onShiftWeek,
    onSelectDay,
    onEditEvent,
    onEditTask,
    onCompleteTask,
    onDailyNote,
    onOpenSource,
    eventNotes,
    onEventNote,
    onPickWeek,
  } = props;
  const days = weekOf(anchor);
  const today = toDateInput(new Date());

  const first = new Date(`${days[0]}T00:00:00`);
  const last = new Date(`${days[6]}T00:00:00`);
  const spanLabel =
    first.getMonth() === last.getMonth()
      ? `${MONTHS[first.getMonth()]} ${first.getFullYear()}`
      : `${MONTHS[first.getMonth()].slice(0, 3)} – ${MONTHS[last.getMonth()].slice(0, 3)} ${last.getFullYear()}`;

  return (
    <View>
      <View style={styles.calendarNav}>
        <Pressable style={styles.nav} onPress={() => onShiftWeek(-1)}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Pressable onPress={onPickWeek} hitSlop={8}>
          <Text style={[styles.monthLabel, styles.tappableLabel]}>{spanLabel} ▾</Text>
        </Pressable>
        <Pressable style={styles.nav} onPress={() => onShiftWeek(1)}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      {/* The week itself, one row, read left to right like the month grid. */}
      <View style={styles.weekStrip}>
        {days.map(iso => {
          const mark = marks[iso];
          const isToday = iso === today;
          const isPast = iso < today;
          const isSelected = iso === selected;
          return (
            <Pressable
              key={iso}
              style={[
                styles.weekStripCell,
                isPast && styles.weekStripPast,
                isToday && styles.weekStripToday,
              ]}
              onPress={() => onSelectDay(iso)}>
              <Text style={styles.weekStripDow}>
                {WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()]}
              </Text>
              <View style={isSelected && styles.dayNumPill}>
                <Text
                  style={[
                    styles.weekStripNum,
                    isPast && !isSelected && styles.weekStripNumPast,
                    isSelected && styles.dayNumPillText,
                  ]}>
                  {Number(iso.slice(8, 10))}
                </Text>
              </View>
              <View style={styles.markDotRow}>
                {mark?.hasEvent && <Dot letter="C" />}
                {mark?.hasTask && <Dot letter="T" />}
                {mark?.hasNote && <Dot letter="N" />}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/*
        The week's contents, split the same way as the Day and Month views.
        Each column runs through all seven days in order, headed by the day, so
        a whole week reads as one list rather than seven.
      */}
      <View style={styles.weekPanel}>
        <View style={styles.weekPanelSchedule}>
          <Text style={styles.dayPanelTitle}>Schedule</Text>
          {days.map(iso => {
            const dayEvents = eventsOnDay(events, iso);
            // Emphasis follows the day you picked, not the calendar: the point
            // of the strip above is choosing which day this column is about.
            const muted = iso === selected ? null : styles.weekRowMuted;
            return (
              <View key={iso}>
                <DayHeading
                  iso={iso}
                  today={today}
                  dateFormat={dateFormat}
                  muted={muted}
                  hasNote={noteDays.has(iso)}
                  onSelect={() => onSelectDay(iso)}
                  onDailyNote={() => onDailyNote(iso, noteDays.has(iso))}
                />
                {dayEvents.length === 0 && <Text style={styles.dayPanelEmpty}>—</Text>}
                {dayEvents.map(event => (
                  <View key={event.uid} style={[styles.dayPanelRow, styles.eventRow]}>
                    <Pressable style={styles.grow} onPress={() => onEditEvent(event)}>
                      <Text style={[styles.dayPanelTime, muted]}>
                        {event.allDay ? 'All day' : formatTime(event.startTime, timeFormat)}
                      </Text>
                      <Text style={[styles.dayPanelTitleText, muted]}>
                        {event.summary}
                      </Text>
                      <Text style={[styles.dayPanelWhere, muted]}>
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
                ))}
              </View>
            );
          })}
        </View>

        <View style={styles.weekPanelTasks}>
          <Text style={styles.dayPanelTitle}>To-dos</Text>
          {days.map(iso => {
            // Completed tasks stay hidden here — the week view is for what is left.
            const dayTasks = tasksOnDay(tasks, iso).filter(t => !t.completed);
            const running = tasksRunningOn(tasks, iso);
            const muted = iso === selected ? null : styles.weekRowMuted;
            return (
              <View key={iso}>
                <DayHeading iso={iso} today={today} dateFormat={dateFormat} muted={muted} />
                {dayTasks.length === 0 && running.length === 0 && (
                  <Text style={styles.dayPanelEmpty}>—</Text>
                )}
                {dayTasks.map(task => (
                  <View key={task.uid} style={[styles.dayPanelRow, styles.eventRow]}>
                    {/*
                      Tapping a task here used to do nothing at all — the row
                      was a plain View. The tick completes it and the rest opens
                      it, matching the day and month views.
                    */}
                    <Pressable
                      onPress={() => onCompleteTask(task)}
                      style={styles.paneCheckHit}
                      hitSlop={8}>
                      <Text style={[styles.dayPanelTitleText, muted]}>☐</Text>
                    </Pressable>
                    <Pressable style={styles.grow} onPress={() => onEditTask(task)}>
                      <Text style={[styles.dayPanelTitleText, muted]}>{task.summary}</Text>
                      <Text style={[styles.dayPanelWhere, muted]}>
                        {task.dueTime ? `${formatTime(task.dueTime, timeFormat)} · ` : ''}
                        {task.collectionLabel}
                      </Text>
                    </Pressable>
                    {/* Back to the page this was lassoed from, when it was. */}
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
                ))}
                {running.map(task => {
                  const span = taskSpan(task);
                  return (
                    <Text
                      key={task.uid}
                      style={[styles.dayPanelWhere, styles.dayPanelRow, styles.pastText]}>
                      ▸ {task.summary}
                      {span ? ` (due ${formatDate(span.to, dateFormat)})` : ''}
                    </Text>
                  );
                })}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/** Which day the rows beneath belong to, with the note button when offered. */
function DayHeading(props: {
  iso: string;
  today: string;
  dateFormat: DateFormat;
  /** Set for every day but the selected one — see `weekRowMuted`. */
  muted?: StyleProp<TextStyle>;
  hasNote?: boolean;
  onSelect?: () => void;
  onDailyNote?: () => void;
}): React.JSX.Element {
  const {iso, today, dateFormat, muted, hasNote, onSelect, onDailyNote} = props;
  const isToday = iso === today;
  const weekday = WEEKDAYS_SHORT[new Date(`${iso}T00:00:00`).getDay()];
  return (
    <View style={styles.weekDayHeading}>
      <Pressable style={styles.grow} onPress={onSelect} disabled={!onSelect}>
        <Text
          style={[
            styles.weekDayHeadingText,
            muted,
            // Today stays underlined even when it is not the day being read,
            // so the week never loses its anchor.
            isToday && styles.weekDayHeadToday,
          ]}>
          {weekday} {formatDate(iso, dateFormat)}
          {isToday ? '  · today' : ''}
        </Text>
      </Pressable>
      {!!onDailyNote && (
        <Pressable style={styles.tinyButton} onPress={onDailyNote}>
          <Text style={styles.tinyButtonText}>{hasNote ? 'Open note' : '+ Note'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function Dot(props: {letter: string}): React.JSX.Element {
  return (
    <View style={styles.markDot}>
      <Text style={styles.markDotText}>{props.letter}</Text>
    </View>
  );
}

/**
 * Memoised. These grids are pure functions of their props, and on an e-ink panel
 * an avoidable re-render is an avoidable full-panel repaint — the calendar was
 * rebuilding every view on any state change anywhere in the app.
 */
export const WeekView = React.memo(WeekViewImpl);
