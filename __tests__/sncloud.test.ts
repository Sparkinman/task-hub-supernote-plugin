import {
  SN_UNFILED_ID,
  SN_UNFILED_NAME,
  snDate,
  snDaysLeft,
  snEpoch,
  snFieldsFrom,
  snFiledUnder,
  snListsFrom,
  snListsWithUnfiled,
  snNoteLink,
  snUnfiledCounts,
  snUnfiledNote,
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

describe('to-dos that belong to no list', () => {
  const filed = {id: 'a', listId: 'list1', title: 'Filed', completed: false, dueDate: ''};
  const loose = {...filed, id: 'b', listId: '', title: 'Loose'};
  const orphan = {...filed, id: 'c', listId: 'gone', title: 'Orphan'};
  const lists = [{id: 'list1', name: 'Work'}];

  it('counts a task as filed only when its list still exists', () => {
    const live = new Set(['list1']);
    expect(snFiledUnder(filed, live)).toBe(true);
    // No list at all, and a list that has since been deleted: both are
    // invisible to a per-list read, so both belong in the Inbox.
    expect(snFiledUnder(loose, live)).toBe(false);
    expect(snFiledUnder(orphan, live)).toBe(false);
  });

  it('offers the Inbox under the name the tablet uses', () => {
    const out = snListsWithUnfiled(lists, [filed, loose]);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({id: SN_UNFILED_ID, name: SN_UNFILED_NAME});
    expect(SN_UNFILED_NAME).toBe('Inbox');
  });

  it('does not offer it for a completed to-do, which would never be shown', () => {
    // Offering a list that turns out empty the moment it is ticked is worse
    // than not offering it at all.
    expect(snListsWithUnfiled(lists, [filed, {...loose, completed: true}])).toEqual(lists);
  });

  it('does not offer it when every to-do is properly filed', () => {
    // An empty list nobody can explain is worse than no list.
    expect(snListsWithUnfiled(lists, [filed])).toEqual(lists);
    expect(snListsWithUnfiled(lists, [])).toEqual(lists);
  });

  it('offers it for a task orphaned by a deleted list, not only an unfiled one', () => {
    expect(snListsWithUnfiled(lists, [filed, orphan])).toHaveLength(2);
  });

  it('cannot collide with a real list id', () => {
    // Theirs are 32-character hex, or the literal "1" for the default list.
    expect(SN_UNFILED_ID).toBe('__unfiled__');
    expect(/^[0-9a-f]{32}$|^1$/.test(SN_UNFILED_ID)).toBe(false);
  });
});

describe('a to-do deleted on the tablet', () => {
  it('is dropped, rather than lingering on screen for ever', () => {
    // It comes back in `scheduleTask` flagged rather than absent, and nothing
    // downstream removes a task it has already been shown.
    const row = {taskId: 'x', taskListId: 'list1', title: 'Gone', status: 'needsAction'};
    expect(snTaskFrom(row)).not.toBeNull();
    expect(snTaskFrom({...row, isDeleted: 'Y'})).toBeNull();
    expect(snTaskFrom({...row, isDeleted: 'N'})).not.toBeNull();
    expect(snTasksFrom({scheduleTask: [row, {...row, taskId: 'y', isDeleted: 'Y'}]})).toHaveLength(1);
  });
});

describe('saying why the Inbox is not there', () => {
  const filed = {id: 'a', listId: 'list1', title: 'Filed', completed: false, dueDate: ''};
  const loose = {...filed, id: 'b', listId: '', title: 'Loose'};
  const lists = [{id: 'list1', name: 'Work'}];

  it('counts unfiled to-dos by whether they are still open', () => {
    const counts = snUnfiledCounts(lists, [filed, loose, {...loose, id: 'c', completed: true}]);
    expect(counts).toEqual({open: 1, completed: 1});
  });

  it('says nothing when the Inbox is there to speak for itself', () => {
    expect(snUnfiledNote(lists, [loose])).toBeNull();
  });

  it('explains an Inbox holding only completed to-dos', () => {
    // The case that actually happened: an item plainly visible in the tablet's
    // own Inbox, no Inbox in the plugin, and nothing anywhere saying why.
    const note = snUnfiledNote(lists, [{...loose, completed: true}]) ?? '';
    expect(note).toContain('1 to-do that belong to no list');
    expect(note).toContain('completed');
  });

  it('counts more than one of them properly', () => {
    const done = [
      {...loose, id: 'x', completed: true},
      {...loose, id: 'y', completed: true},
    ];
    expect(snUnfiledNote(lists, done) ?? '').toContain('2 to-dos');
  });

  it('says so plainly when everything really is filed', () => {
    expect(snUnfiledNote(lists, [filed])).toBe(
      'No Inbox: every to-do on this account is in a list.',
    );
  });
});
