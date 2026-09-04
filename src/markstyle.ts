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
 * The marker pen, as the device reports it.
 *
 * Read off a real marker stroke through a temporary readout rather than guessed:
 * the SDK documents no penType values, and a wrong number here draws with a
 * solid pen — an opaque block over the user's handwriting instead of a wash over
 * it. `penColor` 202 is a palette index, not an RGB value.
 *
 * Shading is opt-in for the same reason. These numbers came from one device; if
 * another model numbers its pens differently, the worst case should be a setting
 * the user chose to turn on, not the default behaviour.
 */
export const MARKER_PEN = {
  penType: 11,
  penColor: 202,
  /**
   * Narrower than the 3800 the device reported for a hand-drawn marker stroke.
   * This is a wash under someone else's handwriting rather than a stroke of
   * their own, so it should read as background. Tune here — it is the only
   * place the width is set.
   */
  penWidth: 2200,
};
