import { calculateGrossMargin, classifyGrossMargin } from './domain';
import type { CanonicalRevenueReport, ProfitabilityReport, RestatedCogsReport } from './contracts';

export const PROFITABILITY_DATE_BASIS = {
  revenue: 'REV1 sale_recognition_movements.business_date',
  cogs: 'A4 SALE inventory_movements.business_date (A12 restated)',
} as const;

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
    grossMargin: calculateGrossMargin(input.revenue, costingSummary),
    grossMarginStatus: classifyGrossMargin(input.revenue, costingSummary),
    expensesIncluded: false,
  };
}
