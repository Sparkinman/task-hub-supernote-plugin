/**
 * Whether this bundle is the demo build.
 *
 * Flipped to `true` by `buildDemo.sh` for the length of that build and put
 * straight back afterwards, so the real plugin can never ship with it set. It
 * lives in a file of its own precisely so the swap is one line in one place
 * that a failed build can restore without touching anything else.
 *
 * When true the plugin invents its own tasks and calendar, reads and writes
 * nothing in `Document/TaskHub`, and makes no network request at all — so it
 * can be installed beside the real one for a screen recording without touching
 * a single real setting.
 */
export const DEMO = false;
