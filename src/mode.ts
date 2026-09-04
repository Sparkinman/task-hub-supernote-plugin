/**
 * Which of the two plugins this bundle is.
 *
 * There is one source tree and two build outputs. `buildDemo.ps1` rewrites this
 * file to `true`, builds, and restores it — so the demo is always the real
 * plugin with a different data source, never a fork that can drift away from
 * what ships.
 *
 * It is a plain `const` rather than a runtime setting on purpose: Metro folds it
 * at bundle time, so the released plugin cannot be talked into demo mode, and
 * the demo cannot be talked into touching the network.
 *
 * MUST be committed as `false`.
 */
export const DEMO = false;
