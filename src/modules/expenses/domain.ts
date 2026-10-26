import Decimal from 'decimal.js';
import { AppError } from '../../platform/errors';
import { ExactDecimal, money, type Money } from '../../platform/domain/primitives';

/**
 * Expense domain rules. Pure and side-effect free.
 *
 * Expenses are their own domain: recognition (cost incurred) is separate from settlement
 * (how it was paid), and neither writes cash, bank, supplier, or customer ledgers.
 */

export const EXPENSE_CATEGORY_CLASSIFICATIONS = [
  'OPERATING',
  'FIXED_COST',
  'DIRECT_INVENTORY_COST',
] as const;
export type ExpenseCategoryClassification = (typeof EXPENSE_CATEGORY_CLASSIFICATIONS)[number];

export const EXPENSE_STATES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'REVERSED'] as const;
export type ExpenseState = (typeof EXPENSE_STATES)[number];

export const SETTLEMENT_SOURCES = ['CASH', 'BANK', 'REIMBURSEMENT', 'MOBILE_MONEY'] as const;
export type SettlementSource = (typeof SETTLEMENT_SOURCES)[number];

export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

const expenseTransitions: Readonly<Record<ExpenseState, readonly ExpenseState[]>> = {
  SUBMITTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['POSTED'],
  REJECTED: [],
  POSTED: ['REVERSED'],
  REVERSED: [],
};

export function assertExpenseTransition(from: ExpenseState, to: ExpenseState): void {
  if (!expenseTransitions[from]?.includes(to)) {
    throw new AppError('CONFLICT', `An expense in state ${from} cannot move to ${to}`, {
      from,
      to,
    });
  }
}

