/**
 * The suite runs in a timezone that is not UTC, deliberately.
 *
 * Set here, before any worker starts, because Node reads the zone once and
 * caches it — setting it inside a test file is too late and the assertions then
 * pass vacuously.
 *
 * The reason: this machine runs in UTC, where midnight local and midnight UTC
 * are the same instant. A Supernote to-do created for tomorrow arrived on the
 * device dated today, and no test could have caught it, because every date in
 * the suite was being checked in the one zone where the bug does not exist.
 * Running everything an offset away means anything that confuses a wall-clock
 * date with an instant fails here instead of on somebody's tablet.
 */
process.env.TZ = 'America/New_York';

module.exports = {
  preset: 'react-native',
  // sn-plugin-lib ships untranspiled ESM, and the react-native preset's default
  // transformIgnorePatterns does not cover it — without this, importing anything
  // that reaches the SDK fails with "Cannot use import statement outside a module".
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|sn-plugin-lib)/)',
  ],
};
