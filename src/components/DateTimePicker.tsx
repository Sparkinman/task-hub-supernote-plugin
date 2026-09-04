/**
 * Tap-driven date and time picker.
 *
 * Deliberately not @react-native-community/datetimepicker: that is a native
 * module, which would flip the build onto the native path (NDK download, much
 * slower builds). Its animated spinners are also a poor fit for a panel that
 * takes ~300ms to redraw. Everything here is plain Views and Pressables, so it
 * renders as static high-contrast blocks.
 */

import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';

import {MONTHS, WEEKDAYS, chunkWeeks, monthGrid, shiftMonth} from '../calendar';
import {formatTime, type TimeFormat} from '../format';
import {toDateInput} from '../ical';

interface Props {
  /** Canonical 'YYYY-MM-DD', or '' for unset. */
  date: string;
  /** Canonical 24-hour 'HH:MM', or '' for unset. */
  time: string;
  timeFormat: TimeFormat;
  onChange: (date: string, time: string) => void;
}

function parseHM(time: string): {hours: number; minutes: number} {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  return match
    ? {hours: Number(match[1]), minutes: Number(match[2])}
    : {hours: 9, minutes: 0};
}

function toHM(hours: number, minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(((hours % 24) + 24) % 24)}:${pad(((minutes % 60) + 60) % 60)}`;
}

export function DateTimePicker(props: Props): React.JSX.Element {
  const {date, time, timeFormat, onChange} = props;

  const anchor = date ? new Date(`${date}T00:00:00`) : new Date();
  const [view, setView] = useState({year: anchor.getFullYear(), month: anchor.getMonth()});

  // Follow an externally-set date (a quick-pick) into its month.
  useEffect(() => {
    if (date) {
      const next = new Date(`${date}T00:00:00`);
      setView({year: next.getFullYear(), month: next.getMonth()});
    }
  }, [date]);

  const today = toDateInput(new Date());
  const weeks = chunkWeeks(monthGrid(view.year, view.month));

  const quick = (days: number | null) => {
    if (days === null) {
      onChange('', '');
      return;
    }
    const target = new Date();
    target.setDate(target.getDate() + days);
    onChange(toDateInput(target), time);
  };

  // Noon: a sane default for "some time that day" that is unambiguous in both
  // 12- and 24-hour display, unlike 00:00 which reads as "no time set".
  const DEFAULT_TIME = '12:00';

  const bumpTime = (deltaHours: number, deltaMinutes: number) => {
    // Setting a time only makes sense against a date; default to today.
    const base = time || DEFAULT_TIME;
    const {hours, minutes} = parseHM(base);
    onChange(date || today, toHM(hours + deltaHours, minutes + deltaMinutes));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.quickRow}>
        <Chip label="Today" onPress={() => quick(0)} />
        <Chip label="Tomorrow" onPress={() => quick(1)} />
        <Chip label="Next week" onPress={() => quick(7)} />
        <Chip label="Clear" onPress={() => quick(null)} />
      </View>

      <View style={styles.monthRow}>
        <Pressable
          style={styles.nav}
          onPress={() => setView(v => shiftMonth(v.year, v.month, -1))}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>
          {MONTHS[view.month]} {view.year}
        </Text>
        <Pressable
          style={styles.nav}
          onPress={() => setView(v => shiftMonth(v.year, v.month, 1))}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.week}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((row, i) => (
        <View key={i} style={styles.week}>
          {row.map((cell, j) => {
            if (!cell.iso) {
              return <View key={j} style={styles.cell} />;
            }
            const selected = cell.iso === date;
            const isToday = cell.iso === today;
            return (
              <Pressable
                key={j}
                style={[styles.cell, styles.cellOn, selected && styles.cellSelected]}
                onPress={() => onChange(cell.iso!, time)}>
                <Text
                  style={[
                    styles.cellText,
                    selected && styles.cellTextSelected,
                    isToday && !selected && styles.cellTextToday,
                  ]}>
                  {cell.day}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      {/*
        Four arrows around one large readout rather than a row of labelled
        buttons: hours and minutes each get an up/down pair, minutes step by 5.
        Typing into the readout covers any odd minute the steppers cannot reach,
        so a finer grain costs no extra chrome.

        The arrows are deliberately inverted — up decrements, down increments —
        so they read as scrolling a wheel of values past a window rather than
        nudging the number itself.
      */}
      <View style={styles.timeBlock}>
        <Text style={styles.timeLabel}>Time</Text>

        {time ? (
          <View style={styles.timeControls}>
            <View style={styles.spinner}>
              <Arrow label="▲" onPress={() => bumpTime(-1, 0)} />
              <Text style={styles.spinnerCaption}>hour</Text>
              <Arrow label="▼" onPress={() => bumpTime(1, 0)} />
            </View>

            <TextInput
              style={styles.timeInput}
              value={time}
              onChangeText={next => onChange(date || today, next)}
              placeholder="12:00"
              placeholderTextColor="#999"
              keyboardType="numbers-and-punctuation"
            />

            <View style={styles.spinner}>
              <Arrow label="▲" onPress={() => bumpTime(0, -5)} />
              <Text style={styles.spinnerCaption}>min</Text>
              <Arrow label="▼" onPress={() => bumpTime(0, 5)} />
            </View>

            <View style={styles.timeAside}>
              <Text style={styles.timePreview}>{formatTime(time, timeFormat)}</Text>
              <Pressable onPress={() => onChange(date, '')} hitSlop={8}>
                <Text style={styles.clearLink}>Remove time</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            style={styles.addTime}
            onPress={() => onChange(date || today, DEFAULT_TIME)}>
            <Text style={styles.addTimeText}>+ Add a time (starts at noon)</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Chip(props: {label: string; onPress: () => void}): React.JSX.Element {
  return (
    <Pressable style={styles.chip} onPress={props.onPress}>
      <Text style={styles.chipText}>{props.label}</Text>
    </Pressable>
  );
}

function Arrow(props: {label: string; onPress: () => void}): React.JSX.Element {
  return (
    <Pressable style={styles.arrow} onPress={props.onPress} hitSlop={6}>
      <Text style={styles.arrowText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {borderWidth: 1, borderColor: '#000', padding: 10, marginBottom: 12},
  quickRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10},
  chip: {borderWidth: 1, borderColor: '#000', paddingHorizontal: 12, paddingVertical: 7},
  chipText: {fontSize: 21, color: '#000'},
  monthRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  nav: {paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: '#000'},
  navText: {fontSize: 30, color: '#000', lineHeight: 33},
  monthLabel: {fontSize: 24, fontWeight: '700', color: '#000'},
  week: {flexDirection: 'row', marginTop: 4},
  weekday: {flex: 1, textAlign: 'center', fontSize: 18, color: '#555', paddingVertical: 4},
  // Tall cells: a finger on e-ink needs a bigger target than a mouse does.
  cell: {flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', margin: 1},
  cellOn: {borderWidth: 1, borderColor: '#999'},
  cellSelected: {backgroundColor: '#000', borderColor: '#000'},
  cellText: {fontSize: 22, color: '#000'},
  cellTextSelected: {color: '#fff', fontWeight: '700'},
  cellTextToday: {fontWeight: '700', textDecorationLine: 'underline'},
  timeBlock: {marginTop: 14, borderTopWidth: 1, borderTopColor: '#999', paddingTop: 10},
  timeLabel: {fontSize: 21, color: '#000', marginBottom: 6},
  timeControls: {flexDirection: 'row', alignItems: 'center', gap: 10},
  spinner: {alignItems: 'center'},
  spinnerCaption: {fontSize: 15, color: '#777', marginVertical: 1},
  arrow: {paddingHorizontal: 10, paddingVertical: 2},
  arrowText: {fontSize: 22, color: '#000', lineHeight: 26},
  timeInput: {
    borderWidth: 2,
    borderColor: '#000',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 36,
    fontWeight: '700',
    color: '#000',
    minWidth: 156,
    textAlign: 'center',
  },
  timeAside: {flex: 1},
  timePreview: {fontSize: 21, color: '#000', fontWeight: '700'},
  clearLink: {fontSize: 18, color: '#555', textDecorationLine: 'underline', marginTop: 3},
  addTime: {
    borderWidth: 1,
    borderColor: '#000',
    borderStyle: 'dashed',
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignSelf: 'flex-start',
  },
  addTimeText: {fontSize: 21, color: '#000'},
});
