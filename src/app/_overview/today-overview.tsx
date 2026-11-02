'use client';
import { useContextFetch } from '@/modules/context/client-context';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

import { formatBusinessDate } from '@/design-system/formatters';
import { Icon, type IconName } from '@/design-system/icons';
import { InfoTip } from '@/design-system/info-tip';
import { Button, ErrorState, Skeleton, StatusBadge } from '@/design-system/primitives';
import { MetricCard } from '@/design-system/layout';
import { TableScrollRegion } from '@/design-system/table';
import { Pagination, usePagination } from '@/design-system/pagination';
import { NextStepCard } from '@/modules/forecourt/ui/next-step-card';

import { businessToday } from '@/modules/reporting/period';
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
  signedLitres,
  signedMoney,
  varianceTone,
  type ChartRange,
  type DailyRow,
  type LitresPoint,
  type SalesRow,
} from './dashboard-figures';
import { FinanceTiles } from '@/modules/owner/ui/finance-tiles';
import type { FinanceTile } from '@/modules/reporting/finance-tiles';
import type { DashboardSnapshot } from '@/modules/reporting/dashboard-snapshot';

import {
  asAtLabel,
  resolveDashboardPeriod,
  type ResolvedDashboardPeriod,
} from './dashboard-period';
import { PerformanceChart } from './performance-chart';
import { useOpenedRows } from './use-opened-rows';

/** Rows the card always has room for, filled or blank. */
const ATTENTION_ROWS = 6;
import {
  approvalLabel,
  CLOSE_STATUS_PRESENTATION,
  countSuspendedCustomers,
  shiftSummary,
  type AttentionRow,
  type TodayOperations,
} from './today-overview-model';

