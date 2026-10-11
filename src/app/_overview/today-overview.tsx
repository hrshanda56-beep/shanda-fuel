'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatBusinessDate } from '@/design-system/formatters';
import { Icon, type IconName } from '@/design-system/icons';
import { Button, ErrorState, Skeleton, StatusBadge } from '@/design-system/primitives';

import { businessToday } from '@/modules/reporting/period';
import { addExact } from '@/modules/reporting/domain';
import { formatTileLitres, formatTileMoney } from '@/modules/reporting/format';

import {
  axisLabels,
  CHART_RANGES,
  chartBuckets,
  dailyTotals,
  litresSeries,
  plotValue,
  productTotals,
  signedLitres,
  signedMoney,
  varianceTone,
  type ChartRange,
  type DailyRow,
  type SalesRow,
} from './dashboard-figures';
import { PerformanceChart } from './performance-chart';
import {
  approvalLabel,
  CLOSE_STATUS_PRESENTATION,
  countSuspendedCustomers,
  operationsAttention,
  shiftSummary,
  type AttentionRow,
  type TodayOperations,
} from './today-overview-model';

type Scope = { tenantId?: string; stationId?: string };

type Section<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

async function load<T>(url: string, signal: AbortSignal, failure: string): Promise<Section<T>> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal });
    if (response.status === 403) return { status: 'forbidden' };
    const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!response.ok || !body) {
      return { status: 'error', message: body?.message ?? failure };
    }
    return { status: 'ready', data: body };
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: 'error', message: failure };
  }
}

/**
 * When the address carries no scope, use the work context the shell already
 * resolved for this person, so the dashboard matches the station selector.
 */
