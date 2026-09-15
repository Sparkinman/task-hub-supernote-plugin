# Settings reference

Every setting in Task Hub, what it does, and what it defaults to.

Settings live in **`Document/TaskHub/settings.json`** on the device. That
location is deliberate: it is outside the plugin's own folder, so it survives
uninstalling or updating the plugin. You can read it over USB.

> **It is a plain text file, and it holds your password.** A plugin has no
> access to a keystore. If your server supports a scoped or app-specific
> credential, use one. For the Supernote connection, only a session token is
> stored — never the password.

Nothing takes effect until you press **Save settings**.

---

## Task and calendar server

Optional. Everything under *Notes* below works without it.

| Setting | Default | What it does |
|---|---|---|
| **Server address** | empty | The CalDAV server's address, not one calendar's. `https://cloud.example.com` |
| **Username** | empty | The account to log in as |
| **Password** | empty | That account's password, or an app-specific password where the provider requires one |
| <a id="owner"></a>**Owner** | empty | Whose collections to browse, when that differs from the login. Leave blank normally |
| **Task lists** | none | Which VTODO collections feed the Tasks tab |
| **Calendars** | none | Which VEVENT collections feed the Calendar tab |
| **New tasks go to** | first ticked | The list pre-ticked when you capture handwriting |

**Owner** exists for servers where a credential is scoped to collections that
belong to somebody else — a Radicale rights file, for example. When it is set,
discovery asks that account's home directly instead of walking to the login's
own, because the login's own is not where the collections are.

**Discover** finds collections by the RFC 6764 standard path rather than
guessing. If a server does not answer that walk at all, Task Hub falls back to
`<server>/<username>/`, which is Radicale's layout.

A collection that is ticked but no longer on the server is listed as *not on the
server* with a **Remove** button, so a deleted calendar can always be untangled.

---

## ICS Calendars and Supernote To-Dos

Both halves are for people without a server. See
[Connecting your tasks and calendars](connections.md) for the full setup.

| Setting | Default | What it does |
|---|---|---|
| **Subscribed calendars** | none | Read-only `.ics` calendars, added by address or imported from `calendars.txt` |
| **Connect the Supernote To-Do app** | **off** | Two-way connection to the tablet's own To-Do list, through Supernote Cloud |
| **To-do lists to show** | none | Which of that account's lists appear |

---

## Notes

None of this needs a server.

Six kinds of note, each configured independently: **daily, weekly, monthly,
quarterly, yearly** and **meeting**. Each has the same four settings.

| Setting | What it does |
|---|---|
| **Enabled** | Whether this kind of note is offered at all. Turning one off hides its buttons; it deletes nothing and the settings stay |
| **Folder** | Where these notes live, under shared storage. Browse to it or type it |
| **Layout** | The folder and file name pattern below that root, without `.note` |
| **Template** | A `.note` file a new one starts from. Blank means the device default |
| **Date heading** | Writes the date into a text box at the top of a newly created note |

**Date heading** applies only when a note is *created*, never when one is
opened — otherwise it would write into your page every time. Leave it off if
your template already prints the date.

### Defaults

| Note | Folder | Layout | Example |
|---|---|---|---|
| Daily | `Note/Daily` | `{YYYY}/{MM}-{MMMM}/{DATE}` | `Note/Daily/2026/09-September/2026-09-14.note` |
| Weekly | `Note/Weekly` | `{YYYY}/W{WW}` | `Note/Weekly/2026/W37.note` |
| Monthly | `Note/Monthly` | `{YYYY}/{MM}-{MMMM}` | `Note/Monthly/2026/09-September.note` |
| Quarterly | `Note/Quarterly` | `{YYYY}/{QQ}` | `Note/Quarterly/2026/Q3.note` |
| Yearly | `Note/Yearly` | `{YYYY}` | `Note/Yearly/2026.note` |
| Meeting | `Note/Meetings` | named after the event | `Note/Meetings/Standup-2026-09-14.note` |

### Layout tokens

| Token | Means | Example |
|---|---|---|
| `{YYYY}` | Four-digit year | `2026` |
| `{MM}` | Two-digit month | `09` |
| `{MMM}` | Short month name | `Sep` |
| `{MMMM}` | Full month name | `September` |
| `{DD}` | Two-digit day | `14` |
| `{ISO}` | Full ISO date | `2026-09-14` |
| `{DATE}` | The date in **your chosen display format**, made safe for a filename | `09/14/2026` becomes `09-14-2026` |
| `{WW}` | Week number | `37` |
| `{QQ}` | Quarter | `Q3` |
| `{START}` | The date the week starts | `2026-09-13` |

A `/` in a layout makes a folder. Anything else is literal text, so
`{YYYY}/Journal {ISO}` is a valid layout.

**Weeks start on Sunday**, matching the week view you are looking at when you
press the button. ISO-8601 says Monday, but a note filed under a date you did
not pick is worse than a standard you did not follow.

### One folder for everything

A button that sets all six note types to one dated tree under
`Note/Calendar`, nested by date and named for what each is. It confirms first,
and it does **not** move notes you already have.

---

## Page marking

What a task captured from handwriting leaves on the page it came from. All of it
writes into your own note, so all of it is optional and it is all disclosed in
the confirmation before anything is drawn.

| Setting | Default | What it does |
|---|---|---|
| **Mark style** | Dashed box | `Dashed box`, `Solid box`, `Underline` or `No mark` |
| **Also write "Task Hub" underneath** | off | A short caption under the boxed writing, so the mark explains itself |
| **Also shade it with the marker pen** | off | Marker strokes across the handwriting |
| **Shade colour** | Light grey | `Light grey`, `Dark grey` or `Black` |

See [Capturing handwriting](capture.md) for what each looks like and what
happens when the task is completed.

---

## Formats and behaviour

| Setting | Default | Options |
|---|---|---|
| **Date format** | `YYYY-MM-DD` | `YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY` |
| **Time format** | 24-hour | 24-hour, 12-hour |
| **Open on** | Tasks | Which tab the plugin opens on: `Tasks` or `Calendar` |
| **Agenda hours** | 7 to 21 | The hours the day view draws as slots |

**Open on** sits outside every fold at the top of Settings. Without a server the
Tasks tab is empty and everything you use is on the Calendar, so opening on the
empty one every time is a tap nobody wanted.

**Agenda hours** narrows the day view's grid. Nothing is hidden by narrowing it:
anything outside the window is listed underneath, and all-day items stay above
the grid regardless.

---

## Device

| Action | What it does |
|---|---|
| **Where settings are stored** | Shows the full path to `settings.json` |
| **Wipe all save data** | Deletes `settings.json` and starts over. Your notes are not touched |
