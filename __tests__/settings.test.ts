import {
  EMPTY_CONFIG,
  hasCalendars,
  hasCollections,
  isConfigured,
  toggleCalendar,
  toggleCollection,
  type RadicaleConfig,
} from '../src/settings';

const A = 'https://host:5232/user/work/';
const B = 'https://host:5232/user/home/';

const base: RadicaleConfig = {...EMPTY_CONFIG, serverUrl: 'https://host:5232', username: 'user'};

describe('toggleCollection', () => {
  it('the first selection claims the new-task target', () => {
    const next = toggleCollection(base, A);
    expect(next.collectionUrls).toEqual([A]);
    expect(next.defaultCollectionUrl).toBe(A);
  });

  it('a second selection is watched but does not steal the target', () => {
    const next = toggleCollection(toggleCollection(base, A), B);
    expect(next.collectionUrls).toEqual([A, B]);
    expect(next.defaultCollectionUrl).toBe(A);
  });

  it('deselecting the target moves it to a still-selected list', () => {
    const two = toggleCollection(toggleCollection(base, A), B);
    const next = toggleCollection(two, A);
    expect(next.collectionUrls).toEqual([B]);
    // The target must never point at a list that is no longer watched.
    expect(next.defaultCollectionUrl).toBe(B);
  });

  it('deselecting the last list clears the target', () => {
    const next = toggleCollection(toggleCollection(base, A), A);
    expect(next.collectionUrls).toEqual([]);
    expect(next.defaultCollectionUrl).toBe('');
  });

  it('deselecting a non-target list leaves the target alone', () => {
    const two = toggleCollection(toggleCollection(base, A), B);
    const next = toggleCollection(two, B);
    expect(next.defaultCollectionUrl).toBe(A);
  });

  it('never leaves the target outside the watched set', () => {
    let config = base;
    for (const url of [A, B, A, B, A]) {
      config = toggleCollection(config, url);
      if (config.defaultCollectionUrl) {
        expect(config.collectionUrls).toContain(config.defaultCollectionUrl);
      } else {
        expect(config.collectionUrls).toHaveLength(0);
      }
    }
  });
});

describe('readiness checks', () => {
  it('separates "can list" from "can save"', () => {
    const watching = toggleCollection(base, A);
    expect(hasCollections(watching)).toBe(true);
    expect(isConfigured(watching)).toBe(true);

    expect(hasCollections(base)).toBe(false);
    expect(isConfigured(base)).toBe(false);
  });

  it('rejects a target that is not a URL', () => {
    expect(isConfigured({...base, defaultCollectionUrl: 'user/tasks'})).toBe(false);
  });
});

describe('toggleCalendar', () => {
  it('adds and removes calendars independently of task lists', () => {
    const withTask = toggleCollection(base, A);
    const withCal = toggleCalendar(withTask, B);
    expect(withCal.calendarUrls).toEqual([B]);
    // Watching B as a calendar must not make it a task list.
    expect(withCal.collectionUrls).toEqual([A]);
    expect(hasCalendars(withCal)).toBe(true);

    const off = toggleCalendar(withCal, B);
    expect(off.calendarUrls).toEqual([]);
    expect(hasCalendars(off)).toBe(false);
  });

  it('lets one collection serve as both a task list and a calendar', () => {
    const both = toggleCalendar(toggleCollection(base, A), A);
    expect(both.collectionUrls).toEqual([A]);
    expect(both.calendarUrls).toEqual([A]);
  });
});
