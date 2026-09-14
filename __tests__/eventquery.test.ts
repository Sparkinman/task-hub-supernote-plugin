/**
 * What the event listing actually asks the server for.
 *
 * The listing used to request every VEVENT in the collection for all time, and
 * that was the largest single cost in opening the plugin. These cover the
 * narrowed request and, just as importantly, the fallback — a server that will
 * not accept a time-range must give a slow calendar, never an empty one.
 */

jest.mock('../src/permissions', () => ({
  ensureInternet: jest.fn().mockResolvedValue(undefined),
  ensureFileAccess: jest.fn().mockResolvedValue(undefined),
  PermissionDeniedError: class extends Error {},
}));

import {listEvents} from '../src/tasks';
import {EMPTY_CONFIG, type ServerConfig} from '../src/settings';

const CAL = 'https://dav.example/user/cal';
const WINDOW = {start: '2026-06-01', end: '2027-10-01'};

const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  ...EMPTY_CONFIG,
  serverUrl: 'https://dav.example',
  username: 'user',
  password: 'pw',
  calendarUrls: [CAL],
  ...over,
});

const EVENT = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:e1',
  'SUMMARY:Standup',
  'DTSTART;VALUE=DATE:20260910',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const body =
  '<?xml version="1.0"?>' +
  '<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<response><href>/user/cal/e1.ics</href><propstat><status>HTTP/1.1 200 OK</status>' +
  `<prop><getetag>"e1"</getetag><C:calendar-data>${EVENT}</C:calendar-data></prop>` +
  '</propstat></response></multistatus>';

/** Replies in order, recording every request body that was sent. */
function serve(replies: {status: number; body?: string}[]) {
  const sent: string[] = [];
  let n = 0;
  (global as {fetch?: unknown}).fetch = jest.fn(async (_url: string, init: {body: string}) => {
    sent.push(init.body);
    const reply = replies[Math.min(n++, replies.length - 1)];
    return {ok: reply.status < 400, status: reply.status, text: async () => reply.body ?? ''};
  });
  return sent;
}

describe('the event query', () => {
  it('asks for a time-range rather than the whole collection', async () => {
    const sent = serve([{status: 207, body}]);
    await listEvents(config(), WINDOW);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('<C:time-range start="20260601T000000Z" end="20271001T000000Z"/>');
    expect(sent[0]).toContain('name="VEVENT"');
  });

  it('sends the range it was given, not a fixed one', async () => {
    const sent = serve([{status: 207, body}]);
    await listEvents(config(), {start: '2019-01-01', end: '2020-01-01'});
    expect(sent[0]).toContain('start="20190101T000000Z"');
    expect(sent[0]).toContain('end="20200101T000000Z"');
  });

  it('retries unfiltered when the server rejects the time-range', async () => {
    // A calendar that comes back empty would be a far worse regression than a
    // calendar that comes back slowly.
    const sent = serve([{status: 400}, {status: 207, body}]);
    const result = await listEvents(config(), WINDOW);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('<C:time-range');
    expect(sent[1]).not.toContain('<C:time-range');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].summary).toBe('Standup');
  });

  it('does not retry a bad password as though it were a bad filter', async () => {
    // 401 is not a complaint about the query. Asking again only produces a
    // second permission failure to explain.
    const sent = serve([{status: 401}]);
    await expect(listEvents(config(), WINDOW)).rejects.toThrow(/credentials/);
    expect(sent).toHaveLength(1);
  });

  it('does not retry a collection that has gone', async () => {
    const sent = serve([{status: 404}]);
    const result = await listEvents(config(), WINDOW);
    expect(sent).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({kind: 'calendar', status: 404});
  });
});
