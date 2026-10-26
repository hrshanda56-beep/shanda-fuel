import { describe, expect, it } from 'vitest';
import {
  isWithinShiftWindow,
  productionReconciliationAttendantsSchema,
  productionReconciliationPaymentSchema,
} from './production-reconciliation';

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

  it('requires at least one distinct declared attendant', () => {
    const base = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      stationId: '22222222-2222-4222-8222-222222222222',
      reconciliationId: '33333333-3333-4333-8333-333333333333',
      expectedVersion: 0,
    };
    expect(() =>
      productionReconciliationAttendantsSchema.parse({ ...base, attendantIds: [] }),
    ).toThrow('At least one attendant');
    expect(() =>
      productionReconciliationAttendantsSchema.parse({
        ...base,
        attendantIds: [
          '44444444-4444-4444-8444-444444444444',
          '44444444-4444-4444-8444-444444444444',
        ],
      }),
    ).toThrow('cannot be declared twice');
  });

  it('uses a half-open shift window for delivery and dip evidence', () => {
    const start = '2026-10-26T06:00:00.000Z';
    const end = '2026-10-26T14:00:00.000Z';
    expect(isWithinShiftWindow('2026-10-26T06:00:00.000Z', start, end)).toBe(true);
    expect(isWithinShiftWindow('2026-10-26T13:59:59.999Z', start, end)).toBe(true);
    expect(isWithinShiftWindow(end, start, end)).toBe(false);
    expect(isWithinShiftWindow('2026-10-26T05:59:59.999Z', start, end)).toBe(false);
  });
});
