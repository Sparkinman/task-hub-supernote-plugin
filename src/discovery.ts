import {XMLParser} from 'fast-xml-parser';

/**
 * Task-list discovery for any CalDAV server.
 *
 * The standard route (RFC 6764) is a three-step walk: ask /.well-known/caldav
 * who the current user is, ask that principal where its calendars live, then
 * enumerate that home with a Depth:1 PROPFIND. Servers lay those paths out
 * very differently — Radicale uses /USERNAME/, Nextcloud
 * /remote.php/dav/calendars/USER/, Fastmail /dav/calendars/user/EMAIL/ — so
 * guessing the path only ever worked for one of them.
 *
 * When a server does not answer the well-known walk, we still fall back to the
 * /USERNAME/ guess, which is right for Radicale and harmless elsewhere.
 * Collections nested deeper than the home still have to be reached by their
 * full URL, which is why the manual collection field is kept.
 */

export interface TaskCollection {
  /** Absolute URL, ready to PUT into. */
  url: string;
  displayName: string;
  /** Component types the collection accepts, upper-cased (VTODO, VEVENT, …). */
  components: string[];
}

export function acceptsTasks(c: TaskCollection): boolean {
  return c.components.length === 0 || c.components.includes('VTODO');
}

export function acceptsEvents(c: TaskCollection): boolean {
  return c.components.length === 0 || c.components.includes('VEVENT');
}

// removeNSPrefix collapses D:/C:/cal: variants, which servers pick freely.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // Never coerce: a display name of "2026" must stay a string.
  parseTagValue: false,
  parseAttributeValue: false,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/** Resolve an href, which may be an absolute path or a full URL, against the server origin. */
export function resolveHref(serverUrl: string, href: string): string {
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  const origin = serverUrl.trim().replace(/\/+$/, '');
  const match = /^(https?:\/\/[^/]+)/i.exec(origin);
  const base = match ? match[1] : origin;
  return `${base}${href.startsWith('/') ? '' : '/'}${href}`;
}

/**
 * Two URLs naming the same collection, ignoring a trailing slash.
 *
 * Deliberately a local copy of `sameCollection` rather than an import from
 * settings.ts, which already imports this module — taking a *value* from it
 * here would close that into a real runtime cycle. Two lines is cheaper than
 * the import graph it would cost.
 */
function sameCollection(a: string, b: string): boolean {
  const tidy = (u: string) => u.trim().replace(/\/+$/, '');
  return tidy(a) === tidy(b);
}

/** Last non-empty path segment, decoded — the fallback name when displayname is absent. */
function nameFromHref(href: string): string {
  const segments = href.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Collections from a Depth:1 multistatus, excluding the home itself.
 *
 * RFC 4918 §9.1: a Depth:1 PROPFIND describes the collection it was sent to
 * *and* its members, so the calendar home is always one of the responses. It is
 * the container the calendars live in, not a calendar, and listing it produced
 * a spurious row named after the last segment of its own URL — a bare account
 * name like `paul` sitting beside the real lists, with no way to tell what it
 * was or to get rid of it.
 *
 * Passing `homeUrl` is what lets it be dropped. It is optional so the parser
 * stays usable on a multistatus from anywhere else; when it is absent nothing
 * is excluded, exactly as before.
 */
export function parseCollections(
  serverUrl: string,
  xml: string,
  homeUrl?: string,
): TaskCollection[] {
  const doc = parser.parse(xml);
  const responses = asArray(doc?.multistatus?.response);

  const collections: TaskCollection[] = [];

  for (const response of responses) {
    const href = typeof response?.href === 'string' ? response.href : '';
    if (!href) {
      continue;
    }

    for (const propstat of asArray(response.propstat)) {
      const status = String(propstat?.status ?? '');
      // Requested properties the server could not supply come back as 404 in
      // their own propstat block; only the 200 block describes the resource.
      if (status && !status.includes('200')) {
        continue;
      }

      const prop = propstat?.prop;
      if (!prop || prop.resourcetype?.calendar === undefined) {
        continue;
      }

      // RFC 4791 §5.2.3: an absent supported-calendar-component-set means the
      // collection accepts every component type. Empty `components` records that
      // "unspecified" state, which acceptsTasks/acceptsEvents both treat as yes.
      const compSet = prop['supported-calendar-component-set'];
      const components =
        compSet === undefined
          ? []
          : asArray(compSet?.comp)
              .map(c => String(c?.['@_name'] ?? '').toUpperCase())
              .filter(Boolean);

      const displayName =
        typeof prop.displayname === 'string' && prop.displayname.trim()
          ? prop.displayname.trim()
          : nameFromHref(href);

      const url = resolveHref(serverUrl, href);
      if (homeUrl && sameCollection(url, homeUrl)) {
        continue;
      }

      collections.push({url, displayName, components});
    }
  }

  return collections;
}

/**
 * Home path guess for servers that do not answer the well-known walk.
 *
 * This is Radicale's layout. It is a fallback, not the primary route.
 */
export function userHomeUrl(serverUrl: string, username: string): string {
  const base = serverUrl.trim().replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(username.trim())}/`;
}

/** The scheme://host[:port] of a configured server URL. */
export function originOf(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  const match = /^(https?:\/\/[^/]+)/i.exec(trimmed);
  return match ? match[1] : trimmed;
}

/**
 * The URLs to try when looking for the current user's principal.
 *
 * RFC 6764 nominates /.well-known/caldav. Not every deployment serves it —
 * a CalDAV server behind a path prefix often answers on the prefix instead —
 * so the configured URL and its bare origin are tried too. Order matters:
 * the standard location first, then the most specific thing the user gave us.
 */
export function principalCandidates(serverUrl: string): string[] {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  const origin = originOf(serverUrl);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [`${origin}/.well-known/caldav`, trimmed, origin]) {
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Pull an href out of a named DAV property.
 *
 * Used for both current-user-principal and calendar-home-set, which have the
 * same shape: one property holding one href.
 */
export function parseHrefProp(serverUrl: string, xml: string, property: string): string {
  const doc = parser.parse(xml);
  for (const response of asArray(doc?.multistatus?.response)) {
    for (const propstat of asArray(response?.propstat)) {
      const status = String(propstat?.status ?? '');
      if (status && !status.includes('200')) {
        continue;
      }
      const value = propstat?.prop?.[property];
      if (!value) {
        continue;
      }
      // The href may be a bare string or wrapped, and some servers repeat it.
      const href = asArray(value?.href ?? value)[0];
      if (typeof href === 'string' && href.trim()) {
        return resolveHref(serverUrl, href.trim());
      }
    }
  }
  return '';
}
