/**
 * A zoned event must land on the instant it names, not on its clock face.
 *
 * The bug: `DTSTART;TZID=America/New_York:20260921T120000` was read as noon
 * wherever the device happened to be, so a meeting booked by an Eastern
 * colleague showed at noon on a Mountain device — two hours late. All-day
 * events were right, because `VALUE=DATE` carries no zone to get wrong.
 *
 * These assertions are written to be non-vacuous **in the suite's own zone**.
 * `jest.config.js` pins it to `America/New_York` and says why setting it
 * anywhere later is useless: Node caches the zone at startup. So an event in
 * New York proves nothing here — reading its clock face as local is accidentally
 * correct. Every case below is therefore zoned somewhere that is *not* New York,
 * or asserts an absolute instant, which no device zone can change.
 */
import {parseVEvents, parseVTodos} from '../src/ical';
import {parseFeedBody} from '../src/feeds';
import {instantInZone, offsetAt, parseTimezones} from '../src/vtimezone';

/** The block Google ships with every Eastern event, verbatim in shape. */
const NEW_YORK = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:20001029T030000
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10;UNTIL=20061029T070000Z
TZNAME:EST
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
END:STANDARD
BEGIN:STANDARD
DTSTART:20071104T030000
RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11
TZNAME:EST
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:20000402T020000
RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=4;UNTIL=20060402T070000Z
TZNAME:EDT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
END:DAYLIGHT
BEGIN:DAYLIGHT
DTSTART:20070311T020000
RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3
TZNAME:EDT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
END:DAYLIGHT
END:VTIMEZONE`;

const DENVER = NEW_YORK.replace('TZID:America/New_York', 'TZID:America/Denver')
  .replace(/TZOFFSETFROM:-0400/g, 'TZOFFSETFROM:-0600')
  .replace(/TZOFFSETTO:-0500/g, 'TZOFFSETTO:-0700')
  .replace(/TZOFFSETFROM:-0500/g, 'TZOFFSETFROM:-0700')
  .replace(/TZOFFSETTO:-0400/g, 'TZOFFSETTO:-0600');

function object(zone: string, body: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${zone.replace(/\n/g, '\r\n')}\r\nBEGIN:VEVENT\r\n${body}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
}

describe('reading a VTIMEZONE', () => {
  it('finds both halves of the zone', () => {
    const table = parseTimezones(NEW_YORK);
    expect(Object.keys(table)).toEqual(['America/New_York']);
    expect(table['America/New_York']).toHaveLength(4);
  });

  it('is on daylight time in September and standard time in January', () => {
    const rules = parseTimezones(NEW_YORK)['America/New_York'];
    expect(offsetAt(rules, Date.UTC(2026, 8, 21, 12, 0))).toBe(-240);
    expect(offsetAt(rules, Date.UTC(2026, 0, 21, 12, 0))).toBe(-300);
  });

  it('changes over on the right days', () => {
    const rules = parseTimezones(NEW_YORK)['America/New_York'];
    // Second Sunday in March 2026 is the 8th; first Sunday in November is the 1st.
    expect(offsetAt(rules, Date.UTC(2026, 2, 7, 12, 0))).toBe(-300);
    expect(offsetAt(rules, Date.UTC(2026, 2, 9, 12, 0))).toBe(-240);
    expect(offsetAt(rules, Date.UTC(2026, 10, 1, 12, 0))).toBe(-300);
  });

  it('honours a rule that has expired', () => {
    // Under the pre-2007 rules daylight time began in April, so the last week
    // of March 2005 was still standard time. Getting this wrong would mean the
    // UNTIL is being ignored and the current rule applied to history.
    const rules = parseTimezones(NEW_YORK)['America/New_York'];
    expect(offsetAt(rules, Date.UTC(2005, 2, 20, 12, 0))).toBe(-300);
    expect(offsetAt(rules, Date.UTC(2005, 4, 20, 12, 0))).toBe(-240);
  });

  it('says nothing about a zone it was never given', () => {
    expect(offsetAt(parseTimezones(NEW_YORK)['Europe/Paris'], Date.UTC(2026, 8, 21))).toBeNull();
    expect(instantInZone(parseTimezones(NEW_YORK), 'Europe/Paris', 2026, 9, 21, 12, 0)).toBeNull();
  });

  it('places the reported meeting on the instant it actually happened', () => {
    // Noon in New York on 21 September 2026 is 16:00 UTC, which is ten o'clock
    // in Denver. This is the exact case that was showing as noon on a Mountain
    // device. Asserted as an instant because no device zone can change it.
    expect(instantInZone(parseTimezones(NEW_YORK), 'America/New_York', 2026, 9, 21, 12, 0)).toBe(
      Date.UTC(2026, 8, 21, 16, 0),
    );
  });
});

describe('a zoned event', () => {
  it('is shown in the reader own zone, not the sender own', () => {
    // Ten o'clock in Denver is noon in New York, which is where the suite runs.
    // The old behaviour printed 10:00 here, so this fails without the fix.
    const [event] = parseVEvents(
      object(DENVER, 'UID:a@example.com\r\nSUMMARY:Cross-country call\r\nDTSTART;TZID=America/Denver:20260921T100000\r\nDTEND;TZID=America/Denver:20260921T110000'),
    );
    expect(event.startAt).toBe(Date.UTC(2026, 8, 21, 16, 0));
    expect(event.startDate).toBe('2026-09-21');
    expect(event.startTime).toBe('12:00');
    expect(event.endTime).toBe('13:00');
    expect(event.allDay).toBe(false);
  });

  it('accepts a quoted zone name', () => {
    const [event] = parseVEvents(
      object(DENVER, 'UID:b@example.com\r\nSUMMARY:Quoted\r\nDTSTART;TZID="America/Denver":20260921T100000'),
    );
    expect(event.startTime).toBe('12:00');
  });

  it('crosses midnight into the right day', () => {
    // Eleven at night in Denver is one in the morning the next day in New York.
    const [event] = parseVEvents(
      object(DENVER, 'UID:c@example.com\r\nSUMMARY:Late\r\nDTSTART;TZID=America/Denver:20260921T230000'),
    );
    expect(event.startDate).toBe('2026-09-22');
    expect(event.startTime).toBe('01:00');
  });

  it('follows the zone across its own daylight change', () => {
    // January: Denver is two hours behind New York in winter as well, but the
    // offset comes from the STANDARD rule rather than the DAYLIGHT one.
    const [event] = parseVEvents(
      object(DENVER, 'UID:d@example.com\r\nSUMMARY:Winter\r\nDTSTART;TZID=America/Denver:20260115T100000'),
    );
    expect(event.startAt).toBe(Date.UTC(2026, 0, 15, 17, 0));
    expect(event.startTime).toBe('12:00');
  });
});

describe('what must not change', () => {
  it('leaves an all-day event on its own date', () => {
    const [event] = parseVEvents(
      object(DENVER, 'UID:e@example.com\r\nSUMMARY:All day\r\nDTSTART;VALUE=DATE:20260921'),
    );
    expect(event.allDay).toBe(true);
    expect(event.startDate).toBe('2026-09-21');
    expect(event.startTime).toBeUndefined();
  });

  it('still reads a UTC instant as UTC', () => {
    const [event] = parseVEvents(
      object(DENVER, 'UID:f@example.com\r\nSUMMARY:Zulu\r\nDTSTART:20260921T160000Z'),
    );
    expect(event.startAt).toBe(Date.UTC(2026, 8, 21, 16, 0));
    expect(event.startTime).toBe('12:00');
  });

  it('still treats a floating time as the device own', () => {
    const [event] = parseVEvents(
      object(DENVER, 'UID:g@example.com\r\nSUMMARY:Floating\r\nDTSTART:20260921T100000'),
    );
    expect(event.startTime).toBe('10:00');
  });

  it('falls back to the old behaviour for a zone the file never described', () => {
    // No VTIMEZONE at all. Inventing an offset here would be worse than the
    // clock face: this is the one case where the previous behaviour is kept.
    const [event] = parseVEvents(
      'BEGIN:VEVENT\r\nUID:h@example.com\r\nSUMMARY:Unknown zone\r\nDTSTART;TZID=Mars/Olympus:20260921T100000\r\nEND:VEVENT',
    );
    expect(event.startTime).toBe('10:00');
  });
});

describe('a task due in another zone', () => {
  it('is due at the instant it says', () => {
    const [todo] = parseVTodos(
      `BEGIN:VCALENDAR\r\n${DENVER.replace(/\n/g, '\r\n')}\r\nBEGIN:VTODO\r\nUID:i@example.com\r\nSUMMARY:Call back\r\nDUE;TZID=America/Denver:20260921T100000\r\nEND:VTODO\r\nEND:VCALENDAR`,
    );
    expect(todo.dueAt).toBe(Date.UTC(2026, 8, 21, 16, 0));
    expect(todo.dueTime).toBe('12:00');
  });

  it('leaves an all-day due date alone', () => {
    const [todo] = parseVTodos(
      'BEGIN:VTODO\r\nUID:j@example.com\r\nSUMMARY:Someday\r\nDUE;VALUE=DATE:20260921\r\nEND:VTODO',
    );
    expect(todo.dueDate).toBe('2026-09-21');
    expect(todo.dueTime).toBeUndefined();
  });
});

describe('a feed, which is parsed in chunks', () => {
  /**
   * The zone is defined once at the top of the file and referred to by every
   * event in it. Chunked parsing cuts the two apart, so the header is read
   * separately and handed to each chunk — without that, everything past the
   * first few hundred events silently reverts to the old bug.
   */
  it('applies the header zone to an event far down the file', async () => {
    const events = Array.from({length: 400}, (_, i) =>
      `BEGIN:VEVENT\r\nUID:${i}@example.com\r\nSUMMARY:Event ${i}\r\nDTSTART;TZID=America/Denver:20260921T100000\r\nEND:VEVENT`,
    ).join('\r\n');
    const parsed = await parseFeedBody(
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${DENVER.replace(/\n/g, '\r\n')}\r\n${events}\r\nEND:VCALENDAR\r\n`,
    );
    expect(parsed).toHaveLength(400);
    for (const event of parsed) {
      expect(event.startTime).toBe('12:00');
    }
  });
});
