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
import { formatTileMoney } from '@/modules/reporting/format';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';
import styles from './expenses.module.css';
import {
  EXPENSE_FILTERS,
  PERIODS,
  amountForInput,
  categoryCodeFromName,
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
  statusView,
  sumAmounts,
  todayInBusinessTime,
  type ExpenseFilter,
  type ExpenseRow,
  type PeriodKey,
} from './expense-format';

export type ExpenseCapabilities = {
  submit: boolean;
  approve: boolean;
  post: boolean;
  reverse: boolean;
  recordPayment: boolean;
  reversePayment: boolean;
  manageCategories: boolean;
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
  | { kind: 'new' }
  | { kind: 'categories' }
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
    value: 'REIMBURSEMENT',
    label: 'Paid back to someone who covered it',
    refLabel: 'Who was paid back, and how',
    hint: 'For example: Refunded to T. Moyo in cash on 12 Oct.',
  },
] as const;

const SOURCE_WORDS: Record<string, string> = {
  BANK: 'Bank',
  CASH: 'Cash',
  REIMBURSEMENT: 'Paid back to staff',
};

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
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Payment[]>>({});
  const [detailError, setDetailError] = useState<string | null>(null);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stepUpRetry, setStepUpRetry] = useState<(() => void) | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  // Form fields, reset whenever a sheet opens.
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
  const [receipt, setReceipt] = useState('');
  const [stationId, setStationId] = useState('');
  const [reason, setReason] = useState('');
  const [paySource, setPaySource] = useState<'BANK' | 'REIMBURSEMENT'>('BANK');
  const [payRef, setPayRef] = useState('');
  const [newCategory, setNewCategory] = useState('');

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

  const activeCategories = (reference?.categories ?? []).filter(
    (category) => category.status === 'ACTIVE' && category.classification === 'OPERATING',
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
      setCategoryId(activeCategories.length === 1 ? (activeCategories[0]?.categoryId ?? '') : '');
      setAmount('');
      setDate(today);
      setPayee('');
      setDescription('');
      setReceipt('');
      setStationId(
        current?.stationId && !current.allStations
          ? current.stationId
          : stations.length === 1
            ? (stations[0]?.id ?? '')
            : '',
      );
    }
    if (next.kind === 'pay') {
      setAmount(amountForInput(next.expense.outstanding));
      setDate(today);
      setPaySource('BANK');
      setPayRef('');
    }
    if (next.kind === 'categories') setNewCategory('');
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
      setNotice(successMessage);
      setDetails({});
      await refresh();
      if (openId) void loadPayments(openId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'This could not be saved.';
      if (!confirmed && isStepUpMessage(message)) {
        setStepUpRetry(() => () => void send(body, successMessage, keepOpenAfter, true));
      } else {
        setFormError(friendlyError(message, 'This could not be saved.'));
        void refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function scope(station: string) {
    return { tenantId, stationId: station };
  }

  async function submitSheet(event: FormEvent) {
    event.preventDefault();
    if (!sheet) return;
    setFormError(null);

    if (sheet.kind === 'new') {
      const value = parseAmount(amount);
      if (!categoryId) return setFormError('Choose what kind of expense this is.');
      if (!value) return setFormError('Enter the amount spent, for example 25.50.');
      if (!stationId) return setFormError('Choose the station that spent the money.');
      if (!description.trim()) return setFormError('Say what the money was spent on.');
      if (!date) return setFormError('Choose the date the money was spent.');
      return send(
        {
          commandType: 'SubmitExpense',
          ...scope(stationId),
          categoryId,
          expenseDate: date,
          description: description.trim(),
          amount: value,
          ...(payee.trim() ? { payee: payee.trim() } : {}),
          ...(receipt.trim() ? { reference: receipt.trim() } : {}),
        },
        'Expense entered. It now waits for approval.',
      );
    }

    if (sheet.kind === 'categories') {
      const name = newCategory.trim();
      const code = categoryCodeFromName(name);
      if (!name || !code) return setFormError('Type a name for the category, for example Repairs.');
      return send(
        {
          commandType: 'CreateExpenseCategory',
          tenantId,
          legalEntityId,
          code,
          name,
          classification: 'OPERATING',
        },
        `Category “${name}” added.`,
        true,
      ).then(() => setNewCategory(''));
    }

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

  // Derived lists.
  const range = periodRange(today, period);
  const base = items.filter(
    (row) =>
      inPeriod(row.expenseDate, range) &&
      (!categoryFilter || row.category.id === categoryFilter) &&
      matchesSearch(row, search),
  );
  const visible = base.filter((row) => matchesFilter(row, filter));
  const waiting = items.filter((row) => row.state === 'SUBMITTED');
  const ready = items.filter((row) => row.state === 'APPROVED');
  const { total: spent, shares } = categoryShares(summary.byCategory);
  const waitingTotal = sumAmounts(waiting.map((row) => row.amount));

  return (
    <div className={styles.page}>
      <p className={styles.intro}>
        Money spent running the station, such as repairs, cleaning and staff meals. Enter each one,
        get it approved, then record how it was paid.
      </p>

      {notice ? <SuccessState title="Done" message={notice} /> : null}
      {loadError ? (
        <ErrorState
          message={loadError}
          action={<Button onClick={() => void refresh()}>Try again</Button>}
        />
      ) : null}

      <dl className={styles.tiles} aria-label="Expenses at a glance">
        <div className={styles.tile}>
          <dt>Spent this month</dt>
          <dd>
            {formatTileMoney(spent)}
            <span className={styles.tileNote}>Recorded expenses in {monthTitle(month.from)}</span>
          </dd>
        </div>
        <button
          type="button"
          className={`${styles.tile}`}
          onClick={() => setFilter('waiting')}
          aria-label={`Waiting for approval: ${waiting.length}. Show them.`}
        >
          <dt>Waiting for approval</dt>
          <dd>
            {waiting.length === 0 ? 'None' : `${waiting.length} · ${formatTileMoney(waitingTotal)}`}
            <span className={styles.tileNote}>
              {ready.length > 0
                ? `${ready.length} more approved and ready to record`
                : 'Nothing else is held up'}
            </span>
          </dd>
        </button>
        <button
          type="button"
          className={styles.tile}
          onClick={() => setFilter('unpaid')}
          aria-label="Not paid yet. Show these expenses."
        >
          <dt>Not paid yet</dt>
          <dd>
            {formatTileMoney(summary.payables.postedExpensesOutstanding)}
            <span className={styles.tileNote}>Recorded expenses still owed</span>
          </dd>
        </button>
      </dl>

      <Card as="section" aria-labelledby="expense-categories-title">
        <div className={styles.sectionHead}>
          <h2 id="expense-categories-title">Where the money went in {monthTitle(month.from)}</h2>
          {caps?.manageCategories ? (
            <Button variant="quiet" size="sm" onClick={() => openSheet({ kind: 'categories' })}>
              Manage categories
            </Button>
          ) : null}
        </div>
        {shares.length === 0 ? (
          <p className={styles.muted}>
            Nothing has been recorded this month yet. Spending shows here once an approved expense
            is recorded.
          </p>
        ) : (
          <ul className={styles.categories}>
            {shares.map((row) => (
              <li key={row.categoryId} className={styles.categoryRow}>
                <span className={styles.categoryName}>{row.name}</span>
                <span className={styles.bar} aria-hidden="true">
                  <span style={{ width: `${row.percent}%` }} />
                </span>
                <span className={styles.amount}>{formatTileMoney(row.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" aria-labelledby="expense-list-title">
        <div className={styles.sectionHead}>
          <h2 id="expense-list-title">All expenses</h2>
          {items.length >= 200 ? (
            <span className={styles.muted}>Showing the latest 200 expenses.</span>
          ) : null}
        </div>
        <div className={styles.toolbar}>
          {items.length > 0 ? (
            <>
              <label className="list-search">
                <Icon name="search" />
                <input
                  type="search"
                  aria-label="Search expenses"
                  placeholder="Search by what, who or receipt number…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <select
                aria-label="Show expenses from"
                value={period}
                onChange={(event) => setPeriod(event.target.value as PeriodKey)}
              >
                {PERIODS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Kind of expense"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="">All kinds</option>
                {(reference.categories ?? []).map((category) => (
                  <option key={category.categoryId} value={category.categoryId}>
                    {category.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {caps?.submit ? (
            <Button className={styles.toolbarAction} onClick={() => openSheet({ kind: 'new' })}>
              Enter an expense
            </Button>
          ) : null}
        </div>

        {items.length > 0 ? (
          <div className={styles.chips} role="group" aria-label="Filter expenses">
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

        {refreshing && items.length === 0 ? <LoadingState label="Loading expenses" /> : null}
        {items.length === 0 && !refreshing ? (
          <EmptyState
            layout="block"
            icon="receipt"
            title="No expenses yet"
            message={
              caps?.submit
                ? 'When money is spent, for example on a repair or tea for staff, use Enter an expense.'
                : 'Expenses entered by your team will show here.'
            }
          />
        ) : null}
        {items.length > 0 && visible.length === 0 ? (
          <EmptyState
            layout="block"
            icon="search"
            title="No expenses match"
            message="Try another word, another month, or choose All."
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
              {visible.map((row) => {
                const status = statusView(row);
                const open = openId === row.expenseId;
                return (
                  <li key={row.expenseId} className={styles.item}>
                    <button
                      type="button"
                      className={styles.row}
                      aria-expanded={open}
                      aria-controls={`expense-${row.expenseId}`}
                      onClick={() => setOpenId(open ? null : row.expenseId)}
                    >
                      <span className={styles.cell}>{formatFriendlyDate(row.expenseDate)}</span>
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
                    {open ? (
                      <div id={`expense-${row.expenseId}`} className={styles.detail}>
                        <ExpenseDetail
                          row={row}
                          caps={caps}
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
          </>
        ) : null}
      </Card>

      <Modal
        open={sheet !== null && stepUpRetry === null}
        onClose={closeSheet}
        title={sheetTitle(sheet)}
        description={sheetDescription(sheet)}
        dismissible={!busy}
        footer={
          sheet?.kind === 'categories' ? (
            <Button variant="secondary" onClick={closeSheet}>
              Done
            </Button>
          ) : (
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
        {formError ? <ErrorState message={formError} /> : null}
        <form
          id="expense-sheet-form"
          className="stack"
          onSubmit={(event) => void submitSheet(event)}
        >
          {sheet?.kind === 'new' ? (
            <>
              {activeCategories.length === 0 ? (
                <p className={styles.hint}>
                  There are no expense kinds yet.{' '}
                  {caps?.manageCategories
                    ? 'Close this and use Manage categories to add one, for example Repairs.'
                    : 'Ask a manager to add one, for example Repairs.'}
                </p>
              ) : null}
              <Field id="expense-category" label="What kind of expense is it?" required>
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">Choose…</option>
                  {activeCategories.map((category) => (
                    <option key={category.categoryId} value={category.categoryId}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="expense-description" label="What was it for?" required>
                <input
                  value={description}
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="For example: Replaced pump hose"
                  autoComplete="off"
                />
              </Field>
              <Field id="expense-amount" label="Amount (USD)" required>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  autoComplete="off"
                />
              </Field>
              <Field id="expense-date" label="Date spent" required>
                <input
                  type="date"
                  value={date}
                  max={today}
                  onChange={(event) => setDate(event.target.value)}
                />
              </Field>
              {stations.length > 1 && !(current.stationId && !current.allStations) ? (
                <Field id="expense-station" label="Which station?" required>
                  <select value={stationId} onChange={(event) => setStationId(event.target.value)}>
                    <option value="">Choose…</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field id="expense-payee" label="Who was it paid to?" optional>
                <input
                  value={payee}
                  maxLength={160}
                  onChange={(event) => setPayee(event.target.value)}
                  placeholder="Shop, supplier or person"
                  autoComplete="off"
                />
              </Field>
              <Field
                id="expense-receipt"
                label="Receipt or invoice number"
                hint="Helps stop the same receipt being entered twice."
                optional
              >
                <input
                  value={receipt}
                  maxLength={120}
                  onChange={(event) => setReceipt(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            </>
          ) : null}

          {sheet?.kind === 'categories' ? (
            <>
              {reference.categories.length === 0 ? (
                <p className={styles.hint}>
                  No kinds of expense have been set up yet. Add the first one below.
                </p>
              ) : (
                <ul className={styles.categoryList} aria-label="Expense kinds">
                  {reference.categories.map((category) => (
                    <li key={category.categoryId}>
                      <span>{category.name}</span>
                      <span className={styles.muted}>
                        {category.status !== 'ACTIVE'
                          ? 'Switched off'
                          : category.classification === 'OPERATING'
                            ? ''
                            : 'Not for manual entry'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Field
                id="new-category"
                label="Add a kind of expense"
                hint="Short and clear, for example Repairs or Staff meals."
              >
                <input
                  value={newCategory}
                  maxLength={160}
                  onChange={(event) => setNewCategory(event.target.value)}
                  autoComplete="off"
                />
              </Field>
              <div>
                <Button type="submit" loading={busy}>
                  Add
                </Button>
              </div>
            </>
          ) : null}

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
                  PAY_SOURCES.find((source) => source.value === paySource)?.refLabel ?? 'Reference'
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

function sheetTitle(sheet: Sheet | null): string {
  switch (sheet?.kind) {
    case 'new':
      return 'Enter an expense';
    case 'categories':
      return 'Kinds of expense';
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
    default:
      return 'Save';
  }
}

function sheetDescription(sheet: Sheet | null): string {
  if (!sheet) return '';
  switch (sheet.kind) {
    case 'new':
      return 'It will wait for someone to approve it before it counts as spending.';
    case 'categories':
      return 'These choices appear when an expense is entered.';
    case 'approve':
      return `${formatTileMoney(sheet.expense.amount)} for “${sheet.expense.description}”. Approving says the money was properly spent. It is not counted as spending until it is recorded.`;
    case 'reject':
      return `${formatTileMoney(sheet.expense.amount)} for “${sheet.expense.description}” will not be paid or counted. The person who entered it will see your reason.`;
    case 'post':
      return `${formatTileMoney(sheet.expense.amount)} for “${sheet.expense.description}” will count as spending in ${monthTitle(sheet.expense.expenseDate)} and show as not paid yet.`;
    case 'reverse':
      return `${formatTileMoney(sheet.expense.amount)} for “${sheet.expense.description}” will be taken out of the month’s spending. The record stays in the history and this cannot be undone.`;
    case 'pay':
      return `Still owed: ${formatTileMoney(sheet.expense.outstanding)}. This records that money was paid out; it does not move any money.`;
    case 'undoPay':
      return `The ${formatTileMoney(sheet.payment.amount)} payment will be marked as undone and the amount will be owed again. The record stays in the history.`;
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
    } else needs = 'This is waiting for a manager to approve it.';
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
