'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { formatBusinessDate, formatLitres, formatMoney } from '../../../design-system/formatters';
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
import { businessToday } from '../period';
import type { ReportDefinition } from '../catalog';
import { ReportFilterBar } from './report-filter-bar';
import { useAvailableStations } from './use-available-stations';

function customerMoney(value: string | null): string {
  return value === null ? 'Unavailable' : formatMoney(value);
}

const managementReportState: ManagementReport['state'] = 'POSTED';

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
              {report?.state ?? managementReportState}
            </StatusBadge>
          </div>
          <ReportFilterBar stations={stations} filters={filters} onChange={changeFilters} />
          {!range ? (
            <p className="field-hint" role="status">
              Choose both dates, with the start on or before the end.
            </p>
          ) : null}
          <p className="metric-meta">
            Figures come from posted source records, each on its own date basis. This is an
            operational view, not a general ledger, statutory P&amp;L, balance sheet, tax report, or
            bank statement.
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
                value={formatMoney(report.sales.salesValue)}
                meta={`${formatLitres(report.sales.litresSold)} litres sold`}
                href={detailHref('sales')}
              />
              <MetricCard
                label="Cash collected"
                value={formatMoney(report.cash.collected)}
                meta={`${formatMoney(report.cash.collectedButNotBanked)} not yet banked`}
                href={detailHref('cash')}
              />
              <MetricCard
                label="Provider settlements outstanding"
                value={formatMoney(report.providers.unallocatedProviderAmount)}
                meta="Unallocated"
                href={detailHref('providers')}
              />
              <MetricCard
                label="Supplier balance"
                value={formatMoney(report.suppliers.outstandingBalance)}
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
                            {formatMoney(row.salesValue)}
                          </td>
                          <td data-label="Average price" className="numeric">
                            {row.averageRealizedPrice ? formatMoney(row.averageRealizedPrice) : '—'}
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
                  Accounted sales and reading sales value are operational control evidence, not
                  revenue authority. Canonical recognized revenue is{' '}
                  {formatMoney(report.revenue.recognizedRevenue)}. Payment evidence:{' '}
                  {report.sales.payments
                    .map((payment) => `${payment.method} ${formatMoney(payment.amount)}`)
                    .join(' · ') || 'none'}{' '}
                  · variance {formatMoney(report.sales.salesVariance)}
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
                    <h2 id="cash-report-title">Evidence → collected → banked</h2>
                  </div>
                </div>
                <dl className="summary-list">
                  <div>
                    <dt>Cash declared in reconciliations</dt>
                    <dd>{formatMoney(report.cash.cashEvidence)}</dd>
                  </div>
                  <div>
                    <dt>Collected</dt>
                    <dd>{formatMoney(report.cash.collected)}</dd>
                  </div>
                  <div>
                    <dt>Awaiting collection</dt>
                    <dd>{formatMoney(report.cash.awaitingCollection)}</dd>
                  </div>
                  <div>
                    <dt>Banked / confirmed</dt>
                    <dd>{formatMoney(report.cash.banked)}</dd>
                  </div>
                  <div>
                    <dt>Collected, not banked</dt>
                    <dd>{formatMoney(report.cash.collectedButNotBanked)}</dd>
                  </div>
                  <div>
                    <dt>Reconciliation cash variance</dt>
                    <dd>{formatMoney(report.cash.cashVariance)}</dd>
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
                    <h2 id="provider-report-title">Electronic evidence and settlements</h2>
                  </div>
                </div>
                <dl className="summary-list">
                  <div>
                    <dt>Provider payments in reconciliations</dt>
                    <dd>{formatMoney(report.providers.paymentEvidence)}</dd>
                  </div>
                  <div>
                    <dt>Settlement gross</dt>
                    <dd>{formatMoney(report.providers.settlementGross)}</dd>
                  </div>
                  <div>
                    <dt>Allocated</dt>
                    <dd>{formatMoney(report.providers.allocatedAmount)}</dd>
                  </div>
                  <div>
                    <dt>Unallocated provider amount</dt>
                    <dd>{formatMoney(report.providers.unallocatedProviderAmount)}</dd>
                  </div>
                  <div>
                    <dt>Unmatched reconciliation evidence</dt>
                    <dd>{formatMoney(report.providers.unmatchedEvidenceAmount)}</dd>
                  </div>
                  <div>
                    <dt>Fees / deductions evidence</dt>
                    <dd>{formatMoney(report.providers.feesAndDeductions)}</dd>
                  </div>
                </dl>
                {report.providers.rows.length === 0 ? (
                  <EmptyState
                    title="No settlement evidence"
                    message="No provider settlements fall in this settlement-date range."
                  />
                ) : (
                  <p className="metric-meta">
                    {report.providers.rows.length} settlement records with canonical IDs available
                    for drill-down.
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
                    <dd>{formatMoney(report.suppliers.invoiceValue)}</dd>
                  </div>
                  <div>
                    <dt>Supplier credit notes</dt>
                    <dd>{formatMoney(report.suppliers.creditNoteValue)}</dd>
                  </div>
                  <div>
                    <dt>Supplier payments</dt>
                    <dd>{formatMoney(report.suppliers.payments)}</dd>
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
                  Supplier exposure is a balance as of the selected toDate; customer exposure is
                  also as of toDate when available.{' '}
                  {report.customers.availability === 'AVAILABLE'
                    ? 'Customer balances are shown as of the selected toDate. '
                    : 'Customer balances are unavailable at station scope because A8 balances are tenant-owned without a station dimension. '}
                  Prepaid litres remain quantity evidence; this report does not convert them to
                  money.
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
                    <dd>{formatMoney(report.inventory.deliveryValue)}</dd>
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
