import type { DailyOperationsRow, SalesPaymentRow } from './contracts';
import { formatLitres, formatMoney, sumExact, sumObservedExact, uniqueIds } from './domain';

export type ConsolidatedReconciliationTotals = Readonly<{
  litresSold: string;
  salesValue: string;
  cashDeclared: string;
  cashVariance: string;
  collectedCash: string;
  bankedCash: string;
  providerEvidence: string;
  providerSettledAmount: string;
  providerOutstandingAmount: string;
  recordedExpenses: string;
  inventoryVariance: string | null;
  deliveryLitres: string;
  customerCreditEvidence: string;
  prepaidEvidence: string;
  paymentBreakdown: readonly SalesPaymentRow[];
  reconciliationIds: readonly string[];
  collectionIds: readonly string[];
  depositIds: readonly string[];
  settlementIds: readonly string[];
  deliveryIds: readonly string[];
}>;

export type ConsolidatedReconciliationStationRow = Readonly<{
  stationId: string;
  stationCode: string;
  rowCount: number;
  totals: ConsolidatedReconciliationTotals;
}>;

export type ConsolidatedReconciliationReadModel = Readonly<{
  report: 'CONSOLIDATED_RECONCILIATION';
  scope: 'ALL_AUTHORIZED_STATIONS';
  stationCount: number;
  rowCount: number;
  stationRows: readonly ConsolidatedReconciliationStationRow[];
  totals: ConsolidatedReconciliationTotals;
}>;

type RowGroup = Readonly<{
  stationId: string;
  stationCode: string;
  rows: readonly DailyOperationsRow[];
}>;

function sumMoney(rows: readonly DailyOperationsRow[], key: keyof DailyOperationsRow): string {
  return formatMoney(sumExact(rows.map((row) => row[key] as string)));
}

function sumLitres(rows: readonly DailyOperationsRow[], key: keyof DailyOperationsRow): string {
  return formatLitres(sumExact(rows.map((row) => row[key] as string)));
}

function paymentBreakdown(rows: readonly DailyOperationsRow[]): readonly SalesPaymentRow[] {
  const byMethod = new Map<string, { amount: string[]; evidenceIds: string[] }>();
  for (const row of rows) {
    for (const payment of row.paymentBreakdown) {
      const current = byMethod.get(payment.method) ?? { amount: [], evidenceIds: [] };
      current.amount.push(payment.amount);
      current.evidenceIds.push(...payment.evidenceIds);
      byMethod.set(payment.method, current);
    }
  }
  return [...byMethod.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([method, value]) => ({
      method,
      amount: formatMoney(sumExact(value.amount)),
      evidenceIds: uniqueIds(value.evidenceIds),
    }));
}

function totals(rows: readonly DailyOperationsRow[]): ConsolidatedReconciliationTotals {
  const observedInventoryVariance = sumObservedExact(rows.map((row) => row.inventoryVariance));
  return {
    litresSold: sumLitres(rows, 'litresSold'),
    salesValue: sumMoney(rows, 'salesValue'),
    cashDeclared: sumMoney(rows, 'cashDeclared'),
    cashVariance: sumMoney(rows, 'cashVariance'),
    collectedCash: sumMoney(rows, 'collectedCash'),
    bankedCash: sumMoney(rows, 'bankedCash'),
    providerEvidence: sumMoney(rows, 'providerEvidence'),
    providerSettledAmount: sumMoney(rows, 'providerSettledAmount'),
    providerOutstandingAmount: sumMoney(rows, 'providerOutstandingAmount'),
    recordedExpenses: sumMoney(rows, 'recordedExpenses'),
    inventoryVariance:
      observedInventoryVariance === null
        ? rows.length === 0
          ? formatLitres('0')
          : null
        : formatLitres(observedInventoryVariance),
    deliveryLitres: sumLitres(rows, 'deliveryLitres'),
    customerCreditEvidence: sumMoney(rows, 'customerCreditEvidence'),
    prepaidEvidence: sumMoney(rows, 'prepaidEvidence'),
    paymentBreakdown: paymentBreakdown(rows),
    reconciliationIds: uniqueIds(rows.flatMap((row) => row.reconciliationIds)),
    collectionIds: uniqueIds(rows.flatMap((row) => row.collectionIds)),
    depositIds: uniqueIds(rows.flatMap((row) => row.depositIds)),
    settlementIds: uniqueIds(rows.flatMap((row) => row.settlementIds)),
    deliveryIds: uniqueIds(rows.flatMap((row) => row.deliveryIds)),
  };
}

function groupRows(rows: readonly DailyOperationsRow[]): RowGroup[] {
  const groups = new Map<string, DailyOperationsRow[]>();
  for (const row of rows) {
    const group = groups.get(row.stationId) ?? [];
    group.push(row);
    groups.set(row.stationId, group);
  }
  return [...groups.entries()]
    .map(([stationId, group]) => ({
      stationId,
      stationCode: group[0]?.stationCode ?? '',
      rows: group,
    }))
    .sort((left, right) => left.stationCode.localeCompare(right.stationCode));
}

/**
 * Aggregate only the already-authorized station rows. This deliberately has
 * no legal-entity balances: reconciliation facts are station facts, and each
 * input row can contribute to the consolidated result exactly once.
 */
export function buildConsolidatedReconciliationReadModel(
  rows: readonly DailyOperationsRow[],
): ConsolidatedReconciliationReadModel {
  const stationRows = groupRows(rows).map((group) => ({
    stationId: group.stationId,
    stationCode: group.stationCode,
    rowCount: group.rows.length,
    totals: totals(group.rows),
  }));
  return {
    report: 'CONSOLIDATED_RECONCILIATION',
    scope: 'ALL_AUTHORIZED_STATIONS',
    stationCount: stationRows.length,
    rowCount: rows.length,
    stationRows,
    totals: totals(rows),
  };
}