export type Scope = { tenantId?: string; legalEntityId?: string; stationId?: string };

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
        (
          body: {
            data?: {
              current?: { organisationId?: string; legalEntityId?: string; stationId?: string };
            };
          } | null,
        ) => {
          const current = body?.data?.current;
          if (current?.organisationId) {
            setScope({
              tenantId: current.organisationId,
              legalEntityId: current.legalEntityId,
              stationId: current.stationId,
            });
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
  workItems = [],
  workMore = 0,
  workUnavailable = false,
}: Scope & {
  initialContext?: Scope;
  initialData?: DashboardInitialData;
  /** Approvals and payables waiting for a person, loaded with the page. */
  workItems?: readonly AttentionRow[];
  /** How many more waiting items there are than the list shows. */
  workMore?: number;
  workUnavailable?: boolean;
}) {
  const fallback = useCurrentContext(!urlTenantId && !initialContext?.tenantId);
  const resolvedContext = initialContext ?? fallback;
  const tenantId = urlTenantId ?? resolvedContext?.tenantId;
  const legalEntityId = resolvedContext?.legalEntityId;
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
  const [snapshot, setSnapshot] = useState<Section<DashboardSnapshot>>(
    initialData?.snapshot ?? { status: 'loading' },
  );
  const [finance, setFinance] = useState<Section<readonly FinanceTile[]>>(
    initialData?.finance ?? { status: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);
  const { isUnread, markOpened } = useOpenedRows();

  // One period for every period figure; the server read the records for exactly this window.
  const period = useMemo(
    () => initialData?.period ?? resolveDashboardPeriod({}, businessToday()),
    [initialData],
  );
  const [asAt] = useState(() =>
    asAtLabel(initialData?.asOf ? new Date(initialData.asOf) : new Date()),
  );

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const [range, setRange] = useState<ChartRange>('30D');
  const [asTable, setAsTable] = useState(false);
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
    const chartWindow = chartBuckets('30D', businessToday());
    const params = new URLSearchParams({
      tenantId,
      fromDate: period.fromDate,
      toDate: period.toDate,
      chartFromDate: chartWindow.fromDate,
      chartToDate: chartWindow.toDate,
    });
    if (stationId) params.set('stationId', stationId);
    load<{
      daily: Section<DailyReport>;
      customers: Section<{ customers: readonly { status: string }[] }>;
      operations: Section<TodayOperations> | null;
      chart: Section<{ sales: { rows: readonly SalesRow[] } }>;
      finance?: Section<readonly FinanceTile[]>;
      snapshot?: Section<DashboardSnapshot>;
    }>(`/api/dashboard?${params}`, controller.signal, 'Sales could not be loaded.').then(
      (section) => {
        if (section.status === 'ready') {
          setDaily(section.data.daily);
          setCustomers(section.data.customers);
          if (section.data.operations) setOperations(section.data.operations);
          setFinance(section.data.finance ?? { status: 'forbidden' });
          setSnapshot(section.data.snapshot ?? { status: 'forbidden' });
          setChart({ ...section.data.chart, key: `${tenantId}|${stationId ?? ''}|30D` });
        } else {
          setDaily(section);
          setCustomers(section);
          setOperations(section);
          setFinance(section);
          setSnapshot(section);
          setChart({ ...section, key: `${tenantId}|${stationId ?? ''}|30D` });
        }
      },
      () => {},
    );
    return () => {
      window.clearTimeout(reset);
      controller.abort();
    };
  }, [tenantId, stationId, attempt, initialData, period]);

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
        ? `/customers?${new URLSearchParams({
            tenantId,
            ...(legalEntityId ? { legalEntityId } : {}),
            ...(stationId ? { stationId } : { allStations: 'true' }),
          })}`
        : '/customers',
    [tenantId, legalEntityId, stationId],
  );
  const reportsHref = useMemo(() => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (legalEntityId) params.set('legalEntityId', legalEntityId);
    if (stationId) params.set('stationId', stationId);
    else params.set('allStations', 'true');
    return `/reports?${params}`;
  }, [tenantId, legalEntityId, stationId]);

  const dailyHref = useMemo(() => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (legalEntityId) params.set('legalEntityId', legalEntityId);
    if (stationId) params.set('stationId', stationId);
    else params.set('allStations', 'true');
    return `/operations/daily?${params}`;
  }, [tenantId, legalEntityId, stationId]);

  const inventoryHref = useMemo(() => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (legalEntityId) params.set('legalEntityId', legalEntityId);
    if (stationId) params.set('stationId', stationId);
    else params.set('allStations', 'true');
    return `/inventory?${params}`;
  }, [tenantId, legalEntityId, stationId]);

  const contextualFinanceTiles = useMemo(
    () =>
      finance.status === 'ready'
        ? finance.data.map((tile) => ({
            ...tile,
            href: (() => {
              const params = new URLSearchParams();
              if (tenantId) params.set('tenantId', tenantId);
              if (legalEntityId) params.set('legalEntityId', legalEntityId);
              if (stationId) params.set('stationId', stationId);
              else params.set('allStations', 'true');
              return `${tile.href}?${params}`;
            })(),
          }))
        : [],
    [finance, tenantId, legalEntityId, stationId],
  );

  // Stock value shares one card with stock variance, so it leaves the money tiles.
  const stockTile = contextualFinanceTiles.find((tile) => tile.id === 'stockValue');
  const profitTile = contextualFinanceTiles.find((tile) => tile.id === 'profit');
  const otherFinanceTiles = contextualFinanceTiles.filter(
    (tile) => tile.id !== 'stockValue' && tile.id !== 'profit',
  );

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
  attention.push(...workItems);
  const attentionLoading =
    (Boolean(stationId) && operations.status === 'loading') || customers.status === 'loading';

  const totals = daily.status === 'ready' ? dailyTotals(daily.data.rows) : null;
  const profitValue =
    profitTile && profitTile.value !== null ? formatTileMoney(profitTile.value) : null;
  const profitLoading = finance.status === 'loading';
  const figureValues: (string | null)[] = totals
    ? [
        formatTileMoney(totals.salesValue),
        formatTileLitres(totals.litresSold),
        // The third card is profit for people who may see it; account sales for everyone else.
        profitTile
          ? profitTile.value === null
            ? null
            : formatTileMoney(profitTile.value)
          : formatTileMoney(totals.accountSales),
      ]
    : [null, null, null];
  const figureState: FigureState =
    daily.status === 'ready' ? (totals ? 'ready' : 'none') : daily.status;

  const chartReady = chart.status === 'ready' && chart.key === chartKey ? chart : null;
  const salesRows = chartReady ? chartReady.data.sales.rows : [];
  const points = litresSeries(salesRows, rangeWindow.buckets);
  const chartShown = chartReady !== null;
  const series = chartReady
    ? points.map((point) => ({
        label: point.label,
        value: plotValue(point.litres),
        detail: point.products
          .map((product) => `${product.name} ${formatTileLitres(product.litres)}`)
          .join(' · '),
      }))
    : null;

  return (
    <>
      <div className="today today-dashboard">
        <section
          className="today-section today-figures-section"
          aria-labelledby="today-figures-heading"
        >
          <h2 id="today-figures-heading">Key figures</h2>
          <dl
            className="today-figures"
            // One size for all the cards, from the longest figure shown.
            style={
              {
                '--figure-chars': Math.max(
                  ...figureValues.map((value) => (value === null ? 6 : figureChars(value))),
                ),
              } as CSSProperties
            }
          >
            <Figure
              label={`Sales ${period.phrase}`}
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
            />
            {profitTile || profitLoading ? (
              <Figure
                label={`Profit ${period.phrase}`}
                href={profitTile?.href ?? reportsHref}
                icon="chart"
                state={profitLoading ? 'loading' : profitValue !== null ? 'ready' : 'none'}
                value={profitValue}
                emptyCaption="Not available"
                info={
                  profitTile?.value === null ? profitTile.unavailableReason : profitTile?.detail
                }
                tone={profitTile && isLoss(profitTile.value) ? 'short' : undefined}
              />
            ) : (
              <Figure
                label="Account sales"
                href={customersHref}
                icon="users"
                state={figureState}
                value={figureValues[2] ?? null}
              />
            )}
          </dl>
          {/* One row of white cards. The money ones show only for people allowed to see them. */}
          {snapshot.status === 'ready' || finance.status === 'ready' ? (
            <section
              className="metric-grid today-money"
              aria-label="Cash, stock, reports and what is owed"
              style={{ marginBlockStart: 'var(--space-6)' }}
            >
              {snapshot.status === 'ready' ? (
                <SnapshotTiles
                  snapshot={snapshot.data}
                  stock={stockTile}
                  daysWithoutReport={
                    daily.status === 'ready' ? (daily.data.missingReportDays ?? null) : null
                  }
                  reportsHref={reportsHref}
                  dailyHref={dailyHref}
                  inventoryHref={inventoryHref}
                  periodPhrase={period.phrase}
                  asAt={asAt}
                />
              ) : null}
              {finance.status === 'ready' ? (
                <FinanceTiles
                  bare
                  tiles={otherFinanceTiles}
                  periodPhrase={period.phrase}
                  asAt={asAt}
                />
              ) : null}
            </section>
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
              <>
                <OperationsRow operations={operations.data} href={dailyHref} />
                <NextStepCard
                  embedded
                  tenantId={tenantId}
                  stationId={stationId}
                  onChanged={retry}
                />
              </>
            )}
          </section>

          <section className="today-section" aria-labelledby="today-attention-heading">
            <h2 id="today-attention-heading">Needs attention</h2>
            {attentionLoading && attention.length === 0 ? (
              <Skeleton lines={2} label="Checking for items that need attention" />
            ) : (
              <ul className="today-list">
                {attention.map((row) => (
                  <li key={row.id}>
                    <Link
                      className="today-row"
                      href={row.href}
                      data-unread={isUnread(row) || undefined}
                      onClick={() => markOpened(row, attention)}
                    >
                      <span className="today-row-text">
                        <span className="today-row-title">
                          {isUnread(row) ? (
                            <span className="visually-hidden">Not opened. </span>
                          ) : null}
                          {row.title}
                        </span>
                      </span>
                      <Icon name="chevron-right" className="today-row-chevron" />
                    </Link>
                  </li>
                ))}
                {workMore > 0 ? (
                  <li className="today-note">
                    <Link href="/finance">
                      {workMore === 1
                        ? '1 more item is waiting.'
                        : `${workMore} more items are waiting.`}
                    </Link>
                  </li>
                ) : null}
                {/* Blank rows keep the card the same height however little needs attention. */}
                {Array.from({ length: Math.max(0, ATTENTION_ROWS - attention.length) }, (_, i) => (
                  <li
                    key={`blank-${i}`}
                    className="today-row-blank"
                    aria-hidden={attention.length > 0 || i > 0}
                  >
                    {attention.length === 0 && i === 0 ? 'Nothing needs attention.' : null}
                  </li>
                ))}
              </ul>
            )}
            {customers.status === 'forbidden' ? (
              <p className="today-note">
                Customer alerts are hidden because you don’t have access.
              </p>
            ) : null}
            {operations.status === 'error' || customers.status === 'error' || workUnavailable ? (
              <p className="today-note">Some items could not be checked.</p>
            ) : null}
          </section>
        </div>

        <section className="today-section today-stats" aria-labelledby="today-stats-heading">
          <div className="today-stats-head">
            <h2 id="today-stats-heading">
              Sales performance <span className="today-stats-sub">Litres</span>
            </h2>
            <div className="today-periods" role="group" aria-label="Chart range">
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
              {asTable ? (
                <ChartTableView points={points} range={range} />
              ) : (
                <PerformanceChart
                  series={series}
                  xLabels={axisLabels(points.map((point) => point.label))}
                  formatValue={(value) => formatTileLitres(String(Math.round(value)))}
                  label={`Litres sold, ${range}, approved days only`}
                  emptyMessage="No approved sales in this period yet."
                  gapMessage="No approved report"
                />
              )}
            </>
          )}
          <div className="today-stats-foot">
            {chartShown ? (
              <button
                type="button"
                className="button button-secondary today-chart-toggle"
                aria-pressed={asTable}
                onClick={() => setAsTable((value) => !value)}
              >
                {asTable ? 'Show the chart' : 'Show the chart as a table'}
              </button>
            ) : null}
            <Link href={reportsHref}>Open reports</Link>
          </div>
        </section>
      </div>
    </>
  );
}

