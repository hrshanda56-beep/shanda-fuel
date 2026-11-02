'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { formatBusinessDate, formatLitres } from '@/design-system/formatters';
import { Pagination, usePagination } from '@/design-system/pagination';
import { InfoTip } from '@/design-system/info-tip';
import { Card, EmptyState, ErrorState, StatusBadge } from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import { CashDonut } from '@/modules/cash/ui/cash-visuals';
import { profitSign, type DailyProfitSummary } from '@/modules/profitability/daily-profit';
import { formatPerLitre, moneyOrUnavailable } from '@/modules/profitability/ui/profit-model';
import { parseReportFilters } from '@/modules/reporting/filters';
import { REPORT_PERIOD_LABELS } from '@/modules/reporting/period';
import type { ManagementReport } from '@/modules/reporting/contracts';
import { dailyProfitFromReport } from '@/modules/reporting/daily-profit';

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

function num(value: string | null): number {
  const n = value === null ? 0 : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Where each dollar of sales went. Sizes are for the picture only. */
function ProfitSplit({ summary }: { summary: DailyProfitSummary }) {
  const sales = num(summary.combined.sales);
  const parts = [
    { key: 'cost', label: 'Fuel cost', amount: summary.combined.costOfFuelSold, tone: 1 },
    { key: 'expenses', label: 'Expenses', amount: summary.combined.expenses, tone: 2 },
    { key: 'fixed', label: 'Fixed costs', amount: summary.combined.fixedCosts, tone: 3 },
    { key: 'staff', label: 'Fuel given to staff', amount: summary.fuelBenefit, tone: 4 },
    { key: 'profit', label: 'Profit', amount: summary.operatingProfitAfterBenefit, tone: 0 },
  ]
    .map((part) => ({ ...part, value: num(part.amount) }))
    .filter((part) => part.value > 0);
  const total = Math.max(
    sales,
    parts.reduce((sum, part) => sum + part.value, 0),
  );
  if (total === 0) return null;
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
        centreValue={moneyOrUnavailable(summary.combined.sales)}
        selectOpensDialog={false}
      />
    </div>
  );
}

/** `embedded` drops the period line, for use under the Profits tabs, which already show it. */
export function DailyProfitWorkspace({
  initial,
  links,
  embedded = false,
}: {
  initial: DailyProfitInitial;
  /** The related-screen buttons, shared with the This Month tab. */
  links: ReactNode;
  embedded?: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const filters = useMemo(() => parseReportFilters(search), [search]);
  const report = initial.report;
  const summary = useMemo(() => (report ? dailyProfitFromReport(report) : null), [report]);
  const hasActivity = summary !== null && summary.days.length > 0;
  const dayPage = usePagination(summary?.days ?? []);
  const missingCost = summary?.fuels.some((fuel) => fuel.grossProfit === null) ?? false;
  const period = report
    ? `${formatBusinessDate(report.filters.fromDate)} to ${formatBusinessDate(report.filters.toDate)}`
    : null;

  return (
    <div className="profit-workspace">
      {embedded ? null : (
        <div className="profit-top">
          <p className="profit-period">
            {report ? <strong>{REPORT_PERIOD_LABELS[filters.period]}</strong> : null}
            {period ? <span>{period}</span> : null}
          </p>
        </div>
      )}

      {initial.badRange ? (
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
        <div className="profit-body">
          <div className="profit-overview">
            <Card as="section" className="panel profit-panel" aria-labelledby="dp-summary-title">
              <div className="panel-heading">
                <span className="heading-with-tip">
                  <h2 id="dp-summary-title">Operating profit</h2>
                  <InfoTip
                    text={`What is left after the fuel cost, the day-to-day expenses and each day's share of the fixed costs.${missingCost ? ' Some sales have no fuel cost yet, so profit is not shown for them.' : ''}`}
                  />
                </span>
                <FlagBadge value={summary.operatingProfitAfterBenefit} loss="Loss" gain="Profit" />
              </div>
              <p
                className="profit-hero"
                data-tone={tone(summary.operatingProfitAfterBenefit) ?? 'good'}
              >
                {moneyOrUnavailable(summary.operatingProfitAfterBenefit)}
              </p>
              <ProfitSplit summary={summary} />
            </Card>

            <div className="profit-fuel-wrap">
              <Card
                as="section"
                className="panel profit-panel profit-fuel-card"
                aria-labelledby="dp-fuels-title"
              >
                <h2 id="dp-fuels-title" className="profit-title">
                  Profit by fuel
                </h2>
                {summary.fuels.length === 0 ? (
                  <EmptyState
                    layout="block"
                    title="No fuel sold"
                    message="Fuel appears here once a day's sales are closed and checked."
                    icon="fuel"
                  />
                ) : (
                  <table className="data-table profit-table">
                    <caption className="visually-hidden">Profit by fuel</caption>
                    <thead>
                      <tr>
                        <th scope="col">Fuel</th>
                        <th scope="col">Litres sold</th>
                        <th scope="col">Fuel sold</th>
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
                          <td
                            data-label="Profit before expenses"
                            data-negative={profitSign(fuel.grossProfit) === 'LOSS' || undefined}
                          >
                            {moneyOrUnavailable(fuel.grossProfit)}
                          </td>
                          <td data-label="Profit per litre">
                            {formatPerLitre(fuel.grossProfitPerLitre).replace(' per litre', '')}
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
                          <td data-label="Profit before expenses">
                            {moneyOrUnavailable(summary.combined.grossProfit)}
                          </td>
                          <td data-label="Profit per litre">
                            {formatPerLitre(summary.combined.grossProfitPerLitre).replace(
                              ' per litre',
                              '',
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                )}
              </Card>
              {links}
            </div>
          </div>

          <Card as="section" className="panel profit-panel" aria-labelledby="dp-days-title">
            <span className="heading-with-tip">
              <h2 id="dp-days-title" className="profit-title">
                Day by day
              </h2>
              <InfoTip text="Fixed costs such as rent are spread evenly over the days of their month. Fuel given to staff is taken off the period total only, not off each day." />
            </span>
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
                  {dayPage.rows.map((day) => (
                    <tr key={day.date}>
                      <th scope="row">
                        {formatBusinessDate(day.date)}
                        <span className="profit-row-note">
                          {day.fuels
                            .map((f) => `${f.productName} ${moneyOrUnavailable(f.sales)}`)
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
            <Pagination slice={dayPage} label="Day by day pages" noun="days" />
          </Card>
        </div>
      )}
    </div>
  );
}
