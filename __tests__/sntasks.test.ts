import {
  SN_UNFILED_URL,
  asRemoteTask,
  asRemoteTasks,
  isSnCollection,
  isSnTask,
  isSnUnfiled,
  snCollectionUrl,
  snIdOf,
  snListId,
} from '../src/sntasks';
import type {SnTask} from '../src/sncloud';

const task: SnTask = {
  id: 'abc123',
  listId: 'list1',
  title: 'Call the dentist',
  notes: 'Ask about the crown',
  completed: false,
  dueDate: '2026-09-20',
};

describe('telling a Supernote task from a CalDAV one', () => {
  it('marks the collection with a scheme no CalDAV URL can have', () => {
    expect(snCollectionUrl('list1')).toBe('supernote:list1');
    expect(isSnCollection('supernote:list1')).toBe(true);
    expect(isSnCollection('https://host/dav/tasks/')).toBe(false);
    expect(snListId('supernote:list1')).toBe('list1');
    expect(snListId('https://host/dav/tasks/')).toBe('');
  });

  it('recognises a task by where it lives, not by its uid alone', () => {
    const mapped = asRemoteTask(task, 'Work');
    expect(isSnTask(mapped)).toBe(true);
    expect(snIdOf(mapped)).toBe('abc123');
    // A CalDAV task that merely happened to be named this way is still CalDAV.
    expect(
      snIdOf({uid: 'supernote-abc123', collectionUrl: 'https://host/dav/tasks/'}),
    ).toBe('');
  });
});

describe('asRemoteTask', () => {
  const mapped = asRemoteTask(task, 'Work');

  it('leaves href and raw empty, which is what keeps it out of the CalDAV path', () => {
    // A CalDAV write is a PUT to href against raw. Anything plausible in
    // either would let a cloud task be written to the wrong place entirely.
    expect(mapped.href).toBe('');
    expect(mapped.raw).toBe('');
  });

  it('carries the badge the plugin already knows', () => {
    expect(mapped.origin).toBe('supernote');
    expect(mapped.collectionLabel).toBe('Work');
    expect(mapped.collectionUrl).toBe('supernote:list1');
  });

  it('fills the fields the task list sorts and buckets on', () => {
    expect(mapped.summary).toBe('Call the dentist');
    expect(mapped.dueDate).toBe('2026-09-20');
    // Midnight *local*, whatever zone the suite runs in: a to-do carries a
    // date, and the instant behind it only has to mean that date where the
    // device is.
    const due = new Date(mapped.dueAt as number);
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2026, 8, 20]);
    expect(due.getHours()).toBe(0);
    expect(mapped.completed).toBe(false);
    expect(mapped.status).toBe('NEEDS-ACTION');
  });

  it('has no due date rather than a fake one when the task has none', () => {
    const undated = asRemoteTask({...task, dueDate: ''}, 'Work');
    expect(undated.dueAt).toBeNull();
    expect(undated.dueDate).toBeUndefined();
  });
});

describe('asRemoteTasks', () => {
  const watched = [{id: 'list1', name: 'Work'}];
  const live = [
    {id: 'list1', name: 'Work'},
    {id: 'list2', name: 'Home'},
  ];

  it('keeps only the ticked lists', () => {
    const out = asRemoteTasks([task, {...task, id: 'other', listId: 'list2'}], live, watched);
    expect(out).toHaveLength(1);
    expect(out[0].uid).toBe('supernote-abc123');
  });

  it('prefers the live name, so a list renamed on the tablet reads correctly', () => {
    const out = asRemoteTasks([task], [{id: 'list1', name: 'Renamed'}], watched);
    expect(out[0].collectionLabel).toBe('Renamed');
  });
});

describe('the Inbox — to-dos that belong to no list', () => {
  const inbox = {id: '__unfiled__', name: 'Inbox'};
  const live = [{id: 'list1', name: 'Work'}];
  const loose: SnTask = {...task, id: 'loose', listId: ''};

  it('has a collection URL of its own that reads as read-only', () => {
    expect(SN_UNFILED_URL).toBe('supernote:__unfiled__');
    expect(isSnUnfiled(SN_UNFILED_URL)).toBe(true);
    expect(isSnUnfiled('supernote:list1')).toBe(false);
    expect(isSnUnfiled('https://host/dav/tasks/')).toBe(false);
  });

  it('shows a task with no list at all, rather than dropping it silently', () => {
    const out = asRemoteTasks([loose], live, [inbox]);
    expect(out).toHaveLength(1);
    expect(out[0].collectionUrl).toBe(SN_UNFILED_URL);
    expect(out[0].collectionLabel).toBe('Inbox');
  });

  it('treats a task whose list has been deleted the same way', () => {
    // `snListsFrom` drops deleted lists, so the id simply is not live any more.
    // The task is just as invisible to a per-list read as one with no list.
    const orphan: SnTask = {...task, id: 'orphan', listId: 'deleted-list'};
    const out = asRemoteTasks([orphan], live, [inbox]);
    expect(out.map(t => t.collectionUrl)).toEqual([SN_UNFILED_URL]);
  });

  it('hides them again when the Inbox is not ticked', () => {
    expect(asRemoteTasks([loose], live, [{id: 'list1', name: 'Work'}])).toEqual([]);
  });

  it('never lets a real list leak into it', () => {
    const out = asRemoteTasks([task, loose], live, [{id: 'list1', name: 'Work'}, inbox]);
    expect(out.map(t => t.collectionUrl).sort()).toEqual([
      SN_UNFILED_URL,
      'supernote:list1',
    ]);
  });

  it('reads by its own name even if a stale one was stored when it was ticked', () => {
    const out = asRemoteTasks([loose], live, [{id: '__unfiled__', name: 'Unfiled tasks'}]);
    expect(out[0].collectionLabel).toBe('Inbox');
  });
});

describe('completed to-dos', () => {
  const live = [{id: 'list1', name: 'Work'}];
  const watched = [
    {id: 'list1', name: 'Work'},
    {id: '__unfiled__', name: 'Inbox'},
  ];
  const doneTask: SnTask = {...task, id: 'done', completed: true};

  it('are never shown, from a real list or from the Inbox', () => {
    // The same rule the CalDAV side applies in its REPORT. Their API has no
    // server-side filter, so it is applied here instead.
    expect(asRemoteTasks([doneTask], live, watched)).toEqual([]);
    expect(asRemoteTasks([{...doneTask, listId: ''}], live, watched)).toEqual([]);
  });

  it('do not take the open ones with them', () => {
    const out = asRemoteTasks([task, doneTask, {...task, id: 'loose', listId: ''}], live, watched);
    expect(out.map(t => t.uid).sort()).toEqual(['supernote-abc123', 'supernote-loose']);
  });
});
