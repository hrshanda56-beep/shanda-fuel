import type { IconName } from '../../../design-system/icons';
import type { ReportCategoryId } from '../catalog';

/** One calm icon per report category, used for the category list and as the fallback for a report. */
export const CATEGORY_ICONS: Record<ReportCategoryId, IconName> = {
  statements: 'receipt',
  sales: 'trend',
  cash: 'wallet',
  payments: 'card',
  credit: 'users',
  inventory: 'drop',
};

/**
 * Each report has its own icon, so people can tell the rows apart at a glance. Reports are listed by
 * their address; a new report with no entry here falls back to its category's icon, and a test
 * checks that every listed report has a different icon of its own.
 */
export const REPORT_ICONS: Record<string, IconName> = {
  'profit-loss': 'trend',
  'cash-movement': 'arrows',
  'net-position': 'scale',
  sales: 'chart',
  cash: 'wallet',
  providers: 'card',
  commercial: 'users',
  inventory: 'tank',
  'tank-dip-history': 'dipstick',
  'stock-movements': 'layers',
  'delivery-variance': 'truck',
  'expenses-detail': 'receipt',
  'supplier-statement': 'factory',
  'customer-statement': 'person',
  'cash-custody': 'safe',
  'bank-deposits': 'bank',
  'daily-reconciliation': 'clipboard-check',
  'sales-by-attendant': 'user-check',
  'payment-method-breakdown': 'pie',
  'customer-ageing': 'clock',
  'sales-by-period': 'calendar',
  'stock-variance': 'alert',
  'zera-return': 'fuel',
};

export function reportIcon(report: { slug: string; category: ReportCategoryId }): IconName {
  return REPORT_ICONS[report.slug] ?? CATEGORY_ICONS[report.category];
}
