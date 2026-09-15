import {parseFeedBody, withinWindow} from '../src/feeds';
import type {VEvent} from '../src/ical';

function ics(events: {uid: string; date: string; rrule?: string}[]): string {
  const body = events
    .map(e =>
      [
        'BEGIN:VEVENT',
        `UID:${e.uid}`,
        `SUMMARY:${e.uid}`,
        `DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`,
        ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
        'END:VEVENT',
      ].join('\r\n'),
    )
    .join('\r\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Work', body, 'END:VCALENDAR'].join(
    '\r\n',
  );
}

describe('parseFeedBody', () => {
  it('reads every event, in order, across chunk boundaries', async () => {
    // Deliberately more than one chunk: the body is cut at END:VEVENT and each
    // piece parsed on its own, so an off-by-one there would drop events.
    const many = Array.from({length: 505}, (_, i) => ({
      uid: `e${i}`,
      date: '2026-06-15',
    }));
    const events = await parseFeedBody(ics(many));
    expect(events).toHaveLength(505);
    expect(events[0].uid).toBe('e0');
    expect(events[504].uid).toBe('e504');
  });

  it('does not need the VCALENDAR wrapper it was cut out of', async () => {
    // Each chunk after the first has no header, which is exactly why this works.
    const bare = ['BEGIN:VEVENT', 'UID:x', 'DTSTART;VALUE=DATE:20260615', 'END:VEVENT'].join(
      '\r\n',
    );
    expect(await parseFeedBody(bare)).toHaveLength(1);
  });

  it('is empty for a calendar with no events', async () => {
    expect(await parseFeedBody(ics([]))).toEqual([]);
  });
});

describe('withinWindow', () => {
  const range = {start: '2026-06-01', end: '2026-09-01'};

  async function parsed(): Promise<VEvent[]> {
    return parseFeedBody(
      ics([
        {uid: 'before', date: '2026-01-10'},
        {uid: 'inside', date: '2026-07-04'},
        {uid: 'after', date: '2026-12-25'},
        {uid: 'old-repeat', date: '2019-03-01', rrule: 'FREQ=WEEKLY'},
      ]),
    );
  }

  it('keeps what falls in the window', async () => {
    const kept = withinWindow(await parsed(), range).map(e => e.uid);
    expect(kept).toContain('inside');
    expect(kept).not.toContain('before');
    expect(kept).not.toContain('after');
  });

  it('keeps a repeating event however old its start', async () => {
    // The master is what the occurrences are derived from. Dropping a 2019
    // stand-up for being old would silently empty the calendar of everything
    // regular.
    expect(withinWindow(await parsed(), range).map(e => e.uid)).toContain('old-repeat');
  });

  it('treats the end of the window as exclusive, as CalDAV does', async () => {
    const events = await parseFeedBody(ics([{uid: 'edge', date: '2026-09-01'}]));
    expect(withinWindow(events, range)).toEqual([]);
    expect(withinWindow(events, {start: '2026-06-01', end: '2026-09-02'})).toHaveLength(1);
  });

  it('keeps everything rather than guessing when the range is nonsense', async () => {
    const events = await parsed();
    expect(withinWindow(events, {start: 'nope', end: 'also nope'})).toHaveLength(
      events.length,
    );
  });
});
