import {EMPTY_CONFIG, pruneContainers, type ServerConfig} from '../src/settings';

const HOME = 'https://tasks.task-hub.net/radicale/paul/';
const TASKS = 'https://tasks.task-hub.net/radicale/paul/paul-tasks/';
const CAL = 'https://tasks.task-hub.net/radicale/paul/cal/';

function config(over: Partial<ServerConfig> = {}): ServerConfig {
  return {...EMPTY_CONFIG, ...over};
}

describe('pruneContainers', () => {
  it('drops the account folder that contains a saved list', () => {
    const next = pruneContainers(
      config({collectionUrls: [TASKS, HOME], defaultCollectionUrl: TASKS}),
    );
    expect(next.collectionUrls).toEqual([TASKS]);
    expect(next.defaultCollectionUrl).toBe(TASKS);
  });

  it('moves the default off a collection it just dropped', () => {
    const next = pruneContainers(
      config({collectionUrls: [HOME, TASKS], defaultCollectionUrl: HOME}),
    );
    expect(next.collectionUrls).toEqual([TASKS]);
    expect(next.defaultCollectionUrl).toBe(TASKS);
  });

  it('prunes calendars the same way', () => {
    const next = pruneContainers(config({calendarUrls: [HOME, CAL]}));
    expect(next.calendarUrls).toEqual([CAL]);
  });

  it('leaves a lone collection alone, whatever it looks like', () => {
    // Nothing here can tell an oddly-laid-out server from a container, and
    // deleting somebody's only task list is far worse than one odd row.
    const next = pruneContainers(config({collectionUrls: [HOME], defaultCollectionUrl: HOME}));
    expect(next.collectionUrls).toEqual([HOME]);
    expect(next.defaultCollectionUrl).toBe(HOME);
  });

  it('is not fooled by a shared prefix that is not a parent', () => {
    const a = 'https://host/dav/work/';
    const b = 'https://host/dav/workshop/';
    expect(pruneContainers(config({collectionUrls: [a, b]})).collectionUrls).toEqual([a, b]);
  });

  it('ignores a trailing slash when comparing', () => {
    const next = pruneContainers(
      config({collectionUrls: ['https://tasks.task-hub.net/radicale/paul', TASKS]}),
    );
    expect(next.collectionUrls).toEqual([TASKS]);
  });
});
