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
 * 2. **How long two hundred elements take.** The quarter page is 185 of them.
 *    If it is slow, the rules become one raster and only the dates stay as
 *    text — lines need no font, which is what makes that split possible.
 *
 * The third question — whether a background can hide the note's own template —
 * is answered below, and the answer is no, not this way.
 */

import {Element, Geometry, PluginCommAPI, PluginFileAPI, TextBox} from 'sn-plugin-lib';

import type {Background} from './background';
import {ensureFileAccess} from './permissions';

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
 * Why there is no mask, and what it would take to have one.
 *
 * The first attempt covered the page with a white `Picture` element stretched
 * to the page rect — 71 bytes and no encoder, which would have been the neat
 * answer to a lined template showing through a calendar grid. The device
 * refused the whole insert with **code 106, invalid API parameters**, and the
 * SDK says why in a comment that is easy to miss: `TYPE_PICTURE` is annotated
 * *"currently unused"*. There is no picture element to place.
 *
 * `PluginNoteAPI.insertImage` does exist, but it takes a path and nothing else
 * — no rect to stretch to — and it writes into the page the host is displaying,
 * which is the dependency `dateheading.ts` established cannot be relied on from
 * here.
 *
 * So a background drawn this way sits on top of whatever template the note
 * already has. If that template is ruled, use a blank one for notes that get a
 * calendar page. Masking with white geometry is the untried idea: `penColor`
 * runs 0 for black through 201 for light grey, so 255 is plausibly white, but
 * nothing has established that a white stroke paints over a template rather
 * than being composited away — and an experiment that is wrong leaves grey
 * bands across somebody's note.
 */

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

    const startedAllocating = Date.now();

    for (const rule of bg.rules) {
      const geo = await allocate(Element.TYPE_GEO);
      if (!geo) {
        continue;
      }
      geo.pageNum = pageNum;
      geo.layerNum = BACKGROUND_LAYER;
      // A real Geometry, not an object of the same shape. `createElement`
      // allocates natively and the host looks for its own accessors behind the
      // uuid; the same is true of the shapes hung off it, which is why
      // `dateheading` builds a `new TextBox()` rather than a literal. A literal
      // here was half of what the device rejected with code 106.
      const shape = new Geometry();
      shape.type = Geometry.TYPE_STRAIGHT_LINE;
      shape.penType = RULE_PEN.penType;
      shape.penColor = RULE_PEN.penColor;
      shape.penWidth = RULE_PEN.penWidth;
      // Off, or every rule leaves a lasso box on the page as it lands.
      shape.showLassoAfterInsert = false;
      shape.points = [
        {x: rule.left, y: rule.top},
        {x: rule.right, y: rule.bottom},
      ];
      geo.geometry = shape;
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
