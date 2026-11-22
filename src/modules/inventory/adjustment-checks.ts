/** The checks behind the "Correct stock" guide. Pure, so they are tested alone. Keys are element ids. */

export type Errors = Record<string, string>;

export type AdjustmentDirection = 'POSITIVE_ADJUSTMENT' | 'NEGATIVE_ADJUSTMENT';

const QUANTITY = /^\d+(?:\.\d{1,3})?$/;

export function checkAdjustmentDirection(direction: AdjustmentDirection | null): Errors {
  return direction ? {} : { 'adj-direction-POSITIVE_ADJUSTMENT': 'Choose add or take away.' };
}

/** The amount must be a number above zero; taking away more than the books hold is refused. */
export function checkAdjustmentQuantity(
  quantity: string,
  direction: AdjustmentDirection | null,
  bookQuantity: string,
  unitWord: string,
): Errors {
  const value = quantity.trim();
  if (!value) return { 'adj-quantity': `Enter how many ${unitWord}.` };
  if (!QUANTITY.test(value)) {
    return { 'adj-quantity': 'Enter a number, for example 250 or 250.5.' };
  }
  if (Number(value) <= 0) return { 'adj-quantity': 'The amount must be more than zero.' };
  if (direction === 'NEGATIVE_ADJUSTMENT' && Number(value) > Number(bookQuantity)) {
    return { 'adj-quantity': `The books only hold ${bookQuantity} ${unitWord}.` };
  }
  return {};
}

export function checkAdjustmentReason(reason: string): Errors {
  return reason.trim().length >= 3
    ? {}
    : { 'adj-reason': 'Say why the stock is being corrected, so others understand.' };
}

/** What the books will hold afterwards, shown on the check screen. */
export function stockAfterAdjustment(
  bookQuantity: string,
  quantity: string,
  direction: AdjustmentDirection,
): number {
  const sign = direction === 'POSITIVE_ADJUSTMENT' ? 1 : -1;
  return Math.round((Number(bookQuantity) + sign * Number(quantity)) * 1000) / 1000;
}
