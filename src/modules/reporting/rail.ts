/**
 * Links for the Reports page's supporting rail: category filtering and a few
 * shortcuts to common report views. All of them keep the user's stations.
 * Pure logic; no UI or database code.
 */
import { REPORT_CATEGORIES, type ReportCategoryId } from './catalog';
import { applyReportFilters } from './filters';
import type { ReportPeriod } from './period';

export type QuickAction = Readonly<{
  id: string;
  label: string;
  slug: string;
  period: ReportPeriod;
}>;

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'sales-last-month', label: 'Last month’s sales', slug: 'sales', period: 'last-month' },
  { id: 'cash-this-month', label: 'Cash position this month', slug: 'cash', period: 'this-month' },
  {
    id: 'credit-quarter',
    label: 'Suppliers and customers, last 3 months',
    slug: 'commercial',
    period: '3m',
  },
];

export function quickActionHref(
  action: QuickAction,
  tenantId: string,
  stationIds: readonly string[],
): string {
  const params = applyReportFilters(new URLSearchParams({ tenantId }), {
    stationIds,
    period: action.period,
    customFrom: '',
    customTo: '',
  });
  return `/reports/${action.slug}?${params.toString()}`;
}

export function parseCategoryParam(value: string | null): ReportCategoryId | null {
  const match = REPORT_CATEGORIES.find((category) => category.id === value);
  return match ? match.id : null;
}

/** The current page link with the category set, or cleared for "All reports". */
export function categoryHref(
  pathname: string,
  current: URLSearchParams,
  category: ReportCategoryId | null,
): string {
  const next = new URLSearchParams(current);
  if (category) next.set('category', category);
  else next.delete('category');
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}
