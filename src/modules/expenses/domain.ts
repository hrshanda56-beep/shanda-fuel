import { AppError } from '../../platform/errors';
import {
  ExactDecimal,
  businessDate,
  money,
  type BusinessDate,
  type CurrencyCode,
  type Money,
} from '../../platform/domain/primitives';

export const EXPENSE_STATES = [
  'DRAFT',
  'SUBMITTED',
  'RETURNED',
  'APPROVED',
  'REJECTED',
  'POSTED',
  'REVERSED',
] as const;
export type ExpenseState = (typeof EXPENSE_STATES)[number];

/**
 * These are intentionally broad, policy-neutral classifications. A tenant's
 * category/master data can sit above them without changing the accounting
 * boundary represented here.
 */
export const EXPENSE_CLASSIFICATIONS = [
  'OPERATING_EXPENSE',
  'DIRECT_INVENTORY_COST',
  'RECURRING_FIXED_COST',
] as const;
export type ExpenseClassification = (typeof EXPENSE_CLASSIFICATIONS)[number];

/** Settlement is a separate effect from recognizing the economic expense. */
export const EXPENSE_SETTLEMENT_SOURCES = ['CASH', 'BANK', 'PAYABLE', 'REIMBURSEMENT'] as const;
export type ExpenseSettlementSource = (typeof EXPENSE_SETTLEMENT_SOURCES)[number];

/**
 * A recurring rule is configuration, not an accounting posting. It describes
 * when an obligation may be generated; recognition and settlement still use
 * the ordinary expense command and separate money-domain commands.
 */
export const RECURRING_INTERVAL_UNITS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export type RecurringIntervalUnit = (typeof RECURRING_INTERVAL_UNITS)[number];

export type RecurringExpenseRuleInput = Readonly<{
  id: string;
  tenantId: string;
  legalEntityId: string;
  stationId?: string;
  description: string;
  category?: string;
  amount: string;
  currency: CurrencyCode;
  settlementSource: ExpenseSettlementSource;
  intervalUnit: RecurringIntervalUnit;
  intervalCount: number;
  anchorDate: string;
  active?: boolean;
  approvalPolicy: ExpenseApprovalPolicy;
}>;

export type RecurringExpenseRule = Readonly<{
  id: string;
  tenantId: string;
  legalEntityId: string;
  stationId?: string;
  description: string;
  category?: string;
  amount: Money;
  classification: 'RECURRING_FIXED_COST';
  settlementSource: ExpenseSettlementSource;
  intervalUnit: RecurringIntervalUnit;
  intervalCount: number;
  anchorDate: BusinessDate;
  active: boolean;
  approvalPolicy: Readonly<{
    approvalRequired: boolean;
    stepUpThreshold?: ExactDecimal;
    secondApproverThreshold?: ExactDecimal;
  }>;
}>;

export type ExpenseInput = Readonly<{
  id: string;
  tenantId: string;
  legalEntityId: string;
  stationId?: string;
  businessDate: string;
  description: string;
  /** An opaque configured category; this module does not invent a category catalogue. */
  category?: string;
  amount: string;
  currency: CurrencyCode;
  classification: ExpenseClassification;
  settlementSource: ExpenseSettlementSource;
  state?: ExpenseState;
}>;

export type Expense = Readonly<{
  id: string;
  tenantId: string;
  legalEntityId: string;
  stationId?: string;
  businessDate: BusinessDate;
  description: string;
  category?: string;
  amount: Money;
  classification: ExpenseClassification;
  settlementSource: ExpenseSettlementSource;
  state: ExpenseState;
}>;

export type ExpenseClassificationResult = Readonly<{
  classification: ExpenseClassification;
  settlementSource: ExpenseSettlementSource;
  /** Direct inventory costs are not operating expenses. */
  includedInOperatingExpenses: boolean;
  recognitionKind: 'DAILY_EXPENSE' | 'RECURRING_COST_RECOGNITION';
  economicBucket: 'OPERATING_EXPENSE' | 'INVENTORY_COST';
}>;

