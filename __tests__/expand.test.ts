/**
 * Repeating events, expanded into the days they fall on.
 *
 * The bug this covers: every view buckets events by `startDate`, and the server
 * returns one master VEVENT with an RRULE rather than one object per
 * occurrence — so a weekly stand-up appeared on the day it was created and
 * never again.
 */

import {expandEvents, occurrencesIn, parseRrule} from '../src/expand';
import type {VEvent} from '../src/ical';

const WINDOW = {start: '2026-09-01', end: '2026-10-01'};

const event = (over: Partial<VEvent> = {}): VEvent => ({
  uid: 'e1',
  summary: 'Stand-up',
  startDate: '2026-09-02',
  startTime: '09:00',
  startAt: new Date('2026-09-02T09:00:00').getTime(),
  allDay: false,
  recurring: false,
  ...over,
});

describe('parseRrule', () => {
  it('reads the plain rules the picker writes', () => {
    expect(parseRrule('FREQ=WEEKLY')).toMatchObject({freq: 'WEEKLY', interval: 1});
    expect(parseRrule('FREQ=DAILY')).toMatchObject({freq: 'DAILY'});
    expect(parseRrule('RRULE:FREQ=MONTHLY')).toMatchObject({freq: 'MONTHLY'});
  });

  it('reads interval, count, until and byday', () => {
    const rule = parseRrule('FREQ=WEEKLY;INTERVAL=2;COUNT=5;BYDAY=MO,WE');
    expect(rule).toMatchObject({freq: 'WEEKLY', interval: 2, count: 5, byDay: [1, 3]});
    expect(parseRrule('FREQ=DAILY;UNTIL=20261015T000000Z')).toMatchObject({until: '2026-10-15'});
  });

  it('refuses a rule it cannot honour rather than guessing', () => {
    // Showing an event on the wrong days is worse than showing it only once.
    expect(parseRrule('FREQ=HOURLY')).toBeNull();
    expect(parseRrule('')).toBeNull();
    expect(parseRrule(undefined)).toBeNull();
    expect(parseRrule('BYDAY=MO')).toBeNull();
  });

  it('treats a zero or missing interval as one', () => {
    expect(parseRrule('FREQ=DAILY;INTERVAL=0')).toMatchObject({interval: 1});
    expect(parseRrule('FREQ=DAILY;INTERVAL=x')).toMatchObject({interval: 1});
  });
});

describe('occurrencesIn', () => {
  const rule = (text: string) => parseRrule(text)!;

  it('repeats weekly from the start date', () => {
    expect(occurrencesIn('2026-09-02', rule('FREQ=WEEKLY'), WINDOW)).toEqual([
      '2026-09-02',
      '2026-09-09',
      '2026-09-16',
      '2026-09-23',
      '2026-09-30',
    ]);
  });

  it('honours an interval', () => {
    expect(occurrencesIn('2026-09-02', rule('FREQ=WEEKLY;INTERVAL=2'), WINDOW)).toEqual([
      '2026-09-02',
      '2026-09-16',
      '2026-09-30',
    ]);
  });

  it('stops at UNTIL', () => {
    expect(occurrencesIn('2026-09-02', rule('FREQ=WEEKLY;UNTIL=20260916'), WINDOW)).toEqual([
      '2026-09-02',
      '2026-09-09',
      '2026-09-16',
    ]);
  });

  it('counts from the start of the series, not from the window', () => {
    // COUNT is measured from the first occurrence, so a window that begins
    // mid-series must still know how many came before it.
    const all = occurrencesIn('2026-08-05', rule('FREQ=WEEKLY;COUNT=5'), {
      start: '2026-01-01',
      end: '2027-01-01',
    });
    expect(all).toHaveLength(5);
    expect(all[4]).toBe('2026-09-02');
    // Same rule, window starting in September: only the tail is returned, and
    // the series is still exhausted at five.
    expect(occurrencesIn('2026-08-05', rule('FREQ=WEEKLY;COUNT=5'), WINDOW)).toEqual([
      '2026-09-02',
    ]);
  });

  it('expands the named days of a weekly rule', () => {
    expect(occurrencesIn('2026-09-02', rule('FREQ=WEEKLY;BYDAY=MO,WE,FR'), WINDOW)).toEqual([
      '2026-09-02',
      '2026-09-04',
      '2026-09-07',
      '2026-09-09',
      '2026-09-11',
      '2026-09-14',
      '2026-09-16',
      '2026-09-18',
      '2026-09-21',
      '2026-09-23',
      '2026-09-25',
      '2026-09-28',
      '2026-09-30',
    ]);
  });

  it('never produces a day before the series starts', () => {
    // The named days are generated a whole week at a time, so the week the
    // series begins in can offer days that precede it.
    const days = occurrencesIn('2026-09-02', rule('FREQ=WEEKLY;BYDAY=MO,WE'), WINDOW);
    expect(days.every(d => d >= '2026-09-02')).toBe(true);
  });

  it('keeps a monthly rule on its day of the month', () => {
    expect(
      occurrencesIn('2026-01-31', rule('FREQ=MONTHLY'), {start: '2026-01-01', end: '2026-08-01'}),
    ).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  });

  it('skips a February 29th in common years', () => {
    expect(
      occurrencesIn('2024-02-29', rule('FREQ=YEARLY'), {start: '2024-01-01', end: '2029-01-01'}),
    ).toEqual(['2024-02-29', '2028-02-29']);
  });

  it('drops the days an EXDATE cancels', () => {
    expect(
      occurrencesIn('2026-09-02', rule('FREQ=WEEKLY'), WINDOW, ['2026-09-09', '2026-09-23']),
    ).toEqual(['2026-09-02', '2026-09-16', '2026-09-30']);
  });

  it('terminates on a rule that would otherwise never end', () => {
    const days = occurrencesIn('2020-01-01', rule('FREQ=DAILY'), {
      start: '2020-01-01',
      end: '2030-01-01',
    });
    expect(days.length).toBeGreaterThan(0);
    expect(days.length).toBeLessThanOrEqual(750);
  });
});

