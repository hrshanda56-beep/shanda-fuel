/**
 * The report types a user can open. Each is one row on the Reports page and one
 * section of the management report. Pure data; no UI or database code.
 */
export const REPORT_CATEGORIES = [
  { id: 'sales', label: 'Sales' },
  { id: 'cash', label: 'Cash and banking' },
  { id: 'payments', label: 'Electronic payments' },
  { id: 'credit', label: 'Suppliers and customers' },
  { id: 'inventory', label: 'Inventory' },
] as const;

export type ReportCategoryId = (typeof REPORT_CATEGORIES)[number]['id'];

export type ReportDefinition = Readonly<{
  slug: string;
  title: string;
  description: string;
  category: ReportCategoryId;
}>;

export const REPORT_CATALOG: readonly ReportDefinition[] = [
  {
    slug: 'sales',
    title: 'Sales and payments',
    description: 'Approved sales by payment method and product, with variance.',
    category: 'sales',
  },
  {
    slug: 'cash',
    title: 'Cash evidence to bank',
    description: 'Cash evidence, collections and deposits, and what is still held.',
    category: 'cash',
  },
  {
    slug: 'providers',
    title: 'Electronic evidence and settlements',
    description: 'Provider evidence against settlements received.',
    category: 'payments',
  },
  {
    slug: 'commercial',
    title: 'Suppliers and customers',
    description: 'Supplier balances and customer credit drawn, by station.',
    category: 'credit',
  },
  {
    slug: 'inventory',
    title: 'Tanks, deliveries and variance',
    description: 'Stock on hand, deliveries received and dip variance.',
    category: 'inventory',
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