export type ExpenseApprovalPolicy = Readonly<{
  /** Approval policy is configuration; this domain does not supply a threshold. */
  approvalRequired: boolean;
  /** Inclusive amount at which step-up authentication is required. */
  stepUpThreshold?: string;
  /** Inclusive amount at which a second approver is required. */
  secondApproverThreshold?: string;
}>;

export type ExpenseApprovalCalculation = Readonly<{
  amount: string;
  approvalRequired: boolean;
  requiredApproverCount: number;
  requiresStepUp: boolean;
  stepUpThreshold?: string;
  secondApproverThreshold?: string;
}>;

function requiredText(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_FAILED', `${field} is required`);
  }
  return value.trim();
}

function isoDate(value: string, field: string): BusinessDate {
  const normalized = requiredText(value, field);
  try {
    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
      throw new Error('invalid calendar date');
    }
    return businessDate(normalized);
  } catch {
    throw new AppError('VALIDATION_FAILED', `${field} must use YYYY-MM-DD`);
  }
}

function nonNegativeMoney(amount: string, currency: CurrencyCode, field: string): Money {
  let value: Money;
  try {
    value = money(amount, currency);
  } catch (error) {
    throw new AppError('VALIDATION_FAILED', `${field} must be a valid exact monetary amount`, {
      cause: error instanceof Error ? error.message : 'invalid amount',
    });
  }
  if (value.amount.value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', `${field} cannot be negative`);
  }
  return value;
}

function nonNegativeThreshold(amount: string, field: string): ExactDecimal {
  return nonNegativeMoney(amount, 'USD', field).amount;
}

function assertEnum<T extends string>(value: T, values: readonly T[], field: string): void {
  if (!values.includes(value)) {
    throw new AppError('VALIDATION_FAILED', `${field} is invalid`);
  }
}

function intervalCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3650) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Recurring interval count must be a whole number between 1 and 3650',
    );
  }
  return value;
}

function isoDateValue(value: string): Date {
  const normalized = requiredText(value, 'Recurring anchor date');
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new AppError('VALIDATION_FAILED', 'Recurring anchor date must use YYYY-MM-DD');
  }
  return date;
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addInterval(date: Date, unit: RecurringIntervalUnit, count: number): Date {
  const next = new Date(date);
  if (unit === 'DAY') next.setUTCDate(next.getUTCDate() + count);
  if (unit === 'WEEK') next.setUTCDate(next.getUTCDate() + count * 7);
  if (unit === 'MONTH') {
    const originalDay = next.getUTCDate();
    const originalLastDay = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const preserveMonthEnd = originalDay === originalLastDay;
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + count);
    const lastDay = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
    ).getUTCDate();
    next.setUTCDate(preserveMonthEnd ? lastDay : Math.min(originalDay, lastDay));
  }
  if (unit === 'YEAR') {
    const originalMonth = next.getUTCMonth();
    const originalDay = next.getUTCDate();
    const originalLastDay = new Date(
      Date.UTC(next.getUTCFullYear(), originalMonth + 1, 0),
    ).getUTCDate();
    const preserveMonthEnd = originalDay === originalLastDay;
    next.setUTCDate(1);
    next.setUTCFullYear(next.getUTCFullYear() + count);
    next.setUTCMonth(originalMonth);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), originalMonth + 1, 0)).getUTCDate();
    next.setUTCDate(preserveMonthEnd ? lastDay : Math.min(originalDay, lastDay));
  }
  return next;
}

