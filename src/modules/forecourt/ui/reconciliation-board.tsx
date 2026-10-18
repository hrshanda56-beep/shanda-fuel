'use client';

import { useEffect, useMemo, useState } from 'react';

import { Icon } from '../../../design-system/icons';
import { formatStatusLabel } from '../../../design-system/formatters';
import { LoadingState, StatusBadge, type StatusTone } from '../../../design-system/primitives';
import { CashDonut, sumDecimals, type DonutSlice } from '../../cash/ui/cash-visuals';
import { formatTileMoney } from '../../reporting/format';
import {
  buildStatement,
  NOT_AVAILABLE,
  NOT_RECORDED,
  statementToCsv,
  type ReconciliationDetail,
  type Statement,
  type StatementSection,
} from './reconciliation-statement';

export type QueueItem = Readonly<{
  id: string;
  shiftId: string | null;
  state: string;
  revision: number | null;
  revisionState: string | null;
  updatedAt: string | null;
  submittedAt: string | null;
  returnedAt: string | null;
  approvedAt: string | null;
  returnReason: string | null;
}>;

type Group = 'returned' | 'review' | 'draft' | 'approved';
type Filter = 'all' | Group;
type Action = { href: string; label: string; primary: boolean };

const CURRENCY = 'USD';

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'returned', label: 'Returned' },
  { value: 'review', label: 'In review' },
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
];

export function groupOf(state: string): Group {
  if (state === 'RETURNED') return 'returned';
  if (state === 'SUBMITTED' || state === 'PENDING_APPROVAL') return 'review';
  if (state === 'DRAFT') return 'draft';
  return 'approved';
}

/** Exceptions first: returned, then waiting for review, then drafts, then the rest. */
const RANK: Record<Group, number> = { returned: 0, review: 1, draft: 2, approved: 3 };

const money = (value: string | null | undefined) => formatTileMoney(value, CURRENCY);

