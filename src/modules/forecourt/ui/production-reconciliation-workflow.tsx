'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm, useToast } from '../../../design-system/feedback-provider';
import { TRANSITION_SUCCESS } from './transition-messages';
import { Button, Card, Field, StatusBadge } from '../../../design-system/primitives';
import { TableScrollRegion } from '../../../design-system/table';
import { formatMoney } from '../../../design-system/formatters';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import { missingReconciliationEvidence } from './production-reconciliation-state';

export type ProductionReconciliationContext = Readonly<{
  tenantId: string;
  stationId: string;
  businessDayId: string;
  shiftId: string;
  reconciliationId: string;
}>;

type RecordData = {
  state: string;
  version: number;
  /** The signed-in person submitted this day and someone else can approve it. */
  approvalBlocked?: boolean;
  canApprove?: boolean;
  canReturn?: boolean;
  requiresApproverNote?: boolean;
  business_date: string;
  attendants: Array<{ attendantId: string }>;
  readings: Array<{
    id: string;
    nozzleId: string;
    productId: string;
    shiftId: string;
    openingReading: string;
    closingReading: string;
    sellingPriceId: string;
    unitPrice: string;
    litresSold: string;
    salesValue: string;
  }>;
  payments: Array<{
    id: string;
    method: string;
    amount: string;
    reference: string | null;
    note: string | null;
  }>;
  expenses: Array<{
    id: string;
    category: string;
    description: string;
    amount: string;
    paymentMethod: string;
    personPaid: string | null;
    reference: string | null;
  }>;
  deliveries: Array<{
    deliveryId: string;
    deliveryNoteNumber: string;
    actualQuantityLitres: string;
  }>;
  dips: Array<{ dipId: string; tankId: string; physicalLitres: string }>;
  cash: { countedCash: string; netExpectedCash: string; cashVariance: string } | null;
  explanations: Array<{ category: string; explanation: string }>;
  approvalNote: string | null;
  totals: {
    expectedSales: string;
    accountedSales: string;
    salesVariance: string;
    cashVariance: string | null;
    stockVariance: Record<string, string>;
  };
};

type CommandResult = { version?: number; state?: string };
type CommandFailure = Error & { status?: number; code?: string };

type StepUpRetry = {
  commandType: string;
  extra: Record<string, unknown>;
};

function tone(state: string): 'locked' | 'warning' | 'pending' | 'informational' {
  if (state === 'APPROVED' || state === 'LOCKED') return 'locked';
  if (state === 'RETURNED') return 'warning';
  if (state === 'SUBMITTED') return 'pending';
  return 'informational';
}

function idempotencyKey(commandType: string, reconciliationId: string): string {
  return `ui-${commandType}-${reconciliationId}-${crypto.randomUUID()}`;
}

