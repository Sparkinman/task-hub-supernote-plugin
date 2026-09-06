import {PluginCommAPI, PluginFileAPI, PluginNoteAPI} from 'sn-plugin-lib';

import type {SourceRef} from './lasso';
import {
  MARKER_PEN,
  SHADE_COLORS,
  STYLE_CODES,
  isMarkStyle,
  shadeColorValue,
  shadingLines,
  type MarkStyle,
} from './markstyle';
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

/** Element type 500 is a plain TextBox — what the caption is now. */
const TYPE_TEXT = 500;

/**
 * How far outside the lasso rectangle the wash reaches, in pixels.
 *
 * Zero, after trying 12. The host draws its box a little outside the selected
 * strokes, but it does not report how far, and the SDK offers no way to ask:
 * the only rectangle available is the lasso's own. Guessing at the margin
 * overshot and put the wash outside the box, which looks worse than stopping
 * short of it. So the wash covers exactly what was selected, and the box keeps
 * its clear border.
 *
 * Left as a named constant rather than removed: if the margin is ever
 * measurable, this is the one place to set it.
 */
const SHADE_PADDING = 0;

interface PageElement {
  type?: number;
  numInPage?: number;
  link?: {destPath?: string; X?: number; Y?: number; width?: number; height?: number} | null;
  geometry?: {penType?: number; penColor?: number; points?: {x: number; y: number}[]} | null;
  textBox?: {
    textContentFull?: string | null;
    textRect?: {left?: number; top?: number; right?: number; bottom?: number} | null;
  } | null;
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
  // Any colour this plugin is capable of drawing counts, not just the one
  // currently configured: somebody who marks a page in light grey and later
  // switches to dark grey must still have the first page tidied up when its
  // task is completed.
  if (geo.penType !== MARKER_PEN.penType || !SHADE_COLORS.some(c => c.value === geo.penColor)) {
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
 * Whether this TextBox is a caption this plugin wrote inside one of `boxes`.
 *
 * Two tests, as with the shading: our exact caption text, AND a position within
 * a box we drew. A user who happens to have typed the same words elsewhere on
 * the page keeps them; only the label sitting under our own mark is removed.
 *
 * The caption is written just BELOW the box, aligned to its left edge. One
 * version placed it to the right instead, so the match stays generous in both
 * directions — completing a task marked by any version must still tidy up after
 * it.
 */
function isOurCaption(element: PageElement, boxes: Required<Rect>[]): boolean {
  const box = element.textBox;
  if (element.type !== TYPE_TEXT || !box || box.textContentFull !== TASK_LABEL) {
    return false;
  }
  const rect = box.textRect;
  if (!rect || typeof rect.left !== 'number' || typeof rect.top !== 'number') {
    return false;
  }
  return boxes.some(
    b =>
      rect.left! >= b.left - CAPTION_WITHIN &&
      rect.left! <= b.right + CAPTION_WITHIN &&
      rect.top! >= b.top - CAPTION_WITHIN &&
      rect.top! <= b.bottom + CAPTION_WITHIN,
  );
}

/** How far below its box a caption may sit and still be recognised as ours. */
const CAPTION_WITHIN = 160;

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

    const ours = [
      ...links,
      ...listed.result.filter(el => isOurShading(el, boxes) || isOurCaption(el, boxes)),
    ]
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
 * Write a caption under the handwriting, as plain text.
 *
 * It used to be a second link pointing at the same image as the box, which left
 * two links on the page for one captured task: tapping either opened the Task
 * Hub logo, and the caption sat under the box looking like a separate thing to
 * press. `insertText` puts a TextBox on the page instead, so the box remains the
 * only link and the caption is simply a label.
 *
 * The completion cleanup finds it by its text and its position inside the box's
 * own rectangle, rather than by a destination path it no longer has.
 *
 * Takes the rect rather than reading it: `insertTextLink` writes into whatever
 * document is open, and by the time it runs the lasso may already have been
 * disturbed by the shading insert.
 */
export async function labelLassoStrokes(rect: Rect): Promise<string | null> {
  try {
    // Sized to the box rather than fixed: a caption in a constant size looks
    // wrong under both a scrawled word and half a page of writing. The bounds it
    // is clamped between come from the page, not from constants — a Nomad's page
    // is smaller than a Manta's in the same pixel space, so a fixed floor would
    // be proportionally larger there.
    const {min, max} = await labelFontBounds();
    const fontSize = Math.min(max, Math.max(min, Math.round((rect.bottom - rect.top) / 3)));
    const width = Math.round(fontSize * TASK_LABEL.length * 0.62);
    const height = Math.round(fontSize * 1.4);

    // Below the box, aligned to its left edge. Beside it — level with the middle
    // — was tried and read worse: the caption floated off the top-right of the
    // writing rather than belonging to it. Underneath, it reads as a label on
    // the thing above it, which is what it is.
    const left = rect.left;
    const top = rect.bottom + Math.round(fontSize / 3);

    const inserted = (await PluginNoteAPI.insertText({
      textContentFull: TASK_LABEL,
      textRect: {
        left,
        top,
        right: left + width,
        bottom: top + height,
      },
      fontSize,
      textAlign: 0,
      textBold: 0,
      textItalics: 0,
      textFrameWidthType: 0,
      // No border: the writing above already has a box, and a second frame
      // directly beneath it reads as a table.
      textFrameStyle: 0,
      // Not editable — it is this plugin's mark on the page, and the cleanup
      // has to be able to recognise it again by its text.
      textEditable: 1,
    })) as LooseResponse<boolean> | null | undefined;

    if (!inserted?.success) {
      return inserted?.error?.message ?? 'the device refused the label';
    }
    // insertText answers with a boolean, and a false is a refusal that reports
    // no error of its own.
    if (inserted.result !== true) {
      return 'the device accepted the caption but wrote nothing';
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
  // A rectangle with no area is not a usable one, and it is not obviously an
  // error to the host: insertGeometry would draw a line of zero length and
  // insertTextLink documents that its rect "must be non-zero area", so both
  // would fail to show anything without either of them saying so. Catch it here
  // where it can still be reported.
  if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) {
    return 'the selection reported an empty rectangle';
  }
  return rect;
}

/**
 * Wash the captured handwriting with the marker pen.
 *
 * Parallel horizontal strokes filling the lasso rectangle, the way a highlighter
 * is actually used on a block of writing: passes down the whole height, not one
 * line through the middle.
 *
 * One stroke was the first attempt and it read exactly as it was — a line
 * through the task rather than a wash behind it. The marker's own width is in
 * units the SDK does not relate to pixels, so the number of passes is derived
 * from the height of the selection instead: enough of them that they overlap
 * into a wash on a tall block of writing, and not so many on a single word that
 * the insert takes noticeably long.
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
export async function shadeLassoStrokes(
  rect: Rect,
  shadeColor?: string,
): Promise<string | null> {
  try {
    // The box the host draws around a lasso sits a little outside the strokes
    // themselves, so shading the raw selection covers the writing and leaves a
    // visible margin of unshaded paper inside the border. Growing the rectangle
    // by the same margin fills the box.
    const padded = {
      left: rect.left - SHADE_PADDING,
      right: rect.right + SHADE_PADDING,
      top: rect.top - SHADE_PADDING,
      bottom: rect.bottom + SHADE_PADDING,
    };
    const rows = shadingLines(padded);
    if (rows.length === 0) {
      return 'the selection had no height to shade';
    }

    for (const y of rows) {
      const inserted = (await PluginCommAPI.insertGeometry({
        type: GEO_STRAIGHT_LINE,
        // Drawn edge to edge of the selection, so the wash covers the writing
        // rather than stopping short of its first and last strokes.
        points: [
          {x: padded.left, y},
          {x: padded.right, y},
        ],
        // Leaving the lasso alone: the box has already been made from it, and
        // re-selecting the wash would replace that selection.
        showLassoAfterInsert: false,
        ...MARKER_PEN,
        // The user's choice wins over the module default; an unrecognised
        // stored value falls back to light grey rather than to nothing.
        penColor: shadeColor ? shadeColorValue(shadeColor) : MARKER_PEN.penColor,
      })) as LooseResponse<boolean> | null | undefined;

      if (!inserted?.success) {
        return inserted?.error?.message ?? 'the device refused to draw it';
      }
      // `success` only says the call was accepted. insertGeometry answers with a
      // boolean result, and a false there is a refusal that reports no error --
      // exactly the shape of "nothing was drawn and nothing said why".
      if (inserted.result !== true) {
        return 'the device accepted the request but drew nothing';
      }
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
  /** Which marker colour the wash uses, from the user's settings. */
  shadeColor?: string;
}

/**
 * Everything a captured task leaves on its page, in one errand.
 *
 * Order matters, and this is the order the SDK requires. The selection's bounds
 * are read FIRST, while the lasso is still live: getLassoRect fails without a
 * selection, and making the box consumes the one the user drew. The box is made
 * from that live lasso second. Shading and the label then draw into the
 * rectangle captured up front, rather than re-reading a selection that has since
 * been turned into a link.
 *
 * The page is saved and then reloaded at the end, in that order. Inserts land in
 * the host's in-memory page and do not repaint on their own, which is what "the
 * box works and nothing else does" looked like: the link is drawn by the live
 * lasso path, the inserts were not. Reloading without saving first is the same
 * symptom for a different reason — the reload re-reads the file and the unsaved
 * inserts go with it.
 *
 * Returns a sentence to append to the save confirmation, or '' when everything
 * asked for happened.
 */
export async function markPage(source: SourceRef, options: MarkOptions): Promise<string> {
  if (options.style === 'off') {
    return '';
  }

  // Read the bounds BEFORE the box is made, not after. Supernote documents that
  // getLassoRect "must create a lasso selection before calling this API;
  // otherwise the call fails" — and setLassoStrokeLink consumes the selection it
  // turns into a link. Reading afterwards therefore asks for the bounds of a
  // selection that may no longer exist, which is how both inserts came to be
  // handed a rectangle they could do nothing with.
  const drawing = options.shade || options.label;
  const rect = drawing ? await lassoRect() : null;

  const boxFailure = await markLassoStrokes(source, options.style);
  if (boxFailure) {
    return ` The page could not be marked — ${boxFailure}.`;
  }
  if (!drawing) {
    return ' Page marked.';
  }
  if (rect === null || typeof rect === 'string') {
    return ` Page marked, but nothing could be drawn around it — ${rect ?? 'no bounds were read'}.`;
  }

  let note = ' Page marked.';
  if (options.shade) {
    const failure = await shadeLassoStrokes(rect, options.shadeColor);
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

  // Flush before repainting, or the repaint undoes the work. Both inserts live
  // in the host's in-memory page until something saves it, and `reloadFile`
  // re-reads the file underneath — so reloading first discards them, silently
  // and with a success from every call involved. The box is unaffected because
  // the host persists the lasso link itself. `removePageMark` flushes for the
  // same reason before it reads the page back.
  try {
    await PluginNoteAPI.saveCurrentNote();
  } catch {
    // Not the current note, or nothing to save. The reload below then finds a
    // page that already matches the file.
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
