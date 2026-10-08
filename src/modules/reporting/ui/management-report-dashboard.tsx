'use client';

import { useEffect, useRef, useState } from 'react';
import {
  formatBusinessDate,
  formatLitresDisplay,
  formatMoneyDisplay,
  formatStatusSentence,
  formatUnitPrice,
} from '../../../design-system/formatters';
import { Section } from '../../../design-system/layout';
import {
  ActionSheet,
  KpiGrid,
  KpiTile,
  RefreshButton,
  SegmentedControl,
  SkeletonCard,
  SkeletonTiles,
} from '../../../design-system/page-kit';
import { Button, EmptyState, ErrorState, Field } from '../../../design-system/primitives';
import { TableScrollRegion } from '../../../design-system/table';
import type { ManagementReport } from '../contracts';

type Period = 'today' | '7d' | '30d' | 'custom';
type Tab = 'sales' | 'cash' | 'providers' | 'commercial' | 'stock';
type Range = { fromDate: string; toDate: string };

const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: 'custom', label: 'Custom' },
];

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'cash', label: 'Cash' },
  { value: 'providers', label: 'Providers' },
  { value: 'commercial', label: 'Suppliers & customers' },
  { value: 'stock', label: 'Stock' },
];

function today(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

/** Calendar arithmetic on a YYYY-MM-DD date, independent of the viewer's timezone. */
function daysBefore(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

function presetRange(period: Exclude<Period, 'custom'>): Range {
  const end = today();
  return {
    fromDate: period === 'today' ? end : daysBefore(end, period === '7d' ? 6 : 29),
    toDate: end,
  };
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash payments',
  ECOCASH: 'EcoCash payments',
  POS: 'Card payments',
};

function paymentLabel(method: string): string {
  return PAYMENT_LABELS[method.toUpperCase()] ?? `${formatStatusSentence(method)} payments`;
}

const NO_MARGIN_REASON: Record<string, string> = {
  NO_SALES: 'No sales in this period',
  UNVALUED: 'Costs not entered yet',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ManagementReportDashboard({ tenantId }: { tenantId: string }) {
  const [period, setPeriod] = useState<Period>('today');
  const [range, setRange] = useState<Range>(() => presetRange('today'));
  const [draftRange, setDraftRange] = useState<Range>(range);
  const [stationId, setStationId] = useState('');
  const [tab, setTab] = useState<Tab>('sales');
  const [report, setReport] = useState<ManagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);

  async function load(next: { range: Range; stationId: string }) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ tenantId, ...next.range });
    if (next.stationId) query.set('stationId', next.stationId);
    try {
      const response = await fetch(`/api/reports/management?${query.toString()}`, {
        cache: 'no-store',
        signal: abort.signal,
      });
      const body = (await response.json()) as { message?: string } | ManagementReport;
      if (!response.ok)
        throw new Error('message' in body ? body.message : 'The report could not be loaded.');
      setReport(body as ManagementReport);
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'The report could not be loaded.');
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load({ range, stationId }), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.current?.abort();
    };
    // The first load is tied to the organisation only. Period and station
    // changes load explicitly from their own handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function choosePeriod(next: Period) {
    if (next === 'custom') {
      setDraftRange(range);
      setCustomOpen(true);
      return;
    }
    const nextRange = presetRange(next);
    setPeriod(next);
    setRange(nextRange);
    void load({ range: nextRange, stationId });
  }

  function applyCustom(close: () => void) {
    if (!draftRange.fromDate || !draftRange.toDate || draftRange.fromDate > draftRange.toDate) {
      return;
    }
    setPeriod('custom');
    setRange(draftRange);
    close();
    void load({ range: draftRange, stationId });
  }

  function chooseStation(next: string) {
    setStationId(next);
    void load({ range, stationId: next });
  }

  const customInvalid =
    !draftRange.fromDate || !draftRange.toDate || draftRange.fromDate > draftRange.toDate;
  const periodLabel =
    range.fromDate === range.toDate
      ? formatBusinessDate(range.fromDate)
      : `${formatBusinessDate(range.fromDate)} – ${formatBusinessDate(range.toDate)}`;

  const controls = (
    <section className="section" aria-label="Report period">
      <div className="panel-heading">
        <div>
          <h2>{periodLabel}</h2>
        </div>
        <RefreshButton onClick={() => void load({ range, stationId })} disabled={loading} />
      </div>
      <div className="report-controls">
        <SegmentedControl label="Period" options={PERIODS} value={period} onChange={choosePeriod} />
        <Field id="report-station" label="Station">
          <select
            id="report-station"
            value={stationId}
            onChange={(event) => chooseStation(event.target.value)}
          >
            <option value="">All stations</option>
            {report?.stations.map((station) => (
              <option key={station.stationId} value={station.stationId}>
                {station.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ActionSheet title="Choose dates" open={customOpen} onOpenChange={setCustomOpen} size="sm">
        {(close) => (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              applyCustom(close);
            }}
          >
            <Field id="report-from" label="From" required>
              <input
                id="report-from"
                type="date"
                value={draftRange.fromDate}
                onChange={(event) =>
                  setDraftRange((current) => ({ ...current, fromDate: event.target.value }))
                }
              />
            </Field>
            <Field
              id="report-to"
              label="To"
              required
              error={
                customInvalid && draftRange.fromDate
                  ? 'Choose an end date on or after the start.'
                  : undefined
              }
            >
              <input
                id="report-to"
                type="date"
                value={draftRange.toDate}
                onChange={(event) =>
                  setDraftRange((current) => ({ ...current, toDate: event.target.value }))
                }
              />
            </Field>
            <div className="sheet-actions">
              <Button type="submit" disabled={customInvalid} block>
                Show report
              </Button>
              <Button type="button" variant="secondary" onClick={close} block>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </ActionSheet>
    </section>
  );

  if (loading && !report) {
    return (
      <div className="report-page" aria-busy="true">
        <SkeletonTiles count={4} label="Loading report figures" />
        <SkeletonCard label="Loading report" lines={4} />
      </div>
    );
  }

  const noSales = report ? report.sales.rows.length === 0 : false;
  const money = formatMoneyDisplay;
  const litres = formatLitresDisplay;
  const customerMoney = (value: string | null) => (value === null ? '—' : money(value));

  return (
    <div className="report-page">
      {controls}

      {error ? (
        <ErrorState
          title="Report unavailable"
          message={error}
          action={<Button onClick={() => void load({ range, stationId })}>Try again</Button>}
        />
      ) : null}

      {report ? (
        <>
          <div className="kpi-section">
            <KpiGrid label="Headline figures">
              <KpiTile
                label="Sales"
                onSelect={() => setTab('sales')}
                icon="dollar"
                state={loading ? 'loading' : noSales ? 'empty' : 'ready'}
                value={noSales ? null : money(report.revenue.recognizedRevenue)}
                caption={noSales ? 'No sales in this period' : undefined}
              />
              <KpiTile
                label="Litres sold"
                onSelect={() => setTab('sales')}
                icon="drop"
                state={loading ? 'loading' : noSales ? 'empty' : 'ready'}
                value={noSales ? null : litres(report.sales.litresSold)}
                caption={noSales ? 'No sales in this period' : undefined}
              />
              <KpiTile
                label="Gross margin"
                onSelect={() => setTab('sales')}
                icon="trend"
                state={loading ? 'loading' : report.grossMargin === null ? 'empty' : 'ready'}
                value={report.grossMargin === null ? null : money(report.grossMargin)}
                caption={
                  report.grossMargin === null
                    ? (NO_MARGIN_REASON[report.costing.costingStatus] ?? 'Not available yet')
                    : undefined
                }
              />
              <KpiTile
                label="Cash not banked"
                onSelect={() => setTab('cash')}
                icon="wallet"
                state={loading ? 'loading' : 'ready'}
                value={money(report.cash.collectedButNotBanked)}
              />
            </KpiGrid>
          </div>

          <SegmentedControl
            label="Report section"
            options={TABS}
            value={tab}
            onChange={setTab}
            fit="content"
          />

          {tab === 'sales' ? (
            <Section title="Sales by product" headingId="sales-report-title">
              {noSales ? (
                <EmptyState
                  title="No sales"
                  message="Approved shift sales for this period will appear here."
                />
              ) : (
                <TableScrollRegion label="Sales by date, station and product">
                  <table className="responsive-table">
                    <caption className="visually-hidden">
                      Sales by date, station, and product
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Product</th>
                        <th scope="col">Litres</th>
                        <th scope="col">Sales</th>
                        <th scope="col">Price per litre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sales.rows.map((row) => (
                        <tr key={`${row.businessDate}-${row.stationId}-${row.productId}`}>
                          <td data-label="Date">
                            {formatBusinessDate(row.businessDate)}
                            <br />
                            <small>{row.stationCode}</small>
                          </td>
                          <td data-label="Product">{row.productName}</td>
                          <td data-label="Litres" className="numeric">
                            {litres(row.litres)}
                          </td>
                          <td data-label="Sales" className="numeric">
                            {money(row.salesValue)}
                          </td>
                          <td data-label="Price per litre" className="numeric">
                            {row.averageRealizedPrice
                              ? formatUnitPrice(row.averageRealizedPrice)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollRegion>
              )}
              {report.sales.payments.length > 0 ? (
                <dl className="summary-list">
                  {report.sales.payments.map((payment) => (
                    <Row
                      key={payment.method}
                      label={paymentLabel(payment.method)}
                      value={money(payment.amount)}
                    />
                  ))}
                  <Row label="Difference from sales" value={money(report.sales.salesVariance)} />
                </dl>
              ) : null}
            </Section>
          ) : null}

          {tab === 'cash' ? (
            <Section title="Cash" headingId="cash-report-title">
              <dl className="summary-list">
                <Row label="Cash counted at shift end" value={money(report.cash.cashEvidence)} />
                <Row label="Collected" value={money(report.cash.collected)} />
                <Row
                  label="Waiting to be collected"
                  value={money(report.cash.awaitingCollection)}
                />
                <Row label="Banked" value={money(report.cash.banked)} />
                <Row
                  label="Collected, not banked"
                  value={money(report.cash.collectedButNotBanked)}
                />
                <Row label="Cash difference" value={money(report.cash.cashVariance)} />
                <Row label="Expenses recorded" value={money(report.expenses.total)} />
              </dl>
            </Section>
          ) : null}

          {tab === 'providers' ? (
            <Section title="Providers" headingId="provider-report-title">
              <dl className="summary-list">
                <Row
                  label="Paid through providers"
                  value={money(report.providers.paymentEvidence)}
                />
                <Row label="Provider payouts" value={money(report.providers.settlementGross)} />
                <Row label="Matched" value={money(report.providers.allocatedAmount)} />
                <Row
                  label="Not matched yet"
                  value={money(report.providers.unallocatedProviderAmount)}
                />
                <Row
                  label="Payments without a payout"
                  value={money(report.providers.unmatchedEvidenceAmount)}
                />
                <Row
                  label="Fees and deductions"
                  value={money(report.providers.feesAndDeductions)}
                />
              </dl>
              {report.providers.rows.length === 0 ? (
                <EmptyState
                  title="No payouts"
                  message="Provider payouts for this period will appear here."
                />
              ) : null}
            </Section>
          ) : null}

          {tab === 'commercial' ? (
            <Section title="Suppliers and customers" headingId="commercial-report-title">
              <dl className="summary-list">
                <Row label="Owed to suppliers" value={money(report.suppliers.outstandingBalance)} />
                <Row label="Supplier invoices" value={money(report.suppliers.invoiceValue)} />
                <Row
                  label="Supplier credit notes"
                  value={money(report.suppliers.creditNoteValue)}
                />
                <Row label="Paid to suppliers" value={money(report.suppliers.payments)} />
                <Row
                  label="Owed by customers"
                  value={customerMoney(report.customers.receivableBalance)}
                />
                <Row
                  label="Customer prepaid balance"
                  value={customerMoney(report.customers.prepaidValueBalance)}
                />
                <Row
                  label="Customer amount on hold"
                  value={customerMoney(report.customers.reservedAmount)}
                />
              </dl>
              {report.customers.availability !== 'AVAILABLE' ? (
                <p className="metric-meta">Customer balances aren’t tracked per station.</p>
              ) : null}
            </Section>
          ) : null}

          {tab === 'stock' ? (
            <Section title="Stock" headingId="inventory-report-title">
              <dl className="summary-list">
                <Row label="Expected in tanks" value={litres(report.inventory.expectedLitres)} />
                <Row label="Measured in tanks" value={litres(report.inventory.physicalLitres)} />
                <Row label="Difference" value={litres(report.inventory.varianceLitres)} />
                <Row label="Delivered" value={litres(report.inventory.deliveryLitres)} />
                <Row label="Delivery cost" value={money(report.inventory.deliveryValue)} />
              </dl>
            </Section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
