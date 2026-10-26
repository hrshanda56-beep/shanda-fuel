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
      unallocatedProviderAmount: '39.8750',
      derivedNetAmount: '98.6250',
      varianceAmount: '39.8750',
    });
  });

  it('keeps allocation matching separate from explicit final reconciliation', () => {
    expect(deriveSettlementState('100.0000', '0', false)).toBe('RECORDED');
    expect(deriveSettlementState('100.0000', '40.0000', false)).toBe('PARTIALLY_MATCHED');
    expect(deriveSettlementState('100.0000', '100.0000', false)).toBe('RECONCILED');
    expect(deriveSettlementState('100.0000', '100.0000', true)).toBe('EXCEPTION');
  });
});

describe('provider account fees', () => {
  it('works out the charge from a percentage and a fixed fee, rounded once to four places', async () => {
    const { computeExpectedFee } = await import('./domain');
    expect(computeExpectedFee({ grossAmount: '200', feePercent: '1', feeFixed: null })).toBe(
      '2.0000',
    );
    expect(computeExpectedFee({ grossAmount: '200', feePercent: '1.5', feeFixed: '0.10' })).toBe(
      '3.1000',
    );
    expect(computeExpectedFee({ grossAmount: '33.3333', feePercent: '1', feeFixed: null })).toBe(
      '0.3333',
    );
    expect(computeExpectedFee({ grossAmount: '100', feePercent: null, feeFixed: '0.25' })).toBe(
      '0.2500',
    );
    expect(computeExpectedFee({ grossAmount: '100', feePercent: null, feeFixed: null })).toBeNull();
  });

  it('compares what the provider kept with what it should have', async () => {
    const { feeDifference } = await import('./domain');
    const base = { grossAmount: '200', expectedFeeAmount: '2.0000', providerDeductionAmount: null };
    // Kept 3.50 (reported net 196.50): 1.50 too much.
    expect(feeDifference({ ...base, providerFeeAmount: null, reportedNetAmount: '196.5' })).toBe(
      '1.5000',
    );
    // Typed fee 2 plus a 0.25 deduction: 0.25 too much.
    expect(
      feeDifference({
        ...base,
        providerFeeAmount: '2',
        providerDeductionAmount: '0.25',
        reportedNetAmount: null,
      }),
    ).toBe('0.2500');
    // Took less than expected: negative.
    expect(feeDifference({ ...base, providerFeeAmount: '1.5', reportedNetAmount: null })).toBe(
      '-0.5000',
    );
    // Nothing to compare with.
    expect(feeDifference({ ...base, providerFeeAmount: null, reportedNetAmount: null })).toBeNull();
    expect(
      feeDifference({
        ...base,
        expectedFeeAmount: null,
        providerFeeAmount: '2',
        reportedNetAmount: null,
      }),
    ).toBeNull();
  });
});
