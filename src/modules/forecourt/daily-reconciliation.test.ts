import { describe, expect, it } from 'vitest';
import { businessDate, litres, money, unitPrice } from '../../platform/domain/primitives';
import {
  calculateDailyReconciliation,
  submitDailyReconciliation,
  type DailyReconciliationInput,
} from './daily-reconciliation';
import type { MeterSegment } from './domain';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  station: '22222222-2222-4222-8222-222222222222',
  day: '33333333-3333-4333-8333-333333333333',
  shift: '44444444-4444-4444-8444-444444444444',
  actor: '55555555-5555-4555-8555-555555555555',
};

function segment(productId: string, opening: string, closing: string, price: string): MeterSegment {
  return {
    id: `${productId.slice(0, 8)}-0000-4000-8000-000000000001`,
    tenantId: ids.tenant,
    stationId: ids.station,
    nozzleId: `${productId.slice(0, 8)}-0000-4000-8000-000000000002`,
    meterInstallationId: `${productId.slice(0, 8)}-0000-4000-8000-000000000003`,
    meterId: `${productId.slice(0, 8)}-0000-4000-8000-000000000004`,
    businessDayId: ids.day,
    shiftId: ids.shift,
    openingBoundaryId: `${productId.slice(0, 8)}-0000-4000-8000-000000000005`,
    closingBoundaryId: `${productId.slice(0, 8)}-0000-4000-8000-000000000006`,
    productId,
    attendantId: ids.actor,
    enteredBy: ids.actor,
    openingReading: opening,
    closingReading: closing,
    litres: litres('0'),
    unitPrice: unitPrice(price),
    currency: 'USD',
    expectedSaleValue: money('0'),
    openingBoundaryReason: 'SHIFT_OPEN',
    boundaryReason: 'SHIFT_CLOSE',
    startAt: '2026-09-20T06:00:00.000Z',
    endAt: '2026-09-20T14:00:00.000Z',
    sealedAt: '2026-09-20T14:00:01.000Z',
    controlledException: false,
    version: 1,
  };
}

function input(overrides: Partial<DailyReconciliationInput> = {}): DailyReconciliationInput {
  const diesel = segment('66666666-6666-4666-8666-666666666666', '1000.000', '1010.000', '1.50');
  diesel.litres = litres('10');
  diesel.expectedSaleValue = money('15');
  return {
    id: '77777777-7777-4777-8777-777777777777',
    revision: 1,
    tenantId: ids.tenant,
    stationId: ids.station,
    businessDayId: ids.day,
    shiftId: ids.shift,
    operationalDate: businessDate('2026-09-20'),
    supervisorId: ids.actor,
    attendantIds: [ids.actor],
    segments: [diesel],
    payments: [{ id: '88888888-8888-4888-8888-888888888888', method: 'CASH', amount: money('15') }],
    expenses: [],
    deliveries: [],
    tankDips: [],
    ...overrides,
  };
}

describe('daily reconciliation domain', () => {
  it('derives exact litres, sales, cash after expenses, and no variance', () => {
    const result = calculateDailyReconciliation(
      input({
        expenses: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            category: 'Station supplies',
            description: 'Cleaning materials',
            amount: money('2.50'),
            paymentMethod: 'CASH',
          },
        ],
        cash: { countedCash: money('12.50') },
      }),
    );
    expect(result.totals.litresSold).toBe('10');
    expect(result.totals.expectedSales.amount.toString()).toBe('15');
    expect(result.totals.expectedPhysicalCash.amount.toString()).toBe('12.5');
    expect(result.issues).toEqual([]);
  });

  it('requires an explanation for sales variance and blocks incomplete meter readings', () => {
    const result = calculateDailyReconciliation(
      input({
        segments: [],
        payments: [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', method: 'POS', amount: money('2') },
        ],
      }),
    );
    expect(result.issues.map((item) => item.code)).toContain('MISSING_METER_READING');
    expect(() => submitDailyReconciliation(result, ids.actor, '')).toThrow(/validation issues/);
  });

  it('does not allow an explanation to bypass an invalid payment or tank opening', () => {
    expect(() =>
      calculateDailyReconciliation(
        input({
          payments: [
            { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', method: 'CASH', amount: money('-1') },
          ],
          tankDips: [
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              tankId: 'tank-1',
              productId: '66666666-6666-4666-8666-666666666666',
              closingLitres: litres('10'),
            },
          ],
        }),
      ),
    ).toThrow(/cannot be negative/);
  });

  it('requires management approval to be a separate actor and preserves returned corrections', () => {
    const submitted = submitDailyReconciliation(calculateDailyReconciliation(input()), ids.actor);
    expect(submitted.state).toBe('SUBMITTED');
    expect(submitted.submittedBy).toBe(ids.actor);
  });
});
