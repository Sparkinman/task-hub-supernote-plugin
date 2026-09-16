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

/**
 * Writes never name a layer, on the element or in the call.
 *
 * Copied exactly from the Patterns plugin, whose comment is the reason: passing
 * an explicit layer to `insertPageElements` is refused with 813, "the layer of
 * the element does not match the provided layer parameter", **even when the
 * element's own `layerNum` is set to that same value**. An element allocated by
 * `createElement` evidently does not take the plain assignment.
 *
 * So `setCurrentLayer` makes the background layer current and the insert is
 * given null, which lets the device use it. Setting `layerNum` on each element
 * while passing null here was the mismatch that 813 describes, and is the most
 * likely reason a page could report success and arrive empty.
 */
const WRITE_LAYER = null;

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

  // Only if none of theirs matched. Writing the file every time cost a disk
  // write on every page for a fallback that has not been needed since
  // `style_white` was identified.
  if (names.length > 0) {
    return {names, presets: seen};
  }
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

/**
 * Text the host will certainly accept.
 *
 * The day page was the only one that drew nothing while the week and month
 * pages drew fine, and the only difference between them is that the day page
 * carries **arbitrary text from the user's own calendar** — event titles, list
 * names — where the others carry numbers and three-letter day names.
 *
 * One element the host dislikes rejects the whole batch. That is established:
 * asking for a single unsupported `TYPE_PICTURE` element refused an insert of
 * forty others along with it. So anything outside plain printable Latin is
 * replaced rather than risked, and a title long enough to be pathological is
 * cut.
 */
