import {buildVEvent, buildVTodo, parseVEvents} from '../src/ical';

const AT = new Date(Date.UTC(2026, 8, 2, 7, 5, 3));

describe('buildVTodo', () => {
  it('emits CRLF line endings, which Radicale requires', () => {
    const ics = buildVTodo({uid: 'abc', summary: 'Buy milk'}, AT);
    expect(ics).toContain('\r\n');
    expect(ics.split('\r\n').join('')).not.toContain('\n');
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('wraps a single VTODO in a VCALENDAR', () => {
    const lines = buildVTodo({uid: 'abc', summary: 'Buy milk'}, AT).split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('BEGIN:VTODO');
    expect(lines).toContain('UID:abc');
    expect(lines).toContain('SUMMARY:Buy milk');
    expect(lines).toContain('STATUS:NEEDS-ACTION');
    expect(lines).toContain('END:VTODO');
    expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
  });

  it('formats DTSTAMP as UTC basic format', () => {
    const ics = buildVTodo({uid: 'abc', summary: 'x'}, AT);
    expect(ics).toContain('DTSTAMP:20260902T070503Z');
  });

  it('escapes characters that would otherwise break the parse', () => {
    const ics = buildVTodo(
      {uid: 'abc', summary: 'Call Bob; ask re: milk, eggs \\ bread'},
      AT,
    );
    expect(ics).toContain('SUMMARY:Call Bob\\; ask re: milk\\, eggs \\\\ bread');
  });

  it('turns embedded newlines into \\n rather than real line breaks', () => {
    const ics = buildVTodo({uid: 'abc', summary: 'a', description: 'one\ntwo'}, AT);
    expect(ics).toContain('DESCRIPTION:one\\ntwo');
    // The description must remain one logical line.
    expect(ics.split('\r\n').filter(l => l.startsWith('DESCRIPTION'))).toHaveLength(1);
  });

  it('folds long lines at 75 octets with a leading space on continuations', () => {
    const summary = 'x'.repeat(200);
    const lines = buildVTodo({uid: 'abc', summary}, AT).split('\r\n');
    const folded = lines.filter(l => l.startsWith('SUMMARY') || l.startsWith(' '));
    expect(folded.length).toBeGreaterThan(1);
    for (const line of folded) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    // Unfolding (drop CRLF + one leading space) must restore the original.
    expect(folded.join('').replace(/^SUMMARY:/, '').replace(/ /g, '')).toBe(summary);
  });

  it('omits DESCRIPTION entirely when there is no source reference', () => {
    const ics = buildVTodo({uid: 'abc', summary: 'x'}, AT);
    expect(ics).not.toContain('DESCRIPTION');
  });
});

describe('an event captured from handwriting', () => {
  it('carries the source page as its own properties, not in the description', () => {
    const ics = buildVEvent({
      uid: 'u1',
      summary: 'Dentist',
      date: '2026-09-20',
      startTime: '09:30',
      sourcePath: 'Note/Daily/2026-09-14.note',
      sourcePage: 2,
    });
    expect(ics).toContain('X-TASKHUB-SOURCE:Note/Daily/2026-09-14.note');
    expect(ics).toContain('X-TASKHUB-SOURCE-PAGE:2');
    // The description stays the user's own space, exactly as it does for a
    // captured task.
    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('reads them back off the server', () => {
    const ics = buildVEvent({
      uid: 'u1',
      summary: 'Dentist',
      date: '2026-09-20',
      sourcePath: 'Note/Daily/a.note',
      sourcePage: 0,
    });
    const [event] = parseVEvents(ics);
    expect(event.sourcePath).toBe('Note/Daily/a.note');
    expect(event.sourcePage).toBe(0);
  });

  it('writes no source properties when it did not come from a page', () => {
    const ics = buildVEvent({uid: 'u1', summary: 'Dentist', date: '2026-09-20'});
    expect(ics).not.toContain('X-TASKHUB-SOURCE');
    expect(parseVEvents(ics)[0].sourcePath).toBeUndefined();
  });
});
