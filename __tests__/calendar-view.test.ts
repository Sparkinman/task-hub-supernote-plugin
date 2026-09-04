import {dayOf, eventsOnDay, monthMarks, shiftDays, tasksOnDay} from '../src/agenda';
import {buildVEvent, parseVEvents, updateVEvent, type VTodo} from '../src/ical';
import {shiftWeek, weekOf} from '../src/components/WeekView';
import {parseCollections} from '../src/discovery';

const EV = (body: string) =>
  ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', body, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

const todo = (over: Partial<VTodo>): VTodo => ({
  uid: Math.random().toString(36),
  summary: 't',
  dueAt: null,
  status: 'NEEDS-ACTION',
  completed: false,
  ...over,
});

describe('parseVEvents', () => {
  it('reads a timed event with start and end', () => {
    const [e] = parseVEvents(
      EV(
        [
          'UID:e1',
          'SUMMARY:Standup',
          'LOCATION:Room 2',
          'DTSTART:20260910T090000Z',
          'DTEND:20260910T093000Z',
        ].join('\r\n'),
      ),
    );
    expect(e.summary).toBe('Standup');
    expect(e.location).toBe('Room 2');
    expect(e.allDay).toBe(false);
    expect(e.startAt).toBe(Date.UTC(2026, 8, 10, 9, 0));
    expect(e.endTime).toBeDefined();
  });

  it('treats VALUE=DATE as all-day with no time', () => {
    const [e] = parseVEvents(
      EV(['UID:e1', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20260910'].join('\r\n')),
    );
    expect(e.allDay).toBe(true);
    expect(e.startDate).toBe('2026-09-10');
    expect(e.startTime).toBeUndefined();
  });

  it('reads a floating local time as local, not UTC', () => {
    const [e] = parseVEvents(
      EV(['UID:e1', 'SUMMARY:Lunch', 'DTSTART:20260910T120000'].join('\r\n')),
    );
    expect(e.startAt).toBe(new Date(2026, 8, 10, 12, 0).getTime());
    expect(e.startTime).toBe('12:00');
  });

  it('skips an event with no DTSTART rather than dating it to the epoch', () => {
    expect(parseVEvents(EV(['UID:e1', 'SUMMARY:Broken'].join('\r\n')))).toHaveLength(0);
  });

  it('returns events in chronological order', () => {
    const many =
      'BEGIN:VCALENDAR\r\n' +
      'BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:later\r\nDTSTART:20260910T150000Z\r\nEND:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:earlier\r\nDTSTART:20260910T090000Z\r\nEND:VEVENT\r\n' +
      'END:VCALENDAR';
    expect(parseVEvents(many).map(e => e.summary)).toEqual(['earlier', 'later']);
  });

  it('ignores VTODOs mixed into the same payload', () => {
    const mixed =
      'BEGIN:VCALENDAR\r\n' +
      'BEGIN:VTODO\r\nUID:t\r\nSUMMARY:a task\r\nEND:VTODO\r\n' +
      'BEGIN:VEVENT\r\nUID:e\r\nSUMMARY:an event\r\nDTSTART;VALUE=DATE:20260910\r\nEND:VEVENT\r\n' +
      'END:VCALENDAR';
    expect(parseVEvents(mixed).map(e => e.summary)).toEqual(['an event']);
  });
});

describe('day bucketing', () => {
  const events = parseVEvents(
    'BEGIN:VCALENDAR\r\n' +
      'BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:on the 10th\r\nDTSTART;VALUE=DATE:20260910\r\nEND:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:on the 11th\r\nDTSTART;VALUE=DATE:20260911\r\nEND:VEVENT\r\n' +
      'END:VCALENDAR',
  );

  it('selects only that day’s events', () => {
    expect(eventsOnDay(events, '2026-09-10').map(e => e.summary)).toEqual(['on the 10th']);
    expect(eventsOnDay(events, '2026-09-12')).toHaveLength(0);
  });

  it('buckets tasks by local day, not UTC', () => {
    const late = todo({dueAt: new Date(2026, 8, 10, 23, 30).getTime()});
    expect(dayOf(late.dueAt!)).toBe('2026-09-10');
    expect(tasksOnDay([late], '2026-09-10')).toHaveLength(1);
    expect(tasksOnDay([late], '2026-09-11')).toHaveLength(0);
  });

  it('marks days with events, tasks, or both', () => {
    const tasks = [
      todo({dueAt: new Date(2026, 8, 10, 9, 0).getTime()}),
      todo({dueAt: new Date(2026, 8, 15, 9, 0).getTime()}),
    ];
    const marks = monthMarks(events, tasks);

    expect(marks['2026-09-10']).toEqual({hasEvent: true, hasTask: true, hasNote: false});
    expect(marks['2026-09-11']).toEqual({hasEvent: true, hasTask: false, hasNote: false});
    expect(marks['2026-09-15']).toEqual({hasEvent: false, hasTask: true, hasNote: false});
    expect(marks['2026-09-20']).toBeUndefined();
  });

  it('does not mark a day whose only task is completed', () => {
    const marks = monthMarks([], [todo({dueAt: new Date(2026, 8, 10).getTime(), completed: true})]);
    expect(marks['2026-09-10']).toBeUndefined();
  });

  it('still marks a day that has one open task among completed ones', () => {
    const at = new Date(2026, 8, 10).getTime();
    const marks = monthMarks([], [todo({dueAt: at, completed: true}), todo({dueAt: at})]);
    expect(marks['2026-09-10'].hasTask).toBe(true);
  });

  it('ignores undated tasks entirely', () => {
    expect(monthMarks([], [todo({dueAt: null})])).toEqual({});
  });
});

describe('collection component types', () => {
  const xml = (comp: string) => `<?xml version="1.0"?>
  <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
    <D:response>
      <D:href>/user/agenda/</D:href>
      <D:propstat><D:status>HTTP/1.1 200 OK</D:status>
        <D:prop>
          <D:displayname>Agenda</D:displayname>
          <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
          ${comp}
        </D:prop>
      </D:propstat>
    </D:response>
  </D:multistatus>`;

  it('records VEVENT collections instead of discarding them', () => {
    const found = parseCollections(
      'https://host:5232',
      xml('<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>'),
    );
    expect(found).toHaveLength(1);
    expect(found[0].components).toEqual(['VEVENT']);
  });

  it('records both when a collection accepts both', () => {
    const found = parseCollections(
      'https://host:5232',
      xml(
        '<C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>',
      ),
    );
    expect(found[0].components).toEqual(['VEVENT', 'VTODO']);
  });

  it('leaves components empty when the server does not say', () => {
    expect(parseCollections('https://host:5232', xml(''))[0].components).toEqual([]);
  });
});

describe('buildVEvent / updateVEvent', () => {
  const now = new Date(Date.UTC(2026, 8, 2, 7, 5, 3));

  it('writes an all-day event with no DTEND', () => {
    const ics = buildVEvent({uid: 'e1', summary: 'Holiday', date: '2026-09-10'}, now);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260910');
    // An all-day DTEND would have to be the next day to be correct; omitting it
    // is unambiguous.
    expect(ics).not.toContain('DTEND');
    const [parsed] = parseVEvents(ics);
    expect(parsed.allDay).toBe(true);
    expect(parsed.startDate).toBe('2026-09-10');
  });

  it('round-trips a timed event', () => {
    const ics = buildVEvent(
      {uid: 'e1', summary: 'Standup', date: '2026-09-10', startTime: '09:00', endTime: '09:30'},
      now,
    );
    const [parsed] = parseVEvents(ics);
    expect(parsed.allDay).toBe(false);
    expect(parsed.startTime).toBe('09:00');
    expect(parsed.endTime).toBe('09:30');
  });

  it('defaults DTEND to the start when only a start time is given', () => {
    const ics = buildVEvent(
      {uid: 'e1', summary: 'Ping', date: '2026-09-10', startTime: '09:00'},
      now,
    );
    expect(ics).toContain('DTEND');
    expect(parseVEvents(ics)[0].endTime).toBe('09:00');
  });

  it('emits CRLF endings and escapes text', () => {
    const ics = buildVEvent(
      {uid: 'e1', summary: 'Lunch; with Bob, maybe', date: '2026-09-10'},
      now,
    );
    expect(ics).toContain('SUMMARY:Lunch\\; with Bob\\, maybe');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(parseVEvents(ics)[0].summary).toBe('Lunch; with Bob, maybe');
  });

  it('rewrites fields without duplicating them', () => {
    const original = buildVEvent(
      {uid: 'e1', summary: 'Old', date: '2026-09-10', startTime: '09:00'},
      now,
    );
    const updated = updateVEvent(original, {summary: 'New', date: '2026-09-11'}, now);
    const lines = updated.split('\r\n');
    expect(lines.filter(l => l.startsWith('SUMMARY')).length).toBe(1);
    expect(lines.filter(l => l.startsWith('DTSTART')).length).toBe(1);
    expect(lines.filter(l => l.startsWith('DTSTAMP')).length).toBe(1);

    const [parsed] = parseVEvents(updated);
    expect(parsed.summary).toBe('New');
    expect(parsed.startDate).toBe('2026-09-11');
    expect(parsed.uid).toBe('e1');
  });

  it('drops DTEND when a timed event becomes all-day', () => {
    const original = buildVEvent(
      {uid: 'e1', summary: 'Meeting', date: '2026-09-10', startTime: '09:00', endTime: '10:00'},
      now,
    );
    const updated = updateVEvent(original, {summary: 'Meeting', date: '2026-09-10'}, now);
    expect(updated).not.toContain('DTEND');
    expect(parseVEvents(updated)[0].allDay).toBe(true);
  });

  it('preserves properties it does not model', () => {
    const original = buildVEvent({uid: 'e1', summary: 'X', date: '2026-09-10'}, now).replace(
      'END:VEVENT',
      'RRULE:FREQ=WEEKLY\r\nX-KEEP:me\r\nEND:VEVENT',
    );
    const updated = updateVEvent(original, {summary: 'Y', date: '2026-09-10'}, now);
    expect(updated).toContain('RRULE:FREQ=WEEKLY');
    expect(updated).toContain('X-KEEP:me');
  });
});

describe('weekOf', () => {
  it('returns seven Sunday-first days containing the anchor', () => {
    // 2026-09-02 is a Wednesday.
    const week = weekOf('2026-09-02');
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-08-30');
    expect(week[6]).toBe('2026-09-05');
    expect(week).toContain('2026-09-02');
  });

  it('handles a Sunday anchor without shifting a week back', () => {
    expect(weekOf('2026-08-30')[0]).toBe('2026-08-30');
  });

  it('crosses a month boundary correctly', () => {
    expect(weekOf('2026-10-01')).toContain('2026-09-27');
  });
});

describe('shiftWeek', () => {
  it('moves by whole weeks in both directions', () => {
    expect(shiftWeek('2026-09-02', 1)).toBe('2026-09-09');
    expect(shiftWeek('2026-09-02', -1)).toBe('2026-08-26');
  });

  it('keeps the same weekday across a shift', () => {
    const before = new Date('2026-09-02T00:00:00').getDay();
    const after = new Date(`${shiftWeek('2026-09-02', 5)}T00:00:00`).getDay();
    expect(after).toBe(before);
  });

  it('stays on the same week when shifted by zero', () => {
    expect(weekOf(shiftWeek('2026-09-02', 0))).toEqual(weekOf('2026-09-02'));
  });

  it('crosses a year boundary', () => {
    expect(shiftWeek('2026-12-30', 1)).toBe('2027-01-06');
  });
});

describe('shiftDays', () => {
  it('steps forward and back a day', () => {
    expect(shiftDays('2026-09-02', 1)).toBe('2026-09-03');
    expect(shiftDays('2026-09-02', -1)).toBe('2026-09-01');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(shiftDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('is a no-op at zero', () => {
    expect(shiftDays('2026-09-02', 0)).toBe('2026-09-02');
  });
});
