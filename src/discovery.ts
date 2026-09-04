import {XMLParser} from 'fast-xml-parser';

/**
 * Task-list discovery for Radicale.
 *
 * Radicale only exposes collections that are direct children of /USERNAME/, so a
 * single Depth:1 PROPFIND there enumerates everything a client can auto-detect.
 * Anything nested deeper has to be reached by its full URL — which is why the
 * manual collection field is kept as a fallback.
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

export function parseCollections(serverUrl: string, xml: string): TaskCollection[] {
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

      collections.push({url: resolveHref(serverUrl, href), displayName, components});
    }
  }

  return collections;
}

/** Home path for a user's collections: <server>/<username>/ */
export function userHomeUrl(serverUrl: string, username: string): string {
  const base = serverUrl.trim().replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(username.trim())}/`;
}
