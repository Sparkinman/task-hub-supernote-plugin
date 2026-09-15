# The views

What each screen shows, and what every mark on it means.

Task Hub opens as a panel over whatever note you were in. It has three tabs —
**Tasks**, **Calendar** and **Find** — and a **↩ Back to note** button that
closes it and returns you to your page.

---

## Tasks

Every open task from every ticked list, grouped by when it is due.

### The groups

| Group | What is in it |
|---|---|
| **Overdue** | Due before today. Underlined — the one group worth spending emphasis on |
| **Today** | Due today |
| **Next 7 days** | Due within a week |
| **Later** | Due after that |
| **No date** | No due date at all |

The cut is made against a timestamp taken when the plugin opens, not when the
screen draws. A plugin left loaded overnight would otherwise keep calling
yesterday "today".

### A task row

```
☐  Call the dentist                        ↩ page
   Work · 2 steps
```

- **The tick box** completes the task. It is the only part of the row that
  writes to the server, so it has a generous target of its own.
- **The rest of the row** opens the task for editing.
- **The line underneath** names the list it came from, and how many steps it has.
- **`↩ page`** appears only on a task captured from handwriting. It reopens the
  note and the page the writing was on.
- **A badge** names where the task came from when that is not obvious — for
  example **Supernote** for one from the tablet's own To-Do app.

### Sub tasks

A task with steps shows a fold control. Steps are indented, washed light grey
and joined to their parent by a rail — indentation alone is too weak a signal on
a one-bit panel.

Families are ordered by their soonest outstanding step and are folded by default.
A family is never split across groups.

### Filter and sort

A **Search** box filters by title. **Sort** offers due date ascending or
descending; undated tasks sort last in both directions, because descending would
otherwise bury everything with a real deadline.

---

## Calendar

Five views, chosen with the switch under the tabs: **Year, Quarter, Month,
Week, Day**.

Two rules apply everywhere:

- **Tap once to select a day, twice to open it.** The first tap moves the
  selection and updates the panel underneath; the second opens the day view.
- **Today is always marked**, in every view, even when you are looking at
  another day — so the calendar never loses its anchor.

### Year

Twelve small month grids. Days carrying something are marked. Tapping a month
opens it.

### Quarter

Three months at full width, with week numbers down the side.

### Month

A hairline grid with week numbers in the gutter and neighbouring days filled in
so the month's shape is clear.

Each day cell can carry up to three letter discs:

| Disc | Means |
|---|---|
| **C** | A calendar event that day |
| **T** | An open task due that day. Completed tasks never mark a day |
| **N** | A note exists for that day |

Counts and progress bars were tried here and removed. A grid is read for *which*
days have something, and the circled letters answer that; a number does not.

The selected day is a filled pill, and a panel under the grid lists that day's
events and tasks.

### Week

A horizontal strip of seven days, then two columns: **Schedule** and **To-dos**,
in the same order as the day view.

Selecting a day emphasises its rows and greys the rest, so the week stays
readable while one day is in focus. Each day heading offers **Open note** or
**+ Note**.

### Day

An hourly grid for the hours set in [Agenda hours](settings.md#formats-and-behaviour),
with a task panel beside it.

- Events sit in the slot matching their start hour. Overlapping events stack
  within the slot rather than being positioned by pixel offset, so a long title
  pushes the row taller instead of being clipped.
- **All-day events sit above the grid.**
- Anything outside the agenda window is listed underneath it — narrowing the
  window hides nothing.
- Tasks due that day are in the panel, with the same tick-to-complete,
  tap-to-open behaviour as the Tasks tab.

### Events

Tapping an event opens it for editing — unless it came from a
[subscription](connections.md#ics-subscriptions), which cannot be edited and
says so. Every event offers a note: **Open note** if one exists, **+ Note** if
not. Every occurrence of a repeating event shares one note.

Editing a repeating event edits **the whole series**, and the form says so
before you change anything: a repeat is one object on the server, so the date
shown is the series' own start, not the occurrence you tapped.

---

## Find

Keywords and starred pages across your notes. See [Find](find.md).

---

## Forms

The capture screen and both editors are built to fit one panel rather than
scroll. The essentials are on the first page, everything else is behind
**More…** which swaps the body rather than lengthening it, and the actions sit
in a bar pinned at the foot so Save is always reachable.

The time picker offers hours and minutes to pick from, with AM/PM as a pair of
chips. Minutes are in five-minute steps.
