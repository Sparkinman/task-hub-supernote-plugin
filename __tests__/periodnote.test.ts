/**
 * Notes that belong to a week, a month or a quarter.
 *
 * The rule that matters most: every day inside a period must produce the same
 * path. If it does not, Tuesday and Thursday get different "weekly" notes and
 * the feature is worse than not having it.
 */

import {
  DEFAULT_MONTH_NOTE,
  DEFAULT_QUARTER_NOTE,
  DEFAULT_WEEK_NOTE,
  DEFAULT_YEAR_NOTE,
  PERIOD_LAYOUT_PRESETS,
  expandPeriodLayout,
  hasPeriodNote,
  periodEnd,
  periodLabel,
  periodNotePath,
  periodStart,
  quarterMonths,
  quarterNumber,
  shiftQuarter,
  weekNumber,
  type Period,
} from '../src/periodnote';
import {DEFAULT_DAILY_NOTE} from '../src/dailynote';

describe('period boundaries', () => {
  it('starts weeks on Sunday, matching the week view', () => {
    // 2026-09-06 is a Sunday; the 7th to the 12th belong to the same week.
    expect(periodStart('week', '2026-09-06')).toBe('2026-09-06');
    expect(periodStart('week', '2026-09-09')).toBe('2026-09-06');
    expect(periodStart('week', '2026-09-12')).toBe('2026-09-06');
    expect(periodStart('week', '2026-09-13')).toBe('2026-09-13');
    expect(periodEnd('week', '2026-09-09')).toBe('2026-09-12');
  });

  it('gives every day of a month the same month', () => {
    expect(periodStart('month', '2026-09-01')).toBe('2026-09-01');
    expect(periodStart('month', '2026-09-30')).toBe('2026-09-01');
    expect(periodEnd('month', '2026-09-15')).toBe('2026-09-30');
    // February, including a leap year.
    expect(periodEnd('month', '2026-02-10')).toBe('2026-02-28');
    expect(periodEnd('month', '2028-02-10')).toBe('2028-02-29');
  });

  it('gives every day of a quarter the same quarter', () => {
    expect(periodStart('quarter', '2026-07-01')).toBe('2026-07-01');
    expect(periodStart('quarter', '2026-09-30')).toBe('2026-07-01');
    expect(periodEnd('quarter', '2026-08-15')).toBe('2026-09-30');
    expect(quarterNumber('2026-01-01')).toBe(1);
    expect(quarterNumber('2026-04-01')).toBe(2);
    expect(quarterNumber('2026-09-30')).toBe(3);
    expect(quarterNumber('2026-12-31')).toBe(4);
  });

  it('leaves a day as itself', () => {
    expect(periodStart('day', '2026-09-09')).toBe('2026-09-09');
    expect(periodEnd('day', '2026-09-09')).toBe('2026-09-09');
  });

  it('walks quarters forwards and backwards across a year boundary', () => {
    expect(shiftQuarter('2026-09-15', 1)).toBe('2026-10-01');
    expect(shiftQuarter('2026-11-15', 1)).toBe('2027-01-01');
    expect(shiftQuarter('2026-01-15', -1)).toBe('2025-10-01');
    expect(quarterMonths('2026-08-20')).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
  });
});

