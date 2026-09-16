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
 * 2. **How long two hundred elements take.** The Patterns plugin measured this
 *    on an A6X2 and got 37-40ms an element, flat, for a single insert call —
 *    which puts the quarter page's 185 elements at about seven seconds. If that
 *    holds here, the only real lever is fewer elements for the same picture,
 *    not a faster route: building an element costs 1.2ms against 37ms to insert
 *    it, so nothing on this side of the bridge helps.
 *
 * The third question — how a calendar grid survives a ruled template — is
 * answered below, and it is not by masking: the page carries its own.
 */

import {
  Element,
  Geometry,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
  TextBox,
} from 'sn-plugin-lib';

import type {Background, PageSize} from './background';
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
const MAIN_LAYER = 0;

/** A Manta's page, for when the device will not say. Same value as `dateheading`. */
const FALLBACK_PAGE: PageSize = {width: 1920, height: 2560};

/**
 * Names that might mean "a blank page", tried in order.
 *
 * It is called **`style_white`** on this firmware — established by listing the
 * presets on a device rather than guessed. The first attempt matched `/^white$/`
 * exactly, missed it, and fell through to the PNG fallback, whose caption then
 * appeared in the middle of every page as "Task Hub blank page". Matched
 * loosely now, exact name first, because the name will differ by firmware and
 * language.
 */
const BLANK_PATTERNS = [/^style_white$/i, /white/i, /blank/i, /^none$/i, /^plain$/i, /空白/];

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
 * Every value here is copied from `patterns-supernote-plugin/src/grid/types.ts`
 * rather than derived. That plugin draws thousands of rules on this hardware and
 * its constants are device-verified; the SDK's type definitions specify none of
 * them, and four builds of this feature drew nothing because they were invented
 * instead of looked up.
 *
 * - `penType` 10 is the **fineliner**. 11 is the marker, which is a wash rather
 *   than a line and is what `pagemark.ts` shades with.
 * - `penColor` 0x9d is dark grey and 0xc9 light grey — the two weights the
 *   maintainer already uses. 0xfe is white, which is worth remembering exists.
 * - `penWidth` has a floor of 100 (`GeometrySchema` refuses less) and
 *   `new Geometry()` defaults it to **0**, so it must always be set explicitly.
 *   The widely-copied `penWidth: 3` example is refused outright.
 *
 * Light grey, because these are rules to write over rather than lines to read.
 */
const RULE_PEN = {penType: 10, penColor: 0xc9, penWidth: 400};

/**
 * What a page of rules costs, measured — so nothing here has to be timed again.
 *
 * `patterns-supernote-plugin` measured this on an A6X2: 48 elements took
 * 1,912ms, 120 took 4,533 and 460 took 16,941 — **37 to 40ms an element, flat,
 * in a single insert call**. Building an element is 1.2ms against 37ms to
 * insert it, so concurrency is worth 6% on the job and nothing on this side of
 * the bridge makes it quicker.
 *
 * The only lever is fewer elements for the same picture. The day page is about
 * 31 and lands near a second; the quarter page is 185 and will take roughly
 * seven. If that is too slow it needs a cheaper drawing, not a faster route.
 */
export const MS_PER_ELEMENT = 38;

interface Loose {
  success?: boolean;
  result?: unknown;
  error?: {message?: string; code?: number};
}

/**
 * The value out of an `APIResponse`, or null.
 *
 * Every one of these calls answers `{success, result, error}` rather than the
 * value itself. Casting the envelope to the value is how "no note is open"
 * appeared while a note plainly was: `getCurrentFilePath` returned an object,
 * the string check failed, and the message blamed the user for it. The sibling
 * plugins unwrap everything through a helper of exactly this shape, which is
 * the reason they do not hit this.
 */
function value<T>(res: unknown): T | null {
  if (res && typeof res === 'object' && 'result' in (res as Record<string, unknown>)) {
    const inner = (res as {result?: unknown}).result;
    return (inner ?? null) as T | null;
  }
  return (res ?? null) as T | null;
}

