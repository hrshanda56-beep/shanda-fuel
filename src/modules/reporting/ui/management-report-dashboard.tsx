'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { formatBusinessDate, formatLitres } from '../../../design-system/formatters';
import { MetricCard } from '../../../design-system/layout';
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  SkeletonBlock,
  StatusBadge,
} from '../../../design-system/primitives';
import { TableScrollRegion } from '../../../design-system/table';
import type { ContextResolution } from '../../context/contracts';
import type { ManagementReport } from '../contracts';
import {
  applyReportFilters,
  parseReportFilters,
  resolveReportFilters,
  type ReportFilters,
} from '../filters';
import { formatTileMoney } from '../format';
import { businessToday, precedingRange } from '../period';
import { findReport, type ReportDefinition } from '../catalog';
import {
  buildCashMovement,
  buildCommercialStatement,
  buildIncomeStatement,
  buildProfitAndLoss,
  compareStatement,
  buildProviderStatement,
  buildSalesByPayment,
  buildStockStatement,
  type Statement,
} from '../statements';
import { StatementWorkspace } from './statement-workspace';
import { ReportFiltersMenu } from './report-filters-menu';
import { ReportActionStatus } from './report-action-status';
import { useAvailableStations } from './use-available-stations';
import { useReportActions } from './use-report-actions';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  POS: 'POS (card)',
  ECOCASH: 'EcoCash',
  CUSTOMER_CREDIT: 'Account',
  PREPAID: 'Prepaid',
};

function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method.replaceAll('_', ' ').toLowerCase();
}

function statementFor(slug: ReportDefinition['slug'], report: ManagementReport): Statement {
  switch (slug) {
    case 'profit-loss':
      return buildProfitAndLoss(report);
    case 'cash-movement':
    case 'cash':
      return buildCashMovement(report);
    case 'sales':
      return buildSalesByPayment(report, paymentMethodLabel);
    case 'providers':
      return buildProviderStatement(report);
    case 'commercial':
      return buildCommercialStatement(report);
    default:
      return buildStockStatement(report);
  }
}

/**
 * `view` is `summary` (headline figures, used on the Reports list) or the slug
 * of one report (its detail page, with the filter bar).
 */
function SummarySkeleton() {
  return (
    <section className="metric-grid" aria-label="Loading headline figures" aria-busy="true">
      {[0, 1, 2, 3].map((index) => (
        <div className="card metric-card" key={index}>
          <SkeletonBlock width="60%" height="0.875rem" />
          <SkeletonBlock width="40%" height="1.5rem" />
          <SkeletonBlock width="70%" height="0.75rem" />
        </div>
      ))}
    </section>
  );
}

