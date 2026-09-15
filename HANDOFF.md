# Task Hub — state as of 2026-09-15

Working Supernote plugin, installed and in real use. `pluginID vfmnvjq0i1hxf8gu`.
`tsc` and eslint clean, all verified 2026-09-15.
Current build **0.70.0** (versionCode 86). **513 tests across 32 suites.** 0.66.0 was the first of these actually
installed, and the four fixes in 0.67.0 all come from what it showed on the panel.

**Published** at <https://github.com/Sparkinman/task-hub-supernote-plugin> (public, `main`),
**licensed GPLv3**, with v0.64.1 released and `TaskHub.snplg` attached to it.

One plugin: **Task Hub** (`vfmnvjq0i1hxf8gu`).

The demo build was removed on 2026-09-06. It existed so somebody could try the
plugin before setting up a CalDAV server; lifting the server requirement made it
redundant — the real plugin now saves its settings and runs every note and
calendar feature with nothing configured. `src/mode.ts`, `src/demo.ts`,
`PluginConfig.demo.json`, `buildDemo.ps1`, `scripts/set_demo_names.py` and its
test suite are all gone, along with the `blockedInDemo` guard that sat on every
write path.

## What changed in 0.70.0 — making subscriptions cheap

0.69.0 shipped feeds that worked and were slow in three separate ways. All three
were found by reading the code back rather than on device, and all three are the
same mistake: a feed is not a windowed query and every saving the CalDAV path
has had to be rebuilt for it explicitly.

### It fetched everything and kept everything

`parseVEvents(body)` returned every event in the file and all of them went into
React state. A calendar with ten years of history put ten years into the month
grid, which re-renders against that array. `withinWindow` now cuts it to the
same **three months back, twelve forward** the CalDAV fetch uses, and widening
the view widens this too because it runs on every fetch against the live window.

**A repeating event is kept whatever its start date.** The master is what
`expand.ts` derives occurrences from, so dropping a stand-up begun in 2019 for
being old would silently empty the calendar of everything regular. That is the
one rule in this file worth not breaking.

### A 304 saved the download and then re-parsed anyway

The raw `.ics` was cached and a `304` re-read it from disk and walked it line by
line again. That is the expensive half: downloading is network time the user can
wait through, parsing thousands of VEVENTs in JavaScript is CPU time that blocks
the panel. **The parsed events are now what is cached**, as JSON, and a `304`
loads that and never touches iCalendar. `JSON.parse` of an array is an order of
magnitude cheaper than the line walk.

### The first parse froze the panel

`parseVEvents` is synchronous. `parseFeedBody` now cuts the body at
`END:VEVENT` boundaries and parses 200 events at a time with a turn of the event
loop between — `setTimeout`, not an awaited promise, because a resolved promise
is a microtask and yields to nothing. This works because `parseVEvents` collects
whatever lies between `BEGIN:VEVENT` and `END:VEVENT` and needs no `VCALENDAR`
wrapper, which only the first chunk has.

### Feeds blocked the collections

`listEvents` awaited the feeds before returning, so nothing reached the screen
until the slowest subscription answered. Split into `listFeeds`, run as its own
errand with its own place in the loading count: the CalDAV collections draw as
soon as they land and the subscriptions merge in behind them, by the same key
the widening fetch uses.

### And the instructions

The settings fold now walks through the setup file in five numbered steps with
the exact filename, the exact folder and a worked two-line example, instead of
one paragraph that assumed the reader already knew the format.

## What changed in 0.69.0 — `.ics` subscriptions

The answer to "what about Google, Outlook, Apple". Open thread 10, closed.

### Why a feed and not an integration

Re-checked against the live docs rather than assumed:

- **Google** withdrew basic-auth CalDAV on 14 March 2025. Its CalDAV endpoint
  requires a full OAuth application flow; no password, app-specific or
  otherwise, reaches it.
- **Microsoft** retired CalDAV for Outlook.com and 365 entirely. The
  replacement is Graph, a REST API.

So no CalDAV client can reach either, Task Hub included, and that is not a
shortcoming to be fixed in the plugin. Both still publish a private `.ics`
address per calendar, as do Apple, Fastmail and Proton — which needs no account,
no token and no registered application.