export function isValidBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function assertBusinessDate(value: string, field: string): string {
  if (!isValidBusinessDate(value)) {
    throw new AppError('VALIDATION_FAILED', `${field} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

/** Strictly positive exact money with at most four fractional digits. */
export function positiveMoney(value: string, field = 'amount'): Money {
  let parsed: Money;
  try {
    parsed = money(value, 'USD');
  } catch {
    throw new AppError('VALIDATION_FAILED', `${field} must be an exact decimal with 4 decimals`);
  }
  if (parsed.amount.value.lte(0)) {
    throw new AppError('VALIDATION_FAILED', `${field} must be greater than zero`);
  }
  return parsed;
}

export type ExpensePolicy = Readonly<{
  stepUpThreshold: string | null;
  secondApprovalThreshold: string | null;
}>;

/** No configured policy is the most restrictive policy: every approval needs step-up. */
export const UNCONFIGURED_EXPENSE_POLICY: ExpensePolicy = {
  stepUpThreshold: null,
  secondApprovalThreshold: null,
};

export function validateExpensePolicy(input: ExpensePolicy): ExpensePolicy {
  const stepUp = input.stepUpThreshold === null ? null : new ExactDecimal(input.stepUpThreshold);
  const second =
    input.secondApprovalThreshold === null ? null : new ExactDecimal(input.secondApprovalThreshold);
  for (const [value, field] of [
    [stepUp, 'stepUpThreshold'],
    [second, 'secondApprovalThreshold'],
  ] as const) {
    if (value && value.value.decimalPlaces() > 4) {
      throw new AppError('VALIDATION_FAILED', `${field} allows at most 4 decimals`);
    }
  }
  if (stepUp && stepUp.value.lt(0)) {
    throw new AppError('VALIDATION_FAILED', 'stepUpThreshold cannot be negative');
  }
  if (second && second.value.lte(0)) {
    throw new AppError('VALIDATION_FAILED', 'secondApprovalThreshold must be positive');
  }
  if (stepUp && second && second.value.lt(stepUp.value)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'secondApprovalThreshold cannot be lower than stepUpThreshold',
    );
  }
  return {
    stepUpThreshold: stepUp ? stepUp.value.toFixed(4) : null,
    secondApprovalThreshold: second ? second.value.toFixed(4) : null,
  };
}

/** Step-up is required at or above the threshold, and always when no threshold is configured. */
export function expenseRequiresStepUp(amount: string, policy: ExpensePolicy): boolean {
  if (policy.stepUpThreshold === null) return true;
  return new Decimal(amount).gte(new Decimal(policy.stepUpThreshold));
}

/** A second approver is only demanded when a second-approval threshold is configured. */
export function requiredApprovals(amount: string, policy: ExpensePolicy): 1 | 2 {
  if (policy.secondApprovalThreshold === null) return 1;
  return new Decimal(amount).gte(new Decimal(policy.secondApprovalThreshold)) ? 2 : 1;
}

export type ExpenseSubmission = Readonly<{
  expenseDate: string;
  description: string;
  payee?: string;
  reference?: string;
  amount: string;
}>;

export function validateExpenseSubmission(
  input: ExpenseSubmission,
  now: Date = new Date(),
): {
  expenseDate: string;
  description: string;
  payee: string | null;
  reference: string | null;
  amount: Money;
} {
  assertBusinessDate(input.expenseDate, 'expenseDate');
  // One day of slack covers stations ahead of UTC; later dates cannot be recognized yet.
  const latest = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (input.expenseDate > latest) {
    throw new AppError('VALIDATION_FAILED', 'An expense cannot be dated in the future');
  }
  const description = input.description.trim();
  if (!description) throw new AppError('VALIDATION_FAILED', 'A description is required');
  return {
    expenseDate: input.expenseDate,
    description,
    payee: input.payee?.trim() || null,
    reference: input.reference?.trim() || null,
    amount: positiveMoney(input.amount),
  };
}

/** Direct inventory costs are landed cost; they must never also be deducted as expense. */
export function assertCategoryUsableForExpense(
  classification: ExpenseCategoryClassification,
  usage: 'MANUAL_EXPENSE' | 'RECURRING_COST',
): void {
  if (classification === 'DIRECT_INVENTORY_COST') {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Direct inventory cost is recorded through landed cost, not as an operating expense',
    );
  }
  if (usage === 'MANUAL_EXPENSE' && classification !== 'OPERATING') {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Manual expenses require an operating category; fixed costs use recurring costs',
    );
  }
  if (usage === 'RECURRING_COST' && classification !== 'FIXED_COST') {
    throw new AppError('INVARIANT_VIOLATION', 'Recurring costs require a fixed-cost category');
  }
}

/**
 * The submitter may not approve their own expense unless no one else could. The caller supplies
 * whether another active approver exists for the station.
 */
export function assertApproverAllowed(input: {
  submitterMembershipId: string;
  approverMembershipId: string;
  alternateApproverExists: boolean;
  priorApproverIds: readonly string[];
}): void {
  if (input.priorApproverIds.includes(input.approverMembershipId)) {
    throw new AppError('CONFLICT', 'This approver has already decided on the expense');
  }
  if (input.submitterMembershipId === input.approverMembershipId && input.alternateApproverExists) {
    throw new AppError(
      'FORBIDDEN',
      'An expense cannot be approved by the person who submitted it while another approver exists',
    );
  }
}

export function assertSettlementReference(input: {
  source: SettlementSource;
  cashMovementId?: string | null;
  externalReference?: string | null;
}): void {
  const hasReference = Boolean(input.externalReference?.trim());
  if (input.cashMovementId && input.source !== 'CASH') {
    throw new AppError('VALIDATION_FAILED', 'Only cash settlements can link a cash movement');
  }
  if (!input.cashMovementId && !hasReference) {
    throw new AppError(
      'VALIDATION_FAILED',
      'A settlement needs a cash movement link or an external reference',
    );
  }
}

export function sumMoney(values: readonly string[]): string {
  return values.reduce((total, value) => total.add(new Decimal(value)), new Decimal(0)).toFixed(4);
}

export function outstandingAmount(total: string, settled: readonly string[]): string {
  return new Decimal(total).sub(new Decimal(sumMoney(settled))).toFixed(4);
}

export function assertSettlementWithinOutstanding(
  total: string,
  settled: readonly string[],
  requested: string,
): void {
  if (new Decimal(requested).gt(new Decimal(outstandingAmount(total, settled)))) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The settlement exceeds the outstanding balance of this obligation',
      { outstanding: outstandingAmount(total, settled) },
    );
  }
}

export function paymentStatus(total: string, settled: readonly string[]): PaymentStatus {
  const paid = new Decimal(sumMoney(settled));
  if (paid.lte(0)) return 'UNPAID';
  return paid.gte(new Decimal(total)) ? 'PAID' : 'PARTIALLY_PAID';
}

export type MonthPeriod = Readonly<{ start: string; end: string; days: number }>;

/** Recurring costs are calendar months; the period must start on the first day. */
export function monthPeriod(periodStart: string): MonthPeriod {
  assertBusinessDate(periodStart, 'periodStart');
  if (!periodStart.endsWith('-01')) {
    throw new AppError('VALIDATION_FAILED', 'periodStart must be the first day of a month');
  }
  const [year, month] = periodStart.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: periodStart,
    end: `${periodStart.slice(0, 8)}${String(days).padStart(2, '0')}`,
    days,
  };
}

/**
 * Exact daily split of a period obligation. Every day gets the amount rounded down to four
 * decimals and the last day takes the remainder, so the schedule always sums exactly.
 */
export function dailyRecognitionSchedule(amount: string, days: number): string[] {
  if (!Number.isInteger(days) || days < 1) {
    throw new AppError('VALIDATION_FAILED', 'A period needs at least one day');
  }
  const total = new Decimal(amount);
  const base = total.div(days).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  const schedule = Array.from({ length: days }, () => base.toFixed(4));
  schedule[days - 1] = total.sub(base.mul(days - 1)).toFixed(4);
  return schedule;
}

export function recognitionAmountForDate(
  amount: string,
  period: MonthPeriod,
  recognitionDate: string,
): string {
  assertBusinessDate(recognitionDate, 'recognitionDate');
  if (recognitionDate < period.start || recognitionDate > period.end) {
    throw new AppError('VALIDATION_FAILED', 'The recognition date is outside the period');
  }
  const dayIndex = Number(recognitionDate.slice(8, 10)) - 1;
  return dailyRecognitionSchedule(amount, period.days)[dayIndex]!;
}

export function assertRecognitionNotFuture(recognitionDate: string, now: Date = new Date()): void {
  const today = now.toISOString().slice(0, 10);
  if (recognitionDate > today) {
    throw new AppError('VALIDATION_FAILED', 'Cost cannot be recognized for a future date');
  }
}

export function assertPeriodWithinTemplate(
  period: MonthPeriod,
  template: { startDate: string; endDate: string | null },
): void {
  if (period.end < template.startDate) {
    throw new AppError('VALIDATION_FAILED', 'The period ends before the template starts');
  }
  if (template.endDate !== null && period.start > template.endDate) {
    throw new AppError('VALIDATION_FAILED', 'The period starts after the template ended');
  }
}
