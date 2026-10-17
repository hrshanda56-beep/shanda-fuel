import { AppError } from '../../platform/errors';
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import { CASH_HANDOVER_STATES, type CashHandoverState } from './domain';

export type CashHandoverRecord = Readonly<{
  state: CashHandoverState;
  deliveredBy: string;
  receivedBy: string | null;
  expectedAmount: string;
  countedAmount: string | null;
  variance: string | null;
  varianceExplanation: string | null;
  disputeReason: string | null;
  resolutionReason: string | null;
  cancellationReason: string | null;
}>;

export type CashHandoverCommand =
  | {
      type: 'PrepareHandover';
      deliveredBy: string;
      expectedAmount: string;
    }
  | {
      type: 'SenderConfirmHandover';
      countedAmount: string;
      varianceExplanation?: string;
    }
  | {
      type: 'ReceiverConfirmHandover';
      receivedBy: string;
    }
  | {
      type: 'DisputeHandover';
      receivedBy: string;
      reason: string;
      varianceExplanation?: string;
    }
  | {
      type: 'ResolveHandoverDispute';
      reason: string;
    }
  | {
      type: 'CancelHandover';
      reason: string;
    };

function decimal(value: string, label: string): ExactDecimal {
  try {
    return new ExactDecimal(value, DECIMAL_POLICIES.money);
  } catch {
    throw new AppError('VALIDATION_FAILED', `${label} must be a finite monetary decimal string`);
  }
}

function positiveAmount(value: string, label: string): ExactDecimal {
  const amount = decimal(value, label);
  if (amount.value.lte(0)) {
    throw new AppError('VALIDATION_FAILED', `${label} must be greater than zero`);
  }
  return amount;
}

function nonNegativeAmount(value: string, label: string): ExactDecimal {
  const amount = decimal(value, label);
  if (amount.value.lt(0)) {
    throw new AppError('VALIDATION_FAILED', `${label} cannot be negative`);
  }
  return amount;
}

function requiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new AppError('VALIDATION_FAILED', `${label} is required`);
  }
  return normalized;
}

function amountDifference(countedAmount: ExactDecimal, expectedAmount: ExactDecimal): string {
  // Both operands are validated against NUMERIC(20,4), so subtraction is exact and
  // requires no rounding boundary. Re-validating the result preserves the schema scale.
  return new ExactDecimal(
    countedAmount.subtract(expectedAmount).toString(),
    DECIMAL_POLICIES.money,
  ).toString();
}

function hasVariance(variance: string | null): boolean {
  return variance !== null && !new ExactDecimal(variance).value.isZero();
}

function sameAmount(left: string, right: string, label: string): boolean {
  try {
    return decimal(left, label).equals(decimal(right, label));
  } catch {
    return false;
  }
}

function normalizedExplanation(explanation: string | undefined, variance: string): string | null {
  const normalized = explanation?.trim() || null;
  if (hasVariance(variance) && !normalized) {
    throw new AppError(
      'VALIDATION_FAILED',
      'A variance explanation is required when counted cash differs from expected cash',
    );
  }
  return normalized;
}

function assertState(
  handover: CashHandoverRecord,
  expected: CashHandoverState,
  command: string,
): void {
  if (handover.state !== expected) {
    throw new AppError('CONFLICT', `Cannot ${command} a cash handover in ${handover.state} state`);
  }
}

function assertOneOfStates(
  handover: CashHandoverRecord,
  expected: readonly CashHandoverState[],
  command: string,
): void {
  if (!expected.includes(handover.state)) {
    throw new AppError('CONFLICT', `Cannot ${command} a cash handover in ${handover.state} state`);
  }
}

/** Validate the persisted handover projection before a command can use it. */
export function validateCashHandover(handover: CashHandoverRecord): void {
  if (!CASH_HANDOVER_STATES.includes(handover.state)) {
    throw new AppError('VALIDATION_FAILED', 'Cash handover state is invalid');
  }

  requiredText(handover.deliveredBy, 'The handing-over person');
  const expected = positiveAmount(handover.expectedAmount, 'Expected cash amount');

  if (handover.countedAmount === null) {
    if (handover.variance !== null) {
      throw new AppError('INVARIANT_VIOLATION', 'A handover variance requires a counted amount');
    }
    if (handover.varianceExplanation !== null) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'A variance explanation requires a counted amount and variance',
      );
    }
    if (handover.state !== 'DRAFT' && handover.state !== 'CANCELLED') {
      throw new AppError(
        'INVARIANT_VIOLATION',
        `${handover.state} cash handovers require a counted amount`,
      );
    }
  } else {
    const counted = nonNegativeAmount(handover.countedAmount, 'Counted cash amount');
    const calculatedVariance = amountDifference(counted, expected);
    if (
      handover.variance === null ||
      !sameAmount(handover.variance, calculatedVariance, 'Cash variance')
    ) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Cash handover variance must equal counted amount minus expected amount',
      );
    }
    normalizedExplanation(handover.varianceExplanation ?? undefined, calculatedVariance);
  }

  if (handover.state === 'ACCEPTED' && hasVariance(handover.variance)) {
    throw new AppError('INVARIANT_VIOLATION', 'An accepted cash handover cannot retain a variance');
  }
  if (handover.state === 'ACCEPTED' && !handover.receivedBy) {
    throw new AppError('INVARIANT_VIOLATION', 'An accepted cash handover requires a receiver');
  }
  if (handover.state === 'DISPUTED' || handover.state === 'RESOLVED') {
    requiredText(handover.receivedBy ?? undefined, 'The receiving/verifying person');
    requiredText(handover.disputeReason ?? undefined, 'A dispute reason');
  }
  if (handover.state === 'RESOLVED') {
    requiredText(handover.resolutionReason ?? undefined, 'A resolution reason');
  }
  if (handover.state === 'CANCELLED') {
    requiredText(handover.cancellationReason ?? undefined, 'A cancellation reason');
  }
}

