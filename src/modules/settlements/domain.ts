import { AppError } from '../../platform/errors';
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';

export const A5_PROVIDER_PAYMENT_METHODS = ['POS', 'ECOCASH'] as const;
export type A5ProviderPaymentMethod = (typeof A5_PROVIDER_PAYMENT_METHODS)[number];

export type ProviderSettlementState = 'RECORDED' | 'PARTIALLY_MATCHED' | 'RECONCILED' | 'EXCEPTION';

export type ProviderSettlementSummary = {
  grossAmount: string;
  allocatedAmount: string;
  unallocatedProviderAmount: string;
  providerFeeAmount: string | null;
  providerDeductionAmount: string | null;
  reportedNetAmount: string | null;
  derivedNetAmount: string | null;
  /** The charge the account's fee settings say it should have taken. */
  expectedFeeAmount: string | null;
  /** Charges actually kept less expected: positive means the provider took more. */
  feeDifferenceAmount: string | null;
  varianceAmount: string;
  state: ProviderSettlementState;
};

function decimal(value: string): ExactDecimal {
  return new ExactDecimal(value, DECIMAL_POLICIES.money);
}

/** Normalize authoritative monetary values at the settlement API boundary. */
export function formatSettlementMoney(value: string): string {
  return decimal(value)
    .quantize(DECIMAL_POLICIES.money)
    .value.toFixed(DECIMAL_POLICIES.money.scale);
}

export function isA5ProviderPaymentMethod(value: string): value is A5ProviderPaymentMethod {
  return (A5_PROVIDER_PAYMENT_METHODS as readonly string[]).includes(value);
}

export function assertA5ProviderPaymentMethod(
  value: string,
): asserts value is A5ProviderPaymentMethod {
  if (!isA5ProviderPaymentMethod(value)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Only POS and ECOCASH A5 payment evidence can be matched to a provider settlement',
    );
  }
}

export function deriveSettlementState(
  grossAmount: string,
  allocatedAmount: string,
  hasVariance: boolean,
): ProviderSettlementState {
  const gross = decimal(grossAmount);
  const allocated = decimal(allocatedAmount);
  if (hasVariance) return 'EXCEPTION';
  if (allocated.equals(new ExactDecimal('0'))) return 'RECORDED';
  if (allocated.equals(gross)) return 'RECONCILED';
  return 'PARTIALLY_MATCHED';
}

/**
 * The charge a provider account should take from a settlement: the percentage of the gross plus
 * the fixed fee, rounded to the cent-and-a-bit the books use (four places). Null when the account
 * has no fee settings.
 */
export function computeExpectedFee(input: {
  grossAmount: string;
  feePercent: string | null;
  feeFixed: string | null;
}): string | null {
  if (input.feePercent === null && input.feeFixed === null) return null;
  const gross = decimal(input.grossAmount).value;
  const percent = new ExactDecimal(input.feePercent ?? '0').value;
  const fixed = decimal(input.feeFixed ?? '0').value;
  const total = gross.mul(percent).div(100).add(fixed);
  // Rounded once, half-up (the global decimal rule), to the four places money is kept in.
  return formatSettlementMoney(total.toDecimalPlaces(4).toFixed(4));
}

/**
 * What the provider actually kept (fee plus other deductions, or gross less the reported net),
 * against what it should have kept. Positive means the provider took more than expected.
 */
export function feeDifference(input: {
  grossAmount: string;
  providerFeeAmount: string | null;
  providerDeductionAmount: string | null;
  reportedNetAmount: string | null;
  expectedFeeAmount: string | null;
}): string | null {
  if (input.expectedFeeAmount === null) return null;
  const gross = decimal(input.grossAmount);
  let kept: ExactDecimal | null = null;
  if (input.reportedNetAmount !== null) kept = gross.subtract(decimal(input.reportedNetAmount));
  else if (input.providerFeeAmount !== null || input.providerDeductionAmount !== null)
    kept = decimal(input.providerFeeAmount ?? '0').add(
      decimal(input.providerDeductionAmount ?? '0'),
    );
  if (kept === null) return null;
  return formatSettlementMoney(kept.subtract(decimal(input.expectedFeeAmount)).toString());
}

export function calculateSettlementSummary(input: {
  grossAmount: string;
  allocatedAmount: string;
  providerFeeAmount: string | null;
  providerDeductionAmount: string | null;
  reportedNetAmount: string | null;
  expectedFeeAmount?: string | null;
  state: ProviderSettlementState;
}): ProviderSettlementSummary {
  const gross = decimal(input.grossAmount);
  const allocated = decimal(input.allocatedAmount);
  const derivedNet =
    input.reportedNetAmount !== null
      ? decimal(input.reportedNetAmount)
      : input.providerFeeAmount !== null || input.providerDeductionAmount !== null
        ? gross
            .subtract(decimal(input.providerFeeAmount ?? '0'))
            .subtract(decimal(input.providerDeductionAmount ?? '0'))
        : null;
  return {
    grossAmount: formatSettlementMoney(gross.toString()),
    allocatedAmount: formatSettlementMoney(allocated.toString()),
    unallocatedProviderAmount: formatSettlementMoney(gross.subtract(allocated).toString()),
    providerFeeAmount:
      input.providerFeeAmount === null ? null : formatSettlementMoney(input.providerFeeAmount),
    providerDeductionAmount:
      input.providerDeductionAmount === null
        ? null
        : formatSettlementMoney(input.providerDeductionAmount),
    reportedNetAmount:
      input.reportedNetAmount === null ? null : formatSettlementMoney(input.reportedNetAmount),
    derivedNetAmount: derivedNet ? formatSettlementMoney(derivedNet.toString()) : null,
    expectedFeeAmount:
      input.expectedFeeAmount == null ? null : formatSettlementMoney(input.expectedFeeAmount),
    feeDifferenceAmount: feeDifference({
      grossAmount: input.grossAmount,
      providerFeeAmount: input.providerFeeAmount,
      providerDeductionAmount: input.providerDeductionAmount,
      reportedNetAmount: input.reportedNetAmount,
      expectedFeeAmount: input.expectedFeeAmount ?? null,
    }),
    varianceAmount: formatSettlementMoney(gross.subtract(allocated).toString()),
    state: input.state,
  };
}

export function assertSettlementCanReceiveAllocation(state: ProviderSettlementState): void {
  if (state === 'RECONCILED') {
    throw new AppError(
      'CONFLICT',
      'A reconciled provider settlement is finalized; use a named allocation reversal first',
    );
  }
}

export function assertSettlementCanBeReconciled(state: ProviderSettlementState): void {
  if (state === 'RECONCILED') {
    throw new AppError('CONFLICT', 'The provider settlement is already reconciled');
  }
}
