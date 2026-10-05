'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  NumericInput,
  StatusBadge,
} from '../../../design-system/primitives';
import { MetricCard } from '../../../design-system/layout';
import { TableScrollRegion } from '../../../design-system/table';
import {
  formatBusinessDate,
  formatLitres,
  formatMoney,
  formatStatusLabel,
} from '../../../design-system/formatters';
import {
  dailyOperationsStatusLabel,
  dailyOperationsStatusTone,
  isEditableDailyOperationsState,
  mapDailyOperationsError,
} from './daily-operations-state';
import {
  createDraftSaveAttemptId,
  draftSaveCommandKey,
  type DraftSaveJournal,
} from './daily-operations-save';

export type DailyOperationsContext = Readonly<{
  tenantId: string;
  stationId: string;
  businessDayId: string;
  shiftId: string;
  reconciliationId?: string;
}>;

type AvailableReading = {
  nozzleId: string;
  pumpNumber: string;
  nozzleNumber: string;
  productId: string;
  productCode: string;
  productName: string;
  meterInstallationId: string | null;
  sellingPriceId: string | null;
  unitPrice: string | null;
  previousReading: string | null;
};

type OperationsContext = {
  station: { id: string; code: string; name: string; timezone: string };
  organisation: { id: string; name: string };
  businessDay: { id: string; date: string; state: string; version: number };
  shift: {
    id: string;
    state: string;
    businessDate: string;
    plannedStartAt: string;
    plannedEndAt: string;
    version: number;
  };
  attendants: Array<{ id: string; name: string; email: string }>;
  availableReadings: AvailableReading[];
};

type Reading = {
  id?: string;
  nozzleId: string;
  productId: string;
  shiftId: string;
  openingReading: string;
  closingReading: string;
  sellingPriceId: string;
  unitPrice?: string;
  litresSold?: string;
  salesValue?: string;
  label?: string;
};

type Payment = {
  id?: string;
  method: PaymentMethod;
  amount: string;
  reference: string;
  note: string;
};

type Expense = {
  id?: string;
  category: string;
  description: string;
  amount: string;
  paymentMethod: PaymentMethod;
  personPaid: string;
  reference: string;
};

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
  cash: {
    countedCash: string;
    expectedPhysicalCash: string;
    cashPaidExpenses: string;
    netExpectedCash: string;
    cashVariance: string;
  } | null;
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
type PaymentMethod =
  | 'CASH'
  | 'POS'
  | 'ECOCASH'
  | 'BANK_TRANSFER'
  | 'CUSTOMER_CREDIT'
  | 'PREPAID'
  | 'STAFF_OR_MANAGEMENT_FUEL'
  | 'OTHER_APPROVED';

const paymentMethods: readonly PaymentMethod[] = [
  'CASH',
  'POS',
  'ECOCASH',
  'BANK_TRANSFER',
  'CUSTOMER_CREDIT',
  'PREPAID',
  'STAFF_OR_MANAGEMENT_FUEL',
  'OTHER_APPROVED',
];

function newRowKey(): string {
  return crypto.randomUUID();
}

function paymentFromRecord(payment: RecordData['payments'][number]): Payment & { rowKey: string } {
  return {
    rowKey: payment.id || newRowKey(),
    id: payment.id,
    method: payment.method as PaymentMethod,
    amount: payment.amount,
    reference: payment.reference ?? '',
    note: payment.note ?? '',
  };
}

function expenseFromRecord(expense: RecordData['expenses'][number]): Expense & { rowKey: string } {
  return {
    rowKey: expense.id || newRowKey(),
    id: expense.id,
    category: expense.category,
    description: expense.description,
    amount: expense.amount,
    paymentMethod: expense.paymentMethod as PaymentMethod,
    personPaid: expense.personPaid ?? '',
    reference: expense.reference ?? '',
  };
}

function readingFromContext(
  reading: AvailableReading,
  shiftId: string,
): Reading & { rowKey: string } {
  return {
    rowKey: reading.nozzleId,
    nozzleId: reading.nozzleId,
    productId: reading.productId,
    shiftId,
    openingReading: reading.previousReading ?? '',
    closingReading: '',
    sellingPriceId: reading.sellingPriceId ?? '',
    unitPrice: reading.unitPrice ?? undefined,
    label: `Pump ${reading.pumpNumber} · nozzle ${reading.nozzleNumber} · ${reading.productName}`,
  };
}

function errorFromResponse(status: number, body: unknown): Error {
  const result = body as { error?: string; message?: string };
  return new Error(mapDailyOperationsError(status, result.error, result.message));
}

function isZero(value: string | null | undefined): boolean {
  return value === null || value === undefined || /^-?0(?:\.0+)?$/.test(value);
}

function SectionHeading({
  eyebrow,
  title,
  detail,
  headingId,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  headingId: string;
}) {
  return (
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={headingId}>{title}</h2>
        {detail ? <p className="panel-detail">{detail}</p> : null}
      </div>
    </div>
  );
}

