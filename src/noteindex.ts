import {PluginFileAPI} from 'sn-plugin-lib';

import {externalRoot, listNotesWithMeta, readNamed, writeNamed} from './storage';
import {
  INDEX_FILE,
  configuredRoots,
  decodeIndex,
  encodeIndex,
  planScan,
  walkRoots,
  type IndexedNote,
  type NoteFile,
  type SearchRoot,
} from './notesearch';
import type {ServerConfig} from './settings';

/**
 * Reading keywords and starred pages out of the notes this plugin files.
 *
 * The SDK half of the Find tab. Everything that can be decided without the
 * device — which folders to walk, what to call a note, which files the cache
 * already covers, how results are grouped — lives in `notesearch.ts` and is
 * unit-tested; this module only makes the calls.
 *
 * Three calls per note that has to be read, all of them file-level and so
 * usable on a closed file: `getNoteTotalPageNum` for the page list the keyword
 * call insists on, `getKeyWords` for the text, and `searchFiveStars` for the
 * starred pages. On this hardware that is the whole reason the index exists —
 * a few hundred notes is a few hundred round trips, and doing it on every visit
 * to the tab would make the tab feel broken.
 */

// Deliberately ungated: buildPlugin always bundles with --dev false, so a
// __DEV__-guarded log is invisible on a real install.
const TAG = '[TaskHub]';

interface Loose<T> {
  success?: boolean;
  result?: T;
  error?: {message?: string; code?: number};
}

/** The result of one scan, including what it could not read. */
export interface IndexResult {
  notes: IndexedNote[];
  roots: SearchRoot[];
  /** Folders actually walked, for an empty state that can explain itself. */
  walked: string[];
  /** How many notes were found across those folders. */
  found: number;
  /** How many had to be read this time rather than reused from the index. */
  read: number;
  /** How many refused to be read. Reported, never swallowed. */
  failed: number;
}

export interface ScanProgress {
  done: number;
  total: number;
}

function value<T>(res: unknown): T | null {
  const parsed = res as Loose<T> | null | undefined;
  if (!parsed?.success) {
    return null;
  }
  return parsed.result ?? null;
}

/**
 * Read one note's keywords and starred pages.
 *
 * Returns null when the file could not be read at all, so the caller can count
 * it. A note that genuinely has no keywords and no stars is not a failure and
 * comes back as an empty entry — which matters, because that empty entry is
 * what stops it being re-read on every future scan.
 */
async function readNote(file: NoteFile, absolute: string): Promise<IndexedNote | null> {
  let pages: number | null = null;
  try {
    pages = value<number>(await PluginFileAPI.getNoteTotalPageNum(absolute));
  } catch (err) {
    console.log(`${TAG} getNoteTotalPageNum threw for ${file.path}: ${String(err)}`);
  }

  // Stars need no page list, so they are still worth asking for even when the
  // page count refused. Keywords are not: getKeyWords takes the list of pages
  // to look at, and there is nothing sensible to pass without a count.
  let stars: number[] = [];
  try {
    stars = value<number[]>(await PluginFileAPI.searchFiveStars(absolute)) ?? [];
  } catch (err) {
    console.log(`${TAG} searchFiveStars threw for ${file.path}: ${String(err)}`);
  }

  let keywords: {keyword: string; page: number}[] = [];
  if (pages !== null && pages > 0) {
    const pageList = Array.from({length: pages}, (_, i) => i);
    try {
      const raw = value<{keyword?: string; page?: number}[]>(
        await PluginFileAPI.getKeyWords(absolute, pageList),
      );
      keywords = (raw ?? [])
        .filter(k => typeof k?.keyword === 'string' && k.keyword.trim() !== '')
        .map(k => ({keyword: String(k.keyword).trim(), page: Number(k.page ?? 0)}));
    } catch (err) {
      console.log(`${TAG} getKeyWords threw for ${file.path}: ${String(err)}`);
    }
  }

  if (pages === null) {
    // Nothing could be established about the file's pages. Do not cache an
    // empty entry for it, or a note that was merely locked or busy this time
    // would stay invisible until it was edited again.
    return null;
  }

  return {
    path: file.path,
    modified: file.modified,
    size: file.size,
    keywords,
    stars: stars.filter(page => typeof page === 'number'),
  };
}

/**
 * Build or refresh the index.
 *
 * The saved index is consulted first and every note whose modification time and
 * size still match is reused untouched, so a second visit reads only what has
 * actually changed since the first. The refreshed index is written back even
 * when some notes failed, because the ones that succeeded are still worth not
 * re-reading.
 */
export async function buildIndex(
  config: ServerConfig,
  onProgress?: (progress: ScanProgress) => void,
): Promise<IndexResult> {
  const roots = configuredRoots(config);
  const walked = walkRoots(roots);

  // One listing per folder, merged by path: two configured roots can still
  // name the same tree by different spellings, and a note must not be read
  // twice or counted twice.
  const listing = new Map<string, NoteFile>();
  for (const root of walked) {
    for (const file of await listNotesWithMeta(root)) {
      listing.set(file.path, file);
    }
  }
  const files = [...listing.values()];

  const cached = decodeIndex(await readNamed(INDEX_FILE));
  const {reuse, scan} = planScan(cached, files);
  console.log(
    `${TAG} index: ${files.length} notes under ${walked.length} roots, ` +
      `${reuse.length} cached, ${scan.length} to read`,
  );

  const root = (await externalRoot())?.replace(/\/+$/, '') ?? '';
  const fresh: IndexedNote[] = [];
  let failed = 0;
  let done = 0;
  onProgress?.({done: 0, total: scan.length});

  for (const file of scan) {
    const note = await readNote(file, root ? `${root}/${file.path}` : file.path);
    if (note) {
      fresh.push(note);
    } else {
      failed += 1;
    }
    done += 1;
    onProgress?.({done, total: scan.length});
  }

  const notes = [...reuse, ...fresh];
  await writeNamed(INDEX_FILE, encodeIndex(notes));
  if (failed > 0) {
    console.log(`${TAG} index: ${failed} of ${scan.length} notes could not be read`);
  }

  return {notes, roots, walked, found: files.length, read: scan.length, failed};
}

/**
 * Throw the saved index away, so the next build reads every note again.
 *
 * The one manual escape hatch. Modification time and size catch every edit
 * made on the device, but a note restored from a backup or copied over USB can
 * arrive carrying its old timestamp, and then nothing else would notice it.
 */
export async function clearIndex(): Promise<void> {
  await writeNamed(INDEX_FILE, encodeIndex([]));
}
