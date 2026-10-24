import { calculateGrossMargin, classifyGrossMargin } from './domain';
import { formatLitres, formatMoney, subtractExact, sumExact, uniqueIds } from '../reporting/domain';
import type {
  CanonicalRevenueReport,
  FuelProfitRow,
  ProfitabilityReport,
  RestatedCogsReport,
  RestatedSaleCogs,
} from './contracts';

export const PROFITABILITY_DATE_BASIS = {
  revenue: 'REV1 sale_recognition_movements.business_date',
  cogs: 'A4 SALE inventory_movements.business_date (A12 restated)',
} as const;

function fuelStatus(
  revenueCount: number,
  costSales: readonly RestatedSaleCogs[],
): FuelProfitRow['status'] {
  if (revenueCount === 0 && costSales.length === 0) return 'NO_SALES';
  if (revenueCount === 0) return 'REVENUE_MISSING';
  if (costSales.some((sale) => sale.valuationStatus !== 'VALUED' || sale.restatedCogs === null)) {
    return 'COSTING_UNVALUED';
  }
  if (costSales.length !== revenueCount) return 'SALE_COUNT_MISMATCH';
  return 'COMPLETE';
}

/** Groups the canonical revenue and A12 cost rows by fuel without inventing cost. */
export function buildFuelProfitRows(
  revenueSales: CanonicalRevenueReport['sales'],
  costSales: RestatedCogsReport['sales'],
): readonly FuelProfitRow[] {
  const groups = new Map<
    string,
    {
      revenue: Array<CanonicalRevenueReport['sales'][number]>;
      costs: Array<RestatedCogsReport['sales'][number]>;
    }
  >();
  for (const sale of revenueSales) {
    const group = groups.get(sale.productId) ?? { revenue: [], costs: [] };
    group.revenue.push(sale);
    groups.set(sale.productId, group);
  }
  for (const sale of costSales) {
    const group = groups.get(sale.productId) ?? { revenue: [], costs: [] };
    group.costs.push(sale);
    groups.set(sale.productId, group);
  }

  return [...groups.entries()]
    .map(([productId, group]) => {
      const firstRevenue = group.revenue[0];
      const firstCost = group.costs[0];
      const status = fuelStatus(group.revenue.length, group.costs);
      const revenue = formatMoney(sumExact(group.revenue.map((sale) => sale.recognizedRevenue)));
      const litres = formatLitres(sumExact(group.revenue.map((sale) => sale.quantityLitres)));
      const cost =
        status === 'COMPLETE'
          ? formatMoney(sumExact(group.costs.map((sale) => sale.restatedCogs!)))
          : null;
      return {
        productId,
        productCode: firstRevenue?.productCode ?? firstCost?.productCode ?? 'UNKNOWN',
        productName: firstRevenue?.productName ?? firstCost?.productName ?? 'Unknown fuel',
        litres,
        revenue,
        cost,
        profit: cost === null ? null : formatMoney(subtractExact(revenue, cost)),
        status,
        saleCount: group.revenue.length,
        valuedSaleCount: group.costs.filter(
          (sale) => sale.valuationStatus === 'VALUED' && sale.restatedCogs !== null,
        ).length,
        unvaluedSaleCount: group.costs.filter(
          (sale) => sale.valuationStatus !== 'VALUED' || sale.restatedCogs === null,
        ).length,
        revenueMovementIds: uniqueIds(group.revenue.map((sale) => sale.revenueMovementId)),
        costMovementIds: uniqueIds(group.costs.map((sale) => sale.saleMovementId)),
      } satisfies FuelProfitRow;
    })
    .sort((left, right) =>
      `${left.productName}\u0000${left.productCode}\u0000${left.productId}`.localeCompare(
        `${right.productName}\u0000${right.productCode}\u0000${right.productId}`,
      ),
    );
}

/** Pure assembly of the profitability payload from the two canonical reads. */
export function buildProfitabilityReport(input: {
  tenantId: string;
  stationIds: readonly string[];
  fromDate: string;
  toDate: string;
  revenue: CanonicalRevenueReport;
  costing: RestatedCogsReport;
}): ProfitabilityReport {
  const { sales: _sales, ...costingSummary } = input.costing;
  return {
    report: 'PROFITABILITY',
    currency: 'USD',
    filters: {
      tenantId: input.tenantId,
      stationIds: input.stationIds,
      fromDate: input.fromDate,
      toDate: input.toDate,
    },
    dateBasis: PROFITABILITY_DATE_BASIS,
    revenue: input.revenue,
    costing: input.costing,
    fuelProfit: buildFuelProfitRows(input.revenue.sales, input.costing.sales),
    grossMargin: calculateGrossMargin(input.revenue, costingSummary),
    grossMarginStatus: classifyGrossMargin(input.revenue, costingSummary),
    expensesIncluded: false,
  };
}
