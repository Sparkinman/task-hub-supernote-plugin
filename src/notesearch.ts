import type {ServerConfig} from './settings';

/**
 * The index behind the Find tab: keywords and starred pages across the notes
 * this plugin creates.
 *
 * Two things the device already records per page are readable from a *closed*
 * file, which is what makes this cheap enough to do at all:
 *
 * - **Keywords** carry real text (`PluginFileAPI.getKeyWords` answers
 *   `{keyword, page, index}`), so they can be matched exactly. No recognition
 *   is involved and none is wanted.
 * - **Five-stars** are positions only (`searchFiveStars` answers page indices).
 *   A starred page therefore has nothing to match on but the note it is in,
 *   which is why the filter narrows stars by note name rather than by content.
 *
 * Titles are deliberately not indexed. `getTitles` returns geometry and style
 * and no text at all — a title is handwriting the device knows is a heading —
 * so searching one means OCR over its strokes, per page, per note. That is a
 * different feature with a different cost, and it is not this one.
 *
 * Pure on purpose: no SDK import, so jest can exercise the labelling, matching
 * and grouping rules off-device. The scan itself lives in `noteindex.ts`.
 */

/** One note file as the index knows it. */
export interface IndexedNote {
  /** Path relative to shared storage, exactly as the native walk reports it. */
  path: string;
  /** Last modification time, epoch ms. Decides whether a rescan is needed. */
  modified: number;
  /** Size in bytes — a second signal, since a coarse mtime can miss an edit. */
  size: number;
  keywords: {keyword: string; page: number}[];
  /** Page indices carrying a five-star. */
  stars: number[];
}

/** What the native walk reports before anything has been read out of the file. */
export interface NoteFile {
  path: string;
  modified: number;
  size: number;
}

/** A folder to walk, and what to call the notes found under it. */
export interface SearchRoot {
  /** Folder relative to shared storage. */
  root: string;
  /** Period noun for notes filed here, or '' when several periods share it. */
  label: string;
}

/** A starred page, ready to draw. */
export interface StarHit {
  path: string;
  /** The note's own name, without folders or the `.note` suffix. */
  name: string;
  label: string;
  modified: number;
  /** Page indices, ascending. Zero-based, as the SDK reports them. */
  pages: number[];
}

/** One keyword, with every page that carries it. */
export interface KeywordHit {
  /** The keyword as first spelled. Grouping is case-insensitive. */
  keyword: string;
  pages: {path: string; name: string; label: string; modified: number; page: number}[];
}

/**
 * The roots to search, and what to call what is found in each.
 *
 * Built from the period-note settings plus the meeting-note root. A period
 * whose notes are switched off is left out: its folder may not exist, and
 * walking a folder the user has disabled would surface notes they have
 * deliberately stopped filing.
 */
export function configuredRoots(config: ServerConfig): SearchRoot[] {
  const configured: {root: string; label: string}[] = [
    {root: config.dailyNote.root, label: 'Daily'},
    {root: config.weekNote.root, label: 'Weekly'},
    {root: config.monthNote.root, label: 'Monthly'},
    {root: config.quarterNote.root, label: 'Quarterly'},
    {root: config.yearNote.root, label: 'Yearly'},
    {root: config.meetingNote.root, label: 'Meeting'},
  ].filter((r, i) => enabledAt(config, i) && normaliseRoot(r.root) !== '');

  // Several periods can share one folder — the "one folder for everything"
  // button in Settings sets exactly that — and then a path under it says
  // nothing about which period wrote it. Such a root gets no period label
  // rather than an arbitrary one of the several that claim it.
  const byRoot = new Map<string, Set<string>>();
  for (const entry of configured) {
    const root = normaliseRoot(entry.root);
    const labels = byRoot.get(root) ?? new Set<string>();
    labels.add(entry.label);
    byRoot.set(root, labels);
  }

  return [...byRoot.entries()].map(([root, labels]) => ({
    root,
    label: labels.size === 1 ? [...labels][0] : '',
  }));
}

function enabledAt(config: ServerConfig, index: number): boolean {
  const flags = [
    config.dailyNote.enabled,
    config.weekNote.enabled,
    config.monthNote.enabled,
    config.quarterNote.enabled,
    config.yearNote.enabled,
    // Meeting notes have no on/off switch — they are created from an event
    // rather than on a schedule, so there is nothing to turn off. Their folder
    // is therefore always searched, as long as one is configured.
    true,
  ];
  return flags[index] === true;
}

