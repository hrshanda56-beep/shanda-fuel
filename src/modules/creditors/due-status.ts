/**
 * How close a supplier invoice is to its due date. The calendar day comes from the caller (the
 * station or organisation business date), never from the server clock, so a late evening in
 * Harare is not mistaken for tomorrow.
 */

export const DEFAULT_DUE_SOON_DAYS = 7;

export type DueStatus =
  | 'NO_DUE_DATE'
  | 'NOT_DUE'
  | 'DUE_SOON'
  | 'DUE_TODAY'
  | 'OVERDUE_1_7'
  | 'OVERDUE_8_14'
  | 'OVERDUE_15_30'
  | 'OVERDUE_OVER_30';

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Expected a calendar date (YYYY-MM-DD), got "${isoDate}"`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

/** Whole days from `asOf` to `dueDate`; negative once the invoice is late. */
export function daysUntilDue(dueDate: string, asOf: string): number {
  return dayNumber(dueDate) - dayNumber(asOf);
}

export function classifyDueDate(
  dueDate: string | null,
  asOf: string,
  dueSoonDays = DEFAULT_DUE_SOON_DAYS,
): DueStatus {
  if (!dueDate) return 'NO_DUE_DATE';
  const days = daysUntilDue(dueDate, asOf);
  if (days > dueSoonDays) return 'NOT_DUE';
  if (days > 0) return 'DUE_SOON';
  if (days === 0) return 'DUE_TODAY';
  const late = -days;
  if (late <= 7) return 'OVERDUE_1_7';
  if (late <= 14) return 'OVERDUE_8_14';
  if (late <= 30) return 'OVERDUE_15_30';
  return 'OVERDUE_OVER_30';
}

export function isOverdueStatus(status: DueStatus): boolean {
  return status.startsWith('OVERDUE');
}

export const DUE_STATUS_LABELS: Record<DueStatus, string> = {
  NO_DUE_DATE: 'No due date',
  NOT_DUE: 'Not due yet',
  DUE_SOON: 'Due soon',
  DUE_TODAY: 'Due today',
  OVERDUE_1_7: 'Overdue 1 to 7 days',
  OVERDUE_8_14: 'Overdue 8 to 14 days',
  OVERDUE_15_30: 'Overdue 15 to 30 days',
  OVERDUE_OVER_30: 'Overdue over 30 days',
};
