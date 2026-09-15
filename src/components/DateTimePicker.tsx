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
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {MONTHS, WEEKDAYS, chunkWeeks, monthGrid, shiftMonth} from '../calendar';
import type {TimeFormat} from '../format';
import {R, fs, sp} from './common';
import {toDateInput} from '../ical';

interface Props {
  /**
   * Hides the month grid and the quick-pick chips, leaving only the time.
   *
   * For an event's end, which is always on the event's own day: offering a
   * second calendar there would invite somebody to set an end date the rest of
   * the form has no way to store.
   */
  hideCalendar?: boolean;
  /**
   * Hides the time entirely, leaving a date picker.
   *
   * For a Supernote to-do, which holds a date and no time at all. Offering the
   * control and discarding what it was set to is worse than not offering it:
   * the user believes they have set a reminder for 9am and nothing of the sort
   * has been stored.
   */
  dateOnly?: boolean;
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
  const {date, time, timeFormat, onChange, hideCalendar, dateOnly} = props;


  const anchor = date ? new Date(`${date}T00:00:00`) : new Date();
  const [view, setView] = useState({year: anchor.getFullYear(), month: anchor.getMonth()});

  /**
   * Whether the time controls are showing, separately from whether a time is
   * set. They are not the same thing: opening the row leaves the time blank for
   * the user to type, and a blank time has to keep the row on screen rather
   * than collapsing it back to the button that opened it.
   */
  const [timeOpen, setTimeOpen] = useState(false);
  /** Which value grid is expanded, if any. Only ever one at a time. */
  const [openPart, setOpenPart] = useState<'hour' | 'minute' | null>(null);
  /** What is in the box while it is being typed and does not yet parse. */
  // A time arriving from outside — editing an item that has one — opens the row.
  const showTime = timeOpen || !!time;

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

  /**
   * The time row: pick the hour, pick the minute, pick AM or PM.
   *
   * It used to be four arrows around a readout — a pair for hours and a pair
   * for minutes stepping by five — so setting 3:45 pm from the noon the
   * steppers began at was a dozen taps, and every one of them a full e-ink
   * repaint. Choosing the value directly is one tap to open and one to pick,
   * whatever the value is.
   *
   * The grids expand **in place** rather than floating over the form. That is
   * not a styling preference: an absolutely-positioned overlay inside a
   * ScrollView is positioned against the row that opened it, scrolls away with
   * the page, and has its out-of-bounds half refuse touches — which is exactly
   * how the template picker broke twice. Expanding inline has none of those
   * problems and matches `Choice`, which the rest of the forms already use.
   *
   * The typed field stays. A five-minute grid cannot reach 3:47, and losing
   * that would be a step backwards from the steppers it replaces.
   */
  const {hours: liveHours, minutes: liveMinutes} = parseHM(time || '12:00');
  const isPm = liveHours >= 12;

  /** Set the hour, keeping the minutes and the half of the day. */
  const pickHour = (hour24: number) => {
    setOpenPart(null);
    onChange(date || today, toHM(hour24, time ? liveMinutes : 0));
  };

  const pickMinute = (minute: number) => {
    setOpenPart(null);
    onChange(date || today, toHM(liveHours, minute));
  };

  /** 12 for midnight and noon, so the grid reads as a clock face does. */
  const hourLabel = (hour24: number): string => {
    if (timeFormat !== '12') {
      return String(hour24).padStart(2, '0');
    }
    const twelve = hour24 % 12;
    return String(twelve === 0 ? 12 : twelve);
  };

