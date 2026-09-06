/**
 * Repeat rules, and the promise that a rule this plugin cannot name is never
 * damaged by editing something else on the same item.
 *
 * The five choices deliberately match the Task Hub web page's own menu, so a
 * rule set on the tablet reads back as "Every week" in the browser rather than
 * as something neither editor can describe.
 */

import {
  REPEAT_OPTIONS,
  isEditableRepeat,
  repeatKey,
  repeatLabel,
  ruleFor,
} from '../src/recurrence';
import {
  buildVEvent,
  buildVTodo,
  parseVEvents,
  parseVTodos,
  updateVEvent,
  updateVTodo,
} from '../src/ical';

describe('repeat rules', () => {
  it('offers exactly the choices the web page offers, in the same order', () => {
    expect(REPEAT_OPTIONS.map(r => r.key)).toEqual(['', 'daily', 'weekly', 'monthly', 'yearly']);
    expect(REPEAT_OPTIONS.map(r => r.label)).toEqual([
      'Does not repeat',
      'Every day',
      'Every week',
      'Every month',
      'Every year',
    ]);
  });

  it('writes the same rule strings the web page writes', () => {
    expect(ruleFor('daily')).toBe('FREQ=DAILY');
    expect(ruleFor('weekly')).toBe('FREQ=WEEKLY');
    expect(ruleFor('monthly')).toBe('FREQ=MONTHLY');
    expect(ruleFor('yearly')).toBe('FREQ=YEARLY');
    expect(ruleFor('')).toBe('');
  });

  it('round-trips every offered rule back to its own key', () => {
    for (const {key} of REPEAT_OPTIONS) {
      expect(repeatKey(ruleFor(key) ?? '')).toBe(key);
    }
  });

  it('reads a rule it cannot name as custom rather than the nearest match', () => {
    expect(repeatKey('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('custom');
    expect(repeatKey('FREQ=MONTHLY;BYSETPOS=2;BYDAY=TU')).toBe('custom');
    expect(repeatKey('FREQ=DAILY;INTERVAL=2')).toBe('custom');
    expect(repeatKey('FREQ=WEEKLY;COUNT=10')).toBe('custom');
    expect(isEditableRepeat('FREQ=WEEKLY;BYDAY=MO')).toBe(false);
    expect(isEditableRepeat('FREQ=WEEKLY')).toBe(true);
  });

  it('treats nothing, empty and whitespace as not repeating', () => {
    expect(repeatKey(undefined)).toBe('');
    expect(repeatKey(null)).toBe('');
    expect(repeatKey('')).toBe('');
    expect(repeatKey('   ')).toBe('');
  });

  it('tolerates the property name and lower case', () => {
    expect(repeatKey('RRULE:FREQ=WEEKLY')).toBe('weekly');
    expect(repeatKey('freq=weekly')).toBe('weekly');
  });

  it('refuses to produce a rule for custom, so saving cannot overwrite one', () => {
    expect(ruleFor('custom')).toBeNull();
    expect(repeatLabel('custom')).toBe('Custom repeat');
  });
});

describe('repeats on tasks', () => {
  const read = (ics: string) => parseVTodos(ics)[0];

  it('writes and reads a repeat on a new task', () => {
    const ics = buildVTodo({uid: 'a', summary: 'water the plants', rrule: 'FREQ=WEEKLY'});
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    expect(repeatKey(read(ics).rrule)).toBe('weekly');
  });

  it('writes no rule at all when the task does not repeat', () => {
    expect(buildVTodo({uid: 'a', summary: 'x'})).not.toContain('RRULE');
    expect(buildVTodo({uid: 'a', summary: 'x', rrule: ''})).not.toContain('RRULE');
  });

  it('replaces a rule rather than leaving two', () => {
    const before = buildVTodo({uid: 'a', summary: 'x', rrule: 'FREQ=DAILY'});
    const after = updateVTodo(before, {summary: 'x', rrule: 'FREQ=MONTHLY'});
    expect(after.match(/RRULE:/g)).toHaveLength(1);
    expect(read(after).rrule).toBe('FREQ=MONTHLY');
  });

  it('removes the rule when the repeat is cleared', () => {
    const before = buildVTodo({uid: 'a', summary: 'x', rrule: 'FREQ=DAILY'});
    const after = updateVTodo(before, {summary: 'x', rrule: ''});
    expect(after).not.toContain('RRULE');
  });

  it('LEAVES A CUSTOM RULE ALONE when the edit says nothing about repeats', () => {
    // The whole point of the custom key: editing the title of a task somebody
    // set to "every second Tuesday" elsewhere must not flatten it.
    const before = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTODO',
      'UID:a',
      'SUMMARY:old title',
      'RRULE:FREQ=MONTHLY;BYSETPOS=2;BYDAY=TU',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');
    const after = updateVTodo(before, {summary: 'new title'});
    expect(after).toContain('RRULE:FREQ=MONTHLY;BYSETPOS=2;BYDAY=TU');
    expect(read(after).summary).toBe('new title');
  });
});

describe('repeats on events', () => {
  const read = (ics: string) => parseVEvents(ics)[0];

  it('writes and reads a repeat on a new event', () => {
    const ics = buildVEvent({uid: 'e', summary: 'standup', date: '2026-09-08', rrule: 'FREQ=DAILY'});
    expect(ics).toContain('RRULE:FREQ=DAILY');
    const event = read(ics);
    expect(event.recurring).toBe(true);
    expect(repeatKey(event.rrule)).toBe('daily');
  });

  it('reports a one-off as not recurring', () => {
    const event = read(buildVEvent({uid: 'e', summary: 'lunch', date: '2026-09-08'}));
    expect(event.recurring).toBe(false);
    expect(repeatKey(event.rrule)).toBe('');
  });

  it('replaces and clears a rule on edit', () => {
    const before = buildVEvent({uid: 'e', summary: 'standup', date: '2026-09-08', rrule: 'FREQ=DAILY'});
    const changed = updateVEvent(before, {
      summary: 'standup',
      date: '2026-09-08',
      rrule: 'FREQ=WEEKLY',
    });
    expect(changed.match(/RRULE:/g)).toHaveLength(1);
    expect(read(changed).rrule).toBe('FREQ=WEEKLY');

    const cleared = updateVEvent(before, {summary: 'standup', date: '2026-09-08', rrule: ''});
    expect(cleared).not.toContain('RRULE');
    expect(read(cleared).recurring).toBe(false);
  });

  it('leaves a custom rule alone when the edit says nothing about repeats', () => {
    const before = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:e',
      'DTSTART;VALUE=DATE:20260908',
      'SUMMARY:book club',
      'RRULE:FREQ=MONTHLY;BYDAY=1TH',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const after = updateVEvent(before, {summary: 'book club', date: '2026-09-08'});
    expect(after).toContain('RRULE:FREQ=MONTHLY;BYDAY=1TH');
  });
});

describe('steps written by the plugin', () => {
  it('hangs a step off its parent the way Task Hub does', () => {
    const ics = buildVTodo({uid: 'child', summary: 'a step', parentUid: 'parent-uid'});
    expect(ics).toContain('RELATED-TO;RELTYPE=PARENT:parent-uid');
    // And our own reader agrees about who the parent is.
    expect(parseVTodos(ics)[0].parentUid).toBe('parent-uid');
  });

  it('writes no relationship for a task that is not a step', () => {
    expect(buildVTodo({uid: 'a', summary: 'x'})).not.toContain('RELATED-TO');
  });
});
