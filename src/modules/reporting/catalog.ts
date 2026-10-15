/**
 * The report types a user can open. Each is one row on the Reports page and one
 * section of the management report. Pure data; no UI or database code.
 */
export const REPORT_CATEGORIES = [
  { id: 'statements', label: 'Financial Statements' },
  { id: 'sales', label: 'Sales' },
  { id: 'cash', label: 'Cash & Banking' },
  { id: 'payments', label: 'Electronic Payments' },
  { id: 'credit', label: 'Suppliers & Customers' },
  { id: 'inventory', label: 'Inventory' },
] as const;

export type ReportCategoryId = (typeof REPORT_CATEGORIES)[number]['id'];

export type ReportDefinition = Readonly<{
  slug: string;
  title: string;
  description: string;
  category: ReportCategoryId;
  /** False when the report is a statement with no CSV layout. */
  exportable: boolean;
}>;

export const REPORT_CATALOG: readonly ReportDefinition[] = [
  {
    slug: 'profit-loss',
    title: 'Income Statement',
    description: 'Revenue, cost of sales, expenses and the operating result.',
    category: 'statements',
    exportable: false,
  },
  {
    slug: 'cash-movement',
    title: 'Cash Movement',
    description: 'Cash collected, banked and settled, and what is still outstanding.',
    category: 'statements',
    exportable: false,
  },
  {
    slug: 'sales',
    title: 'Sales & Payments',
    description: 'Approved sales by payment method and product, with variance.',
    category: 'sales',
    exportable: true,
  },
  {
    slug: 'cash',
    title: 'Cash Evidence to Bank',
    description: 'Cash evidence, collections and deposits, and what is still held.',
    category: 'cash',
    exportable: true,
  },
  {
    slug: 'providers',
    title: 'Electronic Evidence & Settlements',
    description: 'Provider evidence against settlements received.',
    category: 'payments',
    exportable: true,
  },
  {
    slug: 'commercial',
    title: 'Suppliers & Customers',
    description: 'Supplier balances and customer credit drawn, by station.',
    category: 'credit',
    exportable: true,
  },
  {
    slug: 'inventory',
    title: 'Tanks, Deliveries & Variance',
    description: 'Stock on hand, deliveries received and dip variance.',
    category: 'inventory',
    exportable: true,
  },
];

export function findReport(slug: string): ReportDefinition | undefined {
  return REPORT_CATALOG.find((report) => report.slug === slug);
}

export function categoryLabel(id: ReportCategoryId): string {
  return REPORT_CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

export function reportsInCategory(id: ReportCategoryId): readonly ReportDefinition[] {
  return REPORT_CATALOG.filter((report) => report.category === id);
}