export function DailyOperationsWorkspace({
  context,
  role = 'SUPERVISOR',
}: {
  context: DailyOperationsContext;
  role?: 'SUPERVISOR' | 'MANAGEMENT';
}) {
  const [activeReconciliationId, setActiveReconciliationId] = useState(context.reconciliationId);
  const [operation, setOperation] = useState<OperationsContext | null>(null);
  const [record, setRecord] = useState<RecordData | null>(null);
  const [readings, setReadings] = useState<Array<Reading & { rowKey: string }>>([]);
  const [payments, setPayments] = useState<Array<Payment & { rowKey: string }>>([]);
  const [expenses, setExpenses] = useState<Array<Expense & { rowKey: string }>>([]);
  const [attendantIds, setAttendantIds] = useState<string[]>([]);
  const [cashCounted, setCashCounted] = useState('');
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const saveJournal = useRef<DraftSaveJournal | undefined>(undefined);
  const [cashSummary, setCashSummary] = useState<{
    availableAtStation: string;
    collectedButUnbanked: string;
    pendingBankConfirmation: string;
  }>();
  const [settlementSummary, setSettlementSummary] = useState<
    Array<{ providerName: string; state: string; unallocatedProviderAmount: string }>
  >([]);

  const contextQuery = useMemo(
    () =>
      new URLSearchParams({
        tenantId: context.tenantId,
        stationId: context.stationId,
        businessDayId: context.businessDayId,
        shiftId: context.shiftId,
      }),
    [context.businessDayId, context.shiftId, context.stationId, context.tenantId],
  );

  const syncDraft = useCallback(
    (next: RecordData | null, nextOperation: OperationsContext) => {
      if (!next) {
        setReadings(
          nextOperation.availableReadings.map((reading) =>
            readingFromContext(reading, context.shiftId),
          ),
        );
        setPayments([]);
        setExpenses([]);
        setAttendantIds([]);
        setCashCounted('');
        setExplanations({});
        return;
      }
      const nextReadings = next.readings.length
        ? next.readings.map((reading) => ({ ...reading, rowKey: reading.id }))
        : nextOperation.availableReadings.map((reading) =>
            readingFromContext(reading, context.shiftId),
          );
      setReadings(nextReadings);
      setPayments(next.payments.map(paymentFromRecord));
      setExpenses(next.expenses.map(expenseFromRecord));
      setAttendantIds(next.attendants.map((attendant) => attendant.attendantId));
      setCashCounted(next.cash?.countedCash ?? '');
      setExplanations(
        Object.fromEntries(next.explanations.map((item) => [item.category, item.explanation])),
      );
      setDirty(false);
    },
    [context.shiftId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    setConflict(false);
    try {
      const operationResponse = await fetch(
        `/api/forecourt/operations/daily?${contextQuery.toString()}`,
        {
          cache: 'no-store',
        },
      );
      const operationBody = await operationResponse.json();
      if (!operationResponse.ok) throw errorFromResponse(operationResponse.status, operationBody);
      const nextOperation = operationBody as OperationsContext;
      setOperation(nextOperation);

      if (!activeReconciliationId) {
        setRecord(null);
        syncDraft(null, nextOperation);
        return;
      }

      const recordResponse = await fetch(
        `/api/forecourt/reconciliations/${activeReconciliationId}?tenantId=${encodeURIComponent(context.tenantId)}&stationId=${encodeURIComponent(context.stationId)}`,
        { cache: 'no-store' },
      );
      if (recordResponse.status === 404) {
        setRecord(null);
        syncDraft(null, nextOperation);
        return;
      }
      const recordBody = await recordResponse.json();
      if (!recordResponse.ok) throw errorFromResponse(recordResponse.status, recordBody);
      const nextRecord = recordBody as RecordData;
      setRecord(nextRecord);
      syncDraft(nextRecord, nextOperation);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The operations workspace could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [activeReconciliationId, context.stationId, context.tenantId, contextQuery, syncDraft]);

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

  useEffect(() => {
    if (!operation) return;
    const controller = new AbortController();
    void Promise.all([
      fetch(
        `/api/cash/summary?tenantId=${encodeURIComponent(context.tenantId)}&stationId=${encodeURIComponent(context.stationId)}`,
        {
          cache: 'no-store',
          signal: controller.signal,
        },
      ).then(async (response) => (response.ok ? response.json() : null)),
      fetch(
        `/api/settlements/summary?tenantId=${encodeURIComponent(context.tenantId)}&stationId=${encodeURIComponent(context.stationId)}`,
        {
          cache: 'no-store',
          signal: controller.signal,
        },
      ).then(async (response) => (response.ok ? response.json() : [])),
    ])
      .then(([cash, settlements]) => {
        if (controller.signal.aborted) return;
        setCashSummary(cash?.totals);
        setSettlementSummary(Array.isArray(settlements) ? settlements : []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [context.stationId, context.tenantId, operation]);

  async function sendCommand(
    commandType: string,
    values: Record<string, unknown>,
    idempotencyKey = `ui-${commandType}-${activeReconciliationId ?? 'new'}-${crypto.randomUUID()}`,
  ): Promise<CommandResult> {
    const response = await fetch('/api/forecourt/commands', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ commandType, ...values }),
    });
    const body = await response.json();
    if (!response.ok) throw errorFromResponse(response.status, body);
    return body as CommandResult;
  }

  async function createDraft() {
    setBusy(true);
    setError(undefined);
    const reconciliationId = activeReconciliationId ?? crypto.randomUUID();
    try {
      await sendCommand('CreateProductionReconciliation', {
        tenantId: context.tenantId,
        stationId: context.stationId,
        reconciliationId,
        businessDayId: context.businessDayId,
        shiftId: context.shiftId,
        expectedVersion: 0,
      });
      setActiveReconciliationId(reconciliationId);
      const url = new URL(window.location.href);
      url.searchParams.set('reconciliationId', reconciliationId);
      window.history.replaceState({}, '', url);
      await load();
      setNotice('Draft created. Enter evidence and save when ready.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The draft could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!record || !operation) return;
    if (readings.some((reading) => !reading.sellingPriceId)) {
      setError('A current active selling price is required for every meter row before saving.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const common = {
        tenantId: context.tenantId,
        stationId: context.stationId,
        reconciliationId: activeReconciliationId,
      };
      if (dirty || !saveJournal.current) {
        saveJournal.current = {
          saveAttemptId: createDraftSaveAttemptId(),
          commands: [
            { commandType: 'SetAttendants', values: { attendantIds } },
            {
              commandType: 'SaveMeterReadings',
              values: {
                readings: readings.map(
                  ({
                    rowKey: _rowKey,
                    label: _label,
                    unitPrice: _unitPrice,
                    litresSold: _litresSold,
                    salesValue: _salesValue,
                    ...reading
                  }) => reading,
                ),
              },
            },
            {
              commandType: 'SavePaymentAllocations',
              values: {
                payments: payments.map(({ rowKey: _rowKey, ...payment }) => ({
                  ...payment,
                  reference: payment.reference || undefined,
                  note: payment.note || undefined,
                })),
              },
            },
            {
              commandType: 'SaveExpenses',
              values: {
                expenses: expenses.map(({ rowKey: _rowKey, ...expense }) => ({
                  ...expense,
                  personPaid: expense.personPaid || undefined,
                  reference: expense.reference || undefined,
                })),
              },
            },
            ...(cashCounted.trim()
              ? [
                  {
                    commandType: 'SaveCashDeclaration',
                    values: { countedCash: cashCounted.trim() },
                  },
                ]
              : []),
            {
              commandType: 'SaveVarianceExplanations',
              values: {
                explanations: Object.fromEntries(
                  Object.entries(explanations).filter(([, explanation]) => explanation.trim()),
                ),
              },
            },
          ],
          nextIndex: 0,
          version: record.version,
        };
      }
      const journal = saveJournal.current;
      if (!journal) throw new Error('The draft save could not be prepared. Refresh and try again.');
      for (let index = journal.nextIndex; index < journal.commands.length; index += 1) {
        const command = journal.commands[index];
        if (!command) continue;
        const key = draftSaveCommandKey({
          reconciliationId: activeReconciliationId ?? 'new',
          saveAttemptId: journal.saveAttemptId,
          commandIndex: index,
          commandType: command.commandType,
        });
        const result = await sendCommand(
          command.commandType,
          { ...common, expectedVersion: journal.version, ...command.values },
          key,
        );
        journal.version = result.version ?? journal.version + 1;
        journal.nextIndex = index + 1;
      }
      saveJournal.current = undefined;
      setDirty(false);
      setNotice('Draft saved to the server.');
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The draft could not be saved.';
      setError(message);
      if (message.includes('changed elsewhere') || message.includes('locked')) setConflict(true);
      saveJournal.current = undefined;
      await load();
      setError(message);
      setNotice(
        'The save attempt was abandoned after reloading the canonical draft. Review the evidence, edit if needed, and start a new save.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function startShift() {
    setBusy(true);
    setError(undefined);
    try {
      await sendCommand('StartShift', {
        tenantId: context.tenantId,
        stationId: context.stationId,
        businessDayId: context.businessDayId,
        shiftId: context.shiftId,
        expectedVersion: operation?.shift.version ?? 0,
        plannedStartAt: operation?.shift.plannedStartAt,
        plannedEndAt: operation?.shift.plannedEndAt,
      });
      await load();
      setNotice('Shift opened using the canonical shift lifecycle.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The shift could not be opened.');
    } finally {
      setBusy(false);
    }
  }

  async function transition(commandType: string, values: Record<string, unknown> = {}) {
    if (!record || dirty) {
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
    setError(undefined);
    try {
      await sendCommand(commandType, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        reconciliationId: activeReconciliationId,
        expectedVersion: record.version,
        ...values,
      });
      await load();
      setNotice(
        commandType === 'ApproveProductionReconciliation'
          ? 'Reconciliation approved and locked.'
          : 'Workflow state updated.',
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The workflow transition failed.';
      setError(message);
      if (message.includes('changed elsewhere') || message.includes('locked')) setConflict(true);
    } finally {
      setBusy(false);
    }
  }

  const editable = isEditableDailyOperationsState(record?.state);
  const state = record?.state ?? 'NOT_STARTED';
  const requiresSalesExplanation = record ? !isZero(record.totals.salesVariance) : false;
  const requiresCashExplanation = record ? !isZero(record.totals.cashVariance) : false;
  const requiresStockExplanation = record
    ? Object.values(record.totals.stockVariance).some((value) => !isZero(value))
    : false;

  if (loading) return <LoadingState label="Loading daily operations" />;
  if (error && !operation) {
    return (
      <ErrorState
        title="Operations unavailable"
        message={error}
        action={<Button onClick={() => void load()}>Retry</Button>}
      />
    );
  }
  if (!operation) return null;

  if (!record) {
    return (
      <div className="daily-operations-workspace" aria-label="Daily station operations workspace">
        <div className="page-header">
          <div>
            <p className="lede">
              {operation.station.name} · {formatBusinessDate(operation.businessDay.date)} ·{' '}
              {formatStatusLabel(operation.shift.state)} shift
            </p>
          </div>
          <StatusBadge tone={dailyOperationsStatusTone(operation.shift.state)}>
            {formatStatusLabel(operation.shift.state)}
          </StatusBadge>
        </div>
        {error ? (
          <ErrorState message={error} action={<Button onClick={() => void load()}>Retry</Button>} />
        ) : null}
        <Card
          as="section"
          className="panel operations-start-card"
          aria-labelledby="operations-start-title"
        >
          <SectionHeading
            eyebrow="Business day and shift"
            title="Open or continue the station day"
            headingId="operations-start-title"
            detail="The workspace will create a server draft tied to this tenant, station, business date, and shift."
          />
          <dl className="operational-summary">
            <div>
              <dt>Organisation</dt>
              <dd>{operation.organisation.name}</dd>
            </div>
            <div>
              <dt>Station</dt>
              <dd>
                {operation.station.code} · {operation.station.name}
              </dd>
            </div>
            <div>
              <dt>Business day</dt>
              <dd>
                {formatBusinessDate(operation.businessDay.date)} ·{' '}
                {formatStatusLabel(operation.businessDay.state)}
              </dd>
            </div>
            <div>
              <dt>Shift</dt>
              <dd>{formatStatusLabel(operation.shift.state)}</dd>
            </div>
          </dl>
          <p className="panel-detail">
            No client-side totals are created here. Meter sales, payment variance, cash variance,
            and inventory context will be recalculated by the server.
          </p>
          {operation.shift.state === 'PLANNED' ? (
            <Button variant="secondary" onClick={() => void startShift()} loading={busy}>
              Open planned shift
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void createDraft()} loading={busy}>
            Create daily draft
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="daily-operations-workspace" aria-label="Daily station operations workspace">
      <div className="page-header">
        <div>
          <p className="lede">
            {operation.station.name} · {formatBusinessDate(record.business_date)} · shift evidence
            in one place
          </p>
        </div>
        <div className="workspace-status">
          <StatusBadge tone={dailyOperationsStatusTone(state)}>
            {dailyOperationsStatusLabel(state)}
          </StatusBadge>
          {dirty ? (
            <span className="dirty-indicator">Unsaved changes</span>
          ) : (
            <span className="saved-indicator">Server draft current</span>
          )}
        </div>
      </div>

      {error ? (
        <ErrorState
          title={conflict ? 'Refresh required' : 'Action needs attention'}
          message={error}
          action={<Button onClick={() => void load()}>Refresh workspace</Button>}
        />
      ) : null}
      {notice ? (
        <div className="state state-success" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

      <nav className="operations-steps" aria-label="Daily workflow sections">
        {['Shift', 'Meters', 'Evidence', 'Cash', 'Review'].map((label, index) => (
          <a key={label} href={`#operations-${label.toLowerCase()}`}>
            <span>{index + 1}</span>
            {label}
          </a>
        ))}
      </nav>

      <section
        className="metric-grid operations-metrics"
        aria-label="Server-derived control totals"
      >
        <MetricCard
          label="Expected sales"
          value={formatMoney(record.totals.expectedSales)}
          meta="From meter readings"
          href="#operations-meters"
        />
        <MetricCard
          label="Accounted sales"
          value={formatMoney(record.totals.accountedSales)}
          meta="Payment evidence"
          href="#operations-evidence"
        />
        <MetricCard
          label="Sales variance"
          value={formatMoney(record.totals.salesVariance)}
          meta="Explain if non-zero"
          href="#operations-review"
        />
      </section>

      <div className="operations-layout">
        <div className="operations-main">
          <Card
            as="section"
            className="panel"
            id="operations-shift"
            aria-labelledby="operations-shift-title"
          >
            <SectionHeading
              eyebrow="1 · Business day and shift"
              title="Station context"
              headingId="operations-shift-title"
              detail="Scope is confirmed by the server for every request."
            />
            <div className="context-grid">
              <div>
                <span className="metric-label">Business date</span>
                <strong>{formatBusinessDate(operation.businessDay.date)}</strong>
                <span className="metric-meta">
                  {formatStatusLabel(operation.businessDay.state)}
                </span>
              </div>
              <div>
                <span className="metric-label">Shift</span>
                <strong>{formatStatusLabel(operation.shift.state)}</strong>
                <span className="metric-meta">
                  {new Date(operation.shift.plannedStartAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  –{' '}
                  {new Date(operation.shift.plannedEndAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div>
                <span className="metric-label">Revision</span>
                <strong>v{record.version}</strong>
                <span className="metric-meta">Optimistic concurrency</span>
              </div>
            </div>
            <fieldset className="attendant-fieldset" disabled={!editable}>
              <legend>Attendants assigned to this reconciliation</legend>
              {operation.attendants.length === 0 ? (
                <p className="panel-detail">
                  No eligible attendants are available in this station scope.
                </p>
              ) : (
                <div className="choice-grid">
                  {operation.attendants.map((attendant) => (
                    <label className="choice-card" key={attendant.id}>
                      <input
                        type="checkbox"
                        checked={attendantIds.includes(attendant.id)}
                        onChange={(event) => {
                          setDirty(true);
                          setAttendantIds((current) =>
                            event.target.checked
                              ? [...current, attendant.id]
                              : current.filter((id) => id !== attendant.id),
                          );
                        }}
                      />
                      <span>
                        <strong>{attendant.name}</strong>
                        <small>{attendant.email}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </Card>

          <Card
            as="section"
            className="panel"
            id="operations-meters"
            aria-labelledby="operations-meters-title"
          >
            <SectionHeading
              eyebrow="2 · Meter readings"
              title="Capture meter evidence"
              headingId="operations-meters-title"
              detail="Enter opening and closing readings. Litres and sales remain server-derived."
            />
            {readings.length === 0 ? (
              <EmptyState
                title="No active nozzles available"
                message="Station meter setup is required before readings can be entered."
              />
            ) : (
              <div className="meter-list">
                {readings.map((reading, index) => {
                  const contextReading = operation.availableReadings.find(
                    (item) => item.nozzleId === reading.nozzleId,
                  );
                  return (
                    <article className="meter-card" key={reading.rowKey}>
                      <div className="meter-card-heading">
                        <div>
                          <span className="eyebrow">
                            Nozzle {contextReading?.nozzleNumber ?? index + 1}
                          </span>
                          <h3>
                            {reading.label ?? contextReading?.productName ?? reading.nozzleId}
                          </h3>
                        </div>
                        {reading.salesValue ? (
                          <StatusBadge tone="informational">
                            {formatMoney(reading.salesValue)}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">Awaiting readings</StatusBadge>
                        )}
                      </div>
                      <div className="form-grid">
                        <NumericInput
                          id={`opening-${reading.rowKey}`}
                          label="Opening reading"
                          value={reading.openingReading}
                          onChange={(event) => {
                            setDirty(true);
                            setReadings((current) =>
                              current.map((item) =>
                                item.rowKey === reading.rowKey
                                  ? { ...item, openingReading: event.target.value }
                                  : item,
                              ),
                            );
                          }}
                          unit="L"
                          disabled={!editable}
                        />
                        <NumericInput
                          id={`closing-${reading.rowKey}`}
                          label="Closing reading"
                          value={reading.closingReading}
                          onChange={(event) => {
                            setDirty(true);
                            setReadings((current) =>
                              current.map((item) =>
                                item.rowKey === reading.rowKey
                                  ? { ...item, closingReading: event.target.value }
                                  : item,
                              ),
                            );
                          }}
                          unit="L"
                          disabled={!editable}
                        />
                        <div className="derived-value">
                          <span className="metric-label">Server litres sold</span>
                          <strong className="numeric">
                            {reading.litresSold ? formatLitres(reading.litresSold) : '—'}
                          </strong>
                          <span className="metric-meta">
                            Active price{' '}
                            {reading.unitPrice ? formatMoney(reading.unitPrice) : 'unavailable'}
                          </span>
                        </div>
                      </div>
                      {!reading.sellingPriceId ? (
                        <p className="field-error" role="alert">
                          No active selling price is available for this product.
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </Card>

          <Card
            as="section"
            className="panel"
            id="operations-evidence"
            aria-labelledby="operations-evidence-title"
          >
            <SectionHeading
              eyebrow="3 · Payment evidence"
              title="Account for sales"
              headingId="operations-evidence-title"
              detail="Evidence is recorded by payment method; it is not cash collection or provider settlement."
            />
            <div className="entry-list">
              {payments.map((payment, index) => (
                <div className="entry-row" key={payment.rowKey}>
                  <Field
                    id={`payment-method-${payment.rowKey}`}
                    label={`Payment ${index + 1} method`}
                  >
                    <select
                      id={`payment-method-${payment.rowKey}`}
                      value={payment.method}
                      disabled={!editable}
                      onChange={(event) => {
                        setDirty(true);
                        setPayments((current) =>
                          current.map((item) =>
                            item.rowKey === payment.rowKey
                              ? { ...item, method: event.target.value as PaymentMethod }
                              : item,
                          ),
                        );
                      }}
                    >
                      {paymentMethods.map((method) => (
                        <option key={method} value={method}>
                          {formatStatusLabel(method)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <NumericInput
                    id={`payment-amount-${payment.rowKey}`}
                    label="Amount"
                    value={payment.amount}
                    onChange={(event) => {
                      setDirty(true);
                      setPayments((current) =>
                        current.map((item) =>
                          item.rowKey === payment.rowKey
                            ? { ...item, amount: event.target.value }
                            : item,
                        ),
                      );
                    }}
                    unit="USD"
                    disabled={!editable}
                  />
                  <Field id={`payment-reference-${payment.rowKey}`} label="Reference" optional>
                    <input
                      id={`payment-reference-${payment.rowKey}`}
                      value={payment.reference}
                      disabled={!editable}
                      onChange={(event) => {
                        setDirty(true);
                        setPayments((current) =>
                          current.map((item) =>
                            item.rowKey === payment.rowKey
                              ? { ...item, reference: event.target.value }
                              : item,
                          ),
                        );
                      }}
                    />
                  </Field>
                  {editable ? (
                    <Button
                      variant="quiet"
                      aria-label={`Remove payment ${index + 1}`}
                      onClick={() => {
                        setDirty(true);
                        setPayments((current) =>
                          current.filter((item) => item.rowKey !== payment.rowKey),
                        );
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              disabled={!editable}
              onClick={() => {
                setDirty(true);
                setPayments((current) => [
                  ...current,
                  { rowKey: newRowKey(), method: 'CASH', amount: '', reference: '', note: '' },
                ]);
              }}
            >
              Add payment evidence
            </Button>
          </Card>

          <Card
            as="section"
            className="panel"
            id="operations-expenses"
            aria-labelledby="operations-expenses-title"
          >
            <SectionHeading
              eyebrow="4 · Expenses"
              title="Record approved expenses"
              headingId="operations-expenses-title"
              detail="Expenses stay separate from payment evidence and are included in cash semantics only when paid in cash."
            />
            {expenses.map((expense, index) => (
              <div className="entry-row expense-row" key={expense.rowKey}>
                <Field
                  id={`expense-category-${expense.rowKey}`}
                  label={`Expense ${index + 1} category`}
                  required
                >
                  <input
                    id={`expense-category-${expense.rowKey}`}
                    value={expense.category}
                    disabled={!editable}
                    onChange={(event) => {
                      setDirty(true);
                      setExpenses((current) =>
                        current.map((item) =>
                          item.rowKey === expense.rowKey
                            ? { ...item, category: event.target.value }
                            : item,
                        ),
                      );
                    }}
                  />
                </Field>
                <Field id={`expense-description-${expense.rowKey}`} label="Description" required>
                  <input
                    id={`expense-description-${expense.rowKey}`}
                    value={expense.description}
                    disabled={!editable}
                    onChange={(event) => {
                      setDirty(true);
                      setExpenses((current) =>
                        current.map((item) =>
                          item.rowKey === expense.rowKey
                            ? { ...item, description: event.target.value }
                            : item,
                        ),
                      );
                    }}
                  />
                </Field>
                <NumericInput
                  id={`expense-amount-${expense.rowKey}`}
                  label="Amount"
                  value={expense.amount}
                  onChange={(event) => {
                    setDirty(true);
                    setExpenses((current) =>
                      current.map((item) =>
                        item.rowKey === expense.rowKey
                          ? { ...item, amount: event.target.value }
                          : item,
                      ),
                    );
                  }}
                  unit="USD"
                  disabled={!editable}
                />
                <Field id={`expense-payment-${expense.rowKey}`} label="Paid by">
                  <select
                    id={`expense-payment-${expense.rowKey}`}
                    value={expense.paymentMethod}
                    disabled={!editable}
                    onChange={(event) => {
                      setDirty(true);
                      setExpenses((current) =>
                        current.map((item) =>
                          item.rowKey === expense.rowKey
                            ? { ...item, paymentMethod: event.target.value as PaymentMethod }
                            : item,
                        ),
                      );
                    }}
                  >
                    {paymentMethods.map((method) => (
                      <option key={method} value={method}>
                        {formatStatusLabel(method)}
                      </option>
                    ))}
                  </select>
                </Field>
                {editable ? (
                  <Button
                    variant="quiet"
                    aria-label={`Remove expense ${index + 1}`}
                    onClick={() => {
                      setDirty(true);
                      setExpenses((current) =>
                        current.filter((item) => item.rowKey !== expense.rowKey),
                      );
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            <Button
              variant="secondary"
              disabled={!editable}
              onClick={() => {
                setDirty(true);
                setExpenses((current) => [
                  ...current,
                  {
                    rowKey: newRowKey(),
                    category: '',
                    description: '',
                    amount: '',
                    paymentMethod: 'CASH',
                    personPaid: '',
                    reference: '',
                  },
                ]);
              }}
            >
              Add expense
            </Button>
          </Card>

          <Card
            as="section"
            className="panel"
            id="operations-cash"
            aria-labelledby="operations-cash-title"
          >
            <SectionHeading
              eyebrow="5 · Cash declaration"
              title="Count physical cash"
              headingId="operations-cash-title"
              detail="Payment evidence, cash collected, and cash banked are different states."
            />
            <div className="cash-declaration-grid">
              <NumericInput
                id="cash-counted"
                label="Counted cash"
                hint="Enter the physical cash count; the server computes expected physical cash and variance."
                value={cashCounted}
                onChange={(event) => {
                  setDirty(true);
                  setCashCounted(event.target.value);
                }}
                unit="USD"
                disabled={!editable}
              />
              <dl className="operational-summary compact-summary">
                <div>
                  <dt>Expected physical cash</dt>
                  <dd className="numeric">
                    {record.cash ? formatMoney(record.cash.expectedPhysicalCash) : 'Not counted'}
                  </dd>
                </div>
                <div>
                  <dt>Cash paid expenses</dt>
                  <dd className="numeric">
                    {record.cash ? formatMoney(record.cash.cashPaidExpenses) : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Net expected cash</dt>
                  <dd className="numeric">
                    {record.cash ? formatMoney(record.cash.netExpectedCash) : 'Not counted'}
                  </dd>
                </div>
                <div>
                  <dt>Cash variance</dt>
                  <dd className="numeric">
                    {record.cash ? formatMoney(record.cash.cashVariance) : 'Not counted'}
                  </dd>
                </div>
              </dl>
            </div>
            <p className="semantic-note">
              <strong>Collection status:</strong> A counted or approved cash declaration does not
              mean cash has been collected or banked.
            </p>
          </Card>

          <Card
            as="section"
            className="panel"
            id="operations-inventory"
            aria-labelledby="operations-inventory-title"
          >
            <SectionHeading
              eyebrow="6 · Inventory context"
              title="Linked deliveries and tank dips"
              headingId="operations-inventory-title"
              detail="This workspace shows inventory context only; it does not calculate a second stock ledger."
            />
            <div className="context-grid">
              <div>
                <span className="metric-label">Linked deliveries</span>
                <strong>{record.deliveries.length}</strong>
              </div>
              <div>
                <span className="metric-label">Linked tank dips</span>
                <strong>{record.dips.length}</strong>
              </div>
              <div>
                <span className="metric-label">Stock variances</span>
                <strong>{Object.keys(record.totals.stockVariance).length}</strong>
              </div>
            </div>
            {record.deliveries.length || record.dips.length ? (
              <TableScrollRegion label="Inventory evidence linked to this reconciliation">
                <table className="responsive-table">
                  <caption className="visually-hidden">
                    Inventory evidence linked to this reconciliation
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Evidence</th>
                      <th scope="col">Reference</th>
                      <th scope="col">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.deliveries.map((delivery) => (
                      <tr key={delivery.deliveryId}>
                        <td data-label="Evidence">Delivery</td>
                        <td data-label="Reference">{delivery.deliveryNoteNumber}</td>
                        <td data-label="Quantity" className="numeric">
                          {formatLitres(delivery.actualQuantityLitres)}
                        </td>
                      </tr>
                    ))}
                    {record.dips.map((dip) => (
                      <tr key={dip.dipId}>
                        <td data-label="Evidence">Tank dip</td>
                        <td data-label="Reference">{dip.tankId}</td>
                        <td data-label="Quantity" className="numeric">
                          {formatLitres(dip.physicalLitres)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScrollRegion>
            ) : (
              <EmptyState
                title="No linked inventory evidence"
                message="When delivery or dip evidence is linked to this reconciliation, it will appear here."
              />
            )}
          </Card>

          <Card
            as="section"
            className="panel"
            id="operations-review"
            aria-labelledby="operations-review-title"
          >
            <SectionHeading
              eyebrow="7 · Review and approval"
              title="Explain exceptions, then move the workflow"
              headingId="operations-review-title"
              detail="All actions use named server commands and the current revision version."
            />
            <div className="explanation-grid">
              {(['SALES', 'CASH', 'STOCK'] as const).map((category) => {
                const required =
                  category === 'SALES'
                    ? requiresSalesExplanation
                    : category === 'CASH'
                      ? requiresCashExplanation
                      : requiresStockExplanation;
                return (
                  <Field
                    key={category}
                    id={`explanation-${category.toLowerCase()}`}
                    label={`${formatStatusLabel(category)} variance explanation`}
                    hint={
                      required
                        ? 'Required for this non-zero server-derived variance.'
                        : 'Optional unless the server identifies a variance.'
                    }
                  >
                    <textarea
                      id={`explanation-${category.toLowerCase()}`}
                      rows={3}
                      value={explanations[category] ?? ''}
                      disabled={!editable}
                      onChange={(event) => {
                        setDirty(true);
                        setExplanations((current) => ({
                          ...current,
                          [category]: event.target.value,
                        }));
                      }}
                    />
                  </Field>
                );
              })}
            </div>
            {state === 'APPROVED' ? (
              <p className="state state-success" role="status">
                <strong>Approved:</strong> Canonical sale evidence has been posted by the production
                approval command. Corrections use a named new revision workflow.
              </p>
            ) : null}
            {state === 'LOCKED' ? (
              <p className="state state-success" role="status">
                <strong>Locked:</strong> This record is locked. Corrections use a named new revision
                workflow.
              </p>
            ) : null}
            {state === 'RETURNED' ? (
              <p className="state state-warning" role="status">
                <strong>Returned:</strong> Correct the evidence and save a new server draft before
                resubmitting.
              </p>
            ) : null}
            {role === 'MANAGEMENT' && state === 'SUBMITTED' ? (
              <Field
                id="management-return-reason"
                label="Return reason"
                hint="Required when sending this reconciliation back for correction."
                required
              >
                <textarea
                  id="management-return-reason"
                  rows={3}
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                />
              </Field>
            ) : null}
            <div className="form-actions">
              <Button
                variant="secondary"
                onClick={() => void saveDraft()}
                disabled={!editable || !dirty}
                loading={busy}
              >
                Save persisted draft
              </Button>
              {role === 'SUPERVISOR' && editable ? (
                <Button
                  variant="primary"
                  onClick={() => void transition('SubmitProductionReconciliation')}
                  disabled={busy || dirty}
                >
                  Submit for management review
                </Button>
              ) : null}
              {role === 'MANAGEMENT' && state === 'SUBMITTED' ? (
                <>
                  <Button
                    variant="danger"
                    onClick={() => {
                      const reason = returnReason.trim();
                      if (!reason) {
                        setError('Enter a return reason before sending this reconciliation back.');
                        return;
                      }
                      void transition('ReturnProductionReconciliation', { reason });
                    }}
                    disabled={busy || !returnReason.trim()}
                  >
                    Return for correction
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void transition('ApproveProductionReconciliation')}
                    disabled={busy}
                  >
                    Approve production reconciliation
                  </Button>
                </>
              ) : null}
            </div>
          </Card>
        </div>

        <aside className="operations-sidebar" aria-label="Daily operations status">
          <Card as="section" className="panel sticky-panel" aria-labelledby="operations-save-title">
            <SectionHeading
              eyebrow="Draft resilience"
              title="Server-backed draft"
              headingId="operations-save-title"
              detail="Use deliberate save to persist authoritative evidence. Browser storage is not used for financial truth."
            />
            <div className="save-status">
              <span className={dirty ? 'save-dot save-dot-dirty' : 'save-dot'} aria-hidden="true" />
              {dirty ? 'Changes ready to save' : 'All changes saved to server'}
            </div>
            <Button
              variant="primary"
              onClick={() => void saveDraft()}
              disabled={!editable || !dirty}
              loading={busy}
            >
              Save draft
            </Button>
            <p className="panel-detail">
              Refresh restores the latest server draft when this URL includes the reconciliation ID.
            </p>
          </Card>
          <Card as="section" className="panel" aria-labelledby="operations-downstream-title">
            <SectionHeading
              eyebrow="Downstream status"
              title="Cash and provider follow-up"
              headingId="operations-downstream-title"
              detail="Operational evidence is not silently treated as collected, banked, or settled."
            />
            <dl className="summary-list">
              <div>
                <dt>Cash collected but unbanked</dt>
                <dd>
                  {cashSummary ? formatMoney(cashSummary.collectedButUnbanked) : 'Unavailable'}
                </dd>
              </div>
              <div>
                <dt>Pending bank confirmation</dt>
                <dd>
                  {cashSummary ? formatMoney(cashSummary.pendingBankConfirmation) : 'Unavailable'}
                </dd>
              </div>
              <div>
                <dt>Provider settlement rows</dt>
                <dd>{settlementSummary.length || 'Unavailable'}</dd>
              </div>
            </dl>
            <div className="inline-links">
              <a className="text-link" href={`/stations/${context.stationId}/cash`}>
                Open cash custody
              </a>
              <a className="text-link" href={`/stations/${context.stationId}/settlements`}>
                Open settlements
              </a>
            </div>
          </Card>
          <Card as="section" className="panel" aria-labelledby="operations-links-title">
            <SectionHeading
              eyebrow="Management"
              title="Continue the control trail"
              headingId="operations-links-title"
            />
            <div className="inline-links">
              <a
                className="button button-secondary"
                href={`/reports?tenantId=${encodeURIComponent(context.tenantId)}`}
              >
                Open management reporting
              </a>
              <a
                className="text-link"
                href={`/operations/reconciliations/${activeReconciliationId}/review?${contextQuery.toString()}`}
              >
                Open review route
              </a>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export function DailyOperationsContextRequired() {
  return (
    <>
      <div className="page-header">
        <div>
          <p className="lede">Choose an authorised station to begin.</p>
        </div>
      </div>
      <Card as="section" className="panel" aria-labelledby="operations-context-title">
        <SectionHeading
          eyebrow="Station context"
          title="Choose a station"
          headingId="operations-context-title"
          detail="Use Change above to choose an authorised station, business date, and shift."
        />
        <p>The daily workspace will load once the selected work context is ready.</p>
      </Card>
    </>
  );
}
