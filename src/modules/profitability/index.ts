export {
  calculateGrossMargin,
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
  RestatedCogsQueryFilters,
  RestatedCogsReport,
  RestatedSaleCogs,
  SaleValuationStatus,
} from './contracts';
