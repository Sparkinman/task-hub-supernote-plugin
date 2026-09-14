/**
 * Where the date heading sits on a note page.
 *
 * Pure and SDK-free so it can be tested off the device — `sn-plugin-lib`
 * resolves a TurboModule at import time that only exists on the hardware, so
 * anything importing it cannot be exercised by jest. `dateheading.ts` is the
 * half that talks to the device; this is the half worth pinning, because a box
 * placed wrong writes a heading off the edge of somebody's note.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PageSize {
  width: number;
  height: number;
}

/**
 * Where the heading sits, as fractions of the page.
 *
 * Fractions rather than pixels because a Nomad's page is smaller than a Manta's
 * in the same pixel space, so anything fixed is proportionally larger on one of
 * them. The same reasoning as the page-mark caption's font bounds.
 */
const MARGIN_FRACTION = 0.06;
/**
 * Where the glyphs should actually land, measured from the top of the page.
 *
 * This is the BASELINE, not the top of the box — see BASELINE_OFFSET_RATIO. Far
 * enough down that the offset below cannot push the box off the page, and high
 * enough to read as a heading rather than a first line.
 */
const BASELINE_FRACTION = 0.07;
const FONT_FRACTION = 0.026;

/**
 * How far below the box's top the glyph baseline actually falls, as a multiple
 * of the font size.
 *
 * `insertText` does not draw the text at the top of the rectangle it is given.
 * Taking the rect at face value puts a "heading" a fifth of the way down the
 * page, which is the sort of thing only a device shows you.
 *
 * The figure is taken from taoist22's sn-datetime plugin, which measured it on
 * hardware against 8mm ruled lines: at font 40 an offset of 82px put text on the
 * intended line, and the same 82px at font 72 fell ~62px short — two points
 * fitting a straight proportion through 82/40. Not re-derived here, because
 * deriving it costs a build-and-install cycle to learn what somebody has already
 * written down.
 */
const BASELINE_OFFSET_RATIO = 2.05;

/**
 * Never smaller than this, whatever the page reports.
 *
 * sn-datetime offers 16 to 96 for a stamp; a heading wants to sit at the upper
 * end of that, and this is only a floor against an implausible page size.
 */
const MIN_FONT = 20;

/**
 * Nominal height of the box.
 *
 * Passed for a well-formed rectangle and nothing else: the same measurements
 * found that `insertText` IGNORES the height it is given and builds an element
 * of a fixed height, identical at font 40 and font 72. What scales with the
 * font is where the text sits inside that element, which is why the offset
 * above is a ratio rather than a constant.
 */
const LINE_HEIGHT = 1.7;

/**
 * The box the date goes in, and how big to set the type.
 *
 * Full width inside the margins rather than sized to the text: the device
 * reports no text metrics, so a box measured from a character count is a guess
 * that wraps the moment somebody picks a longer date format. A wide box costs
 * nothing — it has no border and the text is left-aligned inside it.
 */
export function headingLayout(page: PageSize): {rect: Rect; fontSize: number} {
  const margin = Math.round(page.width * MARGIN_FRACTION);
  const fontSize = Math.max(MIN_FONT, Math.round(page.height * FONT_FRACTION));
  // Work back from where the text should appear to where the box has to start.
  // Clamped at zero: on an implausibly small page the offset could otherwise
  // ask for a negative top, and the device would have to decide what that meant.
  const baseline = Math.round(page.height * BASELINE_FRACTION);
  const top = Math.max(0, Math.round(baseline - fontSize * BASELINE_OFFSET_RATIO));
  return {
    rect: {
      left: margin,
      top,
      right: Math.max(margin + fontSize, page.width - margin),
      bottom: top + Math.round(fontSize * LINE_HEIGHT),
    },
    fontSize,
  };
}

