import type { ManagementReport } from './contracts';
import { subtractExact, sumExact } from './domain';

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
  const measured = report.inventory.rows.filter((row) => row.varianceLitres !== null);
  return {
    litresByProduct: [...byProduct].map(([productName, litres]) => ({
      productName,
      litres: sumExact(litres),
    })),
    cash: {
      expected: report.cash.cashEvidence,
      collected: report.cash.collected,
      difference: subtractExact(report.cash.collected, report.cash.cashEvidence),
    },
    stockVariance: {
      litres: measured.length === 0 ? null : sumExact(measured.map((row) => row.varianceLitres!)),
      tanksMeasured: measured.length,
      tanksTotal: report.inventory.rows.length,
    },
  };
}

/**
 * Station days that have activity but no approved report. The daily report returns a row for a
 * day that only has collections, deposits or deliveries; with no reconciliation behind it the
 * day's report has not been submitted and approved.
 */
export function countDaysWithoutReport(
  rows: readonly { reportDate: string; stationId: string; reconciliationIds?: readonly string[] }[],
  expectedBusinessDays?: number,
): number {
  const approvedDays = new Set(
    rows
      .filter((row) => (row.reconciliationIds ?? []).length > 0)
      .map((row) => `${row.stationId}|${row.reportDate}`),
  ).size;
  if (expectedBusinessDays !== undefined) {
    return Math.max(0, expectedBusinessDays - approvedDays);
  }
  return new Set(
    rows
      .filter((row) => (row.reconciliationIds ?? []).length === 0)
      .map((row) => `${row.stationId}|${row.reportDate}`),
  ).size;
}
