import { describe, expect, it } from 'vitest';
import type { ManagementReport } from './contracts';
import { buildDashboardSnapshot, countDaysWithoutReport } from './dashboard-snapshot';

const report = (over: Record<string, unknown> = {}) =>
  ({
    sales: {
      rows: [
        { productName: 'Diesel', litres: '100.0000' },
        { productName: 'Petrol', litres: '40.0000' },
        { productName: 'Diesel', litres: '25.5000' },
      ],
    },
    cash: { cashEvidence: '300.0000', collected: '290.0000' },
    inventory: {
      rows: [{ varianceLitres: '-5.0000' }, { varianceLitres: null }, { varianceLitres: '2.0000' }],
    },
    ...over,
  }) as unknown as ManagementReport;

describe('buildDashboardSnapshot', () => {
  it('splits litres by fuel, summing across days', () => {
    expect(buildDashboardSnapshot(report()).litresByProduct).toEqual([
      { productName: 'Diesel', litres: '125.5' },
      { productName: 'Petrol', litres: '40' },
    ]);
  });

  it('compares expected cash with what was collected', () => {
    const { cash } = buildDashboardSnapshot(report());
    expect(cash.expected).toBe('300.0000');
    expect(cash.collected).toBe('290.0000');
    expect(Number(cash.difference)).toBe(-10);
  });

  it('sums stock variance over measured tanks only', () => {
    const { stockVariance } = buildDashboardSnapshot(report());
    expect(Number(stockVariance.litres)).toBe(-3);
    expect(stockVariance.tanksMeasured).toBe(2);
    expect(stockVariance.tanksTotal).toBe(3);
  });

  it('leaves variance unknown, not zero, when no tank has a reading', () => {
    const snapshot = buildDashboardSnapshot(
      report({ inventory: { rows: [{ varianceLitres: null }] } }),
    );
    expect(snapshot.stockVariance.litres).toBeNull();
  });
});

describe('countDaysWithoutReport', () => {
  it('counts station days that have rows but no reconciliation', () => {
    expect(
      countDaysWithoutReport([
        { reportDate: '2026-10-01', stationId: 'a', reconciliationIds: ['r1'] },
        { reportDate: '2026-10-02', stationId: 'a', reconciliationIds: [] },
        { reportDate: '2026-10-02', stationId: 'a', reconciliationIds: [] },
        { reportDate: '2026-10-02', stationId: 'b' },
      ]),
    ).toBe(2);
  });
});
