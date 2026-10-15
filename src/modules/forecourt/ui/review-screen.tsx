'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ConfirmDialog } from '../../../design-system/confirm-dialog';
import {
  describeDifference,
  formatBusinessDate,
  formatLitres,
  formatMoney,
} from '../../../design-system/formatters';
import { InlineError } from '../../../design-system/inline-error';
import {
  Field,
  ErrorState,
  Button,
  SkeletonBlock,
  StatusBadge,
} from '../../../design-system/primitives';
import { getDisplayStatus } from '../../../design-system/status-display';
import { useToast } from '../../../design-system/toast';
import {
  describeFailure,
  type UserMessage,
  userMessage,
} from '../../../design-system/user-messages';
import {
  methodLabels,
  type OperationsContext,
  type RecordData,
} from './daily-operations-workspace';
import { shiftLabel } from './shift-labels';
import { MIN_EXPLANATION } from './submit-rules';

export type ReviewContext = Readonly<{
  tenantId: string;
  stationId: string;
  businessDayId: string;
  shiftId: string;
  reconciliationId: string;
}>;

type OverviewSlice = {
  station: { timezone: string };
  reconciliations: Array<{
    id: string;
    submittedAt: string | null;
    returnReason: string | null;
    revision: number | null;
  }>;
  timeline: Array<{
    eventCode: string;
    occurredAt: string | null;
    actorName: string | null;
    subjectId?: string | null;
  }>;
};

const WAITING = new Set(['SUBMITTED', 'PENDING_APPROVAL']);

function isZero(value: string | null | undefined): boolean {
  return value === null || value === undefined || /^-?0(?:\.0+)?$/.test(value);
}

function isUserMessage(value: unknown): value is UserMessage {
  return typeof value === 'object' && value !== null && 'title' in value && 'code' in value;
}

/**
 * The manager's read-only view of a submitted reconciliation. Nothing here can be edited: the person
 * reading it either approves it or sends it back with a reason. The buttons are only drawn for someone
 * who may approve and did not submit the figures themselves.
 */
