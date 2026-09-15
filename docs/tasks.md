# Tasks

What Task Hub can store on a task, and how each field survives the trip to your
server and back.

## The fields

| Field | Notes |
|---|---|
| **Title** | Required |
| **Due date** | A date, and optionally a time |
| **Priority** | The full RFC 5545 range, 1–9, shown as bands |
| **Repeats** | Daily, weekly, monthly, yearly, with intervals |
| **Description** | Free text |
| **Sub tasks** | Steps belonging to a parent task |
| **Source page** | Set automatically when the task came from a lasso |

Not every destination holds all of these. A
[Supernote To-Do](connections.md#supernote-to-dos) stores a title, a date and a
note and nothing else, so Task Hub **hides** priority, repeats, sub tasks and
the time of day when you are writing to one — a control whose value is silently
discarded is worse than an absent one, because you would believe you had set it.

## Edits are surgical

When you change a task, Task Hub rewrites **only the properties you can change**
and leaves the rest of the calendar object exactly as it was. A repeat rule the
plugin's menu cannot describe, an attendee list, custom `X-` properties written
by another app — all survive an edit made here.

A repeat rule Task Hub cannot name is shown as **custom** and is kept
byte-identical unless you deliberately choose a different one.

## Completion

Completion is read from **three** signals, because clients disagree about which
they write: `STATUS:COMPLETED`, a `COMPLETED:` timestamp, or
`PERCENT-COMPLETE:100`. Checking only the first left tasks completed in other
apps looking open forever.

Ticking an ordinary task does not ask for confirmation. Completing a **captured**
task does, because it also edits your own note — see
[Capturing handwriting](capture.md#when-the-task-is-completed).

Completed tasks are fetched only where a server offers them cheaply; the Tasks
tab is for what is left to do.

## Sub tasks

A step is a task with a parent, written as `RELATED-TO;RELTYPE=PARENT`. Task Hub
reads and writes that relationship, so steps made here are steps everywhere.

- Add them one per line when creating or editing a task.
- A step takes the parent's due date unless you end its line with `@2026-09-10`.
- Families are arranged by their soonest outstanding step and folded by default.
- The sub-tasks box only **adds**. It never lists or removes the steps a task
  already has, so saving twice does not duplicate them.

## Several lists at once

A task can be saved into more than one list in one go. Each copy gets its own
UID: the same UID in two collections is legal, but it confuses clients that
assume a UID names one object.

## What is written on a task Task Hub creates

Alongside the standard properties, Task Hub stamps its own:

| Property | Holds |
|---|---|
| `X-TASKHUB-ORIGIN` | Which service the item came from |
| `X-TASKHUB-ORIGIN-NAME` | A readable label for that service |
| `X-TASKHUB-SOURCE` | The note a captured task came from |
| `X-TASKHUB-SOURCE-PAGE` | The page within that note |

The source is deliberately **not** written into the description: that space is
yours, and another client editing it must not be able to destroy the link back
to your handwriting.
