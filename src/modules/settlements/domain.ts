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
  varianceAmount: string;
  state: ProviderSettlementState;
};

function decimal(value: string): ExactDecimal {
  return new ExactDecimal(value, DECIMAL_POLICIES.money);
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

export function calculateSettlementSummary(input: {
  grossAmount: string;
  allocatedAmount: string;
  providerFeeAmount: string | null;
  providerDeductionAmount: string | null;
  reportedNetAmount: string | null;
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
    grossAmount: gross.toString(),
    allocatedAmount: allocated.toString(),
    unallocatedProviderAmount: gross.subtract(allocated).toString(),
    providerFeeAmount: input.providerFeeAmount,
    providerDeductionAmount: input.providerDeductionAmount,
    reportedNetAmount: input.reportedNetAmount,
    derivedNetAmount: derivedNet?.toString() ?? null,
    varianceAmount: gross.subtract(allocated).toString(),
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
