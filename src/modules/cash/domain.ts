import { AppError } from '../../platform/errors';
import { ExactDecimal, money } from '../../platform/domain/primitives';

export const CASH_LOCATION_TYPES = [
  'STATION_TILL',
  'STATION_SAFE',
  'TRANSIT',
  'COLLECTOR',
] as const;
export type CashLocationType = (typeof CASH_LOCATION_TYPES)[number];

export const CASH_MOVEMENT_TYPES = [
  'RECEIPT',
  'DISBURSEMENT',
  'TRANSFER',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const CASH_HANDOVER_STATES = [
  'DRAFT',
  'SUBMITTED',
  'ACCEPTED',
  'DISPUTED',
  'RESOLVED',
  'CANCELLED',
] as const;
export type CashHandoverState = (typeof CASH_HANDOVER_STATES)[number];

export const CASH_COLLECTION_STATES = ['RECORDED', 'RECEIVED', 'REVERSED'] as const;
export type CashCollectionState = (typeof CASH_COLLECTION_STATES)[number];

export const BANK_DEPOSIT_STATES = [
  'RECORDED',
  'SUBMITTED',
  'CONFIRMED',
  'REJECTED',
  'REVERSED',
] as const;
export type BankDepositState = (typeof BANK_DEPOSIT_STATES)[number];

export const PROVIDER_BATCH_STATES = [
  'DECLARED',
  'MATCHED',
  'SETTLED',
  'DISPUTED',
  'REVERSED',
] as const;
export type ProviderBatchState = (typeof PROVIDER_BATCH_STATES)[number];

export type CashMovement = Readonly<{
  movementType: CashMovementType;
  amount: string;
  fromLocationId?: string;
  toLocationId?: string;
}>;

export type CashHandover = Readonly<{
  state: CashHandoverState;
  expectedAmount: string;
  countedAmount?: string;
  variance?: string;
}>;

export type ProviderSettlementCalculation = Readonly<{
  declaredGross: string;
  declaredFees: string;
  declaredRefunds: string;
  expectedNet: string;
  settledNet: string;
  variance: string;
}>;

export type CashCollectionSource = Readonly<{
  reconciliationId: string;
  amount: string;
  availableAmount: string;
}>;

export type BankDepositAllocation = Readonly<{
  collectionId: string;
  amount: string;
  unbankedAmount: string;
}>;

function decimal(value: string): ExactDecimal {
  try {
    return new ExactDecimal(value);
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Amount must be a finite decimal string');
  }
}

function positiveAmount(value: string, label: string): ExactDecimal {
  const amount = decimal(value);
  if (amount.value.lte(0)) {
    throw new AppError('VALIDATION_FAILED', `${label} must be greater than zero`);
  }
  return amount;
}

export function validateCashMovement(input: CashMovement): void {
  positiveAmount(input.amount, 'Cash movement amount');

  if (input.movementType === 'TRANSFER') {
    if (!input.fromLocationId || !input.toLocationId) {
      throw new AppError('VALIDATION_FAILED', 'A cash transfer requires both locations');
    }
    if (input.fromLocationId === input.toLocationId) {
      throw new AppError('VALIDATION_FAILED', 'A cash transfer must change location');
    }
    return;
  }

  if (input.movementType === 'RECEIPT' && (!input.toLocationId || input.fromLocationId)) {
    throw new AppError('VALIDATION_FAILED', 'A cash receipt must enter exactly one location');
  }
  if (input.movementType === 'DISBURSEMENT' && (!input.fromLocationId || input.toLocationId)) {
    throw new AppError('VALIDATION_FAILED', 'A cash disbursement must leave exactly one location');
  }
  if (
    (input.movementType === 'ADJUSTMENT_IN' || input.movementType === 'ADJUSTMENT_OUT') &&
    ((!input.toLocationId && !input.fromLocationId) ||
      (input.toLocationId !== undefined && input.fromLocationId !== undefined))
  ) {
    throw new AppError('VALIDATION_FAILED', 'A cash adjustment must affect exactly one location');
  }
}

export function cashBalanceForLocation(
  locationId: string,
  movements: readonly CashMovement[],
): string {
  let balance = new ExactDecimal('0');
  for (const movement of movements) {
    validateCashMovement(movement);
    const amount = decimal(movement.amount);
    if (movement.toLocationId === locationId) balance = balance.add(amount);
    if (movement.fromLocationId === locationId) balance = balance.subtract(amount);
  }
  return balance.toString();
}

export function calculateCashVariance(expectedAmount: string, countedAmount: string): string {
  positiveAmount(expectedAmount, 'Expected cash amount');
  const counted = decimal(countedAmount);
  if (counted.value.lt(0)) {
    throw new AppError('VALIDATION_FAILED', 'Counted cash amount cannot be negative');
  }
  return counted.subtract(decimal(expectedAmount)).toString();
}

export function calculateCashCount(input: {
  expectedAmount: string;
  countedAmount: string;
  explanation?: string;
}): { expectedAmount: string; countedAmount: string; variance: string } {
  const expected = decimal(input.expectedAmount);
  if (expected.value.lt(0)) {
    throw new AppError('VALIDATION_FAILED', 'Expected cash amount cannot be negative');
  }
  const counted = decimal(input.countedAmount);
  if (counted.value.lt(0)) {
    throw new AppError('VALIDATION_FAILED', 'Counted cash amount cannot be negative');
  }
  const variance = counted.subtract(expected).toString();
  if (variance !== '0' && !input.explanation?.trim()) {
    throw new AppError(
      'VALIDATION_FAILED',
      'An explanation is required when counted cash differs from expected cash',
    );
  }
  return {
    expectedAmount: expected.toString(),
    countedAmount: counted.toString(),
    variance,
  };
}

export function calculateCashCollectionAmount(sources: readonly CashCollectionSource[]): string {
  if (sources.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'At least one reconciliation source is required');
  }

  let total = new ExactDecimal('0');
  for (const source of sources) {
    const amount = positiveAmount(source.amount, 'Collection source amount');
    const available = decimal(source.availableAmount);
    if (available.value.lt(0)) {
      throw new AppError('VALIDATION_FAILED', 'Available cash cannot be negative');
    }
    if (amount.value.gt(available.value)) {
      throw new AppError(
        'CONFLICT',
        'The requested collection exceeds the reconciliation cash still available',
        { reconciliationId: source.reconciliationId },
      );
    }
    total = total.add(amount);
  }
  return total.toString();
}

