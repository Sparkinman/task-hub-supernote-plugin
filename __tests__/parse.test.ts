import {
  buildDue,
  isValidDate,
  isValidTime,
  markCompleted,
  matchesFilter,
  parseVTodos,
  sortTasks,
  toDateInput,
  type VTodo,
} from '../src/ical';
import {acceptsEvents, acceptsTasks, parseCollections, resolveHref} from '../src/discovery';

const ICS = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VTODO', body, 'END:VTODO', 'END:VCALENDAR'].join(
    '\r\n',
  );

describe('parseVTodos', () => {
  it('reads summary, description and status', () => {
    const [todo] = parseVTodos(
      ICS(['UID:a1', 'SUMMARY:Buy milk', 'DESCRIPTION:from the corner shop'].join('\r\n')),
    );
    expect(todo.uid).toBe('a1');
    expect(todo.summary).toBe('Buy milk');
    expect(todo.description).toBe('from the corner shop');
    expect(todo.completed).toBe(false);
  });

  it('unescapes text and restores embedded newlines', () => {
    const [todo] = parseVTodos(
      ICS(['UID:a1', 'SUMMARY:Bob\\; milk\\, eggs', 'DESCRIPTION:one\\ntwo'].join('\r\n')),
    );
    expect(todo.summary).toBe('Bob; milk, eggs');
    expect(todo.description).toBe('one\ntwo');
  });

  it('unfolds continuation lines before parsing', () => {
    const long = 'x'.repeat(120);
    const roundTripped = parseVTodos(
      ICS(['UID:a1', `SUMMARY:${long.slice(0, 60)}\r\n ${long.slice(60)}`].join('\r\n')),
    );
    expect(roundTripped[0].summary).toBe(long);
  });

  it('treats VALUE=DATE as an all-day due date with no time', () => {
    const [todo] = parseVTodos(
      ICS(['UID:a1', 'SUMMARY:x', 'DUE;VALUE=DATE:20260910'].join('\r\n')),
    );
    expect(todo.dueDate).toBe('2026-09-10');
    expect(todo.dueTime).toBeUndefined();
    expect(todo.dueAt).toBe(new Date(2026, 8, 10).getTime());
  });

  it('converts a UTC due instant back to local wall time', () => {
    const [todo] = parseVTodos(ICS(['UID:a1', 'SUMMARY:x', 'DUE:20260910T140000Z'].join('\r\n')));
    expect(todo.dueAt).toBe(Date.UTC(2026, 8, 10, 14, 0));
    const local = new Date(Date.UTC(2026, 8, 10, 14, 0));
    expect(todo.dueDate).toBe(toDateInput(local));
  });

  it('marks COMPLETED status as completed', () => {
    const [todo] = parseVTodos(
      ICS(['UID:a1', 'SUMMARY:x', 'STATUS:COMPLETED'].join('\r\n')),
    );
    expect(todo.completed).toBe(true);
  });

  it('reads several VTODOs out of one payload', () => {
    const many =
      'BEGIN:VCALENDAR\r\n' +
      'BEGIN:VTODO\r\nUID:a\r\nSUMMARY:one\r\nEND:VTODO\r\n' +
      'BEGIN:VTODO\r\nUID:b\r\nSUMMARY:two\r\nEND:VTODO\r\n' +
      'END:VCALENDAR';
    expect(parseVTodos(many).map(t => t.uid)).toEqual(['a', 'b']);
  });

  it('ignores a VTODO with no UID rather than inventing one', () => {
    expect(parseVTodos(ICS('SUMMARY:orphan'))).toHaveLength(0);
  });
});

