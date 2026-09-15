# Task Hub documentation

Task Hub is a plugin for Supernote e-ink tablets. It puts your tasks and your
calendar on the device, and ties both to the notes you write by hand.

Everything here describes version **0.71.2**.

## Start here

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Installing, the first run, and what works with no server at all |
| [Connecting your tasks and calendars](connections.md) | CalDAV, the Task Hub server, `.ics` subscriptions, and the Supernote To-Do app |
| [The views](views.md) | What each tab and calendar view shows, and what every mark on them means |
| [Capturing handwriting](capture.md) | Turning a lasso into a task or an event, and the mark it leaves on the page |
| [Notes](notes.md) | Daily, weekly, monthly, quarterly, yearly and meeting notes |
| [Find](find.md) | Searching keywords and starred pages across your notes |
| [Settings reference](settings.md) | Every setting, what it does, and what it defaults to |
| [Troubleshooting](troubleshooting.md) | What to check when something does not work |

## The one thing worth knowing first

Task Hub does not require a server. Every note feature — daily notes, meeting
notes, templates, the Find tab, capturing handwriting — works on a device that
has never been connected to anything.

A server is what adds **tasks**, and what makes a calendar editable. There are
three ways to connect, and they are not equal:

| | What it gives you | Direction |
|---|---|---|
| **[Task Hub server](https://github.com/Sparkinman/task-hub)** | Tasks and calendars from Google, Outlook, Todoist, TickTick, Apple, the Supernote To-Do app and more, all in one place | **Two-way, everything** |
| **Any CalDAV server** | Tasks and calendars from that server | Two-way |
| **`.ics` subscription** | Calendar events only | **Read-only, and slower** |

If you want one thing to set up and have everything work in both directions,
that is the [Task Hub server](https://github.com/Sparkinman/task-hub). It
self-hosts in one command, runs on a Raspberry Pi, and does the awkward work —
holding OAuth credentials for Google and Microsoft, refreshing tokens on a
schedule, and talking to services that have no open protocol at all — none of
which a plugin that only runs while it is open can do.

Subscriptions exist for people who do not want to run anything. They are worth
having, and they are genuinely worse: see
[why a subscription is read-only and slow](connections.md#why-a-subscription-is-read-only-and-slower).

## Licence

GPL-3.0-or-later, the same as the server.
