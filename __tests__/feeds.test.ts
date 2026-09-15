import {
  addFeed,
  defaultFeedName,
  feedNameFromIcal,
  mergeFeeds,
  normaliseFeedUrl,
  parseFeedList,
  pickFeedListFile,
  removeFeed,
  sameFeed,
  type CalendarFeed,
} from '../src/feeds';

const GOOGLE = 'https://calendar.google.com/calendar/ical/abc123/private-xyz/basic.ics';

describe('normaliseFeedUrl', () => {
  it('accepts an https address', () => {
    expect(normaliseFeedUrl(` ${GOOGLE} `).url).toBe(GOOGLE);
  });

  it('upgrades webcal, which is https underneath', () => {
    // Calendar apps advertise webcal:// links; a user who copied the one their
    // provider offered should not have to know to rewrite it.
    expect(normaliseFeedUrl('webcal://example.com/cal.ics').url).toBe(
      'https://example.com/cal.ics',
    );
    expect(normaliseFeedUrl('WEBCAL://example.com/cal.ics').url).toBe(
      'https://example.com/cal.ics',
    );
  });

  it('refuses plaintext, because the address is the credential', () => {
    expect(normaliseFeedUrl('http://example.com/cal.ics').error).toBe('insecure');
  });

  it('refuses what is not an address at all', () => {
    expect(normaliseFeedUrl('').error).toBe('empty');
    expect(normaliseFeedUrl('   ').error).toBe('empty');
    expect(normaliseFeedUrl('my calendar').error).toBe('malformed');
    expect(normaliseFeedUrl('https://').error).toBe('malformed');
    // A bare hostname with no dot is far more likely a typo than a real host.
    expect(normaliseFeedUrl('https://localhost/cal.ics').error).toBe('malformed');
  });
});

describe('defaultFeedName', () => {
  it('uses the host, since the path is usually opaque', () => {
    expect(defaultFeedName(GOOGLE)).toBe('calendar.google.com');
    expect(defaultFeedName('https://www.example.com/x.ics')).toBe('example.com');
  });

  it('never comes back empty', () => {
    expect(defaultFeedName('nonsense')).toBe('Subscribed calendar');
  });
});

describe('feedNameFromIcal', () => {
  it('reads the calendar name every provider writes', () => {
    expect(feedNameFromIcal('BEGIN:VCALENDAR\r\nX-WR-CALNAME:Work\r\nEND:VCALENDAR')).toBe(
      'Work',
    );
  });

  it('copes with parameters and escaped commas', () => {
    expect(feedNameFromIcal('X-WR-CALNAME;VALUE=TEXT:Home\\, personal')).toBe(
      'Home, personal',
    );
  });

  it('is blank when the feed does not say, leaving the stored name alone', () => {
    expect(feedNameFromIcal('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe('');
    expect(feedNameFromIcal('')).toBe('');
  });
});

describe('parseFeedList', () => {
  it('reads named and bare lines', () => {
    const {feeds} = parseFeedList(
      [`Business|${GOOGLE}`, 'https://example.com/x.ics'].join('\n'),
    );
    expect(feeds).toEqual([
      {url: GOOGLE, name: 'Business'},
      {url: 'https://example.com/x.ics', name: 'example.com'},
    ]);
  });

  it('skips blanks and comments', () => {
    const {feeds, skipped} = parseFeedList(`\n# a comment\n\n${GOOGLE}\n`);
    expect(feeds).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it('skips a bad line rather than discarding the file', () => {
    // One typo should not cost somebody the other nine calendars.
    const {feeds, skipped} = parseFeedList(
      ['not a url', `Good|${GOOGLE}`, 'http://insecure.example/x.ics'].join('\n'),
    );
    expect(feeds.map(f => f.name)).toEqual(['Good']);
    expect(skipped).toBe(2);
  });

  it('splits on the last bar, so a name may contain one', () => {
    // A URL cannot hold an unescaped bar; a calendar name readily can.
    const {feeds} = parseFeedList(`Work | Home|${GOOGLE}`);
    expect(feeds[0]).toEqual({url: GOOGLE, name: 'Work | Home'});
  });
});

describe('the stored list', () => {
  const a: CalendarFeed = {url: GOOGLE, name: 'Business'};
  const b: CalendarFeed = {url: 'https://example.com/x.ics', name: 'Other'};

  it('adds, and renames rather than duplicating', () => {
    expect(addFeed([a], b)).toHaveLength(2);
    const renamed = addFeed([a], {url: GOOGLE, name: 'Work'});
    expect(renamed).toHaveLength(1);
    expect(renamed[0].name).toBe('Work');
  });

  it('compares ignoring a trailing slash', () => {
    expect(sameFeed('https://e.com/x/', 'https://e.com/x')).toBe(true);
    expect(sameFeed('https://e.com/x', 'https://e.com/y')).toBe(false);
  });

  it('removes', () => {
    expect(removeFeed([a, b], GOOGLE)).toEqual([b]);
  });

  it('merges an import, counting only what was new', () => {
    const {feeds, added} = mergeFeeds([a], [a, b]);
    expect(feeds).toHaveLength(2);
    expect(added).toBe(1);
  });
});

describe('reading a real setup file', () => {
  it('survives the byte-order mark Windows Notepad writes', () => {
    // Invisible, and it makes the first line fail ^https:// — so the commonest
    // way to produce this file is also the one that silently breaks it.
    const {feeds} = parseFeedList(`﻿${GOOGLE}`);
    expect(feeds).toHaveLength(1);
  });

  it('quotes back the first line it could not use', () => {
    const {firstBad} = parseFeedList(['# note', 'Work|not-a-url', GOOGLE].join('\n'));
    expect(firstBad).toBe('Work|not-a-url');
  });

  it('reports no bad line when every line was fine', () => {
    expect(parseFeedList(GOOGLE).firstBad).toBeUndefined();
  });
});

describe('pickFeedListFile', () => {
  it('prefers the documented name, whatever its case', () => {
    expect(pickFeedListFile(['notes.txt', 'Calendars.TXT'], 'calendars.txt')).toBe(
      'Calendars.TXT',
    );
  });

  it('takes the only text file when the name does not match', () => {
    // Somebody who put one .txt in the folder meant that one.
    expect(pickFeedListFile(['my-feeds.txt'], 'calendars.txt')).toBe('my-feeds.txt');
  });

  it('refuses to guess between several', () => {
    expect(pickFeedListFile(['a.txt', 'b.txt'], 'calendars.txt')).toBe('');
  });

  it('ignores files that are not text', () => {
    expect(pickFeedListFile(['settings.json', 'cache.json'], 'calendars.txt')).toBe('');
  });
});
