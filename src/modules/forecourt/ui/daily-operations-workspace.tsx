'use client';

import Decimal from 'decimal.js';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../../../design-system/confirm-dialog';
import { InlineError } from '../../../design-system/inline-error';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  NumericInput,
  SkeletonBlock,
  StatusBadge,
} from '../../../design-system/primitives';
import { getDisplayStatus } from '../../../design-system/status-display';
import { TableScrollRegion } from '../../../design-system/table';
import { useToast } from '../../../design-system/toast';
import {
  describeFailure,
  type UserMessage,
  userMessage,
} from '../../../design-system/user-messages';
import { sumDecimals } from '../../cash/ui/cash-visuals';
import {
  describeDifference,
  formatBusinessDate,
  formatLitres,
  formatMoney,
} from '../../../design-system/formatters';
import { closedMetersKey } from './close-meters-sheet';
import { isEditableDailyOperationsState } from './daily-operations-state';
import { computeTotals, isZeroDecimal, litresBetween } from './reconciliation-math';
import { shiftLabel } from './shift-labels';
import { evaluateSubmit, MIN_EXPLANATION } from './submit-rules';
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

export type OperationsContext = {
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

export type RecordData = {
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

export const methodLabels: Record<string, string> = {
  CASH: 'Cash',
  POS: 'Card (POS)',
  ECOCASH: 'EcoCash',
  BANK_TRANSFER: 'Bank transfer',
  CUSTOMER_CREDIT: 'Customer on credit',
  PREPAID: 'Prepaid account',
  STAFF_OR_MANAGEMENT_FUEL: 'Staff or management fuel',
  OTHER_APPROVED: 'Other (approved)',
};

/** The ways customers usually pay; one tap adds a line for each. */
const quickPayments: readonly PaymentMethod[] = ['CASH', 'ECOCASH', 'POS'];

const STEPS = ['Team', 'Pumps', 'Payments', 'Expenses', 'Cash', 'Submit'] as const;

const STEP_TITLES = [
  'Who’s on shift?',
  'Pump readings',
  'How customers paid',
  'Expenses',
  'Count the cash',
  'Check and submit',
] as const;

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

/** A failed response, turned into the plain-language message the screen shows. */
function failureFromResponse(status: number, body: unknown): UserMessage {
  const result = (body ?? {}) as { error?: string; message?: string };
  return describeFailure(status, result.error, result.message);
}

function isUserMessage(value: unknown): value is UserMessage {
  return typeof value === 'object' && value !== null && 'title' in value && 'code' in value;
}

function asUserMessage(value: unknown): UserMessage {
  return isUserMessage(value) ? value : userMessage('UNKNOWN');
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

/** A grey outline of the wizard, shown while it loads so the page does not jump. */
function WorkspaceSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="daily-operations-workspace" role="status" aria-label="Loading figures">
      {compact ? null : (
        <>
          <div className="workspace-skeleton-head">
            <SkeletonBlock width="14rem" height="1.5rem" />
            <SkeletonBlock width="8rem" height="1.5rem" />
          </div>
          <SkeletonBlock height="2.75rem" />
        </>
      )}
      <SkeletonBlock height="12rem" />
      <SkeletonBlock height="6rem" />
    </div>
  );
}

function differenceTone(value: string): 'warning' | 'critical' | undefined {
  if (isZero(value)) return undefined;
  return value.trim().startsWith('-') ? 'critical' : 'warning';
}

export function DailyOperationsWorkspace({ context }: { context: DailyOperationsContext }) {
  const toast = useToast();
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
  const [loadError, setLoadError] = useState<UserMessage | null>(null);
  const [actionError, setActionError] = useState<UserMessage | null>(null);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState(0);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [online, setOnline] = useState(true);
  const saveJournal = useRef<DraftSaveJournal | undefined>(undefined);
  const creating = useRef(false);
  const [cashSummary, setCashSummary] = useState<{
    availableAtStation: string;
    collectedButUnbanked: string;
    pendingBankConfirmation: string;
  }>();
  /** `null` when the person cannot see settlements, so the row is left out rather than shown as unavailable. */
  const [settlementSummary, setSettlementSummary] = useState<Array<{
    providerName: string;
    state: string;
    unallocatedProviderAmount: string;
  }> | null>(null);

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

  useEffect(() => {
    document
      .querySelector('.entry-steps [aria-current="step"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [step]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const timer = window.setTimeout(update, 0);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const syncDraft = useCallback(
    (next: RecordData | null, nextOperation: OperationsContext) => {
      const fromContext = () =>
        nextOperation.availableReadings.map((reading) =>
          readingFromContext(reading, context.shiftId),
        );
      // The readings entered in Close meters are carried over so nobody types them twice.
      const carried = (rows: Array<Reading & { rowKey: string }>) => {
        let stored: Array<{ nozzleId: string; opening: string; closing: string }> = [];
        try {
          const raw = sessionStorage.getItem(closedMetersKey(context.shiftId));
          stored = raw ? (JSON.parse(raw) as typeof stored) : [];
        } catch {
          stored = [];
        }
        if (stored.length === 0) return { rows, changed: false };
        let changed = false;
        const merged = rows.map((row) => {
          const match = stored.find((item) => item.nozzleId === row.nozzleId);
          if (!match || row.closingReading.trim() !== '') return row;
          changed = true;
          return { ...row, openingReading: match.opening, closingReading: match.closing };
        });
        return { rows: merged, changed };
      };
      if (!next) {
        const { rows, changed } = carried(fromContext());
        setReadings(rows);
        setPayments([]);
        setExpenses([]);
        setAttendantIds([]);
        setCashCounted('');
        setExplanations({});
        if (changed) setDirty(true);
        return;
      }
      const base = next.readings.length
        ? next.readings.map((reading) => ({ ...reading, rowKey: reading.id }))
        : fromContext();
      const { rows, changed } = isEditableDailyOperationsState(next.state)
        ? carried(base)
        : { rows: base, changed: false };
      setReadings(rows);
      setPayments(next.payments.map(paymentFromRecord));
      setExpenses(next.expenses.map(expenseFromRecord));
      setAttendantIds(next.attendants.map((attendant) => attendant.attendantId));
      setCashCounted(next.cash?.countedCash ?? '');
      setExplanations(
        Object.fromEntries(next.explanations.map((item) => [item.category, item.explanation])),
      );
      setDirty(changed);
    },
    [context.shiftId],
  );

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const operationResponse = await fetch(
        `/api/forecourt/operations/daily?${contextQuery.toString()}`,
        { cache: 'no-store' },
      );
      const operationBody = await operationResponse.json();
      if (!operationResponse.ok) throw failureFromResponse(operationResponse.status, operationBody);
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
      if (!recordResponse.ok) throw failureFromResponse(recordResponse.status, recordBody);
      const nextRecord = recordBody as RecordData;
      setRecord(nextRecord);
      syncDraft(nextRecord, nextOperation);
    } catch (cause) {
      setLoadError(asUserMessage(cause));
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
        { cache: 'no-store', signal: controller.signal },
      ).then(async (response) => (response.ok ? response.json() : null)),
      fetch(
        `/api/settlements/summary?tenantId=${encodeURIComponent(context.tenantId)}&stationId=${encodeURIComponent(context.stationId)}`,
        { cache: 'no-store', signal: controller.signal },
      ).then(async (response) => (response.ok ? response.json() : null)),
    ])
      .then(([cash, settlements]) => {
        if (controller.signal.aborted) return;
        setCashSummary(cash?.totals);
        setSettlementSummary(Array.isArray(settlements) ? settlements : null);
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
    if (!response.ok) throw failureFromResponse(response.status, body);
    return body as CommandResult;
  }

  /** Opens the reconciliation for this shift. It is created straight away, so there is no extra "begin" step. */
  async function createDraft() {
    setBusy(true);
    setActionError(null);
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
      creating.current = false;
    } catch (cause) {
      setActionError(asUserMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (loading || loadError || !operation || record || creating.current) return;
    if (operation.shift.state === 'PLANNED') return;
    creating.current = true;
    // Not cancelled on cleanup: `creating` already guards against a second run (including React's
    // double effect in development), so the timer must always fire once.
    window.setTimeout(() => void createDraft(), 0);
    // createDraft only reads state that is stable once the first load has finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadError, operation, record]);

  /** Saves the draft; resolves to the new revision version, or null when nothing was saved. */
  async function saveDraft(): Promise<number | null> {
    if (!record || !operation) return null;
    if (readings.some((reading) => !reading.sellingPriceId)) {
      setActionError({
        code: 'STATION_NOT_SET_UP',
        title: 'A selling price is missing',
        body: 'Ask your manager to set a current price for every fuel before you carry on.',
      });
      return null;
    }
    setBusy(true);
    setActionError(null);
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
      if (!journal) throw userMessage('UNKNOWN');
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
      await load();
      return journal.version;
    } catch (cause) {
      const message = asUserMessage(cause);
      saveJournal.current = undefined;
      await load();
      setActionError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function goToStep(next: number) {
    if (dirty && editable) {
      const saved = await saveDraft();
      if (saved === null) return;
      toast.show('Saved');
    }
    setActionError(null);
    setStep(Math.max(0, Math.min(next, STEPS.length - 1)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Saves anything not yet saved, then sends the figures for review. */
  async function submitForReview() {
    if (!record) return;
    let version = record.version;
    if (dirty) {
      const saved = await saveDraft();
      if (saved === null) {
        setConfirmSubmit(false);
        return;
      }
      version = saved;
    }
    setBusy(true);
    setActionError(null);
    try {
      await sendCommand('SubmitProductionReconciliation', {
        tenantId: context.tenantId,
        stationId: context.stationId,
        reconciliationId: activeReconciliationId,
        expectedVersion: version,
      });
      try {
        sessionStorage.removeItem(closedMetersKey(context.shiftId));
      } catch {
        /* nothing stored */
      }
      await load();
      toast.show('Submitted for review');
    } catch (cause) {
      setActionError(asUserMessage(cause));
      await load();
    } finally {
      setBusy(false);
      setConfirmSubmit(false);
    }
  }

  const editable = isEditableDailyOperationsState(record?.state);
  const state = record?.state ?? 'NOT_STARTED';
  const totals = computeTotals({ readings, payments, expenses, countedCash: cashCounted });
  const stockDifference = record
    ? Object.values(record.totals.stockVariance).some((value) => !isZero(value))
    : false;
  const salesDifferent = !isZeroDecimal(totals.salesDifference);
  const cashDifferent = totals.cash.difference !== null && !isZeroDecimal(totals.cash.difference);
  const evaluation = evaluateSubmit({
    shiftState: operation?.shift.state ?? 'PLANNED',
    readingsComplete:
      readings.length > 0 &&
      readings.every((item) => litresBetween(item.openingReading, item.closingReading) !== null),
    hasPayments: payments.length > 0,
    cashCounted: cashCounted.trim() !== '',
    differences: { sales: salesDifferent, cash: cashDifferent, stock: stockDifference },
    explanations,
    offline: !online,
  });

  if (loadError && !operation) {
    return (
      <ErrorState
        title={loadError.title}
        message={loadError.body}
        action={
          loadError.code === 'UNKNOWN' ? (
            <Button onClick={() => void load()}>Try again</Button>
          ) : null
        }
      />
    );
  }
  if (!operation) return <WorkspaceSkeleton />;

  const shiftName = shiftLabel(
    operation.shift.plannedStartAt,
    operation.shift.plannedEndAt,
    operation.station.timezone,
  );
  const shiftStatus = getDisplayStatus(operation.shift.state);
  const submitted = Boolean(record) && !editable;

  if (!record) {
    return (
      <div className="daily-operations-workspace" aria-label="Daily station operations workspace">
        <header className="entry-head">
          <div>
            <p className="eyebrow">
              {operation.station.name} · {formatBusinessDate(operation.businessDay.date)}
            </p>
            <h2>Shift figures</h2>
          </div>
          <div className="workspace-status">
            <span className="shift-line">
              Shift: {shiftName}
              <StatusBadge tone={shiftStatus.tone}>{shiftStatus.label}</StatusBadge>
            </span>
          </div>
        </header>
        {operation.shift.state === 'PLANNED' ? (
          <Card as="section" className="card panel cash-panel">
            <SectionHeading
              eyebrow="Today"
              title="Start the shift first"
              headingId="operations-start-title"
              detail="Figures can be entered once the shift has started and its meters are closed."
            />
            <div className="form-actions">
              <Link className="button button-primary" href="/">
                Back to today
              </Link>
            </div>
          </Card>
        ) : actionError ? (
          <InlineError
            error={actionError}
            onRetry={() => {
              creating.current = false;
              setActionError(null);
              void load();
            }}
          />
        ) : (
          <WorkspaceSkeleton compact />
        )}
      </div>
    );
  }

  return (
    <div className="daily-operations-workspace" aria-label="Daily station operations workspace">
      <header className="entry-head">
        <div>
          <p className="eyebrow">
            {operation.station.name} · {formatBusinessDate(record.business_date)}
          </p>
          <h2>{STEP_TITLES[step]}</h2>
        </div>
        <div className="workspace-status">
          <span className="shift-line">
            Shift: {shiftName}
            <StatusBadge tone={shiftStatus.tone}>{shiftStatus.label}</StatusBadge>
          </span>
          <StatusBadge tone={getDisplayStatus(state).tone}>
            {getDisplayStatus(state).label}
          </StatusBadge>
          {editable ? (
            dirty ? (
              <span className="dirty-indicator">
                {online ? 'Not saved yet' : 'Offline, not saved yet'}
              </span>
            ) : (
              <span className="saved-indicator">Saved</span>
            )
          ) : null}
        </div>
      </header>

      <nav className="entry-steps" aria-label="Steps">
        <ol>
          {STEPS.map((label, index) => (
            <li key={label}>
              <button
                type="button"
                aria-current={index === step ? 'step' : undefined}
                data-done={index < step || undefined}
                disabled={busy}
                onClick={() => void goToStep(index)}
              >
                <span>{index + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <aside className="entry-side">
        <p className="eyebrow">This shift so far</p>
        <dl className="entry-totals" aria-label="Totals so far">
          <div>
            <dt>Expected sales</dt>
            <dd>{formatMoney(totals.expectedSales.toFixed())}</dd>
          </div>
          <div>
            <dt>Accounted for</dt>
            <dd>{formatMoney(totals.accountedSales.toFixed())}</dd>
          </div>
          <div data-tone={differenceTone(totals.salesDifference.toFixed())}>
            <dt>Difference</dt>
            <dd>{formatMoney(totals.salesDifference.toFixed())}</dd>
            <dd className="difference-words">
              {describeDifference(totals.salesDifference.toFixed())?.words}
            </dd>
          </div>
        </dl>
      </aside>

      <div className="entry-flow">
        {step === 0 ? (
          <Card
            as="section"
            className="card panel cash-panel"
            id="operations-shift"
            aria-labelledby="operations-shift-title"
          >
            <SectionHeading
              eyebrow="Step 1 of 6"
              title="Shift details"
              headingId="operations-shift-title"
              detail="Tick everyone who worked this shift."
            />
            <div className="context-grid">
              <div>
                <span className="metric-label">Date</span>
                <strong>{formatBusinessDate(operation.businessDay.date)}</strong>
                <span className="metric-meta">
                  <StatusBadge tone={getDisplayStatus(operation.businessDay.state).tone}>
                    {getDisplayStatus(operation.businessDay.state).label}
                  </StatusBadge>
                </span>
              </div>
              <div>
                <span className="metric-label">Shift</span>
                <strong>{shiftName}</strong>
                <span className="metric-meta">
                  <StatusBadge tone={shiftStatus.tone}>{shiftStatus.label}</StatusBadge>
                </span>
              </div>
            </div>
            <fieldset className="attendant-fieldset" disabled={!editable}>
              <legend>Attendants on this shift</legend>
              {operation.attendants.length === 0 ? (
                <p className="panel-detail">
                  No attendants are set up for this station yet. Ask your manager to add them.
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
        ) : null}

        {step === 1 ? (
          <Card
            as="section"
            className="card panel cash-panel"
            id="operations-meters"
            aria-labelledby="operations-meters-title"
          >
            <SectionHeading
              eyebrow="Step 2 of 6"
              title="Pump readings"
              headingId="operations-meters-title"
              detail="Enter the closing reading for every pump. The opening reading is filled in from the last shift."
            />
            {readings.length === 0 ? (
              <EmptyState
                title="No pumps set up yet"
                message="Your manager needs to set up the pumps for this station before readings can be entered."
              />
            ) : (
              <div className="meter-list">
                {[...readings]
                  .sort((a, b) => {
                    const key = (id: string) => {
                      const item = operation.availableReadings.find((r) => r.nozzleId === id);
                      return item ? `${item.pumpNumber}.${item.nozzleNumber}` : '';
                    };
                    return key(a.nozzleId).localeCompare(key(b.nozzleId), undefined, {
                      numeric: true,
                    });
                  })
                  .map((reading, index) => {
                    const contextReading = operation.availableReadings.find(
                      (item) => item.nozzleId === reading.nozzleId,
                    );
                    const litres = litresBetween(reading.openingReading, reading.closingReading);
                    const sales = computeTotals({
                      readings: [reading],
                      payments: [],
                      expenses: [],
                      countedCash: '',
                    }).expectedSales;
                    return (
                      <article className="meter-card" key={reading.rowKey}>
                        <div className="meter-card-heading">
                          <div>
                            <span className="eyebrow">
                              {contextReading
                                ? `Pump ${contextReading.pumpNumber} · Nozzle ${contextReading.nozzleNumber}`
                                : `Nozzle ${index + 1}`}
                            </span>
                            <h3>
                              {contextReading?.productName ?? reading.label ?? reading.nozzleId}
                            </h3>
                          </div>
                          {litres ? (
                            <StatusBadge tone="neutral">{formatMoney(sales.toFixed())}</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">Enter closing</StatusBadge>
                          )}
                        </div>
                        <div className="form-grid">
                          <NumericInput
                            id={`opening-${reading.rowKey}`}
                            label="Opening"
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
                            label="Closing"
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
                            <span className="metric-label">Litres sold</span>
                            <strong className="numeric">
                              {litres ? formatLitres(litres.toFixed(3)) : '—'}
                            </strong>
                            <span className="metric-meta">
                              Price{' '}
                              {reading.unitPrice ? formatMoney(reading.unitPrice) : 'unavailable'}
                            </span>
                          </div>
                        </div>
                        {!reading.sellingPriceId ? (
                          <p className="field-error" role="alert">
                            No selling price is set for this fuel. Ask your manager before
                            continuing.
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
              </div>
            )}
          </Card>
        ) : null}

        {step === 2 ? (
          <Card
            as="section"
            className="card panel cash-panel"
            id="operations-evidence"
            aria-labelledby="operations-evidence-title"
          >
            <SectionHeading
              eyebrow="Step 3 of 6"
              title="How customers paid"
              headingId="operations-evidence-title"
              detail="Add a line for each way customers paid this shift. The total should match the expected sales."
            />
            <div className="entry-list">
              {payments.map((payment, index) => (
                <div className="entry-row" key={payment.rowKey}>
                  <Field
                    id={`payment-method-${payment.rowKey}`}
                    label={`Paid by (line ${index + 1})`}
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
                          {methodLabels[method]}
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
                  <Field
                    id={`payment-reference-${payment.rowKey}`}
                    label="Reference or note"
                    optional
                  >
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
                      aria-label={`Remove payment line ${index + 1}`}
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
            {editable ? (
              <div className="quick-add" role="group" aria-label="Add a payment line">
                {quickPayments.map((method) => (
                  <Button
                    key={method}
                    variant="secondary"
                    onClick={() => {
                      setDirty(true);
                      setPayments((current) => [
                        ...current,
                        { rowKey: newRowKey(), method, amount: '', reference: '', note: '' },
                      ]);
                    }}
                  >
                    + {methodLabels[method]}
                  </Button>
                ))}
                <Button
                  variant="quiet"
                  onClick={() => {
                    setDirty(true);
                    setPayments((current) => [
                      ...current,
                      {
                        rowKey: newRowKey(),
                        method: 'OTHER_APPROVED',
                        amount: '',
                        reference: '',
                        note: '',
                      },
                    ]);
                  }}
                >
                  + Other
                </Button>
              </div>
            ) : null}
            {payments.length > 0 ? (
              <p className="entry-sum">
                Entered so far
                <strong>
                  {formatMoney(sumDecimals(payments.map((item) => item.amount || '0')))}
                </strong>
              </p>
            ) : null}
          </Card>
        ) : null}

        {step === 3 ? (
          <Card
            as="section"
            className="card panel cash-panel"
            id="operations-expenses"
            aria-labelledby="operations-expenses-title"
          >
            <SectionHeading
              eyebrow="Step 4 of 6"
              title="Expenses"
              headingId="operations-expenses-title"
              detail="Add anything paid out during the shift. Skip this step if there were none."
            />
            {expenses.map((expense, index) => (
              <div className="entry-row expense-row" key={expense.rowKey}>
                <Field
                  id={`expense-category-${expense.rowKey}`}
                  label={`What for (expense ${index + 1})`}
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
                <Field id={`expense-description-${expense.rowKey}`} label="Details" required>
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
                <Field id={`expense-payment-${expense.rowKey}`} label="Paid with">
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
                        {methodLabels[method]}
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
              Add an expense
            </Button>
            {expenses.length > 0 ? (
              <p className="entry-sum">
                Entered so far
                <strong>
                  {formatMoney(sumDecimals(expenses.map((item) => item.amount || '0')))}
                </strong>
              </p>
            ) : null}
          </Card>
        ) : null}

        {step === 4 ? (
          <Card
            as="section"
            className="card panel cash-panel"
            id="operations-cash"
            aria-labelledby="operations-cash-title"
          >
            <SectionHeading
              eyebrow="Step 5 of 6"
              title="Count the cash"
              headingId="operations-cash-title"
              detail="Count the cash you are holding and enter the total."
            />
            <div className="cash-declaration-grid">
              <NumericInput
                id="cash-counted"
                label="Cash counted"
                hint="The expected amount and any difference update as you type."
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
                  <dt>Cash we expected</dt>
                  <dd className="numeric">{formatMoney(totals.cash.expected.toFixed())}</dd>
                </div>
                <div>
                  <dt>Paid out in cash</dt>
                  <dd className="numeric">{formatMoney(totals.cash.paidOut.toFixed())}</dd>
                </div>
                <div>
                  <dt>Expected after payouts</dt>
                  <dd className="numeric">{formatMoney(totals.cash.net.toFixed())}</dd>
                </div>
                <div>
                  <dt>Difference</dt>
                  <dd
                    className="numeric"
                    data-tone={differenceTone(totals.cash.difference?.toFixed() ?? '0')}
                  >
                    {totals.cash.difference ? formatMoney(totals.cash.difference.toFixed()) : '—'}
                    {totals.cash.difference ? (
                      <span className="difference-words">
                        {describeDifference(totals.cash.difference.toFixed())?.words}
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </div>
            <p className="semantic-note">
              Counting the cash here does not bank it. Collection and banking are recorded under
              Cash.
            </p>
          </Card>
        ) : null}

        {step === 5 ? (
          <Card
            as="section"
            className="card panel cash-panel"
            id="operations-inventory"
            aria-labelledby="operations-inventory-title"
          >
            <SectionHeading
              eyebrow="Step 6 of 6"
              title="Stock this shift"
              headingId="operations-inventory-title"
              detail="Deliveries and tank dips recorded for this shift."
            />
            <div className="context-grid">
              <div>
                <span className="metric-label">Deliveries</span>
                <strong>{record.deliveries.length}</strong>
              </div>
              <div>
                <span className="metric-label">Tank dips</span>
                <strong>{record.dips.length}</strong>
              </div>
              <div>
                <span className="metric-label">Stock differences</span>
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
                title="No deliveries or dips yet"
                message="Deliveries and tank dips for this shift will show here once they are recorded."
              />
            )}
          </Card>
        ) : null}

        {step === 5 && submitted ? (
          <Card
            as="section"
            className="card panel cash-panel submitted-panel"
            id="operations-submitted"
            aria-labelledby="operations-submitted-title"
          >
            <SectionHeading
              eyebrow={getDisplayStatus(state).label}
              title={state === 'RETURNED' ? 'Sent back for correction' : 'Submitted for review'}
              headingId="operations-submitted-title"
              detail={
                state === 'APPROVED' || state === 'LOCKED'
                  ? 'A manager has approved these figures.'
                  : 'A manager will check these figures. You’ll be told if anything needs fixing.'
              }
            />
            <div className="form-actions">
              <Link className="button button-primary" href="/">
                Back to today
              </Link>
            </div>
          </Card>
        ) : null}

        {step === 5 && !submitted ? (
          <Card
            as="section"
            className="card panel cash-panel"
            id="operations-review"
            aria-labelledby="operations-review-title"
          >
            <SectionHeading
              eyebrow="Final check"
              title="Explain any differences, then submit"
              headingId="operations-review-title"
            />
            <ul className="entry-checklist" aria-label="Before you submit">
              {evaluation.checks.map((item) => (
                <li key={item.id} data-ok={item.ok || undefined}>
                  <span aria-hidden="true">{item.ok ? '✓' : '!'}</span>
                  {item.label}
                </li>
              ))}
            </ul>
            <div className="explanation-grid">
              {(['SALES', 'CASH', 'STOCK'] as const).map((category) => {
                const required =
                  category === 'SALES'
                    ? salesDifferent
                    : category === 'CASH'
                      ? cashDifferent
                      : stockDifference;
                if (!required && !(explanations[category] ?? '').trim()) return null;
                const short =
                  required && (explanations[category] ?? '').trim().length < MIN_EXPLANATION;
                return (
                  <Field
                    key={category}
                    id={`explanation-${category.toLowerCase()}`}
                    label={`Why is ${category === 'SALES' ? 'the sales' : category === 'CASH' ? 'the cash' : 'the stock'} different?`}
                    hint={
                      required
                        ? `Add a short reason (at least ${MIN_EXPLANATION} characters).`
                        : 'Only needed if there is a difference.'
                    }
                  >
                    <textarea
                      id={`explanation-${category.toLowerCase()}`}
                      rows={3}
                      value={explanations[category] ?? ''}
                      aria-invalid={short || undefined}
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
            {state === 'RETURNED' ? (
              <p className="state state-warning" role="status">
                <strong>Returned:</strong> Correct the figures, then submit them again.
              </p>
            ) : null}
            <div className="form-actions">
              <Button
                variant="secondary"
                onClick={() =>
                  void saveDraft().then((saved) => saved !== null && toast.show('Saved'))
                }
                disabled={!editable || !dirty}
                loading={busy && !confirmSubmit}
              >
                Save now
              </Button>
              {editable ? (
                <Button
                  variant="primary"
                  onClick={() => setConfirmSubmit(true)}
                  disabled={busy || !evaluation.canSubmit}
                  aria-describedby="submit-reason"
                >
                  Submit for review
                </Button>
              ) : null}
            </div>
            {editable && evaluation.blocked ? (
              <p className="action-reason" id="submit-reason">
                {evaluation.blocked.reason}
              </p>
            ) : null}
            <InlineError error={actionError} onRetry={() => setConfirmSubmit(true)} />
          </Card>
        ) : null}

        {step === 5 && submitted ? (
          <Card
            as="section"
            className="card panel cash-panel"
            aria-labelledby="operations-downstream-title"
          >
            <SectionHeading
              eyebrow="After you submit"
              title="Cash and card follow-up"
              headingId="operations-downstream-title"
            />
            <dl className="summary-list">
              <div>
                <dt>Cash collected, not banked</dt>
                <dd>{cashSummary ? formatMoney(cashSummary.collectedButUnbanked) : '—'}</dd>
              </div>
              <div>
                <dt>Awaiting bank confirmation</dt>
                <dd>{cashSummary ? formatMoney(cashSummary.pendingBankConfirmation) : '—'}</dd>
              </div>
              {settlementSummary ? (
                <div>
                  <dt>Unmatched provider amount</dt>
                  <dd>
                    {formatMoney(
                      settlementSummary
                        .reduce(
                          (total, item) => total.plus(item.unallocatedProviderAmount || '0'),
                          new Decimal(0),
                        )
                        .toFixed(),
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="inline-links">
              <a className="text-link" href={`/stations/${context.stationId}/cash`}>
                Open cash
              </a>
              {settlementSummary ? (
                <a className="text-link" href={`/stations/${context.stationId}/settlements`}>
                  Open settlements
                </a>
              ) : null}
            </div>
          </Card>
        ) : null}

        <ConfirmDialog
          open={confirmSubmit}
          title="Submit for review?"
          lines={[
            { label: 'Expected sales', value: formatMoney(totals.expectedSales.toFixed()) },
            { label: 'Accounted for', value: formatMoney(totals.accountedSales.toFixed()) },
            {
              label: 'Difference',
              value: formatMoney(totals.salesDifference.toFixed()),
            },
            {
              label: 'Cash difference',
              value: totals.cash.difference ? formatMoney(totals.cash.difference.toFixed()) : '—',
            },
          ]}
          note="You won’t be able to change these figures unless a manager sends them back."
          confirmLabel="Submit"
          busy={busy}
          onConfirm={() => void submitForReview()}
          onClose={() => setConfirmSubmit(false)}
        />

        <footer className="entry-footer">
          <Button
            variant="secondary"
            onClick={() => void goToStep(step - 1)}
            disabled={step === 0 || busy}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => void goToStep(step + 1)} loading={busy}>
              Next
            </Button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

export function DailyOperationsContextRequired() {
  return (
    <>
      <div className="page-header">
        <div>
          <p className="lede">Choose a station to begin.</p>
        </div>
      </div>
      <Card as="section" className="panel" aria-labelledby="operations-context-title">
        <SectionHeading
          eyebrow="Station context"
          title="Choose a station"
          headingId="operations-context-title"
          detail="Use the station selector above to choose a station, business date and shift."
        />
        <p>The daily workspace will load once the selected work context is ready.</p>
      </Card>
    </>
  );
}
