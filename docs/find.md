# Find

The third tab. It lists every **keyword** and every **starred page** across the
notes Task Hub files for you, and tapping a result opens that note at that page.

It needs no server and no network.

## What it searches

The folders set for your daily, weekly, monthly, quarterly and yearly notes,
plus the meeting-note folder. A note type you have switched off is not searched:
its folder may not exist, and walking a folder you have disabled would surface
notes you deliberately stopped filing.

## What it finds

**Keywords** carry real text. A keyword is something you add to a page on the
device, and it is stored as text — so matching one is exact. No recognition is
involved and nothing is guessed.

**Starred pages** are positions. The device records which pages carry a star,
but a star has no text of its own — so the filter narrows starred pages by the
note's name and period rather than by content.

> **Titles are deliberately not searched.** The device stores a title as
> geometry and style with no text at all — a title is handwriting the device
> knows is a heading. Searching one would mean handwriting recognition over
> every title on every page, which is a different feature with a very different
> cost.

## Using it

The tab opens **showing** results rather than waiting for a query: starred pages
first, keywords underneath, and a filter above both. Typing narrows what is
already there.

- **Keywords** are listed alphabetically with a count. Tap one to see its pages.
- **Starred pages** are listed newest note first.
- **Previews** switches the starred list to a grid of rendered page images, two
  to a row, cropped to the top of each page — which is where writing and stars
  usually are. Turn it on and a keyword's pages get thumbnails too, once you
  expand that keyword.
- **Rescan** throws the index away and reads every note again.

## Why it is fast the second time

Reading a note costs three calls to the device, so an index is kept in
`Document/TaskHub/noteindex.json`. A note whose modification time **and** size
both still match is reused untouched, so a second visit reads only what has
actually changed.

The scan runs the first time you open the tab, never when the plugin opens — so
none of the opening speed is spent on a tab you might not visit.

Rendered previews are cached too, under `Document/TaskHub/previews/`, named so
that a page redrawn after its note changed is drawn afresh automatically.

**Rescan** is the escape hatch for the one case timestamps miss: a note restored
from a backup or copied over USB can arrive carrying its old modification time.