**Real two-way sync with Google or Outlook does not belong in the plugin**, and
this is the reasoning, so it does not get re-litigated: an OAuth client secret
inside a GPL `.snplg` is extractable by anyone who downloads it; Google's
verification review for calendar scopes is a real non-code cost; and a plugin
that only runs while it is open cannot refresh a token in the background. The
Task Hub **server** can do all three, and the plugin already reads whatever it
exposes over CalDAV. Feeds exist for the person who does not run that server.

### How it is built

- `src/feeds.ts` is pure and tested: URL rules (`webcal://` upgraded, `http://`
  refused because the address *is* the credential), the `Name|URL` setup-file
  format, and the stored list. Note the setup file splits on the **last** bar —
  a URL cannot hold an unescaped one but a calendar name readily can.
- `src/feedfetch.ts` does the network, with a **conditional GET** (stored
  `ETag` / `Last-Modified` → `If-None-Match` / `If-Modified-Since`) and a copy
  kept on disk so a cold or offline open still draws.
  **As shipped in 0.69.0 this was not enough, and the note here originally
  overclaimed it** — see 0.70.0 below, which is where the caching, the windowing
  and the non-blocking fetch actually landed.
- Feed events carry `readOnly: true` — stated, not inferred from the empty
  `href`, because the UI has to honour it everywhere an event can be tapped.
  `openEventEditor` refuses one with a notice naming the calendar.
- **Meeting notes still work on them**, and this is worth knowing: that link is
  `meetingLinks[uid] → path` in the device's own settings and touches the server
  at no point, so it is the one "attach something to an event" feature that
  never needed write access.
- `hasCalendars` counts feeds. Without that, somebody whose only calendar is a
  Google feed was told their calendar was unconfigured while their events sat
  on screen.
- A feed's announced `X-WR-CALNAME` is held in **component state, never written
  back to settings**. The fetcher already labels the events with it, so the
  stored name is cosmetic — and writing it through `changeConfig` would mark the
  settings form edited behind the user's back on a refresh they did not ask for.

### In Settings

A **sibling** fold to the server one, not an alternative. Tasks (VTODO) only
ever come from CalDAV, so somebody running Radicale for tasks may still want
their work Outlook calendar beside it; making it a choice between the two would
have forbidden that combination for no reason.

Addresses can be pasted, but the intended route is a plain text file:
`Document/TaskHub/calendars.txt`, one address per line, optionally
`Name|https://…`. A private feed address is around a hundred characters of
random and typing one on this keyboard is miserable enough that people give up.
A fixed path rather than a file browser, because browsing for the file would put
back the fiddling the file was meant to remove. The fold tells the user to
delete it afterwards, since those addresses are as good as passwords.

### Still open

Nothing here is device-verified. The things most likely to need attention:
whether Android's `fetch` surfaces `etag` through `response.headers.get`, and
how long a first fetch of a large Google calendar actually takes on the panel.

## What changed in 0.68.0

### A task row opens; only its tick box completes

All three calendar views disagreed with each other, and none of them was right:

- **Day** made the *whole row* complete the task, with the `☐` merely drawn
  inside that one Pressable. Tapping a task to read it wrote to the server.
- **Week** made none of it tappable at all — the row was a plain `View`.
- **Month** opened the editor from the whole row, but its box was also just
  text, so that panel could open a task and never complete one.

All three now split the row: a `paneCheckHit` Pressable around the box calls
`onCompleteTask`, and the rest calls `onEditTask`. The box target is padded well
beyond the glyph and given `hitSlop` on top — it is the one control there that
writes to the server, so a pen landing near it should miss rather than complete
the wrong thing.

### The task and event editors fit one panel

Both were single columns about two panels tall with the actions at the bottom,
so saving an edit meant scrolling past every field to reach Save. Both now use
the capture screen's arrangement, which is the house style for forms here:
essentials first, everything else behind **More…** which *swaps* the body rather
than lengthening it, and the actions in a `pinnedBar` at the foot. The header's
own Save action is gone from both, since it would be a second one.

