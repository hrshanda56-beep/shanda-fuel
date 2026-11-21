/** Step order and checks for the ZERA return wizard. Pure, so they are tested alone. */

import type { StationZeraDetails } from './zera-licence';
import type { ZeraReturn } from './zera-return';

export type ZeraStep =
  | 'month'
  | 'station'
  | 'holder'
  | 'number'
  | 'ownership'
  | 'province'
  | 'contact'
  | 'ethanol'
  | 'problems'
  | 'notes'
  | 'review'
  | 'done';

export type Errors = Record<string, string>;

/**
 * The questions that apply right now, in order. Licence questions are asked only when the station
 * has no saved answer, so a second month goes straight to the figures. `problems` appears only when
 * something needs the person's attention (a product with no fuel type, or days with no approved report).
 */
export function zeraSteps(input: {
  stationCount: number;
  details: StationZeraDetails | null;
  result: ZeraReturn | null;
  /** Licence questions the person already answered in this session. */
  answered?: Partial<Record<'holder' | 'number' | 'ownership' | 'province' | 'contact', true>>;
  needsEthanol: boolean;
}): ZeraStep[] {
  const steps: ZeraStep[] = ['month'];
  if (input.stationCount > 1) steps.push('station');
  const d = input.details;
  if (d) {
    if (!d.licenceHolder || input.answered?.holder) steps.push('holder');
    if (!d.licenceNumber || input.answered?.number) steps.push('number');
    if (!d.ownership || input.answered?.ownership) steps.push('ownership');
    if (!d.province || input.answered?.province) steps.push('province');
    if (
      !d.representativeName ||
      !d.representativePhone ||
      !d.representativeEmail ||
      input.answered?.contact
    ) {
      steps.push('contact');
    }
  }
  if (input.needsEthanol) steps.push('ethanol');
  if (input.result && (input.result.blockers.length > 0 || input.result.missingDays.length > 0)) {
    steps.push('problems');
  }
  steps.push('notes', 'review');
  return steps;
}

export function checkLicenceHolder(value: string): Errors {
  return value.trim() ? {} : { holder: 'Enter the name exactly as it is on the licence.' };
}

export function checkLicenceNumber(value: string): Errors {
  const text = value.trim();
  if (!text) return { number: 'Enter the licence number.' };
  if (text.length > 60) return { number: 'The licence number is too long.' };
  return {};
}

/** Phone numbers are typed many ways; only reject what cannot be a number. */
export function checkContact(name: string, phone: string, email: string): Errors {
  const errors: Errors = {};
  if (!name.trim()) errors.contactName = 'Enter the name of the person ZERA should contact.';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || !/^[+\d\s()-]+$/.test(phone.trim())) {
    errors.contactPhone = 'Enter a phone number, for example +263 77 123 4567.';
  }
  if (!EMAIL.test(email.trim()) || email.trim().length > 254) {
    errors.contactEmail = 'Enter an email address, for example name@company.com.';
  }
  return errors;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Every licence answer must be present and well formed before a return can be saved. */
export function checkLicenceDetails(details: StationZeraDetails): Errors {
  return {
    ...(details.licenceHolder?.trim() ? {} : checkLicenceHolder('')),
    ...(details.licenceNumber ? checkLicenceNumber(details.licenceNumber) : checkLicenceNumber('')),
    ...(details.ownership ? {} : { ownership: 'Choose one.' }),
    ...(details.province ? {} : { province: 'Choose the province.' }),
    ...checkContact(
      details.representativeName ?? '',
      details.representativePhone ?? '',
      details.representativeEmail ?? '',
    ),
  };
}

/** A month the owner can choose: the last full months, newest first. */
export function recentMonths(today: string, count = 12): { value: string; label: string }[] {
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const [year = 0, month = 1] = today.split('-').map(Number);
  const months: { value: string; label: string }[] = [];
  let y = year;
  let m = month - 1; // the month before the current one: the last full month
  for (let i = 0; i < count; i += 1) {
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    months.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${names[m - 1]} ${y}` });
    m -= 1;
  }
  return months;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "October" for 2026-10. The form asks for the month only, with no year. */
export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? '';
}

/**
 * The fourteen answers exactly as ZERA's form asks them, in the form's own order, for the check
 * screen, the copy buttons, the saved record and the downloads.
 */
export function zeraAnswers(input: {
  /** YYYY-MM */
  month: string;
  details: StationZeraDetails;
  /** The percentage chosen or found; null when there is no petrol to blend, which is written as 0. */
  ethanolPercent: number | null;
  result: ZeraReturn;
  /** What the person typed in the notes step. */
  extraNotes?: string;
}): { label: string; value: string }[] {
  const d = input.details;
  const notes = [...input.result.notes.map((note) => note.text), input.extraNotes?.trim() ?? '']
    .filter(Boolean)
    .join(' ');
  return [
    { label: 'Representative name', value: d.representativeName ?? '' },
    { label: 'Representative phone number', value: d.representativePhone ?? '' },
    { label: 'Representative email address', value: d.representativeEmail ?? '' },
    { label: 'Service station name (as on the ZERA licence)', value: d.licenceHolder ?? '' },
    { label: 'Ownership', value: d.ownership ?? '' },
    { label: 'Licence number', value: d.licenceNumber ?? '' },
    { label: 'Reporting month', value: monthName(input.month) },
    { label: 'Province', value: d.province ?? '' },
    { label: 'Fuel supplied: Diesel 50ppm (litres)', value: input.result.diesel50.supplied },
    { label: 'Fuel supplied: Petrol (litres)', value: input.result.petrol.supplied },
    { label: 'Ethanol blending ratio (%)', value: String(input.ethanolPercent ?? 0) },
    { label: 'Fuel sold: Diesel 50ppm (litres)', value: input.result.diesel50.sold },
    { label: 'Fuel sold: Petrol (litres)', value: input.result.petrol.sold },
    { label: 'Notes (challenges and business issues)', value: notes },
  ];
}

/** The form says to send the return to ZERA by the 3rd. This is the date that means, for the month chosen. */
export function zeraDueDate(month: string): { value: string; label: string } {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMonth = mon === 12 ? 1 : mon + 1;
  return {
    value: `${nextYear}-${String(nextMonth).padStart(2, '0')}-03`,
    label: `3 ${MONTH_NAMES[nextMonth - 1]} ${nextYear}`,
  };
}

/**
 * Text a spreadsheet would run as a formula is defused with a leading apostrophe. Phone numbers and
 * plain numbers keep their leading + or - because they are data, not formulas.
 */
export function neutraliseCell(text: string): string {
  if (/^[=@\t\r]/.test(text)) return `'${text}`;
  if (/^[+-]/.test(text) && !/^[+-]?[\d\s().-]+$/.test(text)) return `'${text}`;
  return text;
}

/** CSV text with every value quoted, so commas and quotes in notes are safe. */
export function zeraCsv(answers: readonly { label: string; value: string }[]): string {
  const quote = (text: string) => `"${neutraliseCell(text).replace(/"/g, '""')}"`;
  return ['Question,Answer', ...answers.map((a) => `${quote(a.label)},${quote(a.value)}`)].join(
    '\r\n',
  );
}
