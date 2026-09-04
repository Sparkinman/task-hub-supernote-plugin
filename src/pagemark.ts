import {PluginCommAPI, PluginFileAPI, PluginNoteAPI} from 'sn-plugin-lib';

import type {SourceRef} from './lasso';
import {MARKER_PEN, STYLE_CODES, isMarkStyle, type MarkStyle} from './markstyle';
import {LINK_IMAGE_BASE64, LINK_IMAGE_CAPTION, LINK_IMAGE_NAME} from './linkimage';
import {writeLinkImage} from './storage';

/**
 * Leave a visible mark on the page a task was captured from.
 *
 * Without this, a captured task is invisible from the note's side: the task
 * knows where it came from, but the page gives no sign that a lasso of
 * handwriting ever became one.
 *
 * Uses the host's own lasso-link mechanism rather than inserting a rectangle
 * element. `setLassoStrokeLink` borders exactly the strokes that were selected,
 * so the box always fits the handwriting — no coordinate maths, no page-size or
 * rotation handling, and it renders the way every other link on the device does.
 *
 * A link needs a destination, and a plugin is not one — the SDK addresses only
 * pages, files, images and URLs, so the mark cannot reopen Task Hub. It points
 * at an image of the Task Hub lock-up instead, which is the nearest thing the
 * host can show: tapping the boxed handwriting says what took it, rather than
 * doing nothing. If that image cannot be written the link falls back to the page
 * it is already on, so the box still appears and the tap stays harmless.
 */

/** Link type 0: jump to a note page. 3: open an image. */
const LINK_TYPE_NOTE_PAGE = 0;
const LINK_TYPE_IMAGE = 3;

/** Sits beside settings.json, so everything this plugin leaves is in one place. */
const LINK_IMAGE_PATH = `Document/TaskHub/${LINK_IMAGE_NAME}`;

/**
 * Cached for the session. The native side already skips a redundant write, but
 * this avoids handing 24 KB of base64 across the bridge on every capture.
 */
let imagePath: string | null | undefined;

async function linkImagePath(): Promise<string | null> {
  if (imagePath === undefined) {
    imagePath = await writeLinkImage(LINK_IMAGE_PATH, LINK_IMAGE_BASE64, LINK_IMAGE_CAPTION);
  }
  return imagePath;
}

/**
 * Result codes `setLassoStrokeLink` returns. -2 means the destination file is in
 * an older format the device wants upgraded before it will link to it — worth
 * distinguishing, because it is fixable by the user and a plain failure is not.
 */
const RESULT_MESSAGES: Record<number, string> = {
  [-1]: 'the selection was no longer active',
  [-2]: 'the note needs upgrading on the device before it can hold links',
};

interface LooseResponse<T> {
  success?: boolean;
  result?: T | null;
  error?: {message?: string} | null;
}

/**
 * Draw the mark. Resolves to null on success, or a reason it did not happen.
 *
 * Never throws: the task has already been saved to the server by the time this
 * runs, and losing that confirmation because a decoration failed would be much
 * worse than the missing decoration.
 */
export async function markLassoStrokes(
  source: SourceRef,
  style: MarkStyle,
): Promise<string | null> {
  if (style === 'off') {
    return null;
  }
  // Belt and braces after the settings-merge bug that sent `undefined` here:
  // a style this code does not recognise falls back to the default rather than
  // asking the device to draw nothing.
  const code = isMarkStyle(style) ? STYLE_CODES[style] : STYLE_CODES.dashed;
  try {
    // Prefer the logo image; fall back to a self-link so a failed write costs
    // the popup, not the mark.
    const image = await linkImagePath();
    const destination = image
      ? {destPath: image, destPage: 0, linkType: LINK_TYPE_IMAGE}
      : {destPath: source.path, destPage: source.page, linkType: LINK_TYPE_NOTE_PAGE};

    const response = (await PluginNoteAPI.setLassoStrokeLink({
      ...destination,
      style: code,
    })) as LooseResponse<number> | null | undefined;

    if (!response?.success) {
      return response?.error?.message ?? 'the device refused the request';
    }
    const result = response.result ?? -1;
    if (result === 0) {
      return null;
    }
    return RESULT_MESSAGES[result] ?? `the device returned code ${result}`;
  } catch (err) {
    return err instanceof Error ? err.message : 'an unknown error';
  }
}