`taskMore` is reset in `openTaskEditor` and `eventMore` when an event form is
opened: an editor that opened onto whichever page it was last left showing would
hide the title of the thing just tapped.

The event editor was not asked for, but leaving one of two identical forms
scrolling would have been an inconsistency worth nobody's time.

### "Done & Exit" is now "↩ Back to note"

It described the act but not the destination. The plugin is always opened from
inside a note, so where you land is the part worth stating — nobody doubts they
are finishing, only whether they are about to leave the note app entirely. The
↩ is the same arrow the source-page chip uses, so the two read as the same kind
of move.

The string is now a single `EXIT_LABEL` constant in `common.tsx`: the two header
shapes each carried their own literal, and they must never disagree about the
way out.

## What changed in 0.67.0 — all four from screenshots of 0.66.0

### The phantom `paul`, third and final attempt

Two previous fixes both missed, and the reason is worth keeping. The row is not
produced by discovery at all — it is a **tick saved in `settings.json`** by a
build that used to offer it. Settings are durable and independent of what
discovery finds; that is the entire point of them. So excluding the home from
discovery (0.65.0) changed nothing visible, and pruning on **Discover** (0.66.0)
only helped somebody who happened to press Discover.

`pruneContainers` now runs as settings come off disk. A saved collection whose
URL is a strict ancestor of another saved one is a container, not a calendar —
CalDAV servers put calendars beside each other under the home, never nested — so
it goes without a round trip or a prompt. Deliberately conservative: it fires
only when a saved descendant proves the relationship, so a lone collection is
never deleted on a guess.

**The general lesson: a fix to what the server offers does nothing about what is
already saved.** Any change to discovery needs a matching migration of stored
settings.

### "Saving a task needs a task list" on a configured device

`capture()` read `getConfig()` when the lasso was pressed and set a one-shot
error status if `isConfigured` was false. On a cold start that runs **before
settings have come off disk**, so it fired for people who were perfectly well
configured — and a one-shot status is never re-evaluated, so it then sat there.

It had presumably always done this and simply been below the fold; fitting the
capture screen to one panel is what made it visible. It is now rendered
declaratively from the live config (`collectionUrls.length === 0`), so it
appears and disappears as settings arrive.

**Do not report a configuration problem from a one-shot status set at open
time.** Render it from the live config, or it will be wrong on every cold start.

### The time picker had two ways to set one value

The typed field survived the rewrite alongside the new grids, which just looked
like a bug. Removed, along with `forDisplay`, `fromDisplay`, the input ref and
the `scrollHandle` / `onScrollTo` props — with no text input left there is
nothing to lift clear of the keyboard, so those came off `Props` and off all
nine call sites.

The cost is that minutes are now a five-minute grid and nothing else: **3:47 is
unreachable.** That was the deliberate trade for having one control instead of
two. If it ever matters, widen the minute grid rather than putting the field
back.

### Previews were too tall

A whole page at half the panel's width is most of a panel high, and the bottom
two thirds of a note page is almost always blank ruled lines. The frame is now
**square and shows the top of the page** — `position: absolute; top: 0` on the
image rather than `resizeMode: 'cover'`, which crops from both edges and would
throw away the first lines. Same width, so the same legibility, half the height.

Previews now apply to a keyword's pages too, but only once that keyword is
expanded: the view reports the expanded pages upward and the render loop draws
those as well as the starred ones. Rendering a page for every keyword in the
index would be exactly the unbounded work the index exists to avoid.

## What changed in 0.66.0

### The time picker offers values instead of stepping to them

See *Panel sizing* below for the general rule; this is the concrete case. The
old picker was four arrows around a readout — a pair for hours, a pair for
minutes stepping by five — so reaching 3:45 pm from the noon they began at was
about a dozen taps, each a full e-ink repaint. Hour and minute now each open a
grid of values; AM/PM is a pair of chips, because a menu that opens to reveal
one alternative is a tap spent on nothing.

**The grids expand inline, never as an overlay.** An absolutely-positioned
overlay inside a ScrollView is positioned against the row that opened it,
scrolls away with the page, and refuses touches outside its parent's bounds —
the template picker was broken that way twice. Expanding in place has none of
those failure modes and matches `Choice`, which the forms already use
everywhere. The typed field stays: a five-minute grid cannot reach 3:47.