export function validateRecurringExpenseRule(
  input: RecurringExpenseRuleInput,
): RecurringExpenseRule {
  const id = requiredText(input.id, 'Recurring expense rule id');
  const tenantId = requiredText(input.tenantId, 'Tenant id');
  const legalEntityId = requiredText(input.legalEntityId, 'Legal entity id');
  const stationId =
    input.stationId === undefined ? undefined : requiredText(input.stationId, 'Station id');
  const description = requiredText(input.description, 'Recurring expense description');
  const category =
    input.category === undefined
      ? undefined
      : requiredText(input.category, 'Recurring expense category');
  assertEnum(
    input.settlementSource,
    EXPENSE_SETTLEMENT_SOURCES,
    'Recurring expense settlement source',
  );
  assertEnum(input.intervalUnit, RECURRING_INTERVAL_UNITS, 'Recurring expense interval unit');
  const amount = nonNegativeMoney(input.amount, input.currency, 'Recurring expense amount');
  if (amount.amount.value.isZero()) {
    throw new AppError('VALIDATION_FAILED', 'Recurring expense amount must be greater than zero');
  }

  return {
    id,
    tenantId,
    legalEntityId,
    ...(stationId === undefined ? {} : { stationId }),
    description,
    ...(category === undefined ? {} : { category }),
    amount,
    classification: 'RECURRING_FIXED_COST',
    settlementSource: input.settlementSource,
    intervalUnit: input.intervalUnit,
    intervalCount: intervalCount(input.intervalCount),
    anchorDate: isoDate(input.anchorDate, 'Recurring anchor date'),
    active: input.active ?? true,
    approvalPolicy: validateExpenseApprovalPolicy(input.approvalPolicy),
  };
}

/** Returns whether a configured rule has an occurrence on the supplied date. */
export function isRecurringExpenseDue(rule: RecurringExpenseRule, occurrenceDate: string): boolean {
  if (!rule.active) return false;
  const target = isoDateValue(occurrenceDate);
  const anchor = isoDateValue(rule.anchorDate);
  if (target < anchor) return false;
  let cursor = anchor;
  // The bounded loop is deliberate: a malformed or hostile interval cannot
  // turn a request into an unbounded date calculation.
  for (let i = 0; i < 100_000 && cursor <= target; i += 1) {
    if (dateString(cursor) === occurrenceDate) return true;
    cursor = addInterval(cursor, rule.intervalUnit, rule.intervalCount);
  }
  return false;
}

export function nextRecurringExpenseDate(
  rule: RecurringExpenseRule,
  afterDate: string,
): BusinessDate {
  const after = isoDateValue(afterDate);
  let cursor = isoDateValue(rule.anchorDate);
  if (cursor > after) return rule.anchorDate;
  for (let i = 0; i < 100_000; i += 1) {
    cursor = addInterval(cursor, rule.intervalUnit, rule.intervalCount);
    if (cursor > after) return businessDate(dateString(cursor));
  }
  throw new AppError('INVARIANT_VIOLATION', 'Recurring expense schedule exceeded its safety bound');
}

export function validateExpense(input: ExpenseInput): Expense {
  const id = requiredText(input.id, 'Expense id');
  const tenantId = requiredText(input.tenantId, 'Tenant id');
  const legalEntityId = requiredText(input.legalEntityId, 'Legal entity id');
  const stationId =
    input.stationId === undefined ? undefined : requiredText(input.stationId, 'Station id');
  const description = requiredText(input.description, 'Expense description');
  const category =
    input.category === undefined ? undefined : requiredText(input.category, 'Expense category');
  const state = input.state ?? 'DRAFT';

  assertEnum(input.classification, EXPENSE_CLASSIFICATIONS, 'Expense classification');
  assertEnum(input.settlementSource, EXPENSE_SETTLEMENT_SOURCES, 'Expense settlement source');
  assertEnum(state, EXPENSE_STATES, 'Expense state');

  return {
    id,
    tenantId,
    legalEntityId,
    ...(stationId === undefined ? {} : { stationId }),
    businessDate: isoDate(input.businessDate, 'Expense business date'),
    description,
    ...(category === undefined ? {} : { category }),
    amount: nonNegativeMoney(input.amount, input.currency, 'Expense amount'),
    classification: input.classification,
    settlementSource: input.settlementSource,
    state,
  };
}

export function classifyExpense(
  input: Pick<Expense, 'classification' | 'settlementSource'>,
): ExpenseClassificationResult {
  assertEnum(input.classification, EXPENSE_CLASSIFICATIONS, 'Expense classification');
  assertEnum(input.settlementSource, EXPENSE_SETTLEMENT_SOURCES, 'Expense settlement source');

  const isDirectInventoryCost = input.classification === 'DIRECT_INVENTORY_COST';
  return {
    classification: input.classification,
    settlementSource: input.settlementSource,
    includedInOperatingExpenses: !isDirectInventoryCost,
    recognitionKind:
      input.classification === 'RECURRING_FIXED_COST'
        ? 'RECURRING_COST_RECOGNITION'
        : 'DAILY_EXPENSE',
    economicBucket: isDirectInventoryCost ? 'INVENTORY_COST' : 'OPERATING_EXPENSE',
  };
}

