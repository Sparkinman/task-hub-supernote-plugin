import {CACHE_FILE, decodeCache, encodeCache} from '../src/cache';
import type {RemoteEvent, RemoteTask} from '../src/tasks';

const task = {uid: 't1', summary: 'Write it down', completed: false} as unknown as RemoteTask;
const event = {uid: 'e1', summary: 'Standup', startAt: 42} as unknown as RemoteEvent;

describe('cache codec', () => {
  it('lives beside the settings, not inside them', () => {
    expect(CACHE_FILE).toBe('cache.json');
  });

  it('round-trips both lists', () => {
    const back = decodeCache(encodeCache([task], [event], 1700));
    expect(back).not.toBeNull();
    expect(back?.tasks).toEqual([task]);
    expect(back?.events).toEqual([event]);
    expect(back?.savedAt).toBe(1700);
  });

  it('round-trips empty lists rather than treating them as absent', () => {
    const back = decodeCache(encodeCache([], [], 1));
    expect(back?.tasks).toEqual([]);
    expect(back?.events).toEqual([]);
  });

  // A cache is an optimisation: every bad input has to cost a slow opening
  // rather than a broken one, so all of these resolve to null.
  it.each([
    ['nothing written yet', null],
    ['an empty file', ''],
    ['truncated JSON', '{"version":1,"tasks":['],
    ['not an object', '"hello"'],
    ['a future format', '{"version":99,"tasks":[],"events":[]}'],
    ['no version', '{"tasks":[],"events":[]}'],
    ['tasks not an array', '{"version":1,"tasks":{},"events":[]}'],
    ['events not an array', '{"version":1,"tasks":[],"events":null}'],
  ])('returns null for %s', (_label, text) => {
    expect(decodeCache(text as string | null)).toBeNull();
  });

  it('tolerates a missing timestamp', () => {
    const back = decodeCache('{"version":1,"tasks":[],"events":[]}');
    expect(back?.savedAt).toBe(0);
  });
});