export function ManagementReportDashboard({
  tenantId,
  view,
}: {
  tenantId: string;
  view: 'summary' | ReportDefinition['slug'];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseReportFilters(searchParams), [searchParams]);
  const stations = useAvailableStations(tenantId, view !== 'summary');
  const range = resolveReportFilters(filters, businessToday());
  const actions = useReportActions();
  const definition = view === 'summary' ? undefined : findReport(view);
  const [report, setReport] = useState<ManagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<ManagementReport | null>(null);
  const [comparing, setComparing] = useState(false);

  function detailHref(slug: string) {
    return `/reports/${slug}?${searchParams.toString()}`;
  }

  function changeFilters(next: ReportFilters) {
    const params = applyReportFilters(new URLSearchParams(searchParams.toString()), next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const fromDate = range?.fromDate;
  const toDate = range?.toDate;
  const stationKey = filters.stationIds.join(',');

  async function load(signal?: AbortSignal) {
    if (!fromDate || !toDate) {
      setReport(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ tenantId, fromDate, toDate });
    if (stationKey) query.set('stationIds', stationKey);
    try {
      const response = await fetch(`/api/reports/management?${query.toString()}`, {
        cache: 'no-store',
        signal,
      });
      const body = (await response.json()) as { message?: string } | ManagementReport;
      if (!response.ok)
        throw new Error('message' in body ? body.message : 'Report could not be loaded');
      setReport(body as ManagementReport);
    } catch (cause) {
      if (!signal?.aborted)
        setError(cause instanceof Error ? cause.message : 'Report could not be loaded');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  const before = fromDate && toDate ? precedingRange(fromDate, toDate) : null;
  const beforeFrom = before?.fromDate;
  const beforeTo = before?.toDate;

  // The income statement sets each figure beside the period before it.
  useEffect(() => {
    if (view === 'summary' || !beforeFrom || !beforeTo) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setComparing(true);
      setPrevious(null);
      const query = new URLSearchParams({ tenantId, fromDate: beforeFrom, toDate: beforeTo });
      if (stationKey) query.set('stationIds', stationKey);
      try {
        const response = await fetch(`/api/reports/management?${query.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.ok) setPrevious((await response.json()) as ManagementReport);
      } catch {
        // The statement still shows the chosen period without a comparison.
      } finally {
        if (!controller.signal.aborted) setComparing(false);
      }
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [view, tenantId, stationKey, beforeFrom, beforeTo]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
    // Reload whenever the tenant, stations or resolved dates change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, stationKey, fromDate, toDate]);

  const filtersMenu = (
    <ReportFiltersMenu stations={stations} filters={filters} onChange={changeFilters} />
  );

  return (
    <>
      {!range ? (
        <p className="field-hint" role="status">
          Choose both dates, with the start on or before the end.
        </p>
      ) : null}

      {loading && view === 'summary' ? <SummarySkeleton /> : null}
      {loading && view !== 'summary' ? <LoadingState label="Loading report" /> : null}
      {error ? <ErrorState title="Report unavailable" message={error} /> : null}
      {!loading && !error && report ? (
        <>
          {view === 'summary' ? (
            <section className="metric-grid" aria-label="Headline figures for the chosen period">
              <MetricCard
                label="Accounted sales"
                value={formatTileMoney(report.sales.salesValue)}
                meta={`${formatLitres(report.sales.litresSold)} litres sold`}
                href={detailHref('sales')}
              />
              <MetricCard
                label="Cash collected"
                value={formatTileMoney(report.cash.collected)}
                meta={`${formatTileMoney(report.cash.collectedButNotBanked)} not yet banked`}
                href={detailHref('cash')}
              />
              <MetricCard
                label="Provider settlements outstanding"
                value={formatTileMoney(report.providers.unallocatedProviderAmount)}
                meta="Unallocated"
                href={detailHref('providers')}
              />
              <MetricCard
                label="Supplier balance"
                value={formatTileMoney(report.suppliers.outstandingBalance)}
                meta="At the end of the period"
                href={detailHref('commercial')}
              />
            </section>
          ) : null}

          <div className="content-grid">
            {definition ? (
              <StatementWorkspace
                id={`${definition.slug}-statement`}
                title={definition.title}
                slug={definition.slug}
                statement={
                  definition.slug === 'profit-loss'
                    ? buildIncomeStatement(report, previous)
                    : compareStatement(
                        statementFor(definition.slug, report),
                        previous ? statementFor(definition.slug, previous) : null,
                      )
                }
                report={report}
                previous={previous}
                previousRange={before}
                comparing={comparing}
                query={searchParams.toString()}
                filtersMenu={filtersMenu}
              />
            ) : null}

            {view === 'sales' ? (
              <Card
                as="section"
                className="panel content-span"
                id="sales-report"
                aria-labelledby="sales-report-title"
              >
                <div className="panel-heading">
                  <h2 id="sales-report-title">Payments and products</h2>
                </div>
                <TableScrollRegion label="Payments and products table">
                  <table className="responsive-table">
                    <caption className="visually-hidden">
                      Sales by date, station, and product
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Date / station</th>
                        <th scope="col">Product</th>
                        <th scope="col">Litres</th>
                        <th scope="col">Sales value</th>
                        <th scope="col">Average price</th>
                        <th scope="col">IDs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sales.rows.map((row) => (
                        <tr key={`${row.businessDate}-${row.stationId}-${row.productId}`}>
                          <td data-label="Date / station">
                            {formatBusinessDate(row.businessDate)}
                            <br />
                            <small>{row.stationCode}</small>
                          </td>
                          <td data-label="Product">
                            {row.productCode} · {row.productName}
                          </td>
                          <td data-label="Litres" className="numeric">
                            {formatLitres(row.litres)}
                          </td>
                          <td data-label="Sales value" className="numeric">
                            {formatTileMoney(row.salesValue)}
                          </td>
                          <td data-label="Average price" className="numeric">
                            {row.averageRealizedPrice
                              ? formatTileMoney(row.averageRealizedPrice)
                              : '—'}
                          </td>
                          <td data-label="IDs">
                            <small>{row.reconciliationIds.length} reconciliation</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollRegion>
                {report.sales.rows.length === 0 ? (
                  <EmptyState
                    title="No approved sales"
                    message="No approved reconciliation facts match this period."
                  />
                ) : null}
              </Card>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
