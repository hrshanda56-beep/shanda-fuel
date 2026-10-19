export type CostingStatus = 'NO_SALES' | 'COMPLETE' | 'UNVALUED';
export type SaleValuationStatus = 'VALUED' | 'UNVALUED';

/**
 * One canonical A5-to-A12 sale-cost lineage row for reporting.
 *
 * The identifiers are deliberately retained so report consumers can explain a
 * number without replaying inventory costing or relying on a reporting-only
 * surrogate.
 */
export type RestatedSaleCogs = Readonly<{
  stationId: string;
  reconciliationId: string;
  revisionId: string;
  meterSegmentId: string;
  saleMovementId: string;
  attributionId: string | null;
  originalSaleCogsEventId: string | null;
  originalCogs: string | null;
  revaluationDelta: string | null;
  revaluationLineIds: readonly string[];
  revaluationEventIds: readonly string[];
  restatedCogs: string | null;
  businessDate: string;
  effectiveAt: string;
  currency: string | null;
  valuationStatus: SaleValuationStatus;
}>;

export type RestatedCogsReport = Readonly<{
  currency: 'USD';
  costingStatus: CostingStatus;
  originalCogs: string | null;
  revaluationDelta: string | null;
  restatedCogs: string | null;
  saleCount: number;
  valuedSaleCount: number;
  unvaluedSaleCount: number;
  sales: readonly RestatedSaleCogs[];
}>;

export type RestatedCogsQueryFilters = Readonly<{
  tenantId: string;
  /** Stations to include. Absent or empty means every station of the tenant. */
  stationIds?: readonly string[];
  fromDate: string;
  toDate: string;
}>;

export type CanonicalRevenueStatus = 'NO_SALES' | 'POSTED';

export type CanonicalSaleRevenue = Readonly<{
  stationId: string;
  reconciliationId: string;
  revisionId: string;
  meterSegmentId: string;
  revenueMovementId: string;
  recognizedRevenue: string;
  quantityLitres: string;
  businessDate: string;
  effectiveAt: string;
  currency: string;
}>;

export type CanonicalRevenueReport = Readonly<{
  currency: 'USD';
  revenueStatus: CanonicalRevenueStatus;
  recognizedRevenue: string;
  saleCount: number;
  sales: readonly CanonicalSaleRevenue[];
}>;

/**
 * Why gross margin is, or is not, authoritative for the requested window.
 * A null margin is never a zero: every non-COMPLETE status names the reason.
 */
export type GrossMarginStatus =
  'NOT_APPLICABLE' | 'COMPLETE' | 'REVENUE_MISSING' | 'COSTING_UNVALUED' | 'SALE_COUNT_MISMATCH';

/**
 * Profitability deliberately excludes operating expenses: revenue minus
 * restated COGS is gross margin only. Expenses are a separate domain.
 */
export type ProfitabilityReport = Readonly<{
  report: 'PROFITABILITY';
  currency: 'USD';
  filters: Readonly<{
    tenantId: string;
    stationIds: readonly string[];
    fromDate: string;
    toDate: string;
  }>;
  dateBasis: Readonly<{ revenue: string; cogs: string }>;
  revenue: CanonicalRevenueReport;
  costing: RestatedCogsReport;
  grossMargin: string | null;
  grossMarginStatus: GrossMarginStatus;
  expensesIncluded: false;
}>;