export function ProductionReconciliationWorkflow({
  context,
  role = 'SUPERVISOR',
}: {
  context: ProductionReconciliationContext;
  role?: 'SUPERVISOR' | 'MANAGEMENT';
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [record, setRecord] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [returnReason, setReturnReason] = useState('');
  const [cashCounted, setCashCounted] = useState('');
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [stepUpRetry, setStepUpRetry] = useState<StepUpRetry | null>(null);

  const endpoint = useMemo(
    () =>
      `/api/forecourt/reconciliations/${context.reconciliationId}?tenantId=${encodeURIComponent(context.tenantId)}&stationId=${encodeURIComponent(context.stationId)}`,
    [context.reconciliationId, context.stationId, context.tenantId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (response.status === 404) {
        setRecord(null);
        return;
      }
      const body = (await response.json()) as RecordData & { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'The reconciliation could not be loaded');
      setRecord(body);
      setCashCounted(body.cash?.countedCash ?? '');
      setExplanations(
        Object.fromEntries([
          ...body.explanations.map((item) => [item.category, item.explanation]),
          ...(body.approvalNote ? [['APPROVER_NOTE', body.approvalNote]] : []),
        ]),
      );
      setDirty(false);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reconciliation could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty]);

  async function command(commandType: string, values: Record<string, unknown>) {
    const response = await fetch('/api/forecourt/commands', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey(commandType, context.reconciliationId),
      },
      body: JSON.stringify({ commandType, ...values }),
    });
    const body = (await response.json().catch(() => ({}))) as CommandResult & {
      message?: string;
      error?: string;
    };
    if (!response.ok) {
      const failure = new Error(
        body.message ?? body.error ?? 'The command could not be completed',
      ) as CommandFailure;
      failure.status = response.status;
      failure.code = body.error;
      throw failure;
    }
    return body;
  }

  async function create() {
    setBusy(true);
    try {
      await command('CreateProductionReconciliation', {
        tenantId: context.tenantId,
        stationId: context.stationId,
        reconciliationId: context.reconciliationId,
        businessDayId: context.businessDayId,
        shiftId: context.shiftId,
        expectedVersion: 0,
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The draft could not be created');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!record) return;
    setBusy(true);
    try {
      let version = record.version;
      const common = {
        tenantId: context.tenantId,
        stationId: context.stationId,
        reconciliationId: context.reconciliationId,
      };
      const update = async (commandType: string, values: Record<string, unknown>) => {
        const result = await command(commandType, {
          ...common,
          expectedVersion: version,
          ...values,
        });
        version = result.version ?? version + 1;
      };
      await update('SaveMeterReadings', {
        readings: record.readings.map((reading) => ({
          id: reading.id,
          nozzleId: reading.nozzleId,
          productId: reading.productId,
          shiftId: reading.shiftId,
          openingReading: reading.openingReading,
          closingReading: reading.closingReading,
          sellingPriceId: reading.sellingPriceId,
        })),
      });
      await update('SavePaymentAllocations', {
        payments: record.payments.map((payment) => ({
          ...payment,
          reference: payment.reference ?? undefined,
          note: payment.note ?? undefined,
        })),
      });
      await update('SaveExpenses', {
        expenses: record.expenses.map((expense) => ({
          ...expense,
          personPaid: expense.personPaid ?? undefined,
          reference: expense.reference ?? undefined,
        })),
      });
      if (cashCounted.trim()) await update('SaveCashDeclaration', { countedCash: cashCounted });
      await update('SaveVarianceExplanations', {
        explanations: Object.fromEntries(
          Object.entries(explanations).filter(
            ([category, value]) => ['SALES', 'CASH', 'STOCK'].includes(category) && value.trim(),
          ),
        ),
      });
      setDirty(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The draft could not be saved');
    } finally {
      setBusy(false);
    }
  }

  async function transition(
    commandType: string,
    extra: Record<string, unknown> = {},
    skipConfirmation = false,
  ) {
    if (!record) return;
    if (dirty) {
      setError('Save the current draft before changing its workflow state.');
      return;
    }
    if (
      commandType === 'ApproveProductionReconciliation' &&
      !skipConfirmation &&
      !(await confirm({
        title: 'Approve this reconciliation?',
        consequence:
          'The sales will be recorded and this report will be locked. Mistakes can only be fixed by a reversal.',
        confirmLabel: 'Approve reconciliation',
        tone: 'warning',
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await command(commandType, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        reconciliationId: context.reconciliationId,
        expectedVersion: record.version,
        ...(commandType === 'ApproveProductionReconciliation'
          ? { approvalNote: explanations.APPROVER_NOTE?.trim() || undefined }
          : {}),
        ...extra,
      });
      await load();
      toast.success(TRANSITION_SUCCESS[commandType] ?? 'Workflow state updated.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      const failure = caught as CommandFailure;
      if (
        commandType === 'ApproveProductionReconciliation' &&
        failure.status === 403 &&
        failure.code === 'STEP_UP_REQUIRED'
      ) {
        setStepUpRetry({ commandType, extra });
      } else {
        setError(caught instanceof Error ? caught.message : 'The workflow transition failed');
      }
    } finally {
      setBusy(false);
    }
  }

  const editable = record?.state === 'DRAFT' || record?.state === 'RETURNED';
  const missingEvidence = record
    ? missingReconciliationEvidence({
        attendantsCount: record.attendants.length,
        salesVariance: record.totals.salesVariance,
        cashVariance: record.totals.cashVariance,
        stockVariance: record.totals.stockVariance,
        requiresApproverNote: Boolean(
          record.requiresApproverNote && role === 'MANAGEMENT' && record.state === 'SUBMITTED',
        ),
        explanations,
      })
    : [];
  if (loading) return <p role="status">Loading reconciliation…</p>;
  if (!record) {
    return (
      <Card as="section" className="panel" aria-labelledby="production-create-title">
        <p className="eyebrow">Reconciliation</p>
        <h1 id="production-create-title">Create shift reconciliation</h1>
        <p>
          This draft will be stored against the selected tenant, station, business day, and shift.
        </p>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button variant="primary" onClick={create} disabled={busy}>
          Create draft
        </Button>
      </Card>
    );
  }

  return (
    <div className="reconciliation-workflow" aria-label="Daily reconciliation workflow">
      <div className="page-header">
        <div>
          <p className="eyebrow">Daily reconciliation</p>
          <h1>Shift reconciliation · {record.business_date}</h1>
          <p className="lede">
            All totals are recomputed on the server from persisted meter, payment, cash, delivery,
            and dip evidence.
          </p>
        </div>
        <StatusBadge tone={tone(record.state)}>{record.state}</StatusBadge>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="content-grid">
        <Card as="section" className="panel" aria-labelledby="production-summary-title">
          <p className="eyebrow">Shift and team</p>
          <h2 id="production-summary-title">Persisted evidence</h2>
          <dl className="operational-summary">
            <div>
              <dt>Attendants</dt>
              <dd>{record.attendants.length}</dd>
            </div>
            <div>
              <dt>Meter readings</dt>
              <dd>{record.readings.length}</dd>
            </div>
            <div>
              <dt>Deliveries linked</dt>
              <dd>{record.deliveries.length}</dd>
            </div>
            <div>
              <dt>Tank dips linked</dt>
              <dd>{record.dips.length}</dd>
            </div>
          </dl>
        </Card>
        <Card as="section" className="panel" aria-labelledby="production-meter-title">
          <p className="eyebrow">Meter readings</p>
          <h2 id="production-meter-title">Server-derived sales</h2>
          <TableScrollRegion label="Persisted meter readings table">
            <table className="responsive-table">
              <caption className="visually-hidden">Persisted meter readings</caption>
              <thead>
                <tr>
                  <th scope="col">Nozzle</th>
                  <th scope="col">Opening</th>
                  <th scope="col">Closing</th>
                  <th scope="col">Litres</th>
                  <th scope="col">Sales</th>
                </tr>
              </thead>
              <tbody>
                {record.readings.map((reading) => (
                  <tr key={reading.id}>
                    <td data-label="Nozzle">{reading.nozzleId}</td>
                    <td data-label="Opening" className="numeric">
                      {reading.openingReading}
                    </td>
                    <td data-label="Closing" className="numeric">
                      {reading.closingReading}
                    </td>
                    <td data-label="Litres" className="numeric">
                      {reading.litresSold}
                    </td>
                    <td data-label="Sales" className="numeric">
                      {formatMoney(reading.salesValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        </Card>
        <Card as="section" className="panel" aria-labelledby="production-totals-title">
          <p className="eyebrow">Payments and stock</p>
          <h2 id="production-totals-title">Control totals</h2>
          <dl className="operational-summary">
            <div>
              <dt>Expected sales</dt>
              <dd className="numeric">{formatMoney(record.totals.expectedSales)}</dd>
            </div>
            <div>
              <dt>Accounted sales</dt>
              <dd className="numeric">{formatMoney(record.totals.accountedSales)}</dd>
            </div>
            <div>
              <dt>Sales variance</dt>
              <dd className="numeric">{formatMoney(record.totals.salesVariance)}</dd>
            </div>
            <div>
              <dt>Cash variance</dt>
              <dd className="numeric">
                {record.totals.cashVariance === null
                  ? 'Not counted'
                  : formatMoney(record.totals.cashVariance)}
              </dd>
            </div>
          </dl>
        </Card>
        <Card as="section" className="panel" aria-labelledby="production-cash-title">
          <p className="eyebrow">Cash and explanation</p>
          <h2 id="production-cash-title">Supervisor declaration</h2>
          <Field
            id="production-cash-counted"
            label="Cash counted"
            hint="Recomputed against persisted cash payments and cash-paid expenses."
          >
            <input
              id="production-cash-counted"
              inputMode="decimal"
              value={cashCounted}
              onChange={(event) => {
                setDirty(true);
                setCashCounted(event.target.value);
              }}
              disabled={!editable}
            />
          </Field>
          <Field
            id="production-explanation-sales"
            label="Sales variance explanation"
            hint="Explain any difference between meter sales and payment allocations."
          >
            <textarea
              id="production-explanation-sales"
              rows={2}
              value={explanations.SALES ?? ''}
              onChange={(event) => {
                setDirty(true);
                setExplanations((current) => ({ ...current, SALES: event.target.value }));
              }}
              disabled={!editable}
            />
          </Field>
          <Field id="production-explanation-cash" label="Cash variance explanation">
            <textarea
              id="production-explanation-cash"
              rows={2}
              value={explanations.CASH ?? ''}
              onChange={(event) => {
                setDirty(true);
                setExplanations((current) => ({ ...current, CASH: event.target.value }));
              }}
              disabled={!editable}
            />
          </Field>
          <Field id="production-explanation-stock" label="Stock variance explanation">
            <textarea
              id="production-explanation-stock"
              rows={2}
              value={explanations.STOCK ?? ''}
              onChange={(event) => {
                setDirty(true);
                setExplanations((current) => ({ ...current, STOCK: event.target.value }));
              }}
              disabled={!editable}
            />
          </Field>
          {record.requiresApproverNote ? (
            <Field
              id="production-approver-note"
              label="Approver note for red variance"
              hint="Management must record why this red variance is accepted or what follow-up is required."
            >
              <textarea
                id="production-approver-note"
                rows={2}
                value={explanations.APPROVER_NOTE ?? ''}
                onChange={(event) => {
                  setExplanations((current) => ({ ...current, APPROVER_NOTE: event.target.value }));
                }}
                disabled={!(role === 'MANAGEMENT' && record.state === 'SUBMITTED')}
              />
            </Field>
          ) : null}
        </Card>
      </div>
      <Card as="section" className="panel" aria-labelledby="production-review-title">
        <p className="eyebrow">Workflow control</p>
        <h2 id="production-review-title">Version {record.version}</h2>
        <div className="form-actions">
          {editable ? (
            <Button variant="secondary" onClick={save} disabled={busy}>
              Save persisted draft
            </Button>
          ) : null}
          {role === 'SUPERVISOR' && editable ? (
            <Button
              variant="primary"
              onClick={() => void transition('SubmitProductionReconciliation')}
              disabled={busy || missingEvidence.length > 0}
            >
              Submit for management review
            </Button>
          ) : null}
          {role === 'MANAGEMENT' && record.state === 'SUBMITTED' ? (
            <>
              {record.canReturn === true ? (
                <Button
                  variant="danger"
                  onClick={() =>
                    void transition('ReturnProductionReconciliation', { reason: returnReason })
                  }
                  disabled={busy || returnReason.trim().length < 5}
                >
                  Return for correction
                </Button>
              ) : null}
              {record.canApprove !== true || record.approvalBlocked ? null : (
                <Button
                  variant="primary"
                  onClick={() => void transition('ApproveProductionReconciliation')}
                  disabled={busy || missingEvidence.length > 0}
                >
                  Approve reconciliation
                </Button>
              )}
            </>
          ) : null}
        </div>
        {missingEvidence.length > 0 && (editable || record.state === 'SUBMITTED') ? (
          <p className="state" role="status">
            Before this workflow step can continue, add: {missingEvidence.join(', ')}.
          </p>
        ) : null}
        {role === 'MANAGEMENT' && record.state === 'SUBMITTED' && record.approvalBlocked ? (
          <p className="state" role="status">
            You submitted this day, so someone else needs to approve it.
          </p>
        ) : null}
        {role === 'MANAGEMENT' && record.state === 'SUBMITTED' && record.canReturn === true ? (
          <Field id="production-return-reason" label="Return reason">
            <textarea
              id="production-return-reason"
              rows={2}
              minLength={5}
              required
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
            />
          </Field>
        ) : null}
        {record.state === 'APPROVED' ? (
          <p className="state state-success" role="status">
            Approved records have posted canonical sale evidence. Further changes require a named
            correction workflow.
          </p>
        ) : null}
        {record.state === 'LOCKED' ? (
          <p className="state state-success" role="status">
            Locked records cannot be edited. Corrections require a named correction workflow.
          </p>
        ) : null}
      </Card>
      <StepUpDialog
        open={stepUpRetry !== null}
        tenantId={context.tenantId}
        description="Approving this reconciliation needs a fresh identity check. Nothing is posted until you confirm."
        confirmLabel="Confirm and approve"
        onCancel={() => setStepUpRetry(null)}
        onVerified={() => {
          const retry = stepUpRetry;
          setStepUpRetry(null);
          if (retry) void transition(retry.commandType, retry.extra, true);
        }}
      />
    </div>
  );
}
