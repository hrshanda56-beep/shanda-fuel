/**
 * A private report link is just the report's own page address with its state in
 * the query: report, tenant, stations and period. It carries no token and grants
 * nothing; whoever opens it is authenticated and authorised as for any page.
 * Pure; no UI or database code.
 */
import { applyReportFilters } from './filters';
import { isReportPeriod, type ReportPeriod } from './period';

export function privateReportPath(input: {
  slug: string;
  tenantId: string;
  stationIds: readonly string[];
  period?: string;
  fromDate: string;
  toDate: string;
}): string {
  const period: ReportPeriod = isReportPeriod(input.period) ? input.period : 'custom';
  const params = applyReportFilters(new URLSearchParams({ tenantId: input.tenantId }), {
    stationIds: input.stationIds,
    period,
    customFrom: period === 'custom' ? input.fromDate : '',
    customTo: period === 'custom' ? input.toDate : '',
  });
  return `/reports/${encodeURIComponent(input.slug)}?${params.toString()}`;
}
