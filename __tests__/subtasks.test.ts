/**
 * Tasks that contain other tasks, as the list has to show them.
 *
 * The interesting behaviour is placement. A piece of work is as urgent as the
 * soonest thing left in it, so a parent with no date whose step is due today
 * belongs with everything else due today — not at the bottom with the undated
 * ones, dragging its step down beside it.
 */

import {parseVTodos, type VTodo} from '../src/ical';
import {arrange, familyDue, visible} from '../src/subtasks';

function task(over: Partial<VTodo> & {uid: string}): VTodo {
  return {
    uid: over.uid,
    summary: over.summary ?? over.uid,
    dueAt: over.dueAt ?? null,
    status: over.completed ? 'COMPLETED' : 'NEEDS-ACTION',
    completed: over.completed ?? false,
    parentUid: over.parentUid,
    startAt: null,
  };
}

describe('reading RELATED-TO', () => {
  it('takes a parent relationship', () => {
    const [todo] = parseVTodos(
      'BEGIN:VTODO\r\nUID:step-1\r\nSUMMARY:Book flights\r\n' +
        'RELATED-TO;RELTYPE=PARENT:trip-1\r\nEND:VTODO\r\n',
    );
    expect(todo.parentUid).toBe('trip-1');
  });

  it('treats an absent RELTYPE as PARENT, which RFC 5545 requires', () => {
    const [todo] = parseVTodos(
      'BEGIN:VTODO\r\nUID:step-1\r\nRELATED-TO:trip-1\r\nEND:VTODO\r\n',
    );
    expect(todo.parentUid).toBe('trip-1');
  });

  it('ignores CHILD and SIBLING, which would hang a task off its own sibling', () => {
    const [child] = parseVTodos(
      'BEGIN:VTODO\r\nUID:a\r\nRELATED-TO;RELTYPE=CHILD:b\r\nEND:VTODO\r\n',
    );
    expect(child.parentUid).toBeUndefined();
    const [sibling] = parseVTodos(
      'BEGIN:VTODO\r\nUID:a\r\nRELATED-TO;RELTYPE=SIBLING:b\r\nEND:VTODO\r\n',
    );
    expect(sibling.parentUid).toBeUndefined();
  });

  it('finds the parent among several relationships', () => {
    const [todo] = parseVTodos(
      'BEGIN:VTODO\r\nUID:a\r\nRELATED-TO;RELTYPE=CHILD:kid\r\n' +
        'RELATED-TO;RELTYPE=PARENT:mum\r\nEND:VTODO\r\n',
    );
    expect(todo.parentUid).toBe('mum');
  });

  it('leaves an empty value alone', () => {
    const [todo] = parseVTodos('BEGIN:VTODO\r\nUID:a\r\nRELATED-TO:\r\nEND:VTODO\r\n');
    expect(todo.parentUid).toBeUndefined();
  });
});

describe('a family is as urgent as its soonest step', () => {
  const today = new Date(2026, 0, 10).getTime();
  const soon = new Date(2026, 0, 12).getTime();
  const later = new Date(2026, 1, 20).getTime();

  it('takes the step when the parent has no date', () => {
    const parent = task({uid: 'p'});
    expect(familyDue(parent, [task({uid: 's', parentUid: 'p', dueAt: today})])).toBe(today);
  });

  it('takes the soonest of several', () => {
    const parent = task({uid: 'p', dueAt: later});
    const steps = [
      task({uid: 's1', parentUid: 'p', dueAt: later}),
      task({uid: 's2', parentUid: 'p', dueAt: soon}),
    ];
    expect(familyDue(parent, steps)).toBe(soon);
  });

  it('ignores a finished step — done work is not urgent', () => {
    const parent = task({uid: 'p'});
    const steps = [task({uid: 's', parentUid: 'p', dueAt: today, completed: true})];
    expect(familyDue(parent, steps)).toBeNull();
  });

  it('is null when nothing in the family has a date', () => {
    expect(familyDue(task({uid: 'p'}), [task({uid: 's', parentUid: 'p'})])).toBeNull();
  });
});

