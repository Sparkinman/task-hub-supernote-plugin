import {chunkWeeks, daysInMonth, monthGrid, shiftMonth} from '../src/calendar';
import {addHours, formatDate, formatDue, formatTime} from '../src/format';
import {nextTasks, parseVTodos, searchTasks, sortTasks, updateVTodo, type VTodo} from '../src/ical';

const todo = (over: Partial<VTodo>): VTodo => ({
  uid: Math.random().toString(36),
  summary: 's',
  dueAt: null,
  status: 'NEEDS-ACTION',
  completed: false,
  ...over,
});

describe('formatDate', () => {
  it('renders the three conventional orders', () => {
    expect(formatDate('2026-09-10', 'iso')).toBe('2026-09-10');
    expect(formatDate('2026-09-10', 'us')).toBe('09/10/2026');
    expect(formatDate('2026-09-10', 'eu')).toBe('10/09/2026');
  });

  it('passes through anything that is not a canonical date', () => {
    expect(formatDate('', 'us')).toBe('');
    expect(formatDate(undefined, 'us')).toBe('');
    expect(formatDate('not-a-date', 'us')).toBe('not-a-date');
  });
});

describe('formatTime', () => {
  it('pads 24-hour output', () => {
    expect(formatTime('9:05', '24')).toBe('09:05');
    expect(formatTime('14:05', '24')).toBe('14:05');
  });

  it('handles the midnight and noon edges that % 12 gets wrong', () => {
    expect(formatTime('00:30', '12')).toBe('12:30 AM');
    expect(formatTime('12:00', '12')).toBe('12:00 PM');
    expect(formatTime('23:59', '12')).toBe('11:59 PM');
    expect(formatTime('01:05', '12')).toBe('1:05 AM');
  });
});

describe('formatDue', () => {
  it('omits the time when there is none', () => {
    expect(formatDue('2026-09-10', undefined, 'eu', '12')).toBe('10/09/2026');
  });

  it('combines both when a time is set', () => {
    expect(formatDue('2026-09-10', '14:00', 'us', '12')).toBe('09/10/2026 2:00 PM');
  });

  it('is empty when there is no date, even if a time exists', () => {
    expect(formatDue(undefined, '14:00', 'iso', '24')).toBe('');
  });
});

describe('calendar grid', () => {
  it('knows month lengths including leap February', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 8)).toBe(30);
  });

  it('pads to whole weeks', () => {
    for (let month = 0; month < 12; month++) {
      expect(monthGrid(2026, month).length % 7).toBe(0);
    }
  });

  it('places the first day in the right weekday column', () => {
    // 1 September 2026 is a Tuesday, so index 2 in a Sunday-first grid.
    const cells = monthGrid(2026, 8);
    expect(cells.findIndex(c => c.day === 1)).toBe(2);
    expect(cells[2].iso).toBe('2026-09-01');
  });

  it('contains every day of the month exactly once', () => {
    const days = monthGrid(2026, 8).filter(c => c.day !== null);
    expect(days).toHaveLength(30);
    expect(new Set(days.map(c => c.iso)).size).toBe(30);
  });

  it('chunks into rows of seven', () => {
    const weeks = chunkWeeks(monthGrid(2026, 8));
    expect(weeks.every(w => w.length === 7)).toBe(true);
  });

  it('rolls the year over at both ends', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({year: 2025, month: 11});
    expect(shiftMonth(2026, 11, 1)).toEqual({year: 2027, month: 0});
    expect(shiftMonth(2026, 5, -12)).toEqual({year: 2025, month: 5});
  });
});

describe('sorting', () => {
  const a = todo({summary: 'apple', dueAt: new Date(2026, 8, 1).getTime()});
  const b = todo({summary: 'banana', dueAt: new Date(2026, 8, 5).getTime()});
  const undated = todo({summary: 'cherry', dueAt: null});

  it('sorts ascending and descending by due date', () => {
    expect(sortTasks([b, a], 'due-asc').map(t => t.summary)).toEqual(['apple', 'banana']);
    expect(sortTasks([a, b], 'due-desc').map(t => t.summary)).toEqual(['banana', 'apple']);
  });

  it('keeps undated tasks last in BOTH directions', () => {
    expect(sortTasks([undated, a, b], 'due-desc').map(t => t.summary)).toEqual([
      'banana',
      'apple',
      'cherry',
    ]);
    expect(sortTasks([undated, b, a], 'due-asc').map(t => t.summary)).toEqual([
      'apple',
      'banana',
      'cherry',
    ]);
  });

  it('sorts by name when asked', () => {
    expect(sortTasks([b, undated, a], 'name').map(t => t.summary)).toEqual([
      'apple',
      'banana',
      'cherry',
    ]);
  });
});

