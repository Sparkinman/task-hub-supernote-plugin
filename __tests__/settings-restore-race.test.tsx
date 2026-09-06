/**
 * A settings load that finishes late must not wipe what is being typed.
 *
 * Settings are read from shared storage asynchronously on first open. On a
 * device that read is slow enough to land *after* somebody has opened the
 * settings screen and started entering their server address — at which point
 * applying it replaces every field with what was on disk, which is usually
 * nothing. To the user, all three fields clear themselves the moment they type.
 *
 * Guarding the effect against running twice does not help: the damage is done
 * by the first run's continuation, not by a second run. The fix is to seed the
 * visible form only when the user has not already started editing it, tracked
 * in a ref so the async callback can read it without re-running the effect.
 *
 * This models that structure rather than mounting the whole plugin, which needs
 * the device SDK. Both orderings are exercised: a load that lands before any
 * typing must still seed the form.
 */

import React, {useEffect, useRef, useState} from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {TextInput} from 'react-native';

import {Field} from '../src/components/common';

type Config = {serverUrl: string; username: string};
const EMPTY: Config = {serverUrl: '', username: ''};

function SettingsForm(props: {
  load: () => Promise<Config>;
  /** The bug: apply the load unconditionally. */
  unguarded?: boolean;
}): React.JSX.Element {
  const [config, setConfig] = useState<Config>(EMPTY);
  const editedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await props.load();
      if (props.unguarded || !editedRef.current) {
        setConfig(stored);
      }
    })().catch(() => undefined);
    // Deliberately once, as the real effect is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (patch: Partial<Config>) => {
    editedRef.current = true;
    setConfig(c => ({...c, ...patch}));
  };

  return (
    <>
      <Field label="Server URL" value={config.serverUrl} onChange={v => change({serverUrl: v})} />
      <Field label="Username" value={config.username} onChange={v => change({username: v})} />
    </>
  );
}

function values(tree: TestRenderer.ReactTestRenderer): string[] {
  return tree.root.findAllByType(TextInput).map(i => i.props.value);
}

function typeInto(tree: TestRenderer.ReactTestRenderer, index: number, text: string) {
  act(() => {
    tree.root.findAllByType(TextInput)[index].props.onChangeText(text);
  });
}

describe('settings restored from disk while the user is typing', () => {
  /** A load the test controls the timing of, as a slow device would. */
  function pendingLoad() {
    let release!: (c: Config) => void;
    const promise = new Promise<Config>(resolve => {
      release = resolve;
    });
    return {load: () => promise, release};
  }

  it('keeps what was typed when the load lands afterwards', async () => {
    const {load, release} = pendingLoad();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<SettingsForm load={load} />);
    });

    typeInto(tree, 0, 'https://tasks.example.net');
    typeInto(tree, 1, 'testuser');

    // The settings file finally arrives, and it is empty.
    await act(async () => {
      release(EMPTY);
    });

    expect(values(tree)).toEqual(['https://tasks.example.net', 'testuser']);
  });

  it('still seeds the form when nothing has been typed yet', async () => {
    const {load, release} = pendingLoad();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<SettingsForm load={load} />);
    });

    await act(async () => {
      release({serverUrl: 'https://stored.example.net', username: 'stored'});
    });

    expect(values(tree)).toEqual(['https://stored.example.net', 'stored']);
  });

  it('without the guard, a late load wipes the fields', async () => {
    const {load, release} = pendingLoad();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<SettingsForm load={load} unguarded />);
    });

    typeInto(tree, 0, 'https://tasks.example.net');
    typeInto(tree, 1, 'testuser');

    await act(async () => {
      release(EMPTY);
    });

    // The reported symptom, pinned: everything clears at once.
    expect(values(tree)).toEqual(['', '']);
  });
});
