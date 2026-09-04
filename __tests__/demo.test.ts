/**
 * The demo build's sample data.
 *
 * Two things matter and neither is cosmetic: the data must stay dated around
 * whenever the demo is opened, and the released plugin must never ship with the
 * demo flag switched on.
 */

import {DEMO} from '../src/mode';
import {
  DEMO_BANNER,
  DEMO_COLLECTIONS,
  DEMO_CONFIG,
  demoEvents,
  demoMeetingFiles,
  demoNoteFiles,
  demoTasks,
} from '../src/demo';
import {eventsWithNotes} from '../src/meetingnote';
import {daysWithNotes} from '../src/dailynote';
import {readFileSync} from 'fs';
import {join} from 'path';
import {eventsOnDay, monthMarks, tasksOnDay, tasksRunningOn} from '../src/agenda';
import {searchTasks, sortTasks, toDateInput} from '../src/ical';
import {hasCalendars, hasCollections, isConfigured} from '../src/settings';
import {originIsNamed, originLabel} from '../src/origin';

const TODAY = new Date(2026, 8, 3);

describe('the demo flag', () => {
  it('is committed as false, so the real plugin cannot ship as a demo', () => {
    // buildDemo.ps1 flips this, builds, and flips it back. If this fails, a
    // build was interrupted and the working tree needs restoring.
    expect(DEMO).toBe(false);
  });
});

