# Getting started

## Installing

1. Download **`TaskHub-<version>.snplg`** from the
   [latest release](https://github.com/Sparkinman/task-hub-supernote-plugin/releases/latest).
2. Copy it to your Supernote over USB or ADB — anywhere you can browse to.
3. On the device: **Settings → Apps → Plugins → Add Plugin**, and choose the
   file.
4. Open any note. **Task Hub** appears in the toolbar, and in the lasso toolbar
   when you select handwriting.

> **Use Add Plugin, not Reinstall.** Reinstall runs the host's own stored copy
> of the plugin rather than the file you just added, so an update installed that
> way silently keeps the old version.

## What works immediately, with nothing configured

- **Daily, weekly, monthly, quarterly, yearly and meeting notes** — created and
  opened from the calendar, in folders and layouts you choose.
- **Templates** — from MyStyle or anywhere on the device.
- **The calendar views** — year, quarter, month, week and day, with your notes
  marked on them.
- **Find** — searching keywords and starred pages across those notes.
- **Capturing handwriting into a note-linked task** needs somewhere to put the
  task, so that one does need a connection.

The Tasks tab is empty until you connect something. If you have no server, set
**Open on → Calendar** in Settings so the plugin opens where your features are.

## Adding tasks and a calendar

Three routes, covered in full in
[Connecting your tasks and calendars](connections.md):

1. **[The Task Hub server](https://github.com/Sparkinman/task-hub)** — the
   easiest way to get two-way sync across Google, Outlook, Todoist, TickTick,
   Apple, the Supernote To-Do app and more, all at once. Self-hosts in one
   command; runs on a Raspberry Pi.
2. **Any CalDAV server** — Nextcloud, Fastmail, Baïkal, Radicale, iCloud and
   many others. Two-way.
3. **An `.ics` subscription** — read-only, needs no account, and the only way to
   see a Google or Outlook calendar without a server.

## Permissions

The first time Task Hub touches the network or your files, Android asks. Decline
either and the matching feature fails quietly, so allow both:

- **Network** — for your server, any calendar you subscribe to, and Supernote
  Cloud if you connect it. Nothing is sent anywhere else.
- **Files** — to create and open notes, to read keywords and starred pages, and
  to store settings in `Document/TaskHub/`.

## Where your data lives

| What | Where |
|---|---|
| Settings, including your server password | `Document/TaskHub/settings.json` |
| Task and calendar cache, so the plugin draws instantly | `Document/TaskHub/cache.json` |
| The Find index | `Document/TaskHub/noteindex.json` |
| Page previews | `Document/TaskHub/previews/` |
| Subscribed calendars | `Document/TaskHub/feeds.json` and `feed-*.json` |
| Your notes | Wherever you configured them — `Note/Daily` and friends by default |

All of it survives updating or uninstalling the plugin, because none of it is in
the plugin's own folder.
