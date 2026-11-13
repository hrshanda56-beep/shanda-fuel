'use client';
import type { RecordData } from '../daily-operations-read-model';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm, useToast } from '../../../design-system/feedback-provider';
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
import {
  clearDraft as clearLocalDraft,
  draftStorageKey,
  loadDraft as loadLocalDraft,
  saveDraft as saveLocalDraft,
  type StoredDraft,
} from '../../../platform/drafts/local-draft';
import {
  OfflineError,
  classifyFailure,
  discardQueued,
  enqueueSave,
  listQueued,
  outboxStorageKey,
  syncQueued,
  type QueuedSave,
  type StepResult,
} from '../../../platform/drafts/outbox';
import { DocumentAttachments } from '../../documents/ui/document-attachments';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import Link from 'next/link';
import { InfoTip } from '../../../design-system/info-tip';
import { DailyTankDips } from './daily-tank-dips';
import { PumpReadout } from './pump-readout';
import { OpeningReadingsEntry } from './opening-readings-entry';
import { TRANSITION_SUCCESS } from './transition-messages';
import { sumDecimals } from '../../cash/ui/cash-visuals';
import {
  formatBusinessDate,
  formatDateTimeInTimeZone,
  formatDecimal,
  formatLitres,
  formatMoney,
  formatStatusLabel,
  formatTimeInTimeZone,
  moneyInputValue,
} from '../../../design-system/formatters';
import {
  dailyOperationsProblem,
  dailyOperationsStatusLabel,
  dailyOperationsStatusTone,
  isEditableDailyOperationsState,
  liveCashFigures,
  liveLitresSold,
  liveSalesValue,
  liveSalesFigures,
  stepTitle,
  type DailyOperationsFix,
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
  viewerMembershipId?: string;
  station: { id: string; code: string; name: string; timezone: string };
  organisation: { id: string; name: string };
  businessDay: { id: string; date: string; state: string; version: number };
  reconciliationId?: string | null;
  shift: {
    id: string;
    state: string;
    businessDate: string;
    plannedStartAt: string;
    plannedEndAt: string;
    version: number;
  };
  attendants: Array<{ id: string; name: string }>;
  otherAttendants?: Array<{ id: string; name: string; stationName: string }>;
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
  /** Credit and prepaid sales name the customer; approved fuel names who received it. */
  customerAccountId: string;
  beneficiaryName: string;
};

