'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { formatBusinessDate, formatLitres } from '@/design-system/formatters';
import { Card, EmptyState, ErrorState, StatusBadge } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { profitSign } from '@/modules/profitability/daily-profit';
import { formatPerLitre, moneyOrUnavailable } from '@/modules/profitability/ui/profit-model';
import type { ManagementReport } from '@/modules/reporting/contracts';
import { dailyProfitFromReport } from '@/modules/reporting/daily-profit';
import { OwnerPeriodBar } from './owner-period-bar';

export type DailyProfitInitial = Readonly<{
  tenantId: string;
  report: ManagementReport | null;
  error: string | null;
  badRange: boolean;
}>;

const tone = (value: string | null) =>
  value === null ? 'missing' : profitSign(value) === 'LOSS' ? 'bad' : undefined;

function FlagBadge({ value, loss, gain }: { value: string | null; loss: string; gain: string }) {
  const sign = profitSign(value);
  if (sign === 'UNKNOWN') return <StatusBadge tone="warning">Not worked out yet</StatusBadge>;
  if (sign === 'LOSS') return <StatusBadge tone="critical">{loss}</StatusBadge>;
  if (sign === 'BREAK_EVEN') return <StatusBadge tone="informational">Break even</StatusBadge>;
  return <StatusBadge tone="positive">{gain}</StatusBadge>;
}

