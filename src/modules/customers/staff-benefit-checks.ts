/** The checks behind the "Add a staff member" guide. Pure, so they are tested alone. Keys are element ids. */

export type Errors = Record<string, string>;

/** The monthly limit most staff get. Offered as the usual answer; anything else is typed. */
export const USUAL_MONTHLY_LIMIT = '60';

const POSITIVE_MONEY = /^(?!0+(?:\.0+)?$)\d{1,16}(?:\.\d{1,2})?$/;

export function checkStaffMember(membershipId: string): Errors {
  return membershipId ? {} : { 'staff-member': 'Choose a staff member.' };
}

export function cleanLimit(value: string): string {
  return value.trim().replace(/,/g, '');
}

export function checkMonthlyLimit(value: string): Errors {
  return POSITIVE_MONEY.test(cleanLimit(value))
    ? {}
    : { 'staff-limit': 'Enter the monthly limit in US dollars, for example 60 or 60.50.' };
}
