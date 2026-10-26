'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Card, EmptyState, ErrorState, StatusBadge } from '@/design-system/primitives';
import { moneyOrUnavailable } from '@/modules/profitability/ui/profit-model';
import type { ManagementReport } from '@/modules/reporting/contracts';
import { buildFinancialPosition, type PositionFlag } from '@/modules/reporting/statements';
import { OwnerPeriodBar } from './owner-period-bar';

export type FinancialPositionInitial = Readonly<{
  tenantId: string;
  report: ManagementReport | null;
  error: string | null;
  badRange: boolean;
}>;

const FLAG_TEXT: Record<PositionFlag, { badge: string; headline: string }> = {
  POSITIVE: {
    badge: 'Positive',
    headline: 'The business holds or is owed more than it owes.',
  },
  NEGATIVE: {
    badge: 'Negative',
    headline: 'The business owes more than it holds or is owed.',
  },
  EVEN: { badge: 'Even', headline: 'What the business holds equals what it owes.' },
  UNAVAILABLE: {
    badge: 'Not worked out yet',
    headline: 'The net position needs every figure below to be known.',
  },
};

export function FinancialPositionWorkspace({ initial }: { initial: FinancialPositionInitial }) {
  const router = useRouter();
  const report = initial.report;
  const position = useMemo(() => (report ? buildFinancialPosition(report) : null), [report]);
  const range = report
    ? { fromDate: report.filters.fromDate, toDate: report.filters.toDate }
    : null;

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
              title="The financial position could not be loaded"
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
          ) : !position ? null : (
            <div className="profit-body" data-pending={pending || undefined}>
              <Card as="section" className="panel profit-panel" aria-labelledby="fp-summary-title">
                <div className="panel-heading">
                  <h2 id="fp-summary-title">Net position</h2>
                  <StatusBadge
                    tone={
                      position.flag === 'NEGATIVE'
                        ? 'critical'
                        : position.flag === 'POSITIVE'
                          ? 'positive'
                          : position.flag === 'EVEN'
                            ? 'informational'
                            : 'warning'
                    }
                  >
                    {FLAG_TEXT[position.flag].badge}
                  </StatusBadge>
                </div>
                <p
                  className="profit-hero"
                  data-tone={
                    position.net === null
                      ? 'missing'
                      : position.flag === 'NEGATIVE'
                        ? 'bad'
                        : 'good'
                  }
                >
                  {moneyOrUnavailable(position.net)}
                </p>
                <p className="profit-headline">{FLAG_TEXT[position.flag].headline}</p>
                {position.missing.length > 0 ? (
                  <p className="profit-explain" role="status">
                    <StatusBadge tone="warning">Not worked out yet</StatusBadge> Not known:{' '}
                    {position.missing.join(', ').toLowerCase()}.
                  </p>
                ) : null}
              </Card>

              {position.statement.groups
                .filter((group) => group.heading)
                .map((group, index) => (
                  <Card
                    key={group.heading}
                    as="section"
                    className="panel profit-panel"
                    aria-labelledby={`fp-group-${index}`}
                  >
                    <div className="panel-heading">
                      <h2 id={`fp-group-${index}`}>{group.heading}</h2>
                    </div>
                    <dl className="profit-rows" aria-label={group.heading}>
                      {group.lines.map((line) => (
                        <div
                          key={line.label}
                          className="profit-row"
                          data-tone={line.value === null ? 'missing' : undefined}
                          data-strong={line.kind === 'subtotal' || undefined}
                        >
                          <dt>
                            {line.label}
                            {line.note ? (
                              <span className="profit-row-note">{line.note}</span>
                            ) : null}
                          </dt>
                          <dd>{moneyOrUnavailable(line.value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </Card>
                ))}

              {report?.ownerPosition?.stockByStation?.length ? (
                <Card as="section" className="panel profit-panel" aria-labelledby="fp-stock-title">
                  <div className="panel-heading">
                    <h2 id="fp-stock-title">Fuel stock by station</h2>
                  </div>
                  <dl className="profit-rows" aria-label="Fuel stock by station">
                    {report.ownerPosition.stockByStation.map((row) => (
                      <div
                        key={`${row.stationName}-${row.productName}`}
                        className="profit-row"
                        data-tone={row.value === null ? 'missing' : undefined}
                      >
                        <dt>
                          {row.stationName} · {row.productName}
                          <span className="profit-row-note">{row.litres} litres</span>
                        </dt>
                        <dd>{moneyOrUnavailable(row.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              ) : null}

              {position.statement.notes.map((note) => (
                <p key={note} className="profit-footnote">
                  {note}
                </p>
              ))}

              <nav className="profit-links" aria-label="Related screens">
                <Link className="button button-secondary" href="/daily-profit">
                  Daily profit
                </Link>
                <Link className="button button-secondary" href="/cash">
                  Cash
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
