/**
 * RFC 6764 collection discovery.
 *
 * Discovery used to guess <server>/<username>/, which is Radicale's layout and
 * nobody else's — Nextcloud, Baikal and Fastmail all keep calendars somewhere
 * different, so "Find collections" found nothing on any of them. These cover
 * the standard walk (well-known → principal → calendar-home-set) and the
 * fallbacks that keep the old behaviour working.
 */

jest.mock('../src/permissions', () => ({
  ensureInternet: jest.fn().mockResolvedValue(undefined),
  ensureFileAccess: jest.fn().mockResolvedValue(undefined),
  PermissionDeniedError: class extends Error {},
}));

import {AuthError, discoverCollections, resolveHome} from '../src/caldav';
import {parseHrefProp, principalCandidates, userHomeUrl} from '../src/discovery';
import {EMPTY_CONFIG, type ServerConfig} from '../src/settings';

const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  ...EMPTY_CONFIG,
  serverUrl: 'https://cloud.example',
  username: 'user',
  password: 'pw',
  ...over,
});

const principalXml = (href: string) =>
  '<?xml version="1.0"?><multistatus xmlns="DAV:"><response>' +
  '<href>/.well-known/caldav</href><propstat><status>HTTP/1.1 200 OK</status>' +
  `<prop><current-user-principal><href>${href}</href></current-user-principal></prop>` +
  '</propstat></response></multistatus>';

const homeXml = (href: string) =>
  '<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  '<response><href>/principals/user/</href><propstat><status>HTTP/1.1 200 OK</status>' +
  `<prop><C:calendar-home-set><href>${href}</href></C:calendar-home-set></prop>` +
  '</propstat></response></multistatus>';

const collectionsXml = (href: string, name: string) =>
  '<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  `<response><href>${href}</href><propstat><status>HTTP/1.1 200 OK</status>` +
  `<prop><displayname>${name}</displayname>` +
  '<resourcetype><collection/><C:calendar/></resourcetype>' +
  '<C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>' +
  '</prop></propstat></response></multistatus>';

const requested: string[] = [];

