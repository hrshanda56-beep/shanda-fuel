'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { formatBusinessDate, formatLitres } from '@/design-system/formatters';
import { Button, Card, EmptyState, ErrorState, StatusBadge } from '@/design-system/primitives';
import { buildContextHref } from '@/modules/context/routes';
import type { ContextSelection } from '@/modules/context/contracts';
import type { ManagementReport } from '@/modules/reporting/contracts';
import {
  applyReportFilters,
  parseReportFilters,
  type ReportFilters,
} from '@/modules/reporting/filters';
import { REPORT_PERIOD_LABELS } from '@/modules/reporting/period';
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
    { key: 'cost', label: 'Fuel cost', value: cost, amount: view.fuelCost },
    { key: 'expenses', label: 'Expenses', value: expenses, amount: view.expenses },
    { key: 'profit', label: 'Profit', value: profit, amount: view.profit },
  ].filter((part) => part.value > 0);
  return (
    <div className="profit-split">
      <div className="profit-split-bar" aria-hidden="true">
        {parts.map((part) => (
          <span
            key={part.key}
            data-part={part.key}
            style={{ width: `${(part.value / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="profit-split-legend">
        {parts.map((part) => (
          <li key={part.key} data-part={part.key}>
            <span>{part.label}</span>
            <strong>{moneyOrUnavailable(part.amount)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddsUp({ view }: { view: ProfitView }) {
  const missing = view.state === 'cost-missing' || view.state === 'mismatch';
  return (
    <dl className="profit-rows" aria-label="How the profit adds up">
      <Row
        label="Fuel sold"
        value={moneyOrUnavailable(view.sales)}
        note={view.sales === null ? undefined : formatLitres(view.litres)}
      />
      <Row
        label="Cost of the fuel"
        value={moneyOrUnavailable(view.fuelCost)}
        note={missing ? 'Cost missing' : undefined}
        tone={missing ? 'missing' : undefined}
      />
      <Row
        label="Profit before expenses"
        value={moneyOrUnavailable(view.grossProfit)}
        note={
          view.state === 'ready'
            ? `${formatPerLitre(view.perLitre)} · ${formatPercent(view.marginPercent)} of sales`
            : undefined
        }
      />
      <Row label="Expenses" value={moneyOrUnavailable(view.expenses)} />
      <Row
        label="Profit"
        value={moneyOrUnavailable(view.profit)}
        tone={isNegative(view.profit) ? 'bad' : undefined}
        strong
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
      <p className="profit-footnote">
        Fuel cost is kept per station, so profit by fuel is not shown.
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState<ReportFilters>(filters);
  const filtersRef = useRef<HTMLDivElement>(null);
  const view = useMemo(
    () => (initial.report ? buildProfitView(initial.report) : null),
    [initial.report],
  );

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [filtersOpen]);

  const activeFilters =
    (filters.stationIds.length > 0 ? 1 : 0) + (filters.period !== 'this-month' ? 1 : 0);

  function toggleFilters() {
    if (!filtersOpen) setDraft(filters);
    setFiltersOpen((open) => !open);
  }

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
      <div className="profit-top">
        <p className="profit-period">
          {report ? <strong>{REPORT_PERIOD_LABELS[filters.period]}</strong> : null}
          {period ? <span>{period}</span> : null}
        </p>
        <div className="profit-filter-menu" ref={filtersRef}>
          <Button
            variant="secondary"
            aria-expanded={filtersOpen}
            aria-controls="profit-filter-panel"
            onClick={toggleFilters}
          >
            Filters{activeFilters > 0 ? ` · ${activeFilters}` : ''}
          </Button>
          {filtersOpen ? (
            <div className="profit-filter-panel" id="profit-filter-panel">
              <ReportFilterBar stations={stations} filters={draft} onChange={setDraft} />
              <div className="profit-filter-actions">
                <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setFiltersOpen(false);
                    change(draft);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

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
          <div className="profit-overview">
            <Card
              as="section"
              className="panel profit-panel"
              aria-labelledby="profit-summary-title"
            >
              <div className="panel-heading">
                <h2 id="profit-summary-title">Profit</h2>
                {view.profit !== null ? (
                  <StatusBadge tone={isNegative(view.profit) ? 'critical' : 'positive'}>
                    {isNegative(view.profit) ? 'Loss' : 'Profit'}
                  </StatusBadge>
                ) : null}
              </div>
              <p
                className="profit-hero"
                data-tone={
                  view.profit === null ? 'missing' : isNegative(view.profit) ? 'bad' : 'good'
                }
              >
                {moneyOrUnavailable(view.profit)}
              </p>
              <p className="profit-headline">{view.headline}</p>
              <SalesSplit view={view} />
              {view.explanation ? (
                <p className="profit-explain" role="status">
                  <StatusBadge tone="warning">
                    {view.state === 'no-sales' ? 'No sales' : 'Not worked out yet'}
                  </StatusBadge>{' '}
                  {view.explanation}
                </p>
              ) : null}
            </Card>
            {view.state !== 'no-sales' ? (
              <Card as="section" className="panel profit-panel" aria-labelledby="profit-adds-title">
                <div className="panel-heading">
                  <h2 id="profit-adds-title">How it adds up</h2>
                </div>
                <AddsUp view={view} />
              </Card>
            ) : null}
          </div>

          {view.state !== 'no-sales' ? <StationTable view={view} /> : null}
          {view.state !== 'no-sales' ? <FuelTable view={view} /> : null}

          <nav className="profit-links" aria-label="Related screens">
            <Link className="button button-secondary" href={link('/expenses')}>
              Expenses
            </Link>
            <Link className="button button-secondary" href={link('/inventory/valuation')}>
              Fuel costs
            </Link>
            <Link className="button button-secondary" href={statementHref}>
              Full statement
            </Link>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => window.print()}
            >
              Print
            </button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
