'use client';

import { useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { InfoTip } from '@/design-system/info-tip';
import { Card, EmptyState, ErrorState, StatusBadge } from '@/design-system/primitives';
import { formatLitres } from '@/design-system/formatters';
import { moneyOrUnavailable } from '@/modules/profitability/ui/profit-model';
import type { ManagementReport } from '@/modules/reporting/contracts';
import {
  buildFinancialPosition,
  type PositionFlag,
  type StatementLine,
} from '@/modules/reporting/statements';

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

const isZero = (value: string | null) => value !== null && Number(value) === 0;

function Lines({ label, lines }: { label: string; lines: readonly StatementLine[] }) {
  // Lines with nothing in them are named once in a quiet line, so the figures that matter stand out.
  const empty = lines.filter((line) => line.kind === undefined && isZero(line.value));
  const items = lines.filter((line) => line.kind === undefined && !isZero(line.value));
  const totals = lines.filter((line) => line.kind !== undefined);
  const row = (line: StatementLine) => (
    <div
      key={line.label}
      className="profit-row"
      data-tone={line.value === null ? 'missing' : undefined}
      data-strong={line.kind === 'subtotal' || undefined}
    >
      <dt>
        {line.label}
        {line.note ? <InfoTip text={line.note} /> : null}
      </dt>
      <dd>{moneyOrUnavailable(line.value)}</dd>
    </div>
  );
  return (
    <>
      <dl className="profit-rows" aria-label={label}>
        {items.map(row)}
        {empty.length > 0 ? (
          <div className="profit-row fp-empty-row">
            <dt>
              No balance
              <span className="profit-row-note">{empty.map((line) => line.label).join(' · ')}</span>
            </dt>
          </div>
        ) : null}
        {totals.map(row)}
      </dl>
    </>
  );
}

/** Shown under the Profits tabs, which already carry the period and the related-screen buttons. */
export function FinancialPositionWorkspace({
  initial,
  links,
}: {
  initial: FinancialPositionInitial;
  /** The related-screen buttons, shared with the other Profits tabs. */
  links: ReactNode;
}) {
  const router = useRouter();
  const report = initial.report;
  const position = useMemo(() => (report ? buildFinancialPosition(report) : null), [report]);
  const [held, owed] = position?.statement.groups.filter((group) => group.heading) ?? [];
  const stock = report?.ownerPosition?.stockByStation ?? [];

  if (initial.badRange)
    return (
      <EmptyState
        title="Choose both dates"
        message="Pick a start date and an end date, with the start on or before the end."
      />
    );
  if (initial.error)
    return (
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
    );
  if (!position) return null;

  const badgeTone =
    position.flag === 'NEGATIVE'
      ? 'critical'
      : position.flag === 'POSITIVE'
        ? 'positive'
        : position.flag === 'EVEN'
          ? 'informational'
          : 'warning';
  const netTone = position.net === null ? 'missing' : position.flag === 'NEGATIVE' ? 'bad' : 'good';

  return (
    <div className="profit-body">
      <div className="profit-overview">
        {held ? (
          <Card as="section" className="panel profit-panel" aria-labelledby="fp-held-title">
            <span className="heading-with-tip">
              <h2 id="fp-held-title" className="profit-title">
                {held.heading}
              </h2>
              <InfoTip text={position.statement.notes.join(' ')} />
            </span>
            <Lines label={held.heading ?? ''} lines={held.lines} />
          </Card>
        ) : null}
        {owed ? (
          <div className="profit-fuel-wrap">
            <Card
              as="section"
              className="panel profit-panel profit-fuel-card"
              aria-labelledby="fp-owed-title"
            >
              <h2 id="fp-owed-title" className="profit-title">
                {owed.heading}
              </h2>
              <Lines label={owed.heading ?? ''} lines={owed.lines} />
              <div className="fp-net" data-tone={netTone}>
                <span className="heading-with-tip">
                  <h3>Net position</h3>
                  <InfoTip
                    text={[
                      FLAG_TEXT[position.flag].headline,
                      position.missing.length > 0
                        ? `Not known: ${position.missing.join(', ').toLowerCase()}.`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                </span>
                <StatusBadge tone={badgeTone}>{FLAG_TEXT[position.flag].badge}</StatusBadge>
                <p className="fp-net-figure">{moneyOrUnavailable(position.net)}</p>
              </div>
            </Card>
            {links}
          </div>
        ) : (
          links
        )}
      </div>

      {stock.length > 0 ? (
        <Card as="section" className="panel profit-panel" aria-labelledby="fp-stock-title">
          <h2 id="fp-stock-title" className="profit-title">
            Fuel stock by station
          </h2>
          <table className="data-table profit-table fp-stock-table">
            <caption className="visually-hidden">Fuel stock by station</caption>
            <thead>
              <tr>
                <th scope="col">Station</th>
                <th scope="col">Fuel</th>
                <th scope="col">Litres</th>
                <th scope="col">Value at cost</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((row) => (
                <tr key={`${row.stationName}-${row.productName}`}>
                  <th scope="row">{row.stationName}</th>
                  <td data-label="Fuel">{row.productName}</td>
                  <td data-label="Litres">{formatLitres(row.litres)}</td>
                  <td data-label="Value at cost">{moneyOrUnavailable(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