type DailyReport = {
  filters?: { fromDate?: string };
  missingReportDays?: readonly { stationId: string; businessDate: string }[];
  rows: readonly DailyRow[];
};

type FigureState = 'loading' | 'ready' | 'forbidden' | 'error' | 'none';

const isLoss = (value: string | null) => value !== null && /^-(?!0(\.0+)?$)/.test(value.trim());

const FIGURE_CAPTION: Partial<Record<FigureState, string>> = {
  forbidden: 'No access',
  error: 'Unavailable',
  none: 'No approved report yet',
};

/** Shows a leading currency code ("USD 5,961.45") smaller than the amount so the figure fits one row. */
function renderFigureValue(value: string) {
  const match = /^([A-Z]{3})\s+(\S.*)$/.exec(value);
  if (!match) return value;
  return (
    <>
      <span className="today-figure-currency">{match[1]}</span> {match[2]}
    </>
  );
}

function Figure({
  label,
  href,
  icon,
  state,
  value,
  sub = null,
  tone,
  info,
  emptyCaption,
}: {
  label: string;
  href: string;
  icon: IconName;
  state: FigureState;
  value: string | null;
  sub?: string | null;
  tone?: 'none' | 'over' | 'short';
  /** An explanation kept behind a "?" beside the label. */
  info?: string;
  /** What to say when there is no figure, in place of the usual caption for the state. */
  emptyCaption?: string;
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
        {info ? <InfoTip text={info} label={`About ${label}`} /> : null}
      </dt>
      <dd>
        {state === 'loading' ? (
          <Skeleton lines={1} label={`Loading ${label.toLowerCase()}`} />
        ) : value !== null ? (
          <>
            <span className="today-figure-value">{renderFigureValue(value)}</span>
            {sub ? <span className="today-figure-caption">{sub}</span> : null}
          </>
        ) : (
          <>
            <span className="today-figure-value" aria-hidden="true">
              —
            </span>
            <span className="today-figure-caption">{emptyCaption ?? FIGURE_CAPTION[state]}</span>
          </>
        )}
      </dd>
    </div>
  );
}

