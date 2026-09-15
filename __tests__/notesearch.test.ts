import {EMPTY_CONFIG, type ServerConfig} from '../src/settings';
import {
  configuredRoots,
  countStarredPages,
  decodeIndex,
  encodeIndex,
  keywordHits,
  labelFor,
  noteName,
  normaliseRoot,
  planScan,
  starHits,
  walkRoots,
  type IndexedNote,
  type SearchRoot,
} from '../src/notesearch';

function config(over: Partial<ServerConfig> = {}): ServerConfig {
  return {...EMPTY_CONFIG, ...over};
}

function note(over: Partial<IndexedNote> = {}): IndexedNote {
  return {path: 'Note/Daily/a.note', modified: 1, size: 1, keywords: [], stars: [], ...over};
}

const ROOTS: SearchRoot[] = [
  {root: 'Note/Daily', label: 'Daily'},
  {root: 'Note/Daily/Weeks', label: 'Weekly'},
  {root: 'Note/Meetings', label: 'Meeting'},
];

describe('configuredRoots', () => {
  it('names each period root and always includes meetings', () => {
    const roots = configuredRoots(config());
    const byRoot = Object.fromEntries(roots.map(r => [r.root, r.label]));
    expect(byRoot['Note/Daily']).toBe('Daily');
    expect(byRoot['Note/Weekly']).toBe('Weekly');
    // Meeting notes have no enabled flag, so their folder is always searched.
    expect(byRoot['Note/Meetings']).toBe('Meeting');
  });

  it('leaves out a period whose notes are switched off', () => {
    const roots = configuredRoots(
      config({weekNote: {...EMPTY_CONFIG.weekNote, enabled: false}}),
    );
    expect(roots.some(r => r.root === 'Note/Weekly')).toBe(false);
  });

  it('drops the period label when several periods share one folder', () => {
    // The "one folder for everything" button in Settings produces exactly this,
    // and then a path under it says nothing about which period wrote it.
    const shared = config({
      dailyNote: {...EMPTY_CONFIG.dailyNote, root: 'Note/Journal'},
      weekNote: {...EMPTY_CONFIG.weekNote, root: 'Note/Journal'},
    });
    const hit = configuredRoots(shared).find(r => r.root === 'Note/Journal');
    expect(hit).toBeDefined();
    expect(hit!.label).toBe('');
  });

  it('ignores a root that is blank or only slashes', () => {
    const roots = configuredRoots(
      config({yearNote: {...EMPTY_CONFIG.yearNote, root: '  /  '}}),
    );
    expect(roots.every(r => r.root !== '')).toBe(true);
  });
});

describe('normaliseRoot', () => {
  it('strips surrounding slashes and whitespace', () => {
    expect(normaliseRoot(' /Note/Daily/ ')).toBe('Note/Daily');
    expect(normaliseRoot('')).toBe('');
  });
});

describe('walkRoots', () => {
  it('drops a root nested inside another, since the walk descends anyway', () => {
    expect(walkRoots(ROOTS).sort()).toEqual(['Note/Daily', 'Note/Meetings']);
  });

  it('keeps siblings that merely share a prefix string', () => {
    const roots: SearchRoot[] = [
      {root: 'Note/Day', label: 'Daily'},
      {root: 'Note/Daybook', label: 'Weekly'},
    ];
    expect(walkRoots(roots).sort()).toEqual(['Note/Day', 'Note/Daybook']);
  });
});

describe('labelFor', () => {
  it('prefers the most specific root', () => {
    // A weekly note is under the daily root too; the deeper folder describes it.
    expect(labelFor('Note/Daily/Weeks/W37.note', ROOTS)).toBe('Weekly');
    expect(labelFor('Note/Daily/2026/09-14.note', ROOTS)).toBe('Daily');
  });

  it('is blank for a path under no configured root', () => {
    expect(labelFor('Note/Loose/scratch.note', ROOTS)).toBe('');
  });
});

describe('noteName', () => {
  it('drops folders and the extension', () => {
    expect(noteName('Note/Daily/2026/2026-09-14.note')).toBe('2026-09-14');
    expect(noteName('flat.NOTE')).toBe('flat');
  });
});