export function calculateBankDepositAmount(allocations: readonly BankDepositAllocation[]): string {
  if (allocations.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'At least one collection allocation is required');
  }

  let total = new ExactDecimal('0');
  for (const allocation of allocations) {
    const amount = positiveAmount(allocation.amount, 'Deposit allocation amount');
    const unbanked = decimal(allocation.unbankedAmount);
    if (unbanked.value.lt(0)) {
      throw new AppError('VALIDATION_FAILED', 'Unbanked collection balance cannot be negative');
    }
    if (amount.value.gt(unbanked.value)) {
      throw new AppError(
        'CONFLICT',
        'The deposit allocation exceeds the collection amount still unbanked',
        { collectionId: allocation.collectionId },
      );
    }
    total = total.add(amount);
  }
  return total.toString();
}

export function remainingCashAmount(totalAmount: string, allocatedAmount: string): string {
  const total = decimal(totalAmount);
  const allocated = decimal(allocatedAmount);
  if (total.value.lt(0) || allocated.value.lt(0) || allocated.value.gt(total.value)) {
    throw new AppError('CONFLICT', 'Allocated cash exceeds the authoritative collection amount');
  }
  return total.subtract(allocated).toString();
}

export function submitCashHandover(input: {
  expectedAmount: string;
  countedAmount: string;
}): CashHandover {
  const variance = calculateCashVariance(input.expectedAmount, input.countedAmount);
  return {
    state: variance === '0' ? 'SUBMITTED' : 'DISPUTED',
    expectedAmount: money(input.expectedAmount).amount.toString(),
    countedAmount: decimal(input.countedAmount).toString(),
    variance,
  };
}

export function transitionCashHandover(
  current: CashHandoverState,
  command: 'AcceptCashHandover' | 'ResolveCashHandover' | 'CancelCashHandover',
): CashHandoverState {
  if (command === 'AcceptCashHandover' && current === 'SUBMITTED') return 'ACCEPTED';
  if (command === 'ResolveCashHandover' && current === 'DISPUTED') return 'RESOLVED';
  if (
    command === 'CancelCashHandover' &&
    (current === 'DRAFT' || current === 'SUBMITTED' || current === 'DISPUTED')
  ) {
    return 'CANCELLED';
  }
  throw new AppError('CONFLICT', `Cannot ${command} a cash handover in ${current} state`);
}

export function calculateProviderSettlement(input: {
  declaredGross: string;
  declaredFees: string;
  declaredRefunds: string;
  settledNet: string;
}): ProviderSettlementCalculation {
  const gross = positiveAmount(input.declaredGross, 'Declared gross');
  const fees = decimal(input.declaredFees);
  const refunds = decimal(input.declaredRefunds);
  const settled = decimal(input.settledNet);
  if (fees.value.lt(0) || refunds.value.lt(0) || settled.value.lt(0)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Provider fees, refunds, and settlement cannot be negative',
    );
  }
  const expectedNet = gross.subtract(fees).subtract(refunds);
  if (expectedNet.value.lt(0)) {
    throw new AppError('VALIDATION_FAILED', 'Provider deductions cannot exceed declared gross');
  }
  return {
    declaredGross: gross.toString(),
    declaredFees: fees.toString(),
    declaredRefunds: refunds.toString(),
    expectedNet: expectedNet.toString(),
    settledNet: settled.toString(),
    variance: settled.subtract(expectedNet).toString(),
  };
}
