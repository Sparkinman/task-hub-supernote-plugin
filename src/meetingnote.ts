import type {VEvent} from './ical';

/**
 * Notes attached to calendar events.
 *
 * Linkage is by event UID, which is what makes recurring meetings work: every
 * occurrence of a repeating event shares one UID, so they all resolve to the
 * same note.
 *
 * The UID is recorded in a `uid -> filename` map rather than encoded into the
 * filename, so notes are named after the meeting and nothing else. An earlier
 * version appended a hash of the UID ("Team sync-1a2b3c4d.note") which was
 * unique but meaningless to anyone browsing the folder on the device.
 *
 * Nothing here is written back to CalDAV — the note lives only on the device.
 */

export interface MeetingNoteConfig {
  /** Folder under shared storage, e.g. 'Note/Meetings'. */
  root: string;
  /** Optional .note template; blank means the host default. */
  template: string;
}

/** uid -> path relative to shared storage. */
export type MeetingLinks = Record<string, string>;

export const DEFAULT_MEETING_NOTE: MeetingNoteConfig = {
  root: 'Note/Meetings',
  template: '',
};

/** Strip characters that cannot appear in a filename. */
export function safeTitle(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned || 'Meeting';
}

function tidyRoot(root: string): string {
  return root
    .split('/')
    .map(p => p.trim())
    .filter(Boolean)
    .join('/');
}

/**
 * Pick a filename for a new note, avoiding names already in use.
 *
 * Two different meetings can share a title, so a numeric suffix is added only
 * when one is actually needed — the common case stays a clean "Team sync.note".
 */
export function proposeMeetingPath(
  config: MeetingNoteConfig,
  event: VEvent,
  taken: Iterable<string>,
): string {
  if (!event.uid) {
    return '';
  }
  const root = tidyRoot(config.root);
  /*
   * A repeating event shares one note across every occurrence, so its name must
   * carry no date. A one-off does carry its date, which keeps two unrelated
   * meetings that happen to share a title tellable apart at a glance — far more
   * useful than the "(2)" suffix that would otherwise separate them.
   */
  const title = event.recurring
    ? safeTitle(event.summary)
    : `${safeTitle(event.summary)} ${event.startDate}`;
  const used = new Set(Array.from(taken, p => p.replace(/\\/g, '/').toLowerCase()));

  let candidate = `${root}/${title}.note`;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${root}/${title} (${n}).note`;
    n++;
    if (n > 999) {
      // Pathological only; better a long name than an infinite loop.
      candidate = `${root}/${title} (${Date.now()}).note`;
      break;
    }
  }
  return candidate;
}

/**
 * Where an event's note lives, or '' when none is linked yet.
 *
 * Falls back to the pre-0.17 hashed filename so notes created by an earlier
 * version keep working without a migration step.
 */
export function meetingNotePath(
  config: MeetingNoteConfig,
  event: VEvent,
  links: MeetingLinks,
  existing: string[] = [],
): string {
  if (!event.uid) {
    return '';
  }
  const linked = links[event.uid];
  if (linked) {
    return linked;
  }

  const legacy = legacyMeetingPath(config, event);
  if (legacy && existing.some(p => p.replace(/\\/g, '/').toLowerCase() === legacy.toLowerCase())) {
    return legacy;
  }
  return '';
}

/** The 0.16 naming scheme, kept only so old notes are still found. */
export function legacyMeetingPath(config: MeetingNoteConfig, event: VEvent): string {
  if (!event.uid) {
    return '';
  }
  let hash = 0;
  for (let i = 0; i < event.uid.length; i++) {
    // eslint-disable-next-line no-bitwise -- reproducing the old hash exactly
    hash = (hash << 5) - hash + event.uid.charCodeAt(i);
    // eslint-disable-next-line no-bitwise -- reproducing the old hash exactly
    hash |= 0;
  }
  // eslint-disable-next-line no-bitwise -- reproducing the old hash exactly
  const tag = (hash >>> 0).toString(36).padStart(7, '0').slice(0, 8);
  return `${tidyRoot(config.root)}/${safeTitle(event.summary).slice(0, 60)}-${tag}.note`;
}

/** Which of `events` already have a note on disk, keyed by UID. */
export function eventsWithNotes<T extends VEvent>(
  existing: string[],
  events: T[],
  config: MeetingNoteConfig,
  links: MeetingLinks,
): Set<string> {
  const known = new Set(existing.map(p => p.replace(/\\/g, '/').toLowerCase()));
  const found = new Set<string>();
  for (const event of events) {
    const path = meetingNotePath(config, event, links, existing);
    if (path && known.has(path.toLowerCase())) {
      found.add(event.uid);
    }
  }
  return found;
}
