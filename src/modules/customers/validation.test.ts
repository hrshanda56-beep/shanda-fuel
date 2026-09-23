import { describe, expect, it } from 'vitest';
import { createCustomerAccountSchema, recordPrepaidTopUpSchema } from './validation';

const ids = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  customerId: '00000000-0000-4000-8000-000000000002',
  accountId: '00000000-0000-4000-8000-000000000003',
  productId: '00000000-0000-4000-8000-000000000004',
};

const source = {
  sourceType: 'PREPAID_TOPUP' as const,
  sourceId: '00000000-0000-4000-8000-000000000005',
};

describe('customer command validation contracts', () => {
  it('accepts an arbitrary uppercase currency code without inventing FX behavior', () => {
    const result = createCustomerAccountSchema.parse({
      commandType: 'CreateCustomerAccount',
      tenantId: ids.tenantId,
      customerId: ids.customerId,
      accountType: 'CREDIT',
      currency: 'ZWL',
      creditLimit: '1000.0000',
    });
    expect(result.currency).toBe('ZWL');
  });

  it('requires value-only or litre-only prepaid top-up shapes', () => {
    expect(() =>
      recordPrepaidTopUpSchema.parse({
        commandType: 'RecordPrepaidTopUp',
        tenantId: ids.tenantId,
        accountId: ids.accountId,
        accountType: 'PREPAID_VALUE',
        productId: ids.productId,
        amount: { amount: '10.0000', currency: 'USD' },
        source,
        occurredAt: '2026-09-23T08:00:00Z',
        businessDate: '2026-09-23',
      }),
    ).toThrow('Prepaid value top-ups require only a monetary amount');

    const result = recordPrepaidTopUpSchema.parse({
      commandType: 'RecordPrepaidTopUp',
      tenantId: ids.tenantId,
      accountId: ids.accountId,
      accountType: 'PREPAID_LITRES',
      productId: ids.productId,
      litres: '20.000',
      source,
      occurredAt: '2026-09-23T08:00:00Z',
      businessDate: '2026-09-23',
    });
    expect(result.litres).toBe('20.000');
  });
});
