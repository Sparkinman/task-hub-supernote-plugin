import {toDateInput, type VEvent, type VTodo} from './ical';

/**
 * Bucketing events and tasks by local calendar day.
 *
 * Everything keys off a local 'YYYY-MM-DD' string rather than a timestamp: an
 * event at 23:30 and a task due at 00:30 belong to different days, and only a
 * local-midnight boundary gets that right. Comparing raw epoch values would
 * drift by the UTC offset.
 */

export interface DayMarks {
  hasEvent: boolean;
  hasTask: boolean;
  hasNote: boolean;
}

export function dayOf(at: number): string {
  return toDateInput(new Date(at));
}

export function eventsOnDay<T extends VEvent>(events: T[], iso: string): T[] {
  return events.filter(e => e.startDate === iso).sort((a, b) => a.startAt - b.startAt);
}

export function tasksOnDay<T extends VTodo>(tasks: T[], iso: string): T[] {
  return tasks.filter(t => t.dueAt !== null && dayOf(t.dueAt) === iso);
}

/**
 * Which markers each day of a month needs.
 *
 * Built as one map rather than re-scanning per cell: a 42-cell grid against a
 * few hundred items would otherwise be thousands of comparisons on every
 * render, which a slow panel would show as lag when paging months.
 */
export function monthMarks(
  events: VEvent[],
  tasks: VTodo[],
  noteDays: Set<string> = new Set(),
): Record<string, DayMarks> {
  const marks: Record<string, DayMarks> = {};

  const touch = (iso: string): DayMarks => {
    if (!marks[iso]) {
      marks[iso] = {hasEvent: false, hasTask: false, hasNote: false};
    }
    return marks[iso];
  };

  for (const event of events) {
    touch(event.startDate).hasEvent = true;
  }
  for (const task of tasks) {
    // Only open tasks mark a day. A T on a day whose tasks are all finished is
    // noise — the marker exists to show where work is still outstanding.
    if (task.dueAt !== null && !task.completed) {
      touch(dayOf(task.dueAt)).hasTask = true;
    }
  }
  for (const iso of noteDays) {
    touch(iso).hasNote = true;
  }
  return marks;
}

/** Shift an ISO day string by whole days, staying in local time. */
export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateInput(d);
}

/**
 * Longest run to draw as a span.
 *
 * Task Hub caps at 60 days and files anything longer under its due date alone;
 * matching that keeps a task with a stale start date from painting itself
 * across every month.
 */
export const SPAN_CAP_DAYS = 60;

const DAY_MS = 86400000;

/**
 * The inclusive day range a task runs over, or null when it is a single day.
 *
 * A VTODO's DUE is the deadline itself, so the range includes it — unlike a
 * VEVENT's all-day DTEND, which is exclusive. A task with no DTSTART, or with
 * DTSTART equal to DUE, is a single day and gets no span.
 */
export function taskSpan(task: VTodo): {from: string; to: string; days: number} | null {
  if (task.dueAt === null || task.startAt === null || task.startAt === undefined) {
    return null;
  }
  const from = dayOf(task.startAt);
  const to = dayOf(task.dueAt);
  if (from >= to) {
    return null;
  }
  const days =
    Math.round(
      (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / DAY_MS,
    ) + 1;
  if (days > SPAN_CAP_DAYS) {
    return null;
  }
  return {from, to, days};
}

/**
 * Open tasks whose run covers `iso` but which are not due that day.
 *
 * Kept separate from tasksOnDay so a multi-day task is not reported as due on
 * every day it touches — a six-week task would otherwise look due forty-two
 * times.
 */
export function tasksRunningOn<T extends VTodo>(tasks: T[], iso: string): T[] {
  return tasks.filter(task => {
    if (task.completed) {
      return false;
    }
    const span = taskSpan(task);
    if (!span) {
      return false;
    }
    return iso >= span.from && iso < span.to;
  });
}
