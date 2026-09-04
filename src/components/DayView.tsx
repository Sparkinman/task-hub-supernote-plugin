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
import {WEEKDAYS_SHORT} from '../calendar';
import {formatDate, formatTime, type DateFormat, type TimeFormat} from '../format';
import {toDateInput} from '../ical';
import type {RemoteEvent, RemoteTask} from '../tasks';
import {styles} from './common';

const HOURS = Array.from({length: 24}, (_, h) => h);

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

export function DayView(props: {
  day: string;
  events: RemoteEvent[];
  tasks: RemoteTask[];
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  hasNote: boolean;
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
    dateFormat,
    timeFormat,
    hasNote,
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

  // Completed tasks never appear in either panel.
  const openTasks = tasks.filter(t => !t.completed);
  const todays = tasksOnDay(openTasks, day);
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

      <View style={styles.noteButtonRow}>
        <Pressable
          style={[styles.button, styles.buttonPrimary]}
          onPress={() => onDailyNote(day, hasNote)}>
          <Text style={styles.buttonTextPrimary}>
            {hasNote ? 'Open existing note' : 'Create daily note'}
          </Text>
        </Pressable>
      </View>

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

        {HOURS.map(h => {
          const inSlot = dayEvents.filter(e => hourOf(e) === h);
          // The whole hour counts as past only once it has fully elapsed, so the
          // hour in progress still reads as active.
          const hourIsPast = minutes !== null && minutes >= (h + 1) * 60;
          const showNowLine = minutes !== null && minutes >= h * 60 && minutes < (h + 1) * 60;

          return (
            <View key={h}>
              <View style={styles.hourRow}>
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
      </View>

      <View style={styles.dayTasks}>
        <Text style={styles.paneTitle}>Tasks · {formatDate(day, dateFormat)}</Text>
        {todays.length === 0 && <Text style={styles.weekEmpty}>Nothing due.</Text>}
        {todays.map(task => {
          const over = task.dueAt !== null && task.dueAt < Date.now();
          return (
          <Pressable key={task.uid} onPress={() => onCompleteTask(task)} style={styles.paneTask}>
            <Text style={[styles.paneTaskText, over && styles.pastText]}>
              ☐ {task.dueTime ? `${formatTime(task.dueTime, timeFormat)} ` : ''}
              {task.summary}
            </Text>
            <Text style={styles.slotMeta}>{task.collectionLabel}</Text>
          </Pressable>
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
