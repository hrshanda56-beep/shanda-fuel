import type { IconName } from '../../../design-system/icons';
import type { ReportCategoryId } from '../catalog';

/** One calm icon per report category, shared by the report rows and the category list. */
export const CATEGORY_ICONS: Record<ReportCategoryId, IconName> = {
  statements: 'receipt',
  sales: 'trend',
  cash: 'wallet',
  payments: 'card',
  credit: 'users',
  inventory: 'drop',
};
