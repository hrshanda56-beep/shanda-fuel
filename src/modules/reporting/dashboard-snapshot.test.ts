import { describe, expect, it } from 'vitest';
import type { ManagementReport } from './contracts';
import { buildDashboardSnapshot } from './dashboard-snapshot';

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
    filters: { toDate: '2026-10-29' },
    inventory: {
      rows: [
        { varianceLitres: '-5.0000', lastDipDate: '2026-10-29' },
        { varianceLitres: null, lastDipDate: null },
        { varianceLitres: '2.0000', lastDipDate: '2026-10-29' },
      ],
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

  it('does not call cash paid out of the till for expenses a shortage', () => {
    // 300 of cash sales, 40 paid out for expenses: 260 is what should be handed over. Handing over
    // exactly that is no difference at all.
    const { cash } = buildDashboardSnapshot(
      report({
        cash: { cashEvidence: '300.0000', cashPaidExpenses: '40.0000', collected: '260.0000' },
      }),
    );
    expect(cash.expected).toBe('260.0000');
    expect(Number(cash.difference)).toBe(0);
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
      report({ inventory: { rows: [{ varianceLitres: null, lastDipDate: null }] } }),
    );
    expect(snapshot.stockVariance.litres).toBeNull();
  });

  it('counts a tank as measured only when its latest dip is on the last day (A4)', () => {
    const { stockVariance } = buildDashboardSnapshot(
      report({
        inventory: {
          rows: [
            { varianceLitres: '-5.0000', lastDipDate: '2026-10-29' },
            // Dipped three weeks ago: that is not a measurement for this day.
            { varianceLitres: '40.0000', lastDipDate: '2026-10-08' },
          ],
        },
      }),
    );
    expect(stockVariance.tanksMeasured).toBe(1);
    expect(stockVariance.tanksTotal).toBe(2);
    expect(Number(stockVariance.litres)).toBe(-5);
  });
});
