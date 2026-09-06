/**
 * Three months at once, for looking at a quarter.
 *
 * The point of this view is scale rather than detail: the grids are small
 * enough that three fit on one panel, so the shape of a quarter — where the
 * busy weeks are, which months have notes — is visible without paging. Tapping
 * any day drops into the month it belongs to, where there is room to read it.
 *
 * Markers here are a single bar rather than the month view's boxed letters. At
 * this size a letter is not readable, so the bar says only "something is on this
 * day" and the month view, one tap away, says what.
 */

import React from 'react';
import {Pressable, Text, View} from 'react-native';

import type {DayMarks} from '../agenda';
import {MONTHS, WEEKDAYS, chunkWeeks, monthGrid} from '../calendar';
import {toDateInput} from '../ical';
import {quarterMonths, quarterNumber, shiftQuarter} from '../periodnote';
import {styles} from './common';

/**
 * One month of the quarter, memoised on its own data.
 *
 * Same reasoning as the year view: three grids of 42 cells is 126 pressables,
 * and rebuilding all of them because the selection moved is an avoidable
 * full-panel repaint. `selected` and `today` arrive already narrowed to this
 * month, so moving the selection touches at most two of the three.
 */
const QuarterMonth = React.memo(function QuarterMonth(props: {
  year: number;
  month: number;
  marks: Record<string, DayMarks>;
  selected: string | null;
  today: string | null;
  onSelect: (iso: string) => void;
  onOpenMonth: (year: number, month: number) => void;
}): React.JSX.Element {
  const {year, month, marks, selected, today, onSelect, onOpenMonth} = props;
  const weeks = chunkWeeks(monthGrid(year, month));

  return (
    <View style={styles.quarterMonth}>
      <Pressable onPress={() => onOpenMonth(year, month)} hitSlop={6}>
        <Text style={styles.quarterMonthLabel}>{MONTHS[month]} ›</Text>
      </Pressable>

      <View style={styles.quarterWeek}>
        {WEEKDAYS.map((d, i) => (
          <Text key={`${d}-${i}`} style={styles.quarterWeekday}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.quarterWeek}>
          {week.map((cell, ci) => {
            const mark = cell.iso ? marks[cell.iso] : undefined;
            return (
              <Pressable
                key={ci}
                style={[
                  // An empty cell keeps the grid's shape but is not a day: it
                  // gets no border of its own, which is what made the padding
                  // days at each end of a month look picked out like today.
                  cell.iso ? styles.quarterCell : styles.quarterCellEmpty,
                  !!cell.iso && cell.iso === selected && styles.quarterCellSelected,
                  !!cell.iso && cell.iso === today && styles.quarterCellToday,
                ]}
                disabled={!cell.iso}
                onPress={() => cell.iso && onSelect(cell.iso)}>
                <Text
                  style={[
                    styles.quarterCellText,
                    cell.iso === selected && styles.quarterCellTextSelected,
                  ]}>
                  {cell.day ?? ''}
                </Text>
                {/*
                  One bar under the number. At this size there is no room for the
                  boxed letters the month view uses, so its presence means
                  "something is on this day" and the month view says what.
                */}
                {!!mark && (mark.hasEvent || mark.hasTask || mark.hasNote) && (
                  <View style={styles.quarterDot} />
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

function QuarterViewImpl(props: {
  /** Any day in the quarter being shown. */
  anchor: string;
  selected: string;
  marks: Record<string, DayMarks>;
  /** Whether this quarter already has a note, which changes the button. */
  hasNote: boolean;
  /** False when this kind of note is switched off in settings. */
  notesEnabled: boolean;
  onSelect: (iso: string) => void;
  /** Move by whole quarters. */
  onQuarter: (iso: string) => void;
  /** Open the month a day belongs to. */
  onOpenMonth: (year: number, month: number) => void;
  onQuarterNote: (iso: string, exists: boolean) => void;
}): React.JSX.Element {
  const {
    anchor,
    selected,
    marks,
    hasNote,
    notesEnabled,
    onSelect,
    onQuarter,
    onOpenMonth,
    onQuarterNote,
  } = props;
  const today = toDateInput(new Date());
  const months = quarterMonths(anchor);
  const year = months.length ? Number(months[0].slice(0, 4)) : new Date().getFullYear();

  return (
    <View>
      <View style={styles.calendarNav}>
        <Pressable style={styles.nav} onPress={() => onQuarter(shiftQuarter(anchor, -1))}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>
          Q{quarterNumber(anchor)} {year}
        </Text>
        <Pressable style={styles.nav} onPress={() => onQuarter(shiftQuarter(anchor, 1))}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      {notesEnabled && (
      <View style={styles.noteButtonRow}>
        <Pressable
          style={[styles.button, styles.buttonPrimary]}
          onPress={() => onQuarterNote(anchor, hasNote)}>
          <Text style={styles.buttonTextPrimary}>
            {hasNote ? 'Open quarter note' : 'Create quarter note'}
          </Text>
        </Pressable>
      </View>
      )}

      {months.map(first => {
        const monthIndex = Number(first.slice(5, 7)) - 1;
        const inMonth = (iso: string) =>
          Number(iso.slice(0, 4)) === year && Number(iso.slice(5, 7)) - 1 === monthIndex
            ? iso
            : null;
        return (
          <QuarterMonth
            key={first}
            year={year}
            month={monthIndex}
            marks={marks}
            selected={inMonth(selected)}
            today={inMonth(today)}
            onSelect={onSelect}
            onOpenMonth={onOpenMonth}
          />
        );
      })}
    </View>
  );
}

/**
 * Memoised. These grids are pure functions of their props, and on an e-ink panel
 * an avoidable re-render is an avoidable full-panel repaint — the calendar was
 * rebuilding every view on any state change anywhere in the app.
 */
export const QuarterView = React.memo(QuarterViewImpl);
