import { describe, expect, it } from 'vitest';
import { AppError } from '../../platform/errors';
import {
  assertA5ProviderPaymentMethod,
  calculateSettlementSummary,
  deriveSettlementState,
} from './domain';

describe('provider settlement domain', () => {
  it('accepts only the audited A5 provider payment methods', () => {
    expect(() => assertA5ProviderPaymentMethod('POS')).not.toThrow();
    expect(() => assertA5ProviderPaymentMethod('ECOCASH')).not.toThrow();
    expect(() => assertA5ProviderPaymentMethod('CASH')).toThrowError(AppError);
  });

  it('derives exact decimal capacity and variance without binary arithmetic', () => {
    expect(
      calculateSettlementSummary({
        grossAmount: '100.0000',
        allocatedAmount: '60.1250',
        providerFeeAmount: '1.2500',
        providerDeductionAmount: '0.1250',
        reportedNetAmount: null,
        state: 'PARTIALLY_MATCHED',
      }),
    ).toMatchObject({
      unallocatedProviderAmount: '39.875',
      derivedNetAmount: '98.625',
      varianceAmount: '39.875',
    });
  });

  it('keeps allocation matching separate from explicit final reconciliation', () => {
    expect(deriveSettlementState('100.0000', '0', false)).toBe('RECORDED');
    expect(deriveSettlementState('100.0000', '40.0000', false)).toBe('PARTIALLY_MATCHED');
    expect(deriveSettlementState('100.0000', '100.0000', false)).toBe('RECONCILED');
    expect(deriveSettlementState('100.0000', '100.0000', true)).toBe('EXCEPTION');
  });
});
