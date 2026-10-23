'use client';
import { useContextFetch } from '@/modules/context/client-context';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

import { formatBusinessDate } from '@/design-system/formatters';
import { Icon, type IconName } from '@/design-system/icons';
import { Button, ErrorState, Skeleton, StatusBadge } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';

import { businessToday } from '@/modules/reporting/period';
import { addExact } from '@/modules/reporting/domain';
import { formatTileLitres, formatTileMoney } from '@/modules/reporting/format';

import {
  axisLabels,
  CHART_RANGES,
  chartBuckets,
  chartTable,
  figureChars,
  dailyTotals,
  litresSeries,
  plotValue,
  productTotals,
  signedMoney,
  varianceTone,
  type ChartRange,
  type DailyRow,
  type LitresPoint,
  type SalesRow,
} from './dashboard-figures';
import { FinanceTiles } from '@/modules/owner/ui/finance-tiles';
import type { FinanceTile } from '@/modules/reporting/finance-tiles';

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

export type Scope = { tenantId?: string; stationId?: string };

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
  const contextFetch = useContextFetch();
  const [scope, setScope] = useState<Scope | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    contextFetch(`/api/context?${new URLSearchParams({ pathname: '/' })}`, {
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
  }, [enabled, contextFetch]);
  return scope;
}

/**
 * "Today" for the selected station. Everything shown is a server projection:
 * nothing is computed or defaulted here, and nothing appears as zero while a
 * request is still loading.
 */
export function TodayOverview({
  tenantId: urlTenantId,
  stationId: urlStationId,
  initialContext,
  initialData,
}: Scope & { initialContext?: Scope; initialData?: DashboardInitialData }) {
  const fallback = useCurrentContext(!urlTenantId && !initialContext?.tenantId);
  const resolvedContext = initialContext ?? fallback;
  const tenantId = urlTenantId ?? resolvedContext?.tenantId;
  const stationId = urlTenantId ? urlStationId : resolvedContext?.stationId;
  const [operations, setOperations] = useState<Section<TodayOperations>>(
    initialData?.operations ?? { status: 'loading' },
  );
  const [customers, setCustomers] = useState<Section<{ customers: readonly { status: string }[] }>>(
    initialData?.customers ?? { status: 'loading' },
  );
  const [daily, setDaily] = useState<Section<DailyReport>>(
    initialData?.daily ?? { status: 'loading' },
  );
  const [finance, setFinance] = useState<Section<readonly FinanceTile[]>>(
    initialData?.finance ?? { status: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const [range, setRange] = useState<ChartRange>('30D');
  const [chart, setChart] = useState<
    Section<{ sales: { rows: readonly SalesRow[] } }> & { key?: string }
  >({
    ...(initialData?.chart ?? { status: 'loading' as const }),
    key: initialData?.key,
  });
  const [chartAttempt, setChartAttempt] = useState(0);
  const chartKey = `${tenantId ?? ''}|${stationId ?? ''}|${range}`;
  const rangeWindow = useMemo(() => chartBuckets(range, businessToday()), [range]);

  useEffect(() => {
    if (!tenantId) return;
    if (initialData && attempt === 0) return;
    const controller = new AbortController();
    const reset = window.setTimeout(() => {
      setDaily({ status: 'loading' });
      setCustomers({ status: 'loading' });
      setOperations({ status: 'loading' });
      setFinance({ status: 'loading' });
    }, 0);
    const initialWindow = chartBuckets('30D', businessToday());
    const params = new URLSearchParams({
      tenantId,
      fromDate: initialWindow.fromDate,
      toDate: initialWindow.toDate,
    });
    if (stationId) params.set('stationId', stationId);
    load<{
      daily: Section<DailyReport>;
      customers: Section<{ customers: readonly { status: string }[] }>;
      operations: Section<TodayOperations> | null;
      chart: Section<{ sales: { rows: readonly SalesRow[] } }>;
      finance?: Section<readonly FinanceTile[]>;
    }>(`/api/dashboard?${params}`, controller.signal, 'Sales could not be loaded.').then(
      (section) => {
        if (section.status === 'ready') {
          setDaily(section.data.daily);
          setCustomers(section.data.customers);
          if (section.data.operations) setOperations(section.data.operations);
          setFinance(section.data.finance ?? { status: 'forbidden' });
          setChart({ ...section.data.chart, key: `${tenantId}|${stationId ?? ''}|30D` });
        } else {
          setDaily(section);
          setCustomers(section);
          setOperations(section);
          setFinance(section);
          setChart({ ...section, key: `${tenantId}|${stationId ?? ''}|30D` });
        }
      },
      () => {},
    );
    return () => {
      window.clearTimeout(reset);
      controller.abort();
    };
  }, [tenantId, stationId, attempt, initialData]);

  useEffect(() => {
    if (
      !tenantId ||
      (!initialData && range === '30D' && chartAttempt === 0) ||
      (initialData?.key === chartKey && chartAttempt === 0)
    )
      return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      tenantId,
      fromDate: rangeWindow.fromDate,
      toDate: rangeWindow.toDate,
    });
    if (stationId) params.set('stationId', stationId);
    void load<{ sales: { rows: readonly SalesRow[] } }>(
      `/api/dashboard/sales?${params}`,
      controller.signal,
      'Sales could not be loaded.',
    ).then(
      (result) => setChart({ ...result, key: chartKey }),
      () => {},
    );
    return () => controller.abort();
  }, [tenantId, stationId, rangeWindow, chartKey, chartAttempt, initialData, range]);

  const customersHref = useMemo(
    () =>
      tenantId
        ? `/customers?${new URLSearchParams({ tenantId, ...(stationId ? { stationId } : { allStations: 'true' }) })}`
        : '/customers',
    [tenantId, stationId],
  );
  const reportsHref = useMemo(() => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (stationId) params.set('stationId', stationId);
    else params.set('allStations', 'true');
    return `/reports?${params}`;
  }, [tenantId, stationId]);

  const dailyHref = useMemo(() => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (stationId) params.set('stationId', stationId);
    else params.set('allStations', 'true');
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
        href: customersHref,
      });
    }
  }
  const attentionLoading =
    (Boolean(stationId) && operations.status === 'loading') || customers.status === 'loading';

  const totals = daily.status === 'ready' ? dailyTotals(daily.data.rows) : null;
  const figureValues: (string | null)[] = totals
    ? [
        formatTileMoney(totals.salesValue),
        formatTileLitres(totals.litresSold),
        signedMoney(totals.cashVariance),
        formatTileMoney(totals.accountSales),
      ]
    : [null, null, null, null];
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
          {stationId ? '' : 'All stations · '}Approved figures for{' '}
          {daily.status === 'ready' && daily.data.filters?.fromDate
            ? formatBusinessDate(daily.data.filters.fromDate)
            : 'today'}
          . Expected cash and stock variance are not available yet.
        </p>
        <dl
          className="today-figures"
          // One size for all four cards, from the longest figure shown.
          style={
            {
              '--figure-chars': Math.max(
                ...figureValues.map((value) => (value === null ? 6 : figureChars(value))),
              ),
            } as CSSProperties
          }
        >
          <Figure
            label="Sales today"
            href={reportsHref}
            icon="dollar"
            state={figureState}
            value={figureValues[0] ?? null}
          />
          <Figure
            label="Litres sold"
            href={reportsHref}
            icon="drop"
            state={figureState}
            value={figureValues[1] ?? null}
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
            value={figureValues[2] ?? null}
            sub={totals ? CASH_VARIANCE_WORDS[varianceTone(totals.cashVariance)] : null}
            tone={totals ? varianceTone(totals.cashVariance) : undefined}
          />
          <Figure
            label="Account sales"
            href={customersHref}
            icon="users"
            state={figureState}
            value={figureValues[3] ?? null}
            sub={totals ? 'Credit and prepaid accounts' : null}
          />
        </dl>
        {/* Money at a glance: only for people allowed to see the management figures. */}
        {finance.status === 'ready' ? (
          <div style={{ marginBlockStart: 'var(--space-6)' }}>
            <FinanceTiles tiles={finance.data} />
          </div>
        ) : null}
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
            <ChartTableView points={points} range={range} />
          </>
        )}
        <p className="today-note">
          <Link href={reportsHref}>Open reports</Link>
        </p>
      </section>
    </div>
  );
}

