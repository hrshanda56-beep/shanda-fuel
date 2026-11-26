import { describe, expect, it } from 'vitest';

import type { ConfigurationSetupOverview } from './contracts';
import { buildStationOverview, quantityText } from './station-overview';

const caps = {
  products: true,
  tanks: true,
  forecourt: true,
  shiftTemplates: true,
  priceRequest: true,
  priceApprove: true,
  priceActivate: true,
  suppliers: true,
};

function data(over: Partial<ConfigurationSetupOverview> = {}): ConfigurationSetupOverview {
  return {
    tenantId: 't',
    stationId: 's',
    stationStatus: 'ACTIVE',
    capabilities: caps,
    products: [{ id: 'p1', code: 'D', name: 'Diesel 50', status: 'ACTIVE', unit: 'LITRES' }],
    tanks: [
      {
        id: 't1',
        code: 'TANK1',
        productId: 'p1',
        capacityLitres: '30000.000',
        reorderLevelLitres: null,
        acceptableVarianceLitres: '50.000',
        varianceRedLitres: null,
        unused: true,
        status: 'ACTIVE',
      },
    ],
    pumps: [{ id: 'u1', number: '1', name: null, status: 'ACTIVE', unused: true }],
    nozzles: [
      {
        id: 'n1',
        pumpId: 'u1',
        number: '2',
        productId: 'p1',
        status: 'ACTIVE',
        meterSerialNumber: null,
        meterWorkingSince: null,
        meterWorkingSinceEditable: false,
        unused: true,
      },
    ],
    shiftTemplates: [
      {
        id: 'sh',
        code: 'DAY',
        name: 'Day shift',
        startTime: '06:00:00',
        durationMinutes: 720,
        active: true,
        version: 1,
      },
    ],
    prices: [
      {
        id: 'pr',
        productId: 'p1',
        unitPrice: '1.6000',
        currency: 'USD',
        state: 'ACTIVE',
        effectiveFrom: '2026-01-01',
        version: 1,
      },
    ],
    suppliers: [],
    supervisors: [{ membershipId: 'm1', name: 'Chipo Dube' }],
    responsibleSupervisorMembershipId: 'm1',
    blockers: [],
    ...over,
  };
}

describe('quantityText', () => {
  it('groups thousands and drops only zeros after the point', () => {
    expect(quantityText('30000.000')).toBe('30,000');
    expect(quantityText('1500.500')).toBe('1,500.5');
    expect(quantityText('100')).toBe('100');
  });
});

describe('buildStationOverview', () => {
  it('reads a complete station', () => {
    const view = buildStationOverview(data());
    expect(view.counts).toEqual({ fuels: 1, tanks: 1, pumps: 1, shifts: 1 });
    expect(view.fuels[0]).toMatchObject({
      name: 'Diesel 50',
      price: '1.6000',
      tanks: ['TANK1 · 30,000 litres'],
      nozzles: ['Pump 1, nozzle 2'],
      done: true,
    });
    expect(view.shifts[0]).toEqual({ id: 'sh', name: 'Day shift', when: '06:00 to 18:00' });
    expect(view.supervisor).toBe('Chipo Dube');
    expect(view.todo).toEqual([]);
  });

  it('lists what is missing in words', () => {
    const view = buildStationOverview(
      data({ prices: [], shiftTemplates: [], responsibleSupervisorMembershipId: null }),
    );
    expect(view.fuels[0]!.priceNote).toBe('No price yet');
    expect(view.todo).toEqual(['Diesel 50: a price', 'Add a shift', 'Choose who is in charge']);
  });

  it('says a price is waiting for approval', () => {
    const view = buildStationOverview(
      data({
        prices: [
          {
            id: 'pr',
            productId: 'p1',
            unitPrice: '1.7',
            currency: 'USD',
            state: 'PENDING_APPROVAL',
            effectiveFrom: '2026-01-01',
            version: 1,
          },
        ],
      }),
    );
    expect(view.fuels[0]!.priceNote).toBe('Waiting for approval');
  });

  it('shows nothing for sections the person may not read', () => {
    const view = buildStationOverview(
      data({ products: null, tanks: null, pumps: null, nozzles: null, shiftTemplates: null }),
    );
    expect(view.counts.fuels).toBe(0);
  });
});
