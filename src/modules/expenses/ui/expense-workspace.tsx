'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ContextResolution } from '@/modules/context';
import {
  Button,
  Card,
  ContextRequiredState,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
  SuccessState,
} from '@/design-system/primitives';
import { Icon } from '@/design-system/icons';
import { Modal } from '@/design-system/modal';
import { NotchedCard } from '@/design-system/notched-card';
import { Pagination, pageOf, usePageState } from '@/design-system/pagination';
import { formatTileMoney } from '@/modules/reporting/format';
import { limitToSend } from '../expense-setup-checks';
import {
  ApprovalLimitsWizard,
  CategoryWizard,
  type CategoryValue,
  type LimitsValue,
} from './expense-setup-wizards';
import { CashDonut } from '@/modules/cash/ui/cash-visuals';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import { isStaffFuelCategory } from '../domain';
import styles from './expenses.module.css';
import {
  ExpenseKindStep,
  ExpenseWizard,
  RegularCostWizard,
  type NewExpenseValue,
  type NewRegularCostValue,
} from './expense-wizards';
import {
  EXPENSE_FILTERS,
  PERIODS,
  amountForInput,
  categoryCodeFromName,
  categoryRingSlices,
  categoryShares,
  formatFriendlyDate,
  friendlyError,
  inPeriod,
  isStepUpMessage,
  matchesFilter,
  matchesSearch,
  monthRange,
  monthTitle,
  parseAmount,
  periodRange,
  regularCostSoFar,
  statusView,
  sumAmounts,
  todayInBusinessTime,
  withinApprovalLimit,
  type ExpenseFilter,
  type ExpenseRow,
  type PeriodKey,
} from './expense-format';

export type ExpenseCapabilities = {
  submit: boolean;
  approve: boolean;
  /** False for a supervisor, who may only approve up to the owner's limit. */
  approveAnyAmount: boolean;
  post: boolean;
  reverse: boolean;
  recordPayment: boolean;
  reversePayment: boolean;
  manageCategories: boolean;
  managePolicy: boolean;
  manageRecurring: boolean;
  recogniseRecurring: boolean;
};

export type RegularCostTemplate = {
  templateId: string;
  stationId: string;
  categoryId: string;
  name: string;
  amount: string;
  startDate: string;
  endDate: string | null;
  status: string;
};

export type RegularCostPeriod = {
  periodId: string;
  stationId: string;
  templateId: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  recognizedAmount: string;
  outstanding: string;
};

export type ExpensePolicyView = {
  version: number;
  stepUpThreshold: string | null;
  secondApprovalThreshold: string | null;
  supervisorApprovalLimit: string | null;
};

export type ExpenseCategory = {
  categoryId: string;
  code: string;
  name: string;
  classification: string;
  status: string;
};

export type ExpenseReference = {
  capabilities: ExpenseCapabilities;
  categories: ExpenseCategory[];
  policy?: ExpensePolicyView | null;
  templates?: RegularCostTemplate[];
  periods?: RegularCostPeriod[];
};

export type ExpenseSummary = {
  from: string;
  to: string;
  byCategory: Array<{ categoryId: string; name: string; amount: string }>;
  payables: { postedExpensesOutstanding: string };
};

export type ExpenseInitial = {
  resolution: ContextResolution;
  items: ExpenseRow[];
  summary: ExpenseSummary;
  reference: ExpenseReference;
};

type Payment = {
  paymentId: string;
  paymentDate: string;
  amount: string;
  settlementSource: string;
  externalReference: string | null;
  state: string;
  reversalReason: string | null;
};

type Sheet =
  | { kind: 'add' }
  | { kind: 'new' }
  | { kind: 'categories' }
  | { kind: 'regular' }
  | { kind: 'limits' }
  | { kind: 'approve' | 'reject' | 'post' | 'reverse' | 'pay'; expense: ExpenseRow }
  | { kind: 'undoPay'; expense: ExpenseRow; payment: Payment };

const PAY_SOURCES = [
  {
    value: 'BANK',
    label: 'Paid from the bank',
    refLabel: 'Bank reference',
    hint: 'For example the transfer or payment number.',
  },
  {
    value: 'MOBILE_MONEY',
    label: 'Paid by EcoCash',
    refLabel: 'EcoCash transaction code',
    hint: 'The code from the EcoCash confirmation message.',
  },
  {
    value: 'REIMBURSEMENT',
    label: 'Paid back to someone who covered it',
    refLabel: 'Who was paid back, and how',
    hint: 'For example: Refunded to T. Moyo in cash on 12 Oct.',
  },
] as const;

const SOURCE_WORDS: Record<string, string> = {
  BANK: 'Bank',
  CASH: 'Cash',
  MOBILE_MONEY: 'EcoCash',
  REIMBURSEMENT: 'Paid back to staff',
};

