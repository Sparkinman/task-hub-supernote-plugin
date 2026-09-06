import React, {useRef} from 'react';
import {
  Dimensions,
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
import {bandOf, priorityLabel} from '../priority';
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
  /** Held back while a write is in flight, so leaving cannot interrupt it. */
  closeDisabled?: boolean;
  /**
   * Hides the corner close entirely. The settings screen does this: leaving is
   * a decision between saving and discarding, so it belongs on the two labelled
   * buttons at the foot of the page rather than in a corner that says neither.
   */
  hideClose?: boolean;
  /**
   * An action shown beside the close, for a form long enough that its own Save
   * is off the bottom of the screen. Typing a title and a couple of steps is
   * enough to push it out of view, and scrolling back down to a button you
   * cannot see is a poor way to finish a task.
   */
  action?: {label: string; onPress: () => void; disabled?: boolean};
}): React.JSX.Element {
  if (props.masthead) {
    return (
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <FullLogo />
          <Text style={styles.mastheadTitle}>{props.title}</Text>
        </View>
        {!!props.action && (
          <Pressable
            style={[styles.headerAction, props.action.disabled && styles.buttonDisabled]}
            disabled={props.action.disabled}
            onPress={props.action.onPress}
            hitSlop={8}>
            <Text
              style={[
                styles.headerActionText,
                props.action.disabled && styles.buttonTextDisabled,
              ]}>
              {props.action.label}
            </Text>
          </Pressable>
        )}
        {!props.hideClose && (
          <Pressable
            style={[styles.close, props.closeDisabled && styles.buttonDisabled]}
            disabled={props.closeDisabled}
            onPress={props.onClose}
            hitSlop={10}>
            <Text style={[styles.closeText, props.closeDisabled && styles.buttonTextDisabled]}>
              {props.closeDisabled ? 'Saving…' : 'Done & Exit'}
            </Text>
          </Pressable>
        )}
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
      {!!props.action && (
        <Pressable
          style={[styles.headerAction, props.action.disabled && styles.buttonDisabled]}
          disabled={props.action.disabled}
          onPress={props.action.onPress}
          hitSlop={8}>
          <Text
            style={[styles.headerActionText, props.action.disabled && styles.buttonTextDisabled]}>
            {props.action.label}
          </Text>
        </Pressable>
      )}
      {!props.hideClose && (
        <Pressable
          style={[styles.close, props.closeDisabled && styles.buttonDisabled]}
          disabled={props.closeDisabled}
          onPress={props.onClose}
          hitSlop={10}>
          <Text style={[styles.closeText, props.closeDisabled && styles.buttonTextDisabled]}>
            {props.closeDisabled ? 'Saving…' : 'Done & Exit'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Blocking yes/no confirmation.
 *
 * Drawn as an overlay in the app's own window rather than in a Modal.
 *
 * RN's Modal creates a whole new Android window, and on e-ink that is a slow,
 * visible event: the panel does a full refresh to put the window up and another
 * to take it down, which is why confirming a save felt heavy for a question with
 * two buttons in it. An absolutely positioned View costs one repaint of the area
 * it covers.
 *
 * Not an Alert either: Alert's styling is not controllable, and on a monochrome
 * panel its default chrome is low-contrast. This also gives the question room to
 * name the task being acted on.
 */
export function Confirm(props: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element | null {
  if (!props.visible) {
    return null;
  }
  return (
    <View style={styles.overlay} pointerEvents="auto">
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>{props.title}</Text>
        {!!props.body && <Text style={styles.modalBody}>{props.body}</Text>}
        <View style={styles.modalActions}>
          <Button label={props.confirmLabel ?? 'Yes'} primary onPress={props.onConfirm} />
          <Button label="No" onPress={props.onCancel} />
        </View>
      </View>
    </View>
  );
}

/**
 * One-way message with a single dismiss.
 *
 * Separate from Confirm rather than a variant of it: a Yes/No pair on a message
 * that decides nothing invites the user to look for the difference between the
 * two buttons. Drawn as an overlay for the same reason Confirm is.
 */
export function Notice(props: {
  visible: boolean;
  title: string;
  body?: string;
  label?: string;
  onDismiss: () => void;
}): React.JSX.Element | null {
  if (!props.visible) {
    return null;
  }
  return (
    <View style={styles.overlay} pointerEvents="auto">
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>{props.title}</Text>
        {!!props.body && <Text style={styles.modalBody}>{props.body}</Text>}
        <View style={styles.modalActions}>
          <Button label={props.label ?? 'OK'} primary onPress={props.onDismiss} />
        </View>
      </View>
    </View>
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

/**
 * A collapsible block of settings.
 *
 * Separate from `Section`, which counts the rows it holds — a settings group
 * has no count worth showing, and it does have a line of explanation that
 * belongs on the outside where it can be read before deciding to open it.
 *
 * The settings page is long: a server, its lists, five kinds of note, page
 * marks and formats. Shown all at once it reads as a wall, and the thing most
 * people came to change is somewhere in the middle of it.
 */
export function Fold(props: {
  title: string;
  /** One line, shown whether or not the block is open. */
  hint?: string;
  /**
   * Content shown whether or not the block is open, under the hint.
   *
   * For the one thing somebody needs while the section is still shut — the
   * server section uses it for the Task Hub address, which is no use to
   * anybody if they have to open the section to find out it exists.
   */
  always?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.settingsFold}>
      <Pressable style={styles.settingsFoldHead} onPress={props.onToggle} hitSlop={6}>
        <Text style={styles.settingsFoldTitle}>
          {props.open ? '▾' : '▸'} {props.title}
        </Text>
      </Pressable>
      {!!props.hint && <Text style={styles.settingsFoldHint}>{props.hint}</Text>}
      {props.always}
      {props.open && <View style={styles.settingsFoldBody}>{props.children}</View>}
    </View>
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


/**
 * A folder, drawn rather than typed.
 *
 * The obvious thing is a glyph — 🗀 or 📁 — but the device's font does not have
 * them and Android renders a missing glyph as a box with a cross through it,
 * which is what appeared on the settings page. Two plain Views always render, on
 * every generation of the hardware, whatever fonts the firmware ships.
 */
export function FolderIcon(props: {size?: number}): React.JSX.Element {
  const size = props.size ?? 22;
  const tabHeight = Math.round(size * 0.22);
  return (
    <View style={[styles.folderIcon, {width: size, height: size}]}>
      {/* The raised tab along the top-left of a hanging folder. */}
      <View style={[styles.folderTab, {width: Math.round(size * 0.45), height: tabHeight}]} />
      <View style={[styles.folderBody, {width: size, height: size - tabHeight}]} />
    </View>
  );
}

/**
 * A calendar, drawn rather than typed.
 *
 * Same reason as FolderIcon: the device's font has no calendar glyph, and
 * Android draws a missing one as a box with a cross through it. Plain Views
 * always render.
 */
export function CalendarIcon(props: {size?: number}): React.JSX.Element {
  const size = props.size ?? 24;
  const bandHeight = Math.max(3, Math.round(size * 0.2));
  return (
    <View style={[styles.calendarIcon, {width: size, height: size}]}>
      {/* The two hanging rings along the top. */}
      <View style={styles.calendarRings}>
        <View style={styles.calendarRing} />
        <View style={styles.calendarRing} />
      </View>
      <View style={[styles.calendarBody, {width: size, height: size - 4}]}>
        <View style={[styles.calendarBand, {height: bandHeight}]} />
      </View>
    </View>
  );
}

function TaskRowImpl(props: {
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
  /** 1 when this task is a step of another, which indents it under its parent. */
  depth?: number;
  /** Steps this task has, and how many are done. Absent when it has none. */
  stepCount?: number;
  stepsDone?: number;
  /** Whether this task's steps are showing; absent when it has none. */
  stepsOpen?: boolean;
  onToggleSteps?: () => void;
}): React.JSX.Element {
  const {
    task,
    busy,
    dateFormat,
    timeFormat,
    listLabel,
    showNoDue,
    onToggle,
    onEdit,
    onOpenSource,
    depth = 0,
    stepCount = 0,
    stepsDone = 0,
    stepsOpen = false,
    onToggleSteps,
  } = props;
  const overdue = !task.completed && task.dueAt !== null && task.dueAt < Date.now();
  const due = formatDue(task.dueDate, task.dueTime, dateFormat, timeFormat);
  const priority = priorityLabel(task.priority);

  return (
    <View style={[styles.task, depth > 0 && styles.taskStep]}>
      {/*
        A step is marked by a rail rather than indentation alone: on a 1-bit
        panel a few points of whitespace is not a visible difference, and the
        rail survives a row whose title wraps to three lines.
      */}
      {depth > 0 && <View style={styles.stepRail} />}
      {stepCount > 0 && !!onToggleSteps ? (
        <Pressable onPress={onToggleSteps} hitSlop={18} style={styles.foldHit}>
          <Text style={styles.fold}>{stepsOpen ? '▾' : '▸'}</Text>
        </Pressable>
      ) : (
        // Keeps every tick box on the same vertical line whether or not the
        // task has steps.
        <View style={styles.foldHit} />
      )}
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
          {stepCount > 0 && (
            <Text style={styles.stepCount}>
              {stepsDone}/{stepCount} steps
            </Text>
          )}
          {/*
            High gets the filled badge and the others an outline, the same
            device this row already uses for origins: a 1-bit panel has no
            colour to lean on, so weight is the only thing that separates
            "deal with this" from "noted".
          */}
          {!!priority && (
            <Text
              style={[
                styles.priorityTag,
                bandOf(task.priority) === 'high' && styles.priorityTagHigh,
              ]}>
              {priority}
            </Text>
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
      {busy && <Busy />}
    </View>
  );
}


/**
 * A still marker for "something is happening", in place of a spinner.
 *
 * ActivityIndicator animates continuously, and on an e-ink panel every frame of
 * that is a partial refresh: the spinner itself costs more redraws than the work
 * it is reporting on, and it makes the whole screen feel slow while it is up.
 * A static glyph says the same thing for nothing.
 */
export function Busy(): React.JSX.Element {
  return <Text style={styles.busyMark}>⋯</Text>;
}

/**
 * Loading indicator for background reloads.
 *
 * Kept separate from Status rather than reusing the 'working' kind: a refresh
 * runs straight after a save, and routing it through the same state would wipe
 * the "Saved successfully" message the user just earned.
 */
export function LoadingLine(props: {
  visible: boolean;
  /**
   * Draws it large and boxed instead of as a line of status text.
   *
   * Used when the plugin has just opened with nothing on screen yet: the panel
   * takes a moment to draw and the server a moment to answer, and a small grey
   * line in that gap looks like a plugin that has failed to start rather than
   * one that is working.
   */
  prominent?: boolean;
  /** What is being waited for, when "Loading" is not specific enough. */
  label?: string;
}): React.JSX.Element | null {
  if (!props.visible) {
    return null;
  }
  if (props.prominent) {
    return (
      <View style={styles.loadingPanel}>
        <Text style={styles.loadingPanelText}>{props.label ?? 'Loading…'}</Text>
        <Text style={styles.loadingPanelHint}>
          Fetching your tasks, calendars and notes from the device and server.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.statusRow}>
      <Busy />
      <Text style={styles.status}>{props.label ?? 'Loading…'}</Text>
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
        <Busy />
        <Text style={styles.status}>{status.message}</Text>
      </View>
    );
  }
  return (
    <Text style={[styles.status, status.kind === 'error' && styles.error]}>{status.message}</Text>
  );
}

function FieldImpl(props: {
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
  /**
   * Greys the button out and stops it responding. Used while a write is in
   * flight, so Save cannot be pressed twice and Done & Exit cannot leave with
   * the write half done.
   */
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      style={[
        styles.button,
        props.primary && styles.buttonPrimary,
        props.disabled && styles.buttonDisabled,
      ]}
      disabled={props.disabled}
      onPress={props.onPress}>
      <Text
        style={[
          styles.buttonText,
          props.primary && styles.buttonTextPrimary,
          props.disabled && styles.buttonTextDisabled,
        ]}>
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

/**
 * The panel height at load, for the few places a list has to be capped.
 *
 * A fixed 420pt cap is a different fraction of the screen on every Supernote
 * generation — most of an A5X, less than a third of a Manta. Reading it once
 * here keeps those lists proportionate on all of them. Read once rather than
 * subscribed to: these panels do not rotate or resize during a session.
 */
export const SCREEN_HEIGHT = Dimensions.get('window').height || 1872;

/**
 * How much to shrink the interface on a smaller panel.
 *
 * Task Hub runs on panels from the 7.8" Nomad to the 10.7" Manta, and the type
 * sizes here were chosen on a large one. On a Nomad the same layout means the
 * same content needs more scrolling, because there is simply less room to put
 * it in.
 *
 * Derived from the height the window actually reports, in dp, rather than from
 * the device model: dp is what decides how much fits, it is available
 * synchronously at module load — which a model lookup is not, since the SDK's
 * getDeviceType is asynchronous and the stylesheet is built before it could
 * answer — and it keeps working on a device this code has never heard of.
 *
 * Bounded on both sides. Never above 1, because the sizes are already right on
 * a large panel; never below 0.8, because past that the text stops being
 * comfortable to read on e-ink, and unreadable text is a worse problem than
 * scrolling.
 */
/**
 * Calibration points, measured on real devices.
 *
 * The window reports density-independent pixels, not the panel's pixels: a
 * Manta comes back as 1365 and a Nomad as 998, not 2560 and 1872. Both earlier
 * attempts got this wrong — the first used a reference of 1850 so both devices
 * divided out above 1 and clamped to full size, the second used 2560 so both
 * fell below the floor and clamped to 0.72. Either way the two panels came out
 * identical, which is the tell that the reference was in the wrong units.
 *
 * The scales are the ones that actually read well on each panel, judged on the
 * hardware rather than derived: full size on a Manta, 70% on a Nomad. Anything
 * between is interpolated, and anything outside is clamped to a sane range so
 * an unfamiliar device still gets readable text.
 *
 * These two numbers are the whole calibration. If a panel reads wrong, change
 * the one for that panel — nothing else here needs touching.
 */
const NOMAD_HEIGHT = 998;
const NOMAD_SCALE = 0.7;
const MANTA_HEIGHT = 1365;
const MANTA_SCALE = 1;

export const UI_SCALE = (() => {
  const slope = (MANTA_SCALE - NOMAD_SCALE) / (MANTA_HEIGHT - NOMAD_HEIGHT);
  const scale = NOMAD_SCALE + (SCREEN_HEIGHT - NOMAD_HEIGHT) * slope;
  // Never so small that e-ink text stops being comfortable, never so large that
  // a panel bigger than a Manta gets type nobody asked for.
  return Math.max(0.6, Math.min(1.05, Math.round(scale * 100) / 100));
})();

/**
 * A font size, scaled for this panel.
 */
export function fs(size: number): number {
  return Math.round(size * UI_SCALE);
}

/**
 * A spacing value — padding, margin, gap, a row's minimum height — scaled for
 * this panel.
 *
 * Scaling the type alone was not enough: it made the words smaller inside rows
 * and cells that were still the size they are on a Manta, so a month grid and a
 * day's rows took just as much room as before and the smaller device still
 * scrolled. Space is most of what a calendar is made of.
 *
 * Never rounds a positive value to nothing: a 1px hairline that becomes 0
 * disappears, and a gap that becomes 0 runs two things together.
 */
export function sp(size: number): number {
  if (size === 0) {
    return 0;
  }
  return Math.max(1, Math.round(size * UI_SCALE));
}

// Settings text is deliberately larger than a phone app's would be. The panel is
// read at arm's length in whatever light the room has, the explanations here are
// the only documentation the plugin has, and the page already scrolls — so there
// is nothing to be won by squeezing them.
//
// High-contrast, flat styling — e-ink has no colour and slow refresh, so avoid
// gradients, shadows and animation. Selection is shown by fill inversion, which
// survives a monochrome panel; colour alone would not.
export const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#fff'},
  /** Holds the scrolling page and the overlays that cover it. */
  appRoot: {flex: 1, backgroundColor: '#fff'},
  content: {padding: sp(14), paddingBottom: sp(40)},
  // Extra tail room so the last field can still scroll clear of the keyboard.
  // NOTE: the keyboard's bottom padding is no longer a constant. It is applied
  // inline in App.tsx from the height the host reports for the keyboard, because
  // that height differs between an A5X and a Manta and a fixed value can only
  // ever be right on one of them.

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderBottomWidth: 2,
    borderBottomColor: '#000',
    paddingBottom: sp(8),
    marginBottom: sp(10),
  },
  headerLeft: {flexDirection: 'row', alignItems: 'center', gap: sp(10), flex: 1},
  mastheadTitle: {fontSize: fs(27), fontWeight: '700', color: '#000', alignSelf: 'flex-end', marginBottom: sp(4)},
  heading: {fontSize: fs(30), fontWeight: '700', color: '#000'},
  close: {borderWidth: 1, borderColor: '#000', paddingHorizontal: sp(12), paddingVertical: sp(5)},
  headerAction: {
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(14),
    paddingVertical: sp(8),
    marginRight: sp(10),
  },
  headerActionText: {fontSize: fs(20), color: '#fff', fontWeight: '700'},
  closeText: {fontSize: fs(24), color: '#000', lineHeight: fs(30)},
  field: {marginBottom: sp(12)},
  label: {fontSize: fs(21), color: '#000', marginBottom: sp(4)},
  input: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(10),
    paddingVertical: sp(8),
    fontSize: fs(22),
    color: '#000',
  },
  inputTall: {minHeight: sp(96), textAlignVertical: 'top'},
  fieldCompact: {marginBottom: sp(7)},
  labelCompact: {fontSize: fs(20), color: '#000', marginBottom: sp(3)},
  inputCompact: {paddingHorizontal: sp(8), paddingVertical: sp(5), fontSize: fs(18)},
  inputTallCompact: {minHeight: sp(58), textAlignVertical: 'top'},
  subheadingCompact: {fontSize: fs(23), fontWeight: '700', color: '#000', marginTop: sp(16), marginBottom: sp(4)},
  helpStepCompact: {fontSize: fs(18), color: '#222', lineHeight: fs(25), marginBottom: sp(8)},
  noteCompact: {fontSize: fs(17), color: '#444', lineHeight: fs(23), marginBottom: sp(8)},
  /**
   * Demo-build banner. Inverted rather than tinted: a grey wash is close to
   * invisible on e-ink, and this label has to be unmissable.
   */
  demoBanner: {
    backgroundColor: '#000',
    paddingVertical: sp(5),
    paddingHorizontal: sp(8),
    marginBottom: sp(6),
  },
  demoBannerText: {
    color: '#fff',
    fontSize: fs(14),
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  checkRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(8),
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(8),
    paddingVertical: sp(6),
    marginBottom: sp(5),
  },
  optionTextCompact: {fontSize: fs(20), color: '#000'},
  actionsTight: {flexDirection: 'row', flexWrap: 'wrap', gap: sp(8), marginTop: sp(8)},
  grow: {flex: 1},
  choiceRow: {flexDirection: 'row', flexWrap: 'wrap', gap: sp(8), marginBottom: sp(12)},
  chip: {borderWidth: 1, borderColor: '#000', paddingHorizontal: sp(12), paddingVertical: sp(7)},
  chipOn: {backgroundColor: '#000'},
  chipText: {fontSize: fs(21), color: '#000'},
  chipTextOn: {color: '#fff'},
  option: {borderWidth: 1, borderColor: '#000', padding: sp(10), marginBottom: sp(8)},
  optionOn: {borderWidth: 2},
  optionText: {fontSize: fs(22), color: '#000'},
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(10),
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(10),
    paddingVertical: sp(10),
    marginBottom: sp(8),
  },
  tinyButton: {borderWidth: 1, borderColor: '#000', paddingHorizontal: sp(10), paddingVertical: sp(4)},
  /**
   * Covers the app's window, in the app's window. Positioned absolutely against
   * the root View so it sits over the scrolling content without scrolling with
   * it, and without the cost of a second Android window.
   */
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: sp(24),
  },
  /**
   * The scrim a sheet sits on, as its own overlay.
   *
   * Use this INSTEAD of `overlay` + `modalBackdrop`, never both: nesting the
   * scrim inside the white overlay paints a white screen with a dithered grey
   * column down the middle of it, which is what the date and folder pickers
   * looked like for one release.
   */
  overlayScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Opaque white, not a translucent black scrim.
    //
    // A 35% black layer over the whole panel is one of the most expensive
    // things this app can draw: e-ink has no alpha channel, so the whole area
    // is dithered to approximate the grey, and every pixel of it changes on the
    // way in and on the way out. Solid white is a single fill, and the sheet's
    // own black border is what separates it from the page — which reads better
    // on a monochrome panel than a wash does anyway.
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: sp(24),
  },
  modalBackdrop: {
    flex: 1,
    // Opaque for the same reason as overlayScrim: no alpha on e-ink, so a
    // translucent layer becomes a dithered full-screen fill.
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: sp(24),
  },
  modalCard: {backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', padding: sp(18), width: '100%', maxWidth: 460},
  modalTitle: {fontSize: fs(26), fontWeight: '700', color: '#000', marginBottom: sp(8)},
  modalBody: {fontSize: fs(21), color: '#333', lineHeight: fs(28), marginBottom: sp(6)},
  // One control at each end of the sheet's foot: leave on the left, confirm on
  // the right.
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: sp(12),
  },
  modalActions: {flexDirection: 'row', gap: sp(10), marginTop: sp(14)},
  tabRow: {flexDirection: 'row', gap: sp(0), marginBottom: sp(8)},
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#000',
    paddingVertical: sp(11),
    alignItems: 'center',
  },
  tabOn: {backgroundColor: '#000'},
  tabText: {fontSize: fs(22), fontWeight: '700', color: '#000'},
  tabTextOn: {color: '#fff'},
  monthRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  // Breathing room between the action row and the ‹ › month/week/day stepper,
  // which otherwise reads as part of the same button cluster.
  calendarNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: sp(22),
  },
  dayHeading: {
    flex: 1,
    fontSize: fs(24),
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
  nav: {paddingHorizontal: sp(16), paddingVertical: sp(6), borderWidth: 1, borderColor: '#000'},
  navText: {fontSize: fs(30), color: '#000', lineHeight: fs(33)},
  monthLabel: {fontSize: fs(24), fontWeight: '700', color: '#000'},
  tappableLabel: {textDecorationLine: 'underline'},
  week: {flexDirection: 'row', marginTop: sp(4)},
  weekday: {flex: 1, textAlign: 'center', fontSize: fs(18), color: '#555', paddingVertical: sp(4)},
  noteButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: sp(8),
    marginTop: sp(10),
    marginBottom: sp(4),
  },
  // Three months on one panel. Everything here is sized down from the month
  // view rather than reflowed: the point of the quarter view is the shape of
  // twelve weeks at a glance, and a day cell only has to be tappable, not
  // readable in detail.
  quarterMonth: {marginTop: sp(12)},
  quarterMonthLabel: {
    fontSize: fs(20),
    fontWeight: '700',
    color: '#000',
    marginBottom: sp(2),
    textDecorationLine: 'underline',
  },
  quarterWeek: {flexDirection: 'row'},
  quarterWeekday: {flex: 1, textAlign: 'center', fontSize: fs(13), color: '#555', paddingVertical: sp(2)},
  quarterCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: sp(3),
    // A floor rather than a fixed height: without it a row whose cells are all
    // empty collapses to nothing and the grid loses its shape, which is what
    // made the quarter view look wrong rather than merely small.
    minHeight: sp(30),
    borderWidth: 1,
    borderColor: '#ddd',
  },
  // An empty padding cell: holds its place in the row and nothing else.
  quarterCellEmpty: {flex: 1, paddingVertical: sp(3), minHeight: sp(30)},
  // Selection is a solid fill with inverted text — on a monochrome panel a
  // pale wash and a slightly darker border were nearly the same thing, which is
  // why the selected day was hard to pick out.
  // Same reasoning as the year view: an outline, never a fill.
  quarterCellSelected: {borderColor: '#000', borderWidth: 3, backgroundColor: '#fff'},
  quarterCellToday: {borderColor: '#000', borderWidth: 2, borderStyle: 'dashed'},
  quarterCellText: {fontSize: fs(15), color: '#000'},
  quarterCellTextSelected: {color: '#000', fontWeight: '700'},
  // A bar rather than the month view's boxed letters: at this size a letter is
  // unreadable, so it says "something is here" and the month view says what.
  quarterDot: {height: 3, width: 12, backgroundColor: '#000', marginTop: sp(1)},
  // The year view: twelve grids, three to a row. Smaller again than the
  // quarter's, and with no marker beside the number — at this size the number
  // itself goes bold to say a day has something on it.
  yearQuarterLabel: {fontSize: fs(18), fontWeight: '700', color: '#000', marginTop: sp(10)},
  yearRow: {flexDirection: 'row', gap: sp(6)},
  yearMonth: {flex: 1},
  yearMonthLabel: {fontSize: fs(15), fontWeight: '700', color: '#000', marginBottom: sp(1)},
  yearWeek: {flexDirection: 'row'},
  yearCell: {flex: 1, alignItems: 'center', paddingVertical: sp(1)},
  // Selection is a heavy outline, not a fill. A black fill relies on every text
  // style beneath it being overridden to white, and one that is not — the bold
  // "has something on it" style, for instance — leaves black on black and an
  // unreadable day. An outline cannot fail that way.
  yearCellSelected: {borderWidth: 3, borderColor: '#000', backgroundColor: '#fff'},
  yearCellToday: {borderWidth: 2, borderColor: '#000', borderStyle: 'dashed'},
  yearCellText: {fontSize: fs(10), color: '#333'},
  yearCellBusy: {fontWeight: '700', color: '#000'},
  yearCellTextSelected: {color: '#000', fontWeight: '700'},
  // The week number gutter down the left of each month grid.
  yearWeekNum: {width: 16, alignItems: 'center', justifyContent: 'center'},
  yearWeekNumText: {fontSize: fs(9), color: '#888'},
  // The month grid's week-number gutter. Wider than the year view's because it
  // is a real target here: tapping it opens that week's note.
  monthWeekNum: {width: 34, alignItems: 'center', justifyContent: 'center'},
  monthWeekNumHead: {width: 34, textAlign: 'center', fontSize: fs(15), color: '#555'},
  monthWeekNumText: {fontSize: fs(17), color: '#777'},
  // A week that already has a note is shown filled in, so the gutter says which
  // weeks are written up without anything being tapped.
  monthWeekNumHas: {color: '#000', fontWeight: '700', textDecorationLine: 'underline'},
  // Nested tasks in the day view's pane. Smaller than the Tasks tab's fold
  // control because the pane is a column, not the full width — but still a pen
  // target rather than a decoration.
  paneTaskRow: {flexDirection: 'row', alignItems: 'flex-start'},
  paneFoldHit: {width: 34, alignItems: 'center'},
  paneFold: {fontSize: fs(34), color: '#000', lineHeight: fs(34)},
  paneTaskStep: {paddingLeft: sp(18), backgroundColor: '#ededed'},
  // Events outside the agenda's chosen hours, under the grid.
  outsideBlock: {marginTop: sp(10), borderTopWidth: 1, borderTopColor: '#999', paddingTop: sp(8)},
  outsideHead: {fontSize: fs(17), color: '#555', marginBottom: sp(4)},
  browseRow: {flexDirection: 'row', alignItems: 'flex-start', gap: sp(8)},
  miniCell: {flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', margin: sp(1)},
  miniCellOn: {borderWidth: 1, borderColor: '#999'},
  miniCellSel: {backgroundColor: '#000', borderColor: '#000'},
  miniCellText: {fontSize: fs(20), color: '#000'},
  miniCellTextSel: {color: '#fff', fontWeight: '700'},
  weekNumHead: {width: 46, textAlign: 'center', fontSize: fs(14), color: '#555', paddingVertical: sp(4)},
  weekNumCell: {
    width: 46,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    margin: sp(1),
    borderWidth: 1,
    borderColor: '#000',
  },
  weekNumText: {fontSize: fs(16), fontWeight: '700', color: '#000'},
  eventRow: {flexDirection: 'row', alignItems: 'flex-start', gap: sp(6)},
  noteChip: {borderWidth: 1, borderColor: '#000', paddingHorizontal: sp(8), paddingVertical: sp(3)},
  noteChipText: {fontSize: fs(18), color: '#000', lineHeight: fs(22)},
  templateSummary: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(10),
    paddingVertical: sp(8),
    marginBottom: sp(10),
  },
  templateSummaryText: {fontSize: fs(18), color: '#000'},
  templateSummaryHint: {fontSize: fs(13), color: '#666', marginTop: sp(2)},
  templateScroll: {maxHeight: Math.round(SCREEN_HEIGHT * 0.42)},
  templateGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: sp(10), marginBottom: sp(12)},
  templateTile: {borderWidth: 1, borderColor: '#999', padding: sp(4), width: 116},
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
  templateBlankText: {fontSize: fs(16), color: '#777'},
  templateName: {fontSize: fs(14), color: '#000', marginTop: sp(3), textAlign: 'center'},
  browseButton: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(12),
    paddingVertical: sp(6),
    alignItems: 'center',
    marginTop: sp(24),
  },
  browseIcon: {fontSize: fs(22), color: '#000', lineHeight: fs(24)},
  folderIcon: {justifyContent: 'flex-end'},
  // The template file browser: one directory at a time.
  browserRow: {flexDirection: 'row', alignItems: 'center', gap: sp(10), marginBottom: sp(4)},
  browserUp: {borderWidth: 1, borderColor: '#000', paddingHorizontal: sp(12), paddingVertical: sp(8)},
  browserUpText: {fontSize: fs(18), color: '#000'},
  browserFolder: {borderBottomWidth: 1, borderBottomColor: '#ccc', paddingVertical: sp(10)},
  browserFolderText: {fontSize: fs(20), color: '#000'},
  folderTab: {borderColor: '#000', borderWidth: 2, borderBottomWidth: 0},
  calendarIcon: {alignItems: 'center'},
  // The steps' own date, offered beside the box that creates them.
  stepsDateRow: {flexDirection: 'row', alignItems: 'center', gap: sp(12), marginBottom: sp(8)},
  stepsDateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(10),
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(12),
    paddingVertical: sp(8),
  },
  stepsDateLabel: {fontSize: fs(18), color: '#000'},
  clearLink: {fontSize: fs(17), color: '#000', textDecorationLine: 'underline'},
  calendarRings: {flexDirection: 'row', gap: sp(6), height: 4},
  calendarRing: {width: 3, height: 4, backgroundColor: '#000'},
  calendarBody: {borderWidth: 2, borderColor: '#000'},
  calendarBand: {backgroundColor: '#000'},
  folderBody: {borderColor: '#000', borderWidth: 2},
  browseLabel: {fontSize: fs(14), color: '#000'},
  pastText: {color: '#9a9a9a'},
  nowRow: {flexDirection: 'row', alignItems: 'center', gap: sp(6)},
  nowLabel: {fontSize: fs(14), fontWeight: '700', color: '#000'},
  nowLine: {flex: 1, height: 3, backgroundColor: '#000'},
  pickerCard: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#000',
    padding: sp(16),
    width: '100%',
    maxWidth: 620,
    maxHeight: '85%',
  },
  pickerPath: {fontSize: fs(17), color: '#333', marginBottom: sp(8)},
  pickerNav: {flexDirection: 'row', gap: sp(10), marginBottom: sp(10)},
  pickerList: {borderWidth: 1, borderColor: '#000', maxHeight: Math.round(SCREEN_HEIGHT * 0.38), padding: sp(6)},
  pickerRow: {paddingVertical: sp(9), borderBottomWidth: 1, borderBottomColor: '#ddd'},
  pickerRowText: {fontSize: fs(20), color: '#000'},
  agendaItem: {borderBottomWidth: 1, borderBottomColor: '#ccc', paddingVertical: sp(10)},
  agendaTime: {fontSize: fs(20), fontWeight: '700', color: '#000'},
  agendaTitle: {fontSize: fs(22), color: '#000', marginTop: sp(1)},
  agendaMeta: {fontSize: fs(18), color: '#555', marginTop: sp(1)},
  // The same rows under the month grid, tighter: that list is there to be read
  // without scrolling past a whole calendar to reach it.
  agendaItemTight: {borderBottomWidth: 1, borderBottomColor: '#ddd', paddingVertical: sp(5)},
  agendaTitleTight: {fontSize: fs(18), color: '#000'},
  agendaMetaTight: {fontSize: fs(15), color: '#555'},
  monthTasksHead: {paddingVertical: sp(8), marginTop: sp(4)},
  monthTasksHeadText: {fontSize: fs(19), fontWeight: '700', color: '#000'},
  dayCell: {flex: 1, minHeight: sp(96), borderWidth: 1, borderColor: '#bbb', margin: sp(1), padding: sp(3)},
  dayCellSelected: {borderWidth: 2, borderColor: '#000'},
  dayNum: {fontSize: fs(20), color: '#000'},
  dayNumToday: {fontWeight: '700', textDecorationLine: 'underline'},
  markRow: {flexDirection: 'row', gap: sp(2), marginTop: sp(2)},
  // Filled black boxes, not outlines: on a monochrome panel a solid swatch is
  // the only marker that stays obvious at a glance across a full month grid.
  mark: {
    fontSize: fs(16),
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: '#000',
    paddingHorizontal: sp(6),
    paddingVertical: sp(1),
    lineHeight: fs(20),
    overflow: 'hidden',
  },
  viewSwitch: {marginTop: sp(10), marginBottom: sp(10)},
  viewSwitchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: sp(10),
    marginBottom: sp(10),
  },
  backButton: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(14),
    paddingVertical: sp(4),
    alignItems: 'center',
  },
  backIcon: {fontSize: fs(24), color: '#000', lineHeight: fs(26)},
  backLabel: {fontSize: fs(15), color: '#000'},
  subheadingLink: {
    fontSize: fs(23),
    fontWeight: '700',
    color: '#000',
    marginTop: sp(14),
    marginBottom: sp(6),
    textDecorationLine: 'underline',
  },
  weekDayRow: {flexDirection: 'row', alignItems: 'center', gap: sp(10), marginBottom: sp(4)},
  weekDay: {borderWidth: 1, borderColor: '#999', padding: sp(10), marginBottom: sp(8)},
  weekDayToday: {borderWidth: 3, borderColor: '#000'},
  weekDayHead: {fontSize: fs(21), fontWeight: '700', color: '#000', marginBottom: sp(4)},
  weekDayHeadToday: {textDecorationLine: 'underline'},
  weekEntry: {fontSize: fs(20), color: '#000', marginTop: sp(4), lineHeight: fs(28)},
  weekEmpty: {fontSize: fs(18), color: '#888', marginTop: sp(2)},
  // A minimum height for the whole two-column block, so a short agenda still
  // fills the page. Without it a day set to run 9 to 5 drew eight rows and
  // stopped, leaving the divider between the grid and the tasks as a stub a
  // third of the way down.
  // The minimum is a floor for the first render only; DayView measures where
  // the block actually starts and fills the rest of the window from there.
  dayWrap: {flexDirection: 'row', gap: sp(12), minHeight: Math.round(SCREEN_HEIGHT * 0.5)},
  dayGrid: {flex: 3},
  // Hour rows share out whatever height is left over, so the grid spans the
  // block however many hours are in it.
  hourSlot: {flexGrow: 1, justifyContent: 'flex-start'},
  hourRow: {flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#ccc', minHeight: sp(40)},
  hourLabel: {width: 86, fontSize: fs(17), color: '#555', paddingTop: sp(5)},
  hourBody: {flex: 1, paddingVertical: sp(3)},
  slotEvent: {fontSize: fs(20), color: '#000', fontWeight: '700', lineHeight: fs(26)},
  slotMeta: {fontSize: fs(16), color: '#555'},
  dayTasks: {flex: 2, borderLeftWidth: 2, borderLeftColor: '#000', paddingLeft: sp(12)},
  paneTitle: {fontSize: fs(21), fontWeight: '700', color: '#000', marginBottom: sp(6)},
  paneDate: {fontSize: fs(17), color: '#555', marginTop: sp(8)},
  paneTask: {paddingVertical: sp(6), borderBottomWidth: 1, borderBottomColor: '#ddd'},
  paneTaskText: {fontSize: fs(20), color: '#000', lineHeight: fs(26)},
  paneRunning: {fontSize: fs(18), fontWeight: '700', color: '#555', marginTop: sp(10), marginBottom: sp(2)},
  paneSeparator: {borderTopWidth: 3, borderTopColor: '#000', marginVertical: sp(14)},
  markLegend: {
    fontSize: fs(16),
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#000',
    paddingHorizontal: sp(6),
    lineHeight: fs(20),
    overflow: 'hidden',
  },
  tinyButtonText: {fontSize: fs(20), color: '#000'},
  settingsFold: {borderTopWidth: 2, borderTopColor: '#000', marginTop: sp(18), paddingTop: sp(8)},
  settingsFoldHead: {paddingVertical: sp(6)},
  settingsFoldTitle: {fontSize: fs(26), fontWeight: '700', color: '#000'},
  settingsFoldHint: {fontSize: fs(17), color: '#444', lineHeight: fs(23), marginBottom: sp(6)},
  settingsFoldBody: {marginTop: sp(4)},
  // An address to read and type elsewhere, not a tappable link: the plugin has
  // no browser to hand off to, so it is set to be selectable and left legible.
  linkText: {
    fontSize: fs(18),
    color: '#000',
    fontWeight: '700',
    marginBottom: sp(8),
    textDecorationLine: 'underline',
  },
  section: {marginTop: sp(16)},
  sectionHead: {borderTopWidth: 1, borderTopColor: '#000', paddingVertical: sp(10)},
  sectionTitle: {fontSize: fs(22), fontWeight: '700', color: '#000'},
  subheading: {fontSize: fs(22), fontWeight: '700', color: '#000', marginTop: sp(18), marginBottom: sp(6)},
  helpStep: {fontSize: fs(20), color: '#333', lineHeight: fs(28), marginBottom: sp(10)},
  helpNum: {fontWeight: '700', color: '#000'},
  task: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: sp(10),
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: sp(11),
  },
  // A step sits in from its parent, with a rail down the gap. On a 1-bit panel
  // indentation alone is too weak a signal, and the rail also survives a title
  // that wraps onto three lines.
  // A step is washed light grey as well as indented. Indentation alone was not
  // enough to read as "belongs to the row above" on the panel, and a filled band
  // survives a title that wraps to three lines in a way a thin rail does not.
  // Kept light: the text on top is pure black and has to stay comfortable.
  // Indented much further than the first attempt: on a panel this size a step
  // sitting 26pt in still read as a slightly odd top-level task rather than as
  // something belonging to the row above.
  taskStep: {paddingLeft: sp(56), backgroundColor: '#ededed'},
  stepRail: {
    position: 'absolute',
    left: 22,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#666',
  },
  // Always present, so every tick box lines up whether or not a task has steps.
  // Sized to the tick box beside it rather than to the text: this is a pen
  // target on an e-ink panel, and at 15pt it was half the size of everything
  // else in the row and easy to miss altogether.
  // Twice the size again. This is a pen target on an e-ink panel and it is the
  // control that reveals a whole piece of work, so it is now the largest thing
  // in the row by some margin — deliberately, because at 30pt it was still
  // being missed.
  foldHit: {width: 96, paddingTop: sp(1), alignItems: 'center', justifyContent: 'flex-start'},
  fold: {fontSize: fs(108), color: '#000', lineHeight: fs(96)},
  stepCount: {
    // Was 12, which made it the smallest thing in a row where every other badge
    // is 16.
    fontSize: fs(16),
    color: '#000',
    borderWidth: 1,
    borderColor: '#666',
    paddingHorizontal: sp(5),
    paddingVertical: sp(1),
    marginTop: sp(2),
  },
  boxHit: {paddingRight: sp(2)},
  box: {fontSize: fs(30), color: '#000', lineHeight: fs(33)},
  taskTitle: {fontSize: fs(24), color: '#000'},
  struck: {textDecorationLine: 'line-through', color: '#555'},
  metaRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp(8)},
  due: {fontSize: fs(20), color: '#333', marginTop: sp(2)},
  noDue: {fontSize: fs(20), color: '#888', marginTop: sp(2), fontStyle: 'italic'},
  legend: {fontSize: fs(18), color: '#555', marginTop: sp(8)},
  overdue: {fontWeight: '700', color: '#000'},
  sourceChip: {
    borderWidth: 1,
    borderColor: '#000',
    paddingHorizontal: sp(8),
    paddingVertical: sp(2),
    alignItems: 'center',
  },
  sourceChipText: {fontSize: fs(20), color: '#000', lineHeight: fs(22)},
  sourceChipLabel: {fontSize: fs(12), color: '#000'},
  originTag: {
    fontSize: fs(16),
    color: '#000',
    borderWidth: 1,
    borderColor: '#777',
    paddingHorizontal: sp(5),
    paddingVertical: sp(1),
    marginTop: sp(2),
  },
  originTagNamed: {backgroundColor: '#000', color: '#fff', borderColor: '#000'},
  priorityTag: {
    fontSize: fs(16),
    color: '#000',
    borderWidth: 1,
    borderColor: '#777',
    paddingHorizontal: sp(5),
    paddingVertical: sp(1),
    marginTop: sp(2),
  },
  priorityTagHigh: {backgroundColor: '#000', color: '#fff', borderColor: '#000'},
  listTag: {
    fontSize: fs(16),
    color: '#000',
    borderWidth: 1,
    borderColor: '#777',
    paddingHorizontal: sp(5),
    paddingVertical: sp(1),
    marginTop: sp(2),
  },
  description: {fontSize: fs(20), color: '#555', marginTop: sp(2)},
  empty: {fontSize: fs(22), color: '#555', marginVertical: sp(16)},
  note: {fontSize: fs(18), color: '#555', marginBottom: sp(10)},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: sp(8), marginVertical: sp(8)},
  busyMark: {fontSize: fs(24), color: '#000'},
  loadingPanel: {
    borderWidth: 3,
    borderColor: '#000',
    paddingVertical: sp(24),
    paddingHorizontal: sp(20),
    marginVertical: sp(18),
    alignItems: 'center',
  },
  loadingPanelText: {fontSize: fs(30), fontWeight: '700', color: '#000'},
  loadingPanelHint: {fontSize: fs(18), color: '#444', marginTop: sp(8), textAlign: 'center'},
  status: {fontSize: fs(22), color: '#000', marginVertical: sp(8)},
  error: {fontWeight: '700'},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: sp(10), marginTop: sp(8)},
  button: {borderWidth: 1, borderColor: '#000', paddingHorizontal: sp(18), paddingVertical: sp(10)},
  buttonPrimary: {backgroundColor: '#000'},
  buttonText: {fontSize: fs(22), color: '#000'},
  buttonTextPrimary: {color: '#fff'},
  buttonDisabled: {borderColor: '#aaa', backgroundColor: '#eee'},
  buttonTextDisabled: {color: '#888'},
});

