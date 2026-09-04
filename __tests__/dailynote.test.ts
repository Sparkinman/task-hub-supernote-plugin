import {
  DEFAULT_DAILY_NOTE,
  dailyNotePath,
  daysWithNotes,
  expandLayout,
  parentDir,
  type DailyNoteConfig,
} from '../src/dailynote';
import {monthMarks} from '../src/agenda';
import type {VTodo} from '../src/ical';

const cfg = (over: Partial<DailyNoteConfig> = {}): DailyNoteConfig => ({
  ...DEFAULT_DAILY_NOTE,
  ...over,
});

describe('expandLayout', () => {
  it('fills every token', () => {
    expect(expandLayout('{YYYY}/{MM}/{MMM}/{MMMM}/{DD}/{ISO}', '2026-09-02', 'iso')).toBe(
      '2026/09/Sep/September/02/2026-09-02',
    );
  });

  it('renders {DATE} in the chosen display format', () => {
    expect(expandLayout('{DATE}', '2026-09-02', 'iso')).toBe('2026-09-02');
    expect(expandLayout('{DATE}', '2026-09-02', 'eu')).toBe('02-09-2026');
  });

  it('never lets a slashed date format create extra folders', () => {
    // US format is MM/DD/YYYY — unescaped this would nest three directories.
    const out = expandLayout('{DATE}', '2026-09-02', 'us');
    expect(out).toBe('09-02-2026');
    expect(out).not.toContain('/');
  });

  it('keeps the template’s own slashes as folder separators', () => {
    expect(expandLayout('{YYYY}/{MM}', '2026-09-02', 'us').split('/')).toHaveLength(2);
  });

  it('strips characters that are illegal in a filename', () => {
    expect(expandLayout('a:b*c?d"e<f>g|h', '2026-09-02', 'iso')).toBe('a-b-c-d-e-f-g-h');
  });

  it('collapses empty and repeated separators', () => {
    expect(expandLayout('{YYYY}//{MM}/', '2026-09-02', 'iso')).toBe('2026/09');
  });

  it('returns empty for a date it cannot parse', () => {
    expect(expandLayout('{YYYY}', 'not-a-date', 'iso')).toBe('');
  });
});

describe('dailyNotePath', () => {
  it('joins root, layout and extension', () => {
    expect(dailyNotePath(cfg(), '2026-09-02', 'iso')).toBe(
      'Note/Daily/2026/09-September/2026-09-02.note',
    );
  });

  it('honours a flat layout', () => {
    expect(dailyNotePath(cfg({layout: '{DATE}'}), '2026-09-02', 'iso')).toBe(
      'Note/Daily/2026-09-02.note',
    );
  });

  it('tidies a root with stray slashes', () => {
    expect(dailyNotePath(cfg({root: '/Note/Daily/'}), '2026-09-02', 'iso')).toBe(
      'Note/Daily/2026-09-02.note'.replace('2026-09-02', '2026/09-September/2026-09-02'),
    );
  });

  it('is empty when the date is unusable, rather than writing a junk path', () => {
    expect(dailyNotePath(cfg(), 'garbage', 'iso')).toBe('');
  });
});

describe('parentDir', () => {
  it('returns the folder holding the note', () => {
    expect(parentDir('Note/Daily/2026/09-September/2026-09-02.note')).toBe(
      'Note/Daily/2026/09-September',
    );
  });

  it('is empty for a bare filename', () => {
    expect(parentDir('note.note')).toBe('');
  });
});

describe('daysWithNotes', () => {
  const days = ['2026-09-01', '2026-09-02', '2026-09-03'];

  it('matches only days whose note exists', () => {
    const existing = ['Note/Daily/2026/09-September/2026-09-02.note'];
    const found = daysWithNotes(existing, days, cfg(), 'iso');
    expect([...found]).toEqual(['2026-09-02']);
  });

  it('ignores unrelated notes in the same tree', () => {
    const existing = ['Note/Daily/2026/09-September/Shopping list.note'];
    expect(daysWithNotes(existing, days, cfg(), 'iso').size).toBe(0);
  });

  it('is case-insensitive and tolerates backslashes', () => {
    const existing = ['note\\daily\\2026\\09-september\\2026-09-02.note'];
    expect(daysWithNotes(existing, days, cfg(), 'iso').has('2026-09-02')).toBe(true);
  });

  it('follows the configured date format', () => {
    // A note written under US formatting must not match under ISO settings.
    const existing = ['Note/Daily/2026/09-September/09-02-2026.note'];
    expect(daysWithNotes(existing, days, cfg(), 'iso').size).toBe(0);
    expect(daysWithNotes(existing, days, cfg(), 'us').has('2026-09-02')).toBe(true);
  });
});

describe('monthMarks with notes', () => {
  const todo = (over: Partial<VTodo>): VTodo => ({
    uid: 'x',
    summary: 't',
    dueAt: null,
    status: 'NEEDS-ACTION',
    completed: false,
    ...over,
  });

  it('marks a day that only has a note', () => {
    const marks = monthMarks([], [], new Set(['2026-09-02']));
    expect(marks['2026-09-02']).toEqual({hasEvent: false, hasTask: false, hasNote: true});
  });

  it('combines a note with a task on the same day', () => {
    const marks = monthMarks(
      [],
      [todo({dueAt: new Date(2026, 8, 2).getTime()})],
      new Set(['2026-09-02']),
    );
    expect(marks['2026-09-02']).toEqual({hasEvent: false, hasTask: true, hasNote: true});
  });

  it('defaults to no note days when none are passed', () => {
    const marks = monthMarks([], [todo({dueAt: new Date(2026, 8, 2).getTime()})]);
    expect(marks['2026-09-02'].hasNote).toBe(false);
  });
});
