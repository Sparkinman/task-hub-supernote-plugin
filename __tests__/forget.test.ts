/**
 * Getting rid of a collection the server no longer has.
 *
 * The bug this covers: the ticklists in Settings are built from what discovery
 * finds, so a collection deleted on the server had no row and no box to untick
 * — while the warning about it told the user to go and untick it. There was no
 * way to stop the message at all.
 */

import {
  EMPTY_CONFIG,
  forgetCollections,
  sameCollection,
  toggleCalendar,
  toggleCollection,
  type ServerConfig,
} from '../src/settings';

const WORK = 'https://dav.example/user/work';
const HOME = 'https://dav.example/user/home';
const DEAD = 'https://dav.example/user/claude-calendar';

const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  ...EMPTY_CONFIG,
  serverUrl: 'https://dav.example',
  ...over,
});

describe('sameCollection', () => {
  it('ignores a trailing slash and surrounding space', () => {
    // The listing code strips the slash before asking the server, so the URL a
    // "collection has gone" report carries need not match the stored one.
    expect(sameCollection(`${WORK}/`, WORK)).toBe(true);
    expect(sameCollection(` ${WORK} `, WORK)).toBe(true);
    expect(sameCollection(`${WORK}///`, WORK)).toBe(true);
  });

  it('still tells different collections apart', () => {
    expect(sameCollection(WORK, HOME)).toBe(false);
    expect(sameCollection(WORK, `${WORK}2`)).toBe(false);
  });
});

describe('forgetCollections', () => {
  it('removes a dead calendar and leaves the rest watched', () => {
    const next = forgetCollections(config({calendarUrls: [HOME, DEAD]}), [DEAD]);
    expect(next.calendarUrls).toEqual([HOME]);
  });

  it('removes a dead task list', () => {
    const next = forgetCollections(config({collectionUrls: [WORK, DEAD]}), [DEAD]);
    expect(next.collectionUrls).toEqual([WORK]);
  });

  it('matches even when the stored URL has a trailing slash', () => {
    // Exactly the shape that made a dead collection unremovable.
    const next = forgetCollections(config({calendarUrls: [`${DEAD}/`]}), [DEAD]);
    expect(next.calendarUrls).toEqual([]);
  });

  it('moves the default task list when it was the one removed', () => {
    const next = forgetCollections(
      config({collectionUrls: [DEAD, WORK], defaultCollectionUrl: DEAD}),
      [DEAD],
    );
    expect(next.defaultCollectionUrl).toBe(WORK);
  });

  it('clears the default when nothing is left to point at', () => {
    const next = forgetCollections(
      config({collectionUrls: [DEAD], defaultCollectionUrl: DEAD}),
      [DEAD],
    );
    expect(next.defaultCollectionUrl).toBe('');
  });

  it('leaves a default that survived alone', () => {
    const next = forgetCollections(
      config({collectionUrls: [WORK, DEAD], defaultCollectionUrl: WORK}),
      [DEAD],
    );
    expect(next.defaultCollectionUrl).toBe(WORK);
  });

  it('removes from both kinds at once', () => {
    const next = forgetCollections(
      config({collectionUrls: [WORK, DEAD], calendarUrls: [HOME, DEAD]}),
      [DEAD],
    );
    expect(next.collectionUrls).toEqual([WORK]);
    expect(next.calendarUrls).toEqual([HOME]);
  });

  it('changes nothing else about the settings', () => {
    const before = config({
      calendarUrls: [DEAD],
      username: 'paul',
      dailyNote: {...EMPTY_CONFIG.dailyNote, root: 'Note/Mine'},
    });
    const after = forgetCollections(before, [DEAD]);
    expect(after.username).toBe('paul');
    expect(after.dailyNote.root).toBe('Note/Mine');
  });

  it('is a no-op when nothing matches', () => {
    const before = config({calendarUrls: [HOME]});
    expect(forgetCollections(before, [DEAD]).calendarUrls).toEqual([HOME]);
  });
});

describe('toggling a collection the server no longer has', () => {
  it('unticks a calendar whose stored URL has a trailing slash', () => {
    // The Settings row now offers a stale entry, so its untick has to match the
    // same way the removal does.
    const next = toggleCalendar(config({calendarUrls: [`${DEAD}/`]}), DEAD);
    expect(next.calendarUrls).toEqual([]);
  });

  it('unticks a task list whose stored URL has a trailing slash', () => {
    const next = toggleCollection(config({collectionUrls: [`${DEAD}/`]}), DEAD);
    expect(next.collectionUrls).toEqual([]);
  });

  it('still adds a collection that was not there', () => {
    expect(toggleCalendar(config(), HOME).calendarUrls).toEqual([HOME]);
  });
});