export function prepareHandover(input: {
  deliveredBy: string;
  expectedAmount: string;
}): CashHandoverRecord {
  return {
    state: 'DRAFT',
    deliveredBy: requiredText(input.deliveredBy, 'The handing-over person'),
    receivedBy: null,
    expectedAmount: positiveAmount(input.expectedAmount, 'Expected cash amount').toString(),
    countedAmount: null,
    variance: null,
    varianceExplanation: null,
    disputeReason: null,
    resolutionReason: null,
    cancellationReason: null,
  };
}

export function senderConfirmHandover(
  handover: CashHandoverRecord,
  input: { countedAmount: string; varianceExplanation?: string },
): CashHandoverRecord {
  assertState(handover, 'DRAFT', 'SenderConfirmHandover');
  validateCashHandover(handover);

  const expected = positiveAmount(handover.expectedAmount, 'Expected cash amount');
  const counted = nonNegativeAmount(input.countedAmount, 'Counted cash amount');
  const variance = amountDifference(counted, expected);
  const next: CashHandoverRecord = {
    ...handover,
    state: 'SUBMITTED',
    expectedAmount: expected.toString(),
    countedAmount: counted.toString(),
    variance,
    varianceExplanation: normalizedExplanation(input.varianceExplanation, variance),
  };
  validateCashHandover(next);
  return next;
}

export function receiverConfirmHandover(
  handover: CashHandoverRecord,
  input: { receivedBy: string },
): CashHandoverRecord {
  assertState(handover, 'SUBMITTED', 'ReceiverConfirmHandover');
  validateCashHandover(handover);
  const receivedBy = requiredText(input.receivedBy, 'The receiving/verifying person');
  if (hasVariance(handover.variance)) {
    throw new AppError(
      'CONFLICT',
      'A non-zero cash variance must be disputed before the handover can be accepted',
    );
  }
  const next = { ...handover, state: 'ACCEPTED' as const, receivedBy };
  validateCashHandover(next);
  return next;
}

export function disputeHandover(
  handover: CashHandoverRecord,
  input: { receivedBy: string; reason: string; varianceExplanation?: string },
): CashHandoverRecord {
  assertState(handover, 'SUBMITTED', 'DisputeHandover');
  validateCashHandover(handover);
  const receivedBy = requiredText(input.receivedBy, 'The receiving/verifying person');
  const disputeReason = requiredText(input.reason, 'A dispute reason');
  const varianceExplanation = normalizedExplanation(
    input.varianceExplanation ?? handover.varianceExplanation ?? undefined,
    handover.variance ?? '0',
  );
  const next = {
    ...handover,
    state: 'DISPUTED' as const,
    receivedBy,
    disputeReason,
    varianceExplanation,
  };
  validateCashHandover(next);
  return next;
}

export function resolveHandoverDispute(
  handover: CashHandoverRecord,
  input: { reason: string },
): CashHandoverRecord {
  assertState(handover, 'DISPUTED', 'ResolveHandoverDispute');
  validateCashHandover(handover);
  const resolutionReason = requiredText(input.reason, 'A resolution reason');
  const next = { ...handover, state: 'RESOLVED' as const, resolutionReason };
  validateCashHandover(next);
  return next;
}

export function cancelHandover(
  handover: CashHandoverRecord,
  input: { reason: string },
): CashHandoverRecord {
  assertOneOfStates(handover, ['DRAFT', 'SUBMITTED', 'DISPUTED'], 'CancelHandover');
  validateCashHandover(handover);
  const cancellationReason = requiredText(input.reason, 'A cancellation reason');
  const next = { ...handover, state: 'CANCELLED' as const, cancellationReason };
  validateCashHandover(next);
  return next;
}

export function applyCashHandoverCommand(
  handover: CashHandoverRecord | null,
  command: CashHandoverCommand,
): CashHandoverRecord {
  if (command.type === 'PrepareHandover') {
    if (handover !== null) {
      throw new AppError('CONFLICT', 'PrepareHandover can only create a new cash handover');
    }
    return prepareHandover(command);
  }
  if (handover === null) {
    throw new AppError('NOT_FOUND', 'Cash handover is required for this command');
  }

  switch (command.type) {
    case 'SenderConfirmHandover':
      return senderConfirmHandover(handover, command);
    case 'ReceiverConfirmHandover':
      return receiverConfirmHandover(handover, command);
    case 'DisputeHandover':
      return disputeHandover(handover, command);
    case 'ResolveHandoverDispute':
      return resolveHandoverDispute(handover, command);
    case 'CancelHandover':
      return cancelHandover(handover, command);
  }
}