  // In 12-hour mode the grid offers the twelve clock positions and AM/PM says
  // which half; in 24-hour mode it offers all twenty-four and there is no
  // second control to reconcile it with.
  const hourChoices =
    timeFormat === '12'
      ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => {
          const base = h === 12 ? 0 : h;
          return {value: isPm ? base + 12 : base, label: String(h)};
        })
      : Array.from({length: 24}, (_, h) => ({value: h, label: hourLabel(h)}));

  const minuteChoices = Array.from({length: 12}, (_, i) => ({
    value: i * 5,
    label: String(i * 5).padStart(2, '0'),
  }));

  const timeControls = (
    <>
      {dateOnly ? null : showTime ? (
        <View style={styles.timeBlockInner}>
          <View style={styles.timePickRow}>
            <Pressable
              style={[styles.timePart, openPart === 'hour' && styles.timePartOpen]}
              onPress={() => setOpenPart(openPart === 'hour' ? null : 'hour')}>
              <Text style={styles.timePartValue}>
                {time ? hourLabel(liveHours) : '--'}
              </Text>
              <Text style={styles.timePartCaption}>hour ▾</Text>
            </Pressable>

            <Text style={styles.timeColon}>:</Text>

            <Pressable
              style={[styles.timePart, openPart === 'minute' && styles.timePartOpen]}
              onPress={() => setOpenPart(openPart === 'minute' ? null : 'minute')}>
              <Text style={styles.timePartValue}>
                {time ? String(liveMinutes).padStart(2, '0') : '--'}
              </Text>
              <Text style={styles.timePartCaption}>min ▾</Text>
            </Pressable>

            {/*
              Two chips rather than a two-item sheet: a menu that opens to show
              one alternative is a tap spent on nothing.
            */}
            {timeFormat === '12' && (
              <View style={styles.meridiemPair}>
                {(['AM', 'PM'] as const).map(half => {
                  const on = (half === 'PM') === isPm && !!time;
                  return (
                    <Pressable
                      key={half}
                      style={[styles.meridiem, on && styles.meridiemOn]}
                      onPress={() => {
                        const base = liveHours % 12;
                        onChange(
                          date || today,
                          toHM(half === 'PM' ? base + 12 : base, liveMinutes),
                        );
                      }}>
                      <Text style={[styles.meridiemText, on && styles.meridiemTextOn]}>
                        {half}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Pressable
              onPress={() => {
                setTimeOpen(false);
                setOpenPart(null);
                onChange(date, '');
              }}
              hitSlop={8}>
              <Text style={styles.clearLink}>Remove time</Text>
            </Pressable>
          </View>

          {openPart === 'hour' && (
            <View style={styles.timeGrid}>
              {hourChoices.map(choice => {
                const on = !!time && choice.value === liveHours;
                return (
                  <Pressable
                    key={choice.value}
                    style={[styles.timeCell, on && styles.timeCellOn]}
                    onPress={() => pickHour(choice.value)}>
                    <Text style={[styles.timeCellText, on && styles.timeCellTextOn]}>
                      {choice.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {openPart === 'minute' && (
            <View style={styles.timeGrid}>
              {minuteChoices.map(choice => {
                const on = !!time && choice.value === liveMinutes;
                return (
                  <Pressable
                    key={choice.value}
                    style={[styles.timeCell, on && styles.timeCellOn]}
                    onPress={() => pickMinute(choice.value)}>
                    <Text style={[styles.timeCellText, on && styles.timeCellTextOn]}>
                      {choice.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

        </View>
      ) : (
        <Pressable
          style={styles.addTime}
          onPress={() => {
            setTimeOpen(true);
            // Opens the row without choosing a time. Only the date is passed
            // through, so nothing is set until the user picks or types.
            onChange(date || today, '');
          }}>
          <Text style={styles.addTimeText}>+ Add a time</Text>
        </Pressable>
      )}
    </>
  );

  if (hideCalendar) {
    // Time only: the same controls, without the month grid or the quick picks.
    return (
      <View style={styles.wrap}>
        <View style={styles.timeBlock}>{timeControls}</View>
      </View>
    );
  }

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

      <View style={styles.timeBlock}>
        <Text style={styles.timeLabel}>Time</Text>
        {timeControls}
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


const styles = StyleSheet.create({
  wrap: {borderRadius: R.lg, borderWidth: 1, borderColor: '#ccc', padding: sp(12), marginBottom: sp(12)},
  quickRow: {flexDirection: 'row', flexWrap: 'wrap', gap: sp(8), marginBottom: sp(10)},
  chip: {borderRadius: R.pill, borderWidth: 1, borderColor: '#000', paddingHorizontal: sp(14), paddingVertical: sp(7)},
  chipText: {fontSize: fs(21), color: '#000'},
  monthRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  nav: {borderRadius: R.md, paddingHorizontal: sp(16), paddingVertical: sp(6), borderWidth: 1, borderColor: '#000'},
  navText: {fontSize: fs(30), color: '#000', lineHeight: fs(33)},
  monthLabel: {fontSize: fs(24), fontWeight: '700', color: '#000'},
  week: {flexDirection: 'row', marginTop: sp(4)},
  weekday: {flex: 1, textAlign: 'center', fontSize: fs(18), color: '#555', paddingVertical: sp(4)},
  // Tall cells: a finger on e-ink needs a bigger target than a mouse does.
  cell: {flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', margin: sp(1)},
  cellOn: {borderRadius: R.sm, borderWidth: 1, borderColor: '#ddd'},
  cellSelected: {borderRadius: R.sm, backgroundColor: '#000', borderColor: '#000'},
  cellText: {fontSize: fs(22), color: '#000'},
  cellTextSelected: {color: '#fff', fontWeight: '700'},
  cellTextToday: {fontWeight: '700', textDecorationLine: 'underline'},
  timeBlock: {marginTop: sp(14), borderTopWidth: 1, borderTopColor: '#ddd', paddingTop: sp(10)},
  timeLabel: {fontSize: fs(21), color: '#000', marginBottom: sp(6)},
  // Round, and big enough to hit without aiming: these are the controls most
  // used in the picker and they were the smallest things in it.
  timeInput: {
    borderRadius: R.md,
    borderWidth: 2,
    borderColor: '#000',
    paddingHorizontal: sp(12),
    paddingVertical: sp(8),
    fontSize: fs(36),
    fontWeight: '700',
    color: '#000',
    minWidth: 156,
    textAlign: 'center',
  },
  clearLink: {fontSize: fs(18), color: '#555', textDecorationLine: 'underline', marginTop: sp(3)},
  addTime: {
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: '#000',
    borderStyle: 'dashed',
    paddingHorizontal: sp(14),
    paddingVertical: sp(11),
    alignSelf: 'flex-start',
  },
  timeBlockInner: {gap: sp(8)},
  timePickRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp(8)},
  /**
   * One part of the time, big enough to hit with a pen.
   *
   * The value is set large and the caption small beneath it: the row is read
   * as a clock, and the word "hour" is only there to say what opens when it is
   * pressed.
   */
  timePart: {
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(16),
    paddingVertical: sp(6),
    alignItems: 'center',
    minWidth: sp(64),
  },
  /** Thickened, not filled: the grid below is already the strong signal. */
  timePartOpen: {borderWidth: 3},
  timePartValue: {fontSize: fs(30), fontWeight: '700', color: '#000'},
  timePartCaption: {fontSize: fs(14), color: '#555'},
  timeColon: {fontSize: fs(30), fontWeight: '700', color: '#000'},
  meridiemPair: {flexDirection: 'row', gap: sp(6)},
  meridiem: {
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(14),
    paddingVertical: sp(12),
  },
  meridiemOn: {backgroundColor: '#000'},
  meridiemText: {fontSize: fs(20), color: '#000'},
  meridiemTextOn: {color: '#fff'},
  /**
   * The expanded values, wrapped rather than scrolled.
   *
   * Twenty-four hour cells is the widest this gets, and wrapping lets the same
   * grid serve both clock formats and both panel sizes without a measured
   * column count.
   */
  timeGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: sp(6), paddingVertical: sp(4)},
  timeCell: {
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(14),
    paddingVertical: sp(10),
    minWidth: sp(52),
    alignItems: 'center',
  },
  timeCellOn: {backgroundColor: '#000'},
  timeCellText: {fontSize: fs(22), color: '#000'},
  timeCellTextOn: {color: '#fff'},
  timeTypeRow: {flexDirection: 'row', alignItems: 'center', gap: sp(8)},
  timeTypeLabel: {fontSize: fs(16), color: '#555'},
  addTimeText: {fontSize: fs(21), color: '#000'},
});
