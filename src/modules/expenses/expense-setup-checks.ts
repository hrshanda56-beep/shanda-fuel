/**
 * The checks behind the "Manage categories" and "Approval limits" guides. Pure, so they are tested
 * alone. Keys are element ids.
 */
import { categoryCodeFromName, parseAmount } from './ui/expense-format';
import { formatMoney } from '@/design-system/formatters';

export type Errors = Record<string, string>;

/** A new kind of expense needs a name that makes a code and is not already in the list. */
export function checkCategoryName(name: string, existingNames: readonly string[]): Errors {
  const text = name.trim();
  if (!text || !categoryCodeFromName(text)) {
    return { 'new-category': 'Type a name for the kind of expense, for example Repairs.' };
  }
  const taken = existingNames.some(
    (existing) => existing.trim().toLowerCase() === text.toLowerCase(),
  );
  if (taken) return { 'new-category': `“${text}” is already in the list.` };
  return {};
}

export type LimitKey = 'stepUp' | 'second' | 'supervisor';

export const OTHER = 'other';
export const NONE = 'none';

/** The usual answers for each limit. "none" means the box is left empty. */
export const LIMIT_CHOICES: Record<
  LimitKey,
  { none: string; amounts: readonly string[]; sentence: (amount: string) => string }
> = {
  stepUp: {
    none: 'Always, whatever the amount',
    amounts: ['100', '500', '1000'],
    sentence: (amount) => `Above ${formatMoney(amount)}`,
  },
  second: {
    none: 'Never, whatever the amount',
    amounts: ['500', '1000', '5000'],
    sentence: (amount) => `Above ${formatMoney(amount)}`,
  },
  supervisor: {
    none: 'A supervisor cannot approve expenses',
    amounts: ['50', '100', '500'],
    sentence: (amount) => `Up to ${formatMoney(amount)}`,
  },
};

export function limitChoices(key: LimitKey): Array<{ value: string; label: string }> {
  const { none, amounts, sentence } = LIMIT_CHOICES[key];
  return [
    { value: NONE, label: none },
    ...amounts.map((amount) => ({ value: amount, label: sentence(amount) })),
    { value: OTHER, label: 'Another amount' },
  ];
}

/** Which ready-made answer a stored value amounts to. */
export function currentLimitChoice(key: LimitKey, value: string | null): string {
  const text = (value ?? '').trim();
  if (!text) return NONE;
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return LIMIT_CHOICES[key].amounts.includes(trimmed) ? trimmed : OTHER;
}

const MESSAGES: Record<LimitKey, string> = {
  stepUp: 'Enter an amount like 500.',
  second: 'Enter an amount like 1000.',
  supervisor: 'Enter an amount like 100.',
};

const IDS: Record<LimitKey, string> = {
  stepUp: 'limit-first',
  second: 'limit-second',
  supervisor: 'limit-supervisor',
};

export function limitFieldId(key: LimitKey): string {
  return IDS[key];
}

/** Empty is allowed (no limit); anything else must be a plain amount. */
export function checkLimit(key: LimitKey, value: string): Errors {
  if (!value.trim()) return {};
  return parseAmount(value) ? {} : { [IDS[key]]: MESSAGES[key] };
}

/** What goes to the server: an exact amount, or null for "no limit". */
export function limitToSend(value: string): string | null {
  return value.trim() === '' ? null : parseAmount(value);
}
