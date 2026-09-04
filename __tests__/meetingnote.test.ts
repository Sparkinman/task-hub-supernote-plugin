import {
  DEFAULT_MEETING_NOTE,
  eventsWithNotes,
  legacyMeetingPath,
  meetingNotePath,
  proposeMeetingPath,
  safeTitle,
  type MeetingNoteConfig,
} from '../src/meetingnote';
import {isoWeek} from '../src/components/MiniCalendar';
import type {VEvent} from '../src/ical';

const cfg = (over: Partial<MeetingNoteConfig> = {}): MeetingNoteConfig => ({
  ...DEFAULT_MEETING_NOTE,
  ...over,
});

const event = (over: Partial<VEvent>): VEvent => ({
  uid: 'evt-1',
  summary: 'Standup',
  startDate: '2026-09-02',
  startAt: new Date(2026, 8, 2).getTime(),
  allDay: true,
  recurring: false,
  ...over,
});

describe('safeTitle', () => {
  it('strips characters a filename cannot hold', () => {
    expect(safeTitle('Q3/Q4: plan?')).toBe('Q3-Q4- plan-');
  });

  it('falls back when the title is empty or whitespace', () => {
    expect(safeTitle('')).toBe('Meeting');
    expect(safeTitle('   ')).toBe('Meeting');
  });
});

describe('proposeMeetingPath', () => {
  it('names a repeating meeting by title alone, with no date', () => {
    const path = proposeMeetingPath(cfg(), event({recurring: true, summary: 'Team sync'}), []);
    expect(path).toBe('Note/Meetings/Team sync.note');
  });

  it('dates a one-off meeting so two of the same name stay tellable apart', () => {
    const a = proposeMeetingPath(
      cfg(),
      event({uid: 'a', summary: 'Client call', startDate: '2026-09-02'}),
      [],
    );
    const b = proposeMeetingPath(
      cfg(),
      event({uid: 'b', summary: 'Client call', startDate: '2026-10-14'}),
      [a],
    );
    expect(a).toBe('Note/Meetings/Client call 2026-09-02.note');
    expect(b).toBe('Note/Meetings/Client call 2026-10-14.note');
    expect(a).not.toBe(b);
  });

  it('adds a numeric suffix only when a name is genuinely taken', () => {
    const first = proposeMeetingPath(cfg(), event({recurring: true, summary: 'Standup'}), []);
    const second = proposeMeetingPath(
      cfg(),
      event({uid: 'other', recurring: true, summary: 'Standup'}),
      [first],
    );
    expect(first).toBe('Note/Meetings/Standup.note');
    expect(second).toBe('Note/Meetings/Standup (2).note');
  });

  it('is empty when the event has no UID', () => {
    expect(proposeMeetingPath(cfg(), event({uid: ''}), [])).toBe('');
  });
});

describe('meetingNotePath', () => {
  it('resolves through the link map', () => {
    const e = event({uid: 'evt-9'});
    const links = {'evt-9': 'Note/Meetings/Whatever I named it.note'};
    expect(meetingNotePath(cfg(), e, links)).toBe('Note/Meetings/Whatever I named it.note');
  });

  it('gives every occurrence of a recurring event the SAME note', () => {
    const links = {'evt-1': 'Note/Meetings/Team sync.note'};
    const first = meetingNotePath(cfg(), event({startDate: '2026-09-02'}), links);
    const later = meetingNotePath(cfg(), event({startDate: '2026-10-07'}), links);
    expect(first).toBe(later);
  });

  it('falls back to the pre-0.17 hashed name so old notes still open', () => {
    const e = event({uid: 'legacy-1', summary: 'Old meeting'});
    const legacy = legacyMeetingPath(cfg(), e);
    expect(meetingNotePath(cfg(), e, {}, [legacy])).toBe(legacy);
  });

  it('is empty when nothing is linked and no legacy file exists', () => {
    expect(meetingNotePath(cfg(), event({}), {}, [])).toBe('');
  });
});

describe('eventsWithNotes', () => {
  it('reports only events whose linked note exists on disk', () => {
    const a = event({uid: 'a', summary: 'Alpha'});
    const b = event({uid: 'b', summary: 'Beta'});
    const links = {a: 'Note/Meetings/Alpha.note', b: 'Note/Meetings/Beta.note'};
    const found = eventsWithNotes(['Note/Meetings/Alpha.note'], [a, b], cfg(), links);
    expect([...found]).toEqual(['a']);
  });

  it('matches case-insensitively and tolerates backslashes', () => {
    const a = event({uid: 'a', summary: 'Alpha'});
    const links = {a: 'Note/Meetings/Alpha.note'};
    expect(
      eventsWithNotes(['NOTE\\MEETINGS\\ALPHA.NOTE'], [a], cfg(), links).has('a'),
    ).toBe(true);
  });

  it('ignores unrelated notes in the same folder', () => {
    const a = event({uid: 'a'});
    expect(eventsWithNotes(['Note/Meetings/Random.note'], [a], cfg(), {}).size).toBe(0);
  });
});

describe('isoWeek', () => {
  it('numbers a mid-year week', () => {
    expect(isoWeek('2026-09-02')).toBe(36);
  });

  it('gives the same number to every day of one week', () => {
    const week = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
    expect(new Set(week.map(isoWeek)).size).toBe(1);
  });

  it('starts the year at week 1', () => {
    expect(isoWeek('2026-01-05')).toBe(2);
  });
});
