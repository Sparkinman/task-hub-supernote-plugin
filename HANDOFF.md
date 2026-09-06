# Task Hub — state as of 2026-09-06

Working Supernote plugin, installed and in real use. `pluginID vfmnvjq0i1hxf8gu`.
**317 tests across 16 suites**; `tsc` and eslint clean, all verified 2026-09-06.
Current build **0.50.0** (versionCode 65).

**Published** at <https://github.com/Sparkinman/task-hub-supernote-plugin> (public, `main`),
**licensed GPLv3**, with v0.50.0 released and `TaskHub.snplg` attached to it.

One plugin: **Task Hub** (`vfmnvjq0i1hxf8gu`).

The demo build was removed on 2026-09-06. It existed so somebody could try the
plugin before setting up a CalDAV server; lifting the server requirement made it
redundant — the real plugin now saves its settings and runs every note and
calendar feature with nothing configured. `src/mode.ts`, `src/demo.ts`,
`PluginConfig.demo.json`, `buildDemo.ps1`, `scripts/set_demo_names.py` and its
test suite are all gone, along with the `blockedInDemo` guard that sat on every
write path.

## Build

```powershell
npx tsc --noEmit                              # MUST pass before building
npx eslint . --ext .ts,.tsx,.js
npx jest                                      # 317 tests, 16 suites
.uildPlugin.ps1                             # ~15 s -> build/outputs/TaskHub.snplg (6.91 MB)
.uildDemo.ps1                               # -> build/outputs/TaskHubDemo.snplg, restores the tree
```

Metro does not typecheck, so a type error still produces a `.snplg` that crashes
on device. Never build on a failing `tsc`.

`build/generated` is never cleared, and the packaging step zips whatever is in
it — so a bundle left by the other variant gets packaged alongside the real one.
Clear it by hand if a build is ever done another way.

`buildPlugin.sh` now EXITS 1 if the APK step fails rather than carrying on. It
used to print "APK build failed" in red and then package the stale `app.npk` left
in `build/generated`, finishing with "Plugin package created" — a new JS bundle
around an old native payload, reported as a success. The usual cause is a shell
without `JAVA_HOME`: `source ~/.plugin-env` first.

The environment needs `JAVA_HOME`, `ANDROID_HOME` and Node on PATH. In a fresh
terminal those are already set machine-wide; from a tool session they may need
re-exporting from the User/Machine environment.

### Resuming on another machine

`npm install` restores everything under `node_modules`; nothing is vendored.
What does NOT come from the repo:

- **Android SDK + NDK 27.0.12077973 and a JDK**, with `ANDROID_HOME` and
  `JAVA_HOME` set. The NDK really is required — the native path builds
  `libnative-lib.so`. First native build ~7 min; incremental ~7 s.
- **The Android SDK licences**, accepted interactively via
  `sdkmanager --licenses`. Nobody can accept those on your behalf.
- **The device's own settings**, `Document/TaskHub/settings.json`. Server, login
  and every choice live there, not in the repo, and survive uninstalling the
  plugin. Clear it from Settings -> *Wipe All Save Data*.

Installing a build whose `app.npk` changed needs **Add Plugin**, not Reinstall:
reinstall reads the host's managed copy under `MyStyle/Plugins/` rather than the
file just pushed, so the old native payload is kept.

## The public repository — rules that outlive this session

History was deliberately reset to a clean start before publishing. Two things must not creep
back in, because undoing them after a push means rewriting public history:

1. **No AI-assistant attribution in commit messages.** The repo was scrubbed of it on the
   author's explicit instruction — working tree and every git object, verified with
   `git rev-list --objects --all | cut -d' ' -f1 | git cat-file --batch | grep -i ...`.
   Re-run that check before any push if in doubt.
2. **No personal email.** Commits are authored `Sparkinman
   <sparkinman@users.noreply.github.com>`, set as *local* repo config, so a global git
   identity cannot leak in. `git log --format='%an <%ae>'` before pushing.

`.mcp.json` is untracked and ignored — it is local tooling config, not project source.

Any snapshot zip taken before 2026-09-03 predates all this and still bundles the **old**
`.git`, with the previous author identity inside. Do not upload one anywhere; rebuild from
the current tree instead.

### The state of the repo

- **Released.** v0.50.0 is published with `TaskHub.snplg` attached. `build/` stays gitignored,
  so the binary reaches people through the release page and nowhere else. Bump `versionCode`
  and `versionName` in `PluginConfig.json` before cutting the next one — the device uses
  `versionCode` to decide what counts as an update.
