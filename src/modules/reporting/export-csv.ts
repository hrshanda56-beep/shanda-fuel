/**
 * CSV export of one report. Built on the server from the authorised management
 * report, so every value is the authoritative string the report already carries:
 * nothing is parsed, rounded or recomputed here. Pure; no UI or database code.
 *
 * Each report is one table with stable headings. An empty report is the heading
 * row alone. Dates are business dates (YYYY-MM-DD) exactly as reported.
 */
import type { ReportDefinition } from './catalog';
import type { ManagementReport } from './contracts';

type Cell = string | number | null | undefined;
type Column<Row> = Readonly<{
  heading: string;
  /** Text cells are guarded against spreadsheet formula injection; numbers are not. */
  kind: 'text' | 'number';
  value: (row: Row) => Cell;
}>;

const text = <Row>(heading: string, value: (row: Row) => Cell): Column<Row> => ({
  heading,
  kind: 'text',
  value,
});
const number = <Row>(heading: string, value: (row: Row) => Cell): Column<Row> => ({
  heading,
  kind: 'number',
  value,
});

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: Cell, kind: 'text' | 'number' = 'text'): string {
  if (value === null || value === undefined) return '';
  let out = String(value);
  if (kind === 'text' && FORMULA_START.test(out)) out = `'${out}`;
  return /[",\r\n]/.test(out) ? `"${out.replaceAll('"', '""')}"` : out;
}

function table<Row>(columns: readonly Column<Row>[], rows: readonly Row[]): string {
  const lines = [columns.map((column) => csvCell(column.heading)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row), column.kind)).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function stationCodes(report: ManagementReport): (stationId: string) => string {
  const byId = new Map(report.stations.map((station) => [station.stationId, station.code]));
  return (stationId) => byId.get(stationId) ?? '';
}

type SalesRow = ManagementReport['sales']['rows'][number];
type ProviderRow = ManagementReport['providers']['rows'][number];
type InventoryRow = ManagementReport['inventory']['rows'][number];
type MeasureRow = readonly [string, string];
type ProfitLossRow = Readonly<{
  section: string;
  label: string;
  businessDate: string | null;
  stationCode: string;
  category: string | null;
  productCode: string | null;
  productName: string | null;
  litres: string | null;
  revenue: string | null;
  cost: string | null;
  profit: string | null;
  status: string | null;
  sourceIds: string | null;
}>;

type CommercialRow = {
  section: 'SUPPLIER' | 'CUSTOMER_BALANCE' | 'CUSTOMER_CREDIT_DRAWN';
  reference: string;
  name: string;
  stationCode: string;
  values: Partial<Record<(typeof COMMERCIAL_MEASURES)[number], string | number | null>>;
};

const COMMERCIAL_MEASURES = [
  'invoice_value',
  'credit_note_value',
  'payments',
  'outstanding_balance',
  'receivable_balance',
  'prepaid_value_balance',
  'reserved_amount',
  'reserved_litres',
  'drawn_amount',
  'drawn_litres',
  'authorization_count',
] as const;

function commercialRows(report: ManagementReport, code: (id: string) => string): CommercialRow[] {
  return [
    ...report.suppliers.rows.map((row): CommercialRow => ({
      section: 'SUPPLIER',
      reference: row.supplierCode,
      name: row.supplierName,
      stationCode: '',
      values: {
        invoice_value: row.invoiceValue,
        credit_note_value: row.creditNoteValue,
        payments: row.payments,
        outstanding_balance: row.outstandingBalance,
      },
    })),
    ...report.customers.rows.map((row): CommercialRow => ({
      section: 'CUSTOMER_BALANCE',
      reference: row.accountReference,
      name: row.displayName,
      stationCode: '',
      values: {
        receivable_balance: row.receivableBalance,
        prepaid_value_balance: row.prepaidValueBalance,
        reserved_amount: row.reservedAmount,
        reserved_litres: row.reservedLitres,
      },
    })),
    ...report.customers.activity.map((row): CommercialRow => ({
      section: 'CUSTOMER_CREDIT_DRAWN',
      reference: row.accountType,
      name: '',
      stationCode: code(row.stationId),
      values: {
        drawn_amount: row.drawnAmount,
        drawn_litres: row.drawnLitres,
        authorization_count: row.authorizationCount,
      },
    })),
  ];
}

function profitLossRows(report: ManagementReport, code: (id: string) => string): ProfitLossRow[] {
  const rows: ProfitLossRow[] = [
    {
      section: 'SUMMARY',
      label: 'Revenue',
      businessDate: null,
      stationCode: '',
      category: null,
      productCode: null,
      productName: null,
      litres: null,
      revenue: report.revenue.recognizedRevenue,
      cost: null,
      profit: null,
      status: report.revenue.revenueStatus,
      sourceIds: report.revenue.sales.map((sale) => sale.revenueMovementId).join(';'),
    },
    {
      section: 'SUMMARY',
      label: 'Cost of sales',
      businessDate: null,
      stationCode: '',
      category: null,
      productCode: null,
      productName: null,
      litres: null,
      revenue: null,
      cost: report.costing.restatedCogs,
      profit: null,
      status: report.costing.costingStatus,
      sourceIds: report.costing.sales.map((sale) => sale.saleMovementId).join(';'),
    },
    {
      section: 'SUMMARY',
      label: 'Gross profit',
      businessDate: null,
      stationCode: '',
      category: null,
      productCode: null,
      productName: null,
      litres: null,
      revenue: null,
      cost: null,
      profit: report.grossMargin,
      status: report.grossMargin === null ? 'UNAVAILABLE' : 'COMPLETE',
      sourceIds: null,
    },
    {
      section: 'SUMMARY',
      label: 'Operating expenses',
      businessDate: null,
      stationCode: '',
      category: null,
      productCode: null,
      productName: null,
      litres: null,
      revenue: null,
      cost: report.expenses.total,
      profit: null,
      status: 'POSTED',
      sourceIds: null,
    },
  ];
  rows.push(
    ...report.fuelProfit.map((fuel) => ({
      section: 'FUEL',
      label: 'Fuel profit',
      businessDate: null,
      stationCode: '',
      category: null,
      productCode: fuel.productCode,
      productName: fuel.productName,
      litres: fuel.litres,
      revenue: fuel.revenue,
      cost: fuel.cost,
      profit: fuel.profit,
      status: fuel.status,
      sourceIds: [...fuel.revenueMovementIds, ...fuel.costMovementIds].join(';'),
    })),
  );
  rows.push(
    ...report.expenses.rows.map((expense) => ({
      section: 'EXPENSE',
      label: 'Recognized expense',
      businessDate: expense.businessDate,
      stationCode: code(expense.stationId),
      category: expense.category,
      productCode: null,
      productName: null,
      litres: null,
      revenue: null,
      cost: expense.amount,
      profit: null,
      status: 'POSTED',
      sourceIds: [...expense.sourceIds, ...expense.recognitionMovementIds].join(';'),
    })),
  );
  return rows;
}

export function buildReportCsv(slug: ReportDefinition['slug'], report: ManagementReport): string {
  const code = stationCodes(report);
  switch (slug) {
    case 'profit-loss':
      return table<ProfitLossRow>(
        [
          text('section', (row) => row.section),
          text('label', (row) => row.label),
          text('business_date', (row) => row.businessDate),
          text('station_code', (row) => row.stationCode),
          text('category', (row) => row.category),
          text('product_code', (row) => row.productCode),
          text('product_name', (row) => row.productName),
          number('litres', (row) => row.litres),
          number('revenue', (row) => row.revenue),
          number('cost', (row) => row.cost),
          number('profit', (row) => row.profit),
          text('status', (row) => row.status),
          text('source_ids', (row) => row.sourceIds),
        ],
        profitLossRows(report, code),
      );
    case 'sales':
      return table<SalesRow>(
        [
          text('business_date', (row) => row.businessDate),
          text('station_code', (row) => row.stationCode),
          text('product_code', (row) => row.productCode),
          text('product_name', (row) => row.productName),
          number('litres_sold', (row) => row.litres),
          number('sales_value', (row) => row.salesValue),
          number('average_realized_price', (row) => row.averageRealizedPrice),
          number('variance', (row) => row.variance),
        ],
        report.sales.rows,
      );
    case 'cash': {
      const position = report.cash;
      return table(
        [
          text<MeasureRow>('measure', (row) => row[0]),
          number<MeasureRow>('amount', (row) => row[1]),
        ],
        [
          ['cash_evidence', position.cashEvidence],
          ['collected', position.collected],
          ['awaiting_collection', position.awaitingCollection],
          ['banked', position.banked],
          ['collected_not_banked', position.collectedButNotBanked],
          ['cash_variance', position.cashVariance],
        ] as const,
      );
    }
    case 'providers':
      return table<ProviderRow>(
        [
          text('settlement_reference', (row) => row.settlementReference),
          text('provider_name', (row) => row.providerName),
          text('station_code', (row) => code(row.stationId)),
          text('transaction_date', (row) => row.transactionDate),
          text('settlement_date', (row) => row.settlementDate),
          number('gross_amount', (row) => row.grossAmount),
          number('allocated_amount', (row) => row.allocatedAmount),
          number('unallocated_amount', (row) => row.unallocatedAmount),
          number('fees_and_deductions', (row) => row.feesAndDeductions),
          number('variance', (row) => row.variance),
        ],
        report.providers.rows,
      );
    case 'commercial':
      return table<CommercialRow>(
        [
          text('section', (row) => row.section),
          text('reference', (row) => row.reference),
          text('name', (row) => row.name),
          text('station_code', (row) => row.stationCode),
          ...COMMERCIAL_MEASURES.map((measure) =>
            number<CommercialRow>(measure, (row) => row.values[measure]),
          ),
        ],
        commercialRows(report, code),
      );
    case 'inventory':
      return table<InventoryRow>(
        [
          text('station_code', (row) => code(row.stationId)),
          text('tank_code', (row) => row.tankCode),
          text('product_code', (row) => row.productCode),
          text('product_name', (row) => row.productName),
          number('expected_litres', (row) => row.expectedLitres),
          number('physical_litres', (row) => row.physicalLitres),
          number('variance_litres', (row) => row.varianceLitres),
          number('delivery_litres', (row) => row.deliveryLitres),
          number('delivery_value', (row) => row.deliveryValue),
          text('as_of_date', () => report.filters.toDate),
        ],
        report.inventory.rows,
      );
    default:
      throw new Error(`No CSV export is defined for report "${slug}"`);
  }
}

/** e.g. `sales_2026-10-01_to_2026-10-31.csv`, or `…_2-stations.csv` for a subset. */
export function reportCsvFilename(
  slug: string,
  fromDate: string,
  toDate: string,
  stationCount: number,
): string {
  const scope = stationCount > 0 ? `_${stationCount}-station${stationCount === 1 ? '' : 's'}` : '';
  return `${slug}_${fromDate}_to_${toDate}${scope}.csv`;
}
