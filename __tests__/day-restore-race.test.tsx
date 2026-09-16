/**
 * A settings load that finishes late must not move the calendar.
 *
 * Settings are read from shared storage asynchronously on first open, and they
 * carry `lastDay` — the day the plugin was left from, so coming back from a note
 * lands where it was. On a device that read is slow enough to land *after*
 * somebody has already pressed Today, at which point applying it drags the
 * calendar back to the bookmarked day.
 *
 * Reported from the week view, which is where it is easiest to walk into:
 * Insert snapshot pages nothing, but it hands over to the note it just wrote,
 * and leaving writes `lastDay`. So the sequence "page a week forward, insert a
 * snapshot, write on it, come back, press Today" is the one case where the
 * bookmark is a day other than today — and Today looked like it did nothing.
 * Pressing it a second time worked, because by then the restore had landed.
 *
 * The guard is a ref set by the day and view setters, so every one of the dozen
 * places that move the calendar marks it without having to remember to.
 *
 * This models that structure rather than mounting the whole plugin, which needs
 * the device SDK. Both orderings are exercised: a load that lands before anybody
 * touches the calendar must still restore the bookmarked day.
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';

const TODAY = '2026-09-16';
const BOOKMARK = '2026-09-23';

function Calendar(props: {
  load: () => Promise<{lastDay: string}>;
  /** The bug: apply the restore whatever the user has done in the meantime. */
  unguarded?: boolean;
}): React.JSX.Element {
  const [day, setDayState] = useState(TODAY);
  const movedRef = useRef(false);
  const setDay = useCallback((next: string) => {
    movedRef.current = true;
    setDayState(next);
  }, []);

  useEffect(() => {
    (async () => {
      const stored = await props.load();
      if (props.unguarded || !movedRef.current) {
        setDayState(stored.lastDay);
      }
    })();
    // Once, on mount, exactly as the real restore runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Pressable testID="today" onPress={() => setDay(TODAY)}>
      <Text testID="day">{day}</Text>
    </Pressable>
  );
}

/** A load that only settles when the test says so. */
function heldLoad(): {
  load: () => Promise<{lastDay: string}>;
  settle: () => Promise<void>;
} {
  let release: (() => void) | null = null;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    load: async () => {
      await gate;
      return {lastDay: BOOKMARK};
    },
    settle: async () => {
      release?.();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

function dayShown(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root.findByProps({testID: 'day'}).props.children;
}

function pressToday(tree: TestRenderer.ReactTestRenderer): void {
  act(() => {
    tree.root.findByProps({testID: 'today'}).props.onPress();
  });
}

test('a late restore does not undo Today', async () => {
  const {load, settle} = heldLoad();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Calendar load={load} />);
  });

  // The user has paged the calendar and pressed Today before the read lands.
  pressToday(tree);
  expect(dayShown(tree)).toBe(TODAY);

  await settle();
  expect(dayShown(tree)).toBe(TODAY);
});

test('without the guard, the late restore is exactly what moved the day', async () => {
  const {load, settle} = heldLoad();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Calendar load={load} unguarded />);
  });

  pressToday(tree);
  await settle();
  // The bug as reported: Today appeared to do nothing.
  expect(dayShown(tree)).toBe(BOOKMARK);
});

test('the bookmark is still restored when nobody has touched the calendar', async () => {
  const {load, settle} = heldLoad();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Calendar load={load} />);
  });

  await settle();
  expect(dayShown(tree)).toBe(BOOKMARK);
});
