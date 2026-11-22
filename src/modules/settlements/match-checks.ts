/**
 * The checks behind the "Match a payment" guide. Pure, so they are tested alone. Keys are element
 * ids. Amounts are compared as exact decimals, never as floating point.
 */

export type Errors = Record<string, string>;

const AMOUNT = /^\d+(?:\.\d{1,4})?$/;

/** An amount in ten-thousandths, or null when it is not a plain non-negative number. */
function scaled(value: string): bigint | null {
  const clean = value.trim();
  if (!AMOUNT.test(clean)) return null;
  const [whole = '0', fraction = ''] = clean.split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

export function checkMatchPayout(settlementId: string): Errors {
  return settlementId ? {} : { settlement: 'Choose the provider payout.' };
}

export function checkMatchPayment(paymentId: string): Errors {
  return paymentId ? {} : { payment: 'Choose the customer payment.' };
}

/** More than nothing, and no more than `max` (the smaller of what is left on the payment and the payout). */
export function checkMatchAmount(amount: string, max: string | null): Errors {
  const have = scaled(amount);
  if (!amount.trim()) return { 'allocation-amount': 'Enter the amount to match.' };
  if (have === null) {
    return { 'allocation-amount': 'Enter the amount as a number, for example 120 or 120.50.' };
  }
  if (have <= 0n) return { 'allocation-amount': 'The amount must be more than zero.' };
  const limit = max === null ? null : scaled(max);
  if (limit !== null && have > limit) {
    return { 'allocation-amount': `You can match at most ${max}.` };
  }
  return {};
}