The `Arrow` component and its styles are gone. The earlier request that the
arrows be inverted is **superseded**; do not reinstate steppers on its
authority.

### One rule for an event's end time

The event editor held it inline; the capture screen needed the same thing. It is
now `endForStart` in `src/format.ts`, tested. It keeps the **duration**, not the
end — a ninety-minute meeting dragged from 09:00 to 14:00 is still ninety
minutes — and falls back to an hour when there is nothing to keep. An empty
start means all-day, which carries no end.

Worth knowing: `minutesBetween` reads an end earlier than its start as crossing
midnight, so 14:00–10:00 is a twenty-hour event rather than an error. But
`buildVEvent` writes DTEND against the event's **single** date, so such a pair
is actually stored as finishing before it began. The capture screen now warns
about it (`endsBeforeStart`); properly supporting overnight events needs a
second date on the draft, which the format does not carry.

### `paul` again — the first fix was only half of it

0.65.0 stopped the calendar home being *discovered*. It did not remove the copy
already sitting in the user's saved `collectionUrls`, which is why the row
survived the fix. Settings are durable and independent of discovery; that is the
whole point of them.

`discoverCollections` now returns `{collections, home}`, and **Discover** prunes
any saved tick matching the home and says that it did. Discovery is the only
moment the home's URL is known, so it is the only place this can happen.

### Page previews on the Find tab

A **Previews** button on the Starred section swaps the list for a two-column
grid of rendered pages. Off by default: every tile is a real render.

- `PluginFileAPI.generateNotePng` takes **`notePath`**, not the `NOTEPath` its
  published signature shows — the shipped typings and that same page's own
  parameter table both say `notePath`. `type: 1` for a white background; a
  transparent one shows as black wherever the page is blank.
- Rendered once and kept in `Document/TaskHub/previews`, named by a djb2 hash of
  path, page and modification time — so a page redrawn after its note changed
  lands under a new name rather than needing invalidation. There is no stat
  call, and `generateNotePng` re-renders whatever it is pointed at, so one
  directory listing per session is what makes the cache a cache.
- Rendered **one at a time**, published as each lands, and cancelled when the
  reader leaves. Firing a few dozen at once competes with the panel's own
  repainting and they all arrive at the end instead of filling in.
- Two columns, not four: a page shrunk to a quarter of the panel is texture, not
  handwriting, and a preview you cannot read is worse than the row it replaced.

Recognised text beside each star was considered and rejected — there is no API
for it, it means `getElements` plus `recognizeElements` per page, and a
thumbnail of the actual handwriting is more informative than a recognition
guess for similar cost.

## What changed in 0.65.0 — none of it device-verified yet

Four things in one build, batched deliberately: there is no device on the build
machine, and install cycles are the scarce resource.

### Find: keywords and starred pages across the note folders

A third tab beside Tasks and Calendar. It lists every **keyword** and every
**starred page** in the daily, weekly, monthly, quarterly, yearly and meeting
note folders, and tapping a result opens that note at that page.

Named **Find** rather than Search, Notes or Marks, and every one of those was
rejected for a reason worth keeping: *Search* is already the label on the Tasks
tab's own filter field; *Notes* overpromises a notebook browser when this only
indexes marks inside notes; *Marks* collides with Task Hub's own page marking
(`markStyle` / `markLabel` / `markShade`).

It opens **showing** results rather than waiting for a query — starred pages
first, keywords underneath, filter above both. A Supernote keyboard is slow
enough that a view which is blank until you type is a view nobody opens twice.

What makes it affordable:

- **Only two things are readable from a closed file, and both are exact.**
  `PluginFileAPI.getKeyWords(path, pageList)` returns `{keyword, page, index}` —
  real text, no recognition. `searchFiveStars(path)` returns page indices.
- **Titles are deliberately not indexed.** `getTitles` returns geometry and
  style and **no text at all** — a title is handwriting the device knows is a
  heading. Searching one means `getElements` plus `recognizeElements` per page
  per note. That is a different feature with a different cost; do not let
  "search my notes" quietly grow into it.
