/**
 * Writing the date at the top of a newly created note.
 *
 * A daily note whose only clue to which day it is is its filename means opening
 * the file to find out, and a page that says nothing when it is exported or read
 * on paper. This puts the date, in whatever format the settings say, into a text
 * box at the head of the first page.
 *
 * Only ever on creation. Adding it to a note that already exists would write
 * into the user's own page every time they opened it.
 *
 * **Written into the FILE, before the note is opened.** The first attempt used
 * `PluginNoteAPI.insertText`, which writes into whatever page is displayed, and
 * ran after the plugin had handed over to the NOTE app — by which point
 * `closePluginView` had already torn the plugin view down, so the calls it
 * needed had nothing to answer them and the date silently never appeared. The
 * file-level path has no such dependency: the note is not open, nothing is
 * displayed, and there is no race to lose.
 *
 * The geometry lives in `headinglayout.ts`, pure, so it can be tested off the
 * device; `sn-plugin-lib` resolves a TurboModule at import time that only exists
 * on the hardware.
 */

import {Element, PluginCommAPI, PluginFileAPI, TextBox} from 'sn-plugin-lib';

import {headingLayout, type PageSize} from './headinglayout';
import {ensureFileAccess} from './permissions';

const TAG = '[TaskHub]';

/** The page a newly created note has, and the layer a heading belongs on. */
const FIRST_PAGE = 0;
const MAIN_LAYER = 0;

/**
 * The page size to fall back on when the device will not say.
 *
 * A Manta's page. Being wrong here misplaces the heading on a smaller panel but
 * still puts it on the page; refusing to write anything would be worse, and the
 * note is not open at this point so there is no current page to measure.
 */
const ASSUMED_PAGE: PageSize = {width: 1920, height: 2560};

interface Loose {
  success?: boolean;
  result?: unknown;
  error?: {message?: string; code?: number};
}

/**
 * The page size for a note that is not open.
 *
 * `getPageDisplaySize` answers for the *current* page, and at this point there
 * is none — the note has only just been created. `getPageSize` takes a path,
 * but is FILE:READ-gated on recent firmware and answers unusably rather than
 * failing when the permission is absent, so a refusal here is expected and not
 * worth reporting.
 */
export async function pageSizeOf(absolutePath: string): Promise<PageSize> {
  try {
    const res = (await PluginFileAPI.getPageSize(absolutePath, FIRST_PAGE)) as Loose | null;
    const size = res?.result as PageSize | undefined;
    if (res?.success && size && size.width > 0 && size.height > 0) {
      return size;
    }
  } catch {
    // Fall through to the assumed page.
  }
  console.log(`${TAG} page size unavailable, assuming ${ASSUMED_PAGE.width}x${ASSUMED_PAGE.height}`);
  return ASSUMED_PAGE;
}

/**
 * Put `text` at the top of the first page of the note at `absolutePath`.
 *
 * Returns null on success, or a short reason it did not happen. Never throws:
 * the note itself has already been created by the time this runs, and failing
 * to decorate it must not read as failing to make it.
 */
export async function writeDateHeading(
  absolutePath: string,
  text: string,
): Promise<string | null> {
  try {
    // Already granted in practice — creating the note went through the same
    // gate — but asked for explicitly rather than relying on the order of two
    // separate call paths staying as it is.
    await ensureFileAccess();

    const page = await pageSizeOf(absolutePath);
    const {rect, fontSize} = headingLayout(page);

    // `createElement` is not a convenience: it allocates the element natively
    // and registers the accessors the host looks for behind its uuid, and an
    // object that merely has the right shape is rejected outright. Established
    // on hardware by the Tables plugin, which paid a device round trip for it.
    const allocated = (await PluginCommAPI.createElement(Element.TYPE_TEXT)) as Loose | null;
    const element = allocated?.result as Record<string, unknown> | undefined;
    if (!allocated?.success || !element) {
      return allocated?.error?.message ?? 'the device would not allocate a text element';
    }

    const box = new TextBox();
    box.textContentFull = text;
    box.textRect = rect;
    box.fontSize = fontSize;
    box.textAlign = 0;
    box.textBold = 1;
    box.textItalics = 0;
    box.textFrameWidthType = 0;
    // No frame: this is a heading on the page, not a box drawn round one.
    box.textFrameStyle = 0;
    // Editable, unlike the page-mark caption. That one is the plugin's own mark
    // and has to stay recognisable; this is the user's note and they may well
    // want to correct or restyle it.
    box.textEditable = 0;

    element.pageNum = FIRST_PAGE;
    element.layerNum = MAIN_LAYER;
    element.textBox = box;

    console.log(
      `${TAG} date heading "${text}" at ${rect.left},${rect.top} font ${fontSize} -> ${absolutePath}`,
    );

    const inserted = (await PluginFileAPI.insertElements(absolutePath, FIRST_PAGE, [
      element,
    ])) as Loose | null;

    // Deliberately NOT followed by saveCurrentNote. This wrote straight to the
    // file; saving would push the host's in-memory page back over what was just
    // written. That is the opposite of the rule for the in-memory insert calls,
    // and getting the two the wrong way round destroys the work silently.
    try {
      await (element as {recycle?: () => Promise<void>}).recycle?.();
    } catch {
      // Freeing native memory is best-effort; the write has already happened.
    }

    if (!inserted?.success || inserted.result === false) {
      const code = inserted?.error?.code;
      return `${inserted?.error?.message ?? 'the device refused the text'}${
        code ? ` (code ${code})` : ''
      }`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'the device refused the text';
  }
}