/** Element type 600 is a link. */
const TYPE_LINK = 600;

interface PageElement {
  type?: number;
  numInPage?: number;
  link?: {destPath?: string; X?: number; Y?: number; width?: number; height?: number} | null;
  geometry?: {penType?: number; penColor?: number; points?: {x: number; y: number}[]} | null;
}

/** Slack when matching a wash to the box around it, in device units. */
const WITHIN = 40;

/**
 * Whether this geometry is a wash this plugin drew inside `boxes`.
 *
 * Both tests have to pass: our exact marker pen values, AND every point inside
 * one of our own link boxes. A marker stroke the user drew themselves elsewhere
 * on the page fails the second; anything they drew with a different pen inside
 * the box fails the first.
 */
function isOurShading(element: PageElement, boxes: Required<Rect>[]): boolean {
  const geo = element.geometry;
  if (element.type !== TYPE_GEOMETRY || !geo || !Array.isArray(geo.points)) {
    return false;
  }
  if (geo.penType !== MARKER_PEN.penType || geo.penColor !== MARKER_PEN.penColor) {
    return false;
  }
  return boxes.some(box =>
    (geo.points as {x: number; y: number}[]).every(
      point =>
        point.x >= box.left - WITHIN &&
        point.x <= box.right + WITHIN &&
        point.y >= box.top - WITHIN &&
        point.y <= box.bottom + WITHIN,
    ),
  );
}

/**
 * Take the mark off a page once its task is done.
 *
 * Only removes elements that are links pointing at this plugin's own image —
 * matched on the exact path, which nothing else writes. Handwriting is never
 * touched: the strokes are their own elements, and a stroke link is a separate
 * link element that references them, so deleting it leaves the writing intact.
 *
 * Never throws. Completing the task on the server is the operation that matters;
 * failing to tidy the page must not undo or obscure it.
 */
