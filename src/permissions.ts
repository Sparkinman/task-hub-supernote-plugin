import {PluginManager} from 'sn-plugin-lib';

/**
 * INTERNET is runtime-gated for every outbound socket — there is no
 * default-accessible exception. Two things must both be true or the request
 * dies silently:
 *
 *   1. 'plugin.permission.INTERNET' is listed in PluginConfig.json's
 *      uses-permissions. Calling hasPermission for an undeclared permission
 *      throws error 1500.
 *   2. requestPermission has been granted this session.
 *
 * Skipping (2) does not raise a catchable JS error — the socket is blocked with
 * `SocketException: ... has no NETWORK permission`, visible only in adb logcat.
 */

// 1 = allow once (revoked on plugin exit), 2 = always, 0 = deny, -1 = dismissed.
const GRANTED_SESSION = 1;
const GRANTED_ALWAYS = 2;

export class PermissionDeniedError extends Error {
  constructor() {
    super('PERMISSION_DENIED');
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Call immediately before the first network request, not at mount time, so the
 * system dialog appears in context.
 *
 * Never cache the result across sessions: "allow this time only" is revoked when
 * the plugin exits, so a cached `true` would send us into a silent socket block.
 */
export async function ensureInternet(): Promise<void> {
  const has = await PluginManager.hasPermission('plugin.permission.INTERNET');
  if (has === GRANTED_SESSION || has === GRANTED_ALWAYS) {
    return;
  }

  const result = await PluginManager.requestPermission(
    'plugin.permission.INTERNET',
    // Only shown if the user previously chose "don't allow".
    'task-sync uploads lassoed tasks to your CalDAV server.',
  );

  if (result !== GRANTED_SESSION && result !== GRANTED_ALWAYS) {
    // -1 (dialog dismissed) counts as denial, but the dialog will reappear on
    // the next call — surface a retry affordance rather than looping here.
    throw new PermissionDeniedError();
  }
}

/**
 * File access for the settings store.
 *
 * Document/ is outside the plugin's private directory, so both reads and writes
 * are permission-gated. Both are requested together: a plugin that can save but
 * not reload its settings is worse than one that never saved.
 */
export async function ensureFileAccess(): Promise<void> {
  for (const permission of [
    'plugin.permission.FILE:READ',
    'plugin.permission.FILE:WRITE',
  ]) {
    const has = await PluginManager.hasPermission(permission);
    if (has === GRANTED_SESSION || has === GRANTED_ALWAYS) {
      continue;
    }
    const result = await PluginManager.requestPermission(
      permission,
      'Task Hub saves your server settings to Document/TaskHub so they survive an update.',
    );
    if (result !== GRANTED_SESSION && result !== GRANTED_ALWAYS) {
      throw new PermissionDeniedError();
    }
  }
}