- **`getKeyWords` takes a page list, not just a path** — contrary to the
  skill's own reference file. So it needs `getNoteTotalPageNum` first, which
  makes three native round trips per note that has to be read.
- **Hence the index.** `src/noteindex.ts` caches per note in
  `Document/TaskHub/noteindex.json`, keyed by path and reused whenever
  modification time *and* size both still match. A second visit reads only what
  changed. `listNotesWithMeta` was added to the Kotlin module for those two
  fields; the old `listNotes` is untouched because every other caller wants only
  paths.
- **The scan is lazy**, on first entry to the tab, like the calendar's folder
  walk — none of the hard-won opening speed is spent on a tab you may not open.
- `src/notesearch.ts` is pure and holds the labelling, matching and grouping;
  `noteindex.ts` only makes the calls. Root handling has two traps: several
  periods can share one folder (the "one folder for everything" button), so
  such a root gets **no** period label rather than an arbitrary one; and a root
  nested inside another is dropped from the walk while still being used for
  labelling, by longest match.
- A note that refused to be read is **counted and said out loud**, never
  silently omitted, and is not cached as empty — otherwise a note that happened
  to be locked once would stay invisible until it was next edited.

### A spurious collection named after the account

Reported on device: the save screen offered `paul-tasks` — a real list — and
also just `paul`, which named nothing the user recognised.

`Depth: 1` describes the collection it was sent to **as well as** its members
(RFC 4918 §9.1), so the calendar home is always in the multistatus, and
`parseCollections` had no filter for it. A server that advertises the home as
calendar-ish therefore produced a row named from the last segment of its own
URL — the account name. `parseCollections` now takes the home URL and drops it.

Second half of the same fix: `collectionHint` shows a collection's path beside
its name, but **only** when the name came from the URL fallback or when two
watched collections share a name. Putting a URL on every row would turn a short
pick list into a wall of addresses.

### An event can now be captured from handwriting

The lasso could only become a task. It can now become a calendar event, chosen
with a Task / Event switch at the top of the capture screen rather than by a
second button on the note app's shared lasso toolbar.

`EventDraft` and `VEvent` gained `sourcePath` / `sourcePage`, written and read
as `X-TASKHUB-SOURCE` and `X-TASKHUB-SOURCE-PAGE` exactly as a captured task
carries them — deliberately not in DESCRIPTION, which stays the user's own
space. Page marking runs identically and, as for a task, **last and never
fatally**: the event is already on the server by then.

### The capture screen fits one panel

It was a single column about two panels tall — title, lists, due, priority,
repeats, description, sub tasks, their date, and only then the buttons — so a
two-second lasso led to a screen that needed scrolling before it could be
finished.

Now the essentials sit on the first panel and the rest is behind **More**,
which *swaps* the body rather than lengthening it, and the actions are a bar
pinned at the foot. The style is shared with the settings form and was renamed
`settingsBar` → **`pinnedBar`** accordingly, with `flexWrap` added because the
capture bar carries three buttons and the narrowest panel at its smallest scale
would otherwise push Save off the edge.

The ScrollView is kept underneath as a safety net rather than removed. A panel
smaller than any measured here, or a keyboard over a short screen, must not be
able to put a control out of reach — that is precisely how "Save and exit had
gone missing" happened.

## What changed in 0.54.0 – 0.64.0

All device-verified unless said otherwise. Roughly in the order it was done.

### Settings were unusable in two ways

**The template picker covered the page and could not be tapped.** `TemplatePicker` drew its
grid inline, inside the settings `ScrollView`, and `styles.overlayScrim` is
`position: absolute` — so it was positioned against the *row* that opened it rather than
against the window. It painted over whatever settings were underneath, scrolled with the
page, and Android does not deliver touches to a child drawn outside its parent's bounds, so
most of the tiles could be seen but not chosen. Split into `TemplatePicker` (the summary row)
and `TemplateSheet` (the grid), with the sheet mounted at the window root beside
`FolderPicker` and `MiniCalendar`. **Any absolutely-positioned overlay belongs at the root,
never in scrolling content** — this is the second time that has bitten.

