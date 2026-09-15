# Capturing handwriting

Write something on a page, lasso it, and turn it into a task or a calendar
event — with a link back to the page it came from.

## How

1. Write on a page in the NOTE app.
2. **Lasso** the writing.
3. Tap **Task Hub** in the lasso toolbar.
4. Choose **Task** or **Event** at the top of the screen.
5. Fill in what you need and tap **Save**.

The device recognises the lassoed handwriting into text and uses it as the
title. Everything else is optional.

### Task or Event

One lasso, two things it can become, chosen on the capture screen rather than
with a second button on the note app's lasso toolbar — that toolbar is shared
and already crowded.

| | Goes to | Asks for |
|---|---|---|
| **Task** | The task lists you tick | Title, lists, due date. Behind **More…**: priority, repeats, description, sub tasks |
| **Event** | One calendar | Title, calendar, date and start time, end time. Behind **More…**: repeats, location, description |

An event's **end time follows its start** and keeps whatever duration you set —
a ninety-minute meeting stays ninety minutes when you move it. A new one
defaults to an hour. Leave the start time empty to make it an all-day event.

Both carry the page they came from, so both offer the `↩ page` chip afterwards.

### Sub tasks

One per line in the sub tasks box. Each becomes a step of the task, due the same
day as the task itself. End a line with `@2026-09-10` to give that step its own
date.

The same rule is implemented in the Task Hub server, so the same text produces
the same tasks wherever you type it.

---

## The mark left on the page

Without a mark, a captured task is invisible from the note's side: the task
knows where it came from, but the page gives no sign that anything happened.

All of it writes into your own note, so all of it is optional and **all of it is
named in the confirmation before anything is drawn**.

| Setting | Default | What it draws |
|---|---|---|
| **Mark style** | Dashed box | A border around the lassoed strokes — dashed, solid, an underline, or nothing |
| **"Task Hub" caption** | off | The words *Task Hub* underneath, so the mark explains itself without being tapped |
| **Marker shading** | off | Marker-pen strokes across the writing, in light grey, dark grey or black |

The box is a **link**. Tapping it pops up the Task Hub lock-up with a caption.

> **Why the link does not reopen Task Hub.** The SDK addresses pages, files,
> documents, images and URLs. A plugin is not one of those, so there is no way
> to make a mark that opens Task Hub. Pointing it at an image is the nearest
> thing the host can show.

### When the task is completed

Completing a captured task removes the box, the caption and the shading, and the
page is repainted so you see it happen.

**Your handwriting is never at risk.** Strokes are their own elements; a stroke
link is a separate element that merely references them. Only elements that are
links pointing at Task Hub's own image — matched on the exact path, which
nothing else writes — and the caption and shading inside their rectangles are
removed.

### Two limits worth knowing

**Shading does not follow moved handwriting.** The box is bound to the strokes
and travels with them. The shading is separate geometry and stays where it was
drawn — and completion then cannot find it, because it searches inside the box's
rectangle. It has to be erased by hand.

**Copying a captured task confuses the cleanup.** Every link on the page
pointing at Task Hub's image is removed, so completing one of two copies strips
the mark from both. Fixing this needs per-task identity inside the link, and the
link's destination is the only place to put it.

---

## Marks made by the Supernote To-Do app

If you turn handwriting into a to-do using the **tablet's own** To-Do feature
rather than Task Hub, that mark belongs to the To-Do app. Completing the item
through Task Hub's [Supernote connection](connections.md#supernote-to-dos)
updates the task but **does not** clear the To-Do app's own drawing — the API
offers no handle on it.

Task Hub's own marks are the ones with *Task Hub* written underneath.