describe('planScan', () => {
  const cached = [note({path: 'a.note', modified: 10, size: 5, stars: [1]})];

  it('reuses an entry whose file is untouched', () => {
    const {reuse, scan} = planScan(cached, [{path: 'a.note', modified: 10, size: 5}]);
    expect(reuse).toHaveLength(1);
    expect(scan).toHaveLength(0);
  });

  it('rereads when the time or the size moved', () => {
    expect(planScan(cached, [{path: 'a.note', modified: 11, size: 5}]).scan).toHaveLength(1);
    expect(planScan(cached, [{path: 'a.note', modified: 10, size: 6}]).scan).toHaveLength(1);
  });

  it('forgets a note that is no longer on disk', () => {
    const {reuse, scan} = planScan(cached, [{path: 'b.note', modified: 1, size: 1}]);
    expect(reuse).toHaveLength(0);
    expect(scan.map(f => f.path)).toEqual(['b.note']);
  });
});

describe('starHits', () => {
  const notes = [
    note({path: 'Note/Daily/old.note', modified: 100, stars: [0, 2]}),
    note({path: 'Note/Daily/Weeks/W37.note', modified: 200, stars: [1]}),
    note({path: 'Note/Daily/none.note', modified: 300}),
  ];

  it('lists only starred notes, newest first, pages ascending', () => {
    const hits = starHits(notes, ROOTS);
    expect(hits.map(h => h.name)).toEqual(['W37', 'old']);
    expect(hits[1].pages).toEqual([0, 2]);
    expect(hits[0].label).toBe('Weekly');
  });

  it('counts pages rather than notes', () => {
    expect(countStarredPages(starHits(notes, ROOTS))).toBe(3);
  });

  it('filters on the note name and its period, having no text of its own', () => {
    expect(starHits(notes, ROOTS, 'w37').map(h => h.name)).toEqual(['W37']);
    expect(starHits(notes, ROOTS, 'weekly').map(h => h.name)).toEqual(['W37']);
    expect(starHits(notes, ROOTS, 'nothing')).toEqual([]);
  });
});

describe('keywordHits', () => {
  const notes = [
    note({
      path: 'Note/Daily/a.note',
      modified: 100,
      keywords: [
        {keyword: 'Standup', page: 1},
        {keyword: 'retro', page: 3},
      ],
    }),
    note({
      path: 'Note/Daily/b.note',
      modified: 200,
      keywords: [{keyword: 'standup', page: 0}, {keyword: '   ', page: 4}],
    }),
  ];

  it('groups case-insensitively, keeping the first spelling met', () => {
    const hits = keywordHits(notes, ROOTS);
    const standup = hits.find(h => h.keyword.toLowerCase() === 'standup');
    expect(standup?.keyword).toBe('Standup');
    expect(standup?.pages).toHaveLength(2);
  });

  it('orders alphabetically, and each keyword’s pages newest first', () => {
    const hits = keywordHits(notes, ROOTS);
    expect(hits.map(h => h.keyword.toLowerCase())).toEqual(['retro', 'standup']);
    const standup = hits[1];
    expect(standup.pages.map(p => p.name)).toEqual(['b', 'a']);
  });

  it('ignores a blank keyword', () => {
    const all = keywordHits(notes, ROOTS).flatMap(h => h.pages);
    expect(all.some(p => p.page === 4)).toBe(false);
  });

  it('matches the keyword text when filtering', () => {
    expect(keywordHits(notes, ROOTS, 'RET').map(h => h.keyword)).toEqual(['retro']);
    expect(keywordHits(notes, ROOTS, 'zzz')).toEqual([]);
  });
});

describe('the index on disk', () => {
  const notes = [note({path: 'a.note', keywords: [{keyword: 'k', page: 2}], stars: [0]})];

  it('round-trips', () => {
    expect(decodeIndex(encodeIndex(notes))).toEqual(notes);
  });

  it('treats anything unreadable as an empty index rather than throwing', () => {
    // A corrupt index must cost a slower scan, never a broken tab.
    expect(decodeIndex(null)).toEqual([]);
    expect(decodeIndex('')).toEqual([]);
    expect(decodeIndex('{ truncated')).toEqual([]);
    expect(decodeIndex(JSON.stringify({version: 99, notes}))).toEqual([]);
    expect(decodeIndex(JSON.stringify({version: 1, notes: 'nope'}))).toEqual([]);
  });

  it('drops individual entries that are the wrong shape', () => {
    const mixed = JSON.stringify({
      version: 1,
      notes: [notes[0], {path: 'b.note'}, null, {...notes[0], stars: ['x']}],
    });
    expect(decodeIndex(mixed)).toEqual(notes);
  });
});