describe('markCompleted', () => {
  const now = new Date(Date.UTC(2026, 8, 2, 7, 5, 3));

  it('sets the completion properties', () => {
    const out = markCompleted(ICS(['UID:a1', 'SUMMARY:x', 'STATUS:NEEDS-ACTION'].join('\r\n')), now);
    expect(out).toContain('STATUS:COMPLETED');
    expect(out).toContain('COMPLETED:20260902T070503Z');
    expect(out).toContain('PERCENT-COMPLETE:100');
    expect(out).not.toContain('STATUS:NEEDS-ACTION');
  });

  it('does not duplicate STATUS when completing twice', () => {
    const once = markCompleted(ICS(['UID:a1', 'SUMMARY:x'].join('\r\n')), now);
    const twice = markCompleted(once, now);
    expect(twice.split('\r\n').filter(l => l.startsWith('STATUS:'))).toHaveLength(1);
  });

  it('preserves properties the plugin does not model', () => {
    const out = markCompleted(
      ICS(['UID:a1', 'SUMMARY:x', 'RRULE:FREQ=WEEKLY', 'X-CUSTOM:keep me'].join('\r\n')),
      now,
    );
    expect(out).toContain('RRULE:FREQ=WEEKLY');
    expect(out).toContain('X-CUSTOM:keep me');
  });

  it('round-trips through the parser as completed', () => {
    const out = markCompleted(ICS(['UID:a1', 'SUMMARY:x'].join('\r\n')), now);
    expect(parseVTodos(out)[0].completed).toBe(true);
  });
});

describe('buildDue', () => {
  it('emits VALUE=DATE when no time is given', () => {
    expect(buildDue('2026-09-10')).toBe('DUE;VALUE=DATE:20260910');
  });

  it('emits a UTC instant when a time is given', () => {
    const expected = new Date(2026, 8, 10, 14, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const utc =
      `${expected.getUTCFullYear()}${pad(expected.getUTCMonth() + 1)}${pad(expected.getUTCDate())}` +
      `T${pad(expected.getUTCHours())}${pad(expected.getUTCMinutes())}00Z`;
    expect(buildDue('2026-09-10', '14:00')).toBe(`DUE:${utc}`);
  });

  it('returns null for missing or malformed dates', () => {
    expect(buildDue(undefined)).toBeNull();
    expect(buildDue('10/09/2026')).toBeNull();
    expect(buildDue('2026-02-31')).toBeNull();
  });

  it('falls back to all-day when the time is malformed', () => {
    expect(buildDue('2026-09-10', '25:00')).toBe('DUE;VALUE=DATE:20260910');
  });
});

describe('validation', () => {
  it('rejects dates that Date would silently roll over', () => {
    expect(isValidDate('2026-02-31')).toBe(false);
    expect(isValidDate('2026-09-10')).toBe(true);
  });

  it('bounds hours and minutes', () => {
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('12:60')).toBe(false);
    expect(isValidTime('23:59')).toBe(true);
  });
});

describe('filters', () => {
  const now = new Date(2026, 8, 2, 12, 0);
  const at = (d: Date | null, completed = false): VTodo => ({
    uid: String(Math.random()),
    summary: 's',
    dueAt: d ? d.getTime() : null,
    status: completed ? 'COMPLETED' : 'NEEDS-ACTION',
    completed,
  });

  it('overdue excludes completed tasks', () => {
    const past = new Date(2026, 8, 1);
    expect(matchesFilter(at(past), 'overdue', now)).toBe(true);
    expect(matchesFilter(at(past, true), 'overdue', now)).toBe(false);
  });

  it('today covers the whole local day', () => {
    expect(matchesFilter(at(new Date(2026, 8, 2, 23, 59)), 'today', now)).toBe(true);
    expect(matchesFilter(at(new Date(2026, 8, 3, 0, 1)), 'today', now)).toBe(false);
  });

  it('nodate matches only undated tasks', () => {
    expect(matchesFilter(at(null), 'nodate', now)).toBe(true);
    expect(matchesFilter(at(new Date(2026, 8, 2)), 'nodate', now)).toBe(false);
  });

  it('undated tasks never match a date-bounded filter', () => {
    expect(matchesFilter(at(null), 'week', now)).toBe(false);
  });

  it('sorts by due date ascending with undated last', () => {
    const order = sortTasks(
      [at(null), at(new Date(2026, 8, 5)), at(new Date(2026, 8, 1))],
      'due-asc',
    );
    expect(order.map(t => (t.dueAt === null ? 'none' : 'dated'))).toEqual([
      'dated',
      'dated',
      'none',
    ]);
  });
});

