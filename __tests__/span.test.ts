import {SPAN_CAP_DAYS, taskSpan, tasksOnDay, tasksRunningOn} from '../src/agenda';
import {parseVTodos, type VTodo} from '../src/ical';

const TODO = (body: string) =>
  ['BEGIN:VCALENDAR', 'BEGIN:VTODO', body, 'END:VTODO', 'END:VCALENDAR'].join('\r\n');

const at = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

const todo = (over: Partial<VTodo>): VTodo => ({
  uid: Math.random().toString(36),
  summary: 'task',
  dueAt: null,
  status: 'NEEDS-ACTION',
  completed: false,
  ...over,
});

describe('parsing DTSTART on a VTODO', () => {
  it('reads the real Task Hub span example', () => {
    const [task] = parseVTodos(
      TODO(
        [
          'UID:80935a9a-0f34-42ae-9058-1b14978e9ba9@taskhub',
          'SUMMARY:MT2 four day span',
          'DTSTART;VALUE=DATE:20260914',
          'DUE;VALUE=DATE:20260918',
        ].join('\r\n'),
      ),
    );
    expect(task.startDate).toBe('2026-09-14');
    expect(task.dueDate).toBe('2026-09-18');
  });

  it('leaves start undefined for the common due-only task', () => {
    const [task] = parseVTodos(
      TODO(['UID:a1', 'SUMMARY:x', 'DUE;VALUE=DATE:20260918'].join('\r\n')),
    );
    expect(task.startAt).toBeNull();
  });
});

describe('taskSpan', () => {
  it('counts the due date INCLUSIVELY, unlike a VEVENT all-day end', () => {
    // 14th to 18th is five days, not four: DUE is the deadline itself.
    const span = taskSpan(todo({startAt: at(2026, 8, 14), dueAt: at(2026, 8, 18)}));
    expect(span).toEqual({from: '2026-09-14', to: '2026-09-18', days: 5});
  });

  it('is null for a task with no start', () => {
    expect(taskSpan(todo({dueAt: at(2026, 8, 18)}))).toBeNull();
  });

  it('is null when start equals due, so no one-day span is drawn', () => {
    expect(taskSpan(todo({startAt: at(2026, 8, 18), dueAt: at(2026, 8, 18)}))).toBeNull();
  });

  it('is null when start is after due, rather than a negative run', () => {
    expect(taskSpan(todo({startAt: at(2026, 8, 20), dueAt: at(2026, 8, 18)}))).toBeNull();
  });

  it('accepts a run exactly at the cap', () => {
    const start = at(2026, 0, 1);
    const end = at(2026, 0, 1) + (SPAN_CAP_DAYS - 1) * 86400000;
    expect(taskSpan(todo({startAt: start, dueAt: end}))?.days).toBe(SPAN_CAP_DAYS);
  });

  it('drops a run longer than the cap, so a stale start cannot paint every month', () => {
    const start = at(2025, 0, 1);
    expect(taskSpan(todo({startAt: start, dueAt: at(2026, 8, 18)}))).toBeNull();
  });
});

describe('tasksRunningOn', () => {
  const spanning = todo({
    summary: 'MT2 four day span',
    startAt: at(2026, 8, 14),
    dueAt: at(2026, 8, 18),
  });

  it('reports the task on days inside the run', () => {
    for (const day of ['2026-09-14', '2026-09-15', '2026-09-17']) {
      expect(tasksRunningOn([spanning], day)).toHaveLength(1);
    }
  });

  it('does NOT report it as running on its due day — that day it is due', () => {
    expect(tasksRunningOn([spanning], '2026-09-18')).toHaveLength(0);
    expect(tasksOnDay([spanning], '2026-09-18')).toHaveLength(1);
  });

  it('excludes days outside the run', () => {
    expect(tasksRunningOn([spanning], '2026-09-13')).toHaveLength(0);
    expect(tasksRunningOn([spanning], '2026-09-19')).toHaveLength(0);
  });

  it('never counts a running task as due on a middle day', () => {
    // The whole point: a five-day task must not look due five times.
    const dueDays = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].filter(
      d => tasksOnDay([spanning], d).length > 0,
    );
    expect(dueDays).toEqual(['2026-09-18']);
  });

  it('ignores completed tasks', () => {
    const done = todo({startAt: at(2026, 8, 14), dueAt: at(2026, 8, 18), completed: true});
    expect(tasksRunningOn([done], '2026-09-15')).toHaveLength(0);
  });

  it('ignores single-day tasks', () => {
    expect(tasksRunningOn([todo({dueAt: at(2026, 8, 15)})], '2026-09-15')).toHaveLength(0);
  });
});
