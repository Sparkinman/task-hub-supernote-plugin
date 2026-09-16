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
 * The third question — how a calendar grid survives a ruled template — is
 * answered below, and it is not by masking: the page carries its own.
 */

import {Element, Geometry, PluginCommAPI, PluginFileAPI, TextBox} from 'sn-plugin-lib';

import type {Background} from './background';
import {MY_STYLE_ROOT, listSystemTemplates} from './notes';
import {ensureFileAccess} from './permissions';
import {externalRoot, writeLinkImage} from './storage';

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
 * Names that might mean "a blank page", tried in order.
 *
 * The device ships a blank template among its presets, so the right answer is
 * to use theirs rather than install one. Which of these it is called is not
 * documented and differs by firmware and language, so the list is matched
 * loosely against `getNoteSystemTemplates()` and the first hit wins.
 */
const BLANK_PATTERNS = [/^blank$/i, /^none$/i, /^plain$/i, /^white$/i, /blank/i, /空白/];

/**
 * A blank white PNG, 71 bytes — the fallback if no preset matches.
 *
 * Written into MyStyle, where the device keeps user templates, so it is a
 * legitimate template rather than a file smuggled in from somewhere the host
 * does not look. Two pixels of white: a template is scaled or tiled to the page
 * and white does the same thing either way, so its own size is irrelevant.
 */
const BLANK_TEMPLATE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAAAAABX3VL4AAAADklEQVR42mP4/5/h/38AC/oD/f1NxGYAAAAASUVORK5CYII=';
const BLANK_TEMPLATE_NAME = 'TaskHub-blank.png';

/**
 * Every spelling of "a blank page" worth trying, best first.
 *
 * Several, tried in turn, because which form a given firmware accepts is
 * undocumented — the same problem `createAt` in `notes.ts` already solves the
 * same way. Two answers are already ruled out and must not be retried: an empty
 * string is refused with **code 107** (blank is not expressible as "no
 * template"), and covering the page with a white `Picture` element is refused
 * with **code 106**, because the SDK annotates `TYPE_PICTURE` as *"currently
 * unused"*.
 */
async function blankTemplateNames(): Promise<{names: string[]; presets: string[]}> {
  const names: string[] = [];
  let seen: string[] = [];
  try {
    const presets = await listSystemTemplates();
    seen = presets.map(t => t.name);
    for (const pattern of BLANK_PATTERNS) {
      for (const preset of presets) {
        if (pattern.test(preset.name) && !names.includes(preset.name)) {
          names.push(preset.name, preset.vUri);
        }
      }
    }
    console.log(
      `${TAG} presets: ${presets.map(t => t.name).join(', ') || 'none'} — blank candidates ${
        names.join(', ') || 'none'
      }`,
    );
  } catch (err) {
    console.log(`${TAG} could not list presets: ${String(err)}`);
  }

  // Only if none of theirs matched.
  const relative = `${MY_STYLE_ROOT}/${BLANK_TEMPLATE_NAME}`;
  try {
    const written = await writeLinkImage(relative, BLANK_TEMPLATE_BASE64, 'Task Hub blank page');
    if (written) {
      names.push(written);
    }
    const root = await externalRoot();
    if (root) {
      names.push(`${root}/${relative}`);
    }
    names.push(relative, BLANK_TEMPLATE_NAME);
  } catch {
    // The presets are the real answer; this is only the safety net.
  }
  return {names, presets: seen};
}

/**
 * The pen a background rule is drawn with.
 *
 * `penType: 11` and a width in the low thousands are the only values ever
 * observed to draw on this hardware — `pagemark.ts` shades with them and its
 * lines appear. The first attempt here invented `penType: 1` at width 400 and
 * **nothing rendered at all**: the text elements on the same page arrived and
 * the rules did not, which is the signature of a pen the host does not
 * recognise rather than of a failed insert.
 *
 * The width is the open question. 3800 is what the device reported for a
 * hand-drawn marker stroke and 2200 reads as a background wash, so a hairline
 * is somewhere below that and may have a floor under which nothing is drawn.
 * `CALIBRATION` exists to find it.
 */
const RULE_PEN = {penType: 11, penColor: 157, penWidth: 1000};