describe('one note per period', () => {
  const cases: {period: Exclude<Period, 'day'>; config: typeof DEFAULT_WEEK_NOTE; days: string[]}[] =
    [
      {period: 'week', config: DEFAULT_WEEK_NOTE, days: ['2026-09-06', '2026-09-09', '2026-09-12']},
      {period: 'month', config: DEFAULT_MONTH_NOTE, days: ['2026-09-01', '2026-09-17', '2026-09-30']},
      {
        period: 'quarter',
        config: DEFAULT_QUARTER_NOTE,
        days: ['2026-07-01', '2026-08-20', '2026-09-30'],
      },
    ];

  for (const {period, config, days} of cases) {
    it(`gives every day in a ${period} the same path`, () => {
      const paths = days.map(d => periodNotePath(period, config, d, 'iso'));
      expect(paths.every(p => p.length > 0)).toBe(true);
      expect(new Set(paths).size).toBe(1);
    });
  }

  it('keeps the periods apart from each other', () => {
    const day = '2026-09-09';
    const paths = [
      periodNotePath('day', DEFAULT_DAILY_NOTE, day, 'iso'),
      periodNotePath('week', DEFAULT_WEEK_NOTE, day, 'iso'),
      periodNotePath('month', DEFAULT_MONTH_NOTE, day, 'iso'),
      periodNotePath('quarter', DEFAULT_QUARTER_NOTE, day, 'iso'),
    ];
    expect(new Set(paths).size).toBe(4);
  });

  it('routes a day through the daily note rules, unchanged', () => {
    // Existing daily notes must not move: the day case has to agree with the
    // function that has always built those paths.
    expect(periodNotePath('day', DEFAULT_DAILY_NOTE, '2026-09-09', 'iso')).toBe(
      'Note/Daily/2026/09-September/2026-09-09.note',
    );
  });

  it('produces the paths the defaults promise', () => {
    expect(periodNotePath('week', DEFAULT_WEEK_NOTE, '2026-09-09', 'iso')).toBe(
      'Note/Weekly/2026/W37.note',
    );
    expect(periodNotePath('month', DEFAULT_MONTH_NOTE, '2026-09-09', 'iso')).toBe(
      'Note/Monthly/2026/09-September.note',
    );
    expect(periodNotePath('quarter', DEFAULT_QUARTER_NOTE, '2026-09-09', 'iso')).toBe(
      'Note/Quarterly/2026/Q3.note',
    );
  });

  it('returns nothing for a date it cannot parse', () => {
    expect(periodNotePath('week', DEFAULT_WEEK_NOTE, 'not-a-date', 'iso')).toBe('');
    expect(periodStart('week', '')).toBe('');
  });
});

describe('layout tokens', () => {
  it('numbers a week within the year its Sunday falls in', () => {
    // 1 January 2026 is a Thursday, so its week began on Sunday 28 December
    // 2025 and the note is filed as 2025 W53 — not 2026 W1. That is the point
    // of anchoring on the start: {YYYY} and {WW} in a layout can never disagree
    // with each other, which they would if the year came from the Thursday and
    // the week number from the Sunday.
    expect(weekNumber('2026-01-01')).toBe(53);
    expect(periodStart('week', '2026-01-01')).toBe('2025-12-28');
    expect(periodNotePath('week', DEFAULT_WEEK_NOTE, '2026-01-01', 'iso')).toBe(
      'Note/Weekly/2025/W53.note',
    );

    // The first week wholly inside 2026 starts on Sunday 4 January.
    expect(weekNumber('2026-01-04')).toBe(2);
    expect(weekNumber('2026-09-09')).toBe(37);
  });

  it('still gives the straddling week one note, not two', () => {
    const before = periodNotePath('week', DEFAULT_WEEK_NOTE, '2025-12-31', 'iso');
    const after = periodNotePath('week', DEFAULT_WEEK_NOTE, '2026-01-02', 'iso');
    expect(before).toBe(after);
  });

  it('expands the tokens each period offers', () => {
    expect(expandPeriodLayout('week', '{YYYY}/W{WW}', '2026-09-09', 'iso')).toBe('2026/W37');
    expect(expandPeriodLayout('quarter', '{YYYY}/{QQ} {MMM}-{MMM_END}', '2026-08-20', 'iso')).toBe(
      '2026/Q3 Jul-Sep',
    );
    expect(expandPeriodLayout('week', '{YYYY}/Week of {START}', '2026-09-09', 'iso')).toBe(
      '2026/Week of 2026-09-06',
    );
    expect(expandPeriodLayout('month', '{YYYY}-{MM}', '2026-09-09', 'iso')).toBe('2026-09');
  });

  it('never lets a formatted date become extra folders', () => {
    // A US display format would otherwise turn one segment into three.
    const path = expandPeriodLayout('week', '{YYYY}/Week of {START}', '2026-09-09', 'us');
    expect(path.split('/')).toHaveLength(2);
  });

  it('offers presets that all produce a usable path', () => {
    for (const [period, presets] of Object.entries(PERIOD_LAYOUT_PRESETS)) {
      for (const preset of presets) {
        const path = periodNotePath(
          period as Period,
          {enabled: true, root: 'Note/X', layout: preset.layout, template: ''},
          '2026-09-09',
          'iso',
        );
        expect(path.endsWith('.note')).toBe(true);
        expect(path.startsWith('Note/X/')).toBe(true);
      }
    }
  });
});

