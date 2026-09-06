/**
 * Sort defaults, and the mark left on a page a task was captured from.
 */

import {DEFAULT_SORT, SORT_KEYS, sortTasks, type VTodo} from '../src/ical';
import {
  MARKER_PEN,
  MARK_STYLES,
  SHADE_COLORS,
  STYLE_CODES,
  isMarkStyle,
  isShadeColor,
  shadeColorValue,
  shadingLines,
} from '../src/markstyle';
import {EMPTY_CONFIG} from '../src/settings';
import {LINK_IMAGE_BASE64, LINK_IMAGE_CAPTION, LINK_IMAGE_NAME} from '../src/linkimage';
import {readFileSync} from 'fs';
import {join} from 'path';

const todo = (over: Partial<VTodo>): VTodo => ({
  uid: Math.random().toString(36),
  summary: 'task',
  dueAt: null,
  status: 'NEEDS-ACTION',
  completed: false,
  ...over,
});

describe('task list sort order', () => {
  it('offers earliest-first leftmost, so it is the first thing reached', () => {
    expect(SORT_KEYS[0].key).toBe('due-asc');
    expect(SORT_KEYS[0].label).toBe('Date ↑');
  });

  it('opens on earliest-first', () => {
    expect(DEFAULT_SORT).toBe('due-asc');
    expect(SORT_KEYS[0].key).toBe(DEFAULT_SORT);
  });

  it('runs overdue first and furthest out last under that default', () => {
    const day = 86400000;
    const now = Date.UTC(2026, 8, 3);
    const tasks = [
      todo({summary: 'next week', dueAt: now + 7 * day}),
      todo({summary: 'overdue', dueAt: now - 3 * day}),
      todo({summary: 'today', dueAt: now}),
    ];
    expect(sortTasks(tasks, DEFAULT_SORT).map(t => t.summary)).toEqual([
      'overdue',
      'today',
      'next week',
    ]);
  });

  it('still sinks undated tasks to the bottom rather than leading with them', () => {
    const tasks = [todo({summary: 'someday'}), todo({summary: 'dated', dueAt: 1})];
    expect(sortTasks(tasks, DEFAULT_SORT).map(t => t.summary)).toEqual(['dated', 'someday']);
  });

  it('keeps both directions and name available', () => {
    expect(SORT_KEYS.map(s => s.key)).toEqual(['due-asc', 'due-desc', 'name']);
  });
});

describe('page mark styles', () => {
  it('maps each style to the code setLassoStrokeLink documents', () => {
    expect(STYLE_CODES.underline).toBe(0);
    expect(STYLE_CODES.solid).toBe(1);
    expect(STYLE_CODES.dashed).toBe(2);
  });

  it('offers an off switch, because this writes into the user’s own note', () => {
    expect(MARK_STYLES.some(m => m.key === 'off')).toBe(true);
  });

  it('defaults to a dashed box', () => {
    expect(EMPTY_CONFIG.markStyle).toBe('dashed');
    expect(MARK_STYLES[0].key).toBe('dashed');
  });

  it('accepts only known styles from a hand-edited settings file', () => {
    for (const style of ['dashed', 'solid', 'underline', 'off']) {
      expect(isMarkStyle(style)).toBe(true);
    }
    for (const junk of ['DASHED', 'box', '', null, undefined, 2, {}]) {
      expect(isMarkStyle(junk)).toBe(false);
    }
  });

  it('has a code for every style except off', () => {
    for (const {key} of MARK_STYLES) {
      if (key !== 'off') {
        expect(STYLE_CODES[key]).toBeDefined();
      }
    }
  });
});