describe('arranging the list', () => {
  const today = new Date(2026, 0, 10).getTime();
  const later = new Date(2026, 1, 20).getTime();

  const trip = task({uid: 'trip', summary: 'Plan the trip', dueAt: later});
  const flights = task({uid: 'f', summary: 'Book flights', parentUid: 'trip', dueAt: today});
  const passport = task({uid: 'p', summary: 'Renew passport', parentUid: 'trip'});
  const milk = task({uid: 'm', summary: 'Buy milk', dueAt: later});

  it('puts each step directly under its parent', () => {
    const rows = arrange([milk, passport, trip, flights], 'due-asc');
    const order = rows.map(r => r.todo.uid);
    expect(order.indexOf('f')).toBe(order.indexOf('trip') + 1);
    expect(rows.find(r => r.todo.uid === 'f')?.depth).toBe(1);
    expect(rows.find(r => r.todo.uid === 'trip')?.depth).toBe(0);
  });

  it('places the family by its soonest step, ahead of a later lone task', () => {
    // The trip itself is due in February; its first step is due today, so the
    // whole block belongs above a task due in February.
    const rows = arrange([milk, trip, flights, passport], 'due-asc');
    const roots = rows.filter(r => r.depth === 0).map(r => r.todo.uid);
    expect(roots).toEqual(['trip', 'm']);
  });

  it('counts the steps and how many are done', () => {
    const done = task({uid: 'd', summary: 'Pack', parentUid: 'trip', completed: true});
    const rows = arrange([trip, flights, passport, done], 'due-asc');
    const parent = rows.find(r => r.todo.uid === 'trip');
    expect(parent?.stepCount).toBe(3);
    expect(parent?.stepsDone).toBe(1);
  });

  it('names the parent on each step', () => {
    const rows = arrange([trip, flights], 'due-asc');
    expect(rows.find(r => r.todo.uid === 'f')?.parentSummary).toBe('Plan the trip');
  });

  it('shows an orphan as an ordinary task rather than hiding it', () => {
    // Its parent is in another collection, or filtered out by a search. Losing
    // the task entirely would be worse than showing it flat.
    const orphan = task({uid: 'o', summary: 'Stray', parentUid: 'not-here'});
    const rows = arrange([orphan], 'due-asc');
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
  });

  it('never loses or duplicates a task', () => {
    const all = [milk, trip, flights, passport];
    const rows = arrange(all, 'due-asc');
    expect(rows).toHaveLength(all.length);
    expect(new Set(rows.map(r => r.todo.uid)).size).toBe(all.length);
  });

  it('keeps families together whichever way it is sorted', () => {
    for (const key of ['due-asc', 'due-desc', 'name'] as const) {
      const rows = arrange([milk, trip, flights, passport], key);
      const order = rows.map(r => r.todo.uid);
      // Both steps sit in the block immediately after their parent.
      const at = order.indexOf('trip');
      expect(order.slice(at + 1, at + 3).sort()).toEqual(['f', 'p']);
    }
  });
});

describe('steps are folded until opened', () => {
  const trip = task({uid: 'trip', summary: 'Plan the trip'});
  const flights = task({uid: 'f', summary: 'Book flights', parentUid: 'trip'});
  const rows = arrange([trip, flights], 'due-asc');

  it('hides steps by default', () => {
    expect(visible(rows, new Set()).map(r => r.todo.uid)).toEqual(['trip']);
  });

  it('shows them once the parent is opened', () => {
    expect(visible(rows, new Set(['trip'])).map(r => r.todo.uid)).toEqual(['trip', 'f']);
  });

  it('always shows a task with no parent in view', () => {
    const orphan = task({uid: 'o', parentUid: 'missing'});
    const only = arrange([orphan], 'due-asc');
    expect(visible(only, new Set())).toHaveLength(1);
  });
});