describe('collection discovery', () => {
  const XML = `<?xml version="1.0"?>
  <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
    <D:response>
      <D:href>/user/</D:href>
      <D:propstat><D:status>HTTP/1.1 200 OK</D:status>
        <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
      </D:propstat>
    </D:response>
    <D:response>
      <D:href>/user/tasks/</D:href>
      <D:propstat><D:status>HTTP/1.1 200 OK</D:status>
        <D:prop>
          <D:displayname>Chores</D:displayname>
          <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
          <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>
        </D:prop>
      </D:propstat>
    </D:response>
    <D:response>
      <D:href>/user/agenda/</D:href>
      <D:propstat><D:status>HTTP/1.1 200 OK</D:status>
        <D:prop>
          <D:displayname>Agenda</D:displayname>
          <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
          <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
        </D:prop>
      </D:propstat>
    </D:response>
  </D:multistatus>`;

  it('keeps calendar collections and drops plain ones', () => {
    const found = parseCollections('https://host:5232', XML);
    // The bare /user/ collection is not a calendar and must not appear.
    expect(found.map(c => c.displayName)).toEqual(['Chores', 'Agenda']);
  });

  it('separates task lists from calendars by component type', () => {
    const found = parseCollections('https://host:5232', XML);
    expect(found.filter(acceptsTasks).map(c => c.displayName)).toEqual(['Chores']);
    expect(found.filter(acceptsEvents).map(c => c.displayName)).toEqual(['Agenda']);
  });

  it('offers a collection with no declared components as both', () => {
    const xml = XML.replace(
      /<C:supported-calendar-component-set>[\s\S]*?<\/C:supported-calendar-component-set>/g,
      '',
    );
    const found = parseCollections('https://host:5232', xml);
    expect(found.every(acceptsTasks)).toBe(true);
    expect(found.every(acceptsEvents)).toBe(true);
  });

  it('falls back to the path segment when displayname is missing', () => {
    const xml = XML.replace('<D:displayname>Chores</D:displayname>', '');
    expect(parseCollections('https://host:5232', xml)[0].displayName).toBe('tasks');
  });

  it('resolves hrefs that are paths and leaves absolute URLs alone', () => {
    expect(resolveHref('https://host:5232/user/', '/user/tasks/')).toBe(
      'https://host:5232/user/tasks/',
    );
    expect(resolveHref('https://host:5232', 'https://other/x/')).toBe('https://other/x/');
  });
});

describe('completion detection across client conventions', () => {
  it('treats a COMPLETED timestamp as done even without STATUS', () => {
    const [todo] = parseVTodos(
      ICS(['UID:a1', 'SUMMARY:x', 'COMPLETED:20260902T070503Z'].join('\r\n')),
    );
    expect(todo.completed).toBe(true);
  });

  it('treats PERCENT-COMPLETE:100 as done even without STATUS', () => {
    const [todo] = parseVTodos(
      ICS(['UID:a1', 'SUMMARY:x', 'PERCENT-COMPLETE:100'].join('\r\n')),
    );
    expect(todo.completed).toBe(true);
  });

  it('leaves a partially complete task open', () => {
    const [todo] = parseVTodos(
      ICS(['UID:a1', 'SUMMARY:x', 'PERCENT-COMPLETE:40'].join('\r\n')),
    );
    expect(todo.completed).toBe(false);
  });

  it('respects an explicit NEEDS-ACTION with no completion markers', () => {
    const [todo] = parseVTodos(
      ICS(['UID:a1', 'SUMMARY:x', 'STATUS:NEEDS-ACTION'].join('\r\n')),
    );
    expect(todo.completed).toBe(false);
  });

  it('does not leak completion state between tasks in one payload', () => {
    const many =
      'BEGIN:VCALENDAR\r\n' +
      'BEGIN:VTODO\r\nUID:a\r\nSUMMARY:done\r\nPERCENT-COMPLETE:100\r\nEND:VTODO\r\n' +
      'BEGIN:VTODO\r\nUID:b\r\nSUMMARY:open\r\nEND:VTODO\r\n' +
      'END:VCALENDAR';
    const [first, second] = parseVTodos(many);
    expect(first.completed).toBe(true);
    expect(second.completed).toBe(false);
  });
});
