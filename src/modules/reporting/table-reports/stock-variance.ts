/**
 * Stock variances: every physical tank dip against the book stock at the moment it was taken, with
 * the same green / yellow / red judgement the alerts use (`classifyStockVariance`). Pure part: the
 * report definition and the row building. The query is in `read-more.ts`.
 */
import { classifyStockVariance } from '../../approvals/operations-alerts';
import type { TableReportDefinition, TableReportRow } from './definitions';

export const STOCK_VARIANCE_REPORT: TableReportDefinition = {
  slug: 'stock-variance',
  title: 'Stock Variances',
  description:
    'Each tank dip against the stock the books expected, with a green, yellow or red judgement. A day that is not yet approved has its sales not yet counted, so its difference can look larger than it is.',
  category: 'inventory',
  scope: 'station',
  emptyMessage: 'No tanks are set up for these stations.',
  filters: ['product'],
  columns: [
    { key: 'date', label: 'Date', kind: 'text' },
    { key: 'station', label: 'Station', kind: 'text' },
    { key: 'tank', label: 'Tank', kind: 'text' },
    { key: 'product', label: 'Fuel', kind: 'text' },
    { key: 'physicalLitres', label: 'Measured (L)', kind: 'number' },
    { key: 'expectedLitres', label: 'Expected (L)', kind: 'number' },
    { key: 'varianceLitres', label: 'Short (−) / over (+) (L)', kind: 'number' },
    { key: 'toleranceLitres', label: 'Allowed difference (L)', kind: 'number' },
    { key: 'signal', label: 'Judgement', kind: 'text' },
    { key: 'dayApproved', label: 'Day approved', kind: 'text' },
  ],
};

const SIGNAL_LABELS = {
  ok: 'Green: within the allowed range',
  watch: 'Yellow: needs an explanation',
  alert: 'Red: needs urgent attention',
  unjudged: 'Not checked: no allowed difference set',
} as const;

export type StockVarianceFact = Readonly<{
  date: string;
  station: string;
  tank: string;
  product: string;
  physical: string;
  expected: string;
  variance: string;
  tolerance: string | null;
  dayApproved: boolean;
}>;

export function stockVarianceRow(fact: StockVarianceFact): TableReportRow {
  return {
    date: fact.date,
    station: fact.station,
    tank: fact.tank,
    product: fact.product,
    physicalLitres: fact.physical,
    expectedLitres: fact.expected,
    varianceLitres: fact.variance,
    toleranceLitres: fact.tolerance,
    signal: SIGNAL_LABELS[classifyStockVariance(fact.variance, fact.tolerance)],
    dayApproved: fact.dayApproved ? 'Yes' : 'No',
  };
}

/** A tank with no dip in the chosen dates still gets a line, so it never disappears from view. */
export function tankWithoutDipRow(
  fact: Readonly<{ station: string; tank: string; product: string; tolerance: string | null }>,
): TableReportRow {
  return {
    date: null,
    station: fact.station,
    tank: fact.tank,
    product: fact.product,
    physicalLitres: null,
    expectedLitres: null,
    varianceLitres: null,
    toleranceLitres: fact.tolerance,
    signal: 'No dip recorded in these dates',
    dayApproved: null,
  };
}
