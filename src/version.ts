import config from '../PluginConfig.json';

/**
 * What this bundle was built from, read out of the file the packager itself
 * reads so the two cannot drift apart.
 *
 * It exists because "is the feature missing, or is the build missing?" has cost
 * real round trips: a plugin that does not say which version it is leaves that
 * question answerable only by rebuilding and reinstalling to find out.
 */
export const APP_VERSION = String(config.versionName ?? '');
export const APP_BUILD = String(config.versionCode ?? '');
