/**
 * How often a task or event repeats.
 *
 * Deliberately the same five choices the Task Hub web page offers, written the
 * same way — `FREQ=DAILY` and friends, with no INTERVAL, COUNT or UNTIL. The two
 * editors work on the same CalDAV objects, so a rule set on the tablet has to
 * come back as "Every week" in the browser rather than as something the web
 * menu cannot name.
 *
 * The important behaviour is what happens to a rule this menu *cannot* name. A
 * rule written by another client — `FREQ=WEEKLY;BYDAY=MO,WE,FR`, or one with an
 * end date — is reported as `custom` and then left completely alone. Flattening
 * somebody's "every second Tuesday" into "Every month" because that is the
 * nearest thing this picker can say would quietly destroy a rule the user set
 * deliberately somewhere with a better editor.
 *
 * Pure on purpose: no SDK import, so jest can exercise it off-device.
 */

export type RepeatKey = '' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

/** The rule each choice writes. `custom` writes nothing — see `ruleFor`. */
const RULES: Record<Exclude<RepeatKey, 'custom'>, string> = {
  '': '',
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
};

/** The picker's options, in the order shown. Matches the web page's wording. */
export const REPEAT_OPTIONS: {key: RepeatKey; label: string}[] = [
  {key: '', label: 'Does not repeat'},
  {key: 'daily', label: 'Every day'},
  {key: 'weekly', label: 'Every week'},
  {key: 'monthly', label: 'Every month'},
  {key: 'yearly', label: 'Every year'},
];

/** The label for a key, including the `custom` one the picker cannot set. */
export function repeatLabel(key: RepeatKey): string {
  if (key === 'custom') {
    return 'Custom repeat';
  }
  return REPEAT_OPTIONS.find(o => o.key === key)?.label ?? 'Does not repeat';
}

/**
 * Which of the offered repeats a stored rule is, or `custom` when it is none of
 * them. An absent or empty rule is `''` — does not repeat.
 */
export function repeatKey(rrule?: string | null): RepeatKey {
  if (!rrule) {
    return '';
  }
  const normalised = rrule.toUpperCase().replace('RRULE:', '').trim();
  if (!normalised) {
    return '';
  }
  for (const [key, rule] of Object.entries(RULES)) {
    if (rule && normalised === rule) {
      return key as RepeatKey;
    }
  }
  return 'custom';
}

/**
 * The rule to write for a chosen key, or null when the stored rule must be left
 * exactly as it is.
 *
 * `custom` returns null: the user did not choose it, it is what the picker
 * reports when it does not recognise what is already there, and saving the form
 * without touching the repeat must not rewrite it.
 */
export function ruleFor(key: RepeatKey): string | null {
  if (key === 'custom') {
    return null;
  }
  return RULES[key] ?? '';
}

/** True when this rule is one the picker can name, so offering it is honest. */
export function isEditableRepeat(rrule?: string | null): boolean {
  return repeatKey(rrule) !== 'custom';
}
