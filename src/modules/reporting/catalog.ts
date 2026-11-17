/**
 * The report types a user can open. Each is one row on the Reports page and one
 * section of the management report. Pure data; no UI or database code.
 */
import { TABLE_REPORTS } from './table-reports/definitions';

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
  /** True when the report can be downloaded as CSV, PDF or XLSX. */
  exportable: boolean;
  /** Operational reports need only `report.view`; finance reports need `report.finance.view`. */
  audience: 'operational' | 'finance';
  /**
   * False for a view that other screens still link to (the finance figures, the shortcuts) but
   * that is not offered as a report of its own; it stays reachable by its address.
   */
  listed?: false;
}>;

const MANAGEMENT_REPORTS: readonly ReportDefinition[] = [
  {
    slug: 'profit-loss',
    title: 'Income Statement',
    description: 'Revenue, cost of sales, expenses and the operating result.',
    category: 'statements',
    exportable: true,
    audience: 'finance',
  },
  {
    slug: 'cash-movement',
    title: 'Cash Movement',
    description: 'Cash collected, banked and settled, and what is still outstanding.',
    category: 'statements',
    exportable: true,
    audience: 'finance',
  },
  {
    slug: 'net-position',
    title: 'Net Current Position',
    description: 'What the business holds or is owed, less what it owes.',
    category: 'statements',
    exportable: true,
    audience: 'finance',
  },
  {
    slug: 'sales',
    title: 'Sales & Payments',
    description: 'Approved sales by payment method and product, with variance.',
    category: 'sales',
    exportable: true,
    audience: 'finance',
    listed: false,
  },
  {
    slug: 'cash',
    title: 'Cash Evidence to Bank',
    description: 'Cash evidence, collections and deposits, and what is still held.',
    category: 'cash',
    exportable: true,
    audience: 'finance',
    listed: false,
  },
  {
    slug: 'providers',
    title: 'Electronic Evidence & Settlements',
    description: 'Provider evidence against settlements received.',
    category: 'payments',
    exportable: true,
    audience: 'finance',
    listed: false,
  },
  {
    slug: 'commercial',
    title: 'Suppliers & Customers',
    description: 'Supplier balances and customer credit drawn, by station.',
    category: 'credit',
    exportable: true,
    audience: 'finance',
    listed: false,
  },
  {
    slug: 'inventory',
    title: 'Tanks, Deliveries & Variance',
    description: 'Stock on hand, deliveries received and dip variance.',
    category: 'inventory',
    exportable: true,
    audience: 'finance',
    listed: false,
  },
];

/** The management-overview views first, then the plain table reports. */
export const REPORT_CATALOG: readonly ReportDefinition[] = [
  ...MANAGEMENT_REPORTS,
  ...TABLE_REPORTS.map(({ slug, title, description, category, audience }) => ({
    slug,
    title,
    description,
    category,
    exportable: true,
    audience: audience ?? 'finance',
  })),
];

export function findReport(slug: string): ReportDefinition | undefined {
  return REPORT_CATALOG.find((report) => report.slug === slug);
}

export function categoryLabel(id: ReportCategoryId): string {
  return REPORT_CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

/** The reports a person is offered: finance reports only for someone with the finance permission. */
export function reportsFor(financeReports: boolean): readonly ReportDefinition[] {
  return REPORT_CATALOG.filter(
    (report) => report.listed !== false && (financeReports || report.audience === 'operational'),
  );
}

export function reportsInCategory(
  id: ReportCategoryId,
  financeReports = true,
): readonly ReportDefinition[] {
  return reportsFor(financeReports).filter((report) => report.category === id);
}