function SnapshotTiles({
  snapshot,
  stock,
  daysWithoutReport,
  reportsHref,
  dailyHref,
  inventoryHref,
  periodPhrase,
  asAt,
}: {
  snapshot: DashboardSnapshot;
  /** Fuel stock at cost, when the person may see money figures. */
  stock?: FinanceTile;
  daysWithoutReport: readonly { stationId: string; businessDate: string }[] | null;
  reportsHref: string;
  dailyHref: string;
  inventoryHref: string;
  /** The chosen period in words, for the tiles that are totals over it. */
  periodPhrase: string;
  /** "As at 14:05", for the tiles that are a position right now. */
  asAt: string;
}) {
  const { cash, stockVariance } = snapshot;
  return (
    <>
      <MetricCard
        label="Expected cash"
        value={formatTileMoney(cash.expected)}
        meta={
          varianceTone(cash.difference) === 'none'
            ? 'Matches'
            : `${signedMoney(cash.difference)} difference`
        }
        info={`Cash expected ${periodPhrase}: ${formatTileMoney(cash.expected)}. Collected so far: ${formatTileMoney(cash.collected)}.`}
        tone={varianceTone(cash.difference) === 'short' ? 'critical' : 'default'}
        href={reportsHref}
      />
      <MetricCard
        label={stock ? 'Fuel stock' : 'Stock variance'}
        value={
          stock
            ? stock.value === null
              ? 'Not available'
              : formatTileMoney(stock.value)
            : stockVariance.litres === null
              ? 'Not available'
              : signedLitres(stockVariance.litres)
        }
        meta={asAt}
        info={[
          stock?.value === null ? stock.unavailableReason : undefined,
          stockVariance.litres === null
            ? 'No tank has a dip reading for the last day yet.'
            : `Stock variance ${signedLitres(stockVariance.litres)}, from ${stockVariance.tanksMeasured} of ${stockVariance.tanksTotal} tanks measured.`,
        ]
          .filter(Boolean)
          .join(' ')}
        href={inventoryHref}
      />
      <MetricCard
        label="Missing reports"
        value={daysWithoutReport === null ? 'Not available' : String(daysWithoutReport.length)}
        meta={
          daysWithoutReport === null
            ? undefined
            : daysWithoutReport.length === 0
              ? asAt
              : `Oldest: ${formatBusinessDate(daysWithoutReport.map((day) => day.businessDate).sort()[0]!)}`
        }
        info={
          daysWithoutReport?.length === 0
            ? 'Every day has a report.'
            : 'Days that have no submitted report.'
        }
        tone={daysWithoutReport?.length ? 'critical' : 'default'}
        href={dailyHref}
      />
    </>
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
        {formatBusinessDate(operations.selectedBusinessDay?.date ?? operations.currentBusinessDate)}{' '}
        · {shiftSummary(operations.shifts)}
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
  const page = usePagination(table.rows, { resetKey: range });
  return (
    <div className="today-chart-table">
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
            {page.rows.map((row) => (
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
      <Pagination slice={page} label="Sales table pages" noun="periods" />
    </div>
  );
}

export type DashboardInitialData = {
  key: string;
  /** The period the figures were read for, and when they were read. */
  period: ResolvedDashboardPeriod;
  asOf: string;
  daily: Section<DailyReport>;
  customers: Section<{ customers: readonly { status: string }[] }>;
  operations: Section<TodayOperations> | null;
  chart: Section<{ sales: { rows: readonly SalesRow[] } }>;
  finance?: Section<readonly FinanceTile[]>;
  snapshot?: Section<DashboardSnapshot>;
};
