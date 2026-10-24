import { AppError } from '../../platform/errors';

/**
 * Cash or credit on a supplier invoice, and the due date that follows from a credit period.
 *
 * The due date of a credit purchase is the invoice date plus the agreed number of days. Dates
 * are plain calendar days (YYYY-MM-DD) and the arithmetic is done in UTC on the date alone, so
 * no clock or time zone can move the result by a day.
 *
 * A supplier invoice must say Cash or Credit. Credit notes carry no terms and keep an optional
 * typed due date.
 */

export const PAYMENT_TERMS = ['CASH', 'CREDIT'] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

export const MAX_CREDIT_PERIOD_DAYS = 365;

export type CreditTermsInput = Readonly<{
  documentType: 'INVOICE' | 'CREDIT_NOTE';
  documentDate: string;
  paymentTerms?: string | null | undefined;
  creditPeriodDays?: number | null | undefined;
  dueDate?: string | null | undefined;
}>;

export type ResolvedCreditTerms = Readonly<{
  paymentTerms: PaymentTerms | null;
  creditPeriodDays: number | null;
  dueDate: string | undefined;
}>;

function bad(message: string): never {
  throw new AppError('VALIDATION_FAILED', message);
}

function dayNumber(isoDate: string, label: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return bad(`${label} must be a calendar date (YYYY-MM-DD).`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const value = Date.UTC(year, month - 1, day);
  const check = new Date(value);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return bad(`${label} is not a real calendar date.`);
  }
  return value / 86_400_000;
}

/** The calendar date `days` after `isoDate`. */
export function addDaysToDate(isoDate: string, days: number): string {
  if (!Number.isInteger(days)) bad('A number of days must be a whole number.');
  const next = new Date((dayNumber(isoDate, 'The date') + days) * 86_400_000);
  return next.toISOString().slice(0, 10);
}

/** Invoice date plus the credit period: the date payment falls due. */
export function calculateDueDate(invoiceDate: string, creditPeriodDays: number): string {
  if (
    !Number.isInteger(creditPeriodDays) ||
    creditPeriodDays < 0 ||
    creditPeriodDays > MAX_CREDIT_PERIOD_DAYS
  ) {
    bad(`The credit period must be a whole number of days from 0 to ${MAX_CREDIT_PERIOD_DAYS}.`);
  }
  return addDaysToDate(invoiceDate, creditPeriodDays);
}

export function isPaymentTerms(value: unknown): value is PaymentTerms {
  return typeof value === 'string' && (PAYMENT_TERMS as readonly string[]).includes(value);
}

/**
 * Applies the cash/credit rules and returns the terms to store. A credit invoice needs a credit
 * period or a due date; when a period is given the due date is always calculated from it.
 */
export function resolveCreditTerms(input: CreditTermsInput): ResolvedCreditTerms {
  const terms = input.paymentTerms ?? null;
  const period = input.creditPeriodDays ?? null;
  const typedDue = input.dueDate ?? undefined;

  if (terms === null) {
    if (period !== null) bad('Choose "Credit" to set a credit period.');
    // Owner default: an invoice must say cash or credit, so a credit purchase can never lose its due date.
    if (input.documentType === 'INVOICE') bad('Choose Cash or Credit for this supplier invoice.');
    return { paymentTerms: null, creditPeriodDays: null, dueDate: typedDue };
  }
  if (!isPaymentTerms(terms)) bad('Payment terms must be Cash or Credit.');
  if (input.documentType !== 'INVOICE') {
    bad('Cash or credit terms belong on supplier invoices, not credit notes.');
  }
  if (terms === 'CASH') {
    if (period !== null || typedDue !== undefined) {
      bad('A cash purchase has no credit period or due date. Remove them or choose Credit.');
    }
    return { paymentTerms: 'CASH', creditPeriodDays: null, dueDate: undefined };
  }
  if (period === null && typedDue === undefined) {
    bad('A credit purchase needs a credit period (in days) or a due date.');
  }
  if (period === null) {
    dayNumber(typedDue as string, 'The due date');
    return { paymentTerms: 'CREDIT', creditPeriodDays: null, dueDate: typedDue };
  }
  const calculated = calculateDueDate(input.documentDate, period);
  if (typedDue !== undefined && typedDue !== calculated) {
    bad(
      `The due date ${typedDue} does not match the credit period: ${period} days after ${input.documentDate} is ${calculated}. Remove the due date and it will be worked out for you.`,
    );
  }
  return { paymentTerms: 'CREDIT', creditPeriodDays: period, dueDate: calculated };
}
