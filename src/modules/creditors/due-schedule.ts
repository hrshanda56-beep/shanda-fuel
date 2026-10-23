import Decimal from 'decimal.js';
import { daysUntilDue } from './due-status';

/**
 * What is owed to suppliers, grouped by when it falls due. Pure and exact: balances stay
 * decimal text and are summed with decimal.js, never as JavaScript numbers.
 *
 * "Due in 7 days" means due today up to 7 days from today; "8 to 14" and "15 to 30" follow.
 * Anything already past its due date is "overdue".
 */

export const DUE_BUCKETS = [
  'OVERDUE',
  'WITHIN_7',
  'DAYS_8_TO_14',
  'DAYS_15_TO_30',
  'LATER',
  'NO_DUE_DATE',
] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number];

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  OVERDUE: 'Overdue',
  WITHIN_7: 'Due in the next 7 days',
  DAYS_8_TO_14: 'Due in 8 to 14 days',
  DAYS_15_TO_30: 'Due in 15 to 30 days',
  LATER: 'Due later than 30 days',
  NO_DUE_DATE: 'No due date set',
};

export function bucketForDueDate(dueDate: string | null, asOf: string): DueBucket {
  if (!dueDate) return 'NO_DUE_DATE';
  const days = daysUntilDue(dueDate, asOf);
  if (days < 0) return 'OVERDUE';
  if (days <= 7) return 'WITHIN_7';
  if (days <= 14) return 'DAYS_8_TO_14';
  if (days <= 30) return 'DAYS_15_TO_30';
  return 'LATER';
}

export type DueInvoice = Readonly<{
  documentId: string;
  supplierId: string;
  supplierName: string;
  referenceNumber: string;
  documentDate: string;
  dueDate: string | null;
  paymentTerms: 'CASH' | 'CREDIT' | null;
  creditPeriodDays: number | null;
  /** What is still unpaid on the invoice, as exact decimal text. */
  balance: string;
}>;

export type DueScheduleRow = DueInvoice &
  Readonly<{
    bucket: DueBucket;
    /** Negative when overdue; null without a due date. */
    daysUntilDue: number | null;
  }>;

export type DueScheduleGroup = Readonly<{
  bucket: DueBucket;
  label: string;
  total: string;
  count: number;
  rows: readonly DueScheduleRow[];
}>;

/**
 * Groups unpaid invoices into the buckets above, most urgent first. Each group is ordered by
 * due date then reference. Invoices with nothing left to pay are left out.
 */
export function buildDueSchedule(invoices: readonly DueInvoice[], asOf: string) {
  const rows: DueScheduleRow[] = invoices
    .filter((invoice) => new Decimal(invoice.balance).gt(0))
    .map((invoice) => ({
      ...invoice,
      bucket: bucketForDueDate(invoice.dueDate, asOf),
      daysUntilDue: invoice.dueDate ? daysUntilDue(invoice.dueDate, asOf) : null,
    }));
  const groups: DueScheduleGroup[] = DUE_BUCKETS.map((bucket) => {
    const inBucket = rows
      .filter((row) => row.bucket === bucket)
      .sort(
        (a, b) =>
          (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
          a.referenceNumber.localeCompare(b.referenceNumber),
      );
    const total = inBucket.reduce((sum, row) => sum.plus(row.balance), new Decimal(0));
    return {
      bucket,
      label: DUE_BUCKET_LABELS[bucket],
      total: total.toFixed(4),
      count: inBucket.length,
      rows: inBucket,
    };
  });
  const all = rows.reduce((sum, row) => sum.plus(row.balance), new Decimal(0));
  return { asOf, total: all.toFixed(4), groups };
}
