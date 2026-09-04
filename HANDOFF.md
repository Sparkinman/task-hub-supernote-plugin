# Task Hub — state as of 2026-09-03

Working Supernote plugin, installed and in real use. `pluginID vfmnvjq0i1hxf8gu`.
259 tests across 13 suites; `tsc` and eslint clean.

**Published** at <https://github.com/Sparkinman/task-hub-supernote-plugin> (public, `main`).

Two plugins ship from this one tree: **Task Hub** (`vfmnvjq0i1hxf8gu`) and
**Task Hub Demo** (`do3dzvwic8ss836h`). There is no fork — see *Demo build* below.

## Build

```powershell
npx tsc --noEmit                              # MUST pass before building
npx eslint . --ext .ts,.tsx,.js
npx jest                                      # 259 tests, 13 suites
.uildPlugin.ps1                             # ~15 s -> build/outputs/TaskHub.snplg (6.91 MB)
.uildDemo.ps1                               # -> build/outputs/TaskHubDemo.snplg, restores the tree
```

Metro does not typecheck, so a type error still produces a `.snplg` that crashes
on device. Never build on a failing `tsc`.

`build/generated` is never cleared by `buildPlugin.ps1`, and step 14 zips
whatever is in it — so a bundle left by the other variant gets packaged
alongside the real one. `buildDemo.ps1` clears it either side of its run; clear
it by hand if the two are ever built another way.

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
- **Python 3 on PATH** — `buildDemo.ps1` shells out to
  `scripts/set_demo_names.py`.
- **The device's own settings**, `Document/TaskHub/settings.json`. Server, login
  and every choice live there, not in the repo, and survive uninstalling the
  plugin. Clear it from Settings -> *Wipe All Save Data*.

Installing a build whose `app.npk` changed needs **Add Plugin**, not Reinstall:
reinstall reads the host's managed copy under `MyStyle/Plugins/` rather than the
file just pushed, so the old native payload is kept.

## Demo build

One source tree, two outputs. `buildDemo.ps1` flips three things, runs the normal
build, and restores them in a `finally`:

| | real | demo |
|---|---|---|
| `src/mode.ts` | `DEMO = false` | `DEMO = true` |
| `PluginConfig.json` | as committed | copy of `PluginConfig.demo.json` |
| `package.json` `name` | `TaskHub` | `TaskHubDemo` (sets the output filename) |
| `app.json` `name` | `TaskHub` | `TaskHubDemo` (the registered RN component) |

`DEMO` is a compile-time `const` that Metro folds, not a runtime setting — the
released plugin cannot be talked into demo mode, and the demo cannot be talked
into reaching the network. A jest test asserts `DEMO === false`, so an
interrupted build that leaves the flag set fails the suite rather than shipping.

The demo declares **no permissions at all**. Everything that would need one is
guarded: `refresh` returns `src/demo.ts` sample data instead of fetching,
`runAsk` refuses every write (all writes funnel through it, which is what makes
one guard sufficient), and the note-opening, folder-picker, template-listing,
discover and save-settings paths each check `blockedInDemo()`. Calling
`hasPermission` for an *undeclared* permission throws error 1500, so any new
code path that touches network or files must be added to that list.

Demo data is generated relative to `new Date()` at call time — never hard-coded,
or the demo looks broken when opened months later.

**The demo shipped dead once**, because `buildDemo.ps1` changed `pluginKey` but
not `app.json`'s `name`: `index.js` registers the component under the app.json
name, the host resolves it by `pluginKey`, and a mismatch installs cleanly then
does nothing at all — no buttons, no settings, no error. The script now derives
the demo name from `PluginConfig.demo.json`'s `pluginKey` and refuses to build if
the two disagree; a test asserts the same pairing for the committed files.

`buildPlugin.ps1` never clears `build/generated` and step 14 zips whatever is in
it, so a stale bundle from the other variant gets packaged alongside the real
one. `buildDemo.ps1` clears it either side of its run.

**Do not edit `src/mode.ts` or `PluginConfig.demo.json` by hand mid-build.**
PowerShell 5.1 corrupted all three swapped files on the first attempt:
`Get-Content -Raw` decodes UTF-8 as ANSI and `Set-Content -Encoding utf8` adds a
BOM. `buildDemo.ps1` now uses `[System.IO.File]` with an explicit no-BOM encoder.

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

### Not yet done on the repo

- **No release.** `gh release create v0.19.0 build/outputs/TaskHub.snplg
  build/outputs/TaskHubDemo.snplg --title ... --notes ...` — until this runs there is no
  download, and the `.snplg` files exist only locally (`build/` is correctly gitignored).
- **No LICENSE**, so all-rights-reserved by default: readable, not legally usable or forkable.
- **No repo description or topics** set yet (`gh repo edit --description ... --add-topic ...`).
- **`versionCode` is still 26** and `versionName` still `0.19.0` in both PluginConfig files,
  unchanged through everything since. The device uses `versionCode` to decide what counts as
  an update — bump both before handing out another build.

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

## Next session — test these on device

None of it could be verified off-device, and all of it changed last:

1. **Shading draws at all**, and at a sensible weight. `MARKER_PEN.penWidth` (2200, in
   `src/markstyle.ts`) is the one value inferred rather than measured — the device reported
   3800 for a hand-drawn marker stroke.
2. **The "Task Hub Task" caption** appears, and its size and offset look right against the
   handwriting. The `fontSize` units were a best guess at the scale.
3. **Save is available immediately** after a lasso — the capture screen no longer fetches
   anything.
4. **Completing a captured task clears box, caption and shading together.**

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