describe('demo tasks', () => {
  it('are dated around the day they are generated, not a fixed date', () => {
    const early = demoTasks(new Date(2026, 0, 15));
    // Mid-month on both sides: the first seed is due two days BEFORE today, so
    // a date near the 1st would roll the assertion into the previous month.
    const late = demoTasks(new Date(2027, 5, 15));
    expect(early[0].dueDate).not.toBe(late[0].dueDate);
    expect(early[0].dueDate?.startsWith('2026-01')).toBe(true);
    expect(late[0].dueDate?.startsWith('2027-06')).toBe(true);
  });

  it('includes something overdue, so the overdue styling is visible', () => {
    const overdue = demoTasks(TODAY).filter(
      t => !t.completed && t.dueAt !== null && t.dueAt < TODAY.getTime(),
    );
    expect(overdue.length).toBeGreaterThan(0);
  });

  it('includes completed tasks, so the folded Done section is not empty', () => {
    expect(demoTasks(TODAY).filter(t => t.completed).length).toBeGreaterThan(0);
  });

  it('includes a task with no due date at all', () => {
    expect(demoTasks(TODAY).some(t => t.dueAt === null)).toBe(true);
  });

  it('includes a multi-day task, so a span bar is drawn', () => {
    const spanning = demoTasks(TODAY).filter(t => t.startAt);
    expect(spanning.length).toBeGreaterThan(0);
    // demo-4 runs from today+2 to today+6; today+4 is inside that run.
    const middle = toDateInput(new Date(2026, 8, 7));
    expect(tasksRunningOn(demoTasks(TODAY), middle).length).toBeGreaterThan(0);
  });

  it('includes a task captured from a note, so the link-back chip appears', () => {
    const linked = demoTasks(TODAY).filter(t => t.sourcePath);
    expect(linked).toHaveLength(1);
    expect(linked[0].sourcePage).toBe(3);
  });

  it('spans both task lists, so the collection tag is not always the same', () => {
    const labels = new Set(demoTasks(TODAY).map(t => t.collectionLabel));
    expect(labels).toEqual(new Set(['Demo Work', 'Demo Personal']));
  });

  it('shows both a named origin badge and the third-party fallback', () => {
    const tasks = demoTasks(TODAY);
    expect(tasks.some(t => originIsNamed(t.origin))).toBe(true);
    expect(tasks.some(t => !originIsNamed(t.origin))).toBe(true);
    expect(originLabel(tasks.find(t => t.origin === 'todoist')?.origin)).toBe('Todoist');
  });

  it('sorts and searches like real data', () => {
    const tasks = demoTasks(TODAY);
    expect(sortTasks(tasks, 'due-desc')).toHaveLength(tasks.length);
    expect(searchTasks(tasks, 'dentist')).toHaveLength(1);
  });

  it('gives every task a unique id', () => {
    const uids = demoTasks(TODAY).map(t => t.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('points at an unreachable host, so a stray request cannot leave the device', () => {
    for (const task of demoTasks(TODAY)) {
      expect(task.href).toContain('.invalid/');
    }
  });
});

describe('demo events', () => {
  it('puts something on today, so the day view is not empty on first open', () => {
    expect(eventsOnDay(demoEvents(TODAY), toDateInput(TODAY)).length).toBeGreaterThan(0);
  });

  it('includes a repeating event and an all-day one', () => {
    const events = demoEvents(TODAY);
    expect(events.some(e => e.recurring)).toBe(true);
    expect(events.some(e => e.allDay)).toBe(true);
    expect(events.some(e => !e.allDay)).toBe(true);
  });

  it('comes back in start order', () => {
    const starts = demoEvents(TODAY).map(e => e.startAt);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('spreads across the month, so the grid shows more than one marked day', () => {
    const marks = monthMarks(demoEvents(TODAY), demoTasks(TODAY), new Set<string>());
    const marked = Object.values(marks).filter(m => m.hasEvent || m.hasTask);
    expect(marked.length).toBeGreaterThan(3);
  });

  it('marks today as having both an event and an open task', () => {
    const today = toDateInput(TODAY);
    expect(eventsOnDay(demoEvents(TODAY), today).length).toBeGreaterThan(0);
    expect(tasksOnDay(demoTasks(TODAY), today).length).toBeGreaterThan(0);
  });
});

describe('everything on screen says it is the demo', () => {
  it('labels every task list and calendar', () => {
    for (const c of DEMO_COLLECTIONS) {
      expect(c.displayName.startsWith('Demo ')).toBe(true);
    }
    for (const t of demoTasks(TODAY)) {
      expect(t.collectionLabel.startsWith('Demo ')).toBe(true);
    }
    for (const e of demoEvents(TODAY)) {
      expect(e.calendarLabel.startsWith('Demo ')).toBe(true);
    }
  });

  it('names the product in the banner, not just the word DEMO', () => {
    expect(DEMO_BANNER).toContain('TASK HUB DEMO');
  });

  it('keeps its notes in a folder of its own, clear of a real installation', () => {
    expect(DEMO_CONFIG.dailyNote.root).toContain('Task Hub Demo');
    expect(DEMO_CONFIG.meetingNote.root).toContain('Task Hub Demo');
  });
});

describe('demo daily notes', () => {
  it('marks a few days as already having a note', () => {
    const files = demoNoteFiles(TODAY);
    expect(files.length).toBeGreaterThan(0);
    const days = ['2026-09-02', '2026-09-03', '2026-09-05'];
    const found = daysWithNotes(files, days, DEMO_CONFIG.dailyNote, 'iso');
    // The paths must match what dailyNotePath builds, or the grid marks nothing.
    expect(found.size).toBe(3);
  });

  it('leaves other days unmarked, so the marker means something', () => {
    const files = demoNoteFiles(TODAY);
    expect(daysWithNotes(files, ['2026-09-10'], DEMO_CONFIG.dailyNote, 'iso').size).toBe(0);
  });

  it('puts them under the demo folder', () => {
    for (const path of demoNoteFiles(TODAY)) {
      expect(path).toContain('Task Hub Demo');
    }
  });
});

describe('demo meeting notes', () => {
  it('gives some events a note and leaves others without one', () => {
    const events = demoEvents(TODAY);
    const withNotes = eventsWithNotes(
      demoMeetingFiles(),
      events,
      DEMO_CONFIG.meetingNote,
      DEMO_CONFIG.meetingLinks,
    );
    // Both paths reachable: tapping a linked event opens its note, tapping an
    // unlinked one offers to create one.
    expect(withNotes.size).toBe(2);
    expect(withNotes.size).toBeLessThan(events.length);
  });

  it('links the repeating event, which is the case worth showing', () => {
    const standup = demoEvents(TODAY).find(e => e.recurring);
    expect(standup).toBeDefined();
    expect(DEMO_CONFIG.meetingLinks[standup!.uid]).toBeDefined();
  });

  it('keeps those notes in the demo folder', () => {
    for (const path of demoMeetingFiles()) {
      expect(path).toContain('Task Hub Demo');
    }
  });
});

describe('demo configuration', () => {
  it('looks configured, so the hub opens on data instead of a setup prompt', () => {
    expect(hasCollections(DEMO_CONFIG)).toBe(true);
    expect(hasCalendars(DEMO_CONFIG)).toBe(true);
    expect(isConfigured(DEMO_CONFIG)).toBe(true);
  });

  it('carries no credentials, real or fake', () => {
    expect(DEMO_CONFIG.username).toBe('');
    expect(DEMO_CONFIG.password).toBe('');
  });

  it('offers task lists and a calendar in the pickers', () => {
    expect(DEMO_COLLECTIONS.filter(c => c.components.includes('VTODO'))).toHaveLength(2);
    expect(DEMO_COLLECTIONS.filter(c => c.components.includes('VEVENT'))).toHaveLength(1);
  });

  it('names only unreachable URLs', () => {
    expect(DEMO_CONFIG.serverUrl).toContain('.invalid');
    for (const url of [...DEMO_CONFIG.collectionUrls, ...DEMO_CONFIG.calendarUrls]) {
      expect(url).toContain('.invalid');
    }
  });
});

describe('plugin identity', () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(join(__dirname, '..', name), 'utf8'));

  it('registers the component under the name the host looks up', () => {
    // index.js does registerComponent(app.json name); the host resolves it by
    // PluginConfig pluginKey. A mismatch installs cleanly and then does nothing
    // at all — no buttons, no settings, no error. The demo shipped that way once.
    expect(read('app.json').name).toBe(read('PluginConfig.json').pluginKey);
  });

  it('gives the demo its own id, so it is not an update to the real plugin', () => {
    expect(read('PluginConfig.demo.json').pluginID).not.toBe(read('PluginConfig.json').pluginID);
  });

  it('has buildDemo rewrite app.json too, not just PluginConfig', () => {
    // The pairing above only holds at build time if the build swaps both.
    const script = readFileSync(join(__dirname, '..', 'buildDemo.ps1'), 'utf8');
    const renamer = readFileSync(join(__dirname, '..', 'scripts', 'set_demo_names.py'), 'utf8');
    expect(script).toContain('set_demo_names.py');
    expect(renamer).toContain('app.json');
    expect(renamer).toContain('package.json');
    // And refuses to build if they ever disagree.
    expect(script).toMatch(/liveKey -ne \$liveName/);
  });
});
