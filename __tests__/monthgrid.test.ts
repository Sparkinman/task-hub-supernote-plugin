/**
 * The filled month grid, and the note layouts that share one tree.
 *
 * The grid matters because it decides which day a tap lands on: a padding cell
 * that names the wrong date would open the wrong note, silently.
 */

import {chunkWeeks, monthGrid, monthGridFilled} from '../src/calendar';
import {LAYOUT_PRESETS, dailyNotePath} from '../src/dailynote';
import {
  PERIOD_LAYOUT_PRESETS,
  SHARED_TREE_LAYOUTS,
  SHARED_TREE_ROOT,
  periodNotePath,
} from '../src/periodnote';

describe('monthGridFilled', () => {
  it('names a real day in every cell, including the padding', () => {
    // The grid is Sunday-first and 1 September 2026 is a Tuesday, so two cells
    // of August lead it: Sunday the 30th and Monday the 31st.
    const cells = monthGridFilled(2026, 8);
    expect(cells[0]).toEqual({iso: '2026-08-30', day: 30, outside: true});
    expect(cells[1]).toEqual({iso: '2026-08-31', day: 31, outside: true});
    expect(cells[2]).toEqual({iso: '2026-09-01', day: 1, outside: false});
    expect(cells.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c.iso))).toBe(true);
  });

  it('runs on into the following month at the end', () => {
    const cells = monthGridFilled(2026, 8);
    const last = cells[cells.length - 1];
    expect(last.outside).toBe(true);
    expect(last.iso.startsWith('2026-10')).toBe(true);
  });

  it('is consecutive from first cell to last', () => {
    // The property that actually matters: every cell one day after the last.
    const cells = monthGridFilled(2026, 8);
    for (let i = 1; i < cells.length; i++) {
      const previous = new Date(`${cells[i - 1].iso}T00:00:00`);
      previous.setDate(previous.getDate() + 1);
      expect(cells[i].iso).toBe(previous.toISOString().slice(0, 10));
    }
  });

  it('agrees with monthGrid on every non-padding cell', () => {
    // The two grids are drawn and navigated from respectively, so they must not
    // disagree about which cell is which day.
    for (const [year, month] of [[2026, 0], [2026, 8], [2027, 1], [2024, 1]]) {
      const plain = monthGrid(year, month);
      const filled = monthGridFilled(year, month);
      expect(filled).toHaveLength(plain.length);
      plain.forEach((cell, i) => {
        if (cell.iso) {
          expect(filled[i].iso).toBe(cell.iso);
          expect(filled[i].outside).toBe(false);
        } else {
          expect(filled[i].outside).toBe(true);
        }
      });
    }
  });

  it('marks exactly the days of the month as inside', () => {
    // February in a leap year, the month most likely to be got wrong.
    const inside = monthGridFilled(2024, 1).filter(c => !c.outside);
    expect(inside).toHaveLength(29);
    expect(inside[0].iso).toBe('2024-02-01');
    expect(inside[28].iso).toBe('2024-02-29');
  });

  it('still chunks into whole weeks', () => {
    const weeks = chunkWeeks(monthGridFilled(2026, 8));
    expect(weeks.every(w => w.length === 7)).toBe(true);
  });
});

describe('the shared note tree', () => {
  const dateFormat = 'iso' as const;
  const note = (layout: string) => ({
    enabled: true,
    root: SHARED_TREE_ROOT,
    layout,
    template: '',
    dateHeading: false,
  });

  it('nests every note type in one dated tree', () => {
    expect(dailyNotePath(note(SHARED_TREE_LAYOUTS.day), '2026-09-14', dateFormat)).toBe(
      'Note/Journal/2026/September/14/Daily.note',
    );
    expect(periodNotePath('month', note(SHARED_TREE_LAYOUTS.month), '2026-09-14', dateFormat)).toBe(
      'Note/Journal/2026/September/Month.note',
    );
    expect(periodNotePath('year', note(SHARED_TREE_LAYOUTS.year), '2026-09-14', dateFormat)).toBe(
      'Note/Journal/2026/Year.note',
    );
    expect(
      periodNotePath('quarter', note(SHARED_TREE_LAYOUTS.quarter), '2026-09-14', dateFormat),
    ).toBe('Note/Journal/2026/Q3/Quarter.note');
  });

  it('puts the day note inside the month note s own folder', () => {
    // The point of the scheme: September holds its month note and its days.
    const monthPath = periodNotePath(
      'month',
      note(SHARED_TREE_LAYOUTS.month),
      '2026-09-14',
      dateFormat,
    );
    const dayPath = dailyNotePath(note(SHARED_TREE_LAYOUTS.day), '2026-09-14', dateFormat);
    const monthFolder = monthPath.slice(0, monthPath.lastIndexOf('/'));
    expect(dayPath.startsWith(`${monthFolder}/`)).toBe(true);
  });

  it('gives every day of a week the same weekly note', () => {
    const week = note(SHARED_TREE_LAYOUTS.week);
    const paths = ['2026-09-13', '2026-09-15', '2026-09-19'].map(d =>
      periodNotePath('week', week, d, dateFormat),
    );
    expect(new Set(paths).size).toBe(1);
  });

  it('is offered as a preset for every note type', () => {
    // The button and the dropdowns must agree, or picking the preset by hand
    // would produce a different tree from pressing the button.
    expect(LAYOUT_PRESETS.find(p => p.key === 'shared')?.layout).toBe(SHARED_TREE_LAYOUTS.day);
    for (const period of ['week', 'month', 'quarter', 'year'] as const) {
      expect(PERIOD_LAYOUT_PRESETS[period].find(p => p.key === 'shared')?.layout).toBe(
        SHARED_TREE_LAYOUTS[period],
      );
    }
  });
});
