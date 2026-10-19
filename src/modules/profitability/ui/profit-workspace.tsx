'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import { formatBusinessDate, formatLitres } from '@/design-system/formatters';
import { Card, EmptyState, ErrorState, StatusBadge } from '@/design-system/primitives';
import { buildContextHref } from '@/modules/context/routes';
import type { ContextSelection } from '@/modules/context/contracts';
import type { ManagementReport } from '@/modules/reporting/contracts';
import {
  applyReportFilters,
  parseReportFilters,
  type ReportFilters,
} from '@/modules/reporting/filters';
import { ReportFilterBar } from '@/modules/reporting/ui/report-filter-bar';
import { useAvailableStations } from '@/modules/reporting/ui/use-available-stations';
import {
  buildProfitView,
  formatPerLitre,
  formatPercent,
  moneyOrUnavailable,
  type ProfitView,
} from './profit-model';

export type ProfitInitial = Readonly<{
  tenantId: string;
  current: ContextSelection | null;
  report: ManagementReport | null;
  /** Plain-language problem, when the figures could not be loaded. */
  error: string | null;
  /** True when a custom range was chosen but is incomplete or back to front. */
  badRange: boolean;
}>;

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'good' | 'bad' | 'missing';
}) {
  return (
    <div className="profit-tile" data-tone={tone}>
      <dt>{label}</dt>
      <dd>
        {value}
        {note ? <span className="profit-tile-note">{note}</span> : null}
      </dd>
    </div>
  );
}

function isNegative(value: string | null): boolean {
  return value !== null && value.trim().startsWith('-') && !/^-0(\.0+)?$/.test(value.trim());
}

function Figures({ view }: { view: ProfitView }) {
  const missing = view.state === 'cost-missing' || view.state === 'mismatch';
  const profitTone = view.profit === null ? 'missing' : isNegative(view.profit) ? 'bad' : 'good';
  return (
    <dl className="profit-tiles" aria-label="Money made in this period">
      <Tile
        label="Fuel sold"
        value={moneyOrUnavailable(view.sales)}
        note={view.sales === null ? 'No sales yet' : `${formatLitres(view.litres)} sold`}
      />
      <Tile
        label="Cost of the fuel"
        value={moneyOrUnavailable(view.fuelCost)}
        note={missing ? 'Cost missing' : undefined}
        tone={missing ? 'missing' : undefined}
      />
      <Tile
        label="Expenses"
        value={moneyOrUnavailable(view.expenses)}
        note="Running costs recorded"
      />
      <Tile
        label="Profit"
        value={moneyOrUnavailable(view.profit)}
        note={
          view.profit === null
            ? 'Needs the fuel cost'
            : isNegative(view.profit)
              ? 'A loss after expenses'
              : 'After fuel and expenses'
        }
        tone={profitTone}
      />
    </dl>
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
                {station.note ? <span className="profit-row-note">{station.note}</span> : null}
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

function FuelTable({ view }: { view: ProfitView }) {
  if (view.fuels.length === 0) return null;
  return (
    <Card as="section" className="panel profit-panel" aria-labelledby="profit-fuels-title">
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
            <th scope="col">Average price per litre</th>
            <th scope="col">Profit</th>
          </tr>
        </thead>
        <tbody>
          {view.fuels.map((fuel) => (
            <tr key={fuel.productId}>
              <th scope="row">{fuel.name}</th>
              <td data-label="Litres sold">{formatLitres(fuel.litres)}</td>
              <td data-label="Fuel sold">{moneyOrUnavailable(fuel.sales)}</td>
              <td data-label="Average price per litre">
                {fuel.pricePerLitre === null ? 'Not available' : `USD ${fuel.pricePerLitre}`}
              </td>
              <td data-label="Profit">Not available yet</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="profit-footnote">
        Fuel costs are recorded for each station, not for each type of fuel, so profit for each fuel
        is not available yet. Sales and litres above are real figures.
      </p>
    </Card>
  );
}

export function ProfitWorkspace({ initial }: { initial: ProfitInitial }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const filters = useMemo(() => parseReportFilters(search), [search]);
  const stations = useAvailableStations(initial.tenantId);
  const view = useMemo(
    () => (initial.report ? buildProfitView(initial.report) : null),
    [initial.report],
  );

  function change(next: ReportFilters) {
    const params = applyReportFilters(new URLSearchParams(search.toString()), next);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const link = (path: string) =>
    initial.current ? buildContextHref(path, '', initial.current) : path;
  const statementHref = `/reports/profit-loss?${applyReportFilters(
    new URLSearchParams({ tenantId: initial.tenantId }),
    filters,
  ).toString()}`;

  const report = initial.report;
  const period = report
    ? `${formatBusinessDate(report.filters.fromDate)} to ${formatBusinessDate(report.filters.toDate)}`
    : null;

  return (
    <div className="profit-workspace" aria-busy={pending}>
      <header className="profit-intro">
        <p>How much money the business made, and where it came from.</p>
        <ReportFilterBar stations={stations} filters={filters} onChange={change} />
      </header>

      {initial.badRange ? (
        <EmptyState
          title="Choose both dates"
          message="Pick a start date and an end date, with the start on or before the end."
        />
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
        <div className="profit-body" data-pending={pending || undefined}>
          <Card as="section" className="panel profit-panel" aria-labelledby="profit-summary-title">
            <h2 id="profit-summary-title" className="profit-title">
              {period}
            </h2>
            <p className="profit-headline">{view.headline}</p>
            {view.explanation ? (
              <p className="profit-explain" role="status">
                <StatusBadge tone="warning">
                  {view.state === 'no-sales' ? 'No sales' : 'Not worked out yet'}
                </StatusBadge>{' '}
                {view.explanation}
              </p>
            ) : null}
            {view.state !== 'no-sales' ? <Figures view={view} /> : null}
            {view.state === 'ready' ? (
              <p className="profit-footnote">
                Profit on fuel is {moneyOrUnavailable(view.grossProfit)} before expenses, about{' '}
                {formatPerLitre(view.perLitre)} ({formatPercent(view.marginPercent)} of sales).
              </p>
            ) : null}
          </Card>

          {view.state !== 'no-sales' ? <StationTable view={view} /> : null}
          {view.state !== 'no-sales' ? <FuelTable view={view} /> : null}

          <nav className="profit-links" aria-label="Related screens">
            <Link href={link('/expenses')}>See the expenses</Link>
            <Link href={link('/inventory/valuation')}>Check fuel costs in Inventory</Link>
            <Link href={statementHref}>Open the full income statement to share or export</Link>
            <button type="button" className="profit-print" onClick={() => window.print()}>
              Print this page
            </button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