interface RawLayer {
  layerId: number;
  name: string;
  isVisible: boolean;
  isCurrentLayer?: boolean;
}

/**
 * Make one layer the current one, and say whether it worked.
 *
 * Copied wholesale from `patterns-supernote-plugin`, filter and retry included,
 * because both exist for reasons that cost that project device runs to find.
 *
 * The filter: the background layer comes back with `layerId -1`, and
 * `modifyLayers` rejects the **entire call** with "layerId must be >= 0" if it
 * is handed straight back.
 *
 * The retry: this answers 1207, "the page does not exist", on a page that
 * plainly does — always right after a write, which looks like the page being
 * momentarily unavailable while a reload is in flight. That is this firmware's
 * signature failure. Giving up leaves the user on the plugin's layer, where
 * their next stroke lands among the rules and the eraser can reach them.
 */
async function setCurrentLayer(
  filePath: string,
  page: number,
  layerId: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      // A save first, because that is what settles the file against the host's
      // page everywhere else here.
      await PluginNoteAPI.saveCurrentNote();
    }
    const layers = value<RawLayer[]>(await PluginFileAPI.getLayers(filePath, page));
    if (!Array.isArray(layers)) {
      continue;
    }
    const res = (await PluginFileAPI.modifyLayers(
      filePath,
      page,
      layers
        .filter(l => l.layerId >= 0)
        .map(l => ({
          layerId: l.layerId,
          name: l.name,
          isVisible: l.isVisible,
          isCurrentLayer: l.layerId === layerId,
        })),
    )) as Loose | null;
    if (res?.success === true) {
      return true;
    }
    console.log(`${TAG} modifyLayers refused: ${JSON.stringify(res)}`);
  }
  return false;
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
  build: (page: PageSize) => Background,
): Promise<DrawReport> {
  const started = Date.now();
  let allocateMs = 0;
  // Declared out here so every return path — including the catch — can report
  // which template was used and what the device offered. There is no adb on
  // the build machine, so a detail only logged is a detail nobody can read.
  let usedTemplate = '';
  let presets: string[] = [];
  let switched = false;
  let notePath = '';
  let drawnPage = 0;
  const elements: Record<string, unknown>[] = [];

  try {
    await ensureFileAccess();

    // The note the user is looking at, not a path worked out from settings.
    // `insertPageElements` writes the host's in-memory page, so the page it
    // writes to is whichever one is displayed — which means the calendar goes
    // into the note they are in. That is how the Tables and Patterns plugins
    // work too, and it is the platform's shape rather than a compromise.
    const absolutePath = value<string>(await PluginCommAPI.getCurrentFilePath()) ?? '';
    notePath = absolutePath;
    const current = Number(value<number>(await PluginCommAPI.getCurrentPageNum()) ?? 0);
    if (!absolutePath) {
      return {
        error: 'No note is open. Open the note you want the calendar page in, then try again.',
        ms: Date.now() - started,
        allocateMs: 0,
        elements: 0,
        template: '',
        presets: [],
      };
    }
    // Straight after the page being looked at, so it arrives where the user is
    // rather than at the front of a note they may be deep inside.
    const pageNum = current + 1;

    // The device's own page size, asked for here rather than passed in: the
    // caller has no way to know it, and `getPageDisplaySize` is what the SDK
    // says to use for anything that will be drawn on the current page.
    const size = value<{width?: number; height?: number}>(
      await PluginCommAPI.getPageDisplaySize(),
    );
    const bg = build({
      width: Number(size?.width) || FALLBACK_PAGE.width,
      height: Number(size?.height) || FALLBACK_PAGE.height,
    });

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

    // The insert lands on the displayed page, so the new one has to be shown
    // before anything is drawn into it.
    await PluginCommAPI.jumpToPage(pageNum);

    // Onto a layer of its own, so a lasso round the user's handwriting does not
    // also catch the rules under it — the single-layer lasso stops being a
    // limitation and becomes the point. Restored in the finally below, without
    // fail: leaving somebody on the plugin's layer means their next stroke
    // lands among the rules.
    drawnPage = pageNum;
    switched = await setCurrentLayer(absolutePath, pageNum, BACKGROUND_LAYER);
    if (!switched) {
      console.log(`${TAG} could not switch layer; drawing on the current one`);
    }

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
      // **The line that makes a rule appear at all.** Taken from the Patterns
      // plugin, which draws thousands of these: an element carries its own
      // thickness beside the pen's width, and without it the insert is accepted
      // and nothing is drawn — the exact failure seen here, where the text
      // elements in the same call arrived and every rule did not.
      geo.thickness = RULE_PEN.penWidth;
      elements.push(geo);
    }

    for (const label of bg.labels) {
      const text = await allocate(Element.TYPE_TEXT);
      if (!text) {
        continue;
      }
      const box = new TextBox();
      box.textContentFull = label.text;
      // Generous, because a box that is merely wide enough wraps. "14" came
      // back as a 1 above a 4 on the device: the host measures its own font and
      // a width derived from `length * fontSize` is not the width it needs.
      // Nothing reads the box's edges, so there is no cost to overshooting.
      box.textRect = {
        left: label.left,
        top: label.top,
        right: label.left + Math.max(240, label.text.length * label.fontSize * 2),
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

    // **The in-memory page, not the file.** This is the whole reason nothing
    // drew: `PluginFileAPI.insertElements` writes straight to the file and
    // carries text fine — `dateheading.ts` relies on it — but geometry inserted
    // that way is accepted and never appears. The Patterns plugin, which draws
    // thousands of rules, uses this route exclusively and never the file one.
    //
    // The layer is null on purpose. Passing one explicitly is refused with 813,
    // "the layer of the element does not match the provided layer parameter",
    // even when the element's own layerNum says the same thing. Whichever layer
    // is current is the one it lands on.
    const before = value<number>(await PluginFileAPI.getElementCounts(absolutePath, pageNum));
    let inserted = (await PluginCommAPI.insertPageElements(
      elements,
      pageNum,
      null,
    )) as Loose | null;

    // **Counted, not trusted, and retried once.** The Patterns plugin recorded
    // this after losing a session to it: the first batch insert after the panel
    // opens is often swallowed — it reports success and draws nothing — and a
    // second attempt always lands. On a Nomad it happened to every first
    // insert; on a Manta, never. A path that writes without checking is a path
    // that silently does nothing on one of the two panels.
    await PluginNoteAPI.saveCurrentNote();
    const after = value<number>(await PluginFileAPI.getElementCounts(absolutePath, pageNum));
    const landed = Number(after ?? 0) - Number(before ?? 0);
    if (landed <= 0) {
      console.log(`${TAG} first insert drew nothing (${before} -> ${after}); retrying`);
      inserted = (await PluginCommAPI.insertPageElements(elements, pageNum, null)) as Loose | null;
    }

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
    // Save, THEN reload — the ordering for an in-memory write, and the opposite
    // of the rule for the file route. Reloading without saving first throws the
    // insert away, which looks exactly like the API having silently done
    // nothing. Two write paths, opposite orderings; match the save to the path.
    await PluginNoteAPI.saveCurrentNote();
    await PluginCommAPI.reloadFile();

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
    // The user goes back to their own layer whatever happened above, including
    // if it threw. This is the one thing the layer arrangement exists for.
    if (switched && notePath) {
      await setCurrentLayer(notePath, drawnPage, MAIN_LAYER).catch(() => false);
    }
    for (const element of elements) {
      try {
        await (element as {recycle?: () => Promise<void>}).recycle?.();
      } catch {
        // Freeing native memory is best-effort; the write has already happened.
      }
    }
  }
}
