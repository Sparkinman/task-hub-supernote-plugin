/**
 * How a captured task marks the page it came from.
 *
 * Pure data, deliberately separate from `pagemark.ts`: settings and storage need
 * these values, and both are imported by the off-device tests, which cannot load
 * the SDK.
 */

export type MarkStyle = 'dashed' | 'solid' | 'underline' | 'off';

export const MARK_STYLES: {key: MarkStyle; label: string}[] = [
  {key: 'dashed', label: 'Dashed box'},
  {key: 'solid', label: 'Solid box'},
  {key: 'underline', label: 'Underline'},
  {key: 'off', label: 'No mark'},
];

/** Style codes as `setLassoStrokeLink` defines them. */
export const STYLE_CODES: Record<Exclude<MarkStyle, 'off'>, number> = {
  underline: 0,
  solid: 1,
  dashed: 2,
};

export function isMarkStyle(value: unknown): value is MarkStyle {
  return MARK_STYLES.some(m => m.key === value);
}

/**
 * The marker pen, in the values `insertGeometry` documents.
 *
 * Supernote's own documentation for the Geometry type lists exactly four pen
 * colours — 0 black, 157 dark grey, 201 light grey, 254 white — and four pen
 * types, of which 11 is the marker. An earlier version of this file carried
 * `penColor: 202`, read off a hand-drawn marker stroke on one device. That is
 * one away from the documented light grey and is not a value the API lists, so
 * it is likely why nothing was drawn at all.
 *
 * Light grey is the right choice regardless of that: this is a wash under
 * somebody else's handwriting, and it has to stay readable through.
 *
 * Shading is still opt-in. These values now come from the documentation rather
 * than from one device, but the marks land in the user's own notes, so the worst
 * case should be a setting they chose to turn on.
 */
/**
 * The shading colours offered, from the four `insertGeometry` documents.
 *
 * White is deliberately not offered: it is a documented value, but a white wash
 * over handwriting on a white page marks nothing. Black is, because somebody may
 * want a real strike-through rather than a highlight — it is their note.
 */
export const SHADE_COLORS: {key: string; label: string; value: number}[] = [
  {key: 'light', label: 'Light grey', value: 201},
  {key: 'dark', label: 'Dark grey', value: 157},
  {key: 'black', label: 'Black', value: 0},
];

/** The stored value, falling back to light grey for anything unrecognised. */
export function shadeColorValue(key: string): number {
  return SHADE_COLORS.find(c => c.key === key)?.value ?? 201;
}

export function isShadeColor(value: unknown): boolean {
  return SHADE_COLORS.some(c => c.key === value);
}

export const MARKER_PEN = {
  penType: 11,
  penColor: 201,
  /**
   * Narrower than the 3800 the device reported for a hand-drawn marker stroke.
   * This is a wash under someone else's handwriting rather than a stroke of
   * their own, so it should read as background. Tune here — it is the only
   * place the width is set.
   */
  penWidth: 2200,
};

/**
 * Just enough of a rectangle for the shading maths.
 *
 * Left and right are accepted and ignored, so a caller can pass the lasso
 * rectangle it already has rather than picking it apart first.
 */
interface ShadeRect {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
}

/** Pixels between passes of the marker, and the ceiling on how many are drawn. */
const SHADE_SPACING = 14;
const SHADE_MAX_PASSES = 14;

/**
 * The y positions to draw the marker along, filling a selection.
 *
 * One stroke through the middle was the first attempt and read exactly as it
 * was — a line through the task rather than a wash behind it. The marker's own
 * width is in units the SDK does not relate to pixels, so the number of passes
 * is derived from the height of the selection instead.
 *
 * Lives here rather than beside the insert that uses it because this module
 * imports no SDK: the plugin library resolves a TurboModule at import time that
 * only exists on the device, so anything in `pagemark.ts` cannot be unit tested.
 */
export function shadingLines(rect: ShadeRect): number[] {
  const height = rect.bottom - rect.top;
  if (height <= 0) {
    return [];
  }
  // At least two passes, so even a single word reads as a band rather than a
  // line; never more than the cap, because each pass is a separate insert
  // across the bridge and a tall selection would otherwise be slow to mark.
  const wanted = Math.round(height / SHADE_SPACING);
  const passes = Math.min(SHADE_MAX_PASSES, Math.max(2, wanted));
  const step = height / (passes + 1);
  return Array.from({length: passes}, (_, i) => Math.round(rect.top + step * (i + 1)));
}