const CASH_VARIANCE_WORDS = {
  none: 'No cash variance',
  short: 'Cash short',
  over: 'Cash over',
} as const;

type DailyReport = { filters?: { fromDate?: string }; rows: readonly DailyRow[] };

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

function periodLabel(from: string, to: string): string {
  return from === to
    ? formatBusinessDate(from)
    : `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;
}

/**
 * The sales chart as a table (finish line F3-03): the same approved-report
 * points, one row per period. A period without an approved report says so;
 * nothing missing is shown as zero.
 */
function ChartTableView({ points, range }: { points: LitresPoint[]; range: ChartRange }) {
  const table = chartTable(points);
  return (
    <details className="today-chart-table">
      <summary>Show the chart as a table</summary>
      <TableScrollRegion label={`Litres sold by period, ${range}`}>
        <table className="responsive-table">
          <caption>Litres sold, {range}, from approved reports only</caption>
          <thead>
            <tr>
              <th scope="col">Business date</th>
              <th scope="col">Litres sold</th>
              {table.products.map((name) => (
                <th scope="col" key={name}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.from}>
                <th scope="row" data-label="Business date">
                  {periodLabel(row.from, row.to)}
                </th>
                {row.total === null ? (
                  <td data-label="Litres sold" colSpan={1 + table.products.length}>
                    No approved report
                  </td>
                ) : (
                  <>
                    <td data-label="Litres sold" className="numeric">
                      {formatTileLitres(row.total)}
                    </td>
                    {row.byProduct.map((litres, index) => (
                      <td
                        key={table.products[index]}
                        data-label={table.products[index]}
                        className="numeric"
                      >
                        {litres === null ? (
                          <>
                            <span aria-hidden="true">—</span>
                            <span className="visually-hidden">No approved figure</span>
                          </>
                        ) : (
                          formatTileLitres(litres)
                        )}
                      </td>
                    ))}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
    </details>
  );
}

export type DashboardInitialData = {
  key: string;
  daily: Section<DailyReport>;
  customers: Section<{ customers: readonly { status: string }[] }>;
  operations: Section<TodayOperations> | null;
  chart: Section<{ sales: { rows: readonly SalesRow[] } }>;
  finance?: Section<readonly FinanceTile[]>;
};