**Save and exit had gone missing.** Commit `7ada139` removed both the header's Done & Exit
and the Save at the top of the page, leaving one pair of buttons about two thirds of the way
down a page many screens long. Scroll past them and there was no way out at all. They are now
a bar pinned at the foot of the window while settings are open — a flex sibling of the
`ScrollView`, not an overlay, so it cannot cover the last row, and the window is
`adjustResize` so it rides above the keyboard.

Browsing to a folder now goes through `changeConfig` rather than `setLocalConfig`, so it
marks the form edited; it did not before, and a slow settings load could wipe a folder just
picked.

### Opening got much faster

`EVENT_QUERY` had no `time-range`, so every opening downloaded **every VEVENT ever written**,
in full iCal, and parsed it in JS on an e-ink CPU. That was the bulk of the wait, and it grew
with the calendar. Now:

- `src/eventwindow.ts` (pure) decides a window — three months back, twelve forward — and
  widens it when the view moves outside. Widening fetches only the missing stretch and merges
  it by `href|uid|startAt`. The window resets to the default on every opening, or a session
  that wandered back to 2019 would make every later opening as slow as the widest thing ever
  looked at.
- Servers expand recurrence for time-range matching per RFC 4791, so repeating events are not
  lost by narrowing. A server that rejects the filter gets one unfiltered retry — an empty
  calendar would be a worse regression than a slow one.
- Parsing yields to the event loop every 40 objects. `setTimeout`, not an awaited promise: a
  resolved promise is a microtask and yields to nothing. This is what made an opening feel
  like a freeze rather than a wait — the panel had drawn, but taps went nowhere.
- `src/cache.ts` keeps the last lists in `Document/TaskHub/cache.json` so a cold open draws
  real content immediately. State holds the server's own objects; the cache and every write
  path see those, never anything derived.
- `loading` is a **count**, not a flag: the opening refresh and a widening fetch overlap, and
  whichever finished first used to clear the line while the other was still working.

### Recurring events only ever appeared once

`eventsOnDay` buckets by `startDate`, and the server returns one master VEVENT carrying an
RRULE — so a weekly stand-up showed on the day it was created and never again. `src/expand.ts`
(pure) reads `FREQ`, `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY`, and `EXDATE` is now parsed so
cancelled occurrences stay cancelled. Two traps, both caught by tests before the device saw
them:

1. **Editing an occurrence would have moved the whole series.** A repeat is one object on the
   server, so seeding the edit form with the tapped occurrence's date meant changing a title
   on the 14th silently rewrote DTSTART. Each expanded copy carries `occurrence.seriesStartDate`,
   the form uses that, and the editor says plainly that it edits the series.
2. **Monthly and yearly rules drifted.** Stepping a year on from 29 February lands on 1 March
   and every step after is anchored wrong. Each occurrence is computed from the start date
   rather than by advancing a cursor. The "this month has no 31st" skip must apply only to
   MONTHLY and YEARLY — applied to DAILY/WEEKLY it kills every occurrence after the first,
   because the day of the month legitimately changes.

Expansion is **derived for display** (`shownEvents`), never stored.

### A dead collection could not be removed

Reported on device: a calendar deleted from the server warned on every refresh, and the
warning said to open Settings and untick it — but the ticklists there are built from what
**discovery** finds, so a collection no longer on the server had no row and no box. The
advice could not be followed. Three fixes: the warning itself has a **Remove** button
(`forgetCollections`); stale entries are listed in Settings marked "not on the server"; and
URLs are compared with `sameCollection`, which ignores a trailing slash — the listing code
strips one before asking the server, so an untick comparing raw strings could silently fail
to match the very collection being removed.

### The date at the top of a new daily note — and how the first attempt failed

Optional, off by default, under Settings → Notes → Daily notes.

**The first attempt did nothing at all, silently.** It used `PluginNoteAPI.insertText` and ran
*after* `leaveForNote()`, which calls `closePluginView` — so the plugin view had already been
torn down, and `insertText` writes into whatever page is *displayed*, which nothing was. It
failed its wait and reported the reason only to logcat.

The working version writes into the **file**, before the note is opened and before the
handover:

