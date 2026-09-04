# Task Hub

Supernote plugin. Lasso a task on a NOTE page (or an annotation in DOC), tap **Task Hub**,
and it lands in a [Radicale](https://radicale.org/) CalDAV collection as a `VTODO` — then
review, edit and complete your tasks without leaving the device.

This repository is named for what it is; the code inside is named `TaskHub`, one word.
That is deliberate and load-bearing — do not "tidy" it to match the repo.

Everything is named `TaskHub`: the project folder, `package.json`, `app.json`, and
`pluginKey` — which produces `build/outputs/TaskHub.snplg`. React Native rejects hyphens in
project names, so the one-word form is required. **Task Hub** (with the space) is the
display name in `PluginConfig.json`, which is what the plugin list shows.

`app.json`'s `name` and `PluginConfig.json`'s `pluginKey` must stay identical — a mismatch
means the plugin installs and then silently loads nothing.

## Layout

| Path | Role |
|---|---|
| `index.js` | Registers the lasso button (type 2, id 200) + the config button |
| `App.tsx` | Three screens: save, All Tasks, settings |
| `src/lasso.ts` | Lasso selection to text (typed text boxes, else handwriting recognition) |
| `src/ical.ts` | Pure iCalendar build **and** parse, plus date filters. No SDK import, so it is unit-testable off-device |
| `src/discovery.ts` | Parses a PROPFIND multistatus into the list of VTODO collections |
| `src/caldav.ts` | Collection discovery + PUT of a new task |
| `src/tasks.ts` | REPORT calendar-query to list tasks; conditional PUT to complete one |
| `src/permissions.ts` | `INTERNET` runtime gate |
| `src/settings.ts` | Server config, watched collections, display prefs - **session-only, see below** |
| `src/format.ts` | Date/time display formatting (3 date orders, 12/24h) |
| `src/calendar.ts` | Month-grid maths for the date picker |
| `src/components/` | Brand mark, shared widgets, and the pure-JS date/time picker |

## What it does

Lasso a task, tap **Sync task**, and a review screen opens with the recognised text
pre-filled and editable - which is where you fix a misread before it reaches the server.
Set a due date via **Today / Tomorrow / Next week / Clear** or by typing `YYYY-MM-DD`
and `HH:MM`, adjust the description, and save. It then jumps to the task list showing
everything in the collection, filterable by All / Overdue / Today / 7 days / No date.
Tapping an open task marks it complete.

Date-only due values are written as `DUE;VALUE=DATE`; adding a time converts local wall
time to a UTC `DUE`. Completion is a conditional `PUT` with `If-Match` on the ETag, so a
task edited elsewhere since the list was loaded fails with a clear message instead of
silently clobbering the other change. Completion edits the calendar object as text rather
than reserialising it, so properties this plugin does not model (`RRULE`, `ATTENDEE`,
`X-` extensions) survive untouched.

Collection discovery is a Depth:1 `PROPFIND` on `/<username>/`. Radicale only auto-detects
collections that are direct children of that path, so anything nested deeper has to be
pasted into the manual collection field.

## Pinned versions — do not drift

`react-native` is pinned to `0.79.2` by the on-device PluginHost runtime, not by convention.
`react`, `react-test-renderer` and `@types/react` must all stay at exactly `19.0.0`: npm's
`^19.0.0` peer range will happily install `19.2.x`, which fails **silently on-device** with
`Incompatible React versions` before the first render. Nothing shows up in `npm test`.

## PluginConfig.json

Already generated and filled in — `pluginID` is `vfmnvjq0i1hxf8gu`.

`uses-permissions` is not optional. Calling `hasPermission` for an undeclared permission
throws error `1500`; skipping the declaration entirely means every request dies at the
socket layer with `SocketException: ... has no NETWORK permission`, visible only in
`adb logcat` — not as a catchable JS error.

Leave `pluginID` alone. Changing it after distribution makes the device treat the plugin as
a different one. `pluginKey` must stay equal to `app.json`'s `name` (`TaskHub`).

## Build & install

```powershell
.\buildPlugin.ps1
```

Produces `build/outputs/TaskHub.snplg` (~260 KB). Copy it to the device's `MyStyle` folder,
then Settings → Apps → Plugins → Add Plugin.

No NDK is required: the build scans `node_modules` for Android sources, finds none, and skips
the native compile path. That changes the moment you add a native module (e.g. SQLite under
`node_change/`) — at which point `ndkVersion` in `android/build.gradle` starts to matter.

## Open decision: settings persistence

`src/settings.ts` holds the Radicale URL and credentials **in memory only** — they are lost
when the plugin exits and must be re-entered each session. Persisting them needs a storage
backend (SQLite via `node_change/`, or a JSON file under `PluginManager.getPluginDirPath()`),
and neither encrypts anything. Prefer a Radicale app-password scoped to the one collection
over an account password before storing it.

## Not yet verified on-device

Written against the SDK typings, the Supernote docs, RFC 4791/5545 and Radicale's own
documentation. Typechecks, lints and passes 34 unit tests, but has not run on hardware:
the lasso to recognition path, the permission dialog, and every CalDAV round trip.
`src/ical.ts` and `src/discovery.ts` are the parts under test.

Known gaps: no dedupe (the same lasso twice makes two tasks), nothing is written back into
the note to mark it captured, un-completing a task is not supported, and there is no
offline queue.
