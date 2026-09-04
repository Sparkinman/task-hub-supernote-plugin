<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-color-reversed.png">
    <img src="assets/logo-color.png" alt="Task Hub" width="380">
  </picture>
</p>

<p align="center">
  <strong>Tasks and calendar on your Supernote, synced over CalDAV.</strong>
</p>

Lasso handwriting on a NOTE page, tap **Task Hub**, and it becomes a real task on your own
CalDAV server — where any other client, or a sync service, can pick it up. Then manage tasks
and calendar events on the device without leaving the notebook: month, week and day views,
daily notes, meeting notes, and a link on the page back to the handwriting a task came from.

Built for [Radicale](https://radicale.org/), and written against plain CalDAV
(RFC 4791/5545) rather than anything Radicale-specific.

---

## What it does

### Capture from handwriting

Lasso a handwritten or typed task, tap the Task Hub lasso button, and the on-device
recogniser fills in the title — editable before it is saved, which is where you fix a
misread. Add a due date by typing `YYYY-MM-DD` / `HH:MM` or with Today / Tomorrow / Next
week, tick which lists to file it into, and save. It confirms, writes, and returns you to
the page you were on.

The description is left deliberately empty. It is your space to write in, and a task that
arrives pre-filled with a file path has to be cleaned out every time.

### Marking the page it came from

A captured task can leave a mark on the page, so the writing shows it became one:

- a **box** around the lassoed strokes — dashed, solid, underline, or off
- optionally the caption **"Task Hub Task"** underneath
- optionally a **marker-pen wash** across the writing

Tapping the box shows the Task Hub logo, so months later it is obvious what took it.
**Completing the task removes the mark again.** Every part is off-switchable, because it
writes into your own note.

The task remembers where it came from too: a `↩ page` chip on the task row closes the plugin
and reopens that note at that page.

### Tasks

Every watched collection in one list, opening on earliest-due first so overdue leads. Search
across titles and descriptions, sort by date either way or by name, complete with a tap, and
edit anything — title, description, due date and time. Completed tasks fold away into their
own section.

Edits are written as **surgical text changes** to the calendar object rather than
reserialising it, so `RRULE`, `ATTENDEE` and `X-` properties this plugin does not model
survive untouched. Completion is a conditional `PUT` with `If-Match` on the ETag: a task
changed elsewhere since the list loaded fails with a clear message instead of silently
clobbering the other change.

### Calendar

Month, week and day views over your watched calendars, with an agenda under each. Create and
edit events on the device. The month grid marks which days carry events, open tasks and
notes; tapping a date opens a mini calendar you can page through, and the week view has ISO
week numbers down the side.

A task with both a start and a due date is drawn as a run across those days, and counted as
due only on the last one — so a five-day task does not look due five times.

### Notes

**Daily notes** live in a folder and layout you choose (`{YYYY}/{MM}-{MMMM}/{DATE}` and
similar), created from a template you pick. Days that already have one are marked on the
month grid, and tapping opens rather than recreates.

**Meeting notes** attach to a calendar event. A repeating event shares one note across every
occurrence; a one-off carries its date in the filename. The link between event and note is
kept on the device and never written back to CalDAV.

### Where tasks come from

Task Hub reads the `X-TASKHUB-ORIGIN` property and badges each item with the service it
originally came from — Google, Todoist, TickTick, Obsidian and others — so a list pulled
together from several places still tells you where each item started. Anything this plugin
creates is stamped `supernote`, so a task written on the device is identifiable everywhere
downstream.

That property is set by a sync service bridging your CalDAV server to those other services;
without one, everything simply reads as third party and the plugin works exactly the same.
The plugin talks only to the server address you configure, and to nothing else.

---

## Install

Grab `TaskHub.snplg` from [Releases](../../releases), copy it to `MyStyle/` on the device,
then **Settings → Apps → Plugins → Add Plugin**.

Use **Add Plugin** rather than reinstalling an existing entry: reinstall reads the host's own
managed copy under `MyStyle/Plugins/`, not the file you just copied across, so a new build
appears to do nothing.

Then open the plugin's settings, enter your server address and login, tap **Discover**, and
tick the task lists and calendars to watch.

### Try it without a server

`TaskHubDemo.snplg` is the same plugin filled with sample data. It **requests no permissions
at all**, has no network access, and refuses every write — it exists so you can see and use
the thing before deciding whether to set up a server. It installs alongside the real one and
says "Task Hub Demo" on every screen.

---

## Build from source

```powershell
npx tsc --noEmit                  # must pass first — Metro does not typecheck
npx eslint . --ext .ts,.tsx,.js
npx jest                          # 259 tests
.\buildPlugin.ps1                 # -> build/outputs/TaskHub.snplg
.\buildDemo.ps1                   # -> build/outputs/TaskHubDemo.snplg
```

Needs the Android SDK with NDK 27.0.12077973, a JDK, Node, and Python 3 on PATH.
[HANDOFF.md](HANDOFF.md) carries the full setup, the architecture, and the bugs worth not
rediscovering.

Both plugins are built from this one source tree — there is no fork. `buildDemo.ps1` flips a
compile-time flag, swaps the plugin config, builds, and restores everything.

---

## Naming — do not drift

This repository is named for what it is; the code inside is named `TaskHub`, one word. That
is deliberate and load-bearing — do not "tidy" it to match the repo.

`app.json`'s `name` and `PluginConfig.json`'s `pluginKey` **must stay identical**. A mismatch
installs cleanly and then does nothing at all: no buttons, no settings, no error. `pluginID`
must never change once distributed — it is what identifies the plugin to the device.
`package.json`'s `name` sets the `.snplg` and `.bundle` filenames.

## Pinned versions — do not drift

`react-native` is pinned to `0.79.2` by the on-device PluginHost runtime, not by convention.
`react`, `react-test-renderer` and `@types/react` must all stay at exactly `19.0.0`: npm's
`^19.0.0` peer range will happily install `19.2.x`, which fails **silently on-device** with
`Incompatible React versions` before the first render. Nothing shows up in `npm test`.

## Permissions

`INTERNET` for your CalDAV server, and `FILE:READ` / `FILE:WRITE` for daily notes, meeting
notes, and the settings file. Settings are stored as JSON in `Document/TaskHub/settings.json`
— outside the plugin's private directory, so they survive updates and reinstalls.

That file is **plain text on shared storage**, password included; a plugin has no access to a
keystore. Prefer a CalDAV credential scoped to the collections you use over an account
password. **Settings → Wipe All Save Data** clears it, since uninstalling does not.

## Known limits

- Handwriting inside plugin views is impossible on this firmware — showing a plugin view
  gates the EMR pen at the hardware level. Capture via lasso on the page is the supported
  path; finger touch works normally in the UI.
- `TZID` is treated as device-local. No timezone database is bundled, so a foreign-zone event
  can sit an hour out — better than dropping it.
- One-way for now: nothing is read back beyond listing. No un-complete, no dedupe, no
  offline queue.
- The marker-pen wash is a separate mark from the box, so moving the handwriting leaves it
  behind. The box and caption travel with the strokes.
