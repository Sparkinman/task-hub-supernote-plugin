import {
  backgroundCost,
  dayBackground,
  monthBackground,
  quarterBackground,
  weekBackground,
  type PageSize,
} from '../src/background';

/** A Manta's page, which is what the plugin assumes when the device will not say. */
const PAGE: PageSize = {width: 1920, height: 2560};

const inside = (r: {left: number; top: number; right: number; bottom: number}) =>
  r.left >= 0 && r.top >= 0 && r.right <= PAGE.width && r.bottom <= PAGE.height;

describe('every background page', () => {
  const pages = {
    day: dayBackground(PAGE, [{startMin: 540, endMin: 600, title: 'Stand-up'}]),
    week: weekBackground(PAGE, ['14', '15', '16', '17', '18', '19', '20']),
    month: monthBackground(PAGE, 5, Array.from({length: 35}, (_, i) => String(i + 1))),
    quarter: quarterBackground(PAGE, [
      Array.from({length: 31}, (_, i) => String(i + 1)),
      Array.from({length: 30}, (_, i) => String(i + 1)),
      Array.from({length: 31}, (_, i) => String(i + 1)),
    ]),
  };

  it('masks the whole page, so the note’s own template cannot show through', () => {
    // The reason this exists: a lined template under a calendar grid is
    // unreadable, and the mask is what makes a single page usable for this.
    for (const [name, bg] of Object.entries(pages)) {
      expect([name, bg.mask]).toEqual([
        name,
        {left: 0, top: 0, right: PAGE.width, bottom: PAGE.height},
      ]);
    }
  });

  it('draws nothing off the edge of the page', () => {
    for (const [name, bg] of Object.entries(pages)) {
      expect([name, bg.rules.every(inside)]).toEqual([name, true]);
      expect([name, bg.labels.every(l => l.left >= 0 && l.top >= 0)]).toEqual([name, true]);
    }
  });

  it('leaves somewhere to write', () => {
    for (const [name, bg] of Object.entries(pages)) {
      expect([name, bg.writable.length > 0]).toEqual([name, true]);
      expect([name, bg.writable.every(r => r.right > r.left && r.bottom > r.top)]).toEqual([
        name,
        true,
      ]);
    }
  });
});

describe('the day page', () => {
  it('spends no space on hours nobody writes in', () => {
    const narrow = dayBackground(PAGE, []);
    // 07:00-19:00 is thirteen rules, not twenty-five.
    expect(narrow.rules).toHaveLength(13);
  });

  it('widens rather than dropping something scheduled outside the window', () => {
    // An early flight must appear on the page, not be silently absent from it.
    const early = dayBackground(PAGE, [{startMin: 5 * 60, endMin: 6 * 60, title: 'Flight'}]);
    expect(early.labels.some(l => l.text === 'Flight')).toBe(true);
    expect(early.labels.some(l => l.text === '05')).toBe(true);
  });

  it('has no notes area — the agenda is what is written over', () => {
    const bg = dayBackground(PAGE, []);
    const spacing = Math.round(7 * 11.85);
    // A ruled notes band would show up as a run of evenly spaced rules at the
    // foot of the page. The hour grid is spaced far wider than 7mm.
    const gaps = bg.rules.map(r => r.top).sort((a, b) => a - b);
    const tight = gaps.filter((y, i) => i > 0 && y - gaps[i - 1] === spacing);
    expect(tight).toHaveLength(0);
  });
});

describe('the week and month pages', () => {
  it('give the calendar three quarters and the notes area the rest', () => {
    const bg = weekBackground(PAGE, ['1', '2', '3', '4', '5', '6', '7']);
    const margin = Math.round(PAGE.width * 0.02);
    const split = margin + Math.round((PAGE.height - 2 * margin) * 0.75);
    const notes = bg.writable[bg.writable.length - 1];
    expect(notes.top).toBe(split);
  });

  it('rule the notes area at 7mm, which is about seven lines', () => {
    const bg = monthBackground(PAGE, 5, Array.from({length: 35}, (_, i) => String(i + 1)));
    const spacing = Math.round(7 * 11.85);
    const notesTop = bg.writable[bg.writable.length - 1].top;
    const band = bg.rules.filter(r => r.top > notesTop && r.top === r.bottom);
    expect(band.length).toBeGreaterThanOrEqual(6);
    expect(band[1].top - band[0].top).toBe(spacing);
  });

  it('put the date in the corner, never where the writing goes', () => {
    const bg = weekBackground(PAGE, ['14', '15', '16', '17', '18', '19', '20']);
    const first = bg.labels[0];
    const column = bg.writable[0];
    expect(first.text).toBe('14');
    // Above the writable area, not inside it.
    expect(first.top).toBeLessThan(column.top);
  });
});

describe('the quarter page', () => {
  const months = [
    Array.from({length: 31}, (_, i) => String(i + 1)),
    Array.from({length: 30}, (_, i) => String(i + 1)),
    Array.from({length: 31}, (_, i) => String(i + 1)),
  ];

  it('fits three months side by side, every date with its own rule', () => {
    const bg = quarterBackground(PAGE, months);
    expect(bg.rules).toHaveLength(92);
    expect(bg.labels).toHaveLength(92);
  });

  it('gives each date a row you can actually write on', () => {
    // Three columns is what makes this fit: ninety-two rows down a single page
    // would be 2.5mm each. Split three ways they are about 7mm, the same as a
    // ruled notes area.
    const bg = quarterBackground(PAGE, months);
    const rows = bg.writable.filter(r => r.left < PAGE.width / 3);
    const height = rows[1].top - rows[0].top;
    expect(height).toBeGreaterThan(70);
    expect(height).toBeLessThan(95);
  });

  it('puts the rule beside the date, not through it', () => {
    const bg = quarterBackground(PAGE, months);
    expect(bg.rules[0].left).toBeGreaterThan(bg.labels[0].left);
  });
});

describe('how much work each page is', () => {
  it('counts the elements a vector draw would need', () => {
    // The number that decides raster against vector on the device. The quarter
    // page is the worst case by a wide margin, which is why it is the one to
    // time.
    const quarter = backgroundCost(quarterBackground(PAGE, months3()));
    const week = backgroundCost(weekBackground(PAGE, ['1', '2', '3', '4', '5', '6', '7']));
    expect(quarter.elements).toBeGreaterThan(180);
    expect(week.elements).toBeLessThan(40);
  });
});

function months3() {
  return [
    Array.from({length: 31}, (_, i) => String(i + 1)),
    Array.from({length: 30}, (_, i) => String(i + 1)),
    Array.from({length: 31}, (_, i) => String(i + 1)),
  ];
}
