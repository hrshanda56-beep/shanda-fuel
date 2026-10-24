/**
 * Staff fuel benefit (S13). A staff benefit account is an ordinary credit account with a limit
 * per period. PROPOSED default (docs/DECISIONS.md, awaiting owner sign-off): the period is a
 * calendar month and the limit is in USD. The limit is the account's credit limit, so it can
 * only change through the credit-limit override approval flow.
 *
 * Pure and exact: amounts are decimal strings, dates are station business dates
 * ("YYYY-MM-DD"), never browser time. A litre limit is not built.
 */
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import { AppError } from '../../platform/errors';

export const STAFF_BENEFIT_LABEL = 'Staff fuel benefit';

export type StaffBenefitLine = Readonly<{
  id: string;
  direction: 'INCREASE' | 'DECREASE';
  entryType: string;
  businessDate: string;
  amount: string;
  reversalOfEntryId?: string | null;
}>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** First day of the calendar month the business date falls in. */
export function periodStart(businessDate: string): string {
  const match = DATE.exec(businessDate);
  if (!match) throw new Error(`Not a business date: ${businessDate}`);
  return `${match[1]}-${match[2]}-01`;
}

/** Last day of that month (the period is inclusive of both ends). */
export function periodEnd(businessDate: string): string {
  const match = DATE.exec(businessDate);
  if (!match) throw new Error(`Not a business date: ${businessDate}`);
  const last = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(last).padStart(2, '0')}`;
}

/**
 * What the staff member has taken in the period that contains `asAt`: charges (and upward
 * adjustments) dated in the period, minus any that were reversed. Payments do not give the
 * allowance back; the allowance is for the period.
 */
export function staffBenefitPeriodSpend(
  lines: readonly StaffBenefitLine[],
  asAt: string,
): ExactDecimal {
  const start = periodStart(asAt);
  const end = periodEnd(asAt);
  const reversed = new Set(
    lines.filter((line) => line.reversalOfEntryId).map((line) => line.reversalOfEntryId as string),
  );
  return lines
    .filter(
      (line) =>
        line.direction === 'INCREASE' &&
        line.businessDate >= start &&
        line.businessDate <= end &&
        !reversed.has(line.id),
    )
    .reduce((sum, line) => sum.add(new ExactDecimal(line.amount)), new ExactDecimal('0'));
}

export type StaffBenefitUse = Readonly<{
  periodStart: string;
  periodEnd: string;
  limit: string;
  spent: string;
  remaining: string;
  over: boolean;
}>;

const money = (value: ExactDecimal) =>
  value.quantize(DECIMAL_POLICIES.money).value.toFixed(DECIMAL_POLICIES.money.scale);

export function staffBenefitUse(
  limit: string,
  lines: readonly StaffBenefitLine[],
  asAt: string,
): StaffBenefitUse {
  const cap = new ExactDecimal(limit);
  const spent = staffBenefitPeriodSpend(lines, asAt);
  const remaining = cap.subtract(spent);
  return {
    periodStart: periodStart(asAt),
    periodEnd: periodEnd(asAt),
    limit: money(cap),
    spent: money(spent),
    remaining: money(remaining.value.isNegative() ? new ExactDecimal('0') : remaining),
    over: spent.value.gt(cap.value),
  };
}

/** Stops a new request that would take the staff member past the limit for the month. */
export function assertWithinStaffBenefitLimit(input: {
  limit: string;
  lines: readonly StaffBenefitLine[];
  asAt: string;
  alreadyReserved: ExactDecimal;
  requested: ExactDecimal;
}): void {
  const spent = staffBenefitPeriodSpend(input.lines, input.asAt);
  if (
    spent
      .add(input.alreadyReserved)
      .add(input.requested)
      .value.gt(new ExactDecimal(input.limit).value)
  ) {
    throw new AppError(
      'CONFLICT',
      'This would take the staff member past their fuel benefit for this month. Lower the amount, or ask an owner or administrator to change the limit.',
    );
  }
}
