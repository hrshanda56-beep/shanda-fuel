import { describe, expect, it } from 'vitest';
import {
  derivePaymentSettlementStatus,
  overdueAfterDays,
  overdueLimitFor,
  paymentSettlementLabel,
  providerBatchLabel,
  providerCharges,
  settlementRecordLabel,
} from './status';

const base = { amount: '200.0000', allocatedAmount: '0', businessDate: '2026-10-10' };

describe('payment settlement status', () => {
  it('is awaiting inside the limit and overdue past it', () => {
    const input = { ...base, overdueAfterDays: 3 };
    expect(derivePaymentSettlementStatus({ ...input, today: '2026-10-13' })).toBe('AWAITING');
    expect(derivePaymentSettlementStatus({ ...input, today: '2026-10-14' })).toBe('OVERDUE');
  });

  it('is partly settled while part has arrived and it is not yet late', () => {
    expect(
      derivePaymentSettlementStatus({
        ...base,
        allocatedAmount: '0.0001',
        today: '2026-10-11',
        overdueAfterDays: 3,
      }),
    ).toBe('PARTLY_SETTLED');
  });

  it('stays overdue when only part has arrived and it is late', () => {
    expect(
      derivePaymentSettlementStatus({
        ...base,
        allocatedAmount: '100',
        today: '2026-11-01',
        overdueAfterDays: 3,
      }),
    ).toBe('OVERDUE');
  });

  it('is settled once everything is matched, however old', () => {
    expect(
      derivePaymentSettlementStatus({ ...base, allocatedAmount: '200', today: '2027-01-01' }),
    ).toBe('SETTLED');
  });

  it('uses the shared default limit when none is configured', () => {
    expect(overdueAfterDays(null)).toBe(3);
    expect(overdueAfterDays(7)).toBe(7);
    expect(overdueAfterDays(-1)).toBe(3);
  });
});

describe('provider charges and old vocabularies', () => {
  it('adds fee and deductions exactly', () => {
    expect(providerCharges({ feeAmount: '1.1000', deductionAmount: '0.2000' })).toBe('1.3');
    expect(providerCharges({ feeAmount: '1.5', deductionAmount: null })).toBe('1.5');
    expect(providerCharges({ feeAmount: null, deductionAmount: null })).toBeNull();
  });

  it('maps both stored vocabularies to the same plain names', () => {
    expect(settlementRecordLabel('RECORDED')).toBe(paymentSettlementLabel('AWAITING'));
    expect(settlementRecordLabel('PARTIALLY_MATCHED')).toBe('Partly settled');
    expect(settlementRecordLabel('RECONCILED')).toBe('Settled');
    expect(providerBatchLabel('DECLARED')).toBe('Awaiting settlement');
    expect(providerBatchLabel('SETTLED')).toBe('Settled');
    expect(providerBatchLabel('DISPUTED')).toBe('Needs review');
    expect(providerBatchLabel('WEIRD')).toBe('WEIRD');
  });
});

describe('mobile money overdue limit', () => {
  it('gives mobile money two more days than card', () => {
    expect(overdueLimitFor('CARD')).toBe(3);
    expect(overdueLimitFor('MOBILE_MONEY')).toBe(5);
    expect(overdueLimitFor('MOBILE_MONEY', 7)).toBe(9);
  });
});
