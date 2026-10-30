import type { ManagementReport } from './contracts';
import { formatMoney, subtractExact, sumExact } from './domain';

export type DashboardSnapshot = Readonly<{
  /** Litres sold per fuel, in the order the fuels first appear. */
  litresByProduct: readonly { productName: string; litres: string }[];
  /** Cash the sales say should have been handed in, against what was actually collected. */
  cash: Readonly<{ expected: string; collected: string; difference: string }>;
  /** Dip reading minus expected stock, summed over tanks that have a reading; null when none do. */
  stockVariance: Readonly<{ litres: string | null; tanksMeasured: number; tanksTotal: number }>;
}>;

/**
 * The dashboard's extra figures, each from a number the management report already carries.
 * Nothing is estimated: a tank with no dip reading is left out of the variance, not counted as zero.
 */
export function buildDashboardSnapshot(report: ManagementReport): DashboardSnapshot {
  const byProduct = new Map<string, string[]>();
  for (const row of report.sales.rows) {
    byProduct.set(row.productName, [...(byProduct.get(row.productName) ?? []), row.litres]);
  }
  // Cash paid out of the till for expenses is never handed over, so it is not expected either.
  const expectedCash = formatMoney(
    subtractExact(report.cash.cashEvidence, report.cash.cashPaidExpenses ?? '0'),
  );
  // A tank is measured for the report's last day only when its latest dip was taken that day, the
  // same test the shift report applies. A dip from weeks ago is not a measurement for today.
  const measured = report.inventory.rows.filter(
    (row) => row.varianceLitres !== null && row.lastDipDate === report.filters.toDate,
  );
  return {
    litresByProduct: [...byProduct].map(([productName, litres]) => ({
      productName,
      litres: sumExact(litres),
    })),
    cash: {
      expected: expectedCash,
      collected: report.cash.collected,
      difference: subtractExact(report.cash.collected, expectedCash),
    },
    stockVariance: {
      litres: measured.length === 0 ? null : sumExact(measured.map((row) => row.varianceLitres!)),
      tanksMeasured: measured.length,
      tanksTotal: report.inventory.rows.length,
    },
  };
}
