import {
  asRemoteTask,
  asRemoteTasks,
  isSnCollection,
  isSnTask,
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
    expect(mapped.dueAt).toBe(Date.parse('2026-09-20T00:00:00Z'));
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

  it('keeps only the ticked lists', () => {
    const out = asRemoteTasks(
      [task, {...task, id: 'other', listId: 'list2'}],
      [],
      watched,
    );
    expect(out).toHaveLength(1);
    expect(out[0].uid).toBe('supernote-abc123');
  });

  it('prefers the live name, so a list renamed on the tablet reads correctly', () => {
    const out = asRemoteTasks([task], [{id: 'list1', name: 'Renamed'}], watched);
    expect(out[0].collectionLabel).toBe('Renamed');
  });

  it('falls back to the stored name when nothing was fetched', () => {
    expect(asRemoteTasks([task], [], watched)[0].collectionLabel).toBe('Work');
  });
});
