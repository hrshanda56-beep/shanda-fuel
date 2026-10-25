/**
 * Sales by day, with the week and month each day belongs to so the same table answers daily,
 * weekly and monthly questions (filter or total by the week or month column in Excel). Only
 * approved reconciliations count. The query is in `read-more.ts`.
 */
import type { TableReportDefinition } from './definitions';

export const SALES_BY_PERIOD_REPORT: TableReportDefinition = {
  slug: 'sales-by-period',
  title: 'Sales by Day, Week and Month',
  description:
    'Approved litres and sales for each fuel, station and day, with the week and month each day falls in.',
  category: 'sales',
  scope: 'station',
  emptyMessage: 'No approved sales were recorded for these dates and stations.',
  filters: ['product', 'shift', 'employee', 'paymentMethod'],
  columns: [
    { key: 'date', label: 'Date', kind: 'text' },
    { key: 'weekStarting', label: 'Week starting (Monday)', kind: 'text' },
    { key: 'month', label: 'Month', kind: 'text' },
    { key: 'station', label: 'Station', kind: 'text' },
    { key: 'product', label: 'Fuel', kind: 'text' },
    { key: 'litres', label: 'Litres sold', kind: 'number' },
    { key: 'sales', label: 'Sales (USD)', kind: 'number' },
  ],
};
