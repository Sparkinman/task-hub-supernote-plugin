import React, {useRef} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  findNodeHandle,
} from 'react-native';

import {formatDue, type DateFormat, type TimeFormat} from '../format';
import type {VTodo} from '../ical';
import {originIsNamed, originLabel} from '../origin';
import {FullLogo, Logo} from './Brand';

export type Status =
  | {kind: 'working'; message: string}
  | {kind: 'done'; message: string}
  | {kind: 'error'; message: string}
  | null;

/**
 * Branded screen header: mark top-left, product name, screen title, and a close
 * affordance in the top-right corner that returns to the underlying note.
 *
 * Pass `masthead` on the settings screen to show the full lock-up (mark plus
 * wordmark) instead of the compact mark — there is room for it there, and it is
 * the screen a new user meets first.
 */
export function Header(props: {
  title: string;
  onClose: () => void;
  masthead?: boolean;
}): React.JSX.Element {
  if (props.masthead) {
    return (
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <FullLogo />
          <Text style={styles.mastheadTitle}>{props.title}</Text>
        </View>
        <Pressable style={styles.close} onPress={props.onClose} hitSlop={10}>
          <Text style={styles.closeText}>{'Done & Exit'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {/*
          Sized to the title beside it rather than to a fixed 30px. A mark
          noticeably smaller than the word next to it reads as an afterthought.
        */}
        <Logo size={40} />
        <View style={styles.grow}>
          {/*
            No product name above the title. The hub's title IS "Task Hub", so a
            brand line here printed the same words twice; on the other screens
            the mark already carries the branding.
          */}
          <Text style={styles.heading}>{props.title}</Text>
        </View>
      </View>
      <Pressable style={styles.close} onPress={props.onClose} hitSlop={10}>
        <Text style={styles.closeText}>{'Done & Exit'}</Text>
      </Pressable>
    </View>
  );
}

/**
 * Blocking yes/no confirmation.
 *
 * Uses core RN Modal rather than Alert: Alert's styling is not controllable, and
 * on a monochrome panel its default chrome is low-contrast. This also gives the
 * question room to name the task being acted on.
 */
export function Confirm(props: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <Modal visible={props.visible} transparent animationType="none" onRequestClose={props.onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{props.title}</Text>
          {!!props.body && <Text style={styles.modalBody}>{props.body}</Text>}
          <View style={styles.modalActions}>
            <Button label={props.confirmLabel ?? 'Yes'} primary onPress={props.onConfirm} />
            <Button label="No" onPress={props.onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * One-way message with a single dismiss.
 *
 * Separate from Confirm rather than a variant of it: a Yes/No pair on a message
 * that decides nothing invites the user to look for the difference between the
 * two buttons.
 */
export function Notice(props: {
  visible: boolean;
  title: string;
  body?: string;
  label?: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <Modal visible={props.visible} transparent animationType="none" onRequestClose={props.onDismiss}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{props.title}</Text>
          {!!props.body && <Text style={styles.modalBody}>{props.body}</Text>}
          <View style={styles.modalActions}>
            <Button label={props.label ?? 'OK'} primary onPress={props.onDismiss} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function Tabs(props: {
  tabs: {key: string; label: string}[];
  value: string;
  onPick: (key: string) => void;
}): React.JSX.Element {
  return (
    <View style={styles.tabRow}>
      {props.tabs.map(t => {
        const on = t.key === props.value;
        return (
          <Pressable
            key={t.key}
            style={[styles.tab, on && styles.tabOn]}
            onPress={() => props.onPick(t.key)}>
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Multi-select row. Used for both collection pickers and save targets. */
export function CheckRow(props: {
  label: string;
  checked: boolean;
  hint?: string;
  compact?: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={props.compact ? styles.checkRowCompact : styles.checkRow}
      onPress={props.onToggle}>
      <Text style={props.compact ? styles.optionTextCompact : styles.optionText}>
        {props.checked ? '☑' : '☐'} {props.label}
        {props.hint ? `  ·  ${props.hint}` : ''}
      </Text>
    </Pressable>
  );
}

export function Section(props: {
  title: string;
  open: boolean;
  count: number;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Pressable style={styles.sectionHead} onPress={props.onToggle}>
        <Text style={styles.sectionTitle}>
          {props.open ? '▾' : '▸'} {props.title} ({props.count})
        </Text>
      </Pressable>
      {props.open && props.children}
    </View>
  );
}

export function TaskRow(props: {
  task: VTodo;
  busy?: boolean;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  /** Originating collection, always shown so a task's home is never ambiguous. */
  listLabel?: string;
  /** Render an explicit "No due date" rather than an empty gap. */
  showNoDue?: boolean;
  onToggle?: () => void;
  onEdit?: () => void;
  /** Offered only when the task records the note it was captured from. */
  onOpenSource?: () => void;
}): React.JSX.Element {
  const {task, busy, dateFormat, timeFormat, listLabel, showNoDue, onToggle, onEdit, onOpenSource} =
    props;
  const overdue = !task.completed && task.dueAt !== null && task.dueAt < Date.now();
  const due = formatDue(task.dueDate, task.dueTime, dateFormat, timeFormat);

  return (
    <View style={styles.task}>
      <Pressable
        onPress={onToggle}
        disabled={!onToggle || task.completed || busy}
        hitSlop={6}
        style={styles.boxHit}>
        <Text style={styles.box}>{task.completed ? '☑' : '☐'}</Text>
      </Pressable>
      <Pressable style={styles.grow} onPress={onEdit} disabled={!onEdit}>
        <Text style={[styles.taskTitle, task.completed && styles.struck]}>{task.summary}</Text>
        <View style={styles.metaRow}>
          {due ? (
            <Text style={[styles.due, overdue && styles.overdue]}>Due {due}</Text>
          ) : (
            showNoDue && <Text style={styles.noDue}>No due date</Text>
          )}
          {!!listLabel && <Text style={styles.listTag}>{listLabel}</Text>}
          {/*
            Task Hub distinguishes origins by colour; a 1-bit panel cannot, so a
            named service gets a filled badge and the generic third-party ones an
            outline. The label still carries the meaning.
          */}
          <Text style={[styles.originTag, originIsNamed(task.origin) && styles.originTagNamed]}>
            {originLabel(task.origin)}
          </Text>
        </View>
        {!!task.description && (
          <Text style={styles.description} numberOfLines={2}>
            {task.description}
          </Text>
        )}
      </Pressable>
      {!!task.sourcePath && !!onOpenSource && (
        <Pressable style={styles.sourceChip} onPress={onOpenSource} hitSlop={6}>
          <Text style={styles.sourceChipText}>↩</Text>
          <Text style={styles.sourceChipLabel}>page</Text>
        </Pressable>
      )}
      {busy && <ActivityIndicator color="#000" />}
    </View>
  );
}

/**
 * Loading indicator for background reloads.
 *
 * Kept separate from Status rather than reusing the 'working' kind: a refresh
 * runs straight after a save, and routing it through the same state would wipe
 * the "Saved successfully" message the user just earned.
 */
export function LoadingLine(props: {visible: boolean}): React.JSX.Element | null {
  if (!props.visible) {
    return null;
  }
  return (
    <View style={styles.statusRow}>
      <ActivityIndicator color="#000" />
      <Text style={styles.status}>Loading…</Text>
    </View>
  );
}

export function StatusLine(props: {status: Status}): React.JSX.Element | null {
  const {status} = props;
  if (!status) {
    return null;
  }
  if (status.kind === 'working') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator color="#000" />
        <Text style={styles.status}>{status.message}</Text>
      </View>
    );
  }
  return (
    <Text style={[styles.status, status.kind === 'error' && styles.error]}>{status.message}</Text>
  );
}

export function Field(props: {
  label: string;
  value: string;
  placeholder?: string;
  secure?: boolean;
  multiline?: boolean;
  /** Denser type and margins, for screens that would otherwise need scrolling. */
  compact?: boolean;
  /** Node handle of the enclosing ScrollView, for keyboard-aware scrolling. */
  scrollHandle?: number | null;
  onScrollTo?: (y: number) => void;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const inputRef = useRef<TextInput>(null);

  // On focus, measure this input relative to the ScrollView and ask the parent
  // to bring it near the top, where the keyboard cannot cover it.
  const handleFocus = () => {
    const {scrollHandle, onScrollTo} = props;
    if (!scrollHandle || !onScrollTo) {
      return;
    }
    inputRef.current?.measureLayout(
      scrollHandle,
      (_x, y) => onScrollTo(y),
      () => undefined,
    );
  };

  return (
    <View style={props.compact ? styles.fieldCompact : styles.field}>
      <Text style={props.compact ? styles.labelCompact : styles.label}>{props.label}</Text>
      <TextInput
        ref={inputRef}
        onFocus={handleFocus}
        style={[
          styles.input,
          props.compact && styles.inputCompact,
          props.multiline && (props.compact ? styles.inputTallCompact : styles.inputTall),
        ]}
        value={props.value}
        placeholder={props.placeholder}
        placeholderTextColor="#999"
        secureTextEntry={props.secure}
        multiline={props.multiline}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={props.onChange}
      />
    </View>
  );
}

export function Button(props: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      style={[styles.button, props.primary && styles.buttonPrimary]}
      onPress={props.onPress}>
      <Text style={[styles.buttonText, props.primary && styles.buttonTextPrimary]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export function Choice(props: {
  options: {key: string; label: string}[];
  value: string;
  onPick: (key: string) => void;
}): React.JSX.Element {
  return (
    <View style={styles.choiceRow}>
      {props.options.map(o => {
        const on = o.key === props.value;
        return (
          <Pressable
            key={o.key}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => props.onPick(o.key)}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// High-contrast, flat styling — e-ink has no colour and slow refresh, so avoid
// gradients, shadows and animation. Selection is shown by fill inversion, which
// survives a monochrome panel; colour alone would not.
export const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#fff'},
  content: {padding: 14, paddingBottom: 40},
  // Extra tail room so the last field can still scroll clear of the keyboard.
  contentKeyboard: {paddingBottom: 420},
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderBottomWidth: 2,
    borderBottomColor: '#000',
    paddingBottom: 8,
    marginBottom: 10,
  },
  headerLeft: {flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1},
  mastheadTitle: {fontSize: 27, fontWeight: '700', color: '#000', alignSelf: 'flex-end', marginBottom: 4},
  heading: {fontSize: 30, fontWeight: '700', color: '#000'},
  close: {borderWidth: 1, borderColor: '#000', paddingHorizontal: 12, paddingVertical: 5},
  closeText: {fontSize: 24, color: '#000', lineHeight: 30},
  field: {marginBottom: 12},
  label: {fontSize: 21, color: '#000', marginBottom: 4},
  input: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 22,
    color: '#000',
  },
  inputTall: {minHeight: 96, textAlignVertical: 'top'},
  fieldCompact: {marginBottom: 7},
  labelCompact: {fontSize: 17, color: '#000', marginBottom: 2},
  inputCompact: {paddingHorizontal: 8, paddingVertical: 5, fontSize: 18},
  inputTallCompact: {minHeight: 58, textAlignVertical: 'top'},
  subheadingCompact: {fontSize: 18, fontWeight: '700', color: '#000', marginTop: 10, marginBottom: 3},
  helpStepCompact: {fontSize: 15, color: '#333', lineHeight: 21, marginBottom: 6},
  noteCompact: {fontSize: 14, color: '#555', marginBottom: 6},
  /**
   * Demo-build banner. Inverted rather than tinted: a grey wash is close to
   * invisible on e-ink, and this label has to be unmissable.
   */
  demoBanner: {
    backgroundColor: '#000',
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  demoBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  checkRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 5,
  },
  optionTextCompact: {fontSize: 18, color: '#000'},
  actionsTight: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8},
  grow: {flex: 1},
  choiceRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12},
  chip: {borderWidth: 1, borderColor: '#000', paddingHorizontal: 12, paddingVertical: 7},
  chipOn: {backgroundColor: '#000'},
  chipText: {fontSize: 21, color: '#000'},
  chipTextOn: {color: '#fff'},
  option: {borderWidth: 1, borderColor: '#000', padding: 10, marginBottom: 8},
  optionOn: {borderWidth: 2},
  optionText: {fontSize: 22, color: '#000'},
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
  },
  tinyButton: {borderWidth: 1, borderColor: '#000', paddingHorizontal: 10, paddingVertical: 4},
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', padding: 18, width: '100%', maxWidth: 460},
  modalTitle: {fontSize: 26, fontWeight: '700', color: '#000', marginBottom: 8},
  modalBody: {fontSize: 21, color: '#333', lineHeight: 28, marginBottom: 6},
  modalActions: {flexDirection: 'row', gap: 10, marginTop: 14},
  tabRow: {flexDirection: 'row', gap: 0, marginBottom: 8},
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#000',
    paddingVertical: 11,
    alignItems: 'center',
  },
  tabOn: {backgroundColor: '#000'},
  tabText: {fontSize: 22, fontWeight: '700', color: '#000'},
  tabTextOn: {color: '#fff'},
  monthRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  // Breathing room between the action row and the ‹ › month/week/day stepper,
  // which otherwise reads as part of the same button cluster.
  calendarNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
  },
  dayHeading: {
    flex: 1,
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
  nav: {paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: '#000'},
  navText: {fontSize: 30, color: '#000', lineHeight: 33},
  monthLabel: {fontSize: 24, fontWeight: '700', color: '#000'},
  tappableLabel: {textDecorationLine: 'underline'},
  week: {flexDirection: 'row', marginTop: 4},
  weekday: {flex: 1, textAlign: 'center', fontSize: 18, color: '#555', paddingVertical: 4},
  noteButtonRow: {alignItems: 'center', marginTop: 10, marginBottom: 4},
  browseRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  miniCell: {flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', margin: 1},
  miniCellOn: {borderWidth: 1, borderColor: '#999'},
  miniCellSel: {backgroundColor: '#000', borderColor: '#000'},
  miniCellText: {fontSize: 20, color: '#000'},
  miniCellTextSel: {color: '#fff', fontWeight: '700'},
  weekNumHead: {width: 46, textAlign: 'center', fontSize: 14, color: '#555', paddingVertical: 4},
  weekNumCell: {
    width: 46,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 1,
    borderWidth: 1,
    borderColor: '#000',
  },
  weekNumText: {fontSize: 16, fontWeight: '700', color: '#000'},
  eventRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 6},
  noteChip: {borderWidth: 1, borderColor: '#000', paddingHorizontal: 8, paddingVertical: 3},
  noteChipText: {fontSize: 18, color: '#000', lineHeight: 22},
  templateSummary: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  templateSummaryText: {fontSize: 18, color: '#000'},
  templateSummaryHint: {fontSize: 13, color: '#666', marginTop: 2},
  templateScroll: {maxHeight: 420},
  templateGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12},
  templateTile: {borderWidth: 1, borderColor: '#999', padding: 4, width: 116},
  templateTileOn: {borderWidth: 3, borderColor: '#000'},
  // 3:4 portrait, matching a note page so the ruling reads correctly.
  templateThumb: {width: 106, height: 141, backgroundColor: '#fff'},
  templateBlank: {
    width: 106,
    height: 141,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateBlankText: {fontSize: 16, color: '#777'},
  templateName: {fontSize: 14, color: '#000', marginTop: 3, textAlign: 'center'},
  browseButton: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    marginTop: 24,
  },
  browseIcon: {fontSize: 22, color: '#000', lineHeight: 24},
  browseLabel: {fontSize: 14, color: '#000'},
  pastText: {color: '#9a9a9a'},
  nowRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  nowLabel: {fontSize: 14, fontWeight: '700', color: '#000'},
  nowLine: {flex: 1, height: 3, backgroundColor: '#000'},
  pickerCard: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#000',
    padding: 16,
    width: '100%',
    maxWidth: 620,
    maxHeight: '85%',
  },
  pickerPath: {fontSize: 17, color: '#333', marginBottom: 8},
  pickerNav: {flexDirection: 'row', gap: 10, marginBottom: 10},
  pickerList: {borderWidth: 1, borderColor: '#000', maxHeight: 380, padding: 6},
  pickerRow: {paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#ddd'},
  pickerRowText: {fontSize: 20, color: '#000'},
  agendaItem: {borderBottomWidth: 1, borderBottomColor: '#ccc', paddingVertical: 10},
  agendaTime: {fontSize: 20, fontWeight: '700', color: '#000'},
  agendaTitle: {fontSize: 22, color: '#000', marginTop: 1},
  agendaMeta: {fontSize: 18, color: '#555', marginTop: 1},
  dayCell: {flex: 1, minHeight: 96, borderWidth: 1, borderColor: '#bbb', margin: 1, padding: 3},
  dayCellSelected: {borderWidth: 2, borderColor: '#000'},
  dayNum: {fontSize: 20, color: '#000'},
  dayNumToday: {fontWeight: '700', textDecorationLine: 'underline'},
  markRow: {flexDirection: 'row', gap: 2, marginTop: 2},
  // Filled black boxes, not outlines: on a monochrome panel a solid swatch is
  // the only marker that stays obvious at a glance across a full month grid.
  mark: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: '#000',
    paddingHorizontal: 6,
    paddingVertical: 1,
    lineHeight: 20,
    overflow: 'hidden',
  },
  viewSwitch: {marginTop: 10, marginBottom: 10},
  viewSwitchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 10,
  },
  backButton: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: 14,
    paddingVertical: 4,
    alignItems: 'center',
  },
  backIcon: {fontSize: 24, color: '#000', lineHeight: 26},
  backLabel: {fontSize: 15, color: '#000'},
  subheadingLink: {
    fontSize: 23,
    fontWeight: '700',
    color: '#000',
    marginTop: 14,
    marginBottom: 6,
    textDecorationLine: 'underline',
  },
  weekDayRow: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4},
  weekDay: {borderWidth: 1, borderColor: '#999', padding: 10, marginBottom: 8},
  weekDayToday: {borderWidth: 3, borderColor: '#000'},
  weekDayHead: {fontSize: 21, fontWeight: '700', color: '#000', marginBottom: 4},
  weekDayHeadToday: {textDecorationLine: 'underline'},
  weekEntry: {fontSize: 20, color: '#000', marginTop: 4, lineHeight: 28},
  weekEmpty: {fontSize: 18, color: '#888', marginTop: 2},
  dayWrap: {flexDirection: 'row', gap: 12},
  dayGrid: {flex: 3},
  hourRow: {flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#ccc', minHeight: 40},
  hourLabel: {width: 86, fontSize: 17, color: '#555', paddingTop: 5},
  hourBody: {flex: 1, paddingVertical: 3},
  slotEvent: {fontSize: 20, color: '#000', fontWeight: '700', lineHeight: 26},
  slotMeta: {fontSize: 16, color: '#555'},
  dayTasks: {flex: 2, borderLeftWidth: 2, borderLeftColor: '#000', paddingLeft: 12},
  paneTitle: {fontSize: 21, fontWeight: '700', color: '#000', marginBottom: 6},
  paneDate: {fontSize: 17, color: '#555', marginTop: 8},
  paneTask: {paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#ddd'},
  paneTaskText: {fontSize: 20, color: '#000', lineHeight: 26},
  paneRunning: {fontSize: 18, fontWeight: '700', color: '#555', marginTop: 10, marginBottom: 2},
  paneSeparator: {borderTopWidth: 3, borderTopColor: '#000', marginVertical: 14},
  markLegend: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#000',
    paddingHorizontal: 6,
    lineHeight: 20,
    overflow: 'hidden',
  },
  tinyButtonText: {fontSize: 20, color: '#000'},
  section: {marginTop: 16},
  sectionHead: {borderTopWidth: 1, borderTopColor: '#000', paddingVertical: 10},
  sectionTitle: {fontSize: 22, fontWeight: '700', color: '#000'},
  subheading: {fontSize: 22, fontWeight: '700', color: '#000', marginTop: 18, marginBottom: 6},
  helpStep: {fontSize: 20, color: '#333', lineHeight: 28, marginBottom: 10},
  helpNum: {fontWeight: '700', color: '#000'},
  task: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: 11,
  },
  boxHit: {paddingRight: 2},
  box: {fontSize: 30, color: '#000', lineHeight: 33},
  taskTitle: {fontSize: 24, color: '#000'},
  struck: {textDecorationLine: 'line-through', color: '#555'},
  metaRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8},
  due: {fontSize: 20, color: '#333', marginTop: 2},
  noDue: {fontSize: 20, color: '#888', marginTop: 2, fontStyle: 'italic'},
  legend: {fontSize: 18, color: '#555', marginTop: 8},
  overdue: {fontWeight: '700', color: '#000'},
  sourceChip: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignItems: 'center',
  },
  sourceChipText: {fontSize: 20, color: '#000', lineHeight: 22},
  sourceChipLabel: {fontSize: 12, color: '#000'},
  originTag: {
    fontSize: 16,
    color: '#000',
    borderWidth: 1,
    borderColor: '#777',
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginTop: 2,
  },
  originTagNamed: {backgroundColor: '#000', color: '#fff', borderColor: '#000'},
  listTag: {
    fontSize: 16,
    color: '#000',
    borderWidth: 1,
    borderColor: '#777',
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginTop: 2,
  },
  description: {fontSize: 20, color: '#555', marginTop: 2},
  empty: {fontSize: 22, color: '#555', marginVertical: 16},
  note: {fontSize: 18, color: '#555', marginBottom: 10},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8},
  status: {fontSize: 22, color: '#000', marginVertical: 8},
  error: {fontWeight: '700'},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8},
  button: {borderWidth: 1, borderColor: '#000', paddingHorizontal: 18, paddingVertical: 10},
  buttonPrimary: {backgroundColor: '#000'},
  buttonText: {fontSize: 22, color: '#000'},
  buttonTextPrimary: {color: '#fff'},
});

/** Re-export so screens can resolve their ScrollView to a node handle. */
export {findNodeHandle};
