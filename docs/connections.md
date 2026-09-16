# Connecting your tasks and calendars

Task Hub can read from four kinds of source. You can use any combination of
them at once — they are not alternatives, and most people end up with two.

| Source | Tasks | Calendar | Direction | Needs |
|---|---|---|---|---|
| [Task Hub server](#task-hub-server-recommended) | Yes | Yes | **Two-way** | A machine to run it on |
| [Any CalDAV server](#any-caldav-server) | Yes | Yes | Two-way | A CalDAV account |
| [`.ics` subscription](#ics-subscriptions) | No | Yes | **Read-only** | Nothing |
| [Supernote To-Do](#supernote-to-dos) | Yes | No | Two-way | A Supernote Cloud account |

---

## Task Hub server (recommended)

**<https://github.com/Sparkinman/task-hub>**

The easiest way to get two-way sync across everything, and the only way to get
it for Google Calendar, Outlook, Todoist, TickTick and several others.

You run it once — it self-hosts in a single command and is happy on a Raspberry
Pi — connect your services to it there, and point the plugin at it as an
ordinary CalDAV server. From the plugin's side there is nothing special about
it: it is one address, one login, and everything arrives as tasks and calendars
you can edit.

What it does that a plugin cannot:

- **Holds OAuth credentials safely.** Google and Microsoft both require a
  registered application with a client secret. A secret shipped inside a plugin
  is extractable by anyone who downloads it, so the plugin does not ship one.
- **Refreshes tokens on a schedule.** A plugin only runs while you have it
  open. A token that expires overnight cannot be renewed by something that is
  not running.
- **Talks to services with no open protocol.** Todoist, TickTick, Google Tasks,
  Microsoft To Do and the Supernote To-Do app each have their own API. The
  server speaks all of them and presents the result as CalDAV.
- **Keeps working when the device is off.** Sync continues without you.

Set it up with its own [getting started guide](https://github.com/Sparkinman/task-hub),
then follow [Any CalDAV server](#any-caldav-server) below to point the plugin at it.

---

## Any CalDAV server

Task Hub speaks plain CalDAV, so it works with Nextcloud, Fastmail, Baïkal,
Radicale, SOGo, Synology Calendar, mailbox.org, Posteo, Zoho, Apple iCloud and a
long list of mail providers.

**Settings → Task and calendar server.**

1. **Server address** — the address of the *server*, not of one calendar. For
   example `https://cloud.example.com` or `https://caldav.icloud.com`.
2. **Username** and **Password**. For Apple iCloud and several others this must
   be an *app-specific password*, generated in your account settings, not your
   ordinary one.
3. **Owner** — leave blank unless your collections belong to a different account
   from the one you log in as. See [the settings reference](settings.md#owner).
4. Tap **Discover**. Task Hub walks the RFC 6764 discovery path: it asks
   `/.well-known/caldav` who you are, asks that principal where its calendars
   live, then lists that home. Servers lay these paths out differently and this
   is the standard way to find them, so it works without you knowing the layout.
5. Tick the **task lists** and **calendars** you want. A collection that accepts
   both appears in both lists. The one marked for new tasks is pre-ticked when
   you capture handwriting.
6. **Save settings.**

CalDAV is the transport that loses nothing: times, timezones, priorities, repeat
rules, locations and notes all survive the round trip in both directions.

---

## `.ics` subscriptions

**Settings → ICS Calendars and Supernote To-Dos.**

A subscription shows a calendar that publishes a private web address. It needs
no account, no password and no server — but it is **read-only**, and it is
**slower to load** than a CalDAV calendar.

It exists because **neither Google nor Outlook can be reached by any CalDAV
client any more**:

- Google withdrew password access to its CalDAV service in March 2025. It now
  requires a full OAuth application flow.
- Microsoft retired CalDAV for Outlook.com and Microsoft 365 entirely. The
  replacement is Microsoft Graph, a different API altogether.

Both still publish a private `.ics` address per calendar, and so do Apple,
Fastmail and Proton. If you want those calendars **editable**, that is what the
[Task Hub server](#task-hub-server-recommended) is for.

### Why a subscription is read-only and slower

Worth understanding, because it is a property of the format rather than
something that can be fixed:

**Read-only.** A subscription is a file published at a URL. There is no address
to send a change back to, no authentication, and no protocol for editing. Task
Hub will not offer to edit an event from one — tapping it explains why rather
than letting a save fail. You can still attach a note to it, because that link
lives on your device and never touches the calendar.

**Slower.** A CalDAV calendar answers a query: Task Hub asks for three months
back and twelve forward, and that is all that crosses the network. A `.ics`
feed is **one file containing every event the calendar has ever held**, and
there is no way to ask for less. A calendar with ten years of history sends ten
years, every time, and all of it has to be parsed on an e-ink processor.

Task Hub does what can be done about it:

- **Conditional fetching.** The calendar's `ETag` is sent back on the next
  request, so an unchanged calendar answers "not modified" and nothing is
  downloaded.
- **The parsed result is cached, not the file.** Downloading is time you can
  wait through; parsing thousands of events in JavaScript is what makes the
  panel stop responding. An unchanged calendar is therefore never re-parsed.
- **The first parse is done in pieces**, a few hundred events at a time, so the
  screen keeps redrawing instead of freezing.
- **Only the window in view reaches the calendar**, the same three months back
  and twelve forward the CalDAV side uses.
- **Subscriptions are fetched after your other calendars**, so a slow one never
  holds up a calendar that has already answered.

Even so, the first fetch of a large calendar takes noticeably longer than a
CalDAV one, and always will.

### Finding the address

| Service | Where |
|---|---|
| **Google** | Calendar → Settings → pick the calendar → Integrate calendar → **Secret address in iCal format**. Not the public page, not the browser address. |
| **Outlook** | Calendar → Settings → Shared calendars → Publish a calendar → choose **Can view all details** → copy the ICS link. |
| **Apple** | iCloud Calendar → the share icon beside a calendar → Public Calendar → copy the link. |
| **Fastmail / Proton** | Calendar settings → export or subscribe → copy the secret address. |

> **Treat these addresses like passwords.** Anyone who has one can read that
> calendar until you regenerate it. Task Hub accepts only `https://` addresses
> so they are never sent in the clear.

### Adding one

You can paste an address into the box, but a private calendar address is around
a hundred characters of random text and typing it on the device is miserable.
The intended route is a file:

1. On a computer, make a plain text file named exactly **`calendars.txt`**.
2. Put one address on each line. To name a calendar, put the name first and a
   bar before the address. Without a name, Task Hub reads the calendar's own:

   ```
   Work|https://calendar.google.com/calendar/ical/.../basic.ics
   https://outlook.office365.com/owa/calendar/.../calendar.ics
   ```

   Blank lines and lines starting with `#` are ignored. A line that is not a
   usable address is skipped and reported, rather than failing the whole import.
3. Copy it to the device over USB into **`Document/TaskHub/calendars.txt`** —
   the same folder as `settings.json`.
4. Settings → ICS Calendars and Supernote To-Dos → **Import calendars.txt**.
5. **Save settings**, then **delete the file from the device.**

---

## Supernote To-Dos

**Settings → ICS Calendars and Supernote To-Dos → Connect the Supernote To-Do app.**

An optional two-way connection to the to-do list built into your Supernote,
through Supernote Cloud. **Off until you switch it on.**

> **If you run the Task Hub server, you do not want this.** The server already
> syncs these to-dos into your task lists, both ways, and keeps working when
> this cannot — see the expiry note below.

This is the one part of Task Hub built on an API Ratta never published. It was
worked out against a live account and it works, but nothing about it is
promised: a Partner app update could change it, and the first sign would be this
failing. Everything else in the plugin uses an open standard.

### Signing in

1. Tick **Connect the Supernote To-Do app**.
2. Enter the email address your tablet's account uses, and its password.
3. Supernote emails you a verification code. Type it in and tap **Verify and
   finish**.
4. Tap **Refresh lists**, tick the to-do lists you want, and **Save settings**.

**Your password is never stored.** Signing in exchanges it for a session, and
the session is the only thing kept. It is also never sent in the clear — it is
hashed before it leaves the device.

### The thirty-day expiry

The session Supernote issues **lasts thirty days and cannot be renewed**. There
is no refresh endpoint of any kind, so when it runs out you sign in again with a
fresh emailed code. Settings always shows how many days are left, and Task Hub
warns you a week before.

This is the main reason the [Task Hub server](#task-hub-server-recommended) is
the better home for this connection: it manages the same session centrally,
rather than every device needing its own.

### What it can and cannot carry

A Supernote to-do holds **a title, a date and a note**. That is all the To-Do
app stores, so Task Hub hides the rest rather than offering controls that would
be discarded:

| | Supported |
|---|---|
| Title | Yes |
| Due date | Yes — a date, never a time |
| Note | Stored and returned, but the To-Do app does not display one, so only Task Hub shows it |
| Time of day | No |
| Priority | No |
| Repeats | No |
| Sub tasks | No |

Ticked lists appear beside your other task lists everywhere in the plugin,
badged **Supernote**, and can be completed, edited and added to.

**Only to-dos that are still open are shown.** Completed ones are left on the
tablet rather than brought over, which is the same rule Task Hub applies to
every other task source. Ticking a Supernote to-do off here completes it on the
tablet, and it leaves the list on the next refresh.

### Inbox — the to-dos that belong to no list

A Supernote to-do does not have to be in a list. One made in a hurry, or left
over from a list you later deleted, sits in the To-Do app's **All** view and in
none of its lists.

Those to-dos appear here as a list of their own called **Inbox**, the name the
tablet itself uses. Tick it like any other list.

Two things make it unlike the others:

- **It is only offered while something is in it.** An account with every to-do
  properly filed never sees it.
- **Nothing can be added to it.** It is a view of to-dos that belong to no list,
  so there is nowhere in it for a new one to go. It is never offered as a place
  to save a captured task, and Task Hub says so plainly if you reach it another
  way.

File a to-do into a real list on the tablet and it simply moves to that list
here on the next refresh — it is not lost, and it is not duplicated.
