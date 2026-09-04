import {ORIGIN_LABELS, THIRD_PARTY, originIsNamed, originLabel} from '../src/origin';
import {
  buildVEvent,
  buildVTodo,
  markCompleted,
  parseVEvents,
  parseVTodos,
  updateVTodo,
} from '../src/ical';
import {rowStartDate, rowWeekNumber} from '../src/components/MiniCalendar';

const TODO = (body: string) =>
  ['BEGIN:VCALENDAR', 'BEGIN:VTODO', body, 'END:VTODO', 'END:VCALENDAR'].join('\r\n');

describe('originLabel', () => {
  it('names the services Task Hub has tested', () => {
    expect(originLabel('google')).toBe('Google');
    expect(originLabel('todoist')).toBe('Todoist');
    expect(originLabel('ticktick')).toBe('TickTick');
    expect(originLabel('obsidian')).toBe('Obsidian');
    expect(originLabel('local')).toBe('Task Hub');
  });

  it('collapses the untested services to the third-party badge', () => {
    for (const value of ['apple', 'microsoft', 'things3', 'radicale']) {
      expect(originLabel(value)).toBe(THIRD_PARTY);
    }
  });

  it('treats a MISSING property as third party, not as unknown or blank', () => {
    // Absence is meaningful: the item never passed through Task Hub's sync.
    expect(originLabel(undefined)).toBe(THIRD_PARTY);
    expect(originLabel('')).toBe(THIRD_PARTY);
    expect(originLabel('   ')).toBe(THIRD_PARTY);
  });

  it('falls back rather than showing a raw slug for a service added later', () => {
    expect(originLabel('someservice')).toBe(THIRD_PARTY);
  });

  it('is case-insensitive', () => {
    expect(originLabel('GOOGLE')).toBe('Google');
  });

  it('marks only named services for emphasis', () => {
    expect(originIsNamed('google')).toBe(true);
    expect(originIsNamed('radicale')).toBe(false);
    expect(originIsNamed(undefined)).toBe(false);
  });

  it('covers every documented value', () => {
    const documented = [
      'google',
      'todoist',
      'ticktick',
      'apple',
      'microsoft',
      'things3',
      'obsidian',
      'radicale',
      'local',
    ];
    for (const value of documented) {
      expect(ORIGIN_LABELS[value]).toBeDefined();
    }
  });
});

describe('parsing X-TASKHUB-ORIGIN', () => {
  it('reads the origin from a real Task Hub VTODO', () => {
    const [todo] = parseVTodos(
      TODO(
        [
          'CATEGORIES:task',
          'DTSTART;VALUE=DATE:20260914',
          'DUE;VALUE=DATE:20260918',
          'STATUS:COMPLETED',
          'SUMMARY:MT2 four day span',
          'UID:80935a9a-0f34-42ae-9058-1b14978e9ba9@taskhub',
          'X-TASKHUB-ORIGIN:obsidian',
        ].join('\r\n'),
      ),
    );
    expect(todo.origin).toBe('obsidian');
    expect(originLabel(todo.origin)).toBe('Obsidian');
    expect(todo.completed).toBe(true);
  });

  it('leaves origin undefined when the property is absent', () => {
    const [todo] = parseVTodos(TODO(['UID:a1', 'SUMMARY:Written elsewhere'].join('\r\n')));
    expect(todo.origin).toBeUndefined();
    expect(originLabel(todo.origin)).toBe(THIRD_PARTY);
  });

  it('reads the optional account label when present', () => {
    const [todo] = parseVTodos(
      TODO(['UID:a1', 'SUMMARY:x', 'X-TASKHUB-ORIGIN:google', 'X-TASKHUB-ORIGIN-NAME:Work'].join('\r\n')),
    );
    expect(todo.originName).toBe('Work');
  });

  it('reads the origin from events too', () => {
    const [event] = parseVEvents(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:e1',
        'SUMMARY:Standup',
        'DTSTART;VALUE=DATE:20260910',
        'X-TASKHUB-ORIGIN:google',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    expect(event.origin).toBe('google');
  });
});

describe('mini calendar week numbers', () => {
  it('does not repeat a number on a partial first row', () => {
    // September 2026 starts on a Tuesday, so row 0 is partial. Taking the
    // number from the row's first real day made rows 0 and 1 both read 36.
    const rows = [0, 1, 2, 3, 4].map(i => rowWeekNumber(2026, 8, i));
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows[0]).toBe(36);
    expect(rows[1]).toBe(37);
  });

  it('increments by exactly one per row', () => {
    const rows = [0, 1, 2, 3].map(i => rowWeekNumber(2026, 8, i));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]).toBe(rows[i - 1] + 1);
    }
  });

  it('handles a month starting on Sunday, where row 0 is already full', () => {
    // November 2026 starts on a Sunday.
    const rows = [0, 1, 2].map(i => rowWeekNumber(2026, 10, i));
    expect(new Set(rows).size).toBe(3);
  });

  it('gives each row a Sunday start date, including padded rows', () => {
    expect(rowStartDate(2026, 8, 0)).toBe('2026-08-30');
    expect(rowStartDate(2026, 8, 1)).toBe('2026-09-06');
    expect(new Date(`${rowStartDate(2026, 8, 0)}T00:00:00`).getDay()).toBe(0);
  });
});

