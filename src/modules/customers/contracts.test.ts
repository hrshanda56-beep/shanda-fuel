import { describe, expect, it } from 'vitest';
import { assertA5EvidenceCompatibleWithAccount } from './index';
import { businessDate, money, litres, type CurrencyCode } from '../../platform/domain/primitives';

const evidence = {
  eventType: 'a5.customer_fuel_allocation_posted.v1' as const,
  eventVersion: 1 as const,
  tenantId: 'tenant-a',
  stationId: 'station-a',
  reconciliationId: 'reconciliation-a',
  reconciliationRevisionId: 'revision-a',
  paymentEvidenceId: 'payment-a',
  category: 'CUSTOMER_CREDIT' as const,
  customerAccountReference: 'CUST-001',
  allocation: { productId: 'diesel', litres: litres('10'), amount: money('20') },
  currency: 'USD' as const,
  businessDate: businessDate('2026-09-23'),
  occurredAt: '2026-09-23T08:00:00Z',
  source: { sourceType: 'A5_RECONCILIATION_CUSTOMER_FUEL' as const, sourceId: 'payment-a' },
};

describe('A5 customer account integration contract', () => {
  it('accepts customer-credit evidence only for a credit account', () => {
    expect(() => assertA5EvidenceCompatibleWithAccount(evidence, 'CREDIT')).not.toThrow();
    expect(() => assertA5EvidenceCompatibleWithAccount(evidence, 'PREPAID_VALUE')).toThrow(
      'requires a credit account',
    );
  });

  it('accepts prepaid evidence for either prepaid account representation', () => {
    const prepaidEvidence = { ...evidence, category: 'PREPAID' as const };
    expect(() =>
      assertA5EvidenceCompatibleWithAccount(prepaidEvidence, 'PREPAID_VALUE'),
    ).not.toThrow();
    expect(() =>
      assertA5EvidenceCompatibleWithAccount(prepaidEvidence, 'PREPAID_LITRES'),
    ).not.toThrow();
  });

  it('rejects evidence whose declared currency differs from its amount', () => {
    expect(() =>
      assertA5EvidenceCompatibleWithAccount(
        { ...evidence, currency: 'ZWL' as CurrencyCode },
        'CREDIT',
      ),
    ).toThrow('currency must match');
  });
});
