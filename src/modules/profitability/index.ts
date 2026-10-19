export {
  calculateGrossMargin,
  classifyGrossMargin,
  normalizeCanonicalRevenueAmount,
  normalizeValuedSaleCogs,
  summarizeCanonicalRevenue,
  summarizeRestatedCogs,
} from './domain';
export { readCanonicalRevenue, readRestatedCogs } from './query';
export type {
  CanonicalRevenueReport,
  CanonicalRevenueStatus,
  CanonicalSaleRevenue,
  CostingStatus,
  GrossMarginStatus,
  ProfitabilityReport,
  RestatedCogsQueryFilters,
  RestatedCogsReport,
  RestatedSaleCogs,
  SaleValuationStatus,
} from './contracts';
