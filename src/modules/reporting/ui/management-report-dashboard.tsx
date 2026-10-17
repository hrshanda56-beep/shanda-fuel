'use client';

import { useEffect, useState } from 'react';
import { formatBusinessDate, formatLitres, formatMoney } from '../../../design-system/formatters';
import { NeedsAttention } from '../../../design-system/feedback';
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '../../../design-system/primitives';
import { TableScrollRegion } from '../../../design-system/table';
import type { ManagementReport } from '../contracts';
import { buildReportingNeedsAttention } from '../domain';

function today(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value numeric">{value}</strong>
      {detail ? <span className="metric-meta">{detail}</span> : null}
    </Card>
  );
}

function customerMoney(value: string | null): string {
  return value === null ? 'Unavailable' : formatMoney(value);
}

export function ManagementReportDashboard({ tenantId }: { tenantId: string }) {
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [stationId, setStationId] = useState('');
  const [report, setReport] = useState<ManagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ tenantId, fromDate, toDate });
    if (stationId) query.set('stationId', stationId);
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
    // The initial load is intentionally tied to the tenant context only.
    // Filters are applied by the explicit form submission below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }

  const attentionItems = report ? buildReportingNeedsAttention(report) : [];

  return (
    <>
      <Card as="section" className="panel" aria-labelledby="report-filters-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Posted operational facts</p>
            <h2 id="report-filters-title">Report filters</h2>
          </div>
          {report ? <StatusBadge tone="positive">{report.state}</StatusBadge> : null}
        </div>
        <form className="demo-form" onSubmit={submit}>
          <div className="form-grid">
            <Field id="report-from" label="From business date" required>
              <input
                id="report-from"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                required
              />
            </Field>
            <Field id="report-to" label="To business date" required>
              <input
                id="report-to"
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                required
              />
            </Field>
            <Field id="report-station" label="Station" hint="Leave blank for every station.">
              <select
                id="report-station"
                value={stationId}
                onChange={(event) => setStationId(event.target.value)}
              >
                <option value="">All authorized stations</option>
                {report?.stations.map((station) => (
                  <option key={station.stationId} value={station.stationId}>
                    {station.code} · {station.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button className="button button-primary" type="submit" disabled={loading}>
            Refresh report
          </button>
          <a
            className="button button-secondary"
            href={`/api/reports/management/export?${new URLSearchParams({
              tenantId,
              fromDate,
              toDate,
              ...(stationId ? { stationId } : {}),
            }).toString()}`}
          >
            Export CSV
          </a>
        </form>
        <p className="metric-meta">
          Every section uses its documented source date basis. A10 reports posted source facts; it
          is not a general ledger, statutory P&amp;L, balance sheet, tax report, or bank statement.
        </p>
      </Card>

      {loading ? <LoadingState label="Loading management report" /> : null}
      {error ? <ErrorState title="Report unavailable" message={error} /> : null}
      {!loading && !error && report ? (
        <>
          <Card as="section" className="panel" aria-labelledby="report-attention-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Exception-first control</p>
                <h2 id="report-attention-title">Needs attention</h2>
              </div>
              <StatusBadge
                tone={
                  attentionItems.some((item) => item.priority === 'warning')
                    ? 'warning'
                    : 'positive'
                }
              >
                {attentionItems.length === 0
                  ? 'No report-derived items'
                  : `${attentionItems.length} item${attentionItems.length === 1 ? '' : 's'}`}
              </StatusBadge>
            </div>
            <NeedsAttention
              items={attentionItems.map((item) => ({
                id: item.id,
                priority: item.priority,
                title: item.title,
                detail: item.detail,
                meta: item.meta,
                action: (
                  <a className="text-link" href={item.anchor}>
                    Review evidence
                  </a>
                ),
              }))}
              emptyMessage="No non-zero cash, provider, stock, or costing facts need review for this period."
            />
            <p className="metric-meta">
              Read-only projection from this report’s authorized source facts. It does not
              acknowledge, resolve, or mutate the underlying ledgers.
            </p>
          </Card>

          <section className="metric-grid" aria-label="Management report headline metrics">
            <Metric
              label="Accounted sales"
              value={formatMoney(report.sales.salesValue)}
              detail={`${report.sales.approvedReconciliationCount} approved reconciliations`}
            />
            <Metric
              label="Recognized revenue"
              value={formatMoney(report.revenue.recognizedRevenue)}
              detail="REV1 ordinary fuel sales"
            />
            <Metric
              label="Gross margin"
              value={report.grossMargin === null ? 'Unavailable' : formatMoney(report.grossMargin)}
              detail={
                report.grossMargin === null
                  ? `COGS status: ${report.costing.costingStatus}`
                  : 'Recognized revenue − restated COGS'
              }
            />
            <Metric
              label="Litres sold"
              value={formatLitres(report.sales.litresSold)}
              detail="A5 meter readings"
            />
            <Metric
              label="Cash collected"
              value={formatMoney(report.cash.collected)}
              detail={`${formatMoney(report.cash.collectedButNotBanked)} not banked`}
            />
            <Metric
              label="Provider outstanding"
              value={formatMoney(report.providers.unallocatedProviderAmount)}
              detail="A9 settlement evidence"
            />
            <Metric
              label="Supplier exposure"
              value={formatMoney(report.suppliers.outstandingBalance)}
              detail="A7 balance as of toDate"
            />
            <Metric
              label="Customer receivables"
              value={customerMoney(report.customers.receivableBalance)}
              detail={
                report.customers.availability === 'AVAILABLE'
                  ? 'A8 credit ledger as of toDate'
                  : 'A8 has no station dimension'
              }
            />
            <Metric
              label="Expected stock"
              value={formatLitres(report.inventory.expectedLitres)}
              detail={`${formatLitres(report.inventory.varianceLitres)} variance`}
            />
            <Metric
              label="Recorded expenses"
              value={formatMoney(report.expenses.total)}
              detail="A5 only"
            />
          </section>

          <Card as="section" className="panel" aria-labelledby="report-explanation-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Source lineage</p>
                <h2 id="report-explanation-title">Explain these numbers</h2>
              </div>
              <StatusBadge tone="informational">Evidence-linked</StatusBadge>
            </div>
            <p>
              These explanations identify the authoritative domain and date basis behind each
              headline. They do not recalculate or replace the source ledgers.
            </p>
            <dl className="summary-list">
              <div>
                <dt>Recognized revenue</dt>
                <dd>
                  REV1 sale-recognition movements · {report.revenue.saleCount} canonical sale rows ·{' '}
                  {report.dateBasis.recognizedRevenue}
                </dd>
              </div>
              <div>
                <dt>Gross margin</dt>
                <dd>
                  Recognized revenue minus restated A12 COGS · costing status{' '}
                  {report.costing.costingStatus} · {report.costing.valuedSaleCount} valued sales
                </dd>
              </div>
              <div>
                <dt>Cash collected</dt>
                <dd>
                  A6 collection evidence · {report.cash.collectionIds.length} collection records ·{' '}
                  {report.dateBasis.cashCollections}
                </dd>
              </div>
              <div>
                <dt>Supplier exposure</dt>
                <dd>{report.dateBasis.suppliers}</dd>
              </div>
              <div>
                <dt>Expected stock and variance</dt>
                <dd>{report.dateBasis.inventory}</dd>
              </div>
            </dl>
            <details>
              <summary>Show source identifiers</summary>
              <div className="metric-meta">
                <p>
                  Reconciliations:{' '}
                  {report.sales.reconciliationIds.slice(0, 12).join(', ') || 'none'}
                </p>
                <p>
                  Revenue movements:{' '}
                  {report.revenue.sales
                    .slice(0, 12)
                    .map((sale) => sale.revenueMovementId)
                    .join(', ') || 'none'}
                </p>
                <p>
                  Costing rows:{' '}
                  {report.costing.sales
                    .slice(0, 12)
                    .map((sale) => sale.saleMovementId)
                    .join(', ') || 'none'}
                </p>
              </div>
            </details>
          </Card>

          <div className="content-grid">
            <Card as="section" className="panel" aria-labelledby="sales-report-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Sales performance</p>
                  <h2 id="sales-report-title">Payments and products</h2>
                </div>
                <StatusBadge tone="informational">A5 business date</StatusBadge>
              </div>
              <TableScrollRegion label="Payments and products table">
                <table className="responsive-table">
                  <caption className="visually-hidden">Sales by date, station, and product</caption>
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

            <Card as="section" className="panel" aria-labelledby="cash-report-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Cash position</p>
                  <h2 id="cash-report-title">Evidence → collected → banked</h2>
                </div>
                <StatusBadge tone="warning">Never conflated</StatusBadge>
              </div>
              <dl className="summary-list">
                <div>
                  <dt>A5 cash evidence</dt>
                  <dd>{formatMoney(report.cash.cashEvidence)}</dd>
                </div>
                <div>
                  <dt>Collected by A6</dt>
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
                  <dt>A5 cash variance</dt>
                  <dd>{formatMoney(report.cash.cashVariance)}</dd>
                </div>
              </dl>
              <p className="metric-meta">
                {report.cash.collectionIds.length} collection records ·{' '}
                {report.cash.depositIds.length} deposit records
              </p>
            </Card>

            <Card as="section" className="panel" aria-labelledby="provider-report-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Provider settlement position</p>
                  <h2 id="provider-report-title">Electronic evidence and settlements</h2>
                </div>
                <StatusBadge tone="informational">A5 / A9 separate</StatusBadge>
              </div>
              <dl className="summary-list">
                <div>
                  <dt>A5 provider evidence</dt>
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
                  <dt>Unmatched A5 evidence</dt>
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
                  message="No A9 settlement records match the settlement-date window."
                />
              ) : (
                <p className="metric-meta">
                  {report.providers.rows.length} settlement records with canonical IDs available for
                  drill-down.
                </p>
              )}
            </Card>

            <Card as="section" className="panel" aria-labelledby="commercial-report-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Commercial exposure</p>
                  <h2 id="commercial-report-title">Suppliers and customers</h2>
                </div>
                <StatusBadge tone="informational">A7 / A8 ledgers</StatusBadge>
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
                Supplier exposure is a balance as of the selected toDate; customer exposure is also
                as of toDate when available.{' '}
                {report.customers.availability === 'AVAILABLE'
                  ? 'Customer balances are shown as of the selected toDate. '
                  : 'Customer balances are unavailable at station scope because A8 balances are tenant-owned without a station dimension. '}
                Prepaid litres remain quantity evidence; A10 does not convert them to money.
              </p>
            </Card>

            <Card as="section" className="panel" aria-labelledby="inventory-report-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Stock position</p>
                  <h2 id="inventory-report-title">Tanks, deliveries, and variance</h2>
                </div>
                <StatusBadge tone="informational">A4 source</StatusBadge>
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
          </div>
        </>
      ) : null}
    </>
  );
}
