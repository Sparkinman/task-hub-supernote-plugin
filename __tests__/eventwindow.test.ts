import {
  caldavStamp,
  covers,
  defaultWindow,
  gap,
  mergeFetched,
  viewRange,
  widen,
  WINDOW_BACK_MONTHS,
  WINDOW_FORWARD_MONTHS,
  type DateRange,
} from '../src/eventwindow';

describe('defaultWindow', () => {
  it('reaches back and forward by whole months', () => {
    expect(defaultWindow('2026-09-14')).toEqual({start: '2026-06-01', end: '2027-10-01'});
  });

  it('rolls the year at both ends', () => {
    expect(defaultWindow('2026-01-15')).toEqual({start: '2025-10-01', end: '2027-02-01'});
    expect(defaultWindow('2026-12-31')).toEqual({start: '2026-09-01', end: '2028-01-01'});
  });

  it('spans the months the constants promise', () => {
    // A guard on the constants themselves: a window that quietly stopped
    // reaching a year ahead would only show up as a slow year view.
    const w = defaultWindow('2026-06-15');
    expect(w.start).toBe('2026-03-01');
    expect(Number(w.end.slice(0, 4)) * 12 + Number(w.end.slice(5, 7))).toBe(
      2026 * 12 + 6 + WINDOW_FORWARD_MONTHS + 1,
    );
    expect(Number(w.start.slice(0, 4)) * 12 + Number(w.start.slice(5, 7))).toBe(
      2026 * 12 + 6 - WINDOW_BACK_MONTHS,
    );
  });
});

describe('viewRange', () => {
  it('asks for the whole year in the year view', () => {
    expect(viewRange('year', '2026-09-14')).toEqual({start: '2026-01-01', end: '2027-01-01'});
  });

  it('asks for the containing quarter, whichever day of it is selected', () => {
    for (const day of ['2026-07-01', '2026-08-20', '2026-09-30']) {
      expect(viewRange('quarter', day)).toEqual({start: '2026-07-01', end: '2026-10-01'});
    }
    expect(viewRange('quarter', '2026-01-05')).toEqual({start: '2026-01-01', end: '2026-04-01'});
    expect(viewRange('quarter', '2026-12-05')).toEqual({start: '2026-10-01', end: '2027-01-01'});
  });

  it('pads the month view by a month either side for the grid overhang', () => {
    // The 42-cell grid draws the tail of the previous month and the head of the
    // next, and those cells carry event marks.
    expect(viewRange('month', '2026-09-14')).toEqual({start: '2026-08-01', end: '2026-11-01'});
    expect(viewRange('month', '2026-01-14')).toEqual({start: '2025-12-01', end: '2026-03-01'});
  });

  it('asks only for the containing month in the day and week views', () => {
    expect(viewRange('day', '2026-09-14')).toEqual({start: '2026-09-01', end: '2026-10-01'});
    expect(viewRange('week', '2026-12-30')).toEqual({start: '2026-12-01', end: '2027-01-01'});
  });

  it('never needs widening for the views the default window opens on', () => {
    // The point of judging coverage per view: a whole-year rule would widen the
    // window the instant the plugin opened in the second half of the year.
    const today = '2026-09-14';
    const w = defaultWindow(today);
    for (const view of ['day', 'week', 'month', 'quarter'] as const) {
      expect(covers(w, viewRange(view, today))).toBe(true);
    }
  });
});

describe('covers', () => {
  const w: DateRange = {start: '2026-06-01', end: '2027-10-01'};

  it('accepts a range wholly inside, including the exact edges', () => {
    expect(covers(w, {start: '2026-06-01', end: '2027-10-01'})).toBe(true);
    expect(covers(w, {start: '2026-08-01', end: '2026-09-01'})).toBe(true);
  });

  it('rejects a range that runs past either edge', () => {
    expect(covers(w, {start: '2026-05-01', end: '2026-07-01'})).toBe(false);
    expect(covers(w, {start: '2027-09-01', end: '2027-11-01'})).toBe(false);
  });
});

describe('widen', () => {
  const w: DateRange = {start: '2026-06-01', end: '2027-10-01'};

  it('extends backwards with a month of margin', () => {
    expect(widen(w, {start: '2026-01-01', end: '2027-01-01'})).toEqual({
      start: '2025-12-01',
      end: '2027-10-01',
    });
  });

  it('extends forwards with a month of margin', () => {
    expect(widen(w, {start: '2028-01-01', end: '2029-01-01'})).toEqual({
      start: '2026-06-01',
      end: '2029-02-01',
    });
  });

  it('leaves an already-covered range alone', () => {
    expect(widen(w, {start: '2026-08-01', end: '2026-09-01'})).toEqual(w);
  });

  it('gives the margin that stops month-by-month paging refetching each step', () => {
    // Step off the back edge once, then keep stepping: the margin has to absorb
    // the next step rather than triggering a second fetch.
    const once = widen(w, viewRange('month', '2026-06-15'));
    expect(covers(once, viewRange('month', '2026-05-15'))).toBe(true);
  });
});

describe('gap', () => {
  const previous: DateRange = {start: '2026-06-01', end: '2027-10-01'};

  it('is the new stretch at the back when only the back grew', () => {
    const next = {start: '2025-12-01', end: '2027-10-01'};
    expect(gap(previous, next)).toEqual({start: '2025-12-01', end: '2026-06-01'});
  });

  it('is the new stretch at the front when only the front grew', () => {
    const next = {start: '2026-06-01', end: '2029-02-01'};
    expect(gap(previous, next)).toEqual({start: '2027-10-01', end: '2029-02-01'});
  });

  it('falls back to the whole window when both edges grew', () => {
    // Two fetches would be slower than one, so the whole thing is refetched.
    const next = {start: '2025-01-01', end: '2029-01-01'};
    expect(gap(previous, next)).toEqual(next);
  });

  it('never overlaps what was already held', () => {
    const next = widen(previous, {start: '2024-01-01', end: '2024-06-01'});
    expect(gap(previous, next).end).toBe(previous.start);
  });
});

describe('caldavStamp', () => {
  it('is RFC 4791 basic-format UTC', () => {
    expect(caldavStamp('2026-06-01')).toBe('20260601T000000Z');
    expect(caldavStamp('2026-12-31')).toBe('20261231T000000Z');
  });
});

describe('mergeFetched', () => {
  const key = (e: {id: string}) => e.id;
  const order = (a: {at: number}, b: {at: number}) => a.at - b.at;

  it('keeps both sides and sorts the result', () => {
    const merged = mergeFetched(
      [{id: 'a', at: 3}],
      [{id: 'b', at: 1}],
      key,
      order,
    );
    expect(merged.map(e => e.id)).toEqual(['b', 'a']);
  });

  it('prefers the incoming copy of anything in both', () => {
    // A repeating event matches every range it recurs into, so it comes back
    // from each fetch; the later fetch is the fresher copy.
    const merged = mergeFetched(
      [{id: 'a', at: 1, from: 'cache'}],
      [{id: 'a', at: 1, from: 'server'}],
      key,
      order,
    );
    expect(merged).toEqual([{id: 'a', at: 1, from: 'server'}]);
  });

  it('does not mutate either input', () => {
    const existing = [{id: 'a', at: 2}];
    const incoming = [{id: 'b', at: 1}];
    mergeFetched(existing, incoming, key, order);
    expect(existing).toEqual([{id: 'a', at: 2}]);
    expect(incoming).toEqual([{id: 'b', at: 1}]);
  });
});
