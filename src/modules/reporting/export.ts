import type { ManagementReport } from './contracts';

type CsvRow = readonly [string, string];

export type ManagementReportExportOptions = Readonly<{
  /** The instant at which the export artifact was generated, in ISO-8601 form. */
  generatedAt?: string;
}>;

function escapeCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function scalar(value: unknown): string | null {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function uniqueIds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function generatedAt(options: ManagementReportExportOptions): string {
  const value = options.generatedAt ?? new Date().toISOString();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Management report export generatedAt must be a valid ISO timestamp');
  }
  return parsed.toISOString();
}

function sourceLineage(report: ManagementReport) {
  return {
    sales: {
      dateBasis: report.dateBasis.sales,
      reconciliationIds: uniqueIds(report.sales.reconciliationIds),
    },
    cash: {
      dateBasis: {
        evidence: report.dateBasis.cashEvidence,
        collections: report.dateBasis.cashCollections,
        banked: report.dateBasis.bankedCash,
      },
      collectionIds: uniqueIds(report.cash.collectionIds),
      depositIds: uniqueIds(report.cash.depositIds),
    },
    providers: {
      dateBasis: {
        paymentEvidence: report.dateBasis.providerEvidence,
        settlements: report.dateBasis.providerSettlements,
      },
      settlementIds: uniqueIds(report.providers.rows.map((row) => row.settlementId)),
    },
    suppliers: {
      dateBasis: report.dateBasis.suppliers,
      supplierIds: uniqueIds(report.suppliers.rows.map((row) => row.supplierId)),
    },
    customers: {
      dateBasis: report.dateBasis.customers,
      customerIds: uniqueIds(report.customers.rows.map((row) => row.customerId)),
    },
    inventory: {
      dateBasis: report.dateBasis.inventory,
      movementIds: uniqueIds(report.inventory.rows.flatMap((row) => row.movementIds)),
      deliveryIds: uniqueIds(report.inventory.rows.flatMap((row) => row.deliveryIds)),
    },
    expenses: {
      dateBasis: report.dateBasis.expenses,
      expenseIds: uniqueIds(report.expenses.rows.flatMap((row) => row.expenseIds)),
    },
    revenue: {
      dateBasis: report.dateBasis.recognizedRevenue,
      revenueMovementIds: uniqueIds(report.revenue.sales.map((row) => row.revenueMovementId)),
    },
    costing: {
      saleMovementIds: uniqueIds(report.costing.sales.map((row) => row.saleMovementId)),
      revaluationLineIds: uniqueIds(report.costing.sales.flatMap((row) => row.revaluationLineIds)),
      revaluationEventIds: uniqueIds(
        report.costing.sales.flatMap((row) => row.revaluationEventIds),
      ),
    },
  };
}

export function getManagementReportExportMetadata(
  report: ManagementReport,
  options: ManagementReportExportOptions = {},
) {
  const stationIds = report.filters.stationId
    ? [report.filters.stationId]
    : uniqueIds(report.stations.map((station) => station.stationId));
  const sectionCounts = {
    stations: report.stations.length,
    sales: report.sales.rows.length,
    payments: report.sales.payments.length,
    cashEvidence: report.cash.collectionIds.length + report.cash.depositIds.length,
    providers: report.providers.rows.length,
    suppliers: report.suppliers.rows.length,
    customers: report.customers.rows.length,
    inventory: report.inventory.rows.length,
    expenses: report.expenses.rows.length,
    revenue: report.revenue.sales.length,
    costing: report.costing.sales.length,
  };
  const emptySections = Object.entries(sectionCounts)
    .filter(([, count]) => count === 0)
    .map(([section]) => section);

  return {
    exportFormat: 'management-report-csv.v1',
    sourceLineageVersion: 'management-report-sources.v1',
    generatedAt: generatedAt(options),
    report: report.report,
    state: report.state,
    currency: report.currency,
    scopeType: report.filters.stationId ? 'STATION' : 'TENANT',
    tenantId: report.filters.tenantId,
    stationId: report.filters.stationId ?? null,
    stationIds,
    filters: report.filters,
    emptyReport: emptySections.length === Object.keys(sectionCounts).length,
    emptySections,
    sectionCounts,
    sourceLineage: sourceLineage(report),
  };
}

function flatten(value: unknown, path: string, rows: CsvRow[]): void {
  const primitive = scalar(value);
  if (primitive !== null) {
    rows.push([path, primitive]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, rows));
    if (value.length === 0) rows.push([path, '']);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    Object.keys(value)
      .sort()
      .forEach((key) =>
        flatten((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key, rows),
      );
  }
}

/**
 * Serializes the already-authorized canonical management report without
 * recalculating any financial values or converting decimals through floats.
 */
export function serializeManagementReportCsv(
  report: ManagementReport,
  options: ManagementReportExportOptions = {},
): string {
  const rows: CsvRow[] = [['field', 'value']];
  flatten({ metadata: getManagementReportExportMetadata(report, options) }, '', rows);
  flatten(report, '', rows);
  return `${rows.map(([field, value]) => `${escapeCell(field)},${escapeCell(value)}`).join('\n')}\n`;
}
