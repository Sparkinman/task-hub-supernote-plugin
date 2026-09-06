/**
 * A watched collection that has been removed from the server.
 *
 * The bug this covers: every collection was fetched with Promise.all, so one
 * 404 rejected the whole refresh and the user lost tasks, calendars and note
 * scans at once — with only a generic error to explain it.
 */

jest.mock('../src/permissions', () => ({
  ensureInternet: jest.fn().mockResolvedValue(undefined),
  ensureFileAccess: jest.fn().mockResolvedValue(undefined),
  PermissionDeniedError: class extends Error {},
}));

import {listEvents, listTasks, missingMessage, type MissingCollection} from '../src/tasks';
import {EMPTY_CONFIG, type ServerConfig} from '../src/settings';

const config = (over: Partial<ServerConfig>): ServerConfig => ({
  ...EMPTY_CONFIG,
  serverUrl: 'https://dav.example',
  username: 'user',
  password: 'pw',
  ...over,
});

const multistatus = (href: string, ics: string) =>
  '<?xml version="1.0"?>' +
  '<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  `<response><href>${href}</href><propstat><status>HTTP/1.1 200 OK</status>` +
  `<prop><getetag>"e1"</getetag><C:calendar-data>${ics}</C:calendar-data></prop>` +
  '</propstat></response></multistatus>';

const TODO = ['BEGIN:VCALENDAR', 'BEGIN:VTODO', 'UID:t1', 'SUMMARY:Alive', 'END:VTODO', 'END:VCALENDAR'].join(
  '\r\n',
);
const EVENT = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:e1',
  'SUMMARY:Standup',
  'DTSTART;VALUE=DATE:20260910',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

/** Answers each URL from a table, so one list can fail while another works. */
function serve(table: Record<string, {status: number; body?: string}>) {
  (global as {fetch?: unknown}).fetch = jest.fn(async (url: string) => {
    const reply = table[url.replace(/\/+$/, '')];
    if (!reply) {
      throw new Error(`test asked for an unexpected URL: ${url}`);
    }
    return {
      ok: reply.status < 400,
      status: reply.status,
      text: async () => reply.body ?? '',
    };
  });
}

afterEach(() => {
  delete (global as {fetch?: unknown}).fetch;
});

describe('listTasks with a collection that has gone', () => {
  const live = 'https://dav.example/user/live';
  const dead = 'https://dav.example/user/dead';

  it('still returns the surviving list instead of failing the whole refresh', async () => {
    serve({
      [live]: {status: 207, body: multistatus('/user/live/t1.ics', TODO)},
      [dead]: {status: 404},
    });
    const result = await listTasks(config({collectionUrls: [live, dead]}));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].summary).toBe('Alive');
  });

  it('names the dead list rather than swallowing it', async () => {
    serve({
      [live]: {status: 207, body: multistatus('/user/live/t1.ics', TODO)},
      [dead]: {status: 404},
    });
    const {missing} = await listTasks(config({collectionUrls: [live, dead]}));
    expect(missing).toEqual([{url: dead, label: 'dead', status: 404, kind: 'task'}]);
  });

  it('treats a withdrawn permission as gone too, not as a hard error', async () => {
    serve({[dead]: {status: 403}});
    const {missing} = await listTasks(config({collectionUrls: [dead]}));
    expect(missing[0].status).toBe(403);
  });

  it('treats 410 Gone as gone', async () => {
    serve({[dead]: {status: 410}});
    await expect(listTasks(config({collectionUrls: [dead]}))).resolves.toMatchObject({
      missing: [expect.objectContaining({status: 410})],
    });
  });

  it('reports nothing missing when every list answers', async () => {
    serve({[live]: {status: 207, body: multistatus('/user/live/t1.ics', TODO)}});
    const {missing} = await listTasks(config({collectionUrls: [live]}));
    expect(missing).toEqual([]);
  });

  it('STILL fails loudly on a transient error, which must not look like removal', async () => {
    // A 503 or a dropped connection means try again, not "edit your settings".
    serve({[live]: {status: 503}});
    await expect(listTasks(config({collectionUrls: [live]}))).rejects.toThrow('503');
  });

  it('still fails loudly on bad credentials', async () => {
    serve({[live]: {status: 401}});
    await expect(listTasks(config({collectionUrls: [live]}))).rejects.toThrow(/credentials/i);
  });

  it('surfaces a real failure even when another list is merely gone', async () => {
    serve({[live]: {status: 500}, [dead]: {status: 404}});
    await expect(listTasks(config({collectionUrls: [live, dead]}))).rejects.toThrow('500');
  });
});

describe('listEvents with a calendar that has gone', () => {
  const live = 'https://dav.example/user/cal';
  const dead = 'https://dav.example/user/oldcal';

  it('keeps the surviving calendar and flags the dead one as a calendar', async () => {
    serve({
      [live]: {status: 207, body: multistatus('/user/cal/e1.ics', EVENT)},
      [dead]: {status: 404},
    });
    const result = await listEvents(config({calendarUrls: [live, dead]}));
    expect(result.items).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({label: 'oldcal', kind: 'calendar'});
  });
});

describe('missingMessage', () => {
  const gone = (over: Partial<MissingCollection> = {}): MissingCollection => ({
    url: 'https://dav.example/user/dead',
    label: 'Work',
    status: 404,
    kind: 'task',
    ...over,
  });

  it('is empty when nothing is missing, so no dialog can be shown', () => {
    expect(missingMessage([])).toBe('');
  });

  it('names the list, its kind, and the fix', () => {
    const text = missingMessage([gone()]);
    expect(text).toContain('"Work" (task list)');
    expect(text).toContain('Discover');
    expect(text).toContain('untick it');
  });

  it('says the rest of the refresh worked, so it does not read as total failure', () => {
    expect(missingMessage([gone()])).toContain('Everything else refreshed normally');
  });

  it('mentions lost access only for 403, where the collection may still exist', () => {
    expect(missingMessage([gone({status: 403})])).toContain('lost access');
    expect(missingMessage([gone({status: 404})])).not.toContain('lost access');
  });

  it('lists several and switches to plural wording', () => {
    const text = missingMessage([gone(), gone({label: 'Home', kind: 'calendar'})]);
    expect(text).toContain('"Work" (task list)');
    expect(text).toContain('"Home" (calendar)');
    expect(text).toContain('untick them');
  });
});