/** Reads the figures of one reconciliation through the existing read-only endpoint. */
function useDetails(items: readonly QueueItem[], tenantId: string, stationId: string) {
  const [details, setDetails] = useState<Record<string, ReconciliationDetail | null>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      items.map(async (item): Promise<[string, ReconciliationDetail | null]> => {
        try {
          const params = new URLSearchParams({ tenantId, stationId });
          const response = await fetch(`/api/forecourt/reconciliations/${item.id}?${params}`, {
            cache: 'no-store',
          });
          if (!response.ok) return [item.id, null];
          const body = (await response.json()) as Partial<ReconciliationDetail>;
          const ready =
            typeof body.totals?.expectedSales === 'string' &&
            typeof body.totals.accountedSales === 'string' &&
            typeof body.totals.salesVariance === 'string' &&
            Array.isArray(body.readings) &&
            Array.isArray(body.payments) &&
            Array.isArray(body.expenses);
          return [item.id, ready ? (body as ReconciliationDetail) : null];
        } catch {
          return [item.id, null];
        }
      }),
    ).then((entries) => {
      if (!cancelled) setDetails(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [items, tenantId, stationId]);

  return { details, loaded: items.every((item) => item.id in details) };
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** Expected against accounted sales for each shift. Bar heights are presentation only. */
function SalesBars({
  rows,
}: {
  rows: ReadonlyArray<{ id: string; label: string; expected: string; accounted: string }>;
}) {
  const values = rows.flatMap((row) => [Number(row.expected), Number(row.accounted)]);
  const max = Math.max(...values.filter(Number.isFinite), 0);
  const top = max > 0 ? max : 1;
  const height = (value: string) => `${Math.max((Math.max(Number(value), 0) / top) * 100, 1)}%`;
  return (
    <figure
      className="recon-bars"
      aria-label={`Sales by shift: ${rows.map((row) => `${row.label} expected ${money(row.expected)}, accounted ${money(row.accounted)}`).join('; ')}`}
    >
      <div className="recon-bars-plot">
        <div className="recon-bars-axis" aria-hidden="true">
          <span>{compact.format(Math.round(top))}</span>
          <span>{compact.format(Math.round(top / 2))}</span>
          <span>0</span>
        </div>
        <div className="recon-bars-columns">
          {rows.map((row) => (
            <div key={row.id} className="recon-bars-col">
              <div className="recon-bars-pair">
                <span
                  className="recon-bar"
                  data-kind="expected"
                  style={{ height: height(row.expected) }}
                  title={`Expected ${money(row.expected)}`}
                />
                <span
                  className="recon-bar"
                  data-kind="accounted"
                  style={{ height: height(row.accounted) }}
                  title={`Accounted ${money(row.accounted)}`}
                />
              </div>
              <span className="recon-bars-label">{row.label}</span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="recon-bars-key">
        <span data-kind="expected">Expected from meters</span>
        <span data-kind="accounted">Accounted for</span>
      </figcaption>
    </figure>
  );
}

function download(contents: string, fileName: string) {
  const blob = new Blob(['﻿', contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function LedgerRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string | null;
  strong?: boolean;
  tone?: 'critical';
}) {
  // An absent figure stays on the page and says so; it is never hidden or shown as 0.00.
  return (
    <tr data-strong={strong || undefined}>
      <th scope="row">{label}</th>
      {value === null ? (
        <td data-missing="true">{NOT_RECORDED}</td>
      ) : (
        <td data-tone={tone}>{money(value)}</td>
      )}
    </tr>
  );
}

const nonZero = (value: string | null) => value !== null && Number(value) !== 0;

function StatementShiftBlock({ section }: { section: StatementSection }) {
  // A labelled group, not a region: shifts can share a time label, and repeated
  // landmarks with the same name are not distinguishable to assistive technology.
  const headingId = `recon-ledger-${section.id}`;
  return (
    <div className="recon-ledger" role="group" aria-labelledby={headingId}>
      <div className="recon-ledger-head">
        <h3 id={headingId}>{section.label}</h3>
        <span>{formatStatusLabel(section.state)}</span>
      </div>
      <table>
        <tbody>
          <LedgerRow
            label={`Expected sales · ${section.nozzles} ${section.nozzles === 1 ? 'nozzle' : 'nozzles'}, ${section.litres} L`}
            value={section.expectedSales}
            strong
          />
          {section.paymentLines.map((line) => (
            <LedgerRow
              key={`pay-${line.description}`}
              label={`Accounted by ${line.description}`}
              value={line.amount}
            />
          ))}
          {section.expenseLines.map((line) => (
            <LedgerRow
              key={`exp-${line.description}`}
              label={`Expenses · ${line.description}`}
              value={line.amount}
            />
          ))}
          <LedgerRow label="Accounted sales" value={section.accountedSales} strong />
          <LedgerRow
            label="Sales variance"
            value={section.salesVariance}
            strong
            tone={nonZero(section.salesVariance) ? 'critical' : undefined}
          />
          <LedgerRow label="Expected cash" value={section.expectedCash} />
          <LedgerRow label="Counted cash" value={section.countedCash} />
          <LedgerRow
            label="Cash variance"
            value={section.cashVariance}
            strong
            tone={nonZero(section.cashVariance) ? 'critical' : undefined}
          />
        </tbody>
      </table>
    </div>
  );
}

function StatementView({
  organisation,
  station,
  businessDate,
  fileStem,
  statement,
  loaded,
}: {
  organisation: string;
  station: string;
  businessDate: string;
  fileStem: string;
  statement: Statement;
  loaded: boolean;
}) {
  const [preparedAt] = useState(() => new Date());
  const prepared = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(preparedAt);
  const { totals } = statement;
  return (
    <section
      className="card panel cash-panel recon-statement"
      aria-labelledby="recon-statement-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Statement</p>
          <h2 id="recon-statement-title">Reconciliation statement</h2>
        </div>
        <div className="recon-statement-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={!loaded}
            onClick={() =>
              download(
                statementToCsv({
                  organisation,
                  station,
                  businessDate,
                  currency: CURRENCY,
                  statement,
                }),
                `${fileStem}.csv`,
              )
            }
          >
            Download CSV
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!loaded}
            onClick={() => window.print()}
          >
            Print or save as PDF
          </button>
        </div>
      </div>

      {!loaded ? (
        <LoadingState label="Loading statement figures" />
      ) : (
        <>
          <dl className="recon-statement-meta">
            <div>
              <dt>Organisation</dt>
              <dd>{organisation}</dd>
            </div>
            <div>
              <dt>Station</dt>
              <dd>{station}</dd>
            </div>
            <div>
              <dt>Business date</dt>
              <dd>{businessDate}</dd>
            </div>
            <div>
              <dt>Prepared</dt>
              <dd>{prepared}</dd>
            </div>
          </dl>

          <table className="recon-summary" aria-label="Statement summary">
            <thead>
              <tr>
                <th scope="col">Shift</th>
                <th scope="col">Expected</th>
                <th scope="col">Accounted</th>
                <th scope="col">Variance</th>
              </tr>
            </thead>
            <tbody>
              {statement.sections.map((section) => (
                <tr key={section.id}>
                  <th scope="row">{section.label}</th>
                  <td data-label="Expected">{money(section.expectedSales)}</td>
                  <td data-label="Accounted">{money(section.accountedSales)}</td>
                  <td
                    data-label="Variance"
                    data-tone={nonZero(section.salesVariance) ? 'critical' : undefined}
                  >
                    {money(section.salesVariance)}
                  </td>
                </tr>
              ))}
              {statement.missing.map((shift) => (
                <tr key={shift.id} data-missing="true">
                  <th scope="row">{shift.label}</th>
                  <td colSpan={3}>{NOT_AVAILABLE} · figures could not be loaded</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{totals.complete ? 'Total' : 'Total of shifts shown'}</th>
                {totals.expectedSales === null ? (
                  <td colSpan={3} data-missing="true">
                    {NOT_AVAILABLE}
                  </td>
                ) : (
                  <>
                    <td data-label="Expected">{money(totals.expectedSales)}</td>
                    <td data-label="Accounted">{money(totals.accountedSales)}</td>
                    <td
                      data-label="Variance"
                      data-tone={nonZero(totals.salesVariance) ? 'critical' : undefined}
                    >
                      {money(totals.salesVariance)}
                    </td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>

          {statement.sections.length === 0 ? (
            <p className="recon-empty">
              No shift figures to show yet. They appear once a reconciliation has meter readings.
            </p>
          ) : (
            <div className="recon-ledgers">
              {statement.sections.map((section) => (
                <StatementShiftBlock key={section.id} section={section} />
              ))}
            </div>
          )}

          {statement.missing.length > 0 ? (
            <p className="recon-statement-note" data-missing="true" role="note">
              Figures could not be loaded for {statement.missing.map((s) => s.label).join(', ')}.
              They are left out of the totals above, not counted as zero, so the totals do not cover
              the whole day.
            </p>
          ) : null}
          {totals.shiftsWithoutCash > 0 ? (
            <p className="recon-statement-note" data-missing="true" role="note">
              {totals.shiftsWithoutCash}{' '}
              {totals.shiftsWithoutCash === 1 ? 'shift has' : 'shifts have'} no counted cash. Marked
              “{NOT_RECORDED}” above, not counted as zero.
            </p>
          ) : null}
          <p className="recon-statement-note">
            Every figure is the one the system calculated for that shift. Totals add the shifts
            together; nothing here changes a record.
          </p>
        </>
      )}
    </section>
  );
}

export function ReconciliationBoard({
  tenantId,
  stationId,
  organisation,
  station,
  businessDate,
  fileStem,
  items,
  timezone,
  statementOpen,
  tone,
  shiftLabel,
  formatTimestamp,
  actionFor,
}: {
  tenantId: string;
  stationId: string;
  organisation: string;
  station: string;
  businessDate: string;
  fileStem: string;
  items: readonly QueueItem[];
  timezone: string;
  statementOpen: boolean;
  tone: (state: string) => StatusTone;
  shiftLabel: (shiftId: string | null) => string;
  formatTimestamp: (value: string | null, timeZone: string) => string;
  actionFor: (item: QueueItem) => Action | undefined;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string>();
  const { details, loaded } = useDetails(items, tenantId, stationId);

  const counts: Record<Filter, number> = {
    all: items.length,
    returned: 0,
    review: 0,
    draft: 0,
    approved: 0,
  };
  for (const item of items) counts[groupOf(item.state)] += 1;
  const open = counts.returned + counts.review + counts.draft;

  const ordered = useMemo(
    () => [...items].sort((a, b) => shiftLabel(a.shiftId).localeCompare(shiftLabel(b.shiftId))),
    [items, shiftLabel],
  );
  const statement = useMemo(
    () =>
      buildStatement(
        ordered.map((item) => ({
          id: item.id,
          label: shiftLabel(item.shiftId),
          state: item.state,
          detail: details[item.id] ?? null,
        })),
        formatStatusLabel,
      ),
    [ordered, details, shiftLabel],
  );

  if (statementOpen) {
    return (
      <StatementView
        organisation={organisation}
        station={station}
        businessDate={businessDate}
        fileStem={fileStem}
        statement={statement}
        loaded={loaded}
      />
    );
  }

  const slices: DonutSlice[] = [
    { key: 'approved', label: 'Approved', detail: 'Locked in', tone: 0, count: counts.approved },
    {
      key: 'review',
      label: 'In review',
      detail: 'Waiting for a supervisor',
      tone: 2,
      count: counts.review,
    },
    {
      key: 'returned',
      label: 'Returned',
      detail: 'Sent back for changes',
      tone: 4,
      count: counts.returned,
    },
    { key: 'draft', label: 'Draft', detail: 'Not submitted yet', tone: 1, count: counts.draft },
  ].map((slice) => ({ ...slice, total: String(slice.count), display: String(slice.count) }));

  const barRows = statement.sections.map((section) => ({
    id: section.id,
    label: section.label,
    expected: section.expectedSales,
    accounted: section.accountedSales,
  }));
  const visible = ordered
    .filter((item) => filter === 'all' || groupOf(item.state) === filter)
    .sort((a, b) => RANK[groupOf(a.state)] - RANK[groupOf(b.state)]);

  return (
    <>
      <div className="recon-charts">
        <section className="card panel cash-panel" aria-labelledby="recon-status-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Overview</p>
              <h2 id="recon-status-title">Reconciliation status</h2>
            </div>
          </div>
          <CashDonut
            slices={slices}
            currency={CURRENCY}
            centreValue={String(items.length)}
            centreLabel={items.length === 1 ? 'reconciliation' : 'reconciliations'}
            selectOpensDialog={false}
            onSelect={(key) => {
              setFilter(key as Filter);
              document
                .getElementById('recon-queue-title')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            emptyMessage="Reconciliations appear here once one is started for a shift."
          />
        </section>

        <section className="card panel cash-panel" aria-labelledby="recon-sales-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Sales</p>
              <h2 id="recon-sales-title">Expected against accounted</h2>
            </div>
          </div>
          {!loaded ? (
            <LoadingState label="Loading shift figures" />
          ) : barRows.length === 0 ? (
            <p className="recon-empty">
              Shift sales appear here once a reconciliation has meter readings.
            </p>
          ) : (
            <SalesBars rows={barRows} />
          )}
        </section>
      </div>

      <section className="card panel cash-panel recon-queue" aria-labelledby="recon-queue-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Review</p>
            <h2 id="recon-queue-title">Shift reconciliations</h2>
          </div>
          <span className="recon-queue-open" data-clear={open === 0 || undefined}>
            <span className="recon-queue-dot" aria-hidden="true" />
            {open} open
          </span>
        </div>

        <div className="recon-tabs" role="group" aria-label="Show reconciliations">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className="recon-tab"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
              <span className="recon-tab-count">{counts[item.value]}</span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="recon-empty">
            {items.length === 0
              ? 'No reconciliations yet. One appears here once it is started for a shift.'
              : 'Nothing in this view. Choose another tab to see the rest.'}
          </p>
        ) : (
          <div className="recon-table" role="list" aria-label="Reconciliations">
            <div className="recon-table-head" aria-hidden="true">
              <span>Shift</span>
              <span>Status</span>
              <span>Expected</span>
              <span>Accounted</span>
              <span>Variance</span>
              <span>Action</span>
              <span />
            </div>
            {visible.map((item) => {
              const detail = details[item.id];
              const expanded = openId === item.id;
              const action = actionFor(item);
              const panelId = `recon-expand-${item.id}`;
              return (
                <div
                  key={item.id}
                  role="listitem"
                  className="recon-item"
                  data-group={groupOf(item.state)}
                  data-open={expanded || undefined}
                >
                  <div className="recon-row">
                    <button
                      type="button"
                      className="recon-row-toggle"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      aria-label={`${shiftLabel(item.shiftId)}, ${formatStatusLabel(item.state)}. Show details`}
                      onClick={() => setOpenId(expanded ? undefined : item.id)}
                    />
                    <span className="recon-cell recon-cell-shift" data-label="Shift">
                      <strong>{shiftLabel(item.shiftId)}</strong>
                      <small>
                        {item.state === 'RETURNED' && item.returnReason
                          ? item.returnReason
                          : `Updated ${formatTimestamp(item.updatedAt, timezone)}`}
                      </small>
                    </span>
                    <span className="recon-cell" data-label="Status">
                      <StatusBadge tone={tone(item.state)}>
                        {formatStatusLabel(item.state)}
                      </StatusBadge>
                    </span>
                    <span className="recon-cell recon-cell-num" data-label="Expected">
                      {detail ? money(detail.totals.expectedSales) : loaded ? '—' : '…'}
                    </span>
                    <span className="recon-cell recon-cell-num" data-label="Accounted">
                      {detail ? money(detail.totals.accountedSales) : loaded ? '—' : '…'}
                    </span>
                    <span
                      className="recon-cell recon-cell-num"
                      data-label="Variance"
                      data-tone={
                        detail && nonZero(detail.totals.salesVariance) ? 'critical' : undefined
                      }
                    >
                      {detail ? money(detail.totals.salesVariance) : loaded ? '—' : '…'}
                    </span>
                    <span className="recon-cell recon-cell-action">
                      {action ? (
                        <a
                          className={`button ${action.primary ? 'button-primary' : 'button-secondary'}`}
                          href={action.href}
                        >
                          {action.label}
                        </a>
                      ) : null}
                    </span>
                    <span className="recon-chevron" aria-hidden="true">
                      <Icon name="chevron-down" />
                    </span>
                  </div>

                  {expanded ? (
                    <div className="recon-expand" id={panelId}>
                      {item.state === 'RETURNED' && item.returnReason ? (
                        <p className="recon-callout" data-tone="critical">
                          <strong>Returned for changes</strong>
                          {item.returnReason}
                        </p>
                      ) : null}
                      <dl className="recon-facts">
                        <div>
                          <dt>Revision</dt>
                          <dd>{item.revision ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>Revision state</dt>
                          <dd>
                            {item.revisionState ? formatStatusLabel(item.revisionState) : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>Submitted</dt>
                          <dd>{formatTimestamp(item.submittedAt, timezone)}</dd>
                        </div>
                        <div>
                          <dt>Returned</dt>
                          <dd>{formatTimestamp(item.returnedAt, timezone)}</dd>
                        </div>
                        <div>
                          <dt>Approved</dt>
                          <dd>{formatTimestamp(item.approvedAt, timezone)}</dd>
                        </div>
                        <div>
                          <dt>Last updated</dt>
                          <dd>{formatTimestamp(item.updatedAt, timezone)}</dd>
                        </div>
                        {detail?.cash ? (
                          <>
                            <div>
                              <dt>Expected cash</dt>
                              <dd>{money(detail.cash.netExpectedCash)}</dd>
                            </div>
                            <div>
                              <dt>Counted cash</dt>
                              <dd>{money(detail.cash.countedCash)}</dd>
                            </div>
                          </>
                        ) : null}
                        {detail && detail.payments.length > 0 ? (
                          <div>
                            <dt>Payments declared</dt>
                            <dd>
                              {money(sumDecimals(detail.payments.map((payment) => payment.amount)))}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
