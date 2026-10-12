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
import { businessToday } from '../period';
import { findReport, type ReportDefinition } from '../catalog';
import { ReportFilterBar } from './report-filter-bar';
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

function customerMoney(value: string | null): string {
  return value === null ? 'Unavailable' : formatTileMoney(value);
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
  const reportTitle = findReport(view)?.title ?? '';
  const [report, setReport] = useState<ManagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      {view !== 'summary' ? (
        <Card as="section" className="panel" aria-labelledby="report-filters-title">
          <div className="panel-heading">
            <div>
              <h2 id="report-filters-title">Report filters</h2>
            </div>
            <StatusBadge tone="positive" role="status" aria-live="polite">
              Approved figures
            </StatusBadge>
          </div>
          <ReportFilterBar stations={stations} filters={filters} onChange={changeFilters} />
          {!range ? (
            <p className="field-hint" role="status">
              Choose both dates, with the start on or before the end.
            </p>
          ) : null}
          <p className="metric-meta">
            Figures come from approved records, each dated by its own business date. This is not a
            general ledger, statutory P&amp;L, balance sheet, tax report or bank statement.
          </p>
        </Card>
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
            {view === 'sales' ? (
              <Card
                as="section"
                className="panel content-span"
                id="sales-report"
                aria-labelledby="sales-report-title"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Sales performance</p>
                    <h2 id="sales-report-title">Payments and products</h2>
                  </div>
                  <StatusBadge tone="informational">Business date</StatusBadge>
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
                <p className="metric-meta">
                  Sales value is the approved shift figure. Recognised revenue for the period is{' '}
                  {formatTileMoney(report.revenue.recognizedRevenue)}. Payments:{' '}
                  {report.sales.payments
                    .map(
                      (payment) =>
                        `${paymentMethodLabel(payment.method)} ${formatTileMoney(payment.amount)}`,
                    )
                    .join(' · ') || 'none'}{' '}
                  · variance {formatTileMoney(report.sales.salesVariance)}
                </p>
              </Card>
            ) : null}

            {view === 'cash' ? (
              <Card
                as="section"
                className="panel"
                id="cash-report"
                aria-labelledby="cash-report-title"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Cash position</p>
                    <h2 id="cash-report-title">Cash: collected → banked</h2>
                  </div>
                </div>
                <dl className="summary-list">
                  <div>
                    <dt>Cash declared in reconciliations</dt>
                    <dd>{formatTileMoney(report.cash.cashEvidence)}</dd>
                  </div>
                  <div>
                    <dt>Collected</dt>
                    <dd>{formatTileMoney(report.cash.collected)}</dd>
                  </div>
                  <div>
                    <dt>Awaiting collection</dt>
                    <dd>{formatTileMoney(report.cash.awaitingCollection)}</dd>
                  </div>
                  <div>
                    <dt>Banked / confirmed</dt>
                    <dd>{formatTileMoney(report.cash.banked)}</dd>
                  </div>
                  <div>
                    <dt>Collected, not banked</dt>
                    <dd>{formatTileMoney(report.cash.collectedButNotBanked)}</dd>
                  </div>
                  <div>
                    <dt>Reconciliation cash variance</dt>
                    <dd>{formatTileMoney(report.cash.cashVariance)}</dd>
                  </div>
                </dl>
                <p className="metric-meta">
                  {report.cash.collectionIds.length} collection records ·{' '}
                  {report.cash.depositIds.length} deposit records
                </p>
              </Card>
            ) : null}

            {view === 'providers' ? (
              <Card
                as="section"
                className="panel"
                id="provider-report"
                aria-labelledby="provider-report-title"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Provider settlement position</p>
                    <h2 id="provider-report-title">EcoCash and card settlements</h2>
                  </div>
                </div>
                <dl className="summary-list">
                  <div>
                    <dt>Provider payments in reconciliations</dt>
                    <dd>{formatTileMoney(report.providers.paymentEvidence)}</dd>
                  </div>
                  <div>
                    <dt>Settlement gross</dt>
                    <dd>{formatTileMoney(report.providers.settlementGross)}</dd>
                  </div>
                  <div>
                    <dt>Allocated</dt>
                    <dd>{formatTileMoney(report.providers.allocatedAmount)}</dd>
                  </div>
                  <div>
                    <dt>Unallocated provider amount</dt>
                    <dd>{formatTileMoney(report.providers.unallocatedProviderAmount)}</dd>
                  </div>
                  <div>
                    <dt>Payments not yet matched</dt>
                    <dd>{formatTileMoney(report.providers.unmatchedEvidenceAmount)}</dd>
                  </div>
                  <div>
                    <dt>Fees and deductions</dt>
                    <dd>{formatTileMoney(report.providers.feesAndDeductions)}</dd>
                  </div>
                </dl>
                {report.providers.rows.length === 0 ? (
                  <EmptyState
                    title="No settlements"
                    message="No provider settlements fall in this settlement-date range."
                  />
                ) : (
                  <p className="metric-meta">
                    {report.providers.rows.length}{' '}
                    {report.providers.rows.length === 1 ? 'settlement' : 'settlements'} in this
                    period.
                  </p>
                )}
              </Card>
            ) : null}

            {view === 'commercial' ? (
              <Card
                as="section"
                className="panel"
                id="commercial-report"
                aria-labelledby="commercial-report-title"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Commercial exposure</p>
                    <h2 id="commercial-report-title">Suppliers and customers</h2>
                  </div>
                  <StatusBadge tone="informational">As of end date</StatusBadge>
                </div>
                <dl className="summary-list">
                  <div>
                    <dt>Supplier invoices</dt>
                    <dd>{formatTileMoney(report.suppliers.invoiceValue)}</dd>
                  </div>
                  <div>
                    <dt>Supplier credit notes</dt>
                    <dd>{formatTileMoney(report.suppliers.creditNoteValue)}</dd>
                  </div>
                  <div>
                    <dt>Supplier payments</dt>
                    <dd>{formatTileMoney(report.suppliers.payments)}</dd>
                  </div>
                  <div>
                    <dt>Customer receivables</dt>
                    <dd>{customerMoney(report.customers.receivableBalance)}</dd>
                  </div>
                  <div>
                    <dt>Prepaid value balance</dt>
                    <dd>{customerMoney(report.customers.prepaidValueBalance)}</dd>
                  </div>
                  <div>
                    <dt>Reserved amount</dt>
                    <dd>{customerMoney(report.customers.reservedAmount)}</dd>
                  </div>
                </dl>
                <p className="metric-meta">
                  Balances are as of the end date.{' '}
                  {report.customers.availability === 'AVAILABLE'
                    ? ''
                    : 'Customer balances are unavailable for a single station because they are kept for the whole organisation. '}
                  Prepaid litres are shown as litres, not converted to money.
                </p>
              </Card>
            ) : null}

            {view === 'inventory' ? (
              <Card
                as="section"
                className="panel"
                id="inventory-report"
                aria-labelledby="inventory-report-title"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Stock position</p>
                    <h2 id="inventory-report-title">Tanks, deliveries, and variance</h2>
                  </div>
                </div>
                <dl className="summary-list">
                  <div>
                    <dt>Expected stock</dt>
                    <dd>{formatLitres(report.inventory.expectedLitres)}</dd>
                  </div>
                  <div>
                    <dt>Physical stock</dt>
                    <dd>{formatLitres(report.inventory.physicalLitres)}</dd>
                  </div>
                  <div>
                    <dt>Inventory variance</dt>
                    <dd>{formatLitres(report.inventory.varianceLitres)}</dd>
                  </div>
                  <div>
                    <dt>Deliveries</dt>
                    <dd>{formatLitres(report.inventory.deliveryLitres)}</dd>
                  </div>
                  <div>
                    <dt>Landed-cost evidence</dt>
                    <dd>{formatTileMoney(report.inventory.deliveryValue)}</dd>
                  </div>
                </dl>
                <p className="metric-meta">
                  {report.inventory.rows.length} tank/product rows · movement and delivery IDs are
                  returned by the API.
                </p>
              </Card>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
