/**
 * Tappable month grid with per-day markers.
 *
 * Each day carries up to three filled discs — C for a calendar event, T for an
 * open task, N for a daily note. Letters, not colour, because the panel is
 * monochrome; a disc per kind rather than a count, because which kind of thing
 * a day holds is what you are reading the grid for, and a number says how many
 * at the cost of saying which.
 */

import React from 'react';
import {Pressable, Text, View} from 'react-native';

import type {DayMarks} from '../agenda';
import {MONTHS, WEEKDAYS, chunkWeeks, monthGrid, monthGridFilled, shiftMonth} from '../calendar';
import {weekNumber} from '../periodnote';
import {toDateInput} from '../ical';
import {styles} from './common';

function MonthViewImpl(props: {
  year: number;
  month: number;
  selected: string;
  marks: Record<string, DayMarks>;
  onSelect: (iso: string) => void;
  onMonth: (year: number, month: number) => void;
  /**
   * Which weeks already have a weekly note, keyed by the week's Sunday.
   * Undefined when weekly notes are switched off, which hides the gutter.
   */
  weekNotes?: Set<string>;
  /** Opens or creates the weekly note for the week whose number was tapped. */
  onWeekNote: (iso: string, exists: boolean) => void;
  /** Opens the date sheet, for jumping to a month further away than one step. */
  onPickMonth: () => void;
  /**
   * Open the day view for a day already selected.
   *
   * A second tap on the day you are already on, rather than a link under the
   * grid saying the same thing: the link cost a line of the panel on every
   * render to offer something the grid itself is the natural place to ask for.
   */
  onOpenDay: (iso: string) => void;
}): React.JSX.Element {
  const {
    year,
    month,
    selected,
    marks,
    onSelect,
    onMonth,
    weekNotes,
    onWeekNote,
    onPickMonth,
    onOpenDay,
  } = props;
  const today = toDateInput(new Date());
  // Two grids of the same month: the filled one is what gets drawn, the plain
  // one is what the week-number gutter keys off. The gutter's arithmetic is
  // unchanged on purpose — it decides which note a tap opens.
  const weeks = chunkWeeks(monthGridFilled(year, month));
  const plainWeeks = chunkWeeks(monthGrid(year, month));

  return (
    <View>
      <View style={styles.calendarNav}>
        <Pressable
          style={styles.nav}
          onPress={() => {
            const next = shiftMonth(year, month, -1);
            onMonth(next.year, next.month);
          }}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        {/*
          The title is a control, like the week view's: tapping it opens the
          same date sheet, which is the quickest way to a month that is not one
          step away.
        */}
        <Pressable onPress={onPickMonth} hitSlop={8}>
          <Text style={[styles.monthLabel, styles.tappableLabel]}>
            {MONTHS[month]} {year} ▾
          </Text>
        </Pressable>
        <Pressable
          style={styles.nav}
          onPress={() => {
            const next = shiftMonth(year, month, 1);
            onMonth(next.year, next.month);
          }}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.week}>
        {/* Gutter head, keeping the weekday letters over their own columns. */}
        <Text style={styles.monthWeekNumHead}>Wk</Text>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((row, i) => {
        const firstReal = plainWeeks[i]?.find(c => c.iso);
        const weekStart = firstReal?.iso ?? '';
        const hasWeekNote = !!weekStart && !!weekNotes?.has(weekStartOf(weekStart));
        return (
        <View key={i} style={styles.week}>
          {/*
            The week number, tappable: it opens that week's note, or offers to
            make one. A weekly note is otherwise only reachable by switching to
            the week view first, which is a lot of taps for something the month
            grid is already showing you the week of.
          */}
          <Pressable
            style={styles.monthWeekNum}
            disabled={!weekStart || !weekNotes}
            onPress={() => weekStart && onWeekNote(weekStart, hasWeekNote)}>
            <Text style={[styles.monthWeekNumText, hasWeekNote && styles.monthWeekNumHas]}>
              {weekStart ? weekNumber(weekStart) : ''}
            </Text>
          </Pressable>
          {row.map((cell, j) => {
            const mark = cell.outside ? undefined : marks[cell.iso];
            const isSelected = cell.iso === selected;
            return (
              <Pressable
                key={j}
                style={[styles.dayCell, cell.iso === today && styles.dayCellToday]}
                // Selecting, then opening. The second tap on a day already
                // selected is the one that opens it.
                onPress={() => (isSelected ? onOpenDay(cell.iso) : onSelect(cell.iso))}>
                <View style={isSelected && styles.dayNumPill}>
                  <Text
                    style={[
                      styles.dayNum,
                      cell.outside && styles.dayNumOutside,
                      isSelected && styles.dayNumPillText,
                    ]}>
                    {cell.day}
                  </Text>
                </View>
                {/*
                  Nothing is marked on the days either side of the month. They
                  are there so the grid squares off, not to be read — marking
                  them would pull the eye out of the month being looked at.
                */}
                <View style={styles.markDotRow}>
                  {mark?.hasEvent && <Dot letter="C" />}
                  {mark?.hasTask && <Dot letter="T" />}
                  {mark?.hasNote && <Dot letter="N" />}
                </View>
              </Pressable>
            );
          })}
        </View>
        );
      })}
    </View>
  );
}

function Dot(props: {letter: string}): React.JSX.Element {
  return (
    <View style={styles.markDot}>
      <Text style={styles.markDotText}>{props.letter}</Text>
    </View>
  );
}

/** The Sunday a day belongs to, matching how weekly notes are keyed. */
function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return toDateInput(d);
}

/**
 * Memoised. These grids are pure functions of their props, and on an e-ink panel
 * an avoidable re-render is an avoidable full-panel repaint — the calendar was
 * rebuilding every view on any state change anywhere in the app.
 */
export const MonthView = React.memo(MonthViewImpl);