const ACCOUNT_TYPE_FOR_METHOD: Partial<Record<PaymentMethod, 'CREDIT' | 'PREPAID_VALUE'>> = {
  CUSTOMER_CREDIT: 'CREDIT',
  PREPAID: 'PREPAID_VALUE',
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

const expensePaymentMethods: readonly PaymentMethod[] = ['CASH', 'ECOCASH', 'BANK_TRANSFER', 'POS'];

const methodLabels: Record<PaymentMethod, string> = {
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

const STEPS = ['Team', 'Pumps', 'Payments', 'Expenses', 'Cash', 'Tank dips', 'Submit'] as const;

/** The first letters of the first two words of a name, for the small round marker beside it. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

function newRowKey(): string {
  return crypto.randomUUID();
}

function paymentFromRecord(payment: RecordData['payments'][number]): Payment & { rowKey: string } {
  return {
    rowKey: payment.id || newRowKey(),
    id: payment.id,
    method: payment.method as PaymentMethod,
    amount: moneyInputValue(payment.amount),
    reference: payment.reference ?? '',
    note: payment.note ?? '',
    customerAccountId: payment.customerAccountId ?? '',
    beneficiaryName: payment.beneficiaryName ?? '',
  };
}

function expenseFromRecord(expense: RecordData['expenses'][number]): Expense & { rowKey: string } {
  return {
    rowKey: expense.id || newRowKey(),
    id: expense.id,
    category: expense.category,
    description: expense.description,
    amount: moneyInputValue(expense.amount),
    paymentMethod: expense.paymentMethod as PaymentMethod,
    personPaid: expense.personPaid ?? '',
    reference: expense.reference ?? '',
  };
}

/** Who was saved on the shift; before anything is saved, every attendant set up for the station. */
function startingAttendants(
  record: RecordData | null,
  operation: Pick<OperationsContext, 'attendants'>,
): string[] {
  if (record?.attendants.length) return record.attendants.map((row) => row.attendantId);
  if (record && !isEditableDailyOperationsState(record.state)) return [];
  return operation.attendants.map((attendant) => attendant.id);
}

/**
 * A closing reading equal to the opening means the pump sold nothing. A reading saved when the
 * shift opened starts exactly there, so only pumps that did sell need their closing changed.
 */
function readingFromRecord(reading: Reading & { id: string }): Reading & { rowKey: string } {
  return { ...reading, rowKey: reading.id };
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

type OperationsFailure = Error & { status?: number; code?: string; fix?: DailyOperationsFix };

/** The button that goes with a shown error, kept with its message so it never outlives it. */
type ErrorFix = { message: string; fix: DailyOperationsFix };

function errorFixFor(message: string, cause: unknown): ErrorFix | undefined {
  const fix = (cause as OperationsFailure | undefined)?.fix;
  return fix ? { message, fix } : undefined;
}

function errorFromResponse(status: number, body: unknown): OperationsFailure {
  const result = body as { error?: string; message?: string; details?: Record<string, unknown> };
  const problem = dailyOperationsProblem(status, result.error, result.message);
  const failure = new Error(problem.message) as OperationsFailure;
  failure.fix = problem.fix;
  failure.status = status;
  failure.code = result.error;
  Object.assign(failure, { details: result.details });
  return failure;
}

function isZero(value: string | null | undefined): boolean {
  return value === null || value === undefined || /^-?0(?:\.0+)?$/.test(value);
}

function SectionHeading({
  title,
  detail,
  headingId,
  asTip = false,
  action,
}: {
  /** A button shown at the right end of the heading row. */
  action?: React.ReactNode;
  title: string;
  detail?: string;
  headingId: string;
  /** The explanation sits behind a "?" for people reviewing; people entering see it written out. */
  asTip?: boolean;
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <span className="heading-with-tip">
          <h2 id={headingId} className="profit-title">
            {title}
          </h2>
          {detail && asTip ? <InfoTip>{detail}</InfoTip> : null}
        </span>
        {action}
      </div>
      {detail && !asTip ? <p className="panel-detail">{detail}</p> : null}
    </>
  );
}

type LocalDraftData = {
  readings: Array<Reading & { rowKey: string }>;
  payments: Array<Payment & { rowKey: string }>;
  expenses: Array<Expense & { rowKey: string }>;
  attendantIds: string[];
  cashCounted: string;
  explanations: Record<string, string>;
};

export function DailyOperationsWorkspace({
  context,
  role = 'SUPERVISOR',
  initialData,
}: {
  context: DailyOperationsContext;
  initialData?: {
    operation: OperationsContext;
    record: RecordData | null;
    cash?: {
      availableAtStation: string;
      collectedButUnbanked: string;
      pendingBankConfirmation: string;
    };
    settlements: Array<{ providerName: string; state: string; unallocatedProviderAmount: string }>;
  };
  role?: 'SUPERVISOR' | 'MANAGEMENT';
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [activeReconciliationId, setActiveReconciliationId] = useState(context.reconciliationId);
  const [operation, setOperation] = useState<OperationsContext | null>(
    initialData?.operation ?? null,
  );
  const [record, setRecord] = useState<RecordData | null>(initialData?.record ?? null);
  const [readings, setReadings] = useState<Array<Reading & { rowKey: string }>>(
    initialData
      ? initialData.record?.readings.length
        ? initialData.record.readings.map(readingFromRecord)
        : initialData.operation.availableReadings.map((reading) =>
            readingFromContext(reading, context.shiftId),
          )
      : [],
  );
  const [payments, setPayments] = useState<Array<Payment & { rowKey: string }>>(
    initialData?.record?.payments.map(paymentFromRecord) ?? [],
  );
  const [expenses, setExpenses] = useState<Array<Expense & { rowKey: string }>>(
    initialData?.record?.expenses.map(expenseFromRecord) ?? [],
  );
  // Until the supervisor has saved who worked, everyone set up for the station starts ticked;
  // they untick whoever was absent. Nothing is recorded until the draft is saved.
  const [attendantIds, setAttendantIds] = useState<string[]>(() =>
    initialData ? startingAttendants(initialData.record, initialData.operation) : [],
  );
  const [cashCounted, setCashCounted] = useState(
    moneyInputValue(initialData?.record?.cash?.countedCash ?? ''),
  );
  const [approvalNote, setApprovalNote] = useState(initialData?.record?.approvalNote ?? '');
  const [explanations, setExplanations] = useState<Record<string, string>>(
    Object.fromEntries(
      initialData?.record?.explanations.map((row) => [row.category, row.explanation]) ?? [],
    ),
  );
  const [loading, setLoading] = useState(!initialData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [errorFix, setErrorFix] = useState<ErrorFix>();
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [correctingOpening, setCorrectingOpening] = useState(false);
  /** Pumps whose closing the person has typed into; the rest only show the opening as a hint. */
  const [closingTouched, setClosingTouched] = useState<Set<string>>(() => new Set());
  const [correctionReason, setCorrectionReason] = useState('');
  const [dirty, setDirty] = useState(
    () =>
      Boolean(initialData) &&
      !initialData?.record?.attendants.length &&
      startingAttendants(initialData?.record ?? null, initialData!.operation).length > 0,
  );
  const [step, setStep] = useState(0);
  // A refresh keeps the person on the step they were on: it is kept in the address, not just in memory.
  const stepRestored = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = Number(new URL(window.location.href).searchParams.get('step'));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after load; the server cannot know the address
    if (Number.isInteger(saved) && saved > 0 && saved < STEPS.length) setStep(saved);
  }, []);
  useEffect(() => {
    // The first run is the initial render, before the saved step has been applied.
    if (!stepRestored.current) {
      stepRestored.current = true;
      return;
    }
    const url = new URL(window.location.href);
    if (step > 0) url.searchParams.set('step', String(step));
    else url.searchParams.delete('step');
    if (url.href !== window.location.href)
      window.history.replaceState(window.history.state, '', url);
  }, [step]);
  const [returnReason, setReturnReason] = useState('');
  const [returning, setReturning] = useState(false);
  const [stepUpRetry, setStepUpRetry] = useState<{
    values: Record<string, unknown>;
    savedVersion?: number;
  } | null>(null);
  const saveJournal = useRef<DraftSaveJournal | undefined>(undefined);

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
        const everyone = startingAttendants(null, nextOperation);
        setAttendantIds(everyone);
        setDirty(everyone.length > 0);
        setCashCounted('');
        setApprovalNote('');
        setExplanations({});
        return;
      }
      const nextReadings = next.readings.length
        ? next.readings.map(readingFromRecord)
        : nextOperation.availableReadings.map((reading) =>
            readingFromContext(reading, context.shiftId),
          );
      setReadings(nextReadings);
      setPayments(next.payments.map(paymentFromRecord));
      setExpenses(next.expenses.map(expenseFromRecord));
      const saved = startingAttendants(next, nextOperation);
      setAttendantIds(saved);
      setCashCounted(moneyInputValue(next.cash?.countedCash ?? ''));
      setApprovalNote(next.approvalNote ?? '');
      setExplanations(
        Object.fromEntries(next.explanations.map((item) => [item.category, item.explanation])),
      );
      setDirty(!next.attendants.length && saved.length > 0);
    },
    [context.shiftId],
  );

  const load = useCallback(
    async (options?: { quiet?: boolean }) => {
      // A quiet reload refreshes the figures in place, so the step and the scroll position stay put.
      if (!options?.quiet) setLoading(true);
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
        const message =
          cause instanceof Error ? cause.message : 'The operations workspace could not be loaded.';
        setError(message);
        setErrorFix(errorFixFor(message, cause));
      } finally {
        setLoading(false);
      }
    },
    [activeReconciliationId, context.stationId, context.tenantId, contextQuery, syncDraft],
  );
  const reloadQuietly = useCallback(() => load({ quiet: true }), [load]);

  useEffect(() => {
    if (initialData && activeReconciliationId === context.reconciliationId) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, initialData, activeReconciliationId, context.reconciliationId]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty]);

  async function sendCommand(
    commandType: string,
    values: Record<string, unknown>,
    idempotencyKey = `ui-${commandType}-${activeReconciliationId ?? 'new'}-${crypto.randomUUID()}`,
  ): Promise<CommandResult> {
    let response: Response;
    try {
      response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ commandType, ...values }),
      });
    } catch {
      throw new OfflineError();
    }
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
    } catch (cause) {
      const failure = cause as OperationsFailure & {
        details?: { existingReconciliationId?: unknown };
      };
      const existingId = failure.details?.existingReconciliationId;
      if (failure.code === 'RECONCILIATION_ALREADY_EXISTS' && typeof existingId === 'string') {
        setActiveReconciliationId(existingId);
        const url = new URL(window.location.href);
        url.searchParams.set('reconciliationId', existingId);
        window.location.assign(url.toString());
        return;
      }
      const message = cause instanceof Error ? cause.message : 'The draft could not be created.';
      setError(message);
      setErrorFix(errorFixFor(message, cause));
    } finally {
      setBusy(false);
    }
  }

  // Arriving at a running shift with no figures yet goes straight to entering them: the person
  // never has to press a "begin" button. A failed attempt shows its error and leaves the button.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || loading || record || !operation || error) return;
    if (operation.shift.state !== 'OPEN' || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      autoStarted.current = true;
      void createDraft();
    }, 0);
    return () => window.clearTimeout(timer);
  });

  /** Saves the draft; resolves to the new revision version, or null when nothing was saved. */
  async function saveDraft(announce = false): Promise<number | null> {
    savedForLater.current = false;
    if (!record || !operation) return null;
    if (correctingOpening && correctionReason.trim().length < 5) {
      setError(
        'Say why the opening reading is being corrected (at least 5 characters). Nothing was saved.',
      );
      return null;
    }
    if (readings.some((reading) => !reading.sellingPriceId)) {
      const message =
        'A current active selling price is required for every meter row before saving.';
      setError(message);
      setErrorFix({
        message,
        fix: {
          kind: 'link',
          label: 'Set the selling price',
          href: '/operations/daily/price-change',
        },
      });
      return null;
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
                ...(correctingOpening ? { openingCorrectionReason: correctionReason.trim() } : {}),
                readings: readings.map(
                  ({
                    rowKey: _rowKey,
                    label: _label,
                    unitPrice: _unitPrice,
                    litresSold: _litresSold,
                    salesValue: _salesValue,
                    ...reading
                  }) => ({
                    ...reading,
                    // Not entered yet means still equal to the opening; never an empty number.
                    closingReading: reading.closingReading.trim() || reading.openingReading,
                  }),
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
                  customerAccountId: ACCOUNT_TYPE_FOR_METHOD[payment.method]
                    ? payment.customerAccountId || undefined
                    : undefined,
                  beneficiaryName:
                    payment.method === 'STAFF_OR_MANAGEMENT_FUEL'
                      ? payment.beneficiaryName.trim() || undefined
                      : undefined,
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
      clearLocalDraft(draftKey);
      setNotice('Draft saved to the server.');
      if (announce) toast.success('Saved. Your figures are stored and nothing has been sent yet.');
      await load();
      return journal.version;
    } catch (cause) {
      const journal = saveJournal.current;
      if (cause instanceof OfflineError && journal && keepSaveForLater(journal)) {
        saveJournal.current = undefined;
        setDirty(false);
        clearLocalDraft(draftKey);
        savedForLater.current = true;
        setNotice(
          'There is no connection. Your entries are kept on this device and will be sent when you are back online.',
        );
        return null;
      }
      const message = cause instanceof Error ? cause.message : 'The draft could not be saved.';
      setError(message);
      setErrorFix(errorFixFor(message, cause));
      if (message.includes('changed elsewhere') || message.includes('locked')) setConflict(true);
      saveJournal.current = undefined;
      await load();
      setError(message);
      setNotice(
        'That did not save. We reloaded what is saved on the server. Check your entries and try again.',
      );
      return null;
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
      setNotice('Shift started.');
      toast.success('Shift started. You can now enter the figures.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The shift could not be opened.';
      setError(message);
      setErrorFix(errorFixFor(message, cause));
    } finally {
      setBusy(false);
    }
  }

  async function transition(
    commandType: string,
    values: Record<string, unknown> = {},
    savedVersion?: number,
    skipConfirmation = false,
  ) {
    if (!record || (dirty && savedVersion === undefined)) {
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
    setError(undefined);
    try {
      await sendCommand(commandType, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        reconciliationId: activeReconciliationId,
        expectedVersion: savedVersion ?? record.version,
        ...values,
      });
      await load();
      const done = TRANSITION_SUCCESS[commandType] ?? 'Workflow state updated.';
      setNotice(done);
      toast.success(done);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      const failure = cause as OperationsFailure;
      if (
        commandType === 'ApproveProductionReconciliation' &&
        failure.status === 403 &&
        failure.code === 'STEP_UP_REQUIRED'
      ) {
        setStepUpRetry({ values, savedVersion });
      } else {
        const message = cause instanceof Error ? cause.message : 'The workflow transition failed.';
        setError(message);
        setErrorFix(errorFixFor(message, cause));
        if (message.includes('changed elsewhere') || message.includes('locked')) setConflict(true);
      }
    } finally {
      setBusy(false);
    }
  }

  // Stage 1 of offline drafts: a copy of the unsent entries is kept on this device, so a dropped
  // connection or a closed tab does not lose them. It is offered back, never applied silently.
  const draftKey = draftStorageKey([
    'daily',
    operation?.viewerMembershipId,
    context.tenantId,
    context.stationId,
    activeReconciliationId ?? 'new',
    context.shiftId,
  ]);
  const draftBase = String(record?.version ?? 'new');
  const [restorable, setRestorable] = useState<StoredDraft<LocalDraftData> | null>(null);
  useEffect(() => {
    if (loading || dirty) return;
    void Promise.resolve().then(() =>
      setRestorable(loadLocalDraft<LocalDraftData>(draftKey, draftBase)),
    );
  }, [draftKey, draftBase, loading, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(
      () =>
        saveLocalDraft<LocalDraftData>(draftKey, draftBase, {
          readings,
          payments,
          expenses,
          attendantIds,
          cashCounted,
          explanations,
        }),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [
    dirty,
    draftKey,
    draftBase,
    readings,
    payments,
    expenses,
    attendantIds,
    cashCounted,
    explanations,
  ]);
  function restoreLocalDraft() {
    if (!restorable) return;
    setReadings(restorable.data.readings);
    setPayments(restorable.data.payments);
    setExpenses(restorable.data.expenses);
    setAttendantIds(restorable.data.attendantIds);
    setCashCounted(restorable.data.cashCounted);
    setExplanations(restorable.data.explanations);
    setDirty(true);
    setRestorable(null);
    setNotice('Your earlier entries were restored. They are not saved to the server yet.');
  }
  function discardLocalDraft() {
    clearLocalDraft(draftKey);
    setRestorable(null);
  }

  // Stage 2: a save that could not reach the server waits on this device and is sent again, with
  // the same idempotency keys, when the connection returns.
  const outboxKey = outboxStorageKey([
    'daily',
    operation?.viewerMembershipId,
    context.tenantId,
    context.stationId,
  ]);
  const [queued, setQueued] = useState<QueuedSave[]>([]);
  const [sending, setSending] = useState(false);
  const refreshQueued = useCallback(() => setQueued(listQueued(outboxKey)), [outboxKey]);
  function keepSaveForLater(journal: DraftSaveJournal): boolean {
    const common = {
      tenantId: context.tenantId,
      stationId: context.stationId,
      reconciliationId: activeReconciliationId,
    };
    const kept = enqueueSave(outboxKey, {
      id: journal.saveAttemptId,
      url: '/api/forecourt/commands',
      label: `Daily report ${operation?.businessDay.date ?? ''}`.trim(),
      version: journal.version,
      nextIndex: journal.nextIndex,
      steps: journal.commands.map((command, index) => ({
        commandType: command.commandType,
        body: { commandType: command.commandType, ...common, ...command.values },
        idempotencyKey: draftSaveCommandKey({
          reconciliationId: activeReconciliationId ?? 'new',
          saveAttemptId: journal.saveAttemptId,
          commandIndex: index,
          commandType: command.commandType,
        }),
      })),
    });
    if (kept) refreshQueued();
    return kept;
  }
  const sendQueued = useCallback(async () => {
    setSending(true);
    try {
      const outcome = await syncQueued(outboxKey, async (step, version, save) => {
        let response: Response;
        try {
          response = await fetch(save.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': step.idempotencyKey,
            },
            body: JSON.stringify({ ...step.body, expectedVersion: version }),
          });
        } catch {
          return { kind: 'retry' } satisfies StepResult;
        }
        const body: unknown = await response.json().catch(() => ({}));
        if (response.ok) {
          const next = (body as CommandResult).version;
          return { kind: 'ok', version: typeof next === 'number' ? next : null } as StepResult;
        }
        return classifyFailure(response.status, errorFromResponse(response.status, body).message);
      });
      refreshQueued();
      if (outcome.sent.length > 0) {
        setNotice('Entries that were waiting on this device have now been saved to the server.');
        await load();
      }
    } finally {
      setSending(false);
    }
  }, [outboxKey, refreshQueued, load]);
  useEffect(() => {
    if (loading || typeof window === 'undefined') return;
    void Promise.resolve().then(() => {
      refreshQueued();
      if (listQueued(outboxKey).some((save) => save.status === 'WAITING')) void sendQueued();
    });
    const onOnline = () => void sendQueued();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [loading, outboxKey, refreshQueued, sendQueued]);
  const savedForLater = useRef(false);
  const [unsavedDips, setUnsavedDips] = useState<string[]>([]);

  async function goToStep(next: number) {
    if (
      step === 1 &&
      next > 1 &&
      editable &&
      readings.some((reading) => !reading.closingReading.trim())
    ) {
      setError('Enter the closing reading for every pump before you continue.');
      return;
    }
    if (step === STEPS.indexOf('Tank dips') && next > step && editable && unsavedDips.length > 0) {
      setError(
        `Save the ${unsavedDips.join(' and ')} dip before you continue. Press Save dip beside it.`,
      );
      return;
    }
    if (dirty && editable) {
      const saved = await saveDraft();
      if (saved === null && !savedForLater.current) return;
    }
    setStep(Math.max(0, Math.min(next, STEPS.length - 1)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // The way to put the shown problem right: a link to the page that fixes it, or a jump to the
  // step of this workspace where it can be corrected.
  const errorAction = errorFix && errorFix.message === error ? errorFix.fix : undefined;
  async function closeShiftNow() {
    const agreed = await confirm({
      title: 'Close this shift?',
      consequence:
        'The pump readings become the official meter records for the shift, and the shift is finished. This cannot be undone from here.',
      confirmLabel: 'Close Shift',
      tone: 'warning',
    });
    if (!agreed) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        tenantId: context.tenantId,
        stationId: context.stationId,
        businessDayId: context.businessDayId,
        shiftId: context.shiftId,
      });
      const overviewResponse = await fetch(`/api/forecourt/operations/overview?${params}`, {
        cache: 'no-store',
      });
      if (!overviewResponse.ok)
        throw new Error('The shift could not be found. Refresh and try again.');
      const overview = (await overviewResponse.json()) as {
        shifts: Array<{ id: string; state: string; version: number }>;
      };
      const shift = overview.shifts.find((candidate) => candidate.id === context.shiftId);
      if (!shift) throw new Error('The shift could not be found. Refresh and try again.');
      const base = {
        tenantId: context.tenantId,
        stationId: context.stationId,
        businessDayId: context.businessDayId,
        shiftId: context.shiftId,
      };
      const send = async (commandType: string, expectedVersion: number) => {
        const response = await fetch('/api/forecourt/commands', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': `close-shift-${commandType}-${context.shiftId}-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ commandType, ...base, expectedVersion }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          throw new Error(
            dailyOperationsProblem(response.status, body.error, body.message).message,
          );
        }
      };
      if (shift.state === 'OPEN') {
        await send('CloseMeters', shift.version);
        await send('CompleteShift', shift.version + 1);
      } else if (shift.state === 'METER_CLOSED') {
        await send('CompleteShift', shift.version);
      }
      setError(undefined);
      setErrorFix(undefined);
      toast.success('Shift closed. You can approve now.');
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The shift could not be closed.';
      setError(message);
      setErrorFix(undefined);
    } finally {
      setBusy(false);
    }
  }

  const errorFixButton = errorAction ? (
    errorAction.kind === 'close-shift' ? (
      <Button onClick={() => void closeShiftNow()} loading={busy}>
        {errorAction.label}
      </Button>
    ) : errorAction.kind === 'link' ? (
      <Link className="button button-primary" href={errorAction.href}>
        {errorAction.label}
      </Link>
    ) : (
      <Button
        onClick={() => {
          setError(undefined);
          setStep(errorAction.step);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      >
        {errorAction.label}
      </Button>
    )
  ) : undefined;

  async function submitForReview() {
    if (attendantIds.length === 0) {
      setError('Select at least one attendant before submitting this reconciliation.');
      setStep(0);
      return;
    }
    if (!dirty) {
      await transition('SubmitProductionReconciliation');
      return;
    }
    const saved = await saveDraft();
    if (saved !== null) await transition('SubmitProductionReconciliation', {}, saved);
  }

  const editable = isEditableDailyOperationsState(record?.state);
  const visitingAttendants = operation?.otherAttendants ?? [];
  const liveCash = liveCashFigures(payments, expenses, cashCounted);
  const liveSales = record
    ? liveSalesFigures(record.totals.expectedSales, readings, payments)
    : null;
  const state = record?.state ?? 'NOT_STARTED';
  const requiresSalesExplanation = record ? !isZero(record.totals.salesVariance) : false;
  const requiresCashExplanation = record ? !isZero(record.totals.cashVariance) : false;
  const requiresStockExplanation = record
    ? Object.values(record.totals.stockVariance).some((value) => !isZero(value))
    : false;
  // A button is shown only when the server says this person may use it: a supervisor never sees
  // Return, and the person who submitted never sees Approve.
  const inReview = role === 'MANAGEMENT' && state === 'SUBMITTED';
  const mayReturn = inReview && record?.canReturn === true;
  const mayApprove = inReview && record?.canApprove === true && !record.approvalBlocked;
  const approvalWaitsForSomeoneElse =
    inReview && record?.canApprove === true && Boolean(record.approvalBlocked);
  const requiresApproverNote = mayApprove && Boolean(record?.requiresApproverNote);

  const checklist = record
    ? [
        {
          label: 'Closing reading entered for every pump',
          ok: readings.length > 0 && readings.every((item) => item.closingReading.trim() !== ''),
        },
        { label: 'Payments added', ok: payments.length > 0 },
        { label: 'Cash counted', ok: cashCounted.trim() !== '' },
        {
          label: 'Differences explained',
          ok:
            (!requiresSalesExplanation || (explanations.SALES ?? '').trim() !== '') &&
            (!requiresCashExplanation || (explanations.CASH ?? '').trim() !== '') &&
            (!requiresStockExplanation || (explanations.STOCK ?? '').trim() !== ''),
        },
      ]
    : [];

  if (loading)
    return (
      <>
        {notice ? (
          <div className="state state-success" role="status" aria-live="polite">
            {notice}
          </div>
        ) : null}
        <LoadingState label="Loading daily operations" />
      </>
    );
  if (error && !operation) {
    return (
      <ErrorState
        title="Operations unavailable"
        message={error}
        action={errorFixButton ?? <Button onClick={() => void load()}>Retry</Button>}
        secondaryAction={
          errorFixButton ? <Button onClick={() => void load()}>Retry</Button> : undefined
        }
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
          <ErrorState
            message={error}
            action={errorFixButton ?? <Button onClick={() => void load()}>Retry</Button>}
            secondaryAction={
              errorFixButton ? <Button onClick={() => void load()}>Retry</Button> : undefined
            }
          />
        ) : null}
        <p className="muted-small">
          Got the supervisor&apos;s WhatsApp message?{' '}
          <Link href="/operations/daily/check-message">Check it before you enter it</Link>.
        </p>
        <Card
          as="section"
          className="panel profit-panel cash-panel operations-start-card"
          aria-labelledby="operations-start-title"
        >
          <SectionHeading
            asTip={role === 'MANAGEMENT'}
            title="Start today's reconciliation"
            headingId="operations-start-title"
            detail="You will enter the pump readings, how customers paid, expenses and the cash count, one step at a time. Everything is saved as you go."
          />
          <dl className="operational-summary">
            <div>
              <dt>Station</dt>
              <dd>{operation.station.name}</dd>
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
          {operation.shift.state === 'PLANNED' ? (
            <p className="panel-detail">This shift has not started. Start it first, then begin.</p>
          ) : null}
          <div className="form-actions">
            {operation.shift.state === 'PLANNED' ? (
              <Button variant="secondary" onClick={() => void startShift()} loading={busy}>
                Start the shift
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => void createDraft()} loading={busy}>
              Begin reconciliation
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // A shift that has just opened asks for its opening readings first, and nothing else.
  if (
    record &&
    editable &&
    record.readings.length === 0 &&
    operation.shift.state === 'OPEN' &&
    activeReconciliationId
  ) {
    return (
      <OpeningReadingsEntry
        tenantId={context.tenantId}
        stationId={context.stationId}
        shiftId={context.shiftId}
        reconciliationId={activeReconciliationId}
        version={record.version}
        pumps={operation.availableReadings.map((reading) => ({
          nozzleId: reading.nozzleId,
          pumpNumber: reading.pumpNumber,
          nozzleNumber: reading.nozzleNumber,
          productId: reading.productId,
          productName: reading.productName,
          sellingPriceId: reading.sellingPriceId,
          previousReading: reading.previousReading,
        }))}
      />
    );
  }

  return (
    <div className="daily-operations-workspace" aria-label="Daily station operations workspace">
      <div className="entry-head profit-top">
        <p className="profit-period">
          <strong>{formatBusinessDate(record.business_date)}</strong>
          <span>
            {formatTimeInTimeZone(operation.shift.plannedStartAt, operation.station.timezone)} –{' '}
            {formatTimeInTimeZone(operation.shift.plannedEndAt, operation.station.timezone)}
          </span>
        </p>
        <div className="workspace-status">
          {state === 'SUBMITTED' ? null : (
            <StatusBadge tone={dailyOperationsStatusTone(state)}>
              {dailyOperationsStatusLabel(state)}
            </StatusBadge>
          )}
          {dirty ? (
            <span className="dirty-indicator">Unsaved changes (copy kept on this device)</span>
          ) : role === 'MANAGEMENT' ? null : (
            <span className="saved-indicator">Saved</span>
          )}
        </div>
        <nav className="entry-steps profit-tabs" aria-label="Steps">
          {STEPS.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-current={index === step ? 'step' : undefined}
              data-done={index < step || undefined}
              disabled={busy}
              onClick={() => void goToStep(index)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {error || notice ? (
        <div className="entry-notices">
          {error ? (
            <ErrorState
              title={conflict ? 'Refresh required' : 'Something needs attention'}
              message={error}
              action={errorFixButton ?? <Button onClick={() => void load()}>Refresh</Button>}
              secondaryAction={
                errorFixButton ? <Button onClick={() => void load()}>Refresh</Button> : undefined
              }
            />
          ) : null}
          {notice ? (
            <div className="state state-success" role="status" aria-live="polite">
              {notice}
            </div>
          ) : null}
        </div>
      ) : null}
      {queued.length > 0 ? (
        <div className="state" role="status" aria-live="polite">
          {queued.map((save) => (
            <div key={save.id}>
              <p>
                {save.status === 'WAITING'
                  ? `${save.label}: saved on this device, waiting to be sent.`
                  : save.status === 'CONFLICT'
                    ? `${save.label}: not sent. ${save.message ?? 'The report was changed elsewhere.'} Review the report on screen, then throw these entries away or re-enter them.`
                    : `${save.label}: not accepted by the server. ${save.message ?? ''}`.trim()}
              </p>
              {save.status === 'WAITING' ? (
                <Button onClick={() => void sendQueued()} loading={sending}>
                  Send now
                </Button>
              ) : null}{' '}
              <Button
                variant="quiet"
                onClick={() => {
                  discardQueued(outboxKey, save.id);
                  refreshQueued();
                }}
              >
                Throw them away
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {restorable && editable ? (
        <div className="state" role="status" aria-live="polite">
          <p>
            You have entries from{' '}
            {formatDateTimeInTimeZone(new Date(restorable.savedAt), operation.station.timezone)}{' '}
            that were never saved to the server. They are only on this device.
          </p>
          <Button onClick={restoreLocalDraft}>Bring them back</Button>{' '}
          <Button variant="quiet" onClick={discardLocalDraft}>
            Throw them away
          </Button>
        </div>
      ) : null}

      <div
        className="entry-card-wrap"
        data-actions={(step > 0 ? 1 : 0) + (step < STEPS.length - 1 ? 1 : 0)}
        data-link={
          state === 'SUBMITTED' && step === STEPS.length - 1 && !mayApprove ? '' : undefined
        }
      >
        <div className="entry-body card panel profit-panel">
          <div className="entry-rail">
            <aside className="entry-side" aria-labelledby="entry-side-title">
              <span className="heading-with-tip">
                <h2 id="entry-side-title" className="profit-title">
                  This shift
                </h2>
                <InfoTip>Totals so far. They update as you type.</InfoTip>
              </span>
              <dl className="profit-rows" aria-label="Totals so far">
                <div className="profit-row">
                  <dt>Expected sales</dt>
                  <dd>{formatMoney(liveSales?.expected ?? record.totals.expectedSales)}</dd>
                </div>
                <div className="profit-row">
                  <dt>Accounted for</dt>
                  <dd>{formatMoney(liveSales?.accounted ?? record.totals.accountedSales)}</dd>
                </div>
                <div
                  className="profit-row"
                  data-strong
                  data-tone={
                    isZero(liveSales?.difference ?? record.totals.salesVariance)
                      ? undefined
                      : 'warning'
                  }
                >
                  <dt>Sales difference</dt>
                  <dd>{formatMoney(liveSales?.difference ?? record.totals.salesVariance)}</dd>
                </div>
                {record.totals.cashVariance !== null ? (
                  <div
                    className="profit-row"
                    data-strong
                    data-tone={isZero(record.totals.cashVariance) ? undefined : 'warning'}
                  >
                    <dt>Cash difference</dt>
                    <dd>{formatMoney(record.totals.cashVariance)}</dd>
                  </div>
                ) : null}
              </dl>
            </aside>
          </div>

          <div className="entry-flow">
            {step === 0 && record.submitter ? (
              <div className="submitted-by">
                <span className="submitted-by-avatar" aria-hidden="true">
                  {initialsOf(record.submitter.name)}
                </span>
                <p className="submitted-by-name">
                  <span>Submitted by</span> <strong>{record.submitter.name}</strong>
                </p>
                {record.submitter.submittedAt ? (
                  <p className="submitted-by-when">
                    {formatDateTimeInTimeZone(
                      new Date(record.submitter.submittedAt),
                      operation.station.timezone,
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
            {step === 0 ? (
              <Card
                as="section"
                className="panel profit-panel cash-panel"
                id="operations-shift"
                aria-labelledby="operations-shift-title"
              >
                <SectionHeading
                  asTip={role === 'MANAGEMENT'}
                  title="Attendants"
                  headingId="operations-shift-title"
                  detail={
                    role === 'MANAGEMENT'
                      ? 'The people recorded on this shift.'
                      : 'Tick everyone who worked this shift.'
                  }
                />
                <fieldset className="attendant-fieldset" disabled={!editable}>
                  <legend className="sr-only">Attendants</legend>
                  {operation.attendants.length === 0 ? (
                    <p className="panel-detail">
                      No attendants are set up for this station yet. Ask your manager to add them.
                    </p>
                  ) : (
                    <div className="attendant-group">
                      {visitingAttendants.length > 0 ? (
                        <p className="attendant-group-label">This station</p>
                      ) : null}
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
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {visitingAttendants.length > 0 ? (
                    <div className="attendant-group">
                      <p className="attendant-group-label">Covering from another station</p>
                      <div className="choice-grid">
                        {visitingAttendants.map((attendant) => (
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
                              <span className="metric-meta">
                                {' '}
                                Usually at {attendant.stationName}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </fieldset>
              </Card>
            ) : null}

            {step === 1 ? (
              <Card
                as="section"
                className="panel profit-panel cash-panel"
                id="operations-meters"
                aria-labelledby="operations-meters-title"
              >
                <SectionHeading
                  asTip={role === 'MANAGEMENT'}
                  title="Pump readings"
                  headingId="operations-meters-title"
                  detail="Enter the closing reading for every pump. The opening readings were recorded when the shift opened."
                  action={
                    editable && record?.canCorrectOpening && !correctingOpening ? (
                      <Button variant="secondary" onClick={() => setCorrectingOpening(true)}>
                        Correction
                      </Button>
                    ) : null
                  }
                />
                {readings.length === 0 ? (
                  <EmptyState
                    title="No pumps set up yet"
                    message="Your manager needs to set up the pumps for this station before readings can be entered."
                  />
                ) : (
                  <div className="meter-list">
                    {editable && record?.canCorrectOpening ? (
                      correctingOpening ? (
                        <div className="form-grid">
                          <Field
                            id="opening-correction-reason"
                            label="Why is the opening being corrected?"
                            hint="Kept in the audit trail with your name and the old reading."
                            required
                          >
                            <input
                              id="opening-correction-reason"
                              value={correctionReason}
                              onChange={(event) => setCorrectionReason(event.target.value)}
                            />
                          </Field>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setCorrectingOpening(false);
                              setCorrectionReason('');
                              setReadings(record.readings.map(readingFromRecord));
                            }}
                          >
                            Cancel correction
                          </Button>
                        </div>
                      ) : null
                    ) : null}
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
                        const liveLitres = liveLitresSold(
                          reading.openingReading,
                          reading.closingReading,
                        );
                        const belowOpening = liveLitres?.startsWith('-') ?? false;
                        const litresShown = belowOpening
                          ? null
                          : (liveLitres ?? reading.litresSold);
                        const liveValue = belowOpening
                          ? null
                          : liveSalesValue(litresShown, reading.unitPrice);
                        const valueShown = liveValue ?? reading.salesValue;
                        const soldText = litresShown ? formatLitres(litresShown) : null;
                        const sold = soldText?.endsWith(' L')
                          ? { value: soldText.slice(0, -2), unit: 'L' }
                          : { value: soldText ?? '—', unit: undefined };
                        return (
                          <article className="pump-row" key={reading.rowKey}>
                            <div className="pump-row-head">
                              <div>
                                <h3>
                                  {contextReading?.productName ?? reading.label ?? reading.nozzleId}
                                </h3>
                                <p className="pump-row-meta">
                                  {contextReading
                                    ? `Pump ${contextReading.pumpNumber} · Nozzle ${contextReading.nozzleNumber}`
                                    : `Nozzle ${index + 1}`}
                                </p>
                              </div>
                            </div>
                            <div className="pump-row-readings">
                              {correctingOpening ? (
                                <NumericInput
                                  id={`opening-${reading.rowKey}`}
                                  label="Opening"
                                  value={reading.openingReading}
                                  onChange={(event) => {
                                    setDirty(true);
                                    setReadings((current) =>
                                      current.map((item) =>
                                        item.rowKey === reading.rowKey
                                          ? {
                                              ...item,
                                              openingReading: event.target.value,
                                              // A pump that sold nothing keeps closing level with its opening.
                                              closingReading:
                                                Number(item.closingReading) ===
                                                Number(item.openingReading)
                                                  ? event.target.value
                                                  : item.closingReading,
                                            }
                                          : item,
                                      ),
                                    );
                                  }}
                                  unit="L"
                                />
                              ) : (
                                <PumpReadout
                                  label="Opening"
                                  value={formatDecimal(reading.openingReading)}
                                  unit="L"
                                />
                              )}
                              {editable ? (
                                <NumericInput
                                  id={`closing-${reading.rowKey}`}
                                  label="Closing"
                                  value={
                                    !closingTouched.has(reading.rowKey) &&
                                    reading.closingReading.trim() !== '' &&
                                    Number(reading.closingReading) ===
                                      Number(reading.openingReading)
                                      ? ''
                                      : reading.closingReading
                                  }
                                  onChange={(event) => {
                                    setDirty(true);
                                    setClosingTouched((current) =>
                                      new Set(current).add(reading.rowKey),
                                    );
                                    setReadings((current) =>
                                      current.map((item) =>
                                        item.rowKey === reading.rowKey
                                          ? { ...item, closingReading: event.target.value }
                                          : item,
                                      ),
                                    );
                                  }}
                                  unit="L"
                                />
                              ) : (
                                <PumpReadout
                                  label="Closing"
                                  value={formatDecimal(reading.closingReading)}
                                  unit="L"
                                />
                              )}
                              <PumpReadout
                                label="Litres sold"
                                value={sold.value}
                                unit={sold.unit}
                                result
                              />
                              <PumpReadout
                                label="Price / litre"
                                value={reading.unitPrice ? formatMoney(reading.unitPrice) : '—'}
                              />
                              <PumpReadout
                                label="Sales value"
                                value={valueShown ? formatMoney(valueShown) : '—'}
                                result
                              />
                            </div>
                            {belowOpening ? (
                              <p className="field-error" role="alert">
                                The closing reading is lower than the opening reading. Check both
                                numbers.
                              </p>
                            ) : null}
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
                className="panel profit-panel cash-panel"
                id="operations-evidence"
                aria-labelledby="operations-evidence-title"
              >
                <SectionHeading
                  asTip={role === 'MANAGEMENT'}
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
                                  ? {
                                      ...item,
                                      method: event.target.value as PaymentMethod,
                                      customerAccountId: '',
                                    }
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
                      {ACCOUNT_TYPE_FOR_METHOD[payment.method] ? (
                        <Field
                          id={`payment-customer-${payment.rowKey}`}
                          label="Customer"
                          hint={
                            payment.method === 'CUSTOMER_CREDIT'
                              ? 'Who is buying on credit.'
                              : 'Whose prepaid balance pays for this.'
                          }
                          required
                        >
                          <select
                            id={`payment-customer-${payment.rowKey}`}
                            value={payment.customerAccountId}
                            disabled={!editable}
                            onChange={(event) => {
                              setDirty(true);
                              setPayments((current) =>
                                current.map((item) =>
                                  item.rowKey === payment.rowKey
                                    ? { ...item, customerAccountId: event.target.value }
                                    : item,
                                ),
                              );
                            }}
                          >
                            <option value="">Choose the customer</option>
                            {(record?.customerAccounts ?? [])
                              .filter(
                                (account) =>
                                  account.accountType === ACCOUNT_TYPE_FOR_METHOD[payment.method],
                              )
                              .map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.name} · {formatMoney(account.available)} available
                                </option>
                              ))}
                          </select>
                        </Field>
                      ) : null}
                      {payment.method === 'STAFF_OR_MANAGEMENT_FUEL' ? (
                        <Field
                          id={`payment-beneficiary-${payment.rowKey}`}
                          label="Who received the fuel"
                          hint="Name of the staff member or manager."
                          required
                        >
                          <input
                            id={`payment-beneficiary-${payment.rowKey}`}
                            value={payment.beneficiaryName}
                            maxLength={160}
                            disabled={!editable}
                            onChange={(event) => {
                              setDirty(true);
                              setPayments((current) =>
                                current.map((item) =>
                                  item.rowKey === payment.rowKey
                                    ? { ...item, beneficiaryName: event.target.value }
                                    : item,
                                ),
                              );
                            }}
                          />
                        </Field>
                      ) : null}
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
                            {
                              rowKey: newRowKey(),
                              method,
                              amount: '',
                              reference: '',
                              note: '',
                              customerAccountId: '',
                              beneficiaryName: '',
                            },
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
                            customerAccountId: '',
                            beneficiaryName: '',
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
                className="panel profit-panel cash-panel"
                id="operations-expenses"
                aria-labelledby="operations-expenses-title"
              >
                <SectionHeading
                  asTip={role === 'MANAGEMENT'}
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
                        {expensePaymentMethods.map((method) => (
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
                {role === 'MANAGEMENT' ? null : (
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
                )}
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
                className="panel profit-panel cash-panel"
                id="operations-cash"
                aria-labelledby="operations-cash-title"
              >
                <SectionHeading
                  asTip={role === 'MANAGEMENT'}
                  title="Count the cash"
                  headingId="operations-cash-title"
                  detail="Count the cash you are holding and enter the total."
                />
                <div className="cash-declaration-grid">
                  <NumericInput
                    id="cash-counted"
                    label="Cash counted"
                    hint="The figures beside it update as you type."
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
                      <dd className="numeric">{formatMoney(liveCash.expected)}</dd>
                    </div>
                    <div>
                      <dt>Paid out in cash</dt>
                      <dd className="numeric">{formatMoney(liveCash.paidOut)}</dd>
                    </div>
                    <div>
                      <dt>Expected after payouts</dt>
                      <dd className="numeric">{formatMoney(liveCash.net)}</dd>
                    </div>
                    <div>
                      <dt>Cash difference</dt>
                      <dd className="numeric">
                        {liveCash.difference === null
                          ? 'Enter the cash counted'
                          : formatMoney(liveCash.difference)}
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
                className="panel profit-panel cash-panel"
                id="operations-inventory"
                aria-labelledby="operations-inventory-title"
              >
                <SectionHeading
                  asTip={role === 'MANAGEMENT'}
                  title="Tank dips and deliveries"
                  headingId="operations-inventory-title"
                  action={
                    <Link
                      className="button button-secondary"
                      href={`/inventory/deliveries?${new URLSearchParams({ tenantId: context.tenantId, stationId: context.stationId }).toString()}`}
                    >
                      Record a delivery
                    </Link>
                  }
                />
                <DailyTankDips
                  tenantId={context.tenantId}
                  stationId={context.stationId}
                  timezone={operation.station.timezone}
                  reconciliationId={activeReconciliationId ?? ''}
                  record={record}
                  editable={editable}
                  onChanged={reloadQuietly}
                  onUnsavedChange={setUnsavedDips}
                />
                {record.deliveries.length ? (
                  <section className="tank-deliveries" aria-label="Deliveries this shift">
                    <h3>Deliveries this shift</h3>
                    {record.deliveries.map((delivery) => (
                      <PumpReadout
                        key={delivery.deliveryId}
                        label={`Delivery note ${delivery.deliveryNoteNumber}`}
                        value={formatLitres(delivery.actualQuantityLitres)}
                      />
                    ))}
                  </section>
                ) : null}
              </Card>
            ) : null}

            {step === 6 ? (
              <Card
                as="section"
                className="panel profit-panel cash-panel"
                id="operations-review"
                aria-labelledby="operations-review-title"
              >
                <SectionHeading
                  asTip={role === 'MANAGEMENT'}
                  title="Explain any differences, then submit"
                  headingId="operations-review-title"
                />
                <ul className="entry-checklist" aria-label="Before you submit">
                  {checklist.map((item) => (
                    <li key={item.label} data-ok={item.ok || undefined}>
                      <span aria-hidden="true">{item.ok ? '✓' : '!'}</span>
                      {item.label}
                    </li>
                  ))}
                </ul>
                <div className="explanation-grid">
                  {(['SALES', 'CASH', 'STOCK'] as const).map((category) => {
                    const required =
                      category === 'SALES'
                        ? requiresSalesExplanation
                        : category === 'CASH'
                          ? requiresCashExplanation
                          : requiresStockExplanation;
                    if (!required && !(explanations[category] ?? '').trim()) return null;
                    return (
                      <Field
                        key={category}
                        id={`explanation-${category.toLowerCase()}`}
                        label={`Why is ${category === 'SALES' ? 'the sales' : category === 'CASH' ? 'the cash' : 'the stock'} different?`}
                        hint={
                          required
                            ? 'Please explain this difference before submitting.'
                            : 'Only needed if there is a difference.'
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
                {record && activeReconciliationId ? (
                  <DocumentAttachments
                    tenantId={context.tenantId}
                    stationId={context.stationId}
                    subjectType="RECONCILIATION"
                    subjectId={activeReconciliationId}
                    title="Photos and papers for this day"
                  />
                ) : null}
                {state === 'APPROVED' ? (
                  <p className="state state-success" role="status">
                    <strong>Approved:</strong> Canonical sale evidence has been posted by the
                    production approval command. Corrections use a named new revision workflow.
                  </p>
                ) : null}
                {state === 'LOCKED' ? (
                  <p className="state state-success" role="status">
                    <strong>Locked:</strong> This record is locked. Corrections use a named new
                    revision workflow.
                  </p>
                ) : null}
                {state === 'RETURNED' ? (
                  <p className="state state-warning" role="status">
                    <strong>Returned:</strong> Fix the figures and save before you submit again.
                  </p>
                ) : null}
                {inReview && record?.unvaluedFuels?.length ? (
                  <div className="state state-warning" role="status">
                    <p>
                      <strong>Fuel cost missing:</strong> We do not know what the{' '}
                      {record.unvaluedFuels.join(' and ')} cost. Enter it, save, and you will come
                      straight back here to approve this day.
                    </p>
                    <div className="button-row">
                      {(record.unvaluedStreams ?? []).map((stream) => (
                        <Button
                          key={`${stream.tankId}-${stream.productId}`}
                          variant="secondary"
                          onClick={() => {
                            const params = new URLSearchParams({
                              tenantId: context.tenantId,
                              stationId: context.stationId,
                              returnTo: `${window.location.pathname}${window.location.search}`,
                            });
                            const target = new URL(
                              `/inventory/valuation/streams/${stream.tankId}/${stream.productId}?${params}`,
                              window.location.origin,
                            );
                            window.location.assign(target.toString());
                          }}
                        >
                          Enter {stream.name} cost
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {approvalWaitsForSomeoneElse ? (
                  <p className="state state-warning" role="status">
                    <strong>Waiting for someone else:</strong> You submitted these figures, so
                    another person who can approve must approve them.
                  </p>
                ) : null}
                {inReview && !mayApprove && !mayReturn && !approvalWaitsForSomeoneElse ? (
                  <p className="state" role="status">
                    These figures are waiting for the owner or an administrator to review.
                  </p>
                ) : null}
                {inReview ? (
                  requiresApproverNote ? (
                    <Field
                      id="management-approval-note"
                      label="Approver note for red variance"
                      hint="Record why this red variance is accepted or what follow-up is required."
                      required
                    >
                      <textarea
                        id="management-approval-note"
                        rows={3}
                        value={approvalNote}
                        onChange={(event) => setApprovalNote(event.target.value)}
                      />
                    </Field>
                  ) : null
                ) : null}
                {mayReturn && returning ? (
                  <Field
                    id="management-return-reason"
                    label="Return reason"
                    hint="Required when sending this reconciliation back for correction."
                    required
                  >
                    <textarea
                      id="management-return-reason"
                      rows={3}
                      autoFocus
                      value={returnReason}
                      onChange={(event) => setReturnReason(event.target.value)}
                    />
                  </Field>
                ) : null}
                <div className="form-actions">
                  <Button
                    variant="secondary"
                    onClick={() => void saveDraft(true)}
                    disabled={!editable || !dirty}
                    loading={busy}
                  >
                    Save now
                  </Button>
                  {role === 'SUPERVISOR' && editable ? (
                    <Button
                      variant="primary"
                      onClick={() => void submitForReview()}
                      disabled={busy}
                    >
                      Submit for review
                    </Button>
                  ) : null}
                  {mayReturn || mayApprove ? (
                    <>
                      {mayReturn && !returning ? (
                        <Button variant="danger" onClick={() => setReturning(true)} disabled={busy}>
                          Return for correction
                        </Button>
                      ) : null}
                      {mayReturn && returning ? (
                        <>
                          <Button
                            variant="danger"
                            onClick={() => {
                              const reason = returnReason.trim();
                              if (!reason) {
                                setError('Enter a return reason before sending this back.');
                                return;
                              }
                              void transition('ReturnProductionReconciliation', { reason });
                            }}
                            disabled={busy || !returnReason.trim()}
                          >
                            Send back for correction
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setReturning(false);
                              setReturnReason('');
                            }}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : null}
                      {mayApprove && !returning ? (
                        <Button
                          variant="primary"
                          onClick={() =>
                            void transition('ApproveProductionReconciliation', {
                              approvalNote: approvalNote.trim() || undefined,
                            })
                          }
                          disabled={busy || (requiresApproverNote && !approvalNote.trim())}
                        >
                          Approve reconciliation
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </Card>
            ) : null}
            <StepUpDialog
              open={stepUpRetry !== null}
              tenantId={context.tenantId}
              description="Approving this reconciliation needs a fresh identity check. Nothing is posted until you confirm."
              confirmLabel="Confirm and approve"
              onCancel={() => setStepUpRetry(null)}
              onVerified={() => {
                const retry = stepUpRetry;
                setStepUpRetry(null);
                if (retry) {
                  void transition(
                    'ApproveProductionReconciliation',
                    retry.values,
                    retry.savedVersion,
                    true,
                  );
                }
              }}
            />
          </div>
        </div>
        {/* Back and Next sit outside the card, in the gap cut from its bottom-right corner. */}
        <footer className="entry-footer">
          {step > 0 && !(state === 'SUBMITTED' && step === STEPS.length - 1 && !mayApprove) ? (
            <Button variant="secondary" onClick={() => void goToStep(step - 1)} disabled={busy}>
              Back
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => void goToStep(step + 1)} loading={busy}>
              Next
            </Button>
          ) : null}
          {state === 'SUBMITTED' && step === STEPS.length - 1 && !mayApprove ? (
            <Link
              className="button button-primary"
              href={`/operations/reconciliations?${new URLSearchParams({ tenantId: context.tenantId, stationId: context.stationId }).toString()}`}
            >
              Reconciliations
            </Link>
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
          title="Choose a station"
          headingId="operations-context-title"
          detail="Use the station selector above to choose a station, business date and shift."
        />
        <p>The daily workspace will load once the selected work context is ready.</p>
      </Card>
    </>
  );
}