describe('searchTasks', () => {
  const items = [
    todo({summary: 'Buy milk'}),
    todo({summary: 'Call Bob', description: 'about the milk delivery'}),
    todo({summary: 'Wash car'}),
  ];

  it('matches title and description case-insensitively', () => {
    expect(searchTasks(items, 'MILK').map(t => t.summary)).toEqual(['Buy milk', 'Call Bob']);
  });

  it('returns everything for an empty query', () => {
    expect(searchTasks(items, '   ')).toHaveLength(3);
  });
});

describe('nextTasks', () => {
  it('takes the soonest open tasks only, up to the limit', () => {
    const many = [
      todo({summary: 'done', completed: true, dueAt: 1}),
      ...Array.from({length: 15}, (_, i) => todo({summary: `t${i}`, dueAt: 1000 + i})),
    ];
    const next = nextTasks(many, 10);
    expect(next).toHaveLength(10);
    expect(next.some(t => t.completed)).toBe(false);
    expect(next[0].summary).toBe('t0');
  });
});

describe('updateVTodo', () => {
  const now = new Date(Date.UTC(2026, 8, 2, 7, 5, 3));
  const original = [
    'BEGIN:VCALENDAR',
    'BEGIN:VTODO',
    'UID:a1',
    'SUMMARY:old title',
    'DESCRIPTION:old body',
    'DUE;VALUE=DATE:20260910',
    'RRULE:FREQ=WEEKLY',
    'X-CUSTOM:keep me',
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');

  it('replaces the editable fields', () => {
    const out = updateVTodo(original, {summary: 'new title', description: 'new body'}, now);
    const parsed = parseVTodos(out)[0];
    expect(parsed.summary).toBe('new title');
    expect(parsed.description).toBe('new body');
  });

  it('does not duplicate the fields it rewrites', () => {
    const out = updateVTodo(original, {summary: 'x'}, now);
    expect(out.split('\r\n').filter(l => l.startsWith('SUMMARY'))).toHaveLength(1);
    expect(out.split('\r\n').filter(l => l.startsWith('DTSTAMP'))).toHaveLength(1);
  });

  it('drops DUE entirely when the date is cleared', () => {
    const out = updateVTodo(original, {summary: 'x'}, now);
    expect(out).not.toContain('DUE');
    expect(parseVTodos(out)[0].dueAt).toBeNull();
  });

  it('drops DESCRIPTION when cleared rather than writing an empty one', () => {
    const out = updateVTodo(original, {summary: 'x', description: ''}, now);
    expect(out).not.toContain('DESCRIPTION');
  });

  it('preserves properties the plugin does not model', () => {
    const out = updateVTodo(original, {summary: 'x'}, now);
    expect(out).toContain('RRULE:FREQ=WEEKLY');
    expect(out).toContain('X-CUSTOM:keep me');
    expect(out).toContain('UID:a1');
  });

  it('round-trips a new due date through the parser', () => {
    const out = updateVTodo(original, {summary: 'x', dueDate: '2026-12-25'}, now);
    expect(parseVTodos(out)[0].dueDate).toBe('2026-12-25');
  });
});

describe('addHours', () => {
  it('shifts the hour and keeps the minutes', () => {
    expect(addHours('09:30', 1)).toBe('10:30');
    expect(addHours('09:30', -1)).toBe('08:30');
  });

  it('wraps around midnight in both directions', () => {
    expect(addHours('23:15', 1)).toBe('00:15');
    expect(addHours('00:15', -1)).toBe('23:15');
  });

  it('pads a single-digit result', () => {
    expect(addHours('8:00', 1)).toBe('09:00');
  });

  it('leaves a malformed time alone rather than inventing one', () => {
    expect(addHours('', 1)).toBe('');
    expect(addHours('half past', 1)).toBe('half past');
  });
});
