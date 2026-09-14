/**
 * Cutting the task list into Overdue / Today / Next 7 days / Later / No date.
 *
 * The flat sort meant "what is late" had to be worked out by reading dates down
 * the page. These are the boundaries that answer it, and they have to agree
 * with `matchesFilter`, which draws the same lines for the same reasons.
 */

import {DUE_BUCKETS, dueBucket, matchesFilter, type VTodo} from '../src/ical';
import {groupRows} from '../src/subtasks';

const NOW = new Date('2026-09-14T10:00:00');

const todo = (over: Partial<VTodo> = {}): VTodo => ({
  uid: 't1',
  summary: 'Thing',
  completed: false,
  dueAt: null,
  priority: 0,
  status: '',
  ...over,
});

const at = (iso: string) => new Date(iso).getTime();

describe('dueBucket', () => {
  it('has no date when there is no date', () => {
    expect(dueBucket(todo(), NOW)).toBe('nodate');
  });

  it('calls a task late once its own moment has passed, not its day', () => {
    // Due at 09:00, read at 10:00: late, and that is when it is worth saying.
    expect(dueBucket(todo({dueAt: at('2026-09-14T09:00:00')}), NOW)).toBe('overdue');
    expect(dueBucket(todo({dueAt: at('2026-09-13T23:00:00')}), NOW)).toBe('overdue');
  });

  it('puts the rest of today in today', () => {
    expect(dueBucket(todo({dueAt: at('2026-09-14T11:00:00')}), NOW)).toBe('today');
    expect(dueBucket(todo({dueAt: at('2026-09-14T23:59:00')}), NOW)).toBe('today');
  });

  it('buckets a completed task by its date, like any other', () => {
    // Completion is the Done section's business, not this one's. Excluding
    // completed tasks here only left a hole: one finished a fortnight ago fell
    // past the overdue test and landed under Today.
    expect(dueBucket(todo({dueAt: at('2026-09-01T09:00:00'), completed: true}), NOW)).toBe(
      'overdue',
    );
    expect(dueBucket(todo({dueAt: at('2026-09-30T09:00:00'), completed: true}), NOW)).toBe(
      'later',
    );
  });

  it('splits the next week from what comes after', () => {
    expect(dueBucket(todo({dueAt: at('2026-09-16T09:00:00')}), NOW)).toBe('week');
    expect(dueBucket(todo({dueAt: at('2026-09-20T23:00:00')}), NOW)).toBe('week');
    expect(dueBucket(todo({dueAt: at('2026-09-21T09:00:00')}), NOW)).toBe('later');
  });

  it('agrees with matchesFilter about what is overdue and what is today', () => {
    // The sections and the filters must never disagree about where a task sits.
    const cases = [
      at('2026-09-13T09:00:00'),
      at('2026-09-14T09:00:00'),
      at('2026-09-14T11:00:00'),
      at('2026-09-18T09:00:00'),
      at('2026-09-30T09:00:00'),
    ];
    for (const dueAt of cases) {
      // Open tasks only: the filter excludes completed ones by design and this
      // does not — see `dueBucket`.
      const t = todo({dueAt});
      expect(dueBucket(t, NOW) === 'overdue').toBe(matchesFilter(t, 'overdue', NOW));
      if (dueBucket(t, NOW) === 'today') {
        expect(matchesFilter(t, 'today', NOW)).toBe(true);
      }
    }
  });

  it('puts every task in exactly one bucket', () => {
    const keys = DUE_BUCKETS.map(b => b.key);
    for (const dueAt of [null, at('2026-01-01T00:00:00'), at('2026-09-14T12:00:00'), at('2030-01-01T00:00:00')]) {
      expect(keys).toContain(dueBucket(todo({dueAt}), NOW));
    }
  });
});

describe('groupRows', () => {
  const row = (uid: string, depth: number, dueAt: number | null) => ({
    todo: todo({uid, dueAt}),
    depth,
    stepCount: 0,
    stepsDone: 0,
    familyDueAt: dueAt,
  });
  const order = ['overdue', 'today', 'later'] as const;
  const key = (t: VTodo) => dueBucket(t, NOW) as 'overdue' | 'today' | 'later';

  it('keeps a task and its steps together, under the parent s bucket', () => {
    // A step due next week under an overdue parent belongs with its parent:
    // they are one piece of work.
    const rows = [
      row('parent', 0, at('2026-09-01T09:00:00')),
      row('step', 1, at('2026-09-30T09:00:00')),
    ];
    const sections = groupRows(rows, order, key);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('overdue');
    expect(sections[0].rows.map(r => r.todo.uid)).toEqual(['parent', 'step']);
  });

  it('returns sections in the order given, skipping empty ones', () => {
    const rows = [
      row('a', 0, at('2030-01-01T00:00:00')),
      row('b', 0, at('2026-09-01T09:00:00')),
    ];
    const sections = groupRows(rows, order, key);
    expect(sections.map(s => s.key)).toEqual(['overdue', 'later']);
  });

  it('keeps every row', () => {
    const rows = [
      row('a', 0, at('2026-09-01T09:00:00')),
      row('b', 1, at('2026-09-01T09:00:00')),
      row('c', 0, at('2026-09-14T12:00:00')),
      row('d', 0, at('2030-01-01T00:00:00')),
    ];
    const total = groupRows(rows, order, key).reduce((n, s) => n + s.rows.length, 0);
    expect(total).toBe(rows.length);
  });

  it('gives a step with no parent in the list its own bucket', () => {
    // Otherwise it falls through to whichever section happened to come last.
    const rows = [row('orphan', 1, at('2030-01-01T00:00:00'))];
    const sections = groupRows(rows, order, key);
    expect(sections.map(s => s.key)).toEqual(['later']);
  });

  it('returns nothing for no rows', () => {
    expect(groupRows([], order, key)).toEqual([]);
  });
});
