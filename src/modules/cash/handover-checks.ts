/** The checks behind the "Hand over cash" guide. Pure, so they are tested alone. Keys are element ids. */

export type Errors = Record<string, string>;

const AMOUNT = /^\d+(?:\.\d{1,2})?$/;

export function checkHandoverFrom(fromId: string): Errors {
  return fromId ? {} : { 'ho-from': 'Choose where the cash is now.' };
}

export function checkHandoverTo(fromId: string, toId: string): Errors {
  if (!toId) return { 'ho-to': 'Choose who or where the cash is going to.' };
  if (toId === fromId) return { 'ho-to': 'Choose a different place from where it is coming from.' };
  return {};
}

/** What should be handed over must be more than nothing; what was counted may be zero. */
export function checkHandoverAmounts(expected: string, counted: string): Errors {
  const errors: Errors = {};
  const want = expected.trim();
  const have = counted.trim();
  if (!want) errors['ho-expected'] = 'Enter the amount that should be handed over.';
  else if (!AMOUNT.test(want)) {
    errors['ho-expected'] = 'Enter the amount as a number, for example 1500 or 1500.50.';
  } else if (Number(want) <= 0) {
    errors['ho-expected'] = 'The amount that should be handed over must be more than zero.';
  }
  if (!have) errors['ho-counted'] = 'Enter the amount you actually counted.';
  else if (!AMOUNT.test(have)) {
    errors['ho-counted'] = 'Enter the amount as a number, for example 1500 or 1500.50.';
  }
  return errors;
}

/** True when both amounts are valid numbers that differ, so the receiver needs a reason. */
export function handoverDiffers(expected: string, counted: string): boolean {
  if (!AMOUNT.test(expected.trim()) || !AMOUNT.test(counted.trim())) return false;
  return Number(expected) !== Number(counted);
}

export function checkHandoverReason(expected: string, counted: string, reason: string): Errors {
  if (!handoverDiffers(expected, counted)) return {};
  return reason.trim().length >= 3
    ? {}
    : { 'ho-reason': 'Say why the amounts are different, so the other person understands.' };
}
