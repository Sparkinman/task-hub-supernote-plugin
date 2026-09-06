/**
 * Task importance: the RFC 5545 bands, and the round trip through CalDAV.
 *
 * The interesting cases are all about not damaging what another client wrote —
 * a value inside a band must survive an edit that did not touch importance.
 */

import {
  PRIORITY_BANDS,
  bandOf,
  comparePriority,
  parsePriority,
  priorityLabel,
  valueOf,
} from '../src/priority';
import {buildVTodo, parseSteps, parseVTodos, updateVTodo} from '../src/ical';

describe('priority bands', () => {
  it('reads the whole of each RFC 5545 band, not just the value we write', () => {
    expect([1, 2, 3, 4].map(bandOf)).toEqual(['high', 'high', 'high', 'high']);
    expect(bandOf(5)).toBe('medium');
    expect([6, 7, 8, 9].map(bandOf)).toEqual(['low', 'low', 'low', 'low']);
  });

  it('treats 0, absent and out-of-range as no priority', () => {
    expect(bandOf(0)).toBe('none');
    expect(bandOf(undefined)).toBe('none');
    expect(bandOf(10)).toBe('none');
    expect(bandOf(-1)).toBe('none');
    expect(bandOf(NaN)).toBe('none');
  });

  it('offers None first, so the default choice is the one that writes nothing', () => {
    expect(PRIORITY_BANDS[0].key).toBe('none');
    expect(valueOf('none')).toBe(0);
  });

  it('writes a value in the middle of each band', () => {
    expect(bandOf(valueOf('high'))).toBe('high');
    expect(bandOf(valueOf('medium'))).toBe('medium');
    expect(bandOf(valueOf('low'))).toBe('low');
  });

  it('labels a task only when it has a priority', () => {
    expect(priorityLabel(2)).toBe('High');
    expect(priorityLabel(5)).toBe('Medium');
    expect(priorityLabel(7)).toBe('Low');
    expect(priorityLabel(0)).toBeNull();
    expect(priorityLabel(undefined)).toBeNull();
  });

  it('orders high first and unset last when breaking a tie', () => {
    const uids = [undefined, 9, 1, 5];
    expect([...uids].sort(comparePriority)).toEqual([1, 5, 9, undefined]);
  });

  it('keeps an out-of-range number rather than discarding the client’s value', () => {
    // bandOf already reports it as no priority; dropping it here would rewrite
    // somebody else's data on the next save.
    expect(parsePriority('11')).toBe(11);
    expect(parsePriority(' 3 ')).toBe(3);
    expect(parsePriority('')).toBeUndefined();
    expect(parsePriority('urgent')).toBeUndefined();
  });
});

describe('priority over CalDAV', () => {
  const read = (ics: string) => parseVTodos(ics)[0];

  it('round-trips a new task through build and parse', () => {
    expect(read(buildVTodo({uid: 'a', summary: 'x', priority: 1})).priority).toBe(1);
    expect(read(buildVTodo({uid: 'a', summary: 'x', priority: 5})).priority).toBe(5);
  });

  it('writes no PRIORITY line at all for None', () => {
    const ics = buildVTodo({uid: 'a', summary: 'x', priority: 0});
    expect(ics).not.toContain('PRIORITY');
    expect(read(ics).priority).toBeUndefined();
  });

  it('reads a priority another client set', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTODO',
      'UID:from-elsewhere',
      'SUMMARY:someone else’s task',
      'PRIORITY:3',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(read(ics).priority).toBe(3);
    expect(bandOf(read(ics).priority)).toBe('high');
  });

  it('replaces the priority on edit rather than leaving two lines', () => {
    const before = buildVTodo({uid: 'a', summary: 'x', priority: 9});
    const after = updateVTodo(before, {summary: 'x', priority: 1});
    expect(after.match(/PRIORITY:/g)).toHaveLength(1);
    expect(read(after).priority).toBe(1);
  });

  it('removes the line when the edit clears the priority', () => {
    const before = buildVTodo({uid: 'a', summary: 'x', priority: 1});
    const after = updateVTodo(before, {summary: 'x', priority: 0});
    expect(after).not.toContain('PRIORITY');
    expect(read(after).priority).toBeUndefined();
  });

  it('leaves properties it does not model alone', () => {
    const before = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTODO',
      'UID:a',
      'SUMMARY:x',
      'PRIORITY:3',
      'RRULE:FREQ=WEEKLY',
      'X-SOMETHING:kept',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');
    const after = updateVTodo(before, {summary: 'x', priority: 3});
    expect(after).toContain('RRULE:FREQ=WEEKLY');
    expect(after).toContain('X-SOMETHING:kept');
    expect(read(after).priority).toBe(3);
  });
});

describe('dates on sub tasks', () => {
  it('reads one step per line, stripping bullets', () => {
    expect(parseSteps('Draft the notes\n- Bump the version\n * Ship it')).toEqual([
      {summary: 'Draft the notes'},
      {summary: 'Bump the version'},
      {summary: 'Ship it'},
    ]);
  });

  it('takes a date written on the end of a line', () => {
    expect(parseSteps('Draft the notes @2026-09-10')).toEqual([
      {summary: 'Draft the notes', dueDate: '2026-09-10'},
    ]);
  });

  it('leaves an @ that is not a date alone', () => {
    // "email @dave" means the words, not a date this code failed to parse.
    expect(parseSteps('email @dave')).toEqual([{summary: 'email @dave'}]);
    expect(parseSteps('review @2026-13-45')).toEqual([{summary: 'review @2026-13-45'}]);
    expect(parseSteps('read @2026-02-30')).toEqual([{summary: 'read @2026-02-30'}]);
  });

  it('does not leave a step with no title', () => {
    expect(parseSteps('@2026-09-10')).toEqual([{summary: '@2026-09-10'}]);
  });

  it('ignores blank lines and stray whitespace', () => {
    expect(parseSteps('  one  \n\n\n   \n two ')).toEqual([
      {summary: 'one'},
      {summary: 'two'},
    ]);
    expect(parseSteps('')).toEqual([]);
  });
});