describe('expandEvents', () => {
  it('leaves a one-off event exactly as it was', () => {
    const one = event();
    expect(expandEvents([one], WINDOW)).toEqual([one]);
  });

  it('leaves a repeat it cannot read on its own start date', () => {
    // Falling back to the old behaviour beats inventing days.
    const odd = event({recurring: true, rrule: 'FREQ=HOURLY;INTERVAL=3'});
    expect(expandEvents([odd], WINDOW)).toEqual([odd]);
  });

  it('turns one weekly event into a copy per occurrence', () => {
    const weekly = event({recurring: true, rrule: 'FREQ=WEEKLY'});
    const out = expandEvents([weekly], WINDOW);
    expect(out.map(e => e.startDate)).toEqual([
      '2026-09-02',
      '2026-09-09',
      '2026-09-16',
      '2026-09-23',
      '2026-09-30',
    ]);
    expect(out.every(e => e.uid === 'e1')).toBe(true);
    expect(out.every(e => e.summary === 'Stand-up')).toBe(true);
  });

  it('moves startAt with the day, keeping the time of day', () => {
    const weekly = event({recurring: true, rrule: 'FREQ=WEEKLY'});
    const second = expandEvents([weekly], WINDOW)[1];
    expect(second.startAt).toBe(new Date('2026-09-09T09:00:00').getTime());
    expect(second.startTime).toBe('09:00');
  });

  it('marks each copy with the date the series itself starts on', () => {
    // What stops an edit opened from one occurrence rewriting the series'
    // DTSTART to that occurrence's own date and shifting the whole thing.
    const weekly = event({recurring: true, rrule: 'FREQ=WEEKLY'});
    const out = expandEvents([weekly], WINDOW);
    expect(out.every(e => e.occurrence?.seriesStartDate === '2026-09-02')).toBe(true);
    expect(out.every(e => e.occurrence?.seriesStartTime === '09:00')).toBe(true);
  });

  it('drops a series whose occurrences all fall outside the window', () => {
    // Otherwise a stand-up from two years ago lands in a month it is not in.
    const old = event({
      startDate: '2024-01-03',
      recurring: true,
      rrule: 'FREQ=WEEKLY;COUNT=3',
    });
    expect(expandEvents([old], WINDOW)).toEqual([]);
  });

  it('returns everything in time order', () => {
    const weekly = event({uid: 'w', recurring: true, rrule: 'FREQ=WEEKLY'});
    const one = event({uid: 'o', startDate: '2026-09-10', startAt: new Date('2026-09-10T08:00:00').getTime()});
    const out = expandEvents([weekly, one], WINDOW);
    const times = out.map(e => e.startAt);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('does not mutate the events it was given', () => {
    const weekly = event({recurring: true, rrule: 'FREQ=WEEKLY'});
    expandEvents([weekly], WINDOW);
    expect(weekly.startDate).toBe('2026-09-02');
    expect(weekly.occurrence).toBeUndefined();
  });
});