- **Licensed GPLv3**, the same as [the server](https://github.com/Sparkinman/task-hub). The
  full text is in `LICENSE`; the README explains it. This replaces the earlier
  all-rights-reserved position — do not reintroduce it.
- **No repo description or topics** set yet.

## Naming — do not drift

`app.json`'s `name` and `PluginConfig.json`'s `pluginKey` are both `TaskHub` and
**must stay identical**; a mismatch installs fine and then loads nothing.
`pluginID` must never change — it identifies the plugin to the device.
`package.json`'s `name` sets the `.snplg` and `.bundle` filenames.

## Pinned versions — do not drift

`react-native` is pinned to `0.79.2` by the on-device PluginHost. `react`,
`react-test-renderer` and `@types/react` must stay at exactly `19.0.0` — npm's
`^19.0.0` will install `19.2.x`, which fails **silently on-device** with
`Incompatible React versions` before the first render and shows nothing in
`npm test`.

## Architecture

| Path | Role |
|---|---|
| `index.js` | Registers toolbar button (id 100 → hub), lasso button (id 200 → capture), config button |
| `App.tsx` | All screens: save / hub (Tasks + Calendar tabs) / settings |
| `src/ical.ts` | Pure iCalendar build + parse for VTODO and VEVENT, date helpers, sort/filter |
| `src/agenda.ts` | Day bucketing and month markers |
| `src/calendar.ts` | Month-grid maths |
| `src/format.ts` | Date/time display formatting |
| `src/discovery.ts` | PROPFIND multistatus → collections, split by component type |
| `src/caldav.ts` | Discovery + task creation |
| `src/tasks.ts` | REPORT listing, complete, edit, event create/edit |
| `src/storage.ts` | Durable settings via the native module |
| `src/permissions.ts` | INTERNET and FILE:READ/WRITE runtime gates |
| `src/components/` | Brand, shared widgets, date picker, Month/Week/Day views |
| `android/.../SettingsStoreModule.kt` | The only native code — reads/writes the settings JSON |

Anything pure lives outside `App.tsx` and is unit-tested; `src/ical.ts` and
`src/agenda.ts` deliberately import no SDK, because `sn-plugin-lib` resolves a
TurboModule at import time that only exists on-device and breaks jest.

## Decisions worth not re-litigating

- **Surgical text edits, not reserialise.** `markCompleted`, `updateVTodo` and
  `updateVEvent` rewrite only the properties the user can change, so `RRULE`,
  `ATTENDEE` and `X-` properties survive. Tests assert this.
- **Completion is read from three signals** — `STATUS:COMPLETED`, a `COMPLETED:`
  timestamp, or `PERCENT-COMPLETE:100`. Only checking STATUS left tasks
  completed in other clients looking open forever.
- **Only open tasks mark a day** with `T` on the month grid.
- **Undated tasks sort last in both directions**, or descending buries
  everything with a real deadline.
- **All-day events get no `DTEND`** — a correct one would be the next day.
- **Local `YYYY-MM-DD` keys, never epoch comparison**, for day bucketing.
- **Every write is confirm → push → success → full reload**, one code path
  (`ask()` in `App.tsx`). Completion deliberately does not update optimistically.
- **Time picker arrows are inverted** (up decrements) by request.
- **No `@react-native-community/datetimepicker`** — native module, animated
  spinners, poor fit for e-ink. The picker is plain Views.

## Page marking — what a captured task leaves on the page

Capturing from a lasso can mark the page it came from. All of it is optional and
all of it writes into the user's own note, so every part is disclosed in the
confirmation dialog and switchable in Settings.

| Setting | Default | What it draws |
|---|---|---|
| `markStyle` | `dashed` | A border around the lassoed strokes, via `setLassoStrokeLink` |
| `markLabel` | off | `"Task Hub Task"` underneath, via `insertTextLink` |
| `markShade` | off | A marker stroke across the writing, via `insertElements` |

The box is a **link**, pointing at `Document/TaskHub/Task Hub.png` — the Task Hub
lock-up with a caption, composed natively by `writeLinkImage` so the text stays
sharp at any viewer size. Tapping the box pops that image up. **A plugin is not a
link target**: the SDK addresses pages, files, images and URLs only, so there is
no way to make the mark reopen Task Hub, and pointing it at an image is the
nearest thing the host can show.

Completing a task calls `removePageMark`, which deletes every link on the source
page whose `destPath` is our image, plus any marker geometry lying inside those
links' rectangles. Handwriting is never at risk: strokes are their own elements
and a stroke link is a separate element referencing them.

**Marker pen values were read off the device** (`penType 11`, `penColor 202`,
hand-drawn thickness 3800) through a temporary readout, not guessed — the SDK
documents no penType constants, and a wrong value draws a solid pen, i.e. an
opaque block over the handwriting. That is why shading is opt-in. Width is
reduced to 2200 in `src/markstyle.ts`, the only place it is set.

### Its two real limitations

1. **Shading does not follow the writing.** The box and caption are links; the
   box is bound to the strokes via `controlTrailNums` and travels with them. The
   shading is a separate geometry element and stays behind if the handwriting is
   moved — and completion then cannot find it, because it searches inside the
   box's rectangle.
2. **Copying a captured task confuses cleanup.** Every link on the page pointing
   at our image is deleted, so completing one of two copies strips the box and
   caption from both. Fixing it needs per-task identity in the link, which its
   destination is the only place to put.

Unverified: whether `deleteElements` works on a note that is currently open in
the NOTE app, and whether the caption's `fontSize` and rect units are right — the
sizing is a best guess at the scale.

## Local patch to the vendor build script

`buildPlugin.ps1` step 10 never worked: `Start-Process` does not inherit
`Set-Location`, so Gradle ran in the project root where `gradlew.bat` does not
exist. Fixed locally with a full path plus `-WorkingDirectory`; original kept as
`buildPlugin.ps1.orig`. Worth reporting upstream.

## Known limits

- **Handwriting inside plugin views is impossible on this firmware.** Showing a
  plugin view makes the note app call `sendFullScreenDisableArea`, gating EMR at
  the hardware level; selective re-enable is blocked by SELinux. Finger touch
  works. Capture via lasso on the page is the supported path.
- **TZID is treated as device-local.** No timezone database is bundled, so a
  foreign-zone event can sit an hour out. Better than dropping it.
- **Settings JSON is plain text on shared storage**, password included. No
  keystore is available to a plugin. A Radicale credential scoped by a rights
  file is the mitigation; the `owner` field exists for exactly that case.
- **Keyboard avoidance is best-effort** — the host activity owns the window's
  soft-input mode, so the focused field is scrolled near the top rather than
  relying on the window resizing. Most likely thing to need tuning.
- The Android app's Gradle compile is only exercised by the native path; nothing
  runs the standalone app, so `MainActivity` is effectively untested.

## SDK lessons that cost a build cycle each

The vendor SDK reference is authoritative and answers most of these directly — read it before
guessing at an API. Three findings that were not obvious:

- **Use `PluginCommAPI.insertGeometry` for the current page, not
  `PluginFileAPI.insertElements`.** The file-level API needs `PluginCommAPI.createElement()`
  first to allocate an element's native-side accessors, and a saved file underneath it. A
  hand-built element object pushed straight at it draws nothing and reports success — which
  looked exactly like "shading is broken".
- **Inserts do not repaint.** They land in the host's in-memory page; call
  `PluginCommAPI.reloadFile()` afterwards. This is why the box worked and nothing else did:
  the box is drawn by the live lasso path, the inserts were not.
- **Flush before reading a file you have open.** `PluginFileAPI.getElements` reads disk, so
  call `PluginNoteAPI.saveCurrentNote()` first or a mark made this session may not be there.

`getLassoRect`, `insertGeometry` and text-link rects are all **pixel** coordinates on the
current page, so no EMR conversion is involved and positions scale across device sizes on
their own. The exception was the caption's font clamp, now expressed as a fraction of
`getPageDisplaySize()` height — see *Page marking*.

## Bugs worth not rediscovering

- **`sanitise` clobbered defaults with `undefined`.** It names every config field
  explicitly, so a field a saved `settings.json` predates came back as
  `{key: undefined}` — and `{...EMPTY_CONFIG, ...sanitise(...)}` copies that over
  the default rather than falling through to it. Page marking silently never
  appeared for anyone with older settings. `defined()` now strips undefined
  values; `__tests__/settings-merge.test.ts` guards it. **Any new optional
  setting inherits this trap if that helper is removed.**
- **`${'$'}` in Kotlin emits a literal dollar.** `"${'$'}line ${'$'}word"` drew
  the caption as the text `$line $word`. Use plain concatenation in generated
  Kotlin rather than string templates.
- **A stale auto-close timer caused the double-tap.** `closePluginView()` firing
  after the user had already left desynced the host's view state, and the next
  button press was spent resyncing. The timer lives in a ref and is cleared by
  `close()`.
- **`await refresh()` before auto-close read as "it didn't close"** — a network
  round trip plus a filesystem scan between the confirmation and the exit. A
  `closeAfter` ask now skips the refresh entirely.
- **Refresh was driven by a `useEffect` on `screen`**, which only fires when
  `screen` changes — leaving via the host's own dismissal instead of Done & Exit
  left it at `'hub'`, so the next opening never refetched. `openHub` refreshes
  directly on the button press.

## Tested on device and settled

The four items this section used to list — shading drawing at all, the caption
appearing, save being available immediately, completion clearing everything —
have all been tested on hardware and fixed. See *Page marks* above for what each
turned out to be. What follows is kept for the shape of the checks.

## Previously: next session — test these on device

None of it could be verified off-device, and all of it changed last:

1. **Shading draws at all**, and at a sensible weight. `MARKER_PEN.penWidth` (2200, in
   `src/markstyle.ts`) is the one value inferred rather than measured — the device reported
   3800 for a hand-drawn marker stroke.
2. **The "Task Hub Task" caption** appears, and its size and offset look right against the
   handwriting. The `fontSize` units were a best guess at the scale.
3. **Save is available immediately** after a lasso — the capture screen no longer fetches
   anything.
4. **Completing a captured task clears box, caption and shading together.**


## What changed on 2026-09-06 (publication and licensing)

Nothing in this session touched device behaviour — it was all repository,
documentation and licensing work. Both repos are clean and pushed.

- **Relicensed the plugin to GPLv3**, matching the server, at the maintainer's
  instruction. Added `LICENSE` (byte-identical to the server's), rewrote the
  README licence section, set `"license": "GPL-3.0-or-later"` in
  `package.json`. The earlier "not open source, all rights reserved" position
  is **superseded — do not reintroduce it**. Dependency licences were checked
  and are compatible: React Native and `sn-plugin-lib` are both MIT.
- **Scrubbed the personal email from git history in both repositories.**
  `git filter-branch` rewrote 28 commits here and all 110 in
  `Sparkinman/task-hub`, then both were force-pushed. Trees were verified
  byte-identical before and after. The cause was that neither repo had a
  *local* git identity, so the global one leaked; the global identity is now
  `Sparkinman <sparkinman@users.noreply.github.com>` and both repos also set it
  locally. Local-only `refs/original/*` backups still hold the old commits on
  this machine; nothing leaky was pushed.
- **Two features got proper README coverage**: notes attached to calendar
  events (and that a recurring event's occurrences all resolve to one note),
  and the `↩ page` chip that reopens the note and page a task was captured on.
  Both were previously buried and absent from the comparison table.
- **Announcement copy** is saved in `drafts/` — `reddit-long.md` (~1,400 words)
  and `reddit-short.md` (~300). The directory is gitignored, so it lives on
  this machine only and is not published with the repo.

### Left open

- The repo still has **no description and no topics** set on GitHub.
- A stray tag `backup-before-author-rewrite` sits on the remote. It points at a
  *rewritten*, clean commit so it leaks nothing, but it is clutter and could be
  deleted from the GitHub Tags page.
- GitHub keeps the pre-rewrite commits reachable by direct SHA until it
  garbage-collects. They appear nowhere in the UI or in a clone; GitHub Support
  can force a GC if that ever matters.

## What changed since 2026-09-03

A large batch, all on `main` and all released. In rough order of how much of the
code they touch:

- **Sub tasks.** `RELATED-TO;RELTYPE=PARENT` read and written; families arranged
  by their soonest outstanding step, folded by default, in the task list and the
  day view. Steps can be added one per line, take the parent's due date, and a
  line ending `@2026-09-10` dates that step on its own. The same rule is
  implemented in the Task Hub web app (`parse_step_line`) so the same text
  produces the same tasks wherever it is typed.
- **Priority** across the whole RFC 5545 range, stored as the raw number so
  another client's `PRIORITY:3` survives an unrelated edit.
- **Repeats** matching the web page's five choices; a rule the menu cannot name
  reads as `custom` and is left byte-identical.
- **Period notes** — week, month, quarter and year alongside daily, each with
  its own folder, layout, template and on/off switch. `periodnote.ts` is the
  pure module; every day inside a period must produce the same path, which is
  what its tests are mostly about.
- **Year and quarter views**, week numbers in the month gutter, configurable
  agenda hours.
- **Templates** from MyStyle and from anywhere on the device, via a new native
  `listFiles` / `listFilesHere`.
- **Page marks fixed** — see *Page marks* below.
- **Runs without a server.** Settings used to refuse to save until a task list
  was ticked, which put every note feature behind a CalDAV server none of them
  needs.
- **e-ink work**: no Modals anywhere (each was a second Android window), no
  spinners, no translucent scrims, memoised grids and rows, scoped reloads,
  panel-relative sizing.

## Page marks — what was wrong and why

Four separate bugs, all found by reading Ratta's own documentation through their
MCP server rather than the SDK sources:

1. `getLassoRect` requires a live selection, and `markPage` was reading it AFTER
   `setLassoStrokeLink` had consumed the lasso. Both inserts were handed the
   bounds of a selection that no longer existed.
2. `insertTextLink` and `insertGeometry` report their real outcome in `result`
   (0 success, -1 failure), not in `success`. Reading only `success` treated a
   refusal as a success, which is why nothing appeared and nothing was said.
3. `penColor: 202` is not a value `insertGeometry` accepts — the Geometry
   reference documents 0, 157, 201 and 254. 202 was read off a hand-drawn
   stroke, which is a different list.
4. `saveCurrentNote` is required before `reloadFile`, or the reload re-reads the
   file and discards both unsaved inserts.

The caption is now a plain TextBox (`insertText`), not a second link, so one
captured task leaves exactly one link on the page. Cleanup finds it by its text
and position rather than by a destination it no longer has, and matches both the
below-the-box and beside-the-box placements that shipped.

## Panel sizing

`UI_SCALE` in `src/components/common.tsx` interpolates between two measured
points: a Nomad reports a window height of 998 and reads well at 70%, a Manta
reports 1365 and runs at full size. Note those are density-independent pixels,
NOT the panel's own — this was got wrong twice, first with a reference of 1850
(both devices clamped to 100%) and then 2560 (both clamped to the floor). Both
times the tell was that the two panels reported the same scale.

`fs()` scales type, `sp()` scales padding, margins, gaps and minimum heights.
Borders are deliberately not scaled, and positive spacing never rounds to zero.

## Open threads

1. Two-way sync — nothing is read back beyond listing. No un-complete, no
   dedupe, no offline queue.
2. Per-task identity in a page mark, so copies can be told apart (see *Page
   marking* above).
3. `ios/` is dead RN template scaffolding, still full of `tasksync` names.
   Deleting it was offered and not yet decided.
4. `matchesFilter` / `DUE_FILTERS` in `src/ical.ts` are exported and tested but
   unused since search + sort replaced the filter chips. Delete, or reinstate an
   Overdue/Today row on the Tasks tab.
5. Day view's two-column split is unverified for cramping on a real panel.
6. Publish-review item 7 (end-to-end device testing) is still the author's to do.

---

### CalDAV discovery is standards-based, not path-guessing

`discoverCollections` used to PROPFIND `<server>/<username>/` directly. That is Radicale's
layout and nobody else's, so **Discover** silently found nothing on Nextcloud
(`/remote.php/dav/calendars/USER/`), Baikal (`/dav.php/calendars/USER/`) or Fastmail
(`/dav/calendars/user/EMAIL/`).

It now walks RFC 6764: PROPFIND `current-user-principal` against `/.well-known/caldav`, then
the configured URL, then the bare origin; PROPFIND `calendar-home-set` on whichever principal
answers; then the Depth:1 enumeration against that home. If none of it answers, it falls back
to the old `<server>/<username>/` guess, so Radicale keeps working even where well-known is
not served.

Two things worth not re-litigating:

- **An explicitly set `owner` short-circuits the whole walk.** That field exists because the
  wanted collections are *not* the login's own — a credential scoped by a rights file — and
  the well-known walk can only ever report where the login's own calendars live. Asking the
  server would return the wrong home.
- **A 401 throws `AuthError` rather than falling through to the next candidate.** Otherwise
  bad credentials look identical to a server that does not serve well-known, and the user
  gets "no task lists found" when the real problem is their password.

Covered by `__tests__/discovery-wellknown.test.ts`.
