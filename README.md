<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-color-reversed.png">
    <img src="assets/logo-color.png" alt="Task Hub" width="380">
  </picture>
</p>

<p align="center">
  <strong>Tasks and calendar on your Supernote, synced over CalDAV.</strong>
</p>

<p align="center">
  <a href="https://github.com/Sparkinman/task-hub"><strong>➜ Task Hub — the self-hosted server</strong></a><br>
  <sub>One command to install, runs on a Raspberry Pi. Recommended for tasks and calendars, not required for notes.</sub>
</p>

Lasso handwriting on a NOTE page, tap **Task Hub**, and it becomes a real task on your own
CalDAV server — where any other client, or a sync service, can pick it up. Then manage tasks
and calendar events on the device without leaving the notebook: year, quarter, month, week
and day views, notes for any of those periods, meeting notes, and a link on the page back to
the handwriting a task came from.

**A server is recommended, not required.** Every note feature works on its own: the calendar
views, daily/weekly/monthly/quarterly/yearly notes, templates and page marks need no network
at all. Only tasks, calendar events and capturing handwriting as a task need somewhere to put
them.

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
- optionally the caption **"Task Hub"** underneath
- optionally a **marker-pen wash** across the writing, in a colour you choose

Tapping the box shows the Task Hub logo, so months later it is obvious what took it. It shows
a logo rather than opening the task because the SDK's link types are note pages, files,
documents, images and URLs — none of them can reach a plugin. The image says so, in as many
words, rather than leaving you wondering.

**Completing the task removes the mark again**, including the caption and the wash. Every
part is off-switchable, because it writes into your own note.

The task remembers where it came from too: a `↩ page` chip on the task row closes the plugin
and reopens that note at that page.

### Tasks

Every watched collection in one list, opening on earliest-due first so overdue leads. Search
across titles and descriptions, sort by date either way or by name, complete with a tap, and
edit anything — title, description, due date and time. Completed tasks fold away into their
own section.

**Sub tasks.** A task with steps shows a fold arrow and a count, folded away by default, with
each family placed by its soonest outstanding step — so a piece of work due this morning sits
with everything else due this morning. Steps are read from `RELATED-TO;RELTYPE=PARENT`, the
same property Task Hub's web side writes, so nesting agrees in both places. You can add them
one per line when writing a task; they take the task's own due date unless you set one for
them, and a line ending `@2026-09-10` dates that step on its own.

**Priority** is read across the whole RFC 5545 range — 1–4 high, 5 medium, 6–9 low — and
shown as a badge. A task another client stored as `PRIORITY:3` stays a 3 when you edit its
title here rather than being flattened to this plugin's own number.

**Repeats** offer the same five choices as the Task Hub web page and write the identical
rules. Anything this menu cannot name — every second Tuesday, anything with `COUNT` or
`UNTIL` — reads as *custom* and is then left byte-identical.

Edits are written as **surgical text changes** to the calendar object rather than
reserialising it, so `RRULE`, `ATTENDEE` and `X-` properties this plugin does not model
survive untouched. Completion is a conditional `PUT` with `If-Match` on the ETag: a task
changed elsewhere since the list loaded fails with a clear message instead of silently
clobbering the other change.

### Calendar

**Year, quarter, month, week and day** views over your watched calendars, with an agenda
under each. Create and edit events on the device, including their repeat rule. The month grid
marks which days carry events, open tasks and notes, and has a week-number gutter that opens
or creates that week's note directly. The year view is twelve grids with tappable quarter and
month headings; the quarter view is three.

The day view's hours are yours to set — a nine-to-five agenda gets nine-to-five rows. Nothing
is hidden by narrowing them: all-day items stay at the top, anything earlier sits just under
them, and anything later goes beneath the last hour, each with its time and calendar.

A task with both a start and a due date is drawn as a run across those days, and counted as
due only on the last one — so a five-day task does not look due five times.

### Notes

