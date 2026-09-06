/**
 * Tappable month grid with per-day markers.
 *
 * A day can carry both a calendar event and a due task, so the markers are two
 * small boxed letters (C and T) that sit side by side inside the cell rather
 * than a single dot that would have to pick one. Letters, not colour — the
 * panel is monochrome.
 */

import React from 'react';
import {Pressable, Text, View} from 'react-native';

import type {DayMarks} from '../agenda';
import {MONTHS, WEEKDAYS, chunkWeeks, monthGrid, shiftMonth} from '../calendar';
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
  /** Which weeks already have a weekly note, keyed by the week's Sunday. */
  weekNotes: Set<string>;
  /** Opens or creates the weekly note for the week whose number was tapped. */
  onWeekNote: (iso: string, exists: boolean) => void;
}): React.JSX.Element {
  const {year, month, selected, marks, onSelect, onMonth, weekNotes, onWeekNote} = props;
  const today = toDateInput(new Date());
  const weeks = chunkWeeks(monthGrid(year, month));

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
        <Text style={styles.monthLabel}>
          {MONTHS[month]} {year}
        </Text>
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
        const firstReal = row.find(c => c.iso);
        const weekStart = firstReal?.iso ?? '';
        const hasWeekNote = !!weekStart && weekNotes.has(weekStartOf(weekStart));
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
            disabled={!weekStart}
            onPress={() => weekStart && onWeekNote(weekStart, hasWeekNote)}>
            <Text style={[styles.monthWeekNumText, hasWeekNote && styles.monthWeekNumHas]}>
              {weekStart ? weekNumber(weekStart) : ''}
            </Text>
          </Pressable>
          {row.map((cell, j) => {
            if (!cell.iso) {
              return <View key={j} style={styles.dayCell} />;
            }
            const mark = marks[cell.iso];
            const isSelected = cell.iso === selected;
            return (
              <Pressable
                key={j}
                style={[styles.dayCell, isSelected && styles.dayCellSelected]}
                onPress={() => onSelect(cell.iso!)}>
                <Text
                  style={[styles.dayNum, cell.iso === today && styles.dayNumToday]}>
                  {cell.day}
                </Text>
                <View style={styles.markRow}>
                  {mark?.hasEvent && <Text style={styles.mark}>C</Text>}
                  {mark?.hasTask && <Text style={styles.mark}>T</Text>}
                  {mark?.hasNote && <Text style={styles.mark}>N</Text>}
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
