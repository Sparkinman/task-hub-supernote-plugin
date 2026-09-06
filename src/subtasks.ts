/**
 * Arranging tasks into the pieces of work they belong to.
 *
 * Task Hub writes `RELATED-TO;RELTYPE=PARENT` onto a task that is a step of
 * another, and CalDAV carries it here untouched. Without this module the tablet
 * shows a parent and its three steps as four unrelated rows, which is the same
 * flat mess the hub goes to some trouble to avoid everywhere else.
 *
 * Two decisions worth not re-litigating:
 *
 * **A family is placed by its soonest step.** A task with no due date of its
 * own whose step is due today belongs at the top of the list with everything
 * else due today, not at the bottom with the undated ones. What needs doing
 * this morning should be where somebody looks for what needs doing this
 * morning. A finished step no longer makes anything urgent.
 *
 * **Steps start folded.** A list that opens showing every step of every piece
 * of work is longer than it is useful on a screen this size, and the parent row
 * already says how many are left.
 *
 * Pure on purpose: no SDK import, so jest can exercise it off-device. The SDK
 * resolves a TurboModule at import time that only exists on the device.
 */

import type {SortKey, VTodo} from './ical';
import {sortTasks} from './ical';

/** One row of the task list: the task, and where it sits in its family. */
export interface TaskRow<T extends VTodo = VTodo> {
  todo: T;
  /** 0 for a task in its own right, 1 for a step of one. */
  depth: number;
  /** How many steps this task has, 0 when it is not a parent. */
  stepCount: number;
  /** How many of those are finished. */
  stepsDone: number;
  /** The soonest due date in this task's whole family, null when none has one. */
  familyDueAt: number | null;
  /** The parent's summary, for a step that has one in view. */
  parentSummary?: string;
}

/**
 * The soonest thing outstanding in a family, or null when nothing is dated.
 *
 * Completed steps are ignored: a piece of work is not urgent because of
 * something already ticked off.
 */
export function familyDue(parent: VTodo, steps: VTodo[]): number | null {
  const dates: number[] = [];
  if (parent.dueAt !== null && !parent.completed) {
    dates.push(parent.dueAt);
  }
  for (const step of steps) {
    if (step.dueAt !== null && !step.completed) {
      dates.push(step.dueAt);
    }
  }
  if (dates.length === 0) {
    // Nothing outstanding is dated. Fall back to the parent's own date so a
    // finished-but-dated family still sorts sensibly rather than sinking to
    // the undated pile.
    return parent.dueAt;
  }
  return Math.min(...dates);
}

/**
 * Group tasks into families and flatten them back into display order.
 *
 * Parents keep the order the chosen sort gives them — anchored on the family's
 * soonest date rather than the parent's own — and each parent's steps follow it
 * immediately, in the same sort.
 *
 * A step whose parent is not in this list (a different collection, or filtered
 * out by a search) is shown as an ordinary task rather than hidden. Losing a
 * task because its parent is elsewhere would be worse than showing it flat.
 */
export function arrange<T extends VTodo>(todos: T[], key: SortKey): TaskRow<T>[] {
  const byUid = new Map<string, T>();
  for (const todo of todos) {
    if (todo.uid) {
      byUid.set(todo.uid, todo);
    }
  }

  const stepsOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const todo of todos) {
    const parentUid = todo.parentUid;
    if (parentUid && byUid.has(parentUid)) {
      const existing = stepsOf.get(parentUid);
      if (existing) {
        existing.push(todo);
      } else {
        stepsOf.set(parentUid, [todo]);
      }
    } else {
      roots.push(todo);
    }
  }

  // Anchor each root on its family so the sort places the whole block. The
  // anchor is carried on a copy, never written back onto the task itself.
  const anchored = roots.map(todo => ({
    todo,
    anchor: familyDue(todo, stepsOf.get(todo.uid) ?? []),
  }));
  const ordered = sortTasks(
    anchored.map(a => ({...a.todo, dueAt: a.anchor})),
    key,
  );

  const rows: TaskRow<T>[] = [];
  for (const placeholder of ordered) {
    const todo = byUid.get(placeholder.uid);
    if (!todo) {
      continue;
    }
    const steps = stepsOf.get(todo.uid) ?? [];
    rows.push({
      todo,
      depth: 0,
      stepCount: steps.length,
      stepsDone: steps.filter(s => s.completed).length,
      familyDueAt: familyDue(todo, steps),
    });
    for (const step of sortTasks(steps, key)) {
      rows.push({
        todo: step,
        depth: 1,
        stepCount: 0,
        stepsDone: 0,
        familyDueAt: null,
        parentSummary: todo.summary,
      });
    }
  }
  return rows;
}

/**
 * The rows actually drawn, given which parents the user has opened.
 *
 * Folded is the resting state, so the set holds what has been opened rather
 * than what has been closed — a task gaining steps should not appear expanded
 * because nobody had folded it yet.
 */
export function visible<T extends VTodo>(
  rows: TaskRow<T>[],
  opened: ReadonlySet<string>,
): TaskRow<T>[] {
  return rows.filter(row => {
    if (row.depth === 0) {
      return true;
    }
    const parentUid = row.todo.parentUid;
    return parentUid ? opened.has(parentUid) : true;
  });
}
