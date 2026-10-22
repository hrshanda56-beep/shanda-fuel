/**
 * Reports that are one plain table of rows for a date range and a set of stations.
 * This file is the pure part: what each report is called, which category it sits
 * under and which columns it shows. The queries live in `read.ts`.
 */
export type TableReportColumn = Readonly<{
  key: string;
  label: string;
  /** Numbers are right-aligned and exported unquoted; text is guarded against spreadsheet formulas. */
  kind: 'text' | 'number';
}>;

export type TableReportRow = Readonly<Record<string, string | null>>;

export type TableReportDefinition = Readonly<{
  slug: string;
  title: string;
  description: string;
  category: 'inventory';
  /** Said on the page when there is nothing to show for the chosen dates. */
  emptyMessage: string;
  columns: readonly TableReportColumn[];
}>;

export const TABLE_REPORTS: readonly TableReportDefinition[] = [
  {
    slug: 'tank-dip-history',
    title: 'Tank Dip History',
    description: 'Every tank dip reading taken, by tank and day.',
    category: 'inventory',
    emptyMessage: 'No tank dips were recorded for these dates and stations.',
    columns: [
      { key: 'businessDate', label: 'Date', kind: 'text' },
      { key: 'measuredAt', label: 'Time measured (UTC)', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'tank', label: 'Tank', kind: 'text' },
      { key: 'product', label: 'Fuel', kind: 'text' },
      { key: 'physicalLitres', label: 'Litres in tank', kind: 'number' },
      { key: 'notes', label: 'Notes', kind: 'text' },
    ],
  },
  {
    slug: 'stock-movements',
    title: 'Stock Movement History',
    description: 'Every change to fuel stock: deliveries, sales and adjustments.',
    category: 'inventory',
    emptyMessage: 'No stock movements were recorded for these dates and stations.',
    columns: [
      { key: 'businessDate', label: 'Date', kind: 'text' },
      { key: 'effectiveAt', label: 'Time (UTC)', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'tank', label: 'Tank', kind: 'text' },
      { key: 'product', label: 'Fuel', kind: 'text' },
      { key: 'movementType', label: 'What happened', kind: 'text' },
      { key: 'quantityLitres', label: 'Litres (+ in, − out)', kind: 'number' },
      { key: 'reason', label: 'Reason', kind: 'text' },
    ],
  },
  {
    slug: 'delivery-variance',
    title: 'Delivery Variance',
    description: 'Litres on the delivery note against litres actually received.',
    category: 'inventory',
    emptyMessage: 'No confirmed deliveries were received for these dates and stations.',
    columns: [
      { key: 'businessDate', label: 'Date', kind: 'text' },
      { key: 'station', label: 'Station', kind: 'text' },
      { key: 'product', label: 'Fuel', kind: 'text' },
      { key: 'deliveryNote', label: 'Delivery note', kind: 'text' },
      { key: 'supplier', label: 'Supplier', kind: 'text' },
      { key: 'noteLitres', label: 'On the note (L)', kind: 'number' },
      { key: 'actualLitres', label: 'Received (L)', kind: 'number' },
      { key: 'shortageExcessLitres', label: 'Short (−) / over (+) (L)', kind: 'number' },
    ],
  },
];

export function findTableReport(slug: string): TableReportDefinition | undefined {
  return TABLE_REPORTS.find((report) => report.slug === slug);
}

/** Most rows one report returns; the page says so when the cap is reached. */
export const TABLE_REPORT_ROW_LIMIT = 5000;
