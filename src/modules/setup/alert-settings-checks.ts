/** The checks behind the Reminders guide. Pure, so they are tested alone. Keys are element ids. */

export type Errors = Record<string, string>;

export type ReminderSetting = 'dueSoon' | 'posLag' | 'grace' | 'minimum';

/** The usual answers offered for each setting; anything else is typed under "Another number". */
export const REMINDER_CHOICES: Readonly<Record<ReminderSetting, readonly string[]>> = {
  dueSoon: ['3', '7', '14', '30'],
  posLag: ['1', '2', '3', '7'],
  grace: ['0', '1', '2', '3'],
  minimum: ['0', '1', '5', '10'],
};

export const OTHER = 'other';

/** Which choice is showing for a value: one of the usual answers, or "other" with the value typed. */
export function choiceFor(setting: ReminderSetting, value: string): string {
  const clean = value.trim();
  return REMINDER_CHOICES[setting].includes(clean) ? clean : OTHER;
}

function wholeDays(id: string, value: string, min: number, max: number, what: string): Errors {
  const text = value.trim();
  if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) {
    return { [id]: `${what}: enter a number of days from ${min} to ${max}.` };
  }
  return {};
}

export function checkDueSoon(value: string): Errors {
  return wholeDays('alert-due-soon', value, 1, 60, 'Invoices due soon');
}

export function checkPosLag(value: string): Errors {
  return wholeDays('alert-pos-lag', value, 0, 30, 'Card and mobile payments');
}

export function checkGrace(value: string): Errors {
  return wholeDays('alert-grace', value, 0, 14, 'Daily reports');
}

export function cleanMinimum(value: string): string {
  return value.trim().replace(/,/g, '');
}

export function checkMinimum(value: string): Errors {
  return /^\d+(?:\.\d{1,4})?$/.test(cleanMinimum(value))
    ? {}
    : { 'alert-cash-minimum': 'Cash shortage: enter an amount such as 5.' };
}

/** "1 day" or "7 days", for the current-settings list. */
export function daysLabel(value: number | string): string {
  const n = Number(value);
  return n === 1 ? '1 day' : `${n} days`;
}