export function DailyProfitWorkspace({ initial }: { initial: DailyProfitInitial }) {
  const router = useRouter();
  const report = initial.report;
  const summary = useMemo(() => (report ? dailyProfitFromReport(report) : null), [report]);
  const hasActivity = summary !== null && summary.days.length > 0;
  const range = report
    ? { fromDate: report.filters.fromDate, toDate: report.filters.toDate }
    : null;
  const missingCost = summary?.fuels.some((fuel) => fuel.grossProfit === null) ?? false;

  return (
    <div className="profit-workspace">
      <OwnerPeriodBar tenantId={initial.tenantId} range={range}>
        {({ pending }) =>
          initial.badRange ? (
            <EmptyState
              title="Choose both dates"
              message="Pick a start date and an end date, with the start on or before the end."
            />
          ) : initial.error ? (
            <ErrorState
              title="Daily profit could not be loaded"
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
          ) : !summary || !report ? null : !hasActivity ? (
            <EmptyState
              title="No sales or costs in these dates"
              message="Nothing was sold and no costs were recorded in this period. Try other dates."
            />
          ) : (
            <div className="profit-body" data-pending={pending || undefined}>
              <div className="profit-overview">
                <Card
                  as="section"
                  className="panel profit-panel"
                  aria-labelledby="dp-summary-title"
                >
                  <div className="panel-heading">
                    <h2 id="dp-summary-title">Operating profit</h2>
                    <FlagBadge
                      value={summary.operatingProfitAfterBenefit}
                      loss="Loss"
                      gain="Profit"
                    />
                  </div>
                  <p
                    className="profit-hero"
                    data-tone={tone(summary.operatingProfitAfterBenefit) ?? 'good'}
                  >
                    {moneyOrUnavailable(summary.operatingProfitAfterBenefit)}
                  </p>
                  <p className="profit-headline">
                    What is left after the fuel cost, the day-to-day expenses and each day&rsquo;s
                    share of the fixed costs.
                  </p>
                  {missingCost ? (
                    <p className="profit-explain" role="status">
                      <StatusBadge tone="warning">Not worked out yet</StatusBadge> Some sales have
                      no fuel cost yet, so profit is not shown for them.
                    </p>
                  ) : null}
                </Card>
                <Card as="section" className="panel profit-panel" aria-labelledby="dp-adds-title">
                  <div className="panel-heading">
                    <h2 id="dp-adds-title">How it adds up</h2>
                  </div>
                  <dl className="profit-rows" aria-label="How the operating profit adds up">
                    <Line
                      label="Fuel sold"
                      value={summary.combined.sales}
                      note={formatLitres(summary.combined.litres)}
                    />
                    <Line label="Cost of the fuel" value={summary.combined.costOfFuelSold} />
                    <Line
                      label="Profit before expenses"
                      value={summary.combined.grossProfit}
                      note={formatPerLitre(summary.combined.grossProfitPerLitre)}
                    />
                    <Line label="Expenses" value={summary.combined.expenses} />
                    <Line label="Fixed costs, by the day" value={summary.combined.fixedCosts} />
                    {exactPositive(summary.fuelBenefit) ? (
                      <Line label="Fuel given to staff" value={summary.fuelBenefit} />
                    ) : null}
                    <Line
                      label="Operating profit"
                      value={summary.operatingProfitAfterBenefit}
                      strong
                    />
                  </dl>
                </Card>
              </div>

              <Card as="section" className="panel profit-panel" aria-labelledby="dp-fuels-title">
                <h2 id="dp-fuels-title" className="profit-title">
                  Profit by fuel
                </h2>
                <TableScrollRegion label="Profit by fuel">
                  <table className="data-table profit-table">
                    <caption className="visually-hidden">Profit by fuel</caption>
                    <thead>
                      <tr>
                        <th scope="col">Fuel</th>
                        <th scope="col">Litres sold</th>
                        <th scope="col">Fuel sold</th>
                        <th scope="col">Cost of fuel</th>
                        <th scope="col">Profit before expenses</th>
                        <th scope="col">Profit per litre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.fuels.map((fuel) => (
                        <tr key={fuel.productId}>
                          <th scope="row">{fuel.productName}</th>
                          <td data-label="Litres sold">{formatLitres(fuel.litres)}</td>
                          <td data-label="Fuel sold">{moneyOrUnavailable(fuel.sales)}</td>
                          <td data-label="Cost of fuel">
                            {moneyOrUnavailable(fuel.costOfFuelSold)}
                          </td>
                          <td
                            data-label="Profit before expenses"
                            data-negative={profitSign(fuel.grossProfit) === 'LOSS' || undefined}
                          >
                            {moneyOrUnavailable(fuel.grossProfit)}
                          </td>
                          <td data-label="Profit per litre">
                            {formatPerLitre(fuel.grossProfitPerLitre)}
                          </td>
                        </tr>
                      ))}
                      {summary.fuels.length > 1 ? (
                        <tr>
                          <th scope="row">Both fuels</th>
                          <td data-label="Litres sold">{formatLitres(summary.combined.litres)}</td>
                          <td data-label="Fuel sold">
                            {moneyOrUnavailable(summary.combined.sales)}
                          </td>
                          <td data-label="Cost of fuel">
                            {moneyOrUnavailable(summary.combined.costOfFuelSold)}
                          </td>
                          <td data-label="Profit before expenses">
                            {moneyOrUnavailable(summary.combined.grossProfit)}
                          </td>
                          <td data-label="Profit per litre">
                            {formatPerLitre(summary.combined.grossProfitPerLitre)}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </TableScrollRegion>
              </Card>

              <Card as="section" className="panel profit-panel" aria-labelledby="dp-days-title">
                <h2 id="dp-days-title" className="profit-title">
                  Day by day
                </h2>
                <TableScrollRegion label="Operating profit day by day">
                  <table className="data-table profit-table">
                    <caption className="visually-hidden">Operating profit day by day</caption>
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        <th scope="col">Fuel sold</th>
                        <th scope="col">Cost of fuel</th>
                        <th scope="col">Profit before expenses</th>
                        <th scope="col">Expenses</th>
                        <th scope="col">Fixed costs</th>
                        <th scope="col">Operating profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.days.map((day) => (
                        <tr key={day.date}>
                          <th scope="row">
                            {formatBusinessDate(day.date)}
                            <span className="profit-row-note">
                              {day.fuels
                                .map((f) => `${f.productName} ${moneyOrUnavailable(f.grossProfit)}`)
                                .join(' · ') || 'No sales'}
                            </span>
                          </th>
                          <td data-label="Fuel sold">{moneyOrUnavailable(day.combined.sales)}</td>
                          <td data-label="Cost of fuel">
                            {moneyOrUnavailable(day.combined.costOfFuelSold)}
                          </td>
                          <td data-label="Profit before expenses">
                            {moneyOrUnavailable(day.combined.grossProfit)}
                          </td>
                          <td data-label="Expenses">{moneyOrUnavailable(day.combined.expenses)}</td>
                          <td data-label="Fixed costs">
                            {moneyOrUnavailable(day.combined.fixedCosts)}
                          </td>
                          <td
                            data-label="Operating profit"
                            data-negative={
                              profitSign(day.combined.operatingProfit) === 'LOSS' || undefined
                            }
                          >
                            {moneyOrUnavailable(day.combined.operatingProfit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollRegion>
                <p className="profit-footnote">
                  Fixed costs such as rent are spread evenly over the days of their month. Fuel
                  given to staff is taken off the period total only, not off each day.
                </p>
              </Card>

              <nav className="profit-links" aria-label="Related screens">
                <Link className="button button-secondary" href="/financial-position">
                  Financial position
                </Link>
                <Link className="button button-secondary" href="/profitability">
                  Profit
                </Link>
                <Link className="button button-secondary" href="/expenses">
                  Expenses
                </Link>
              </nav>
            </div>
          )
        }
      </OwnerPeriodBar>
    </div>
  );
}

function exactPositive(value: string): boolean {
  return profitSign(value) === 'PROFIT';
}

function Line({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string | null;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div
      className="profit-row"
      data-tone={
        value === null ? 'missing' : profitSign(value) === 'LOSS' && strong ? 'bad' : undefined
      }
      data-strong={strong || undefined}
    >
      <dt>
        {label}
        {note ? <span className="profit-row-note">{note}</span> : null}
      </dt>
      <dd>{moneyOrUnavailable(value)}</dd>
    </div>
  );
}
