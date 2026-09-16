/**
 * Drawing a calendar background into a note page.
 *
 * The geometry lives in `background.ts`, pure and tested; this is the half that
 * talks to the device. Same split as `headinglayout.ts` / `dateheading.ts`, and
 * for the same reason: `sn-plugin-lib` resolves a TurboModule at import time
 * that only exists on the hardware, so nothing importing it can be exercised by
 * jest.
 *
 * **Written into the FILE, not the open page.** `dateheading.ts` paid for this
 * knowledge already: `PluginNoteAPI` calls write into whatever the host is
 * displaying, and run after the plugin view has been torn down, so they
 * silently do nothing. `PluginFileAPI.insertElements` has no such dependency —
 * and it takes an array, so a page of two hundred elements is one call rather
 * than two hundred.
 *
 * Three things here are unverified on hardware and are the reason the first
 * build of this reports its timings:
 *
 * 1. **Which layer sits under the writing.** Layers run 0-3 and nothing says
 *    which way they stack. `dateheading` puts a heading on 0 and the user
 *    writes there too, so the background goes on `BACKGROUND_LAYER` and that
 *    constant is the one to change if it comes out on top.
 * 2. **Whether the mask actually hides the note's template.** A lined template
 *    under a calendar grid is unreadable, so this matters more than it sounds.
 * 3. **How long two hundred elements take.** The quarter page is 185 of them.
 *    If it is slow, the rules become one raster and only the dates stay as
 *    text — lines need no font, which is what makes that split possible.
 */

import {Element, PluginCommAPI, PluginFileAPI, TextBox} from 'sn-plugin-lib';

import type {Background} from './background';
import {ensureFileAccess} from './permissions';
import {writeLinkImage} from './storage';

const TAG = '[TaskHub]';

/**
 * The layer the background is drawn on.
 *
 * Not 0: that is where `dateheading` writes and where handwriting lands, and a
 * background sharing a layer with the writing cannot be hidden or removed
 * without taking the writing with it.
 */
const BACKGROUND_LAYER = 1;

/**
 * A 2×2 solid white PNG, 71 bytes.
 *
 * The mask that hides the note's own template. `Picture` carries a path and a
 * rect and the host stretches one to the other, so the image's own size is
 * irrelevant — which means the whole of "cover the page in white" costs 71
 * bytes and no encoder. The alternative was rendering a full-page raster in
 * TypeScript, which needs a deflate implementation, about 800KB of base64 over
 * the bridge, and a bitmap font for every label.
 *
 * Regenerate with:
 *   python3 -c "import zlib,struct,base64; ..." — see the session that added it.
 */
const WHITE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAAAAABX3VL4AAAADklEQVR42mP4/5/h/38AC/oD/f1NxGYAAAAASUVORK5CYII=';
const WHITE_PNG_PATH = 'Document/TaskHub/background-mask.png';

/** The pen a background rule is drawn with: thin, and grey rather than black. */
const RULE_PEN = {penType: 1, penColor: 157, penWidth: 400};

interface Loose {
  success?: boolean;
  result?: unknown;
  error?: {message?: string; code?: number};
}

/** Allocate one element natively. Null when the device refuses. */
async function allocate(type: number): Promise<Record<string, unknown> | null> {
  // `createElement` is not a convenience: it allocates natively and registers
  // the accessors the host looks for behind the element's uuid. An object that
  // merely has the right shape is rejected outright.
  const made = (await PluginCommAPI.createElement(type)) as Loose | null;
  if (!made?.success || !made.result) {
    return null;
  }
  return made.result as Record<string, unknown>;
}

/** What a background draw cost, for deciding raster against vector. */
export interface DrawReport {
  error: string | null;
  /** Wall-clock milliseconds for the whole operation. */
  ms: number;
  /** How long allocating the elements took, as against inserting them. */
  allocateMs: number;
  elements: number;
}

/**
 * Draw `bg` onto one page of the note at `absolutePath`.
 *
 * Never throws. The note has already been created by the time this runs, and a
 * background that failed to draw must not read as a note that failed to appear.
 */
export async function writeBackground(
  absolutePath: string,
  pageNum: number,
  bg: Background,
): Promise<DrawReport> {
  const started = Date.now();
  let allocateMs = 0;
  const elements: Record<string, unknown>[] = [];

  try {
    await ensureFileAccess();

    // The mask first, so everything else is drawn over it rather than under.
    // Order within the array is the order the host receives them.
    const maskPath = await writeLinkImage(WHITE_PNG_PATH, WHITE_PNG_BASE64, 'Task Hub background');
    const startedAllocating = Date.now();
    if (maskPath) {
      const picture = await allocate(Element.TYPE_PICTURE);
      if (picture) {
        picture.pageNum = pageNum;
        picture.layerNum = BACKGROUND_LAYER;
        picture.picture = {picturePath: maskPath, rect: bg.mask};
        elements.push(picture);
      }
    }

    for (const rule of bg.rules) {
      const geo = await allocate(Element.TYPE_GEO);
      if (!geo) {
        continue;
      }
      geo.pageNum = pageNum;
      geo.layerNum = BACKGROUND_LAYER;
      geo.geometry = {
        ...RULE_PEN,
        // Off, or every rule leaves a lasso box on the page as it lands.
        showLassoAfterInsert: false,
        type: 'straightLine',
        points: [
          {x: rule.left, y: rule.top},
          {x: rule.right, y: rule.bottom},
        ],
      };
      elements.push(geo);
    }

    for (const label of bg.labels) {
      const text = await allocate(Element.TYPE_TEXT);
      if (!text) {
        continue;
      }
      const box = new TextBox();
      box.textContentFull = label.text;
      box.textRect = {
        left: label.left,
        top: label.top,
        right: label.left + label.text.length * label.fontSize,
        bottom: label.top + label.fontSize * 2,
      };
      box.fontSize = label.fontSize;
      box.textAlign = 0;
      box.textBold = 0;
      box.textItalics = 0;
      box.textFrameWidthType = 0;
      // No frame: these are marks on the page, not boxes drawn round one.
      box.textFrameStyle = 0;
      box.textEditable = 0;
      text.pageNum = pageNum;
      text.layerNum = BACKGROUND_LAYER;
      text.textBox = box;
      elements.push(text);
    }
    allocateMs = Date.now() - startedAllocating;

    console.log(
      `${TAG} background: ${elements.length} element(s), allocated in ${allocateMs}ms, ` +
        `layer ${BACKGROUND_LAYER}, page ${pageNum} -> ${absolutePath}`,
    );

    const inserted = (await PluginFileAPI.insertElements(
      absolutePath,
      pageNum,
      elements,
    )) as Loose | null;

    if (!inserted?.success || inserted.result === false) {
      const code = inserted?.error?.code;
      return {
        error: `${inserted?.error?.message ?? 'the device refused the background'}${
          code ? ` (code ${code})` : ''
        }`,
        ms: Date.now() - started,
        allocateMs,
        elements: elements.length,
      };
    }
    // Deliberately NOT followed by saveCurrentNote. This wrote straight to the
    // file; saving would push the host's in-memory page back over it.
    return {error: null, ms: Date.now() - started, allocateMs, elements: elements.length};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'the device refused the background',
      ms: Date.now() - started,
      allocateMs,
      elements: elements.length,
    };
  } finally {
    for (const element of elements) {
      try {
        await (element as {recycle?: () => Promise<void>}).recycle?.();
      } catch {
        // Freeing native memory is best-effort; the write has already happened.
      }
    }
  }
}
