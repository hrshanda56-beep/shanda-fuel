/**
 * The station daily report: the per-station, per-day table the owner keeps in Excel (diesel and
 * petrol side by side, then expenses and profit). Pure part: the report definition and the row
 * building. It regroups figures the system already holds (canonical revenue, restated cost of
 * sales, recognised expenses) through `buildDailyProfit`, so it can never disagree with the
 * daily profit screen. The query is in `read-daily-report.ts`.
 */
import { buildDailyProfit, type FuelProfitLine } from '../../profitability/daily-profit';
import { formatLitres, formatMoney, sumExact } from '../domain';
import type { TableReportDefinition, TableReportRow } from './definitions';

export const STATION_DAILY_REPORT: TableReportDefinition = {
  slug: 'station-daily-report',
  title: 'Station Daily Report',
  description:
    'One line per station per day: diesel and petrol litres, sales, cost and gross profit, then expenses, fixed costs and operating profit.',
  category: 'sales',
  scope: 'station',
  emptyMessage: 'No approved sales or expenses were recorded for these dates and stations.',
  columns: [
    { key: 'date', label: 'Date', kind: 'text' },
    { key: 'station', label: 'Station', kind: 'text' },
    { key: 'dieselLitres', label: 'Diesel litres', kind: 'number' },
    { key: 'dieselSales', label: 'Diesel sales (USD)', kind: 'number' },
    { key: 'dieselCost', label: 'Diesel cost of fuel sold (USD)', kind: 'number' },
    { key: 'dieselGross', label: 'Diesel gross profit (USD)', kind: 'number' },
    { key: 'petrolLitres', label: 'Petrol litres', kind: 'number' },
    { key: 'petrolSales', label: 'Petrol sales (USD)', kind: 'number' },
    { key: 'petrolCost', label: 'Petrol cost of fuel sold (USD)', kind: 'number' },
    { key: 'petrolGross', label: 'Petrol gross profit (USD)', kind: 'number' },
    { key: 'totalSales', label: 'Total sales (USD)', kind: 'number' },
    { key: 'totalGross', label: 'Total gross profit (USD)', kind: 'number' },
    { key: 'expenses', label: 'Running expenses (USD)', kind: 'number' },
    { key: 'fixedCosts', label: 'Fixed costs for the day (USD)', kind: 'number' },
    { key: 'totalExpenses', label: 'Total expenses (USD)', kind: 'number' },
    { key: 'staffFuel', label: 'Fuel given to staff (USD)', kind: 'number' },
    { key: 'operatingProfit', label: 'Operating profit (USD)', kind: 'number' },
    { key: 'notes', label: 'Notes', kind: 'text' },
  ],
};

export type DailyReportSale = Readonly<{
  stationId: string;
  businessDate: string;
  productId: string;
  productCode: string;
  productName: string;
  recognizedRevenue: string;
  quantityLitres: string;
}>;

export type DailyReportCost = Readonly<{
  stationId: string;
  businessDate: string;
  productId: string;
  productCode?: string;
  productName?: string;
  restatedCogs: string | null;
  valuationStatus: string;
}>;

export type DailyReportExpense = Readonly<{
  stationId: string;
  stationName: string;
  businessDate: string;
  classification: 'OPERATING' | 'FIXED_COST' | 'DIRECT_INVENTORY_COST';
  amount: string;
  description: string | null;
}>;

const isDiesel = (fuel: FuelProfitLine) =>
  /diesel/i.test(`${fuel.productName} ${fuel.productCode}`);
const isPetrol = (fuel: FuelProfitLine) =>
  /petrol|unleaded|gasoline|blend/i.test(`${fuel.productName} ${fuel.productCode}`);

/** Plain cells for one fuel, blank when that fuel was not sold that day. */
function fuelCells(prefix: 'diesel' | 'petrol', lines: readonly FuelProfitLine[]) {
  if (lines.length === 0) {
    return {
      [`${prefix}Litres`]: null,
      [`${prefix}Sales`]: null,
      [`${prefix}Cost`]: null,
      [`${prefix}Gross`]: null,
    };
  }
  // A cost that is not known yet stays blank; it is never shown as zero.
  const costKnown = lines.every((line) => line.costOfFuelSold !== null);
  return {
    [`${prefix}Litres`]: formatLitres(sumExact(lines.map((line) => line.litres))),
    [`${prefix}Sales`]: formatMoney(sumExact(lines.map((line) => line.sales))),
    [`${prefix}Cost`]: costKnown
      ? formatMoney(sumExact(lines.map((line) => line.costOfFuelSold)))
      : null,
    [`${prefix}Gross`]: costKnown
      ? formatMoney(sumExact(lines.map((line) => line.grossProfit)))
      : null,
  };
}

export function buildStationDailyRows(
  input: Readonly<{
    stationNames: ReadonlyMap<string, string>;
    sales: readonly DailyReportSale[];
    costs: readonly DailyReportCost[];
    expenses: readonly DailyReportExpense[];
    /** Staff and management fuel at selling price, per station and business day. */
    fuelBenefits?: readonly Readonly<{ stationId: string; businessDate: string; amount: string }>[];
  }>,
): TableReportRow[] {
  const stationIds = [
    ...new Set([
      ...input.sales.map((sale) => sale.stationId),
      ...input.costs.map((cost) => cost.stationId),
      ...input.expenses.map((expense) => expense.stationId),
      ...(input.fuelBenefits ?? []).map((benefit) => benefit.stationId),
    ]),
  ];
  const rows: { date: string; station: string; row: TableReportRow }[] = [];
  for (const stationId of stationIds) {
    const expenses = input.expenses.filter((expense) => expense.stationId === stationId);
    const summary = buildDailyProfit({
      sales: input.sales.filter((sale) => sale.stationId === stationId),
      costs: input.costs.filter((cost) => cost.stationId === stationId),
      expenses,
      fuelBenefitByDate: (input.fuelBenefits ?? []).filter(
        (benefit) => benefit.stationId === stationId,
      ),
    });
    const station =
      input.stationNames.get(stationId) ?? expenses[0]?.stationName ?? 'Unknown station';
    for (const day of summary.days) {
      const diesel = day.fuels.filter(isDiesel);
      const petrol = day.fuels.filter((fuel) => !isDiesel(fuel) && isPetrol(fuel));
      const notes = expenses
        .filter(
          (expense) =>
            expense.businessDate === day.date &&
            expense.classification === 'OPERATING' &&
            expense.description,
        )
        .map((expense) => `${expense.description} ${formatMoney(expense.amount)}`)
        .join(', ');
      const totalExpenses = formatMoney(sumExact([day.combined.expenses, day.combined.fixedCosts]));
      rows.push({
        date: day.date,
        station,
        row: {
          date: day.date,
          station,
          ...fuelCells('diesel', diesel),
          ...fuelCells('petrol', petrol),
          totalSales: day.combined.sales,
          totalGross: day.combined.grossProfit,
          expenses: day.combined.expenses,
          fixedCosts: day.combined.fixedCosts,
          totalExpenses,
          staffFuel: day.combined.fuelBenefit,
          operatingProfit: day.combined.operatingProfit,
          notes: notes || null,
        },
      });
    }
  }
  return rows
    .sort((a, b) => b.date.localeCompare(a.date) || a.station.localeCompare(b.station))
    .map((entry) => entry.row);
}
