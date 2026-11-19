/** The checks behind the "Enter an expense" and "Add a regular cost" guides. Pure, so they are tested alone. Keys are element ids. */
import { parseAmount } from './ui/expense-format';

export type Errors = Record<string, string>;

/** True when the chosen kind of expense is the catch-all, so the person must say what it is. */
export function isOtherKind(name: string): boolean {
  return /^other\b/i.test(name.trim());
}

export function checkExpenseWhat(categoryId: string, description: string, other = false): Errors {
  const errors: Errors = {};
  if (!categoryId) errors['expense-category'] = 'Choose what kind of expense this is.';
  if (!description.trim())
    errors['expense-description'] = other
      ? 'You chose Other, so say what kind of expense this is.'
      : 'Say what the money was spent on.';
  return errors;
}

export function checkExpenseMoney(
  amount: string,
  date: string,
  stationId: string,
  needsStation: boolean,
): Errors {
  const errors: Errors = {};
  if (!parseAmount(amount)) errors['expense-amount'] = 'Enter the amount spent, for example 25.50.';
  if (!date) errors['expense-date'] = 'Choose the date the money was spent.';
  if (needsStation && !stationId)
    errors['expense-station'] = 'Choose the station that spent the money.';
  return errors;
}

export function checkExpensePaid(
  stationId: string,
  needsStation: boolean,
  method = '',
  other = '',
): Errors {
  const errors: Errors = {};
  if (needsStation && !stationId)
    errors['expense-station'] = 'Choose the station that spent the money.';
  if (method === 'OTHER' && !other.trim())
    errors['expense-payment-other'] = 'You chose Other, so say how it was paid.';
  return errors;
}

export function checkRegularWhat(
  name: string,
  categoryId: string,
  stationId: string,
  other = false,
): Errors {
  const errors: Errors = {};
  if (!name.trim())
    errors['regular-name'] = other
      ? 'You chose Other, so say what this cost is, for example Security guard.'
      : 'Name the cost, for example Rent.';
  if (!categoryId) errors['regular-category'] = 'Choose what kind of expense this is.';
  if (!stationId) errors['regular-station'] = 'Choose the station that pays this cost.';
  return errors;
}

export function checkRegularMoney(amount: string, start: string, end: string): Errors {
  const errors: Errors = {};
  if (!parseAmount(amount)) errors['regular-amount'] = 'Enter the monthly amount, for example 450.';
  if (!start) errors['regular-start'] = 'Choose the date it starts.';
  else if (end && end < start) errors['regular-end'] = 'It cannot stop before it starts.';
  return errors;
}
