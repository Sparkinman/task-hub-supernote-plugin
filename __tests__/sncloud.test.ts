import {
  snDate,
  snDaysLeft,
  snEpoch,
  snFieldsFrom,
  snListsFrom,
  snNoteLink,
  snTaskFrom,
  snTasksFrom,
  snTokenExpiry,
  snYes,
} from '../src/sncloud';

describe('their vocabulary', () => {
  it('reads "Y" and "N" as booleans', () => {
    expect(snYes('Y')).toBe(true);
    expect(snYes('y')).toBe(true);
    expect(snYes('N')).toBe(false);
    expect(snYes('')).toBe(false);
    expect(snYes(undefined)).toBe(false);
    // Not a boolean-ish coercion: only their own spelling counts.
    expect(snYes(true)).toBe(false);
  });
});

describe('dates', () => {
  it('reads an instant as the UTC calendar date the tablet shows', () => {
    // Stored as midnight UTC. Read locally, anyone east of Greenwich would see
    // the day before.
    expect(snDate(Date.parse('2026-09-14T00:00:00Z'))).toBe('2026-09-14');
  });

  it('treats zero as "no due date" rather than as 1970', () => {
    // The API uses 0 for absent. Read as an instant it would file the task
    // under January 1970 and sort it above everything really due.
    expect(snDate(0)).toBe('');
    expect(snDate(null)).toBe('');
    expect(snDate('nonsense')).toBe('');
  });

  it('round-trips a date', () => {
    expect(snDate(snEpoch('2026-09-14'))).toBe('2026-09-14');
  });

  it('sends 0 rather than null for no date', () => {
    // null is rejected outright on some paths.
    expect(snEpoch('')).toBe(0);
    expect(snEpoch('not a date')).toBe(0);
  });
});

describe('a task row', () => {
  const row = {
    taskId: 'abc123',
    taskListId: 'list1',
    title: 'Call the dentist',
    detail: 'Ask about the crown',
    status: 'needsAction',
    dueTime: Date.parse('2026-09-20T00:00:00Z'),
    lastModified: 1700000000000,
  };

  it('maps the fields', () => {
    const task = snTaskFrom(row);
    expect(task).toMatchObject({
      id: 'abc123',
      listId: 'list1',
      title: 'Call the dentist',
      notes: 'Ask about the crown',
      completed: false,
      dueDate: '2026-09-20',
    });
  });

  it('NEVER reads completion from completedTime', () => {
    // The trap this connector exists having avoided: every task on the account
    // it was built against carried a completedTime while reporting
    // needsAction. Trusting it would mark everything done and, two-way, push
    // that everywhere.
    const task = snTaskFrom({...row, completedTime: 1700000000000});
    expect(task?.completed).toBe(false);
    expect(task?.completedAt).toBeUndefined();
  });

  it('dates a completion once status has established one', () => {
    const task = snTaskFrom({
      ...row,
      status: 'completed',
      completedTime: 1700000000000,
    });
    expect(task?.completed).toBe(true);
    expect(task?.completedAt).toBe(1700000000000);
  });

  it('carries the notebook page a to-do was written on', () => {
    const task = snTaskFrom({
      ...row,
      links: [{fileName: 'Daily 2026-09-14.note', pageNo: 3}],
    });
    expect(task?.notes).toContain('Ask about the crown');
    expect(task?.notes).toContain('From Daily 2026-09-14.note, page 3');
  });

  it('is null without an id, which is the only thing that identifies it', () => {
    expect(snTaskFrom({...row, taskId: ''})).toBeNull();
    expect(snTaskFrom(null)).toBeNull();
    expect(snTaskFrom('nope')).toBeNull();
  });

  it('skips unusable rows rather than failing the whole read', () => {
    const tasks = snTasksFrom({scheduleTask: [row, null, {taskId: ''}, row]});
    expect(tasks).toHaveLength(2);
    expect(snTasksFrom({})).toEqual([]);
    expect(snTasksFrom(null)).toEqual([]);
  });
});

describe('snNoteLink', () => {
  it('takes the first usable link', () => {
    expect(snNoteLink([{fileName: 'A.note', pageNo: 2}])).toEqual({name: 'A.note', page: 2});
  });

  it('omits a page that is not one', () => {
    expect(snNoteLink([{fileName: 'A.note', pageNo: 0}])).toEqual({name: 'A.note'});
  });

  it('is null for anything else', () => {
    expect(snNoteLink(undefined)).toBeNull();
    expect(snNoteLink([])).toBeNull();
    expect(snNoteLink([{}])).toBeNull();
  });
});

describe('lists', () => {
  it('drops deleted ones', () => {
    const lists = snListsFrom({
      scheduleTaskGroup: [
        {taskListId: '1', title: 'Work'},
        {taskListId: '2', title: 'Gone', isDeleted: 'Y'},
        {taskListId: '3', title: ''},
      ],
    });
    expect(lists).toEqual([
      {id: '1', name: 'Work'},
      {id: '3', name: 'Untitled list'},
    ]);
  });
});

describe('what we are allowed to write', () => {
  it('sends only the editable fields, so their own bookkeeping survives', () => {
    const fields = snFieldsFrom({
      title: 'Call the dentist',
      notes: 'Ask about the crown',
      dueDate: '2026-09-20',
      completed: false,
    });
    expect(Object.keys(fields).sort()).toEqual(['detail', 'dueTime', 'status', 'title']);
    expect(fields.status).toBe('needsAction');
  });

  it('adds a completion time only when completing', () => {
    const done = snFieldsFrom({
      title: 'x',
      dueDate: '',
      completed: true,
      completedAt: 1700000000000,
    });
    expect(done.status).toBe('completed');
    expect(done.completedTime).toBe(1700000000000);
  });

  it('sends null for an empty note and 0 for no date', () => {
    const fields = snFieldsFrom({title: 'x', dueDate: '', completed: false});
    expect(fields.detail).toBeNull();
    expect(fields.dueTime).toBe(0);
  });
});

describe('the session token', () => {
  // A JWT whose payload is {"exp": 1800000000}. Only the middle part is read.
  const payload = 'eyJleHAiOjE4MDAwMDAwMDB9';
  const token = `header.${payload}.signature`;

  it('reads the expiry out of the token, without atob', () => {
    // Hermes has no atob, so the decoder is hand-rolled — the same lesson as
    // `new URL`: a browser global passes every test under Node and fails on
    // the device.
    expect(snTokenExpiry(token)).toBe(1800000000 * 1000);
  });

  it('counts the days left, which is what the warning needs', () => {
    const now = 1800000000 * 1000 - 3 * 86400000;
    expect(snDaysLeft(token, now)).toBe(3);
  });

  it('is null for anything that is not a token', () => {
    expect(snTokenExpiry('')).toBeNull();
    expect(snTokenExpiry('not.a.jwt')).toBeNull();
    expect(snTokenExpiry('onepart')).toBeNull();
    expect(snDaysLeft('')).toBeNull();
  });
});
