import { describe, expect, it } from 'vitest';
import type { ManagementReport } from './contracts';
import { dailyProfitFromReport } from './daily-profit';
import { buildFinanceTiles } from './finance-tiles';
import { buildProfitAndLoss } from './statements';

/**
 * A3 / B7 / G1: one profit, everywhere. The same period must give the same operating profit on the
 * dashboard tile, the profit statement and the Daily Profit page, and the day-by-day rows must add
 * up to the period total in every column.
 */
const days = [
  {
    date: '2026-10-01',
    revenue: '1000.0000',
    cost: '800.0000',
    operating: '50.0000',
    fixed: '75.3100',
    staffFuel: '20.0000',
  },
  {
    date: '2026-10-02',
    revenue: '1200.0000',
    cost: '950.0000',
    operating: '60.0000',
    fixed: '172.0800',
    staffFuel: '0.0000',
  },
  {
    date: '2026-10-03',
    revenue: '900.0000',
    cost: '700.0000',
    operating: '40.0000',
    fixed: '172.0800',
    staffFuel: '13.3400',
  },
];

const sum = (values: string[]) => values.reduce((total, value) => total + Number(value), 0);

const report = (() => {
  const revenue = sum(days.map((d) => d.revenue));
  const cost = sum(days.map((d) => d.cost));
  const operating = sum(days.map((d) => d.operating));
  const fixed = sum(days.map((d) => d.fixed));
  const staffFuel = sum(days.map((d) => d.staffFuel));
  return {
    grossMargin: (revenue - cost).toFixed(4),
    revenue: {
      recognizedRevenue: revenue.toFixed(4),
      sales: days.map((d) => ({
        businessDate: d.date,
        productId: 'diesel',
        productCode: 'DSL',
        productName: 'Diesel',
        recognizedRevenue: d.revenue,
        quantityLitres: '500.0000',
      })),
    },
    costing: {
      restatedCogs: cost.toFixed(4),
      costingStatus: 'COMPLETE',
      saleCount: days.length,
      unvaluedSaleCount: 0,
      sales: days.map((d) => ({
        businessDate: d.date,
        productId: 'diesel',
        productCode: 'DSL',
        productName: 'Diesel',
        restatedCogs: d.cost,
        valuationStatus: 'VALUED',
      })),
    },
    expenses: {
      operatingTotal: operating.toFixed(4),
      fixedCostTotal: fixed.toFixed(4),
      directInventoryCostTotal: '0.0000',
      total: (operating + fixed).toFixed(4),
      rows: days.flatMap((d) => [
        {
          businessDate: d.date,
          classification: 'OPERATING',
          category: 'Utilities',
          amount: d.operating,
        },
        { businessDate: d.date, classification: 'FIXED_COST', category: 'Rent', amount: d.fixed },
      ]),
    },
    sales: {
      salesValue: revenue.toFixed(4),
      payments: [{ method: 'STAFF_OR_MANAGEMENT_FUEL', amount: staffFuel.toFixed(4) }],
      staffFuelByDate: days.map((d) => ({ businessDate: d.date, amount: d.staffFuel })),
    },
    cash: { collectedButNotBanked: '0.0000', banked: '0.0000' },
    providers: { unmatchedEvidenceAmount: '0.0000' },
    suppliers: { outstandingBalance: '0.0000' },
    customers: { availability: 'AVAILABLE', receivableBalance: '0.0000' },
  } as unknown as ManagementReport;
})();

const cents = (value: string | null) => (value === null ? null : Number(value).toFixed(2));

describe('one operating profit across screens', () => {
  const expected = (() => {
    const gross = sum(days.map((d) => d.revenue)) - sum(days.map((d) => d.cost));
    return (
      gross -
      sum(days.map((d) => d.operating)) -
      sum(days.map((d) => d.fixed)) -
      sum(days.map((d) => d.staffFuel))
    ).toFixed(2);
  })();

  it('the dashboard tile gives the expected figure', () => {
    const tile = buildFinanceTiles(report).find((t) => t.id === 'operatingProfit')!;
    expect(cents(tile.value)).toBe(expected);
  });

  it('the profit statement gives the same figure', () => {
    const net = buildProfitAndLoss(report)
      .groups.flatMap((group) => group.lines)
      .find((line) => line.label === 'Net operating result')!;
    expect(cents(net.value)).toBe(expected);
  });

  it('the Daily Profit page period total gives the same figure', () => {
    expect(cents(dailyProfitFromReport(report).operatingProfitAfterBenefit)).toBe(expected);
  });

  it('every day row is after staff fuel, so the days add up to the period', () => {
    const summary = dailyProfitFromReport(report);
    const daily = summary.days.map((day) => day.combined.operatingProfit!);
    expect(sum(daily).toFixed(2)).toBe(expected);
    expect(cents(summary.combined.operatingProfit)).toBe(expected);
  });

  it('the days add up to the period in every column', () => {
    const summary = dailyProfitFromReport(report);
    for (const column of [
      'sales',
      'costOfFuelSold',
      'grossProfit',
      'expenses',
      'fixedCosts',
    ] as const) {
      const daily = summary.days.map((day) => day.combined[column]!);
      expect(sum(daily).toFixed(2), column).toBe(Number(summary.combined[column]).toFixed(2));
    }
  });
});
