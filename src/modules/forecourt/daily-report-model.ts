import { sumDecimals } from '../cash/ui/cash-visuals';

/** Raw rows the daily report is built from; every figure stays an exact decimal string. */
export type DailyReportInput = Readonly<{
  stationName: string;
  timezone: string;
  businessDate: string;
  state: string;
  shiftStartAt: string | null;
  shiftEndAt: string | null;
  supervisorName: string | null;
  attendantNames: readonly string[];
  readings: ReadonlyArray<{
    pumpNumber: string;
    nozzleNumber: string;
    productId: string;
    productName: string;
    openingReading: string;
    closingReading: string;
    litresSold: string;
    unitPrice: string;
    salesValue: string;
  }>;
  expenses: ReadonlyArray<{
    category: string;
    description: string;
    amount: string;
    paymentMethod: string;
  }>;
  dips: ReadonlyArray<{
    tankCode: string;
    productName: string;
    measuredAt: string;
    rawMeasurement: string | null;
    measurementUnit: string | null;
    physicalLitres: string;
  }>;
  cash: Readonly<{ countedCash: string; netExpectedCash: string; cashVariance: string }> | null;
  drops: ReadonlyArray<{ toLocation: string; amount: string; state: string }>;
  monthToDate: Readonly<{
    fromDate: string;
    products: ReadonlyArray<{ productName: string; litres: string; sales: string }>;
    expenses: string;
    shifts: number;
  }>;
}>;

export type DailyReportPump = Readonly<{
  label: string;
  opening: string;
  closing: string;
  litres: string;
}>;

export type DailyReportProduct = Readonly<{
  productName: string;
  /** One price when every pump sold at the same price; otherwise each distinct price. */
  prices: readonly string[];
  pumps: readonly DailyReportPump[];
  totalLitres: string;
  salesValue: string;
}>;

export type DailyReportDip = Readonly<{
  tankCode: string;
  productName: string;
  /** With two or more dips the first is opening and the last is closing; a lone dip is shown as it is. */
  opening: DailyReportDipReading | null;
  closing: DailyReportDipReading;
}>;

export type DailyReportDipReading = Readonly<{
  measurement: string | null;
  unit: string | null;
  litres: string;
}>;

export type DailyReport = Readonly<{
  stationName: string;
  businessDate: string;
  state: string;
  timezone: string;
  shiftStartAt: string | null;
  shiftEndAt: string | null;
  products: readonly DailyReportProduct[];
  expenses: Readonly<{
    lines: ReadonlyArray<{ description: string; amount: string }>;
    total: string | null;
  }>;
  drops: Readonly<{
    lines: ReadonlyArray<{ toLocation: string; amount: string; state: string }>;
    total: string | null;
  }>;
  cash: DailyReportInput['cash'];
  dips: readonly DailyReportDip[];
  supervisorName: string | null;
  attendantNames: readonly string[];
  monthToDate: DailyReportInput['monthToDate'];
}>;

