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
