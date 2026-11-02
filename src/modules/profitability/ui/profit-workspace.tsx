'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { formatBusinessDate, formatLitres } from '@/design-system/formatters';
import { InfoTip } from '@/design-system/info-tip';
import {
  AccessDeniedState,
  Card,
  EmptyState,
  ErrorState,
  StatusBadge,
} from '@/design-system/primitives';
import { buildContextHref } from '@/modules/context/routes';
import type { ContextSelection } from '@/modules/context/contracts';
import type { ManagementReport } from '@/modules/reporting/contracts';
import { parseReportFilters } from '@/modules/reporting/filters';
import { REPORT_PERIOD_LABELS } from '@/modules/reporting/period';
import {
  buildProfitView,
  formatPerLitre,
  formatPercent,
  moneyOrUnavailable,
  type ProfitView,
} from './profit-model';
import { DailyProfitWorkspace } from '@/modules/owner/ui/daily-profit-workspace';
import { FinancialPositionWorkspace } from '@/modules/owner/ui/financial-position-workspace';
import { CashDonut } from '@/modules/cash/ui/cash-visuals';
import { profitStatementHref } from './profit-links';

export type ProfitInitial = Readonly<{
  tenantId: string;
  current: ContextSelection | null;
  report: ManagementReport | null;
  /** Plain-language problem, when the figures could not be loaded. */
  error: string | null;
  /** True when the error is a missing permission, so retrying cannot help. */
  restricted?: boolean;
  /** True when a custom range was chosen but is incomplete or back to front. */
  badRange: boolean;
}>;

function isNegative(value: string | null): boolean {
  return value !== null && value.trim().startsWith('-') && !/^-0(\.0+)?$/.test(value.trim());
}

