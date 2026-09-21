# Troubleshooting

## The plugin did not change after I updated it

Install with **Add Plugin**, not Reinstall. Reinstall runs the host's own stored
copy rather than the file you just added, so the old version keeps running with
no sign that anything went wrong.

## Discover finds nothing

- Check the **server address** is the server's, not one calendar's. Task Hub
  works out the rest.
- Some providers require an **app-specific password**, not your account
  password. Apple iCloud always does.
- If your collections belong to a different account from the one you log in as,
  set [**Owner**](settings.md#owner). Discovery otherwise asks where *your*
  calendars are, which is not where they are.
- A wrong password is reported as a sign-in failure, not as "nothing found", so
  if it says nothing was found the credentials reached the server.

## A task list I do not recognise appears

A list named after your account is your calendar **home** — the folder your
calendars live in, not one of them. Older versions listed it. It is removed
automatically now; if one lingers, tap **Discover** and save.

## A list I deleted still warns me

Ticked collections are remembered in your settings independently of what the
server offers, so one deleted on the server stays in your list. The warning
carries a **Remove** button, and Settings marks it *not on the server*.

## Subscribed calendars are slow

Expected, and a property of the format — a `.ics` feed is one file containing
every event the calendar has ever held, with no way to ask for less. See
[why a subscription is read-only and slower](connections.md#why-a-subscription-is-read-only-and-slower).

The first fetch is the slow one. After that an unchanged calendar is neither
downloaded nor re-parsed.

For editable calendars that load like any other, use the
[Task Hub server](https://github.com/Sparkinman/task-hub).

## Importing calendars.txt does nothing useful

Task Hub reports what it found directly under the button. Common causes:

- The file is not in **`Document/TaskHub/`** — the same folder as
  `settings.json`.
- Windows hides extensions, so `calendars.txt` may really be `calendars.txt.txt`.
  The message lists what is actually in the folder.
- A line is an `http://` address. Only `https://` is accepted, because the
  address is the credential.
- Notepad writes an invisible byte-order mark at the start of a file. That is
  stripped automatically now.

## I cannot edit an event

Events from a [subscription](connections.md#ics-subscriptions) are read-only:
there is no address to send a change back to. Tapping one explains this. You can
still attach a note to it.

## My Supernote sign-in stopped working

The session lasts **thirty days and cannot be renewed** — Supernote offers no
way to refresh it. Sign in again in Settings with a fresh emailed code. Settings
always shows how long is left, and you are warned a week ahead.

## A completed task's mark is still on the page

Fixed in 0.71.2, which repaints the page after removing the mark. If you see it
on an older build, reopening the note shows the mark gone.

Two cases are by design: **shading left behind when the handwriting was moved**,
and **a copied captured task**, where completing one copy clears the mark from
both. Both are explained in [Capturing handwriting](capture.md#two-limits-worth-knowing).

## Find shows nothing

- Check the note types you use are **switched on** in Settings. A disabled note
  type is not searched.
- Find lists **keywords and starred pages**, which are things you add on the
  device. It does not read your handwriting.
- Tap **Rescan** if you restored notes from a backup — a restored file can carry
  its old modification time, which is what the index compares.

## Today did nothing when I came back from a note

Fixed in **0.81.3**. On earlier builds, the day Task Hub reopens on is read from
storage a moment after the panel is usable, and that read overwrote anything you
did in the meantime — so pressing **Today** straight after coming back from a
note appeared to do nothing, and pressing it a second time worked.

It showed up most often after **Insert snapshot**, because that hands over to the
note it has just written, and the day it records is whichever week or month you
had paged to. Choosing a tab in that first moment could be undone the same way.

## A meeting shows at the wrong time

Fixed in **0.82.0**. An event booked in a timezone other than your device's — a
colleague in another region sending an invitation — was shown at the time it was
booked rather than the time it happens for you, so a meeting set for noon in New
York appeared at noon on a device in Denver, two hours late. All-day events were
never affected.

Task Hub now reads the timezone rules that arrive with the event, so it needs no
timezone database and works offline. If your calendar server sends an event
naming a timezone but omits the rules for it, the old behaviour still applies and
that event can be out by the difference between the two zones.

**If you edited such an event on 0.81.3 or earlier, check its time on the
original calendar.** Saving wrote back the time that was on screen, which moved
the meeting.

## Starting over

**Settings → Device → Wipe all save data** deletes `settings.json` and starts
fresh. Your notes are not touched.

