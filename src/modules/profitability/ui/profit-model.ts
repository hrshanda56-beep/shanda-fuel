import { exact, ratioPercentage, subtractExact, sumExact } from '../../reporting/domain';
import { formatTileMoney } from '../../reporting/format';
import type { ManagementReport } from '../../reporting/contracts';

/**
 * Plain-language view of the profit figures for one period. Pure: it reshapes
 * the authorised management report and never invents a number. A cost that is
 * missing stays `null` (shown as "Not available"), never zero.
 */

export type ProfitState = 'no-sales' | 'ready' | 'cost-missing' | 'mismatch';

export type StationProfit = Readonly<{
  stationId: string;
  name: string;
  sales: string | null;
  litres: string;
  fuelCost: string | null;
  expenses: string;
  grossProfit: string | null;
  profit: string | null;
  perLitre: string | null;
  note: string | null;
}>;

export type FuelSales = Readonly<{
  productId: string;
  name: string;
  litres: string;
  sales: string;
  pricePerLitre: string | null;
}>;

export type ProfitView = Readonly<{
  state: ProfitState;
  headline: string;
  explanation: string | null;
  sales: string | null;
  fuelCost: string | null;
  grossProfit: string | null;
  expenses: string;
  profit: string | null;
  litres: string;
  perLitre: string | null;
  marginPercent: string | null;
  salesCount: number;
  missingCostCount: number;
  stations: readonly StationProfit[];
  fuels: readonly FuelSales[];
}>;

const NOT_AVAILABLE = 'Not available';

/** Money for the screen. A missing amount reads "Not available", never zero. */
export function moneyOrUnavailable(value: string | null | undefined): string {
  const text = formatTileMoney(value);
  return text === '—' ? NOT_AVAILABLE : text;
}

/** Money per litre to three places, e.g. "USD 0.125 per litre". */
export function formatPerLitre(value: string | null | undefined): string {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return NOT_AVAILABLE;
  }
  const fixed = exact(value.trim()).value.toDecimalPlaces(3).toFixed(3);
  return `USD ${fixed} per litre`;
}

export function formatPercent(value: string | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return `${exact(value).value.toDecimalPlaces(1).toFixed(1)}%`;
}

function perLitre(amount: string | null, litres: string): string | null {
  if (amount === null || exact(litres).value.isZero()) return null;
  return exact(amount).value.div(exact(litres).value).toFixed(6);
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(key(item)) ?? [];
    list.push(item);
    map.set(key(item), list);
  }
  return map;
}

export function buildProfitView(report: ManagementReport): ProfitView {
  const revenueSales = report.revenue.sales;
  const costSales = report.costing.sales;
  const salesCount = report.revenue.saleCount;
  const hasSales = salesCount > 0 || report.costing.saleCount > 0;
  const costComplete =
    report.costing.costingStatus === 'COMPLETE' &&
    report.costing.restatedCogs !== null &&
    report.costing.saleCount === salesCount;

  let state: ProfitState;
  if (!hasSales) state = 'no-sales';
  else if (report.costing.costingStatus === 'UNVALUED') state = 'cost-missing';
  else if (!costComplete) state = 'mismatch';
  else state = 'ready';

  const sales = salesCount > 0 ? report.revenue.recognizedRevenue : null;
  const fuelCost = costComplete ? report.costing.restatedCogs : null;
  const grossProfit =
    state === 'ready' && sales !== null && fuelCost !== null
      ? subtractExact(sales, fuelCost)
      : null;
  const expenses = report.expenses.total;
  const profit = grossProfit !== null ? subtractExact(grossProfit, expenses) : null;
  const litres = sumExact(revenueSales.map((sale) => sale.quantityLitres));

  const headline =
    state === 'no-sales'
      ? 'No fuel sales have been finalised in this period.'
      : state === 'ready'
        ? profit !== null && exact(profit).value.isNegative()
          ? 'You made a loss in this period.'
          : 'You made a profit in this period.'
        : 'Profit cannot be worked out yet.';

  const explanation =
    state === 'no-sales'
      ? 'Sales show here once a day is closed and checked. Try a longer period if you expected figures.'
      : state === 'cost-missing'
        ? `We don’t know what the fuel cost for ${report.costing.unvaluedSaleCount} of ${report.costing.saleCount} sales, so profit would be wrong. Check that fuel deliveries and their prices have been entered.`
        : state === 'mismatch'
          ? 'Sales and fuel costs don’t match for this period yet, so profit is held back rather than guessed. Check that each day was closed and each fuel delivery entered.'
          : null;

  // Per station: sales and cost are matched on the station that made the sale.
  const revenueByStation = groupBy(revenueSales, (sale) => sale.stationId);
  const costByStation = groupBy(costSales, (sale) => sale.stationId);
  // Company-level overhead remains in the overall expenses total, but is not falsely attributed
  // to a station in this per-station comparison.
  const expensesByStation = groupBy(
    report.expenses.rows.filter((row) => row.stationId),
    (row) => row.stationId,
  );
  const stationIds = new Set<string>([
    ...revenueByStation.keys(),
    ...costByStation.keys(),
    ...expensesByStation.keys(),
  ]);
  const stations: StationProfit[] = [...stationIds]
    .map((stationId) => {
      const name = report.stations.find((s) => s.stationId === stationId)?.name ?? 'Station';
      const rev = revenueByStation.get(stationId) ?? [];
      const cost = costByStation.get(stationId) ?? [];
      const stationSales = rev.length > 0 ? sumExact(rev.map((r) => r.recognizedRevenue)) : null;
      const stationLitres = sumExact(rev.map((r) => r.quantityLitres));
      const unvalued = cost.filter(
        (c) => c.valuationStatus !== 'VALUED' || c.restatedCogs === null,
      ).length;
      const costKnown = cost.length > 0 && unvalued === 0 && cost.length === rev.length;
      const stationCost = costKnown ? sumExact(cost.map((c) => c.restatedCogs)) : null;
      const stationExpenses = sumExact(
        (expensesByStation.get(stationId) ?? []).map((row) => row.amount),
      );
      const gross =
        stationSales !== null && stationCost !== null
          ? subtractExact(stationSales, stationCost)
          : null;
      return {
        stationId,
        name,
        sales: stationSales,
        litres: stationLitres,
        fuelCost: stationCost,
        expenses: stationExpenses,
        grossProfit: gross,
        profit: gross !== null ? subtractExact(gross, stationExpenses) : null,
        perLitre: perLitre(gross, stationLitres),
        note:
          rev.length === 0
            ? 'No fuel sales in this period'
            : gross === null
              ? 'Fuel cost missing for this station'
              : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Per fuel: sales and litres only. Fuel cost is not recorded per fuel yet.
  const fuelGroups = groupBy(report.sales.rows, (row) => row.productId);
  const fuels: FuelSales[] = [...fuelGroups.entries()]
    .map(([productId, rows]) => {
      const fuelLitres = sumExact(rows.map((r) => r.litres));
      const fuelSales = sumExact(rows.map((r) => r.salesValue));
      return {
        productId,
        name: rows[0]?.productName ?? 'Fuel',
        litres: fuelLitres,
        sales: fuelSales,
        pricePerLitre: perLitre(fuelSales, fuelLitres),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    state,
    headline,
    explanation,
    sales,
    fuelCost,
    grossProfit,
    expenses,
    profit,
    litres,
    perLitre: perLitre(grossProfit, litres),
    marginPercent:
      grossProfit !== null && sales !== null ? ratioPercentage(grossProfit, sales) : null,
    salesCount,
    missingCostCount: report.costing.unvaluedSaleCount,
    stations,
    fuels,
  };
}
