/**
 * A whole year at a glance: twelve month grids, three to a row.
 *
 * The coarsest of the calendar views, and the one where detail is least useful —
 * at this size a day cell is a few points across. So it carries only two things:
 * which days have something on them, and which months you can drop into. The
 * quarter, month and day views below it are where things are read.
 *
 * Each month heading is tappable and opens that month; the quarter headings
 * above each row open the quarter, so the year view is also the fastest way to
 * reach any part of it.
 */

import React from 'react';
import {Pressable, Text, View} from 'react-native';

import type {DayMarks} from '../agenda';
import {MONTHS, chunkWeeks, monthGrid} from '../calendar';
import {weekNumber} from '../periodnote';
import {toDateInput} from '../ical';
import {styles} from './common';

/**
 * One month's grid inside the year view, memoised on its own data.
 *
 * Extracted purely for speed. Twelve grids of 42 cells is over five hundred
 * pressables, and rebuilding all of them because the selected day moved is the
 * single most expensive thing this app can do to an e-ink panel. `selected` and
 * `today` arrive as the ISO day if it falls in THIS month and null otherwise, so
 * moving the selection re-renders at most the two months it moved between.
 */
const YearMonth = React.memo(function YearMonth(props: {
  year: number;
  month: number;
  marks: Record<string, DayMarks>;
  selected: string | null;
  today: string | null;
  onSelect: (iso: string) => void;
  onOpenMonth: (year: number, month: number) => void;
  onOpenWeek: (iso: string) => void;
}): React.JSX.Element {
  const {year, month, marks, selected, today, onSelect, onOpenMonth, onOpenWeek} = props;
  const weeks = chunkWeeks(monthGrid(year, month));

  return (
    <View style={styles.yearMonth}>
      <Pressable onPress={() => onOpenMonth(year, month)} hitSlop={4}>
        <Text style={styles.yearMonthLabel}>{MONTHS[month].slice(0, 3)}</Text>
      </Pressable>
      {weeks.map((week, wi) => {
        const firstReal = week.find(c => c.iso);
        return (
          <View key={wi} style={styles.yearWeek}>
            {/*
              The week number, tappable, opening the week view — which is where a
              weekly note is made. Anchored on the first real day in the row so a
              leading blank week belongs to the right week.
            */}
            <Pressable
              style={styles.yearWeekNum}
              disabled={!firstReal}
              onPress={() => firstReal?.iso && onOpenWeek(firstReal.iso)}>
              <Text style={styles.yearWeekNumText}>
                {firstReal?.iso ? weekNumber(firstReal.iso) : ''}
              </Text>
            </Pressable>
            {week.map((cell, ci) => {
              const mark = cell.iso ? marks[cell.iso] : undefined;
              const busy = !!mark && (mark.hasEvent || mark.hasTask || mark.hasNote);
              return (
                <Pressable
                  key={ci}
                  style={[
                    styles.yearCell,
                    !!cell.iso && cell.iso === selected && styles.yearCellSelected,
                    !!cell.iso && cell.iso === today && styles.yearCellToday,
                  ]}
                  disabled={!cell.iso}
                  onPress={() => cell.iso && onSelect(cell.iso)}>
                  {/*
                    Bold for a day with something on it. At this size there is no
                    room for a marker beside the number, so the number itself
                    carries it.
                  */}
                  <Text style={[styles.yearCellText, busy && styles.yearCellBusy]}>
                    {cell.day ?? ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
});

function YearViewImpl(props: {
  year: number;
  selected: string;
  marks: Record<string, DayMarks>;
  /** Whether this year already has a note, which changes the button. */
  hasNote: boolean;
  /** Opens the day view on the day tapped — the year view is for finding, not reading. */
  onSelect: (iso: string) => void;
  onYear: (year: number) => void;
  onOpenMonth: (year: number, month: number) => void;
  onOpenQuarter: (iso: string) => void;
  /** Opens the week view on the week whose number was tapped. */
  onOpenWeek: (iso: string) => void;
  onToday: () => void;
  onYearNote: (iso: string, exists: boolean) => void;
}): React.JSX.Element {
  const {
    year,
    selected,
    marks,
    hasNote,
    onSelect,
    onYear,
    onOpenMonth,
    onOpenQuarter,
    onOpenWeek,
    onToday,
    onYearNote,
  } = props;
  const today = toDateInput(new Date());
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <View>
      <View style={styles.calendarNav}>
        <Pressable style={styles.nav} onPress={() => onYear(year - 1)}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{year}</Text>
        <Pressable style={styles.nav} onPress={() => onYear(year + 1)}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      {/*
        Today is easy to lose in twelve grids, so it gets its own control rather
        than only a border on one cell somewhere in the middle of the page.
      */}
      <View style={styles.noteButtonRow}>
        <Pressable style={styles.button} onPress={onToday}>
          <Text style={styles.buttonText}>Go to today</Text>
        </Pressable>
      </View>

      <View style={styles.noteButtonRow}>
        <Pressable
          style={[styles.button, styles.buttonPrimary]}
          onPress={() => onYearNote(`${year}-01-01`, hasNote)}>
          <Text style={styles.buttonTextPrimary}>
            {hasNote ? 'Open year note' : 'Create year note'}
          </Text>
        </Pressable>
      </View>

      {[0, 1, 2, 3].map(quarter => (
        <View key={quarter}>
          <Pressable
            onPress={() => onOpenQuarter(`${year}-${pad(quarter * 3 + 1)}-01`)}
            hitSlop={6}>
            <Text style={styles.yearQuarterLabel}>{`Q${quarter + 1} ›`}</Text>
          </Pressable>
          <View style={styles.yearRow}>
            {[0, 1, 2].map(offset => {
              const month = quarter * 3 + offset;
              const inMonth = (iso: string) =>
                Number(iso.slice(0, 4)) === year && Number(iso.slice(5, 7)) - 1 === month
                  ? iso
                  : null;
              return (
                <YearMonth
                  key={month}
                  year={year}
                  month={month}
                  marks={marks}
                  selected={inMonth(selected)}
                  today={inMonth(today)}
                  onSelect={onSelect}
                  onOpenMonth={onOpenMonth}
                  onOpenWeek={onOpenWeek}
                />
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Memoised. These grids are pure functions of their props, and on an e-ink panel
 * an avoidable re-render is an avoidable full-panel repaint — the calendar was
 * rebuilding every view on any state change anywhere in the app.
 */
export const YearView = React.memo(YearViewImpl);