- `PluginCommAPI.createElement(Element.TYPE_TEXT)` first, always. An object of the right shape
  is rejected outright — it must be allocated natively so the host finds its accessors behind
  the uuid. Same lesson the Tables plugin paid a round trip for.
- `PluginFileAPI.insertElements(path, 0, [element])`, and **no `saveCurrentNote` afterwards**:
  this wrote straight to the file, and saving would push the host's in-memory page back over
  it. That is the reverse of the rule for the in-memory calls. Getting the two the wrong way
  round destroys the work silently.
- The note is not open, so `getPageDisplaySize` has nothing to answer for; `getPageSize(path, 0)`
  is used and falls back to a Manta page if refused (it is FILE:READ-gated on recent firmware).
- Failure is reported **in the confirmation the user sees**, not only in logcat. A silent
  no-op is indistinguishable from the setting not working, which is exactly how the first
  attempt wasted a build cycle.

**`insertText` does not draw at the top of the rect it is given.** The glyph baseline falls
about `2.05 x fontSize` **below** `textRect.top`, and the call **ignores the height** entirely,
building a fixed-height element — what scales with the font is where the text sits inside it.
Taking the rect at face value put the "heading" a fifth of the way down the page. The figure
is taken from taoist22's `sn-datetime`, which measured it on hardware against 8mm ruled lines;
`src/headinglayout.ts` works backwards from where the glyphs should land. Not re-derived here,
because deriving it costs a build-and-install cycle to learn what somebody has written down.

### Notes, tasks, and the look

- **One folder for everything**: a button setting all six note types to one dated tree
  (`SHARED_TREE_LAYOUTS` / `SHARED_TREE_ROOT`), plus the same layouts as presets. Confirms
  first, and says plainly that existing notes are not moved.
- **Open on** — Tasks or Calendar. Shipped in 0.55.0 buried inside the "Date and time format"
  fold, where it was never found; it is now outside every fold at the top of Settings. A
  setting nobody would look for under that heading may as well not exist.
- **Tasks are grouped** Overdue / Today / Next 7 days / Later / No date (`dueBucket`,
  `groupRows`), cut against a timestamp captured per opening — the React tree outlives a
  close, so a plugin left loaded overnight would keep calling yesterday "today". Families stay
  whole. `DUE_FILTERS` stayed, and a test pins the two to the same boundaries.
- **Ticking an ordinary task no longer asks.** `perform` was split out of `runAsk` so an
  unconfirmed action still gets the same status, error handling and scoped reload. A captured
  task still confirms, because completing it edits the user's note.
- **Rounded corners throughout** (`R.sm/md/lg/pill`), a hairline month grid with neighbouring
  days filled in, the selected day as a filled pill, C/T/N as filled discs. Counts and
  progress bars were tried and rejected by the author — the circled letters say *which*, which
  is what a grid is read for.
- **Week view rebuilt**: horizontal strip plus Schedule / To-dos columns, matching the Day and
  Month views' order. Selecting a day emphasises its rows and greys the rest. A "now" rule was
  tried and removed as redundant beside today's outlined cell.
- Month and week both **select on first tap, open on second**.

## Build