/** Re-export so screens can resolve their ScrollView to a node handle. */
export {findNodeHandle};

/**
 * Memoised on its data, deliberately ignoring the callbacks.
 *
 * Every call site passes fresh arrow functions — `onEdit={() => openTaskEditor(task)}`
 * and friends — so a plain React.memo would never hit: the props differ on every
 * render even when nothing about the task has. Comparing the data alone is what
 * makes the memo worth having, and a long task list on an e-ink panel is exactly
 * where an avoidable repaint hurts.
 *
 * Safe because those closures capture the task, which IS compared, and handlers
 * that are stable for the life of the screen. If a callback ever needs to close
 * over something that changes independently of the task, it must be added to
 * this comparison or the row will call a stale one.
 */
export const TaskRow = React.memo(TaskRowImpl, (before, after) => {
  return (
    before.task === after.task &&
    before.busy === after.busy &&
    before.dateFormat === after.dateFormat &&
    before.timeFormat === after.timeFormat &&
    before.listLabel === after.listLabel &&
    before.showNoDue === after.showNoDue &&
    before.depth === after.depth &&
    before.stepCount === after.stepCount &&
    before.stepsDone === after.stepsDone &&
    before.stepsOpen === after.stepsOpen &&
    // Presence matters even when identity does not: a row that gains or loses
    // an action has to re-render to show or hide the control.
    !!before.onToggle === !!after.onToggle &&
    !!before.onEdit === !!after.onEdit &&
    !!before.onOpenSource === !!after.onOpenSource &&
    !!before.onToggleSteps === !!after.onToggleSteps
  );
});

/**
 * Memoised on its own value.
 *
 * Typing re-renders the whole screen, because every field's value lives in the
 * form's state. Without this, one keystroke in the sub tasks box re-rendered
 * every other field, picker and note on the form — on an e-ink panel that is a
 * repaint per character, which is exactly what "slow to type into" feels like.
 *
 * The callbacks are excluded for the same reason as in TaskRow: call sites pass
 * fresh arrows every render, so comparing them would defeat the memo entirely.
 */
export const Field = React.memo(FieldImpl, (before, after) => {
  return (
    before.value === after.value &&
    before.label === after.label &&
    before.placeholder === after.placeholder &&
    before.multiline === after.multiline &&
    before.compact === after.compact &&
    before.secure === after.secure &&
    before.scrollHandle === after.scrollHandle
  );
});
