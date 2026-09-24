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
});
