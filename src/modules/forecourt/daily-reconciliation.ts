import { AppError } from '../../platform/errors';
import {
  DECIMAL_POLICIES,
  ExactDecimal,
  businessDate,
  litres,
  money,
  type BusinessDate,
  type CurrencyCode,
  type Money,
} from '../../platform/domain/primitives';
import type { MeterSegment } from './domain';

export const DAILY_RECONCILIATION_PAYMENT_METHODS = [
  'CASH',
  'POS',
  'ECOCASH',
  'BANK_TRANSFER',
  'CUSTOMER_CREDIT',
  'PREPAID',
  'STAFF_OR_MANAGEMENT_FUEL',
  'OTHER_APPROVED',
] as const;

export type DailyReconciliationPaymentMethod =
  (typeof DAILY_RECONCILIATION_PAYMENT_METHODS)[number];

export type DailyReconciliationState = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';

export type DailyPaymentAllocation = {
  id: string;
  method: DailyReconciliationPaymentMethod;
  amount: Money;
  reference?: string;
  note?: string;
};

export type DailyExpense = {
  id: string;
  category: string;
  description: string;
  amount: Money;
  paymentMethod: DailyReconciliationPaymentMethod;
  personPaid?: string;
  approvalReference?: string;
  documentReference?: string;
};

export type DailyDelivery = {
  id: string;
  productId: string;
  tankId: string;
  quantity: ReturnType<typeof litres>;
  deliveryReference: string;
  supplierReference?: string;
};

export type DailyTankDip = {
  id: string;
  tankId: string;
  productId: string;
  closingLitres: ReturnType<typeof litres>;
  openingLitres?: ReturnType<typeof litres>;
  adjustmentLitres?: ReturnType<typeof litres>;
};

export type DailyCashCount = {
  countedCash: Money;
  handoverAmount?: Money;
  explanation?: string;
};

export type DailyReconciliationIssue = {
  code:
    | 'MISSING_METER_READING'
    | 'INVALID_PAYMENT'
    | 'INVALID_EXPENSE'
    | 'SALES_VARIANCE'
    | 'CASH_VARIANCE'
    | 'TANK_GAP'
    | 'TANK_OPENING_REQUIRED';
  message: string;
};

export type DailyReconciliationTotals = {
  litresSold: string;
  expectedSales: Money;
  accountedSales: Money;
  salesVariance: Money;
  totalExpenses: Money;
  expectedPhysicalCash: Money;
  cashVariance?: Money;
  tankGaps: Readonly<Record<string, string>>;
};

export type DailyReconciliation = {
  id: string;
  revision: number;
  tenantId: string;
  stationId: string;
  businessDayId: string;
  shiftId: string;
  operationalDate: BusinessDate;
  supervisorId: string;
  attendantIds: readonly string[];
  state: DailyReconciliationState;
  payments: readonly DailyPaymentAllocation[];
  expenses: readonly DailyExpense[];
  deliveries: readonly DailyDelivery[];
  tankDips: readonly DailyTankDip[];
  cash?: DailyCashCount;
  totals: DailyReconciliationTotals;
  issues: readonly DailyReconciliationIssue[];
  explanation?: string;
  returnedReason?: string;
  submittedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
};

export type DailyReconciliationInput = Omit<
  DailyReconciliation,
  | 'state'
  | 'totals'
  | 'issues'
  | 'explanation'
  | 'returnedReason'
  | 'submittedBy'
  | 'approvedBy'
  | 'approvedAt'
> & {
  segments: readonly MeterSegment[];
  payments: readonly DailyPaymentAllocation[];
  expenses: readonly DailyExpense[];
  deliveries: readonly DailyDelivery[];
  tankDips: readonly DailyTankDip[];
  cash?: DailyCashCount;
  currency?: CurrencyCode;
};

function decimal(value: string): ExactDecimal {
  return new ExactDecimal(value);
}

function add(values: readonly ExactDecimal[]): ExactDecimal {
  return values.reduce((total, value) => total.add(value), decimal('0'));
}

function currencyMoney(value: ExactDecimal, currency: CurrencyCode): Money {
  return money(value.quantize(DECIMAL_POLICIES.money).toString(), currency);
}

function issue(code: DailyReconciliationIssue['code'], message: string): DailyReconciliationIssue {
  return { code, message };
}

function assertSameScope(input: DailyReconciliationInput): void {
  for (const segment of input.segments) {
    if (
      segment.tenantId !== input.tenantId ||
      segment.stationId !== input.stationId ||
      segment.businessDayId !== input.businessDayId ||
      segment.shiftId !== input.shiftId
    ) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Every meter segment must belong to the reconciliation tenant, station, date, and shift',
      );
    }
  }
}