describe('stamping items this plugin creates', () => {
  const now = new Date(Date.UTC(2026, 8, 3, 9, 0, 0));

  it('stamps a new task and round-trips the value', () => {
    const ics = buildVTodo({uid: 't1', summary: 'Buy milk'}, now);
    expect(ics).toContain('X-TASKHUB-ORIGIN:supernote');
    expect(ics).toContain('X-TASKHUB-ORIGIN-NAME:Supernote');
    expect(parseVTodos(ics)[0].origin).toBe('supernote');
  });

  it('stamps a new event', () => {
    const ics = buildVEvent({uid: 'e1', summary: 'Standup', date: '2026-09-10'}, now);
    expect(parseVEvents(ics)[0].origin).toBe('supernote');
  });

  it('shows as Supernote in this UI', () => {
    expect(originLabel('supernote')).toBe('Supernote');
    expect(originIsNamed('supernote')).toBe(true);
  });

  it('does NOT overwrite the origin of an item created elsewhere', () => {
    // Editing a task that came from Obsidian must leave its provenance alone —
    // the surgical rewrite preserves properties it does not model.
    const foreign = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTODO',
      'UID:x1',
      'SUMMARY:From Obsidian',
      'X-TASKHUB-ORIGIN:obsidian',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');
    const edited = updateVTodo(foreign, {summary: 'Renamed here'}, now);
    expect(edited).toContain('X-TASKHUB-ORIGIN:obsidian');
    expect(edited).not.toContain('X-TASKHUB-ORIGIN:supernote');
    expect(parseVTodos(edited)[0].origin).toBe('obsidian');
  });

  it('preserves the origin when completing a task from elsewhere', () => {
    const foreign = buildVTodo({uid: 'g1', summary: 'x'}, now).replace(
      'X-TASKHUB-ORIGIN:supernote',
      'X-TASKHUB-ORIGIN:google',
    );
    expect(markCompleted(foreign, now)).toContain('X-TASKHUB-ORIGIN:google');
  });
});

describe('source page link', () => {
  const now = new Date(Date.UTC(2026, 8, 3, 9, 0, 0));

  it('records the capture location as its own properties, not in the description', () => {
    const ics = buildVTodo(
      {uid: 't1', summary: 'Buy milk', sourcePath: '/storage/emulated/0/Note/Ideas.note', sourcePage: 3},
      now,
    );
    expect(ics).toContain('X-TASKHUB-SOURCE:/storage/emulated/0/Note/Ideas.note');
    expect(ics).toContain('X-TASKHUB-SOURCE-PAGE:3');
    // The description must stay the user's own space.
    expect(ics).not.toContain('DESCRIPTION');
  });

  it('round-trips the path and page', () => {
    const ics = buildVTodo(
      {uid: 't1', summary: 'x', sourcePath: '/storage/Note/A.note', sourcePage: 7},
      now,
    );
    const [task] = parseVTodos(ics);
    expect(task.sourcePath).toBe('/storage/Note/A.note');
    expect(task.sourcePage).toBe(7);
  });

  it('keeps page 0 rather than losing a falsy first page', () => {
    const ics = buildVTodo({uid: 't1', summary: 'x', sourcePath: '/a.note', sourcePage: 0}, now);
    expect(ics).toContain('X-TASKHUB-SOURCE-PAGE:0');
    expect(parseVTodos(ics)[0].sourcePage).toBe(0);
  });

  it('omits the properties entirely for a task with no source', () => {
    const ics = buildVTodo({uid: 't1', summary: 'x'}, now);
    expect(ics).not.toContain('X-TASKHUB-SOURCE');
    expect(parseVTodos(ics)[0].sourcePath).toBeUndefined();
  });

  it('survives an edit, so the link is not lost when the user rewrites the task', () => {
    const ics = buildVTodo(
      {uid: 't1', summary: 'Original', sourcePath: '/storage/Note/A.note', sourcePage: 2},
      now,
    );
    const edited = updateVTodo(ics, {summary: 'Renamed', description: 'my notes'}, now);
    const [task] = parseVTodos(edited);
    expect(task.sourcePath).toBe('/storage/Note/A.note');
    expect(task.sourcePage).toBe(2);
    expect(task.description).toBe('my notes');
  });
});
