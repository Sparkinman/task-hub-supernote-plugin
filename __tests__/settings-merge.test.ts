/**
 * Loading a settings file written by an older build.
 *
 * The bug: `sanitise` names every field explicitly, so a field the saved file
 * predates came back as `{markStyle: undefined}` — and `{...EMPTY_CONFIG,
 * ...sanitise(...)}` copies that undefined straight over the default. The page
 * mark was then requested with no style and silently never appeared.
 */

// storage.ts reaches the SDK through permissions.ts, whose TurboModule only
// exists on the device.
jest.mock('../src/permissions', () => ({
  ensureFileAccess: jest.fn().mockResolvedValue(undefined),
  ensureInternet: jest.fn().mockResolvedValue(undefined),
  PermissionDeniedError: class extends Error {},
}));

import {sanitise} from '../src/storage';
import {EMPTY_CONFIG, type RadicaleConfig} from '../src/settings';

/** Exactly what loadSettings does with the parsed file. */
const load = (stored: unknown): RadicaleConfig => ({...EMPTY_CONFIG, ...sanitise(stored)});

const OLD_FILE = {
  serverUrl: 'https://dav.example',
  username: 'user',
  password: 'pw',
  owner: '',
  collectionUrls: ['https://dav.example/user/work'],
  calendarUrls: [],
  defaultCollectionUrl: 'https://dav.example/user/work',
  dateFormat: 'iso',
  timeFormat: '24',
};

describe('a settings file that predates a field', () => {
  it('keeps the default instead of loading undefined', () => {
    expect(load(OLD_FILE).markStyle).toBe('dashed');
    expect(load(OLD_FILE).markShade).toBe(false);
  });

  it('keeps a saved false rather than treating it as missing', () => {
    // The bug this guards: a boolean that is legitimately false must not be
    // mistaken for an absent field and replaced by the default.
    expect(load({...OLD_FILE, markShade: true}).markShade).toBe(true);
    expect(load({...OLD_FILE, markShade: false}).markShade).toBe(false);
  });

  it('never emits an undefined for a key it names', () => {
    for (const [key, value] of Object.entries(sanitise(OLD_FILE))) {
      expect([key, value]).not.toEqual([key, undefined]);
    }
  });

  it('still loads everything the old file did carry', () => {
    const config = load(OLD_FILE);
    expect(config.serverUrl).toBe('https://dav.example');
    expect(config.username).toBe('user');
    expect(config.collectionUrls).toEqual(['https://dav.example/user/work']);
    expect(config.dateFormat).toBe('iso');
  });

  it('takes a saved value over the default when the file does have one', () => {
    expect(load({...OLD_FILE, markStyle: 'underline'}).markStyle).toBe('underline');
    expect(load({...OLD_FILE, markStyle: 'off'}).markStyle).toBe('off');
  });

  it('falls back for a value that is not a real style', () => {
    expect(load({...OLD_FILE, markStyle: 'sparkles'}).markStyle).toBe('dashed');
  });

  it('survives a file that is empty or nonsense', () => {
    expect(load({}).markStyle).toBe('dashed');
    expect(load(null).markStyle).toBe('dashed');
    expect(load('nope').markStyle).toBe('dashed');
  });
});