function validateNonNegative(value: ExactDecimal, label: string): void {
  if (value.value.isNegative())
    throw new AppError('VALIDATION_FAILED', `${label} cannot be negative`);
}

function calculateTankGaps(
  dips: readonly DailyTankDip[],
  deliveries: readonly DailyDelivery[],
  segments: readonly MeterSegment[],
): { gaps: Readonly<Record<string, string>>; issues: DailyReconciliationIssue[] } {
  const gaps: Record<string, string> = {};
  const issues: DailyReconciliationIssue[] = [];
  for (const delivery of deliveries) {
    validateNonNegative(delivery.quantity, `Delivery ${delivery.id}`);
  }
  for (const dip of dips) {
    validateNonNegative(dip.closingLitres, `Closing dip for tank ${dip.tankId}`);
    if (!dip.openingLitres) {
      issues.push(
        issue(
          'TANK_OPENING_REQUIRED',
          `Tank ${dip.tankId} needs an opening quantity or an approved opening position`,
        ),
      );
      continue;
    }
    validateNonNegative(dip.openingLitres, `Opening dip for tank ${dip.tankId}`);
    const received = add(
      deliveries
        .filter(
          (delivery) => delivery.tankId === dip.tankId && delivery.productId === dip.productId,
        )
        .map((delivery) => delivery.quantity),
    );
    const sold = add(
      segments
        .filter((segment) => segment.productId === dip.productId)
        .map((segment) => segment.litres),
    );
    const adjustments = dip.adjustmentLitres ?? litres('0');
    const expected = dip.openingLitres.add(received).subtract(sold).add(adjustments);
    const gap = dip.closingLitres.subtract(expected).quantize(DECIMAL_POLICIES.litres);
    gaps[dip.tankId] = gap.toString();
    if (!gap.value.isZero()) {
      issues.push(issue('TANK_GAP', `Tank ${dip.tankId} has a ${gap.toString()} L stock gap`));
    }
  }
  return { gaps, issues };
}

export function calculateDailyReconciliation(input: DailyReconciliationInput): DailyReconciliation {
  assertSameScope(input);
  const currency = input.currency ?? input.segments[0]?.currency ?? 'USD';
  const issues: DailyReconciliationIssue[] = [];
  if (input.segments.length === 0) {
    issues.push(issue('MISSING_METER_READING', 'At least one sealed meter reading is required'));
  }
  for (const segment of input.segments) {
    if (segment.openingReading.trim() === '' || segment.closingReading.trim() === '') {
      issues.push(
        issue('MISSING_METER_READING', `Meter segment ${segment.id} is missing a reading`),
      );
    }
    if (
      segment.closingReading &&
      decimal(segment.closingReading).value.lt(decimal(segment.openingReading).value)
    ) {
      issues.push(
        issue(
          'MISSING_METER_READING',
          `Meter segment ${segment.id} closes below its opening reading`,
        ),
      );
    }
  }
  const expectedSales = currencyMoney(
    add(input.segments.map((segment) => segment.expectedSaleValue.amount)),
    currency,
  );
  const accountedSales = currencyMoney(
    add(input.payments.map((payment) => payment.amount.amount)),
    currency,
  );
  const salesVariance = currencyMoney(
    accountedSales.amount.subtract(expectedSales.amount),
    currency,
  );
  const totalExpenses = currencyMoney(
    add(input.expenses.map((expense) => expense.amount.amount)),
    currency,
  );
  const cashAllocated = add(
    input.payments
      .filter((payment) => payment.method === 'CASH')
      .map((payment) => payment.amount.amount),
  );
  const cashPaidExpenses = add(
    input.expenses
      .filter((expense) => expense.paymentMethod === 'CASH')
      .map((expense) => expense.amount.amount),
  );
  const expectedPhysicalCash = currencyMoney(cashAllocated.subtract(cashPaidExpenses), currency);
  const cashVariance = input.cash
    ? currencyMoney(input.cash.countedCash.amount.subtract(expectedPhysicalCash.amount), currency)
    : undefined;

  for (const payment of input.payments) {
    validateNonNegative(payment.amount.amount, `Payment ${payment.id}`);
    if (payment.amount.currency !== currency) {
      issues.push(issue('INVALID_PAYMENT', `Payment ${payment.id} uses the wrong currency`));
    }
  }
  for (const expense of input.expenses) {
    validateNonNegative(expense.amount.amount, `Expense ${expense.id}`);
    if (expense.amount.currency !== currency) {
      issues.push(issue('INVALID_EXPENSE', `Expense ${expense.id} uses the wrong currency`));
    }
  }
  if (!salesVariance.amount.value.isZero()) {
    issues.push(
      issue('SALES_VARIANCE', `Sales variance is ${salesVariance.amount.toString()} ${currency}`),
    );
  }
  if (cashVariance && !cashVariance.amount.value.isZero()) {
    issues.push(
      issue('CASH_VARIANCE', `Cash variance is ${cashVariance.amount.toString()} ${currency}`),
    );
  }
  const tank = calculateTankGaps(input.tankDips, input.deliveries, input.segments);
  issues.push(...tank.issues);

  return {
    id: input.id,
    revision: input.revision,
    tenantId: input.tenantId,
    stationId: input.stationId,
    businessDayId: input.businessDayId,
    shiftId: input.shiftId,
    operationalDate: businessDate(input.operationalDate),
    supervisorId: input.supervisorId,
    attendantIds: [...input.attendantIds],
    state: 'DRAFT',
    payments: input.payments.map((payment) => ({ ...payment })),
    expenses: input.expenses.map((expense) => ({ ...expense })),
    deliveries: input.deliveries.map((delivery) => ({ ...delivery })),
    tankDips: input.tankDips.map((dip) => ({ ...dip })),
    ...(input.cash ? { cash: { ...input.cash } } : {}),
    totals: {
      litresSold: add(input.segments.map((segment) => segment.litres))
        .quantize(DECIMAL_POLICIES.litres)
        .toString(),
      expectedSales,
      accountedSales,
      salesVariance,
      totalExpenses,
      expectedPhysicalCash,
      ...(cashVariance ? { cashVariance } : {}),
      tankGaps: tank.gaps,
    },
    issues,
  };
}

