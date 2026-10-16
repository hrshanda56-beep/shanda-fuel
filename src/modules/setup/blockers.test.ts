import { describe, expect, it } from 'vitest';
import { computeSetupBlockers } from './blockers';
import type { ConfigurationSetupOverview } from './contracts';

const empty: Omit<ConfigurationSetupOverview, 'blockers'> = {
  tenantId: 't',
  stationId: 's',
  stationTimezone: 'Africa/Harare',
  stationStatus: 'ONBOARDING',
  capabilities: {
    products: true,
    tanks: true,
    forecourt: true,
    shiftTemplates: true,
    priceRequest: true,
    priceApprove: true,
    priceActivate: true,
    suppliers: true,
  },
  products: [],
  tanks: [],
  pumps: [],
  nozzles: [],
  shiftTemplates: [],
  prices: [],
  suppliers: [],
};

describe('computeSetupBlockers', () => {
  it('reports every missing prerequisite on an empty station', () => {
    expect(computeSetupBlockers(empty).map((b) => b.code)).toEqual([
      'NO_PRODUCT',
      'NO_TANK',
      'NO_NOZZLE',
      'NO_SHIFT_TEMPLATE',
    ]);
  });

  it('blocks a nozzle product without an ACTIVE price, not a pending one', () => {
    const data = {
      ...empty,
      products: [{ id: 'p1', code: 'DSL', name: 'Diesel', status: 'ACTIVE' }],
      nozzles: [
        {
          id: 'n1',
          pumpId: 'u',
          number: '1',
          productId: 'p1',
          status: 'ACTIVE',
          meterSerialNumber: 'x',
        },
      ],
      prices: [
        {
          id: 'x',
          productId: 'p1',
          unitPrice: '1.5',
          currency: 'USD',
          state: 'PENDING_APPROVAL',
          effectiveFrom: '2026-10-13T00:00:00.000Z',
          effectiveTo: null,
          version: 1,
        },
      ],
    };
    const blockers = computeSetupBlockers(data);
    expect(blockers.find((b) => b.code === 'NO_PRICE')?.message).toContain('Diesel');
    const active = {
      ...data,
      prices: [{ ...data.prices[0]!, state: 'ACTIVE' }],
    };
    expect(
      computeSetupBlockers(active, new Date('2026-10-16T00:00:00.000Z')).map((b) => b.code),
    ).not.toContain('NO_PRICE');
  });

  it('does not treat a future or ended active price as effective', () => {
    const data = {
      ...empty,
      products: [{ id: 'p1', code: 'DSL', name: 'Diesel', status: 'ACTIVE' }],
      nozzles: [
        {
          id: 'n1',
          pumpId: 'u',
          number: '1',
          productId: 'p1',
          status: 'ACTIVE',
          meterSerialNumber: 'x',
        },
      ],
      prices: [
        {
          id: 'x',
          productId: 'p1',
          unitPrice: '1.5',
          currency: 'USD',
          state: 'ACTIVE',
          effectiveFrom: '2026-10-17T00:00:00.000Z',
          effectiveTo: null,
          version: 1,
        },
      ],
    };
    expect(
      computeSetupBlockers(data, new Date('2026-10-16T00:00:00.000Z')).find(
        (b) => b.code === 'NO_PRICE',
      )?.message,
    ).toContain('effective yet');
    expect(
      computeSetupBlockers(
        {
          ...data,
          prices: [
            {
              ...data.prices[0]!,
              effectiveFrom: '2026-10-01T00:00:00.000Z',
              effectiveTo: '2026-10-15T00:00:00.000Z',
            },
          ],
        },
        new Date('2026-10-16T00:00:00.000Z'),
      ).find((b) => b.code === 'NO_PRICE')?.message,
    ).toContain('effective active');
  });

  it('does not infer blockers from sections the caller cannot read', () => {
    expect(
      computeSetupBlockers({
        ...empty,
        products: null,
        tanks: null,
        nozzles: null,
        shiftTemplates: null,
        prices: null,
      }),
    ).toEqual([]);
  });
});
