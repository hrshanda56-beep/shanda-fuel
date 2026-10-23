import { describe, expect, it } from 'vitest';
import { productionReconciliationPaymentSchema } from './production-reconciliation';

describe('A5 customer payment evidence boundary', () => {
  it('accepts CUSTOMER_CREDIT and PREPAID as typed payment methods without account fields', () => {
    for (const method of ['CUSTOMER_CREDIT', 'PREPAID'] as const) {
      expect(
        productionReconciliationPaymentSchema.parse({ method, amount: '50.0000' }),
      ).toMatchObject({ method, amount: '50.0000' });
    }
  });

  it('treats the empty customer and beneficiary of a saved draft as none', () => {
    const parsed = productionReconciliationPaymentSchema.parse({
      method: 'CASH',
      amount: '10.0000',
      customerAccountId: null,
      beneficiaryName: null,
    });
    expect(parsed.customerAccountId).toBeUndefined();
    expect(parsed.beneficiaryName).toBeUndefined();
  });
});