export async function removePageMark(source: SourceRef): Promise<string | null> {
  try {
    const image = await linkImagePath();
    if (!image) {
      return 'the plugin could not work out which image to look for';
    }

    // The file-level APIs read what is on disk, and the host holds the open page
    // in memory — a mark made this session may not be in the file yet. Flushing
    // first is cheap, and a failure here is not worth reporting: the read below
    // simply finds nothing and says so.
    try {
      await PluginNoteAPI.saveCurrentNote();
    } catch {
      // Not the current note, or nothing to save.
    }

    const listed = (await PluginFileAPI.getElements(source.page, source.path)) as
      | LooseResponse<PageElement[]>
      | null
      | undefined;
    if (!listed?.success || !Array.isArray(listed.result)) {
      return listed?.error?.message ?? 'the page could not be read';
    }

    const links = listed.result.filter(
      el => el?.type === TYPE_LINK && el?.link?.destPath === image,
    );

    // The link's own rectangle anchors the search for the wash, so nothing extra
    // has to be recorded on the task to find it again.
    const boxes = links
      .map(el => el.link)
      .filter(
        (link): link is {X: number; Y: number; width: number; height: number} =>
          !!link &&
          typeof link.X === 'number' &&
          typeof link.Y === 'number' &&
          typeof link.width === 'number' &&
          typeof link.height === 'number',
      )
      .map(link => ({
        left: link.X,
        top: link.Y,
        right: link.X + link.width,
        bottom: link.Y + link.height,
      }));

    const ours = [...links, ...listed.result.filter(el => isOurShading(el, boxes))]
      .map(el => el.numInPage)
      .filter((num): num is number => typeof num === 'number');

    if (ours.length === 0) {
      // Nothing to do is a success, not a failure: the mark may have been
      // removed by hand, or never made.
      return null;
    }

    const removed = (await PluginFileAPI.deleteElements(source.path, source.page, ours)) as
      | LooseResponse<boolean>
      | null
      | undefined;
    if (!removed?.success) {
      return removed?.error?.message ?? 'the device refused to remove it';
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'an unknown error';
  }
}

/** Text drawn under a captured task, so the box needs no tap to be understood. */
export const TASK_LABEL = 'Task Hub Task';

/**
 * Write a caption under the handwriting, as a link to the same image.
 *
 * A stroke link cannot carry text — `setLassoStrokeLink` takes only a
 * destination and a border style — but a text link can, and it renders its
 * `showText`. Sitting just below the boxed writing, it says what the box is
 * without anyone having to tap it.
 *
 * Being a link to this plugin's own image, the completion cleanup finds and
 * removes it by exactly the same test as the box itself.
 *
 * Takes the rect rather than reading it: `insertTextLink` writes into whatever
 * document is open, and by the time it runs the lasso may already have been
 * disturbed by the shading insert.
 */
export async function labelLassoStrokes(rect: Rect): Promise<string | null> {
  try {
    const image = await linkImagePath();
    if (!image) {
      return 'the plugin could not work out where to point the label';
    }
    // Sized to the box rather than fixed: a caption in a constant size looks
    // wrong under both a scrawled word and half a page of writing. The bounds it
    // is clamped between come from the page, not from constants — a Nomad's page
    // is smaller than a Manta's in the same pixel space, so a fixed floor would
    // be proportionally larger there.
    const {min, max} = await labelFontBounds();
    const fontSize = Math.min(max, Math.max(min, Math.round((rect.bottom - rect.top) / 3)));
    const top = rect.bottom + Math.round(fontSize / 3);

    const inserted = (await PluginNoteAPI.insertTextLink({
      destPath: image,
      destPage: 0,
      linkType: LINK_TYPE_IMAGE,
      // Underlined rather than boxed: the writing above already has a box, and a
      // second one directly beneath it reads as a table.
      style: STYLE_CODES.underline,
      rect: {
        left: rect.left,
        top,
        right: rect.left + Math.round(fontSize * TASK_LABEL.length * 0.62),
        bottom: top + Math.round(fontSize * 1.4),
      },
      fontSize,
      fullText: TASK_LABEL,
      showText: TASK_LABEL,
      isItalic: 0,
    })) as LooseResponse<number> | null | undefined;

    if (!inserted?.success) {
      return inserted?.error?.message ?? 'the device refused the label';
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'an unknown error';
  }
}

/**
 * Caption size limits, as a fraction of page height.
 *
 * Everything else this file draws is derived from the lasso rectangle, in the
 * same pixel space the host reports it in, so it scales across devices on its
 * own. These two were the exception: absolute pixel bounds would clamp a small
 * page's caption to a proportionally larger size than a big one's.
 *
 * The fractions reproduce the 24–48 that looked right on a 2560px-high page.
 */
const MIN_LABEL_FRACTION = 0.0094;
const MAX_LABEL_FRACTION = 0.0188;

/** Those bounds in pixels, falling back to the measured values. */
async function labelFontBounds(): Promise<{min: number; max: number}> {
  try {
    const response = (await PluginCommAPI.getPageDisplaySize()) as
      | LooseResponse<{width: number; height: number}>
      | null
      | undefined;
    const height = response?.result?.height;
    if (response?.success && typeof height === 'number' && height > 0) {
      return {
        min: Math.round(height * MIN_LABEL_FRACTION),
        max: Math.round(height * MAX_LABEL_FRACTION),
      };
    }
  } catch {
    // Fall through to the measured defaults.
  }
  return {min: 24, max: 48};
}

/** Element type 700 is a geometry, and a straight line is one shape it takes. */
const TYPE_GEOMETRY = 700;
const GEO_STRAIGHT_LINE = 'straightLine';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The selection's bounds, or a reason they could not be read. */
async function lassoRect(): Promise<Rect | string> {
  const response = (await PluginCommAPI.getLassoRect()) as
    | LooseResponse<Rect>
    | null
    | undefined;
  const rect = response?.result;
  if (!response?.success || !rect) {
    return response?.error?.message ?? 'the selection had no bounds';
  }
  return rect;
}

/**
 * Wash the captured handwriting with the marker pen.
 *
 * One horizontal stroke through the middle of the lasso rectangle, which is how
 * a highlighter is used by hand — a broad pen drawn across the words, not a
 * filled shape behind them.
 *
 * Uses `insertGeometry`, which draws into the page the host currently has open.
 * The first attempt built an Element by hand and pushed it through
 * `PluginFileAPI.insertElements`, which needs `createElement()` for its native
 * accessors and a saved file underneath it — so nothing appeared and nothing
 * reported an error. Both coordinate spaces here are pixels: `getLassoRect` and
 * `insertGeometry` agree, so no conversion is involved.
 *
 * Never throws, and reports rather than retries: this runs after the task is
 * already saved, and after the box is already drawn.
 */
export async function shadeLassoStrokes(rect: Rect): Promise<string | null> {
  try {
    const middle = Math.round((rect.top + rect.bottom) / 2);
    const inserted = (await PluginCommAPI.insertGeometry({
      type: GEO_STRAIGHT_LINE,
      // Drawn edge to edge of the selection, so the wash covers the writing
      // rather than stopping short of its first and last strokes.
      points: [
        {x: rect.left, y: middle},
        {x: rect.right, y: middle},
      ],
      // Leaving the lasso alone: the box has already been made from it, and
      // re-selecting the wash would replace that selection.
      showLassoAfterInsert: false,
      ...MARKER_PEN,
    })) as LooseResponse<boolean> | null | undefined;

    if (!inserted?.success) {
      return inserted?.error?.message ?? 'the device refused to draw it';
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'an unknown error';
  }
}

/** What a capture should leave behind, from settings. */
export interface MarkOptions {
  style: MarkStyle;
  shade: boolean;
  label: boolean;
}

/**
 * Everything a captured task leaves on its page, in one errand.
 *
 * Order matters. The box is made from the live lasso, so it goes first and the
 * selection's bounds are read once, up front — the inserts that follow can
 * disturb the lasso, and re-reading it afterwards gave the label a rect that had
 * moved. Shading and the label then draw into the same rectangle.
 *
 * The page is reloaded at the end. Inserts land in the host's in-memory page but
 * do not repaint on their own, which is exactly what "the box works and nothing
 * else does" looked like: the link is drawn by the live lasso path, the inserts
 * were not.
 *
 * Returns a sentence to append to the save confirmation, or '' when everything
 * asked for happened.
 */
export async function markPage(source: SourceRef, options: MarkOptions): Promise<string> {
  if (options.style === 'off') {
    return '';
  }

  const boxFailure = await markLassoStrokes(source, options.style);
  if (boxFailure) {
    return ` The page could not be marked — ${boxFailure}.`;
  }
  if (!options.shade && !options.label) {
    return ' Page marked.';
  }

  const rect = await lassoRect();
  if (typeof rect === 'string') {
    return ` Page marked, but nothing could be drawn around it — ${rect}.`;
  }

  let note = ' Page marked.';
  if (options.shade) {
    const failure = await shadeLassoStrokes(rect);
    if (failure) {
      note += ` The shading could not be drawn — ${failure}.`;
    }
  }
  if (options.label) {
    const failure = await labelLassoStrokes(rect);
    if (failure) {
      note += ` The label could not be written — ${failure}.`;
    }
  }

  // Repaint once, after both inserts, rather than after each.
  try {
    await PluginCommAPI.reloadFile();
  } catch {
    // A page that has not repainted yet still holds the marks; they appear on
    // the next visit. Not worth reporting as a failure.
  }
  return note;
}