export function submitDailyReconciliation(
  reconciliation: DailyReconciliation,
  actorId: string,
  explanation?: string,
): DailyReconciliation {
  if (reconciliation.state !== 'DRAFT' && reconciliation.state !== 'RETURNED') {
    throw new AppError('CONFLICT', `Only a draft or returned reconciliation can be submitted`);
  }
  const trimmedExplanation = explanation?.trim();
  const hasVariance = reconciliation.issues.some((item) =>
    ['SALES_VARIANCE', 'CASH_VARIANCE', 'TANK_GAP'].includes(item.code),
  );
  const blockingIssues = reconciliation.issues.filter(
    (item) => !['SALES_VARIANCE', 'CASH_VARIANCE', 'TANK_GAP'].includes(item.code),
  );
  if (blockingIssues.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'Resolve validation issues before submission');
  }
  if (hasVariance && !trimmedExplanation) {
    throw new AppError('VALIDATION_FAILED', 'A supervisor explanation is required for variance');
  }
  return {
    ...reconciliation,
    state: 'SUBMITTED',
    submittedBy: actorId,
    ...(trimmedExplanation ? { explanation: trimmedExplanation } : {}),
  };
}

export function returnDailyReconciliation(
  reconciliation: DailyReconciliation,
  reason: string,
): DailyReconciliation {
  if (reconciliation.state !== 'SUBMITTED') {
    throw new AppError('CONFLICT', 'Only a submitted reconciliation can be returned');
  }
  if (!reason.trim()) throw new AppError('VALIDATION_FAILED', 'A return reason is required');
  return { ...reconciliation, state: 'RETURNED', returnedReason: reason.trim() };
}

export function approveDailyReconciliation(
  reconciliation: DailyReconciliation,
  actorId: string,
  approvedAt: string,
): DailyReconciliation {
  if (reconciliation.state !== 'SUBMITTED') {
    throw new AppError('CONFLICT', 'Only a submitted reconciliation can be approved');
  }
  if (reconciliation.submittedBy === actorId) {
    throw new AppError('FORBIDDEN', 'A reconciliation cannot be approved by its submitting actor');
  }
  if (!Number.isFinite(Date.parse(approvedAt))) {
    throw new AppError('VALIDATION_FAILED', 'Approval requires a server timestamp');
  }
  return { ...reconciliation, state: 'APPROVED', approvedBy: actorId, approvedAt };
}

export function reviseReturnedDailyReconciliation(
  reconciliation: DailyReconciliation,
): DailyReconciliation {
  if (reconciliation.state !== 'RETURNED') {
    throw new AppError('CONFLICT', 'Only a returned reconciliation can be revised');
  }
  return {
    ...reconciliation,
    revision: reconciliation.revision + 1,
    state: 'DRAFT',
    returnedReason: undefined,
  };
}