export function validateExpenseApprovalPolicy(policy: ExpenseApprovalPolicy): Readonly<{
  approvalRequired: boolean;
  stepUpThreshold?: ExactDecimal;
  secondApproverThreshold?: ExactDecimal;
}> {
  if (typeof policy.approvalRequired !== 'boolean') {
    throw new AppError('VALIDATION_FAILED', 'Expense approvalRequired must be boolean');
  }

  if (
    !policy.approvalRequired &&
    (policy.stepUpThreshold !== undefined || policy.secondApproverThreshold !== undefined)
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Approval thresholds cannot be configured when expense approval is disabled',
    );
  }

  const stepUpThreshold =
    policy.stepUpThreshold === undefined
      ? undefined
      : nonNegativeThreshold(policy.stepUpThreshold, 'Expense step-up threshold');
  const secondApproverThreshold =
    policy.secondApproverThreshold === undefined
      ? undefined
      : nonNegativeThreshold(policy.secondApproverThreshold, 'Expense second-approver threshold');

  return {
    approvalRequired: policy.approvalRequired,
    ...(stepUpThreshold === undefined ? {} : { stepUpThreshold }),
    ...(secondApproverThreshold === undefined ? {} : { secondApproverThreshold }),
  };
}

export function calculateExpenseApproval(
  amount: string,
  currency: CurrencyCode,
  policy: ExpenseApprovalPolicy,
): ExpenseApprovalCalculation {
  const expenseAmount = nonNegativeMoney(amount, currency, 'Expense amount');
  const validatedPolicy = validateExpenseApprovalPolicy(policy);
  const secondApproverThreshold = validatedPolicy.secondApproverThreshold;
  const requiresSecondApprover =
    validatedPolicy.approvalRequired &&
    secondApproverThreshold !== undefined &&
    expenseAmount.amount.value.gte(secondApproverThreshold.value);

  return {
    amount: expenseAmount.amount.toString(),
    approvalRequired: validatedPolicy.approvalRequired,
    requiredApproverCount: validatedPolicy.approvalRequired ? (requiresSecondApprover ? 2 : 1) : 0,
    requiresStepUp:
      validatedPolicy.approvalRequired &&
      validatedPolicy.stepUpThreshold !== undefined &&
      expenseAmount.amount.value.gte(validatedPolicy.stepUpThreshold.value),
    ...(validatedPolicy.stepUpThreshold === undefined
      ? {}
      : { stepUpThreshold: validatedPolicy.stepUpThreshold.toString() }),
    ...(secondApproverThreshold === undefined
      ? {}
      : { secondApproverThreshold: secondApproverThreshold.toString() }),
  };
}

/** Owner/management authority is still subject to separation of duties. */
export function assertExpenseApprovalActor(
  submittedBy: string | null,
  approverMembershipId: string,
): void {
  if (submittedBy && submittedBy === approverMembershipId) {
    throw new AppError('FORBIDDEN', 'The submitting actor cannot approve the same expense');
  }
}

const expenseTransitions: Readonly<Record<ExpenseState, readonly ExpenseState[]>> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['RETURNED', 'APPROVED', 'REJECTED'],
  RETURNED: ['SUBMITTED'],
  APPROVED: ['POSTED'],
  REJECTED: [],
  POSTED: ['REVERSED'],
  REVERSED: [],
};

export function assertExpenseTransition(from: ExpenseState, to: ExpenseState): void {
  assertEnum(from, EXPENSE_STATES, 'Current expense state');
  assertEnum(to, EXPENSE_STATES, 'Target expense state');
  if (!expenseTransitions[from].includes(to)) {
    throw new AppError('CONFLICT', `Expense cannot transition from ${from} to ${to}`);
  }
}
