/**
 * Sort defaults, and the mark left on a page a task was captured from.
 */

import {DEFAULT_SORT, SORT_KEYS, sortTasks, type VTodo} from '../src/ical';
import {MARKER_PEN, MARK_STYLES, STYLE_CODES, isMarkStyle} from '../src/markstyle';
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
    // The native side wraps it, but a caption longer than a line or two would
    // dwarf the mark it is captioning.
    expect(LINK_IMAGE_CAPTION.length).toBeLessThan(70);
  });
});

describe('the marker pen used for shading', () => {
  it('carries the values read off the device, not guesses', () => {
    expect(MARKER_PEN.penType).toBe(11);
    expect(MARKER_PEN.penColor).toBe(202);
  });

  it('is narrower than a hand-drawn marker stroke', () => {
    // 3800 is what the device reported for one drawn by hand. This is a wash
    // under someone else's writing, so it should read as background.
    expect(MARKER_PEN.penWidth).toBeLessThan(3800);
    expect(MARKER_PEN.penWidth).toBeGreaterThan(0);
  });

  it('is off by default, because it draws into the note', () => {
    expect(EMPTY_CONFIG.markShade).toBe(false);
  });
});