/** True for an amount that is nothing, however many zeros the database wrote. */
function isZeroMoney(value: string): boolean {
  return /^-?0*\.?0*$/.test(value);
}

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function messageOf(result: unknown, fallback: string): string {
  if (typeof result === 'object' && result !== null && 'message' in result) {
    const message = (result as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

const USUAL_EXPENSE_KINDS = [
  { name: 'Rent', classification: 'FIXED_COST' },
  { name: 'Salaries', classification: 'FIXED_COST' },
  { name: 'Security', classification: 'FIXED_COST' },
  { name: 'Electricity', classification: 'FIXED_COST' },
  { name: 'Internet', classification: 'FIXED_COST' },
  { name: 'Insurance', classification: 'FIXED_COST' },
  { name: 'Licences', classification: 'FIXED_COST' },
  { name: 'Generator', classification: 'OPERATING' },
  { name: 'Data and airtime', classification: 'OPERATING' },
  { name: 'Cleaning', classification: 'OPERATING' },
  { name: 'Repairs', classification: 'OPERATING' },
  { name: 'Transport', classification: 'OPERATING' },
  { name: 'Stationery', classification: 'OPERATING' },
  { name: 'EcoCash charges', classification: 'OPERATING' },
  { name: 'Other', classification: 'OPERATING' },
] as const;

export function ExpenseWorkspace({ initial }: { initial?: ExpenseInitial }) {
  const [items, setItems] = useState<ExpenseRow[]>(initial?.items ?? []);
  const [summary, setSummary] = useState<ExpenseSummary | null>(initial?.summary ?? null);
  const [reference, setReference] = useState<ExpenseReference | null>(initial?.reference ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ExpenseFilter>('all');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pageState = usePageState(`${filter}|${search}|${period}|${categoryFilter}`);
  const [draftPeriod, setDraftPeriod] = useState<PeriodKey>('month');
  const [draftCategory, setDraftCategory] = useState('');
  const filtersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [filtersOpen]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Payment[]>>({});
  const [detailError, setDetailError] = useState<string | null>(null);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [listTab, setListTab] = useState<'all' | 'regular'>('all');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stepUpRetry, setStepUpRetry] = useState<(() => void) | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  // Form fields, reset whenever a sheet opens.
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  // The guides for a new expense and a regular cost keep their own fields. These hold what they
  // start with, and what was entered once it is sent (so it survives the identity check).
  const [expenseSeed, setExpenseSeed] = useState<NewExpenseValue | null>(null);
  const [regularSeed, setRegularSeed] = useState<NewRegularCostValue | null>(null);
  const [reason, setReason] = useState('');
  const [paySource, setPaySource] = useState<'BANK' | 'MOBILE_MONEY' | 'REIMBURSEMENT'>('BANK');
  const [payRef, setPayRef] = useState('');

  const current = initial?.resolution.current ?? null;
  const caps = reference?.capabilities;
  const today = todayInBusinessTime();
  const month = monthRange(today);

  const stations = useMemo(() => {
    if (!initial || !current) return [];
    const organisation = initial.resolution.available.organisations.find(
      (row) => row.id === current.organisationId,
    );
    const entity = organisation?.legalEntities.find((row) => row.id === current.legalEntityId);
    return (entity?.stations ?? []).map((station) => ({ id: station.id, name: station.name }));
  }, [initial, current]);
  const stationName = (id: string) => stations.find((station) => station.id === id)?.name ?? '';
  const stationIsFixed = Boolean(current?.stationId && !current.allStations);
  const startingStationId = stationIsFixed
    ? (current?.stationId ?? '')
    : stations.length === 1
      ? (stations[0]?.id ?? '')
      : '';

  const activeCategories = (reference?.categories ?? []).filter(
    (category) =>
      category.status === 'ACTIVE' &&
      category.classification === 'OPERATING' &&
      // Staff fuel goes through the staff benefit account, not through this form.
      !isStaffFuelCategory(category),
  );
  const activeRecurringCategories = (reference?.categories ?? []).filter(
    (category) => category.status === 'ACTIVE' && category.classification === 'FIXED_COST',
  );

  function scopeParams(): URLSearchParams {
    const params = new URLSearchParams({
      tenantId: current?.organisationId ?? '',
      legalEntityId: current?.legalEntityId ?? '',
    });
    if (current?.stationId && !current.allStations) params.set('stationId', current.stationId);
    return params;
  }

  async function getJson(url: string, fallback: string): Promise<Record<string, unknown>> {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(friendlyError(messageOf(result, ''), fallback));
    return result as Record<string, unknown>;
  }

  async function refresh() {
    if (!current) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const range = monthRange(todayInBusinessTime());
      const listParams = scopeParams();
      listParams.set('limit', '200');
      const summaryParams = scopeParams();
      summaryParams.set('from', range.from);
      summaryParams.set('to', range.to);
      const [list, nextSummary, nextReference] = await Promise.all([
        getJson(`/api/expenses/list?${listParams}`, 'The expenses could not be loaded.'),
        getJson(
          `/api/expenses/summary?${summaryParams}`,
          'The monthly totals could not be loaded.',
        ),
        getJson(`/api/expenses/reference?${scopeParams()}`, 'The categories could not be loaded.'),
      ]);
      setItems((list.items as ExpenseRow[]) ?? []);
      setSummary(nextSummary as unknown as ExpenseSummary);
      setReference(nextReference as unknown as ExpenseReference);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'The expenses could not be loaded.');
    } finally {
      setRefreshing(false);
    }
  }

  async function loadPayments(expenseId: string) {
    if (!current) return;
    setDetailError(null);
    try {
      const params = scopeParams();
      params.set('expenseId', expenseId);
      const result = await getJson(
        `/api/expenses/list?${params}`,
        'The payments could not be loaded.',
      );
      const detail = result.detail as { payments?: Payment[] } | undefined;
      setDetails((existing) => ({ ...existing, [expenseId]: detail?.payments ?? [] }));
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'The payments could not be loaded.');
    }
  }

  useEffect(() => {
    // The page arrives with its data, so this only reloads the open row after changes.
    if (openId && !(openId in details)) void Promise.resolve().then(() => loadPayments(openId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  if (!initial || !current?.legalEntityId || !reference || !summary) {
    return (
      <ContextRequiredState
        title="Choose a company"
        message="Pick a company in the selector above to see its expenses."
      />
    );
  }
  const tenantId = current.organisationId;
  const legalEntityId = current.legalEntityId;

  function openSheet(next: Sheet) {
    setFormError(null);
    setReason('');
    setNotice(null);
    attempt.current = null;
    if (next.kind === 'new') {
      setExpenseSeed({
        categoryId: activeCategories.length === 1 ? (activeCategories[0]?.categoryId ?? '') : '',
        description: '',
        amount: '',
        date: today,
        stationId: startingStationId,
        paymentMethod: 'STATION_CASH',
        paymentMethodOther: '',
        payee: '',
        receipt: '',
        receiptFile: null,
      });
    }
    if (next.kind === 'pay') {
      setAmount(amountForInput(next.expense.outstanding));
      setDate(today);
      setPaySource('BANK');
      setPayRef('');
    }
    if (next.kind === 'regular') {
      setRegularSeed({
        name: '',
        categoryId:
          activeRecurringCategories.length === 1
            ? (activeRecurringCategories[0]?.categoryId ?? '')
            : '',
        stationId: startingStationId,
        amount: '',
        start: month.from,
        end: '',
      });
    }
    setSheet(next);
  }

  function closeSheet() {
    if (!busy) setSheet(null);
  }

  async function send(
    body: Record<string, unknown>,
    successMessage: string,
    keepOpenAfter = false,
    confirmed = false,
    afterSave?: (result: unknown) => Promise<string | null>,
  ) {
    const fingerprint = JSON.stringify(body);
    // A retry of the same request keeps its key, so a dropped connection never records twice.
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: newKey() };
    }
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch('/api/expenses/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': attempt.current.key },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(messageOf(result, 'This could not be saved.'));
      attempt.current = null;
      if (!keepOpenAfter) setSheet(null);
      // The expense is already saved; a failed photo upload is reported, never rolled back.
      const afterNote = afterSave ? await afterSave(result) : null;
      setNotice(afterNote ? `${successMessage} ${afterNote}` : successMessage);
      setDetails({});
      await refresh();
      if (openId) void loadPayments(openId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'This could not be saved.';
      if (!confirmed && isStepUpMessage(message)) {
        setStepUpRetry(() => () => void send(body, successMessage, keepOpenAfter, true, afterSave));
      } else {
        setFormError(friendlyError(message, 'This could not be saved.'));
        void refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  /** One click for a new business: the kinds of cost a forecourt usually has. */
  async function addUsualKinds() {
    setBusy(true);
    setFormError(null);
    try {
      for (const kind of USUAL_EXPENSE_KINDS) {
        const code = categoryCodeFromName(kind.name);
        if (!code) continue;
        const response = await fetch('/api/expenses/commands', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'idempotency-key': newKey() },
          body: JSON.stringify({
            commandType: 'CreateExpenseCategory',
            tenantId,
            legalEntityId,
            code,
            name: kind.name,
            classification: kind.classification,
          }),
        });
        if (!response.ok) {
          const result: unknown = await response.json().catch(() => null);
          throw new Error(messageOf(result, 'The usual kinds could not be added.'));
        }
      }
      setNotice('The usual kinds of expense were added.');
      await refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'The usual kinds could not be added.');
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  function scope(station: string) {
    return { tenantId, stationId: station };
  }

  /** Sends a new expense from its guide. The value is kept so the guide can reopen after an identity check. */
  function submitExpense(value: NewExpenseValue) {
    setExpenseSeed(value);
    const amountValue = parseAmount(value.amount);
    if (!amountValue) return;
    const file = value.receiptFile;
    const uploadStation = value.stationId;
    void send(
      {
        commandType: 'SubmitExpense',
        ...scope(value.stationId),
        categoryId: value.categoryId,
        expenseDate: value.date,
        description: value.description.trim(),
        amount: amountValue,
        paymentMethod: value.paymentMethod,
        ...(value.paymentMethod === 'OTHER'
          ? { paymentMethodOther: value.paymentMethodOther.trim() }
          : {}),
        ...(value.payee.trim() ? { payee: value.payee.trim() } : {}),
        ...(value.receipt.trim() ? { reference: value.receipt.trim() } : {}),
      },
      'Expense entered. It now waits for approval.',
      false,
      false,
      file
        ? async (result) => {
            const expenseId = (result as { expenseId?: string }).expenseId;
            if (!expenseId) return null;
            const form = new FormData();
            form.set('tenantId', tenantId);
            form.set('stationId', uploadStation);
            form.set('expenseId', expenseId);
            form.set('file', file);
            try {
              const uploaded = await fetch('/api/expenses/attachments', {
                method: 'POST',
                credentials: 'same-origin',
                body: form,
              });
              if (!uploaded.ok) {
                return 'The receipt photo could not be attached. Open the expense and try again.';
              }
              return 'The receipt photo was attached.';
            } catch {
              return 'The receipt photo could not be attached. Open the expense and try again.';
            }
          }
        : undefined,
    );
  }

  function submitRegular(value: NewRegularCostValue) {
    setRegularSeed(value);
    const amountValue = parseAmount(value.amount);
    if (!amountValue) return;
    void send(
      {
        commandType: 'CreateRecurringCostTemplate',
        ...scope(value.stationId),
        categoryId: value.categoryId,
        name: value.name.trim(),
        amount: amountValue,
        startDate: value.start,
        ...(value.end ? { endDate: value.end } : {}),
      },
      'Regular cost added. It is spread across every day automatically.',
    );
  }

  /** Adds one kind of expense from its guide. The sheet stays open, back on the updated list. */
  function submitCategory(value: CategoryValue) {
    const code = categoryCodeFromName(value.name);
    if (!code) return;
    void send(
      {
        commandType: 'CreateExpenseCategory',
        tenantId,
        legalEntityId,
        code,
        name: value.name,
        classification: value.fixed ? 'FIXED_COST' : 'OPERATING',
      },
      `Category “${value.name}” added.`,
      true,
    );
  }

  function submitLimits(values: LimitsValue) {
    void send(
      {
        commandType: 'SetExpensePolicy',
        tenantId,
        legalEntityId,
        stepUpThreshold: limitToSend(values.stepUp),
        secondApprovalThreshold: limitToSend(values.second),
        supervisorApprovalLimit: limitToSend(values.supervisor),
        ...(reference?.policy ? { expectedVersion: reference.policy.version } : {}),
      },
      'Approval limits saved.',
    );
  }

  async function submitSheet(event: FormEvent) {
    event.preventDefault();
    // A new expense and a regular cost are saved by their guides, not by this form.
    if (
      !sheet ||
      sheet.kind === 'new' ||
      sheet.kind === 'regular' ||
      sheet.kind === 'categories' ||
      sheet.kind === 'limits'
    ) {
      return;
    }
    setFormError(null);

    if (sheet.kind === 'add') return;
    const { expense } = sheet;
    const base = {
      ...scope(expense.stationId),
      expenseId: expense.expenseId,
      expectedVersion: expense.version,
    };

    if (sheet.kind === 'approve') {
      return send({ commandType: 'ApproveExpense', ...base }, 'Approved.');
    }
    if (sheet.kind === 'post') {
      return send(
        { commandType: 'PostExpense', ...base },
        'Recorded. It now counts in this month’s spending.',
      );
    }
    if (sheet.kind === 'reject') {
      if (!reason.trim()) return setFormError('Say why it is being rejected so the person knows.');
      return send({ commandType: 'RejectExpense', ...base, reason: reason.trim() }, 'Rejected.');
    }
    if (sheet.kind === 'reverse') {
      if (!reason.trim()) return setFormError('Say why this expense is being cancelled.');
      return send(
        { commandType: 'ReverseExpense', ...base, reason: reason.trim() },
        'The expense was cancelled.',
      );
    }
    if (sheet.kind === 'pay') {
      const value = parseAmount(amount);
      if (!value) return setFormError('Enter the amount paid, for example 25.50.');
      if (!payRef.trim()) {
        return setFormError(
          paySource === 'BANK'
            ? 'Enter the bank reference so the payment can be found later.'
            : paySource === 'MOBILE_MONEY'
              ? 'Enter the EcoCash transaction code so the payment can be found later.'
              : 'Say who was paid back and how.',
        );
      }
      return send(
        {
          commandType: 'RecordExpensePayment',
          ...scope(expense.stationId),
          expenseId: expense.expenseId,
          expectedVersion: expense.version,
          paymentDate: date,
          amount: value,
          settlementSource: paySource,
          externalReference: payRef.trim(),
        },
        'Payment recorded.',
      );
    }
    if (sheet.kind === 'undoPay') {
      if (!reason.trim()) return setFormError('Say why this payment is being undone.');
      return send(
        {
          commandType: 'ReverseExpensePayment',
          ...scope(expense.stationId),
          paymentId: sheet.payment.paymentId,
          expectedVersion: expense.version,
          reason: reason.trim(),
        },
        'The payment was undone.',
      );
    }
  }

  function showFilter(next: ExpenseFilter) {
    setListTab('all');
    setFilter(next);
    setPeriod('all');
    setSearch('');
    setCategoryFilter('');
    document.getElementById('expense-list-title')?.scrollIntoView({ behavior: 'smooth' });
  }

  function toggleFilters() {
    if (!filtersOpen) {
      setDraftPeriod(period);
      setDraftCategory(categoryFilter);
    }
    setFiltersOpen((open) => !open);
  }

  const activeFilters = (period !== 'month' ? 1 : 0) + (categoryFilter ? 1 : 0);

  // Derived lists.
  const range = periodRange(today, period);
  const base = items.filter(
    (row) =>
      inPeriod(row.expenseDate, range) &&
      (!categoryFilter || row.category.id === categoryFilter) &&
      matchesSearch(row, search),
  );
  const visible = base.filter((row) => matchesFilter(row, filter));
  const expensePage = pageOf(visible, pageState);
  const waiting = items.filter((row) => row.state === 'SUBMITTED');
  const ready = items.filter((row) => row.state === 'APPROVED');
  const { total: spent, shares } = categoryShares(summary.byCategory);
  const waitingTotal = sumAmounts(waiting.map((row) => row.amount));
  const showRegularTab = Boolean(caps?.manageRecurring || (reference.templates ?? []).length > 0);
  const guided =
    sheet?.kind === 'add' ||
    sheet?.kind === 'new' ||
    sheet?.kind === 'regular' ||
    sheet?.kind === 'categories' ||
    sheet?.kind === 'limits';
  const canAddExpense = Boolean(caps?.submit || caps?.manageRecurring);

  return (
    <div className={styles.page}>
      {notice ? <SuccessState title="Done" message={notice} /> : null}
      {loadError ? (
        <ErrorState
          message={loadError}
          action={<Button onClick={() => void refresh()}>Try again</Button>}
        />
      ) : null}

      <div className={styles.overview}>
        <NotchedCard
          title={`Spent in ${monthTitle(month.from)}`}
          titleId="expense-spent-title"
          className={styles.summaryCard}
        >
          <p className={styles.heroAmount}>{formatTileMoney(spent)}</p>
          <div className={styles.stats}>
            <button
              type="button"
              className={styles.stat}
              data-attention={waiting.length > 0 ? 'true' : undefined}
              onClick={() => showFilter('waiting')}
              aria-label={`Waiting for approval: ${waiting.length}. Show them.`}
            >
              <span>Waiting for approval</span>
              <strong>
                {waiting.length === 0
                  ? 'None'
                  : `${waiting.length} · ${formatTileMoney(waitingTotal)}`}
              </strong>
              {ready.length > 0 ? <small>{ready.length} ready to record</small> : null}
            </button>
            <button
              type="button"
              className={styles.stat}
              onClick={() => showFilter('unpaid')}
              aria-label="Not paid yet. Show these expenses."
            >
              <span>Not paid yet</span>
              <strong>
                {isZeroMoney(summary.payables.postedExpensesOutstanding)
                  ? 'None'
                  : formatTileMoney(summary.payables.postedExpensesOutstanding)}
              </strong>
            </button>
          </div>
        </NotchedCard>

        <NotchedCard
          title="Where the money went"
          titleId="expense-categories-title"
          notchWidth={20.5}
          actions={
            canAddExpense || caps?.manageCategories || caps?.managePolicy ? (
              <>
                {caps?.managePolicy ? (
                  <Button variant="secondary" onClick={() => openSheet({ kind: 'limits' })}>
                    Approval limits
                  </Button>
                ) : null}
                {caps?.manageCategories ? (
                  <Button variant="secondary" onClick={() => openSheet({ kind: 'categories' })}>
                    Manage categories
                  </Button>
                ) : null}
                {canAddExpense ? (
                  <Button
                    onClick={() =>
                      openSheet({
                        kind:
                          caps?.submit && caps.manageRecurring
                            ? 'add'
                            : caps?.submit
                              ? 'new'
                              : 'regular',
                      })
                    }
                  >
                    Add an expense
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          {shares.length === 0 ? (
            <p className={styles.muted}>Nothing recorded this month yet.</p>
          ) : (
            <div className={`profit-split ${styles.ring}`}>
              <CashDonut
                slices={categoryRingSlices(shares, spent)}
                currency="USD"
                centreLabel="Spent"
                centreValue={formatTileMoney(spent)}
                selectOpensDialog={false}
              />
            </div>
          )}
        </NotchedCard>
      </div>

      <Card as="section" className="panel" aria-labelledby="expense-list-title">
        <div className="panel-heading">
          <h2 id="expense-list-title">Money spent</h2>
          {listTab === 'all' && items.length >= 200 ? (
            <span className={styles.muted}>Showing the latest 200 expenses.</span>
          ) : null}
          {showRegularTab ? (
            <div className={`profit-tabs`} role="tablist" aria-label="Expense views">
              {(
                [
                  ['all', 'All Expenses'],
                  ['regular', 'Regular Costs'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={listTab === value}
                  onClick={() => setListTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {listTab === 'regular' && showRegularTab ? (
          <>
            {(reference.templates ?? []).length === 0 ? (
              <p className={styles.muted}>
                Costs that repeat each month, like rent, are listed here once added. They count
                automatically from the day they start, a share each day, and are kept apart from
                what was spent.
              </p>
            ) : (
              <ul className={styles.categories} aria-label="Regular costs">
                {(reference.templates ?? []).map((template) => {
                  const soFar = regularCostSoFar(template, month, today);
                  return (
                    <li key={template.templateId} className={styles.categoryRow}>
                      <span className={styles.categoryName}>
                        {template.name}
                        <span className={styles.muted}> · {stationName(template.stationId)}</span>
                      </span>
                      <span className={styles.amount}>
                        {formatTileMoney(template.amount)} a month
                      </span>
                      <span>
                        {template.status !== 'ACTIVE' ? (
                          <StatusBadge tone="neutral">Stopped</StatusBadge>
                        ) : soFar.days > 0 ? (
                          <StatusBadge tone="positive">
                            {formatTileMoney(soFar.amount)} so far this month
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="pending">
                            Starts {formatFriendlyDate(template.startDate)}
                          </StatusBadge>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className={styles.toolbar}>
              {items.length > 0 ? (
                <>
                  <label className="list-search">
                    <Icon name="search" />
                    <input
                      type="search"
                      aria-label="Search expenses"
                      placeholder="Search expenses"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <div className={styles.filterMenu} ref={filtersRef}>
                    <Button
                      variant="secondary"
                      aria-expanded={filtersOpen}
                      aria-controls="expense-filter-panel"
                      onClick={toggleFilters}
                    >
                      Filters{activeFilters > 0 ? ` · ${activeFilters}` : ''}
                    </Button>
                    {filtersOpen ? (
                      <div
                        className={styles.filterPanel}
                        id="expense-filter-panel"
                        role="group"
                        aria-label="Filter expenses"
                      >
                        <label>
                          <span>Date</span>
                          <select
                            value={draftPeriod}
                            onChange={(event) => setDraftPeriod(event.target.value as PeriodKey)}
                          >
                            {PERIODS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Kind</span>
                          <select
                            value={draftCategory}
                            onChange={(event) => setDraftCategory(event.target.value)}
                          >
                            <option value="">All kinds</option>
                            {(reference.categories ?? []).map((category) => (
                              <option key={category.categoryId} value={category.categoryId}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className={styles.filterActions}>
                          <Button
                            variant="quiet"
                            size="sm"
                            onClick={() => {
                              setDraftPeriod('month');
                              setDraftCategory('');
                            }}
                          >
                            Reset
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setFiltersOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setPeriod(draftPeriod);
                              setCategoryFilter(draftCategory);
                              setFiltersOpen(false);
                            }}
                          >
                            Apply
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {items.length > 0 ? (
                <div
                  className={`list-filters ${styles.chips}`}
                  role="group"
                  aria-label="Filter expenses"
                >
                  {EXPENSE_FILTERS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className="list-filter"
                      aria-pressed={filter === item.value}
                      onClick={() => setFilter(item.value)}
                    >
                      {item.label}
                      <span>{base.filter((row) => matchesFilter(row, item.value)).length}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {refreshing && items.length === 0 ? <LoadingState label="Loading expenses" /> : null}
            {items.length === 0 && !refreshing ? (
              <div className={styles.emptyList}>
                <EmptyState
                  layout="block"
                  icon="receipt"
                  title="No expenses yet"
                  message={`${
                    caps?.submit
                      ? 'Enter the first one when money is spent.'
                      : 'Expenses entered by your team show here.'
                  }${
                    isZeroMoney(spent) || !(caps?.manageRecurring || caps?.recogniseRecurring)
                      ? ''
                      : ' Regular costs are counted in the total above.'
                  }`}
                />
              </div>
            ) : null}
            {items.length > 0 && visible.length === 0 ? (
              <EmptyState
                layout="block"
                icon="search"
                title="No expenses match"
                message="Try a different search or filter."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFilter('all');
                      setSearch('');
                      setCategoryFilter('');
                      setPeriod('all');
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : null}

            {visible.length > 0 ? (
              <>
                <div className={styles.head} aria-hidden="true">
                  <span>Date</span>
                  <span>What for</span>
                  <span className={styles.amount}>Amount</span>
                  <span>Status</span>
                  <span />
                </div>
                <ul className={styles.list} aria-label="Expenses">
                  {expensePage.rows.map((row) => {
                    const status = statusView(row);
                    const open = openId === row.expenseId;
                    const rowCaps = capsForRow(row, caps, reference?.policy ?? null);
                    const quick = quickAction(row, rowCaps);
                    return (
                      <li key={row.expenseId} className={styles.item}>
                        <div className={styles.rowWrap}>
                          <button
                            type="button"
                            className={styles.row}
                            aria-expanded={open}
                            aria-controls={`expense-${row.expenseId}`}
                            onClick={() => setOpenId(open ? null : row.expenseId)}
                          >
                            <span className={styles.cell}>
                              {formatFriendlyDate(row.expenseDate)}
                            </span>
                            <span className={`${styles.cell} ${styles.what}`}>
                              <strong>{row.description}</strong>
                              <small>
                                {[
                                  row.category.name,
                                  row.payee,
                                  stations.length > 1 ? stationName(row.stationId) : '',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </small>
                            </span>
                            <span className={`${styles.cell} ${styles.amount}`}>
                              {formatTileMoney(row.amount)}
                            </span>
                            <span className={styles.cell}>
                              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                            </span>
                            <span className={styles.chevron} aria-hidden="true">
                              <Icon name="chevron-right" />
                            </span>
                          </button>
                          {quick ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              className={styles.quick}
                              onClick={() => openSheet({ kind: quick.kind, expense: row })}
                            >
                              {quick.label}
                            </Button>
                          ) : null}
                        </div>
                        {open ? (
                          <div id={`expense-${row.expenseId}`} className={styles.detail}>
                            <ExpenseDetail
                              row={row}
                              caps={rowCaps}
                              payments={details[row.expenseId]}
                              error={detailError}
                              stationLabel={stations.length > 1 ? stationName(row.stationId) : ''}
                              onAction={(kind) => openSheet({ kind, expense: row })}
                              onUndo={(payment) =>
                                openSheet({ kind: 'undoPay', expense: row, payment })
                              }
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <Pagination slice={expensePage} label="Expenses pages" noun="expenses" />
              </>
            ) : null}
          </>
        )}
      </Card>

      <Modal
        open={sheet !== null && stepUpRetry === null}
        onClose={closeSheet}
        title={sheetTitle(sheet)}
        presentation="page"
        backLabel="Expenses"
        description={guided ? undefined : sheetDescription(sheet)}
        dismissible={!busy}
        footer={
          guided ? undefined : (
            <>
              <Button variant="secondary" onClick={closeSheet} disabled={busy}>
                {sheet && ['reverse', 'reject', 'undoPay'].includes(sheet.kind)
                  ? 'Keep it'
                  : 'Cancel'}
              </Button>
              <Button
                type="submit"
                form="expense-sheet-form"
                loading={busy}
                variant={
                  sheet && ['reverse', 'undoPay'].includes(sheet.kind) ? 'danger' : 'primary'
                }
              >
                {sheetAction(sheet)}
              </Button>
            </>
          )
        }
      >
        {sheet?.kind === 'add' ? (
          <ExpenseKindStep
            kinds={['new', 'regular']}
            onPick={(kind) => openSheet({ kind })}
            onCancel={closeSheet}
          />
        ) : null}
        {sheet?.kind === 'new' && expenseSeed ? (
          <ExpenseWizard
            categories={activeCategories.map((category) => ({
              id: category.categoryId,
              name: category.name,
            }))}
            stations={stations}
            stationLocked={stationIsFixed}
            today={today}
            initial={expenseSeed}
            kindsHint={
              <p className={styles.hint}>
                No kinds yet.{' '}
                {caps?.manageCategories ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => void addUsualKinds()}>
                      Add the usual kinds
                    </Button>{' '}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openSheet({ kind: 'categories' })}
                    >
                      Add one
                    </Button>
                  </>
                ) : (
                  'Ask a manager to add one.'
                )}
              </p>
            }
            busy={busy}
            error={formError}
            onCancel={closeSheet}
            onSubmit={submitExpense}
          />
        ) : null}
        {sheet?.kind === 'regular' && regularSeed ? (
          <RegularCostWizard
            categories={activeRecurringCategories.map((category) => ({
              id: category.categoryId,
              name: category.name,
            }))}
            stations={stations}
            initial={regularSeed}
            busy={busy}
            error={formError}
            onCancel={closeSheet}
            onSubmit={submitRegular}
          />
        ) : null}
        {sheet?.kind === 'categories' ? (
          <CategoryWizard
            key={reference.categories.length}
            categories={reference.categories.map((category) => ({
              categoryId: category.categoryId,
              name: category.name,
              note:
                category.status !== 'ACTIVE'
                  ? 'Switched off'
                  : category.classification === 'OPERATING'
                    ? ''
                    : 'Not for manual entry',
            }))}
            busy={busy}
            error={formError}
            onClose={closeSheet}
            onSubmit={submitCategory}
          />
        ) : null}
        {sheet?.kind === 'limits' ? (
          <ApprovalLimitsWizard
            current={{
              stepUp: reference.policy?.stepUpThreshold ?? '',
              second: reference.policy?.secondApprovalThreshold ?? '',
              supervisor: reference.policy?.supervisorApprovalLimit ?? '',
            }}
            busy={busy}
            error={formError}
            onCancel={closeSheet}
            onSubmit={submitLimits}
          />
        ) : null}
        {guided ? null : (
          <>
            {formError ? <ErrorState message={formError} /> : null}
            <form
              id="expense-sheet-form"
              className="stack"
              onSubmit={(event) => void submitSheet(event)}
            >
              {sheet &&
              (sheet.kind === 'reject' || sheet.kind === 'reverse' || sheet.kind === 'undoPay') ? (
                <Field
                  id="expense-reason"
                  label={sheet.kind === 'reject' ? 'Why is it being rejected?' : 'Why?'}
                  required
                >
                  <textarea
                    rows={3}
                    value={reason}
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
              ) : null}

              {sheet?.kind === 'pay' ? (
                <>
                  <div className={styles.pair}>
                    <Field id="pay-amount" label="Amount paid (USD)" required>
                      <input
                        inputMode="decimal"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        autoComplete="off"
                      />
                    </Field>
                    <Field id="pay-date" label="Date paid" required>
                      <input
                        type="date"
                        value={date}
                        max={today}
                        onChange={(event) => setDate(event.target.value)}
                      />
                    </Field>
                  </div>
                  <fieldset className={styles.choices}>
                    <legend>How was it paid?</legend>
                    {PAY_SOURCES.map((source) => (
                      <label key={source.value} className={styles.choice}>
                        <input
                          type="radio"
                          name="pay-source"
                          checked={paySource === source.value}
                          onChange={() => setPaySource(source.value)}
                        />
                        <span>{source.label}</span>
                      </label>
                    ))}
                    <label className={styles.choice} data-disabled="true">
                      <input type="radio" name="pay-source" disabled />
                      <span>Paid from the till (not available here yet)</span>
                    </label>
                  </fieldset>
                  <Field
                    id="pay-reference"
                    label={
                      PAY_SOURCES.find((source) => source.value === paySource)?.refLabel ??
                      'Reference'
                    }
                    hint={PAY_SOURCES.find((source) => source.value === paySource)?.hint}
                    required
                  >
                    <input
                      value={payRef}
                      maxLength={160}
                      onChange={(event) => setPayRef(event.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                </>
              ) : null}
            </form>
          </>
        )}
      </Modal>

      <StepUpDialog
        open={stepUpRetry !== null}
        tenantId={tenantId}
        description="This change needs a fresh identity check first. Nothing is saved until you confirm."
        confirmLabel="Confirm and continue"
        cancelledMessage="The check was cancelled or did not pass. Nothing was saved."
        onVerified={() => {
          const retry = stepUpRetry;
          setStepUpRetry(null);
          retry?.();
        }}
        onCancel={() => {
          setStepUpRetry(null);
          setFormError('The identity check was cancelled, so nothing was saved.');
        }}
      />
    </div>
  );
}

/** Someone limited to the supervisor limit cannot approve an expense above it. */
function capsForRow(
  row: ExpenseRow,
  caps: ExpenseCapabilities | undefined,
  policy: ExpensePolicyView | null,
): ExpenseCapabilities | undefined {
  if (!caps || !caps.approve || caps.approveAnyAmount) return caps;
  const limit = policy?.supervisorApprovalLimit;
  const within = limit != null && withinApprovalLimit(row.amount, limit);
  return within ? caps : { ...caps, approve: false };
}

function quickAction(
  row: ExpenseRow,
  caps: ExpenseCapabilities | undefined,
): { kind: 'approve' | 'post' | 'pay'; label: string } | null {
  if (row.state === 'SUBMITTED' && caps?.approve) return { kind: 'approve', label: 'Approve' };
  if (row.state === 'APPROVED' && caps?.post) return { kind: 'post', label: 'Record' };
  if (
    row.state === 'POSTED' &&
    caps?.recordPayment &&
    row.outstanding !== null &&
    Number(row.outstanding) > 0
  )
    return { kind: 'pay', label: 'Record payment' };
  return null;
}

function sheetTitle(sheet: Sheet | null): string {
  switch (sheet?.kind) {
    case 'add':
      return 'Add an expense';
    case 'new':
      return 'Enter an expense';
    case 'categories':
      return 'Kinds of expense';
    case 'regular':
      return 'Add a regular cost';
    case 'limits':
      return 'Approval limits';
    case 'approve':
      return 'Approve this expense?';
    case 'reject':
      return 'Reject this expense?';
    case 'post':
      return 'Record this expense?';
    case 'reverse':
      return 'Cancel this expense?';
    case 'pay':
      return 'Record a payment';
    case 'undoPay':
      return 'Undo this payment?';
    default:
      return '';
  }
}

function sheetAction(sheet: Sheet | null): string {
  switch (sheet?.kind) {
    case 'new':
      return 'Enter expense';
    case 'approve':
      return 'Approve';
    case 'reject':
      return 'Reject expense';
    case 'post':
      return 'Record expense';
    case 'reverse':
      return 'Cancel expense';
    case 'pay':
      return 'Record payment';
    case 'undoPay':
      return 'Undo payment';
    case 'regular':
      return 'Add regular cost';
    case 'limits':
      return 'Save limits';
    default:
      return 'Save';
  }
}

function sheetDescription(sheet: Sheet | null): string {
  if (!sheet) return '';
  switch (sheet.kind) {
    case 'add':
      return '';
    case 'new':
      return 'It counts as spending once approved and recorded.';
    case 'categories':
      return 'Choices shown when entering an expense.';
    case 'regular':
      return 'A cost that repeats every month, such as rent or security. You add each month yourself.';
    case 'limits':
      return 'Bigger expenses ask for an extra check. Leave a box empty for no limit.';
    case 'approve':
      return `${formatTileMoney(sheet.expense.amount)} for “${sheet.expense.description}”. It counts as spending once recorded.`;
    case 'reject':
      return `${formatTileMoney(sheet.expense.amount)} for “${sheet.expense.description}” will not be paid or counted. Your reason is shown to whoever entered it.`;
    case 'post':
      return `${formatTileMoney(sheet.expense.amount)} for “${sheet.expense.description}” will count as spending in ${monthTitle(sheet.expense.expenseDate)}.`;
    case 'reverse':
      return `${formatTileMoney(sheet.expense.amount)} for “${sheet.expense.description}” will be taken out of the month’s spending. This cannot be undone.`;
    case 'pay':
      return `Still owed: ${formatTileMoney(sheet.expense.outstanding)}. Records a payment; no money moves.`;
    case 'undoPay':
      return `The ${formatTileMoney(sheet.payment.amount)} payment will be undone and owed again.`;
  }
}

function ExpenseDetail({
  row,
  caps,
  payments,
  error,
  stationLabel,
  onAction,
  onUndo,
}: {
  row: ExpenseRow;
  caps: ExpenseCapabilities | undefined;
  payments: Payment[] | undefined;
  error: string | null;
  stationLabel: string;
  onAction: (kind: 'approve' | 'reject' | 'post' | 'reverse' | 'pay') => void;
  onUndo: (payment: Payment) => void;
}) {
  const hasOutstanding = row.outstanding !== null && Number(row.outstanding) > 0;
  const buttons: Array<{
    kind: 'approve' | 'reject' | 'post' | 'reverse' | 'pay';
    label: string;
    variant?: 'secondary' | 'danger';
  }> = [];
  let needs: string | null = null;
  if (row.state === 'SUBMITTED') {
    if (caps?.approve) {
      buttons.push(
        { kind: 'approve', label: 'Approve' },
        { kind: 'reject', label: 'Reject', variant: 'secondary' },
      );
    } else needs = 'This is waiting for someone with a higher approval limit.';
  }
  if (row.state === 'APPROVED') {
    if (caps?.post) buttons.push({ kind: 'post', label: 'Record expense' });
    else needs = 'This is approved. Someone with permission needs to record it.';
  }
  if (row.state === 'POSTED') {
    if (caps?.recordPayment && hasOutstanding)
      buttons.push({ kind: 'pay', label: 'Record a payment' });
    if (caps?.reverse)
      buttons.push({ kind: 'reverse', label: 'Cancel this expense', variant: 'danger' });
  }

  return (
    <>
      <dl className={styles.facts}>
        <div>
          <dt>Amount</dt>
          <dd>{formatTileMoney(row.amount)}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{row.category.name}</dd>
        </div>
        <div>
          <dt>Date spent</dt>
          <dd>{formatFriendlyDate(row.expenseDate)}</dd>
        </div>
        {row.payee ? (
          <div>
            <dt>Paid to</dt>
            <dd>{row.payee}</dd>
          </div>
        ) : null}
        {row.reference ? (
          <div>
            <dt>Receipt number</dt>
            <dd>{row.reference}</dd>
          </div>
        ) : null}
        {stationLabel ? (
          <div>
            <dt>Station</dt>
            <dd>{stationLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt>Entered</dt>
          <dd>{formatFriendlyDate(row.submittedAt)}</dd>
        </div>
        {row.state === 'POSTED' ? (
          <div>
            <dt>Paid so far</dt>
            <dd>
              {formatTileMoney(row.settledAmount)} of {formatTileMoney(row.amount)}
            </dd>
          </div>
        ) : null}
        {row.rejectionReason ? (
          <div>
            <dt>Rejected because</dt>
            <dd>{row.rejectionReason}</dd>
          </div>
        ) : null}
        {row.reversalReason ? (
          <div>
            <dt>Cancelled because</dt>
            <dd>{row.reversalReason}</dd>
          </div>
        ) : null}
      </dl>

      {row.state === 'POSTED' ? (
        <div>
          <strong>Payments</strong>
          {error ? <p className={styles.hint}>{error}</p> : null}
          {!payments && !error ? <p className={styles.hint}>Loading payments…</p> : null}
          {payments && payments.length === 0 ? (
            <p className={styles.hint}>No payment has been recorded yet.</p>
          ) : null}
          {payments && payments.length > 0 ? (
            <ul className={styles.payments}>
              {payments.map((payment) => (
                <li key={payment.paymentId} className={styles.payment}>
                  <span>
                    {formatFriendlyDate(payment.paymentDate)} · {formatTileMoney(payment.amount)} ·{' '}
                    {SOURCE_WORDS[payment.settlementSource] ?? 'Other'}
                    {payment.externalReference ? ` · ${payment.externalReference}` : ''}
                    {payment.state === 'REVERSED' ? ' · Undone' : ''}
                  </span>
                  {payment.state === 'RECORDED' && caps?.reversePayment ? (
                    <Button variant="quiet" size="sm" onClick={() => onUndo(payment)}>
                      Undo payment
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {buttons.length > 0 ? (
        <div className={styles.actions}>
          {buttons.map((button) => (
            <Button
              key={button.kind}
              variant={button.variant}
              onClick={() => onAction(button.kind)}
            >
              {button.label}
            </Button>
          ))}
        </div>
      ) : null}
      {needs ? <p className={styles.hint}>{needs}</p> : null}
    </>
  );
}