function serve(table: Record<string, {status: number; body?: string}>) {
  requested.length = 0;
  (global as {fetch?: unknown}).fetch = jest.fn(async (url: string) => {
    const key = url.replace(/\/+$/, '');
    requested.push(key);
    const reply = table[key];
    if (!reply) {
      return {ok: false, status: 404, text: async () => ''};
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

describe('principalCandidates', () => {
  it('tries the well-known path first', () => {
    expect(principalCandidates('https://cloud.example')[0]).toBe(
      'https://cloud.example/.well-known/caldav',
    );
  });

  it('also offers the configured URL when it has a path prefix', () => {
    expect(principalCandidates('https://host.example/dav/')).toEqual([
      'https://host.example/.well-known/caldav',
      'https://host.example/dav',
      'https://host.example',
    ]);
  });

  it('does not repeat the origin when the URL is already bare', () => {
    expect(principalCandidates('https://cloud.example/')).toHaveLength(2);
  });
});

describe('parseHrefProp', () => {
  it('reads the principal href', () => {
    const xml = principalXml('/remote.php/dav/principals/users/user/');
    expect(parseHrefProp('https://cloud.example', xml, 'current-user-principal')).toBe(
      'https://cloud.example/remote.php/dav/principals/users/user/',
    );
  });

  it('reads the calendar home, namespace prefix and all', () => {
    const xml = homeXml('/remote.php/dav/calendars/user/');
    expect(parseHrefProp('https://cloud.example', xml, 'calendar-home-set')).toBe(
      'https://cloud.example/remote.php/dav/calendars/user/',
    );
  });

  it('returns empty when the property is absent', () => {
    expect(parseHrefProp('https://cloud.example', homeXml('/x/'), 'current-user-principal')).toBe('');
  });

  it('ignores a propstat the server marked 404', () => {
    const xml =
      '<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/</href>' +
      '<propstat><status>HTTP/1.1 404 Not Found</status>' +
      '<prop><current-user-principal><href>/nope/</href></current-user-principal></prop>' +
      '</propstat></response></multistatus>';
    expect(parseHrefProp('https://cloud.example', xml, 'current-user-principal')).toBe('');
  });
});

describe('resolveHome', () => {
  it('walks well-known to the calendar home (Nextcloud layout)', async () => {
    serve({
      'https://cloud.example/.well-known/caldav': {
        status: 207,
        body: principalXml('/remote.php/dav/principals/users/user/'),
      },
      'https://cloud.example/remote.php/dav/principals/users/user': {
        status: 207,
        body: homeXml('/remote.php/dav/calendars/user/'),
      },
    });
    await expect(resolveHome(config())).resolves.toBe(
      'https://cloud.example/remote.php/dav/calendars/user/',
    );
  });

  it('falls through to the configured URL when well-known is not served', async () => {
    serve({
      'https://cloud.example': {status: 207, body: principalXml('/principals/user/')},
      'https://cloud.example/principals/user': {
        status: 207,
        body: homeXml('/calendars/user/'),
      },
    });
    await expect(resolveHome(config())).resolves.toBe('https://cloud.example/calendars/user/');
  });

  it('falls back to the username guess when nothing answers', async () => {
    serve({});
    await expect(resolveHome(config())).resolves.toBe(
      userHomeUrl('https://cloud.example', 'user'),
    );
  });

  it('honours an explicit owner without asking the server', async () => {
    serve({});
    await expect(resolveHome(config({owner: 'shared'}))).resolves.toBe(
      'https://cloud.example/shared/',
    );
    // The owner field exists because the wanted collections are not the
    // login's own, which is exactly what the well-known walk would report.
    expect(requested).toHaveLength(0);
  });

  it('surfaces bad credentials rather than falling back', async () => {
    serve({'https://cloud.example/.well-known/caldav': {status: 401}});
    await expect(resolveHome(config())).rejects.toBeInstanceOf(AuthError);
  });
});

describe('discoverCollections', () => {
  it('lists collections found under the discovered home', async () => {
    serve({
      'https://cloud.example/.well-known/caldav': {
        status: 207,
        body: principalXml('/remote.php/dav/principals/users/user/'),
      },
      'https://cloud.example/remote.php/dav/principals/users/user': {
        status: 207,
        body: homeXml('/remote.php/dav/calendars/user/'),
      },
      'https://cloud.example/remote.php/dav/calendars/user': {
        status: 207,
        body: collectionsXml('/remote.php/dav/calendars/user/personal/', 'Personal'),
      },
    });
    const found = await discoverCollections(config());
    expect(found).toHaveLength(1);
    expect(found[0].displayName).toBe('Personal');
    expect(found[0].url).toBe('https://cloud.example/remote.php/dav/calendars/user/personal/');
    expect(found[0].components).toEqual(['VTODO']);
  });

  it('still works against a Radicale-style server with no well-known', async () => {
    serve({
      'https://cloud.example/user': {
        status: 207,
        body: collectionsXml('/user/tasks/', 'Tasks'),
      },
    });
    const found = await discoverCollections(config());
    expect(found.map(c => c.url)).toEqual(['https://cloud.example/user/tasks/']);
  });

  it('explains itself when the home holds no collections', async () => {
    serve({
      'https://cloud.example/user': {
        status: 207,
        body: '<?xml version="1.0"?><multistatus xmlns="DAV:"></multistatus>',
      },
    });
    await expect(discoverCollections(config())).rejects.toThrow(/paste a collection URL/);
  });

  it('reports bad credentials as an auth failure', async () => {
    serve({'https://cloud.example/.well-known/caldav': {status: 401}});
    await expect(discoverCollections(config())).rejects.toBeInstanceOf(AuthError);
  });
});