```powershell
npx tsc --noEmit                              # MUST pass before building
npx eslint . --ext .ts,.tsx,.js
npx jest                                      # 447 tests, 25 suites
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
- **The time picker offers values, it does not step to them.** Hour and minute
  each open a grid of choices in place; AM/PM is a pair of chips. This replaced
  four inverted arrows (up decremented, by an earlier request that is now
  **superseded** — do not reinstate steppers on its authority), which took about
  a dozen taps to reach 3:45 pm from the noon they started at, each one a full
  e-ink repaint. The grids expand **inline, never as an overlay**: an
  absolutely-positioned overlay inside a ScrollView is positioned against the
  row that opened it and refuses touches outside its parent's bounds, which is
  how the template picker broke twice. The typed field stays, because a
  five-minute grid cannot reach 3:47.
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

- **A parser that names every field explicitly drops the next one you add.**
  `parseVEvents` builds its result with a literal listing each property, so
  `X-TASKHUB-SOURCE` was parsed into the accumulator and then silently thrown
  away on the way out — the write worked, the read came back `undefined`. This
  is the same shape as the `sanitise` bug below, and it was caught here only
  because a test asserted the round trip rather than just the written text.
  **Whenever you add a field to `VEvent` or `VTodo`, change three places: the
  interface, the `case` in the switch, and the object literal at `END:`.**
  Assert the round trip, not the output.

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
- **`setCalView` moves the selection to today, and that is easy to walk into.**
  Switching view deliberately jumps to today, because landing on wherever the
  last view happened to be pointing is disorienting. So `setDay(iso)` followed
  by `setCalView('day')` does *not* open that day: the switch runs second and
  puts the day back. Shipped in 0.63.0 as "tap a day twice to open it, and get
  today's day view instead", with the panel under the grid showing the right day
  the whole time — it reads the selection directly, so the two disagreed and the
  symptom looked like a rendering fault rather than a navigation one. **Use
  `openDayOn` / `openWeekOn`**, which exist for this and use the raw setter; the
  Year and Quarter grids were already using them. Fixed in 0.64.1, and
  `setCalView` now carries a comment saying so.

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
4. Day view's two-column split is unverified for cramping on a real panel.
5. Publish-review item 7 (end-to-end device testing) is still the author's to do.
6. **The calendar as an image in a note** — the next real feature, and what the author
   actually asked for when they asked about handwriting on the views. `PluginNoteAPI.insertImage(pngPath)`
   inserts a PNG into the current page and layer, and pictures are allowed on custom layers,
   so a day, week or month view could go onto its own layer with the user writing over it on
   the main one. Layer mechanics are proven in the Tables plugin: `modifyLayers` to make the
   layer current, write, restore in a `finally`, filter `layerId >= 0` or the call is rejected
   outright, and never leave the user on the plugin's layer. **Render the calendar
   purpose-built at page resolution — do not screenshot the plugin view**, which would be
   panel-resolution, soft when scaled, and full of our own buttons.
7. **Handwriting inside the plugin's own views is not worth attempting.** Checked against the
   docs: the only primitive is `PluginManager.registerMotionListener` (raw pointers,
   `toolType 2` is the EMR pen), the ink would have to be drawn in React Native on a panel
   that redraws in ~300ms, and pen events also reach the note file by a hardware direct path
   no overlay can gate — so it would need full-screen EMR disable throughout. Item 6 is the
   answer to the same want.
8. **A `YYYYMMDD` search keyword on daily notes**, so they are findable by date in the
   device's own search whatever the visible format is set to. `sn-datetime` does exactly
   this; not implemented here. Now more attractive than it was: `PluginFileAPI.insertKeyWord`
   is the write side of what the Find tab reads, so a keyword written at creation would show
   up in Find as well as in the device's own search.
10. ~~**Feeds: read-only iCal subscription**~~ — shipped in 0.69.0, see above. The original note,
   kept for the reasoning: read-only iCal subscription is the only way to reach Google Calendar
   and Outlook. Neither offers usable CalDAV — Google needs an OAuth application flow and
   Microsoft retired its CalDAV endpoint — so both publish a secret `.ics` URL instead, and
   that is exactly what taoist22's SNFolio does rather than integrating either service
   properly. Task Hub is already ahead on the CalDAV half: the RFC 6764 walk should reach
   iCloud, Fastmail, Nextcloud and Baikal today. The pieces exist — `parseVEvents` takes raw
   iCal text and `expand.ts` handles RRULE — so the real work is (a) read-only semantics,
   since every write path assumes a CalDAV `href`, and (b) the fact that a feed has no
   `time-range`, so the whole file arrives every refresh and needs conditional GET by ETag
   or the 0.54–0.64 opening-speed work is given straight back.
11. **The keystore limit below is probably wrong.** "No keystore is available to a plugin"
   is listed under Known limits, but SNFolio stores its credentials with Android
   Keystore-backed encryption, and Task Hub ships its own native module, so `AndroidKeyStore`
   should be reachable the same way. Unverified.
9. `matchesFilter` / `DUE_FILTERS` now serve as a cross-check in `dueBucket`'s tests but still
   have no UI of their own. Either build the filter row or let the buckets be the only cut.

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


