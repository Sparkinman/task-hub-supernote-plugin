import type {RemoteEvent, RemoteTask} from './tasks';

/**
 * The last lists fetched, kept on disk so an opening has something to draw.
 *
 * Without this the first opening after the plugin is loaded shows an empty list
 * behind a loading line until the server answers — the whole wait is visible.
 * With it the previous contents are on screen immediately and the fetch, which
 * still runs, only has to replace them.
 *
 * Deliberately a separate file from settings.json rather than another key
 * inside it: this content is volatile and rewritten constantly, and a truncated
 * write must not be able to cost the user their server address and password.
 * Both live in Document/TaskHub.
 *
 * No SDK import here, so the module is unit-testable — sn-plugin-lib resolves a
 * TurboModule at import time that only exists on the device.
 */

export const CACHE_FILE = 'cache.json';

/** Bumped when the shape changes, so an old file is dropped rather than misread. */
const FORMAT = 1;

export interface CachedLists {
  tasks: RemoteTask[];
  events: RemoteEvent[];
  /** When the fetch behind this cache completed, epoch ms. */
  savedAt: number;
}

interface CacheShape {
  version: number;
  savedAt: number;
  tasks: unknown;
  events: unknown;
}

export function encodeCache(
  tasks: RemoteTask[],
  events: RemoteEvent[],
  savedAt: number = Date.now(),
): string {
  const payload: CacheShape = {version: FORMAT, savedAt, tasks, events};
  return JSON.stringify(payload);
}

/**
 * Read a cache file back, or null if there is nothing usable in it.
 *
 * Every failure resolves to null rather than throwing. A cache is an
 * optimisation: a corrupt one must cost a slow opening, never a broken one.
 */
export function decodeCache(text: string | null | undefined): CachedLists | null {
  if (!text) {
    return null;
  }
  let parsed: CacheShape;
  try {
    parsed = JSON.parse(text) as CacheShape;
  } catch {
    return null;
  }
  if (!parsed || parsed.version !== FORMAT) {
    return null;
  }
  if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.events)) {
    return null;
  }
  return {
    tasks: parsed.tasks as RemoteTask[],
    events: parsed.events as RemoteEvent[],
    savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
  };
}