describe('the image a page mark links to', () => {
  it('decodes to the PNG shipped as the logo', () => {
    const bytes = Buffer.from(LINK_IMAGE_BASE64, 'base64');
    const asset = readFileSync(join(__dirname, '..', 'assets', 'logo-full.png'));
    // Byte-identical: the embedded copy is generated from that file, and a
    // silent drift would ship a stale logo no one would think to check.
    expect(bytes.equals(asset)).toBe(true);
  });

  it('really is a PNG, so the device has something it can open', () => {
    const bytes = Buffer.from(LINK_IMAGE_BASE64, 'base64');
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('is named so a viewer showing the filename still reads as Task Hub', () => {
    expect(LINK_IMAGE_NAME).toBe('Task Hub.png');
  });

  it('captions the popup with what to do, not just what it is', () => {
    expect(LINK_IMAGE_CAPTION).toContain('Task Hub');
    expect(LINK_IMAGE_CAPTION).toContain('remove link');
  });

  it('keeps the caption short enough to sit under the logo', () => {
    // The native side wraps each paragraph, so the constraint is on how much
    // there is to wrap: a caption that runs to a paragraph or two is fine, one
    // that runs to a page would dwarf the mark it is captioning.
    expect(LINK_IMAGE_CAPTION.length).toBeLessThan(200);
    const paragraphs = LINK_IMAGE_CAPTION.split('\n').filter(Boolean);
    expect(paragraphs.length).toBeLessThanOrEqual(3);
    for (const paragraph of paragraphs) {
      expect(paragraph.length).toBeLessThan(100);
    }
  });

  it('explains why tapping the box cannot open the task', () => {
    // The link points at an image because the SDK's link types cannot reach a
    // plugin. Whoever taps it deserves to know that is a platform limit rather
    // than something Task Hub forgot to do.
    expect(LINK_IMAGE_CAPTION).toContain('Ratta SDK');
    expect(LINK_IMAGE_CAPTION).toContain('Task Hub');
  });
});

describe('the marker pen used for shading', () => {
  it('uses only values insertGeometry documents', () => {
    // Supernote's Geometry reference lists four pen types — 10 technical, 11
    // marker, 15 calligraphy, 16 pressure — and exactly four colours. An
    // undocumented colour (202, one away from light grey, read off a device)
    // was almost certainly why nothing was drawn at all, so pin the whole
    // documented set rather than the single number.
    expect([10, 11, 15, 16]).toContain(MARKER_PEN.penType);
    expect([0, 157, 201, 254]).toContain(MARKER_PEN.penColor);
  });

  it('shades in a grey that handwriting stays readable through', () => {
    // Black or white would either bury the writing or be invisible.
    expect([157, 201]).toContain(MARKER_PEN.penColor);
  });

  it('is narrower than a hand-drawn marker stroke, and above the documented floor', () => {
    // 3800 is what the device reported for one drawn by hand. This is a wash
    // under someone else's writing, so it should read as background. The
    // Geometry reference sets the minimum width at 100.
    expect(MARKER_PEN.penWidth).toBeLessThan(3800);
    expect(MARKER_PEN.penWidth).toBeGreaterThanOrEqual(100);
  });

  it('is off by default, because it draws into the note', () => {
    expect(EMPTY_CONFIG.markShade).toBe(false);
  });
});

describe('shading fills the selection', () => {
  it('draws several passes, not one line through the middle', () => {
    const rows = shadingLines({left: 0, top: 100, right: 400, bottom: 300});
    expect(rows.length).toBeGreaterThan(2);
    // Every pass lands inside the selection, none on its edges.
    expect(Math.min(...rows)).toBeGreaterThan(100);
    expect(Math.max(...rows)).toBeLessThan(300);
  });

  it('spreads the passes evenly', () => {
    const rows = shadingLines({left: 0, top: 0, right: 100, bottom: 150});
    const gaps = rows.slice(1).map((y, i) => y - rows[i]);
    // Rounding can differ by a pixel; nothing should be bunched.
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it('still shades a single word rather than drawing one line', () => {
    const rows = shadingLines({left: 0, top: 0, right: 80, bottom: 18});
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('caps the passes so a tall selection is not slow to draw', () => {
    const rows = shadingLines({left: 0, top: 0, right: 100, bottom: 4000});
    expect(rows.length).toBeLessThanOrEqual(14);
  });

  it('returns nothing for a selection with no height', () => {
    expect(shadingLines({left: 0, top: 50, right: 100, bottom: 50})).toEqual([]);
  });
});

describe('the shading colour setting', () => {
  it('offers only colours insertGeometry documents', () => {
    for (const choice of SHADE_COLORS) {
      expect([0, 157, 201, 254]).toContain(choice.value);
    }
  });

  it('does not offer white, which would mark nothing on a white page', () => {
    expect(SHADE_COLORS.some(c => c.value === 254)).toBe(false);
  });

  it('defaults to light grey, including for an unrecognised stored value', () => {
    expect(EMPTY_CONFIG.markShadeColor).toBe('light');
    expect(shadeColorValue('light')).toBe(201);
    expect(shadeColorValue('chartreuse')).toBe(201);
    expect(shadeColorValue('')).toBe(201);
  });

  it('recognises exactly the stored keys it offers', () => {
    for (const choice of SHADE_COLORS) {
      expect(isShadeColor(choice.key)).toBe(true);
      expect(shadeColorValue(choice.key)).toBe(choice.value);
    }
    expect(isShadeColor('mauve')).toBe(false);
    expect(isShadeColor(undefined)).toBe(false);
  });
});