function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function buildDailyReport(input: DailyReportInput): DailyReport {
  const byProduct = new Map<string, DailyReportInput['readings'][number][]>();
  for (const reading of input.readings) {
    const list = byProduct.get(reading.productId) ?? [];
    list.push(reading);
    byProduct.set(reading.productId, list);
  }
  const products: DailyReportProduct[] = [...byProduct.values()]
    .map((rows) => {
      const pumps = rows
        .map((row) => ({
          label: `Pump ${row.pumpNumber} · ${row.nozzleNumber}`,
          opening: row.openingReading,
          closing: row.closingReading,
          litres: row.litresSold,
          sortKey: `${row.pumpNumber}\u0000${row.nozzleNumber}`,
        }))
        .sort((a, b) => compareLabels(a.sortKey, b.sortKey))
        .map(({ sortKey: _sortKey, ...pump }) => pump);
      return {
        productName: rows[0]!.productName,
        prices: [...new Set(rows.map((row) => row.unitPrice))].sort(compareLabels),
        pumps,
        totalLitres: sumDecimals(rows.map((row) => row.litresSold)),
        salesValue: sumDecimals(rows.map((row) => row.salesValue)),
      };
    })
    .sort((a, b) => compareLabels(a.productName, b.productName));

  const dipsByTank = new Map<string, DailyReportInput['dips'][number][]>();
  for (const dip of input.dips) {
    const list = dipsByTank.get(dip.tankCode) ?? [];
    list.push(dip);
    dipsByTank.set(dip.tankCode, list);
  }
  const reading = (dip: DailyReportInput['dips'][number]): DailyReportDipReading => ({
    measurement: dip.rawMeasurement,
    unit: dip.measurementUnit,
    litres: dip.physicalLitres,
  });
  const dips: DailyReportDip[] = [...dipsByTank.entries()]
    .map(([tankCode, rows]) => {
      const ordered = [...rows].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
      const first = ordered[0]!;
      const last = ordered[ordered.length - 1]!;
      return {
        tankCode,
        productName: first.productName,
        opening: ordered.length > 1 ? reading(first) : null,
        closing: reading(last),
      };
    })
    .sort((a, b) => compareLabels(a.tankCode, b.tankCode));

  return {
    stationName: input.stationName,
    businessDate: input.businessDate,
    state: input.state,
    timezone: input.timezone,
    shiftStartAt: input.shiftStartAt,
    shiftEndAt: input.shiftEndAt,
    products,
    expenses: {
      lines: input.expenses.map((row) => ({
        description: row.description ? `${row.category} · ${row.description}` : row.category,
        amount: row.amount,
      })),
      total: input.expenses.length ? sumDecimals(input.expenses.map((row) => row.amount)) : null,
    },
    drops: {
      lines: input.drops,
      total: input.drops.length ? sumDecimals(input.drops.map((row) => row.amount)) : null,
    },
    cash: input.cash,
    dips,
    supervisorName: input.supervisorName,
    attendantNames: input.attendantNames,
    monthToDate: input.monthToDate,
  };
}

function dipText(dip: DailyReportDipReading): string {
  return dip.measurement !== null
    ? `${dip.measurement}${dip.unit ?? ''}-${dip.litres}Ltr`
    : `${dip.litres}Ltr`;
}

/** The same layout the attendants send on WhatsApp, so it can be pasted straight into the chat. */
export function formatDailyReportText(report: DailyReport): string {
  const lines: string[] = [report.businessDate, ''];
  for (const product of report.products) {
    lines.push(`${product.productName.toUpperCase()} SALES`);
    lines.push(`Price: $${product.prices.join(' / $')}`);
    for (const pump of product.pumps) {
      lines.push(
        `${pump.label}`,
        `Closing: ${pump.closing}`,
        `Opening: ${pump.opening}`,
        `Ltrs: ${pump.litres}`,
        '',
      );
    }
    lines.push(`Total litres sold: ${product.totalLitres}`, '');
  }
  lines.push('Expenses');
  if (report.expenses.lines.length === 0) lines.push('None recorded');
  for (const line of report.expenses.lines) lines.push(`${line.description} ${line.amount}`);
  if (report.expenses.total !== null) lines.push(`Total ${report.expenses.total}`);
  lines.push('');
  lines.push(report.drops.total === null ? 'Drop: none recorded' : `Drop: ${report.drops.total}`);
  if (report.cash) {
    lines.push(
      `Available cash (USD): ${report.cash.countedCash}`,
      `Excess/Shortfall: ${report.cash.cashVariance}`,
    );
  } else {
    lines.push('Available cash: not counted');
  }
  lines.push('', 'Site dips');
  if (report.dips.length === 0) lines.push('None recorded');
  for (const dip of report.dips) {
    lines.push(
      `${dip.productName} (${dip.tankCode})`,
      ...(dip.opening ? [`Opening: ${dipText(dip.opening)}`] : []),
      `${dip.opening ? 'Closing' : 'Dip'}: ${dipText(dip.closing)}`,
    );
  }
  lines.push(
    '',
    `Attendants: ${report.attendantNames.length ? report.attendantNames.join(', ') : 'none recorded'}`,
    `Supervisor: ${report.supervisorName ?? 'none recorded'}`,
  );
  return lines.join('\n');
}