function safeText(text: string, limit = 60): string {
  const cleaned = (text ?? '')
    // Control characters, and anything above Latin-1: emoji in an event title
    // is entirely ordinary and is not worth losing the page for.
    // One expression, and no control-character class: anything outside plain
    // printable Latin goes, which covers control characters too.
    .replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}\u2026` : cleaned;
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

/**
 * Allocate elements, one at a time.
 *
 * **Sequential deliberately, and it is not an oversight.** These were built
 * sixty-four at a time for a while, copying the Patterns plugin, and the day
 * page went from drawing-and-crashing to drawing nothing in exactly that
 * build. Patterns allocates concurrently but only ever one element type at a
 * time; this allocates `TYPE_TEXT` as well, and `createElement` registers
 * native accessors behind a uuid, so re-entrancy across two types is not
 * something that plugin ever established.
 *
 * The cost is a bridge round trip each, measured there at about 1.2ms against
 * 37ms to insert one — so this is a few per cent of the wait, and not where the
 * time goes.
 */
/**
 * Allocate geometry several at a time.
 *
 * Only for `TYPE_GEO`, which is the case the Patterns plugin actually measured
 * and established — 192ms at one at a time against 57ms at sixty-four over the
 * same 48 marks, every one landing. Text is allocated singly by `allocateAll`:
 * doing both at once is what turned the day page blank, and re-entrancy across
 * two element types was never something that plugin demonstrated.
 */
async function allocateMany<T>(
  items: T[],
  make: (item: T) => Promise<Record<string, unknown> | null>,
): Promise<(Record<string, unknown> | null)[]> {
  const out: (Record<string, unknown> | null)[] = [];
  for (let i = 0; i < items.length; i += 32) {
    out.push(...(await Promise.all(items.slice(i, i + 32).map(make))));
  }
  return out;
}

async function allocateAll<T>(
  items: T[],
  make: (item: T) => Promise<Record<string, unknown> | null>,
): Promise<(Record<string, unknown> | null)[]> {
  const out: (Record<string, unknown> | null)[] = [];
  for (const item of items) {
    out.push(await make(item));
  }
  return out;
}

/** What a background draw cost, for deciding raster against vector. */
export interface DrawReport {
  error: string | null;
  /** Wall-clock milliseconds for the whole operation. */
  ms: number;
  /** How long allocating the elements took, as against inserting them. */
  allocateMs: number;
  elements: number;
  /** How many of them the device actually drew, counted rather than trusted. */
  landed: number;
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
  /**
   * The note to write into, absolute. When given, it is opened first.
   *
   * Everything here draws into the page the host is displaying, so the note has
   * to be open before anything can be put on it. Opening it **without** closing
   * the plugin view is the trick: `leaveForNote` calls `closePluginView`, after
   * which there is nothing left to answer the calls this needs — which is the
   * same dependency `dateheading.ts` established and worked around by writing
   * to the file instead. That option is not available here, because the file
   * route silently drops geometry.
   */
  target?: string,
): Promise<DrawReport> {
  const started = Date.now();
  let allocateMs = 0;
  // Declared out here so every return path — including the catch — can report
  // which template was used and what the device offered. There is no adb on
  // the build machine, so a detail only logged is a detail nobody can read.
  let usedTemplate = '';
  let presets: string[] = [];
  let landedCount = 0;
  const elements: Record<string, unknown>[] = [];

  try {
    await ensureFileAccess();

    // The note the user is looking at, not a path worked out from settings.
    // `insertPageElements` writes the host's in-memory page, so the page it
    // writes to is whichever one is displayed — which means the calendar goes
    // into the note they are in. That is how the Tables and Patterns plugins
    // work too, and it is the platform's shape rather than a compromise.
    if (target) {
      // Page 0: a calendar page belongs at the front of the note it describes,
      // not wherever the reader happened to be.
      await PluginFileAPI.openFile(target, 0);
    }
    const absolutePath = target || value<string>(await PluginCommAPI.getCurrentFilePath()) || '';
    const current = target
      ? -1
      : Number(value<number>(await PluginCommAPI.getCurrentPageNum()) ?? 0);
    if (!absolutePath) {
      return {
        error:
          'No note is open, and no note was named. Open a note, or turn on the note kind for this view in Settings.',
        ms: Date.now() - started,
        allocateMs: 0,
        elements: 0,
        landed: 0,
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
        landed: 0,
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
    // **No layer switching.** The background used to be put on a layer of its
    // own so a lasso round handwriting would not catch the rules under it, and
    // that is a genuinely nice property — but it asked for layer 1 on a page
    // that has just been created blank, and a fresh page has only layer 0. The
    // map then marked no layer current at all, and `modifyLayers` has its own
    // documented ways of failing on top of that.
    //
    // Drawing at all matters more than drawing somewhere tidy. The page is a
    // page of its own with nothing else on it, so the rules and the
    // handwriting sharing a layer costs far less here than it would in a table
    // drawn around somebody's existing notes.

    const startedAllocating = Date.now();

    // Built several at a time. One at a time is a bridge round trip each, and
    // it was a visible share of the wait on its own.
    const madeRules = await allocateMany(bg.rules, async rule => {
      const geo = await allocate(Element.TYPE_GEO);
      if (!geo) {
        return null;
      }
      geo.pageNum = pageNum;
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
      // **The line that makes a rule appear at all.** An element carries its
      // own thickness beside the pen's width, and without it the insert is
      // accepted and nothing is drawn.
      geo.thickness = RULE_PEN.penWidth;
      return geo;
    });

    const madeLabels = await allocateAll(bg.labels, async label => {
      const text = await allocate(Element.TYPE_TEXT);
      if (!text) {
        return null;
      }
      const box = new TextBox();
      box.textContentFull = safeText(label.text);
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
      text.textBox = box;
      return text;
    });

    for (const made of madeRules) {
      if (made) {
        elements.push(made);
      }
    }
    const ruleCount = elements.length;
    for (const made of madeLabels) {
      if (made) {
        elements.push(made);
      }
    }
    allocateMs = Date.now() - startedAllocating;

    console.log(
      `${TAG} background: ${elements.length} element(s), allocated in ${allocateMs}ms, ` +
        `page ${pageNum} -> ${absolutePath}`,
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
    // **Inserted in chunks, not as one batch.**
    //
    // The evidence for this is the three pages side by side. The week page
    // carries 7 text elements among ~45 rules and draws. The month page carries
    // 42 and does not. The day page carries 26 and does not. The week page has
    // *more* elements in total than the day page, so it is not the size of the
    // batch — it is how much text is in it.
    //
    // Chunking means a refusal costs one chunk instead of the page, and the
    // count says how far it got. Rules go first so that a page which loses its
    // text still arrives as a usable grid rather than as nothing at all.
    // Rules go in one call and text in small chunks, because the two behave
    // differently: the week page put ~45 rules down in a single insert without
    // complaint, while 26 text elements in one call drew nothing. Text is what
    // has to be rationed, and rationing the rules as well was simply slow.
    // Twelve. The week page proved 7 text elements in one call is safe and the
    // day page proved 26 is not, so the ceiling is somewhere between — twelve
    // sits under the middle of that range and halves the number of calls a
    // ninety-two-label quarter page needs. Lower it if a page ever comes up
    // short; the message says when one does.
    const TEXT_CHUNK = 12;
    const before = value<number>(await PluginFileAPI.getElementCounts(absolutePath, pageNum));
    let refusals = 0;
    const batches: Record<string, unknown>[][] = [];
    if (ruleCount > 0) {
      batches.push(elements.slice(0, ruleCount));
    }
    for (let i = ruleCount; i < elements.length; i += TEXT_CHUNK) {
      batches.push(elements.slice(i, i + TEXT_CHUNK));
    }

    for (const chunk of batches) {
      let res = (await PluginCommAPI.insertPageElements(
        chunk,
        pageNum,
        WRITE_LAYER,
      )) as Loose | null;
      if (res?.success !== true) {
        // One retry per chunk: the first insert after the panel opens is often
        // swallowed, which the Patterns plugin saw on every run on a Nomad and
        // never once on a Manta.
        res = (await PluginCommAPI.insertPageElements(
          chunk,
          pageNum,
          WRITE_LAYER,
        )) as Loose | null;
      }
      if (res?.success !== true) {
        refusals += 1;
        console.log(`${TAG} chunk of ${chunk.length} refused: ${JSON.stringify(res)}`);
      }
    }

    await PluginNoteAPI.saveCurrentNote();
    await PluginCommAPI.reloadFile();
    const after = value<number>(await PluginFileAPI.getElementCounts(absolutePath, pageNum));
    landedCount = Math.max(0, Number(after ?? 0) - Number(before ?? 0));
    if (refusals > 0) {
      console.log(`${TAG} ${refusals} chunk(s) refused; ${landedCount} element(s) landed`);
    }

    // The save above is what commits an in-memory write, and it comes before the
    // reload — the opposite of the rule for the file route, where a save after
    // the write pushes the stale page back over it. Two routes, opposite
    // orderings; match the save to the path.

    return {
      error: null,
      ms: Date.now() - started,
      allocateMs,
      elements: elements.length,
      landed: landedCount,
      template: usedTemplate,
      presets,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'the device refused the background',
      ms: Date.now() - started,
      allocateMs,
      elements: elements.length,
      landed: landedCount,
      template: usedTemplate,
      presets,
    };
  } finally {
    // **Nothing is recycled here, deliberately.** `createElement` allocates
    // natively and the host finds the element behind its uuid; after an
    // in-memory insert the host is still holding it, so freeing it pulls the
    // ground out from under the page it was just drawn on. On the device that
    // showed as a few elements arriving and then the note dying.
    //
    // `dateheading.ts` does recycle, and is right to: it writes through
    // `PluginFileAPI.insertElements`, where the element is serialised into the
    // file and nothing keeps a reference. Two routes, opposite rules, the same
    // way the save belongs after one and never after the other. The Patterns
    // plugin recycles nothing it inserts.
  }
}
