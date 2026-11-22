/**
 * The rules for keeping typed-but-unsaved form input across a reload, for every screen at once.
 * Kept free of the DOM so they can be tested: the keeper component feeds them plain descriptions
 * of the fields on the page.
 */

export type PageDraftValues = Record<string, string | boolean>;

export type FieldDescription = Readonly<{
  tag: 'input' | 'textarea' | 'select';
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  autocomplete: string;
  value: string;
  defaultValue: string;
  checked: boolean;
  defaultChecked: boolean;
  /** The field, or something around it, asks not to be remembered. */
  optedOut: boolean;
  disabled: boolean;
}>;

const NEVER_REMEMBERED_TYPES = new Set([
  'password',
  'file',
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'range',
  'color',
]);

/** Secrets and one-time codes are never written to the device. */
const SENSITIVE_AUTOCOMPLETE = /(^|\s)(cc-|one-time-code|current-password|new-password)/;

export function isDraftable(field: FieldDescription): boolean {
  if (field.optedOut || field.disabled) return false;
  if (NEVER_REMEMBERED_TYPES.has(field.type)) return false;
  if (SENSITIVE_AUTOCOMPLETE.test(field.autocomplete)) return false;
  return true;
}

function isToggle(field: FieldDescription): boolean {
  return field.type === 'checkbox' || field.type === 'radio';
}

/** True when the person has changed the field from what the page gave them. */
export function isChanged(field: FieldDescription): boolean {
  return isToggle(field)
    ? field.checked !== field.defaultChecked
    : field.value !== field.defaultValue;
}

/**
 * A key that survives a reload: the field's own name, or failing that its label, placeholder or
 * position. Fields that share a name (rows of a table, radio options) get a running number.
 */
export function fieldKeys(fields: readonly FieldDescription[]): string[] {
  const seen = new Map<string, number>();
  return fields.map((field) => {
    const base = [
      field.tag,
      field.type,
      field.name || field.id || field.label || field.placeholder || '#',
      ...(field.type === 'radio' ? [field.value] : []),
    ].join('|');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return `${base}~${count}`;
  });
}

/** What to keep: only fields the person changed, and only the kinds that are safe to keep. */
export function snapshotChanges(
  fields: readonly FieldDescription[],
  skip: (index: number) => boolean = () => false,
): PageDraftValues {
  const keys = fieldKeys(fields);
  const values: PageDraftValues = {};
  fields.forEach((field, index) => {
    if (!isDraftable(field) || !isChanged(field) || skip(index)) return;
    if (field.type === 'radio') {
      if (field.checked) values[keys[index]!] = true;
    } else {
      values[keys[index]!] = isToggle(field) ? field.checked : field.value;
    }
  });
  return values;
}

export type RestoreStep = Readonly<{ index: number; value: string | boolean }>;

/** The fields on the page now that a saved draft would change. */
export function restorableSteps(
  fields: readonly FieldDescription[],
  saved: PageDraftValues,
): RestoreStep[] {
  const keys = fieldKeys(fields);
  const steps: RestoreStep[] = [];
  fields.forEach((field, index) => {
    const key = keys[index]!;
    if (!isDraftable(field) || !(key in saved)) return;
    const value = saved[key]!;
    const same = isToggle(field) ? field.checked === value : field.value === value;
    if (!same) steps.push({ index, value });
  });
  return steps;
}

/**
 * Screens that already keep their own, more careful drafts (tied to the record version and shift)
 * are left to them, so nothing is offered twice.
 */
export function hasOwnDraft(pathname: string): boolean {
  return pathname.startsWith('/inventory/deliveries') || /\/reconciliations(\/|$)/.test(pathname);
}