function useCurrentContext(enabled: boolean): Scope | null {
  const [scope, setScope] = useState<Scope | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`/api/context?${new URLSearchParams({ pathname: '/' })}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (body: { data?: { current?: { organisationId?: string; stationId?: string } } } | null) => {
          const current = body?.data?.current;
          if (current?.organisationId) {
            setScope({ tenantId: current.organisationId, stationId: current.stationId });
          }
        },
      )
      .catch(() => {});
    return () => controller.abort();
  }, [enabled]);
  return scope;
}

/**
 * "Today" for the selected station. Everything shown is a server projection:
 * nothing is computed or defaulted here, and nothing appears as zero while a
 * request is still loading.
 */
export function TodayOverview({ tenantId: urlTenantId, stationId: urlStationId }: Scope) {
  const fallback = useCurrentContext(!urlTenantId);
  const tenantId = urlTenantId ?? fallback?.tenantId;
  const stationId = urlTenantId ? urlStationId : fallback?.stationId;
  const [operations, setOperations] = useState<Section<TodayOperations>>({ status: 'loading' });
  const [customers, setCustomers] = useState<Section<{ customers: { status: string }[] }>>({
    status: 'loading',
  });
  const [daily, setDaily] = useState<Section<{ rows: DailyRow[] }>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController();
    const { signal } = controller;
    const reset = window.setTimeout(() => {
      setOperations({ status: 'loading' });
      setCustomers({ status: 'loading' });
      setDaily({ status: 'loading' });
    }, 0);

    // Today's approved figures; without a station, every station this person may see.
    const reportParams = new URLSearchParams({ tenantId });
    if (stationId) reportParams.set('stationIds', stationId);
    load<{ rows: DailyRow[] }>(
      `/api/reports/daily?${reportParams}`,
      signal,
      'Today’s figures could not be loaded.',
    ).then(setDaily, () => {});

    if (stationId) {
      const params = new URLSearchParams({ tenantId, stationId });
      load<TodayOperations>(
        `/api/forecourt/operations/overview?${params}`,
        signal,
        'Daily operations could not be loaded.',
      ).then(setOperations, () => {});
    }
    load<{ customers: { status: string }[] }>(
      `/api/customers/summary?${new URLSearchParams({ tenantId })}`,
      signal,
      'Customers could not be loaded.',
    ).then(setCustomers, () => {});

    return () => {
      window.clearTimeout(reset);
      controller.abort();
    };
  }, [tenantId, stationId, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const [range, setRange] = useState<ChartRange>('30D');
  const [chart, setChart] = useState<Section<{ sales: { rows: SalesRow[] } }> & { key?: string }>({
    status: 'loading',
  });
  const [chartAttempt, setChartAttempt] = useState(0);
  const chartKey = `${tenantId ?? ''}|${stationId ?? ''}|${range}`;
  const rangeWindow = useMemo(() => chartBuckets(range, businessToday()), [range]);

  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      tenantId,
      fromDate: rangeWindow.fromDate,
      toDate: rangeWindow.toDate,
    });
    if (stationId) params.set('stationIds', stationId);
    load<{ sales: { rows: SalesRow[] } }>(
      `/api/reports/management?${params}`,
      controller.signal,
      'Sales could not be loaded.',
    ).then(
      (section) => setChart({ ...section, key: chartKey }),
      () => {},
    );
    return () => controller.abort();
  }, [tenantId, stationId, rangeWindow, chartKey, chartAttempt]);

  const reportsHref = useMemo(() => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (stationId) params.set('stationId', stationId);
    return `/reports?${params}`;
  }, [tenantId, stationId]);

  const dailyHref = useMemo(() => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (stationId) params.set('stationId', stationId);
    return `/operations/daily?${params}`;
  }, [tenantId, stationId]);

  if (!tenantId) {
    return (
      <div className="today">
        <p className="today-note">
          Choose a work context from the station selector to see today’s activity.
        </p>
      </div>
    );
  }

  const attention: AttentionRow[] = [];
  if (operations.status === 'ready') {
    const row = operationsAttention(operations.data, dailyHref);
    if (row) attention.push(row);
  }
  if (customers.status === 'ready') {
    const suspended = countSuspendedCustomers(customers.data.customers);
    if (suspended > 0) {
      attention.push({
        id: 'customers-suspended',
        title: suspended === 1 ? '1 customer is suspended' : `${suspended} customers are suspended`,
        detail: 'They cannot start new account transactions.',
        href: `/customers?${new URLSearchParams({ tenantId })}`,
      });
    }
  }
  const attentionLoading = operations.status === 'loading' || customers.status === 'loading';

  const totals = daily.status === 'ready' ? dailyTotals(daily.data.rows) : null;
  const figureState: FigureState =
    daily.status === 'ready' ? (totals ? 'ready' : 'none') : daily.status;

  const chartReady = chart.status === 'ready' && chart.key === chartKey ? chart : null;
  const salesRows = chartReady ? chartReady.data.sales.rows : [];
  const points = litresSeries(salesRows, rangeWindow.buckets);
  const series = chartReady
    ? points.map((point) => ({
        label: point.label,
        value: plotValue(point.litres),
        detail: point.products
          .map((product) => `${product.name} ${formatTileLitres(product.litres)}`)
          .join(' · '),
      }))
    : null;
  const rangeSummary = productTotals(salesRows);

  return (
    <div className="today today-dashboard">
      <section
        className="today-section today-figures-section"
        aria-labelledby="today-figures-heading"
      >
        <h2 id="today-figures-heading">Key figures</h2>
        <p className="today-figures-note">
          {stationId ? 'Approved figures for today.' : 'All stations · Approved figures for today.'}{' '}
          Expected cash is not available yet.
        </p>
        <dl className="today-figures">
          <Figure
            label="Sales today"
            href={reportsHref}
            icon="dollar"
            state={figureState}
            value={totals ? formatTileMoney(totals.salesValue) : null}
            sub={totals ? `Account and prepaid ${formatTileMoney(totals.accountSales)}` : null}
          />
          <Figure
            label="Litres sold"
            href={reportsHref}
            icon="drop"
            state={figureState}
            value={totals ? formatTileLitres(totals.litresSold) : null}
            sub={
              totals && !stationId
                ? `${totals.stationCount} ${totals.stationCount === 1 ? 'station' : 'stations'} approved`
                : null
            }
          />
          <Figure
            label="Cash variance"
            href={reportsHref}
            icon="wallet"
            state={figureState}
            value={totals ? signedMoney(totals.cashVariance) : null}
            sub={totals ? VARIANCE_WORDS.cash[varianceTone(totals.cashVariance)] : null}
            tone={totals ? varianceTone(totals.cashVariance) : undefined}
          />
          <Figure
            label="Stock variance"
            href={reportsHref}
            icon="fuel"
            state={figureState}
            value={totals ? signedLitres(totals.inventoryVariance) : null}
            sub={totals ? VARIANCE_WORDS.stock[varianceTone(totals.inventoryVariance)] : null}
            tone={totals ? varianceTone(totals.inventoryVariance) : undefined}
          />
        </dl>
      </section>

      <div className="today-side">
        <section className="today-section" aria-labelledby="today-ops-heading">
          <h2 id="today-ops-heading">Daily operations</h2>
          {!stationId ? (
            <p className="today-note">Choose a station to see today’s operations.</p>
          ) : operations.status === 'loading' ? (
            <Skeleton lines={2} label="Loading daily operations" />
          ) : operations.status === 'forbidden' ? (
            <p className="today-note">
              You don’t have access to daily operations for this station.
            </p>
          ) : operations.status === 'error' ? (
            <ErrorState
              title="Daily operations unavailable"
              message={operations.message}
              action={
                <Button variant="secondary" onClick={retry}>
                  Try again
                </Button>
              }
            />
          ) : (
            <OperationsRow operations={operations.data} href={dailyHref} />
          )}
        </section>

        <section className="today-section" aria-labelledby="today-attention-heading">
          <h2 id="today-attention-heading">Needs attention</h2>
          {attentionLoading && attention.length === 0 ? (
            <Skeleton lines={2} label="Checking for items that need attention" />
          ) : attention.length > 0 ? (
            <ul className="today-list">
              {attention.map((row) => (
                <li key={row.id}>
                  <Link className="today-row" href={row.href}>
                    <span className="today-row-text">
                      <span className="today-row-title">{row.title}</span>
                      <span className="today-row-detail">{row.detail}</span>
                    </span>
                    <Icon name="chevron-right" className="today-row-chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="today-note">Nothing needs attention.</p>
          )}
          {customers.status === 'forbidden' ? (
            <p className="today-note">Customer alerts are hidden because you don’t have access.</p>
          ) : null}
          {operations.status === 'error' || customers.status === 'error' ? (
            <p className="today-note">Some items could not be checked.</p>
          ) : null}
        </section>
      </div>

      <section className="today-section today-stats" aria-labelledby="today-stats-heading">
        <div className="today-stats-head">
          <h2 id="today-stats-heading">
            Sales performance <span className="today-stats-sub">Litres</span>
          </h2>
          <div className="today-periods" role="group" aria-label="Period">
            {CHART_RANGES.map((option) => (
              <button
                key={option}
                type="button"
                className="today-period"
                aria-pressed={range === option}
                data-active={range === option || undefined}
                onClick={() => setRange(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        {chart.status === 'error' && chart.key === chartKey ? (
          <ErrorState
            title="Sales trend unavailable"
            message={chart.message}
            action={
              <Button variant="secondary" onClick={() => setChartAttempt((value) => value + 1)}>
                Try again
              </Button>
            }
          />
        ) : chart.status === 'forbidden' && chart.key === chartKey ? (
          <p className="today-note">You don’t have access to sales reports.</p>
        ) : !chartReady ? (
          <Skeleton lines={4} label="Loading sales trend" />
        ) : (
          <>
            <PerformanceChart
              series={series}
              xLabels={axisLabels(points.map((point) => point.label))}
              formatValue={(value) => formatTileLitres(String(Math.round(value)))}
              label={`Litres sold, ${range}, approved days only`}
              emptyMessage="No approved sales in this period yet."
              gapMessage="No approved report"
            />
            {rangeSummary.length > 0 ? (
              <p className="today-stats-summary">
                {range} ·{' '}
                {formatTileLitres(
                  points.reduce(
                    (sum, point) => (point.litres === null ? sum : addExact(sum, point.litres)),
                    '0',
                  ),
                )}
                {rangeSummary.map((product) => (
                  <span key={product.name}>
                    {' · '}
                    {product.name} {formatTileLitres(product.litres)}
                  </span>
                ))}
              </p>
            ) : null}
          </>
        )}
        <p className="today-note">
          <Link href={reportsHref}>Open reports</Link>
        </p>
      </section>
    </div>
  );
}

const VARIANCE_WORDS = {
  cash: { none: 'No cash variance', short: 'Cash short', over: 'Cash over' },
  stock: { none: 'No stock variance', short: 'Stock short', over: 'Stock over' },
} as const;

type FigureState = 'loading' | 'ready' | 'forbidden' | 'error' | 'none';

const FIGURE_CAPTION: Partial<Record<FigureState, string>> = {
  forbidden: 'No access',
  error: 'Unavailable',
  none: 'No approved report yet',
};

function Figure({
  label,
  href,
  icon,
  state,
  value,
  sub = null,
  tone,
}: {
  label: string;
  href: string;
  icon: IconName;
  state: FigureState;
  value: string | null;
  sub?: string | null;
  tone?: 'none' | 'over' | 'short';
}) {
  return (
    <div className="today-figure" data-state={state} data-tone={tone}>
      <span className="today-figure-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="today-figure-line" aria-hidden="true" />
      <dt>
        <Link className="today-figure-link" href={href}>
          {label}
        </Link>
      </dt>
      <dd>
        {state === 'loading' ? (
          <Skeleton lines={1} label={`Loading ${label.toLowerCase()}`} />
        ) : value !== null ? (
          <>
            <span className="today-figure-value">{value}</span>
            {sub ? <span className="today-figure-caption">{sub}</span> : null}
          </>
        ) : (
          <>
            <span className="today-figure-value" aria-hidden="true">
              —
            </span>
            <span className="today-figure-caption">{FIGURE_CAPTION[state]}</span>
          </>
        )}
      </dd>
    </div>
  );
}

function OperationsRow({ operations, href }: { operations: TodayOperations; href: string }) {
  const close = CLOSE_STATUS_PRESENTATION[operations.status.close];
  const approval = approvalLabel(operations.status.approval);
  return (
    <Link className="today-hero" href={href}>
      <span className="today-hero-ring" aria-hidden="true">
        <Icon name="fuel" />
      </span>
      <span className="today-hero-title">{operations.station.name}</span>
      <span className="today-hero-detail">
        {formatBusinessDate(operations.currentBusinessDate)} · {shiftSummary(operations.shifts)}
        {approval ? ` · ${approval}` : ''}
      </span>
      <span className="today-hero-status">
        <StatusBadge tone={close.tone}>{close.label}</StatusBadge>
        <span className="today-hero-go" aria-hidden="true">
          <Icon name="arrow-right" />
        </span>
      </span>
    </Link>
  );
}