/**
 * Pen settings drawn as a labelled strip at the top of the page, once.
 *
 * Because "nothing appeared" is not a measurement. Each row is a short line
 * with its own settings written beside it, so one look at the page says which
 * pens draw, how heavy each width is, and therefore what a hairline should be —
 * instead of another build per guess.
 *
 * Delete this, and the strip it draws, once the answer is known.
 */
const CALIBRATION: {penType: number; penWidth: number}[] = [
  {penType: 11, penWidth: 100},
  {penType: 11, penWidth: 300},
  {penType: 11, penWidth: 600},
  {penType: 11, penWidth: 1000},
  {penType: 11, penWidth: 2200},
  {penType: 1, penWidth: 1000},
  {penType: 0, penWidth: 1000},
  {penType: 2, penWidth: 1000},
];

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
  /** Which template the blank page actually got. Reported, not logged: there
   * is no adb on the machine this is built from, so anything only logged is
   * invisible to the person who can see the device. */
  template: string;
  /** Every preset the device offers, for the same reason. */
  presets: string[];
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
  // Declared out here so every return path — including the catch — can report
  // which template was used and what the device offered. There is no adb on
  // the build machine, so a detail only logged is a detail nobody can read.
  let usedTemplate = '';
  let presets: string[] = [];
  const elements: Record<string, unknown>[] = [];

  try {
    await ensureFileAccess();

    // A page of its own, blank, rather than drawing over one of the user's.
    // Their ruling stays on their pages; the calendar gets clean paper.
    let added: Loose | null = null;
    const offered = await blankTemplateNames();
    presets = offered.presets;
    for (const candidate of offered.names) {
      added = (await PluginFileAPI.insertNotePage({
        notePath: absolutePath,
        page: pageNum,
        template: candidate,
      })) as Loose | null;
      if (added?.success && added.result !== false) {
        usedTemplate = candidate;
        break;
      }
    }
    if (!added?.success || added.result === false) {
      const code = added?.error?.code;
      return {
        error: `${added?.error?.message ?? 'the device would not add a page'}${
          code ? ` (code ${code})` : ''
        }`,
        ms: Date.now() - started,
        allocateMs: 0,
        elements: 0,
        template: '',
        presets,
      };
    }
    console.log(`${TAG} blank page inserted with template "${usedTemplate}"`);

    const startedAllocating = Date.now();

    // The calibration strip, first and at the very top, so it is the first
    // thing seen and cannot be confused with the grid below it.
    let calibrationY = 60;
    for (const pen of CALIBRATION) {
      const line = await allocate(Element.TYPE_GEO);
      if (line) {
        const shape = new Geometry();
        shape.type = Geometry.TYPE_STRAIGHT_LINE;
        shape.penType = pen.penType;
        shape.penColor = RULE_PEN.penColor;
        shape.penWidth = pen.penWidth;
        shape.showLassoAfterInsert = false;
        shape.points = [
          {x: 420, y: calibrationY},
          {x: 900, y: calibrationY},
        ];
        line.pageNum = pageNum;
        line.layerNum = BACKGROUND_LAYER;
        line.geometry = shape;
        elements.push(line);
      }
      const caption = await allocate(Element.TYPE_TEXT);
      if (caption) {
        const box = new TextBox();
        box.textContentFull = `type ${pen.penType} width ${pen.penWidth}`;
        box.textRect = {left: 40, top: calibrationY - 20, right: 400, bottom: calibrationY + 30};
        box.fontSize = 28;
        box.textAlign = 0;
        box.textBold = 0;
        box.textItalics = 0;
        box.textFrameWidthType = 0;
        box.textFrameStyle = 0;
        box.textEditable = 0;
        caption.pageNum = pageNum;
        caption.layerNum = BACKGROUND_LAYER;
        caption.textBox = box;
        elements.push(caption);
      }
      calibrationY += 70;
    }

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
        template: usedTemplate,
        presets,
      };
    }
    // Deliberately NOT followed by saveCurrentNote. This wrote straight to the
    // file; saving would push the host's in-memory page back over it.
    return {
      error: null,
      ms: Date.now() - started,
      allocateMs,
      elements: elements.length,
      template: usedTemplate,
      presets,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'the device refused the background',
      ms: Date.now() - started,
      allocateMs,
      elements: elements.length,
      template: usedTemplate,
      presets,
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
