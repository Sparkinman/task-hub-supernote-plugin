/**
 * Modal month grid for jumping to a date.
 *
 * Two modes, and each stays in its own unit. `day` picks a single date. `week`
 * shows ISO week numbers down the left and treats EVERY tap — a day cell, a
 * week number, or Today — as "move the week view there", so the sheet never
 * silently switches the caller to a different view.
 */

import React, {useState} from 'react';
import {Modal, Pressable, Text, View} from 'react-native';

import {MONTHS, WEEKDAYS, chunkWeeks, monthGrid, shiftMonth} from '../calendar';
import {toDateInput} from '../ical';
import {Button, styles} from './common';

/**
 * ISO-8601 week number.
 *
 * Thursday decides the year: a week belongs to whichever year holds its
 * Thursday, which is why the date is nudged there before counting.
 */
export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay() is 0 for Sunday; ISO treats Sunday as day 7.
  const dayNum = target.getDay() === 0 ? 7 : target.getDay();
  target.setDate(target.getDate() + 4 - dayNum);
  const yearStart = new Date(target.getFullYear(), 0, 1);
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * ISO week number for a displayed grid row.
 *
 * The grid is Sunday-first but ISO weeks start on Monday, so a row's leading
 * Sunday belongs to the PREVIOUS ISO week — taking the number from the row's
 * first cell made a partial top row repeat the next row's number. The row's
 * Thursday is always inside the week the row represents, so it is used instead.
 */
export function rowWeekNumber(year: number, month: number, rowIndex: number): number {
  const leading = new Date(year, month, 1).getDay();
  // Sunday-first row start, then +4 days to reach Thursday.
  const thursday = new Date(year, month, 1 - leading + rowIndex * 7 + 4);
  const pad = (n: number) => String(n).padStart(2, '0');
  return isoWeek(
    `${thursday.getFullYear()}-${pad(thursday.getMonth() + 1)}-${pad(thursday.getDate())}`,
  );
}

/** First day (Sunday) of a displayed grid row, as an ISO date. */
export function rowStartDate(year: number, month: number, rowIndex: number): string {
  const leading = new Date(year, month, 1).getDay();
  const d = new Date(year, month, 1 - leading + rowIndex * 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function MiniCalendar(props: {
  visible: boolean;
  /** Date the grid opens on. */
  anchor: string;
  mode: 'day' | 'week';
  onCancel: () => void;
  onPickDay: (iso: string) => void;
  onPickWeek?: (iso: string) => void;
}): React.JSX.Element {
  const {visible, anchor, mode, onCancel, onPickDay, onPickWeek} = props;
  const start = new Date(`${anchor}T00:00:00`);
  const [view, setView] = useState({year: start.getFullYear(), month: start.getMonth()});

  // Re-anchor whenever the sheet is reopened from a different date.
  const [lastAnchor, setLastAnchor] = useState(anchor);
  if (visible && anchor !== lastAnchor) {
    setLastAnchor(anchor);
    setView({year: start.getFullYear(), month: start.getMonth()});
  }

  const today = toDateInput(new Date());
  const weeks = chunkWeeks(monthGrid(view.year, view.month));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.pickerCard}>
          <View style={styles.calendarNav}>
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
            {mode === 'week' && <Text style={styles.weekNumHead}>wk</Text>}
            {WEEKDAYS.map((d, i) => (
              <Text key={i} style={styles.weekday}>
                {d}
              </Text>
            ))}
          </View>

          {weeks.map((row, i) => {
            // Derived from the row itself, not its first non-padding cell —
            // see rowWeekNumber for why that distinction matters.
            const weekNo = rowWeekNumber(view.year, view.month, i);
            const rowStart = rowStartDate(view.year, view.month, i);
            return (
              <View key={i} style={styles.week}>
                {mode === 'week' && (
                  <Pressable
                    style={styles.weekNumCell}
                    onPress={() => onPickWeek?.(rowStart)}>
                    <Text style={styles.weekNumText}>{weekNo}</Text>
                  </Pressable>
                )}
                {row.map((cell, j) => {
                  if (!cell.iso) {
                    return <View key={j} style={styles.miniCell} />;
                  }
                  const selected = cell.iso === anchor;
                  return (
                    <Pressable
                      key={j}
                      style={[styles.miniCell, styles.miniCellOn, selected && styles.miniCellSel]}
                      onPress={() =>
                        mode === 'week' ? onPickWeek?.(cell.iso!) : onPickDay(cell.iso!)
                      }>
                      <Text
                        style={[
                          styles.miniCellText,
                          selected && styles.miniCellTextSel,
                          cell.iso === today && !selected && styles.dayNumToday,
                        ]}>
                        {cell.day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}

          <View style={styles.modalActions}>
            <Button
              label="Today"
              primary
              onPress={() => (mode === 'week' ? onPickWeek?.(today) : onPickDay(today))}
            />
            <Button label="Cancel" onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
