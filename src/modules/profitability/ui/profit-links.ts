import { applyReportFilters, type ReportFilters } from '../../reporting/filters';

/**
 * The link from Profit to the full profit and loss statement. It carries the legal entity the
 * person is working in, so the statement does not fall back to a different company.
 */
export function profitStatementHref(
  tenantId: string,
  current: { legalEntityId?: string | undefined } | null,
  filters: ReportFilters,
): string {
  const base = new URLSearchParams({ tenantId });
  if (current?.legalEntityId) base.set('legalEntityId', current.legalEntityId);
  return `/reports/profit-loss?${applyReportFilters(base, filters).toString()}`;
}
