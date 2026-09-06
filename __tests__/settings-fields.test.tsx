/**
 * Settings text inputs must not wipe each other out.
 *
 * `Field` is memoised with a comparator that deliberately ignores `onChange`,
 * because every call site passes a fresh arrow and comparing them would defeat
 * the memoisation entirely — which exists to keep the settings screen from
 * repainting an e-ink panel on every keystroke.
 *
 * The consequence is subtle and cost a real bug report: a Field that does not
 * re-render keeps the `onChange` closure it was given, and therefore whatever
 * state that closure captured. Two inputs built as `onChange({...config, x: v})`
 * will each hold a snapshot of `config` from a different moment, so typing in
 * the second one writes back its stale snapshot and erases what was typed in
 * the first. The user sees the address, username and password clearing
 * themselves out.
 *
 * The fix is that every handler must be a functional update, reading previous
 * state from the updater's argument rather than from the enclosing render.
 * Both spellings are exercised here so the failing one stays documented.
 */

import React, {useState} from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {TextInput} from 'react-native';

import {Field} from '../src/components/common';

type Config = {username: string; password: string};

function Form({functional}: {functional: boolean}): React.JSX.Element {
  const [config, setConfig] = useState<Config>({username: '', password: ''});
  return (
    <>
      <Field
        label="Username"
        value={config.username}
        onChange={v =>
          functional
            ? setConfig(c => ({...c, username: v}))
            : setConfig({...config, username: v})
        }
      />
      <Field
        label="Password"
        value={config.password}
        onChange={v =>
          functional
            ? setConfig(c => ({...c, password: v}))
            : setConfig({...config, password: v})
        }
      />
    </>
  );
}

/** Type into the nth TextInput, as the on-screen keyboard would. */
function typeInto(tree: TestRenderer.ReactTestRenderer, index: number, text: string) {
  const inputs = tree.root.findAllByType(TextInput);
  act(() => {
    inputs[index].props.onChangeText(text);
  });
}

function valuesOf(tree: TestRenderer.ReactTestRenderer): string[] {
  return tree.root.findAllByType(TextInput).map(i => i.props.value);
}

describe('settings credential fields', () => {
  it('keeps every field when each handler is a functional update', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Form functional />);
    });

    typeInto(tree, 0, 'paul');
    typeInto(tree, 1, 'hunter2');

    // Both survive: neither handler depended on a captured snapshot.
    expect(valuesOf(tree)).toEqual(['paul', 'hunter2']);
  });

  it('loses the earlier field when a handler captures state instead', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Form functional={false} />);
    });

    typeInto(tree, 0, 'paul');
    typeInto(tree, 1, 'hunter2');

    // This is the reported bug, pinned so nobody reintroduces the pattern:
    // the password field never re-rendered, so it still held the config from
    // before the username was typed, and writing it back cleared the username.
    expect(valuesOf(tree)).toEqual(['', 'hunter2']);
  });
});