/** Trim slashes and whitespace so two spellings of one folder compare equal. */
export function normaliseRoot(root: string): string {
  return (root ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * The folders actually worth walking.
 *
 * A root nested inside another is dropped: the walk already descends, so
 * scanning both would read every note underneath twice. Labelling is
 * unaffected, because `labelFor` matches a path against the full configured
 * list rather than against whatever survived this.
 */
export function walkRoots(roots: SearchRoot[]): string[] {
  const paths = [...new Set(roots.map(r => r.root))].filter(r => r !== '');
  return paths.filter(
    candidate => !paths.some(other => other !== candidate && isUnder(candidate, other)),
  );
}

function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Which period a found note belongs to, by longest matching root.
 *
 * Longest match rather than first: with a weekly root nested inside the daily
 * one, every weekly note is also under the daily root, and the more specific
 * folder is the one that describes it. An unlabelled root, or no match at all,
 * yields '' and the row simply shows no period.
 */
export function labelFor(path: string, roots: SearchRoot[]): string {
  let best: SearchRoot | null = null;
  for (const root of roots) {
    if (isUnder(path, root.root) && (!best || root.root.length > best.root.length)) {
      best = root;
    }
  }
  return best?.label ?? '';
}

/** A note's own name: no folders, no `.note`. */
export function noteName(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.note$/i, '');
}

/**
 * Split a fresh listing into what the cache already covers and what must be read.
 *
 * Matching on both mtime and size: an edit that lands inside the same
 * filesystem timestamp tick is rare but a note that changed size certainly
 * changed. A cached entry whose file has gone is dropped rather than kept,
 * so a deleted note stops appearing in results without a manual rebuild.
 */
export function planScan(
  cached: IndexedNote[],
  listing: NoteFile[],
): {reuse: IndexedNote[]; scan: NoteFile[]} {
  const byPath = new Map(cached.map(note => [note.path, note]));
  const reuse: IndexedNote[] = [];
  const scan: NoteFile[] = [];
  for (const file of listing) {
    const hit = byPath.get(file.path);
    if (hit && hit.modified === file.modified && hit.size === file.size) {
      reuse.push(hit);
    } else {
      scan.push(file);
    }
  }
  return {reuse, scan};
}

/** Case- and whitespace-insensitive containment, the only match this does. */
function matches(haystack: string, query: string): boolean {
  if (!query) {
    return true;
  }
  return haystack.toLowerCase().includes(query.trim().toLowerCase());
}

/**
 * Starred pages, newest note first.
 *
 * Sorted by modification time rather than by name: names here are usually
 * dates, but a user's own layout need not sort lexically, and the file's own
 * timestamp is right whatever they called it.
 *
 * The filter matches the note's name and period, because a five-star carries
 * no text of its own — typing narrows *where* you are looking, not what for.
 */
export function starHits(
  notes: IndexedNote[],
  roots: SearchRoot[],
  query = '',
): StarHit[] {
  return notes
    .filter(note => note.stars.length > 0)
    .map(note => {
      const label = labelFor(note.path, roots);
      return {
        path: note.path,
        name: noteName(note.path),
        label,
        modified: note.modified,
        pages: [...note.stars].sort((a, b) => a - b),
      };
    })
    .filter(hit => matches(`${hit.name} ${hit.label}`, query))
    .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
}

/**
 * Keywords, grouped across every note, alphabetically.
 *
 * Alphabetical rather than by count: with the count already on the row, this
 * list is read by looking for a word, and a frequency ordering makes a known
 * word hard to find. Grouping is case-insensitive so `Standup` and `standup`
 * are one entry; the first spelling met is the one shown.
 */
export function keywordHits(
  notes: IndexedNote[],
  roots: SearchRoot[],
  query = '',
): KeywordHit[] {
  const groups = new Map<string, KeywordHit>();
  for (const note of notes) {
    const label = labelFor(note.path, roots);
    const name = noteName(note.path);
    for (const entry of note.keywords) {
      const text = (entry.keyword ?? '').trim();
      if (!text || !matches(text, query)) {
        continue;
      }
      const key = text.toLowerCase();
      const group = groups.get(key) ?? {keyword: text, pages: []};
      group.pages.push({
        path: note.path,
        name,
        label,
        modified: note.modified,
        page: entry.page,
      });
      groups.set(key, group);
    }
  }

  for (const group of groups.values()) {
    group.pages.sort((a, b) => b.modified - a.modified || a.page - b.page);
  }

  return [...groups.values()].sort((a, b) =>
    a.keyword.localeCompare(b.keyword, undefined, {sensitivity: 'base'}),
  );
}

/** Total starred pages, for the section heading's count. */
export function countStarredPages(hits: StarHit[]): number {
  return hits.reduce((total, hit) => total + hit.pages.length, 0);
}

/* ------------------------------------------------------------------ *
 * The index on disk
 * ------------------------------------------------------------------ */

export const INDEX_FILE = 'noteindex.json';

/** Bumped when the shape changes, so an old file is dropped rather than misread. */
const FORMAT = 1;

interface IndexShape {
  version: number;
  notes: unknown;
}

export function encodeIndex(notes: IndexedNote[]): string {
  const payload: IndexShape = {version: FORMAT, notes};
  return JSON.stringify(payload);
}

/**
 * Read the index back, or [] if there is nothing usable in it.
 *
 * Every failure resolves to an empty index rather than throwing, and every
 * note is validated field by field. This file is only ever an optimisation:
 * a corrupt one must cost a slower first scan, never a broken tab. The same
 * rule the task cache follows, for the same reason.
 */
export function decodeIndex(text: string | null | undefined): IndexedNote[] {
  if (!text) {
    return [];
  }
  let parsed: IndexShape;
  try {
    parsed = JSON.parse(text) as IndexShape;
  } catch {
    return [];
  }
  if (!parsed || parsed.version !== FORMAT || !Array.isArray(parsed.notes)) {
    return [];
  }
  return parsed.notes.filter(isIndexedNote);
}

function isIndexedNote(value: unknown): value is IndexedNote {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const note = value as Partial<IndexedNote>;
  return (
    typeof note.path === 'string' &&
    note.path.length > 0 &&
    typeof note.modified === 'number' &&
    typeof note.size === 'number' &&
    Array.isArray(note.stars) &&
    note.stars.every(page => typeof page === 'number') &&
    Array.isArray(note.keywords) &&
    note.keywords.every(
      entry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as {keyword?: unknown}).keyword === 'string' &&
        typeof (entry as {page?: unknown}).page === 'number',
    )
  );
}