export function ReviewScreen({
  context,
  canApprove,
  membershipId,
}: Readonly<{ context: ReviewContext; canApprove: boolean; membershipId: string | null }>) {
  const router = useRouter();
  const toast = useToast();
  const [operation, setOperation] = useState<OperationsContext | null>(null);
  const [record, setRecord] = useState<(RecordData & { supervisor_id?: string }) | null>(null);
  const [overview, setOverview] = useState<OverviewSlice | null>(null);
  const [loadError, setLoadError] = useState<UserMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserMessage | null>(null);
  const [approving, setApproving] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({
        tenantId: context.tenantId,
        stationId: context.stationId,
        businessDayId: context.businessDayId,
        shiftId: context.shiftId,
      });
      const [operationResponse, recordResponse, overviewResponse] = await Promise.all([
        fetch(`/api/forecourt/operations/daily?${query}`, { cache: 'no-store' }),
        fetch(
          `/api/forecourt/reconciliations/${context.reconciliationId}?tenantId=${encodeURIComponent(context.tenantId)}&stationId=${encodeURIComponent(context.stationId)}`,
          { cache: 'no-store' },
        ),
        fetch(
          `/api/forecourt/operations/overview?${new URLSearchParams({ tenantId: context.tenantId, stationId: context.stationId, businessDayId: context.businessDayId })}`,
          { cache: 'no-store' },
        ).catch(() => null),
      ]);
      if (!operationResponse.ok || !recordResponse.ok) {
        const failed = operationResponse.ok ? recordResponse : operationResponse;
        const body = (await failed.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw describeFailure(failed.status, body.error, body.message);
      }
      setOperation((await operationResponse.json()) as OperationsContext);
      setRecord((await recordResponse.json()) as RecordData & { supervisor_id?: string });
      setOverview(overviewResponse?.ok ? ((await overviewResponse.json()) as OverviewSlice) : null);
    } catch (caught) {
      setLoadError(isUserMessage(caught) ? caught : userMessage('UNKNOWN'));
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submittedSummary = useMemo(() => {
    const summary = overview?.reconciliations.find((item) => item.id === context.reconciliationId);
    const submitEvent = overview?.timeline.find((event) => /submit/i.test(event.eventCode));
    return {
      at: summary?.submittedAt ?? submitEvent?.occurredAt ?? null,
      by: submitEvent?.actorName ?? null,
    };
  }, [context.reconciliationId, overview]);

  if (loadError) {
    return (
      <ErrorState
        title={loadError.title}
        message={loadError.body}
        action={
          loadError.code === 'UNKNOWN' ? (
            <Button
              onClick={() => {
                setLoadError(null);
                setLoading(true);
                void load();
              }}
            >
              Try again
            </Button>
          ) : null
        }
      />
    );
  }
  if (loading || !operation || !record) {
    return (
      <div className="review-screen" role="status" aria-label="Loading review">
        <SkeletonBlock width="60%" height="2rem" />
        <div className="review-totals">
          <SkeletonBlock height="5rem" />
          <SkeletonBlock height="5rem" />
          <SkeletonBlock height="5rem" />
        </div>
        <SkeletonBlock height="8rem" />
      </div>
    );
  }

  const timezone = operation.station.timezone;
  const status = getDisplayStatus(record.state);
  const waiting = WAITING.has(record.state);
  const submittedByMe = Boolean(membershipId) && record.supervisor_id === membershipId;
  const mayDecide = canApprove && !submittedByMe && waiting;
  const timeText = submittedSummary.at
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(submittedSummary.at))
    : null;
  const submittedLine = [
    submittedSummary.by ? `Submitted by ${submittedSummary.by}` : 'Submitted',
    timeText ? `at ${timeText}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const explanationOf = (category: string) =>
    record.explanations.find((item) => item.category === category)?.explanation.trim() ?? '';
  const differences: Array<{
    key: string;
    label: string;
    value: string;
    unit: 'money' | 'litres';
    explanation: string;
  }> = [];
  if (!isZero(record.totals.salesVariance)) {
    differences.push({
      key: 'SALES',
      label: 'Sales',
      value: record.totals.salesVariance,
      unit: 'money',
      explanation: explanationOf('SALES'),
    });
  }
  if (!isZero(record.totals.cashVariance)) {
    differences.push({
      key: 'CASH',
      label: 'Cash',
      value: record.totals.cashVariance ?? '0',
      unit: 'money',
      explanation: explanationOf('CASH'),
    });
  }
  for (const [tankId, value] of Object.entries(record.totals.stockVariance)) {
    if (isZero(value)) continue;
    differences.push({
      key: `STOCK-${tankId}`,
      label: 'Stock',
      value,
      unit: 'litres',
      explanation: explanationOf('STOCK'),
    });
  }
  const salesWords = describeDifference(record.totals.salesVariance);
  const cashWords = describeDifference(record.totals.cashVariance);

  const nozzleOf = (nozzleId: string) =>
    operation.availableReadings.find((item) => item.nozzleId === nozzleId);
  const teamNames = record.attendants.map((item) => ({
    id: item.attendantId,
    name: operation.attendants.find((person) => person.id === item.attendantId)?.name ?? null,
  }));

  async function decide(commandType: string, values: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `review-${commandType}-${context.reconciliationId}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          commandType,
          tenantId: context.tenantId,
          stationId: context.stationId,
          reconciliationId: context.reconciliationId,
          expectedVersion: record?.version,
          ...values,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw describeFailure(response.status, body.error, body.message);
      }
      toast.show(success);
      setApproving(false);
      setSendingBack(false);
      setReason('');
      await load();
      router.refresh();
    } catch (caught) {
      setError(isUserMessage(caught) ? caught : userMessage('UNKNOWN'));
      setApproving(false);
      setSendingBack(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const reasonValid = reason.trim().length >= MIN_EXPLANATION;
  const totalLines = [
    { label: 'Expected sales', value: formatMoney(record.totals.expectedSales) },
    { label: 'Accounted for', value: formatMoney(record.totals.accountedSales) },
    { label: 'Difference', value: formatMoney(record.totals.salesVariance) },
    ...(record.totals.cashVariance !== null
      ? [{ label: 'Cash difference', value: formatMoney(record.totals.cashVariance) }]
      : []),
  ];

  return (
    <div className="review-screen" aria-label="Reconciliation review">
      <header className="review-head">
        <div>
          <p className="eyebrow">
            {operation.station.name} · {formatBusinessDate(record.business_date)} ·{' '}
            {shiftLabel(operation.shift.plannedStartAt, operation.shift.plannedEndAt, timezone)}
          </p>
          <h2>Review figures</h2>
          <p className="review-meta">{submittedLine}</p>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </header>

      <div className="review-totals">
        <TotalCard label="Expected sales" value={formatMoney(record.totals.expectedSales)} />
        <TotalCard label="Accounted for" value={formatMoney(record.totals.accountedSales)} />
        <TotalCard
          label="Difference"
          value={formatMoney(record.totals.salesVariance)}
          words={salesWords?.words}
          tone={salesWords?.tone}
        />
      </div>

      <section className="card panel review-card" aria-labelledby="review-differences">
        <h3 id="review-differences">Differences</h3>
        {differences.length === 0 ? (
          <p className="review-clear">Everything balances. There are no differences to explain.</p>
        ) : (
          <ul className="review-differences">
            {differences.map((item) => {
              const words =
                item.unit === 'money'
                  ? describeDifference(item.value)?.words
                  : `${item.value.startsWith('-') ? 'Short by' : 'Over by'} ${formatLitres(item.value.replace('-', ''))}`;
              return (
                <li key={item.key}>
                  <div>
                    <strong>{item.label}</strong>
                    <span>
                      {item.unit === 'money' ? formatMoney(item.value) : formatLitres(item.value)}
                    </span>
                  </div>
                  <small>{words}</small>
                  <p>{item.explanation || 'No explanation was given.'}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="review-sections">
        <Section title="Team" meta={`${teamNames.length} on shift`}>
          {teamNames.length === 0 ? (
            <p className="review-clear">No one was recorded on this shift.</p>
          ) : (
            <ul className="review-list">
              {teamNames.map((person) => (
                <li key={person.id}>{person.name ?? 'Attendant'}</li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Pump readings" meta={`${record.readings.length} nozzles`}>
          <table className="responsive-table">
            <caption className="visually-hidden">Pump readings</caption>
            <thead>
              <tr>
                <th scope="col">Pump</th>
                <th scope="col">Opening</th>
                <th scope="col">Closing</th>
                <th scope="col">Litres</th>
                <th scope="col">Sales</th>
              </tr>
            </thead>
            <tbody>
              {record.readings.map((reading) => {
                const nozzle = nozzleOf(reading.nozzleId);
                return (
                  <tr key={reading.id}>
                    <td data-label="Pump">
                      {nozzle
                        ? `Pump ${nozzle.pumpNumber} · Nozzle ${nozzle.nozzleNumber} · ${nozzle.productName}`
                        : 'Nozzle'}
                    </td>
                    <td data-label="Opening" className="numeric">
                      {formatLitres(reading.openingReading)}
                    </td>
                    <td data-label="Closing" className="numeric">
                      {formatLitres(reading.closingReading)}
                    </td>
                    <td data-label="Litres" className="numeric">
                      {formatLitres(reading.litresSold)}
                    </td>
                    <td data-label="Sales" className="numeric">
                      {formatMoney(reading.salesValue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        <Section
          title="Payments"
          meta={formatMoney(record.totals.accountedSales)}
          open={!isZero(record.totals.salesVariance)}
          issue={!isZero(record.totals.salesVariance)}
        >
          {record.payments.length === 0 ? (
            <p className="review-clear">No payments were entered.</p>
          ) : (
            <ul className="review-list">
              {record.payments.map((payment) => (
                <li key={payment.id}>
                  <span>
                    {methodLabels[payment.method] ?? payment.method}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </span>
                  <strong>{formatMoney(payment.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Expenses" meta={`${record.expenses.length}`}>
          {record.expenses.length === 0 ? (
            <p className="review-clear">No expenses were paid out.</p>
          ) : (
            <ul className="review-list">
              {record.expenses.map((expense) => (
                <li key={expense.id}>
                  <span>
                    {expense.category} · {expense.description}
                  </span>
                  <strong>{formatMoney(expense.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Cash count"
          meta={record.cash ? formatMoney(record.cash.countedCash) : 'Not counted'}
          open={!isZero(record.totals.cashVariance)}
          issue={!isZero(record.totals.cashVariance)}
        >
          {record.cash ? (
            <dl className="summary-list">
              <div>
                <dt>Cash expected</dt>
                <dd>{formatMoney(record.cash.expectedPhysicalCash)}</dd>
              </div>
              <div>
                <dt>Paid out in cash</dt>
                <dd>{formatMoney(record.cash.cashPaidExpenses)}</dd>
              </div>
              <div>
                <dt>Expected after payouts</dt>
                <dd>{formatMoney(record.cash.netExpectedCash)}</dd>
              </div>
              <div>
                <dt>Counted</dt>
                <dd>{formatMoney(record.cash.countedCash)}</dd>
              </div>
              <div>
                <dt>Difference</dt>
                <dd>
                  {formatMoney(record.cash.cashVariance)}
                  {cashWords ? <small className="difference-words">{cashWords.words}</small> : null}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="review-clear">The cash was not counted.</p>
          )}
        </Section>

        <Section
          title="Stock"
          meta={`${record.deliveries.length} deliveries · ${record.dips.length} dips`}
          open={Object.values(record.totals.stockVariance).some((value) => !isZero(value))}
          issue={Object.values(record.totals.stockVariance).some((value) => !isZero(value))}
        >
          {record.deliveries.length === 0 && record.dips.length === 0 ? (
            <p className="review-clear">No deliveries or tank dips were recorded for this shift.</p>
          ) : (
            <ul className="review-list">
              {record.deliveries.map((delivery) => (
                <li key={delivery.deliveryId}>
                  <span>Delivery {delivery.deliveryNoteNumber}</span>
                  <strong>{formatLitres(delivery.actualQuantityLitres)}</strong>
                </li>
              ))}
              {record.dips.map((dip) => (
                <li key={dip.dipId}>
                  <span>Tank dip</span>
                  <strong>{formatLitres(dip.physicalLitres)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <InlineError error={error} onRetry={() => void load()} />

      <div className="review-action-bar" role="group" aria-label="Review actions">
        {mayDecide ? (
          <>
            <Button variant="danger" onClick={() => setSendingBack(true)} disabled={busy}>
              Send back
            </Button>
            <Button variant="primary" onClick={() => setApproving(true)} disabled={busy}>
              Approve
            </Button>
          </>
        ) : waiting ? (
          <p className="review-waiting">Waiting for a manager to approve.</p>
        ) : (
          <p className="review-waiting">{status.label}. No action needed.</p>
        )}
      </div>

      <ConfirmDialog
        open={approving}
        title="Approve these figures?"
        lines={[
          ...totalLines,
          { label: 'Submitted by', value: submittedSummary.by ?? '—' },
          { label: 'Submitted at', value: timeText ?? '—' },
        ]}
        confirmLabel="Approve"
        busy={busy}
        onConfirm={() => void decide('ApproveProductionReconciliation', {}, 'Approved')}
        onClose={() => setApproving(false)}
      />
      <ConfirmDialog
        open={sendingBack}
        title="Send back for correction?"
        confirmLabel="Send back"
        busy={busy}
        confirmDisabled={!reasonValid}
        onConfirm={() =>
          void decide(
            'ReturnProductionReconciliation',
            { reason: reason.trim() },
            'Returned for correction',
          )
        }
        onClose={() => setSendingBack(false)}
      >
        <Field
          id="return-reason"
          label="Return reason"
          hint={`Tell the attendant what to correct (at least ${MIN_EXPLANATION} characters).`}
          required
        >
          <textarea
            id="return-reason"
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function TotalCard({
  label,
  value,
  words,
  tone,
}: {
  label: string;
  value: string;
  words?: string | undefined;
  tone?: 'over' | 'short' | 'balanced' | undefined;
}) {
  return (
    <div className="review-total" data-tone={tone}>
      <span className="metric-label">{label}</span>
      <strong className="numeric">{value}</strong>
      {words ? <small>{words}</small> : null}
    </div>
  );
}

function Section({
  title,
  meta,
  open = false,
  issue = false,
  children,
}: {
  title: string;
  meta?: string;
  open?: boolean;
  issue?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="review-section" open={open} data-issue={issue || undefined}>
      <summary>
        <span>{title}</span>
        {meta ? <small>{meta}</small> : null}
      </summary>
      <div className="review-section-body">{children}</div>
    </details>
  );
}
