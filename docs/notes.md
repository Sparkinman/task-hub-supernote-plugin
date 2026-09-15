# Notes

Task Hub creates and opens six kinds of note, none of which needs a server.

| Kind | For | Default folder |
|---|---|---|
| **Daily** | One day | `Note/Daily` |
| **Weekly** | One week, starting Sunday | `Note/Weekly` |
| **Monthly** | One month | `Note/Monthly` |
| **Quarterly** | One quarter | `Note/Quarterly` |
| **Yearly** | One year | `Note/Yearly` |
| **Meeting** | One calendar event | `Note/Meetings` |

Each is configured independently — somebody who keeps a weekly review in one
folder and a quarterly plan in another should not have to accept one scheme for
both. Each can be switched off, which hides its buttons without deleting
anything.

## Creating and opening

Every calendar view offers the note for what you are looking at. The button
reads **Open note** when one exists and **+ Note** when it does not, so you
always know which is about to happen.

Creating a note:

1. Makes any missing folders — the device will not create a note under a folder
   that is not there, and fails opaquely when one is missing.
2. Creates the file from your chosen template, or the device default.
3. Optionally writes the date at the top.
4. Opens it.

## Where a note goes

A **folder** and a **layout**. The layout is the path below the folder, without
`.note`, built from tokens — see
[the full token list](settings.md#layout-tokens).

```
Folder:  Note/Daily
Layout:  {YYYY}/{MM}-{MMMM}/{DATE}
Result:  Note/Daily/2026/09-September/2026-09-14.note
```

Presets are offered for each kind, and **One folder for everything** sets all
six to a single dated tree in one tap. It confirms first and says plainly that
notes you already have are not moved — getting this by hand means setting six
folders and five layouts that have to agree, and one mismatch scatters your
notes across two trees without saying so.

## Templates

A template is a `.note` file a new note starts from. Task Hub finds them in
**MyStyle**, and the picker can also browse anywhere on the device.

The picker opens as a grid of thumbnails over the settings page, so you choose a
template by looking at it rather than by reading a filename.

## The date heading

Optional, off by default, per note kind.

Writes the date into a text box at the top of a **newly created** note, never
when one is opened — otherwise it would write into your page every time you came
back to it. Leave it off if your template already prints the date, or the note
will say it twice.

The text is placed so the date sits where a heading belongs, using a measurement
taken from taoist22's `sn-datetime` rather than guessed: the device draws text
about `2.05 × fontSize` below the top of the rectangle it is given, and ignores
the rectangle's height entirely.

## Meeting notes

A note attached to a calendar event, created from the event itself.

- **Every occurrence of a repeating event shares one note.** A weekly stand-up
  has one page of notes, not fifty-two.
- The link between event and note lives **on your device**, in `settings.json`,
  and is never written back to the calendar.
- Because that link is local, meeting notes work on **read-only** calendars too.
  A subscribed Google or Outlook event can have a note attached even though the
  event itself cannot be edited.
