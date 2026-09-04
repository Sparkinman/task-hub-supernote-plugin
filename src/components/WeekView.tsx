/**
 * Seven-day view.
 *
 * Laid out as seven stacked day blocks rather than seven columns: at 1.5x type
 * on a portrait panel, a column per day leaves roughly four characters of width,
 * which cannot show an event title. Stacked rows keep every entry readable.
 */

import React from 'react';
import {Pressable, Text, View} from 'react-native';

import {eventsOnDay, taskSpan, tasksOnDay, tasksRunningOn} from '../agenda';
import {MONTHS, WEEKDAYS_SHORT} from '../calendar';
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

export function WeekView(props: {
  anchor: string;
  events: RemoteEvent[];
  tasks: RemoteTask[];
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  /** ISO days that already have a daily note. */
  noteDays: Set<string>;
  onShiftWeek: (weeks: number) => void;
  onSelectDay: (iso: string) => void;
  onEditEvent: (event: RemoteEvent) => void;
  onDailyNote: (iso: string, exists: boolean) => void;
  /** Event UIDs that already have a meeting note. */
  eventNotes: Set<string>;
  onEventNote: (event: RemoteEvent, exists: boolean) => void;
  onPickWeek: () => void;
}): React.JSX.Element {
  const {
    anchor,
    events,
    tasks,
    dateFormat,
    timeFormat,
    noteDays,
    onShiftWeek,
    onSelectDay,
    onEditEvent,
    onDailyNote,
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

      {days.map(iso => {
        const dayEvents = eventsOnDay(events, iso);
        // Completed tasks are hidden here — the week view is for what is left.
        const dayTasks = tasksOnDay(tasks, iso).filter(t => !t.completed);
        const running = tasksRunningOn(tasks, iso);
        const weekday = WEEKDAYS_SHORT[new Date(`${iso}T00:00:00`).getDay()];
        const isToday = iso === today;

        return (
          <View key={iso} style={[styles.weekDay, isToday && styles.weekDayToday]}>
            <View style={styles.weekDayRow}>
              <Pressable style={styles.grow} onPress={() => onSelectDay(iso)}>
                <Text style={[styles.weekDayHead, isToday && styles.weekDayHeadToday]}>
                  {weekday} {formatDate(iso, dateFormat)}
                  {isToday ? '  · today' : ''}
                </Text>
              </Pressable>
              <Pressable
                style={styles.tinyButton}
                onPress={() => onDailyNote(iso, noteDays.has(iso))}>
                <Text style={styles.tinyButtonText}>
                  {noteDays.has(iso) ? 'Open note' : '+ Note'}
                </Text>
              </Pressable>
            </View>

            {dayEvents.length === 0 && dayTasks.length === 0 && running.length === 0 && (
              <Text style={styles.weekEmpty}>—</Text>
            )}

            {dayEvents.map(event => (
              <View key={event.uid} style={styles.eventRow}>
                <Pressable style={styles.grow} onPress={() => onEditEvent(event)}>
                  <Text style={styles.weekEntry}>
                    <Text style={styles.mark}>C</Text>{' '}
                    {event.allDay ? 'All day' : formatTime(event.startTime, timeFormat)}{' '}
                    {event.summary} <Text style={styles.listTag}>{event.calendarLabel}</Text>
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

            {dayTasks.map(task => (
              <Text key={task.uid} style={styles.weekEntry}>
                <Text style={styles.mark}>T</Text>{' '}
                {task.dueTime ? `${formatTime(task.dueTime, timeFormat)} ` : ''}
                {task.summary} <Text style={styles.listTag}>{task.collectionLabel}</Text>
              </Text>
            ))}
            {running.map(task => {
              const span = taskSpan(task);
              return (
                <Text key={task.uid} style={[styles.weekEntry, styles.pastText]}>
                  ▸ {task.summary}
                  {span ? ` (due ${formatDate(span.to, dateFormat)})` : ''}
                </Text>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