**Notes for a day, a week, a month, a quarter or a year.** Each has its own folder, its own
token layout (`{YYYY}/{MM}-{MMMM}/{DATE}`, `{YYYY}/W{WW}`, `{YYYY}/{QQ}` and so on), its own
template, and its own on/off switch — somebody who keeps a weekly review but no monthly one
should not have a Create month note button in the way. Every day inside a period produces the
same path, so Tuesday and Thursday cannot end up with different "weekly" notes.

Every view's button says **Open** or **Create** depending on whether the file is already
there. Weeks start on Sunday, matching the week view the button is pressed from.

**Templates** come from the device's built-in set, from your own in `MyStyle/`, or from any
PNG/JPG anywhere on the device through a file browser — three tabs with real thumbnails and a
search box. The template is applied once, when a note is created; changing it later does not
restyle notes you already have.

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

### The server side

[**Task Hub**](https://github.com/Sparkinman/task-hub) is the server this plugin is built
alongside: self-hosted, one command to install, runs happily on a Raspberry Pi. It is what
sets `X-TASKHUB-ORIGIN`, bridges Google / Todoist / TickTick / Obsidian into one place, and
gives you a web view of the same tasks and calendars this plugin shows.

You do not need it. Any CalDAV server works — Radicale on its own is enough — and the note
features need no server at all. But if you want the tasks on your Supernote to be the same
tasks as everywhere else, that is what does it.

---

## Install

Grab `TaskHub.snplg` from [Releases](../../releases), copy it to `MyStyle/` on the device,
then **Settings → Apps → Plugins → Add Plugin**.

Use **Add Plugin** rather than reinstalling an existing entry: reinstall reads the host's own
managed copy under `MyStyle/Plugins/`, not the file you just copied across, so a new build
appears to do nothing.

Then open the plugin's settings, enter your server address and login, tap **Discover**, and
tick the task lists and calendars to watch.

Need a server? [**Task Hub**](https://github.com/Sparkinman/task-hub) installs with one
command and runs on a Raspberry Pi. Or point this at any CalDAV server you already have. Or
skip it entirely — the note and calendar-view features work without one, and settings save
with nothing ticked.

### Try it without a server

`TaskHubDemo.snplg` is the same plugin filled with sample data. It **requests no permissions
at all**, has no network access, and refuses every write — it exists so you can see and use
the thing before deciding whether to set up a server. It installs alongside the real one and
says "Task Hub Demo" on every screen.

---

## Build from source

```bash
npx tsc --noEmit                  # must pass first — Metro does not typecheck
npx eslint . --ext .ts,.tsx,.js
npx jest                          # 350 tests
./buildPlugin.sh                  # -> build/outputs/TaskHub.snplg
# Windows: .\buildPlugin.ps1 and .\buildDemo.ps1
```

`buildPlugin.sh` exits non-zero and packages nothing if the APK step fails. That matters:
`build/generated` is never cleared, so an earlier build's `app.npk` is sitting there, and a
script that carried on would zip a new JS bundle around a stale native payload and report
success.

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

## Sized to the panel

Type and spacing scale from the height the panel reports, calibrated against real devices: a
Manta reports 1365 and runs at full size, a Nomad reports 998 and runs at 70%, and anything
between is interpolated. Borders and the controls you tap are deliberately left alone — a
shrunken fold arrow is harder to hit. **Settings → This device** shows what was detected and
the scale in use.

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
- The marker-pen wash and the caption are separate elements from the box, so moving the
  handwriting leaves them behind — the SDK gives no way to group them. Only the box travels
  with the strokes.
- The wash covers the lasso selection, which is very slightly inside the box the host draws
  around it. The host does not report where that border goes and the SDK offers no way to
  ask, so it cannot be made to line up exactly. Shading is off by default.
- A link on the page cannot open the plugin. The SDK's link types are note page, note file,
  document, image and URL, so the box points at an image that says so. Going the other way —
  from a task to its page — works, via the `↩ page` chip.
