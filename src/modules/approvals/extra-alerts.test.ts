import { describe, expect, it } from 'vitest';
import { buildActionCenter, type ActionCenterFacts } from './action-center-model';
import {
  DEFAULT_EXTRA_ALERT_SETTINGS,
  buildExtraAlerts,
  type ExtraAlertFacts,
} from './extra-alerts';

const base: ExtraAlertFacts = {
  today: '2026-10-20',
  unbankedCash: [],
  expenses: [],
  belowPriceSales: [],
  shortDeliveries: [],
  approvedInformationChanges: 0,
};
const station = { id: 's1' };
const run = (facts: Partial<ExtraAlertFacts>) =>
  buildExtraAlerts({ ...base, ...facts }, DEFAULT_EXTRA_ALERT_SETTINGS, station);

describe('extra alerts', () => {
  it('says nothing when nothing is wrong or nothing could be checked', () => {
    expect(run({})).toEqual([]);
    expect(
      run({
        unbankedCash: null,
        expenses: null,
        belowPriceSales: null,
        shortDeliveries: null,
        approvedInformationChanges: null,
      }),
    ).toEqual([]);
  });

  it('flags only cash that has waited at least the threshold days, summed exactly', () => {
    const alerts = run({
      unbankedCash: [
        { reference: 'a', businessDate: '2026-10-18', amount: '100.10' },
        { reference: 'b', businessDate: '2026-10-15', amount: '50.20' },
        { reference: 'c', businessDate: '2026-10-19', amount: '999' },
      ],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toContain('150.3');
    expect(alerts[0]!.detail).toContain('2026-10-15');
  });

  it('flags expenses at or above the threshold only', () => {
    const alerts = run({
      expenses: [
        { id: 'e1', expenseDate: '2026-10-19', description: 'Generator', amount: '500.00' },
        { id: 'e2', expenseDate: '2026-10-19', description: 'Tea', amount: '499.99' },
      ],
    });
    expect(alerts.map((a) => a.id)).toEqual(['expense-high-e1']);
  });

  it('flags sales below the approved price and not at or above it', () => {
    const alerts = run({
      belowPriceSales: [
        {
          businessDate: '2026-10-19',
          product: 'Diesel',
          soldPrice: '1.4900',
          approvedPrice: '1.5000',
          litres: '10',
        },
        {
          businessDate: '2026-10-19',
          product: 'Petrol',
          soldPrice: '1.5000',
          approvedPrice: '1.5000',
          litres: '10',
        },
      ],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toContain('Diesel');
  });

  it('flags deliveries short by the minimum or more', () => {
    const alerts = run({
      shortDeliveries: [
        {
          id: 'd1',
          businessDate: '2026-10-19',
          product: 'Diesel',
          deliveryNote: 'N1',
          shortLitres: '20',
        },
        {
          id: 'd2',
          businessDate: '2026-10-19',
          product: 'Diesel',
          deliveryNote: 'N2',
          shortLitres: '19.999',
        },
      ],
    });
    expect(alerts.map((a) => a.id)).toEqual(['delivery-short-d1']);
  });

  it('reports changes to approved information as information, with the right count', () => {
    const [alert] = run({ approvedInformationChanges: 3 });
    expect(alert!.tone).toBe('info');
    expect(alert!.title).toContain('3 approved records were');
  });

  it('appears in the Action Center and is reported unavailable, never as all clear', () => {
    const ok = { status: 'ok' } as const;
    const facts: ActionCenterFacts = {
      tenantId: 't',
      stationId: 's1',
      reconciliations: { status: 'restricted' },
      revaluations: { status: 'restricted' },
      cash: { status: 'restricted' },
      settlements: { status: 'restricted' },
      suppliers: { status: 'restricted' },
      customers: { status: 'restricted' },
      today: null,
      reports: { status: 'restricted' },
      stock: { status: 'restricted' },
      extra: { ...ok, value: { ...base, approvedInformationChanges: 2 } },
    };
    expect(buildActionCenter(facts).items.map((i) => i.id)).toContain(
      'approved-information-changed',
    );
    const failed = buildActionCenter({ ...facts, extra: { status: 'unavailable' } });
    expect(failed.unavailable).toContain('Cash, expense and delivery checks');
  });

  it('flags overdue customers by the oldest unpaid charge, and names accounts over their limit', () => {
    const alerts = run({
      customerOverdue: [
        {
          accountId: 'a1',
          customerId: 'c1',
          customerName: 'Acme',
          oldestUnpaidDate: '2026-09-20',
          owed: '50.0000',
        },
        {
          accountId: 'a2',
          customerId: 'c2',
          customerName: 'Young',
          oldestUnpaidDate: '2026-10-10',
          owed: '9.0000',
        },
      ],
      customerOverLimit: [
        {
          accountId: 'a3',
          customerId: 'c3',
          customerName: 'Tendai Moyo',
          kind: 'STAFF_BENEFIT_MONTH',
          amount: '55.0000',
          limit: '50.0000',
        },
      ],
    });
    expect(alerts.map((a) => a.id)).toEqual(['customer-overdue-a1', 'customer-over-limit-a3']);
    expect(alerts[0]!.title).toContain('Acme');
    expect(alerts[1]!.title).toContain('monthly staff fuel limit');
    expect(alerts.every((a) => a.tone === 'attention')).toBe(true);
  });

  it('says nothing about customers it could not check', () => {
    expect(run({ customerOverdue: null, customerOverLimit: null })).toEqual([]);
  });
});