describe('finding an existing note', () => {
  it('matches a note already on the device, whatever the slash style', () => {
    const path = periodNotePath('week', DEFAULT_WEEK_NOTE, '2026-09-09', 'iso');
    expect(hasPeriodNote([path], 'week', DEFAULT_WEEK_NOTE, '2026-09-09', 'iso')).toBe(true);
    expect(
      hasPeriodNote([path.replace(/\//g, '\\')], 'week', DEFAULT_WEEK_NOTE, '2026-09-09', 'iso'),
    ).toBe(true);
    expect(
      hasPeriodNote([path.toUpperCase()], 'week', DEFAULT_WEEK_NOTE, '2026-09-09', 'iso'),
    ).toBe(true);
  });

  it('says no when nothing matches', () => {
    expect(hasPeriodNote([], 'week', DEFAULT_WEEK_NOTE, '2026-09-09', 'iso')).toBe(false);
    expect(
      hasPeriodNote(['Note/Weekly/2026/W36.note'], 'week', DEFAULT_WEEK_NOTE, '2026-09-09', 'iso'),
    ).toBe(false);
  });

  it('recognises another day of the same week as the same note', () => {
    const path = periodNotePath('week', DEFAULT_WEEK_NOTE, '2026-09-06', 'iso');
    expect(hasPeriodNote([path], 'week', DEFAULT_WEEK_NOTE, '2026-09-11', 'iso')).toBe(true);
  });
});

describe('how a period reads', () => {
  it('names each period the way it would be said aloud', () => {
    expect(periodLabel('week', '2026-09-09', 'iso')).toBe('week of 2026-09-06');
    expect(periodLabel('month', '2026-09-09', 'iso')).toBe('September 2026');
    expect(periodLabel('quarter', '2026-09-09', 'iso')).toBe('Q3 2026');
    expect(periodLabel('day', '2026-09-09', 'iso')).toBe('2026-09-09');
  });
});

describe('the year period', () => {
  it('gives every day of a year the same note', () => {
    expect(periodStart('year', '2026-01-01')).toBe('2026-01-01');
    expect(periodStart('year', '2026-12-31')).toBe('2026-01-01');
    expect(periodEnd('year', '2026-06-15')).toBe('2026-12-31');
    expect(periodLabel('year', '2026-06-15', 'iso')).toBe('2026');
  });

  it('files it where the default promises', () => {
    expect(periodNotePath('year', DEFAULT_YEAR_NOTE, '2026-06-15', 'iso')).toBe(
      'Note/Yearly/2026.note',
    );
  });
});

describe('the enable switches', () => {
  it('starts every kind of note switched on', () => {
    // A user who has never seen these settings should find the plugin behaving
    // exactly as it did before they existed.
    for (const config of [
      DEFAULT_WEEK_NOTE,
      DEFAULT_MONTH_NOTE,
      DEFAULT_QUARTER_NOTE,
      DEFAULT_YEAR_NOTE,
    ]) {
      expect(config.enabled).toBe(true);
    }
    expect(DEFAULT_DAILY_NOTE.enabled).toBe(true);
  });

  it('does not change where a note is filed', () => {
    // The switch decides whether the button is offered, not the path.
    const on = {...DEFAULT_WEEK_NOTE, enabled: true};
    const off = {...DEFAULT_WEEK_NOTE, enabled: false};
    expect(periodNotePath('week', off, '2026-09-09', 'iso')).toBe(
      periodNotePath('week', on, '2026-09-09', 'iso'),
    );
  });
});
