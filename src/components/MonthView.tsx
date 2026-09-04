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
import {toDateInput} from '../ical';
import {styles} from './common';

export function MonthView(props: {
  year: number;
  month: number;
  selected: string;
  marks: Record<string, DayMarks>;
  onSelect: (iso: string) => void;
  onMonth: (year: number, month: number) => void;
}): React.JSX.Element {
  const {year, month, selected, marks, onSelect, onMonth} = props;
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
      ))}
    </View>
  );
}
