'use client';

import { ReconciliationApprovalButton } from './reconciliation-approval-button';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, StatusBadge } from '../../../design-system/primitives';
import { TableScrollRegion } from '../../../design-system/table';

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
  totals: {
    expectedSales: string;
    accountedSales: string;
    salesVariance: string;
    cashVariance: string | null;
    stockVariance: Record<string, string>;
  };
};

type CommandResult = { version?: number; state?: string };

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
  const [record, setRecord] = useState<RecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [returnReason, setReturnReason] = useState('');
  const [cashCounted, setCashCounted] = useState('');
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

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
        Object.fromEntries(body.explanations.map((item) => [item.category, item.explanation])),
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
    const body = (await response.json()) as CommandResult & { message?: string };
    if (!response.ok) throw new Error(body.message ?? 'The command could not be completed');
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
          Object.entries(explanations).filter(([, value]) => value.trim()),
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

  async function transition(commandType: string, extra: Record<string, unknown> = {}) {
    if (!record) return;
    if (dirty) {
      setError('Save the current draft before changing its workflow state.');
      return;
    }
    if (
      commandType === 'ApproveProductionReconciliation' &&
      !window.confirm(
        'Approve this production reconciliation? The server will post canonical sale evidence and the record cannot be edited afterwards.',
      )
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
        ...extra,
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The workflow transition failed');
    } finally {
      setBusy(false);
    }
  }

  const editable = record?.state === 'DRAFT' || record?.state === 'RETURNED';
  if (loading) return <p role="status">Loading reconciliation…</p>;
  if (!record) {
    return (
      <Card as="section" className="panel" aria-labelledby="production-create-title">
        <p className="eyebrow">Production reconciliation</p>
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
    <div className="reconciliation-workflow" aria-label="Production daily reconciliation workflow">
      <div className="page-header">
        <div>
          <p className="eyebrow">Production daily reconciliation</p>
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
                      {reading.salesValue} USD
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
              <dd className="numeric">{record.totals.expectedSales} USD</dd>
            </div>
            <div>
              <dt>Accounted sales</dt>
              <dd className="numeric">{record.totals.accountedSales} USD</dd>
            </div>
            <div>
              <dt>Sales variance</dt>
              <dd className="numeric">{record.totals.salesVariance} USD</dd>
            </div>
            <div>
              <dt>Cash variance</dt>
              <dd className="numeric">{record.totals.cashVariance ?? 'not counted'} USD</dd>
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
            id="production-explanation"
            label="Variance explanation"
            hint="Use a category-specific explanation when a server-derived variance is non-zero."
          >
            <textarea
              id="production-explanation"
              rows={3}
              value={explanations.SALES ?? ''}
              onChange={(event) => {
                setDirty(true);
                setExplanations((current) => ({ ...current, SALES: event.target.value }));
              }}
              disabled={!editable}
            />
          </Field>
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
              disabled={busy}
            >
              Submit for management review
            </Button>
          ) : null}
          {role === 'MANAGEMENT' && record.state === 'SUBMITTED' ? (
            <>
              <Button
                variant="danger"
                onClick={() =>
                  void transition('ReturnProductionReconciliation', { reason: returnReason })
                }
                disabled={busy || !returnReason.trim()}
              >
                Return for correction
              </Button>
              <ReconciliationApprovalButton
                key={`${context.tenantId}:${context.reconciliationId}`}
                tenantId={context.tenantId}
                disabled={busy}
                onVerified={() => void transition('ApproveProductionReconciliation')}
              />
            </>
          ) : null}
        </div>
        {role === 'MANAGEMENT' && record.state === 'SUBMITTED' ? (
          <Field id="production-return-reason" label="Return reason">
            <textarea
              id="production-return-reason"
              rows={2}
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
    </div>
  );
}
