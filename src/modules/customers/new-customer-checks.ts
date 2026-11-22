/** The checks behind the "Add a customer" guide. Pure, so they are tested alone. Keys are element ids. */

export type Errors = Record<string, string>;
export type CustomerKind = 'CREDIT' | 'PREPAID_VALUE' | 'PREPAID_LITRES' | 'STAFF';

const POSITIVE_MONEY = /^(?!0+(?:\.0+)?$)\d{1,16}(?:\.\d{1,2})?$/;

export function checkCustomerName(
  kind: CustomerKind | '',
  name: string,
  staffName: string,
): Errors {
  if (kind === 'STAFF') {
    return staffName.trim() ? {} : { 'add-customer-staff': 'Enter the staff member’s name.' };
  }
  return name.trim() ? {} : { 'add-customer-name': 'Enter the customer’s name.' };
}

/** Credit and staff accounts need a limit; credit may also have a usual number of days to pay. */
export function checkCustomerTerms(kind: CustomerKind | '', limit: string, days: string): Errors {
  const errors: Errors = {};
  if ((kind === 'CREDIT' || kind === 'STAFF') && !POSITIVE_MONEY.test(limit.trim())) {
    errors['add-customer-limit'] =
      kind === 'STAFF'
        ? 'Enter the monthly limit in US dollars, for example 60 or 60.50.'
        : 'Enter the most this customer may owe, for example 1000.';
  }
  if (kind === 'CREDIT' && days.trim()) {
    if (!/^\d{1,3}$/.test(days.trim())) {
      errors['add-customer-days'] =
        'Enter the usual days to pay as a whole number, for example 30.';
    } else if (Number(days.trim()) > 365) {
      errors['add-customer-days'] = 'The usual days to pay cannot be more than 365.';
    }
  }
  return errors;
}

/** True when the chosen kind has terms to ask for. */
export function kindNeedsTerms(kind: CustomerKind | ''): boolean {
  return kind === 'CREDIT' || kind === 'STAFF';
}