function Row({
  label,
  value,
  note,
  tone,
  strong,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'bad' | 'missing';
  strong?: boolean;
}) {
  return (
    <div className="profit-row" data-tone={tone} data-strong={strong || undefined}>
      <dt>
        {label}
        {note ? <span className="profit-row-note">{note}</span> : null}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function num(value: string | null): number {
  const n = value === null ? 0 : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Where each dollar of sales went. Widths are for the picture only. */
function SalesSplit({ view }: { view: ProfitView }) {
  const sales = num(view.sales);
  const cost = num(view.fuelCost);
  const expenses = num(view.expenses);
  const profit = num(view.profit);
  const total = Math.max(sales, cost + expenses);
  if (view.state !== 'ready' || total === 0) return null;
  const parts = [
    { key: 'cost', label: 'Fuel cost', value: cost, amount: view.fuelCost, tone: 1 },
    { key: 'expenses', label: 'Expenses', value: expenses, amount: view.expenses, tone: 2 },
    { key: 'profit', label: 'Profit', value: profit, amount: view.profit, tone: 0 },
  ].filter((part) => part.value > 0);
  return (
    <div className="profit-split">
      <CashDonut
        slices={parts.map((part) => ({
          key: part.key,
          label: part.label,
          total: String(part.value),
          count: 0,
          detail: `${Math.round((part.value / total) * 100)}% of sales`,
          display: moneyOrUnavailable(part.amount),
          tone: part.tone,
        }))}
        currency="USD"
        centreLabel="Fuel sold"
        centreValue={moneyOrUnavailable(view.sales)}
        selectOpensDialog={false}
      />
    </div>
  );
}

function StationTable({ view }: { view: ProfitView }) {
  if (view.stations.length === 0) return null;
  return (
    <Card as="section" className="panel profit-panel" aria-labelledby="profit-stations-title">
      <h2 id="profit-stations-title" className="profit-title">
        Profit by station
      </h2>
      <table className="data-table profit-table">
        <caption className="visually-hidden">Profit by station</caption>
        <thead>
          <tr>
            <th scope="col">Station</th>
            <th scope="col">Fuel sold</th>
            <th scope="col">Cost of fuel</th>
            <th scope="col">Expenses</th>
            <th scope="col">Profit</th>
            <th scope="col">Profit per litre</th>
          </tr>
        </thead>
        <tbody>
          {view.stations.map((station) => (
            <tr key={station.stationId}>
              <th scope="row">
                {station.name}
                {station.note ? <InfoTip text={station.note} /> : null}
              </th>
              <td data-label="Fuel sold">{moneyOrUnavailable(station.sales)}</td>
              <td data-label="Cost of fuel">{moneyOrUnavailable(station.fuelCost)}</td>
              <td data-label="Expenses">{moneyOrUnavailable(station.expenses)}</td>
              <td data-label="Profit" data-negative={isNegative(station.profit) || undefined}>
                {moneyOrUnavailable(station.profit)}
              </td>
              <td data-label="Profit per litre">{formatPerLitre(station.perLitre)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function FuelTable({ view, links }: { view: ProfitView; links: ReactNode }) {
  if (view.fuels.length === 0) return null;
  return (
    <div className="profit-fuel-wrap">
      <Card
        as="section"
        className="panel profit-panel profit-fuel-card"
        aria-labelledby="profit-fuels-title"
      >
        <h2 id="profit-fuels-title" className="profit-title">
          Sales by fuel
        </h2>
        <table className="data-table profit-table">
          <caption className="visually-hidden">Sales by fuel</caption>
          <thead>
            <tr>
              <th scope="col">Fuel</th>
              <th scope="col">Litres sold</th>
              <th scope="col">Fuel sold</th>
              <th scope="col">Average price</th>
            </tr>
          </thead>
          <tbody>
            {view.fuels.map((fuel) => (
              <tr key={fuel.productId}>
                <th scope="row">{fuel.name}</th>
                <td data-label="Litres sold">{formatLitres(fuel.litres)}</td>
                <td data-label="Fuel sold">{moneyOrUnavailable(fuel.sales)}</td>
                <td data-label="Average price">
                  {fuel.pricePerLitre === null
                    ? 'Not available'
                    : formatPerLitre(fuel.pricePerLitre).replace(' per litre', '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {links}
    </div>
  );
}

type ProfitTab = 'month' | 'daily' | 'position';

const TAB_PARAM: Record<Exclude<ProfitTab, 'month'>, string> = {
  daily: 'daily',
  position: 'position',
};

export function ProfitWorkspace({ initial }: { initial: ProfitInitial }) {
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = useState<ProfitTab>(
    search.get('view') === 'daily'
      ? 'daily'
      : search.get('view') === 'position'
        ? 'position'
        : 'month',
  );

  function selectTab(next: ProfitTab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'month') url.searchParams.delete('view');
    else url.searchParams.set('view', TAB_PARAM[next]);
    window.history.replaceState(window.history.state, '', url);
  }

  const filters = useMemo(() => parseReportFilters(search), [search]);
  const view = useMemo(
    () => (initial.report ? buildProfitView(initial.report) : null),
    [initial.report],
  );

  const link = (path: string) =>
    initial.current ? buildContextHref(path, '', initial.current) : path;
  const statementHref = profitStatementHref(initial.tenantId, initial.current, filters);
  const links = (
    <nav className="profit-links" aria-label="Related screens">
      <Link className="button button-secondary" href={link('/inventory/valuation')}>
        Fuel costs
      </Link>
      <Link className="button button-secondary" href={statementHref}>
        Full statement
      </Link>
      <button type="button" className="button button-secondary" onClick={() => window.print()}>
        Print
      </button>
    </nav>
  );

  const report = initial.report;
  // A single day reads as one date, not "1 Nov to 1 Nov".
  const period = report
    ? report.filters.fromDate === report.filters.toDate
      ? formatBusinessDate(report.filters.fromDate)
      : `${formatBusinessDate(report.filters.fromDate)} to ${formatBusinessDate(report.filters.toDate)}`
    : null;
  // The first tab follows the chosen period, so it never says "This Month" over three months.
  const monthTabLabel = REPORT_PERIOD_LABELS[filters.period].replace(/\b\w/g, (c) =>
    c.toUpperCase(),
  );

  return (
    <div className="profit-workspace">
      <div className="profit-top">
        <p className="profit-period">
          {report ? <strong>{REPORT_PERIOD_LABELS[filters.period]}</strong> : null}
          {period ? <span>{period}</span> : null}
        </p>
        <div className="profit-tabs" role="tablist" aria-label="Profit views">
          {(
            [
              ['month', monthTabLabel],
              ['daily', 'Daily'],
              ['position', 'Financial Position'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              id={`profit-tab-${value}`}
              type="button"
              role="tab"
              aria-selected={tab === value}
              aria-controls="profit-tabpanel"
              onClick={() => selectTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'daily' ? (
        <div id="profit-tabpanel" role="tabpanel" aria-labelledby="profit-tab-daily">
          <DailyProfitWorkspace embedded initial={initial} links={links} />
        </div>
      ) : tab === 'position' ? (
        <div id="profit-tabpanel" role="tabpanel" aria-labelledby="profit-tab-position">
          <FinancialPositionWorkspace initial={initial} links={links} />
        </div>
      ) : initial.badRange ? (
        <EmptyState
          title="Choose both dates"
          message="Pick a start date and an end date, with the start on or before the end."
        />
      ) : initial.error && initial.restricted ? (
        <AccessDeniedState message={initial.error} />
      ) : initial.error ? (
        <ErrorState
          title="Profit could not be loaded"
          message={initial.error}
          action={
            <button
              type="button"
              className="button button-secondary"
              onClick={() => router.refresh()}
            >
              Try again
            </button>
          }
        />
      ) : view && report ? (
        <div className="profit-body">
          {view.state === 'no-sales' ? (
            <Card
              as="section"
              className="panel profit-panel"
              aria-labelledby="profit-summary-title"
            >
              <div className="panel-heading">
                <h2 id="profit-summary-title">Profit</h2>
                <StatusBadge tone="warning">No sales</StatusBadge>
              </div>
              <EmptyState
                layout="block"
                title="No fuel sales yet"
                message={view.explanation ?? view.headline}
                icon="chart"
              />
            </Card>
          ) : (
            <div className="profit-overview">
              <Card
                as="section"
                className="panel profit-panel"
                aria-labelledby="profit-summary-title"
              >
                <div className="panel-heading">
                  <span className="heading-with-tip">
                    <h2 id="profit-summary-title">Profit</h2>
                    <InfoTip text={[view.headline, view.explanation].filter(Boolean).join(' ')} />
                  </span>
                  {view.profit !== null ? (
                    <StatusBadge tone={isNegative(view.profit) ? 'critical' : 'positive'}>
                      {isNegative(view.profit) ? 'Loss' : 'Profit'}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Not worked out yet</StatusBadge>
                  )}
                </div>
                <p
                  className="profit-hero"
                  data-tone={
                    view.profit === null ? 'missing' : isNegative(view.profit) ? 'bad' : 'good'
                  }
                >
                  {moneyOrUnavailable(view.profit)}
                </p>
                <SalesSplit view={view} />
              </Card>
              <FuelTable view={view} links={links} />
            </div>
          )}

          {view.state !== 'no-sales' ? <StationTable view={view} /> : null}
          {view.state !== 'no-sales' && view.fuels.length > 0 ? null : links}
        </div>
      ) : null}
    </div>
  );
}
