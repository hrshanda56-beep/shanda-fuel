/**
 * The checks behind the Collect, Receive, Bank and Confirm cash guides. Pure, so they are tested
 * alone. Keys are element ids. Amounts are compared as exact decimals, never as floating point.
 */

export type Errors = Record<string, string>;

const AMOUNT = /^\d+(?:\.\d{1,4})?$/;

/** An amount in ten-thousandths, or null when it is not a plain non-negative number. */
export function scaledAmount(value: string): bigint | null {
  const clean = value.trim().replace(/,/g, '');
  if (!AMOUNT.test(clean)) return null;
  const [whole = '0', fraction = ''] = clean.split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

export function cleanAmount(value: string): string {
  return value.trim().replace(/,/g, '');
}

/** A positive amount that is not more than `max` (when given). `id` is the field the error shows on. */
function checkAmount(id: string, value: string, max?: string): Errors {
  const have = scaledAmount(value);
  if (!value.trim()) return { [id]: 'Enter an amount.' };
  if (have === null) return { [id]: 'Enter the amount as a number, for example 1500 or 1500.50.' };
  if (have <= 0n) return { [id]: 'The amount must be more than zero.' };
  const limit = max === undefined ? null : scaledAmount(max);
  if (limit !== null && have > limit) {
    return { [id]: `That is more than the ${cleanAmount(max ?? '')} available.` };
  }
  return {};
}

/* Collect ---------------------------------------------------------------------- */

export function checkCollectShift(reconciliationId: string): Errors {
  return reconciliationId ? {} : { 'collect-shift': 'Choose the shift the cash is from.' };
}

export function checkCollectWhere(locationId: string): Errors {
  return locationId ? {} : { 'collect-where': 'Choose where the cash is now.' };
}

export function checkCollectAmount(amount: string, available: string): Errors {
  return checkAmount('collect-amount', amount, available);
}

export function checkCollectReference(reference: string): Errors {
  return reference.trim() ? {} : { 'collect-reference': 'Enter a reference for this collection.' };
}

/* Receive ---------------------------------------------------------------------- */

export function checkReceiveCash(collectionId: string): Errors {
  return collectionId ? {} : { 'receive-cash': 'Choose the cash that arrived.' };
}

export function checkReceiveWhere(locationId: string): Errors {
  return locationId ? {} : { 'receive-where': 'Choose where it arrived.' };
}

/* Bank ------------------------------------------------------------------------- */

export function checkBankAccountPick(bankAccountId: string): Errors {
  return bankAccountId ? {} : { 'bank-account': 'Choose the bank account.' };
}

export function checkBankFrom(locationId: string): Errors {
  return locationId ? {} : { 'bank-from': 'Choose where the cash is being taken from.' };
}

export type BankLine = { collectionId: string; amount: string };

/** One cash line: a collection and how much of it goes to the bank. `available` is that cash's balance. */
export function checkBankLine(line: BankLine, available: string): Errors {
  if (!line.collectionId) return { 'bank-cash': 'Choose the cash being banked.' };
  const found = checkAmount('bank-amount', line.amount, available);
  return found;
}

/** The same cash cannot be listed twice in one deposit. */
export function checkBankLinesDistinct(lines: readonly BankLine[]): Errors {
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.collectionId)) {
      return { 'bank-cash': 'That cash is already in this deposit. Choose a different one.' };
    }
    seen.add(line.collectionId);
  }
  return {};
}

export function checkBankReference(reference: string): Errors {
  return reference.trim()
    ? {}
    : { 'bank-reference': 'Enter the deposit reference, for example from the deposit slip.' };
}

/* Confirm a deposit ------------------------------------------------------------ */

export function checkConfirmAmount(amount: string): Errors {
  return checkAmount('confirm-amount', amount);
}

/** True when the bank's amount is a valid number that differs from the deposit. */
export function confirmDiffers(deposited: string, shown: string): boolean {
  const a = scaledAmount(deposited);
  const b = scaledAmount(shown);
  return a !== null && b !== null && a !== b;
}

export function checkConfirmReference(reference: string): Errors {
  return reference.trim() ? {} : { 'confirm-reference': 'Enter the reference the bank shows.' };
}

export function checkConfirmDate(date: string, today: string): Errors {
  if (!date) return {};
  return date > today ? { 'confirm-date': 'The date cannot be in the future.' } : {};
}

export function checkConfirmReason(deposited: string, shown: string, reason: string): Errors {
  if (!confirmDiffers(deposited, shown)) return {};
  return reason.trim().length >= 3
    ? {}
    : { 'confirm-reason': 'Say why the bank shows a different amount.' };
}
