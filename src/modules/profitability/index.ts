export {
  calculateGrossMargin,
  classifyGrossMargin,
  normalizeCanonicalRevenueAmount,
  normalizeValuedSaleCogs,
  summarizeCanonicalRevenue,
  summarizeRestatedCogs,
} from './domain';
export { readCanonicalRevenue, readRestatedCogs } from './query';
export { buildFuelProfitRows, buildProfitabilityReport } from './report';
export type {
  CanonicalRevenueReport,
  CanonicalRevenueStatus,
  CanonicalSaleRevenue,
  CostingStatus,
  FuelProfitRow,
  FuelProfitStatus,
  GrossMarginStatus,
  ProfitabilityReport,
  RestatedCogsQueryFilters,
  RestatedCogsReport,
  RestatedSaleCogs,
  SaleValuationStatus,
} from './contracts';
