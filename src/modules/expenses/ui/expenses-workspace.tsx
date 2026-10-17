'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { PageContainer, PageHeader } from '@/design-system/layout';
import { formatBusinessDate, formatMoney, formatStatusLabel } from '@/design-system/formatters';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
  SuccessState,
  type StatusTone,
} from '@/design-system/primitives';
import { TableScrollRegion } from '@/design-system/table';
import {
  EXPENSE_CLASSIFICATIONS,
  EXPENSE_SETTLEMENT_SOURCES,
  type ExpenseClassification,
  type ExpenseSettlementSource,
} from '@/modules/expenses/domain';

export type ExpensesContext = Readonly<{
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  organisationName: string;
  stationName: string;
  canSubmit: boolean;
  canApprove: boolean;
  canPost: boolean;
  canReverse: boolean;
  canManageRecurring: boolean;
}>;

type ExpenseRow = Readonly<{
  id: string;
  businessDate: string;
  description: string;
  category?: string;
  amount: string;
  currency: string;
  classification: string;
  settlementSource: string;
  state: string;
  version: number;
}>;

type RecurringTemplateRow = Readonly<{
  templateId: string;
  description: string;
  amount: string;
  currency: string;
  settlementSource: string;
  intervalUnit: string;
  intervalCount: number;
  anchorDate: string;
  active: boolean;
  approvalRequired: boolean;
  requiredApproverCount: number;
  requiresStepUp: boolean;
  version: number;
}>;

type JsonRecord = Record<string, unknown>;

const classificationLabels: Readonly<Record<ExpenseClassification, string>> = {
  OPERATING_EXPENSE: 'Operating expense',
  DIRECT_INVENTORY_COST: 'Direct inventory cost',
  RECURRING_FIXED_COST: 'Recurring fixed cost',
};

const settlementLabels: Readonly<Record<ExpenseSettlementSource, string>> = {
  CASH: 'Cash',
  BANK: 'Bank',
  PAYABLE: 'Payable',
  REIMBURSEMENT: 'Reimbursement',
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function apiMessage(value: unknown, fallback: string): string {
  if (isRecord(value)) {
    const message = value.message ?? value.error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function parseExpenseRows(value: unknown): ExpenseRow[] {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.expenses)
      ? value.expenses
      : null;
  if (!rows) throw new Error('The expenses response was not a list. Try again.');
  return rows as ExpenseRow[];
}

function statusTone(state: string): StatusTone {
  switch (state) {
    case 'APPROVED':
    case 'POSTED':
      return 'positive';
    case 'RETURNED':
      return 'warning';
    case 'REJECTED':
      return 'critical';
    case 'REVERSED':
      return 'locked';
    case 'SUBMITTED':
      return 'pending';
    default:
      return 'neutral';
  }
}

function classificationLabel(value: string): string {
  return classificationLabels[value as ExpenseClassification] ?? formatStatusLabel(value);
}

function settlementLabel(value: string): string {
  return settlementLabels[value as ExpenseSettlementSource] ?? formatStatusLabel(value);
}

export function ExpensesWorkspace({ context }: { context: ExpensesContext }) {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTemplateRow[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [recurringError, setRecurringError] = useState<string | null>(null);

  const loadExpenses = useCallback(
    async (signal?: AbortSignal): Promise<ExpenseRow[]> => {
      const query = new URLSearchParams({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        stationId: context.stationId,
      });
      const response = await fetch(`/api/expenses?${query.toString()}`, {
        cache: 'no-store',
        signal,
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(apiMessage(body, 'Expenses could not be loaded.'));
      }
      return parseExpenseRows(body);
    },
    [context],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      setRows(await loadExpenses());
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : 'Expenses could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [loadExpenses]);

  const loadRecurringTemplates = useCallback(async () => {
    if (!context.canManageRecurring) return;
    setRecurringLoading(true);
    setRecurringError(null);
    try {
      const query = new URLSearchParams({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        stationId: context.stationId,
      });
      const response = await fetch(`/api/expenses/recurring?${query.toString()}`, {
        cache: 'no-store',
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(apiMessage(body, 'Recurring rules could not be loaded.'));
      setRecurringTemplates((Array.isArray(body) ? body : []) as RecurringTemplateRow[]);
    } catch (cause) {
      setRecurringError(
        cause instanceof Error ? cause.message : 'Recurring rules could not be loaded.',
      );
    } finally {
      setRecurringLoading(false);
    }
  }, [context]);

  useEffect(() => {
    const controller = new AbortController();
    void loadExpenses(controller.signal)
      .then(setRows)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setListError(cause instanceof Error ? cause.message : 'Expenses could not be loaded.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadExpenses]);

  useEffect(() => {
    void Promise.resolve().then(() => loadRecurringTemplates());
  }, [loadRecurringTemplates]);

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow="Owner and manager controls"
        title="Expenses"
        description={`Submit an expense for ${context.stationName} and review the server-confirmed expense history.`}
        actions={
          <Button
            variant="secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh list
          </Button>
        }
      />

      <div className="content-grid">
        <Card as="section" className="panel" aria-labelledby="expense-context-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Active work context</p>
              <h2 id="expense-context-heading">Where this expense belongs</h2>
            </div>
            <StatusBadge tone="informational">Explicit scope</StatusBadge>
          </div>
          <dl>
            <div>
              <dt>Organisation</dt>
              <dd>{context.organisationName}</dd>
            </div>
            <div>
              <dt>Legal entity</dt>
              <dd>{context.legalEntityId}</dd>
            </div>
            <div>
              <dt>Station</dt>
              <dd>{context.stationName}</dd>
            </div>
            <div>
              <dt>Station ID</dt>
              <dd>{context.stationId}</dd>
            </div>
          </dl>
          <p className="field-hint">
            The legal-entity and station identifiers are sent with both the list request and the
            submit command. Server authorization remains authoritative.
          </p>
        </Card>

        {context.canSubmit ? (
          <ExpenseForm
            submitting={submitting}
            error={submitError}
            successMessage={successMessage}
            onSubmit={async (payload, idempotencyKey) => {
              setSubmitting(true);
              setSubmitError(null);
              setSuccessMessage(null);
              try {
                const response = await fetch('/api/expenses/commands', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey,
                  },
                  body: JSON.stringify({
                    commandType: 'SubmitExpense',
                    ...payload,
                    tenantId: context.tenantId,
                    legalEntityId: context.legalEntityId,
                    stationId: context.stationId,
                  }),
                });
                const body = await readJson(response);
                if (!response.ok) {
                  throw new Error(apiMessage(body, 'The expense could not be submitted.'));
                }
                setSuccessMessage(
                  'Expense submitted. The list below will show the server-confirmed record.',
                );
                await refresh();
              } catch (cause) {
                setSubmitError(
                  cause instanceof Error ? cause.message : 'The expense could not be submitted.',
                );
                throw cause;
              } finally {
                setSubmitting(false);
              }
            }}
          />
        ) : (
          <Card as="section" className="panel" aria-labelledby="expense-submit-access-heading">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Expense control</p>
                <h2 id="expense-submit-access-heading">Submission access</h2>
              </div>
              <StatusBadge tone="locked">Read-only</StatusBadge>
            </div>
            <p>Your role can review this station&apos;s expenses but cannot submit new expenses.</p>
          </Card>
        )}

        {context.canManageRecurring ? (
          <RecurringTemplatesPanel
            context={context}
            rows={recurringTemplates}
            loading={recurringLoading}
            error={recurringError}
            onRefresh={() => void loadRecurringTemplates()}
          />
        ) : null}

        <Card as="section" className="panel" aria-labelledby="expense-history-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Read-only history</p>
              <h2 id="expense-history-heading">Submitted expenses</h2>
            </div>
            <StatusBadge tone="neutral">Server confirmed</StatusBadge>
          </div>
          {loading ? <LoadingState label="Loading expenses" /> : null}
          {listError ? (
            <ErrorState
              title="Expenses could not be loaded"
              message={listError}
              action={
                <Button type="button" variant="secondary" onClick={() => void refresh()}>
                  Try again
                </Button>
              }
            />
          ) : null}
          {!loading && !listError && rows.length === 0 ? (
            <EmptyState
              title="No expenses in this context"
              message="Submitted expenses will appear here after the first server-confirmed submission."
            />
          ) : null}
          {!loading && !listError && rows.length > 0 ? (
            <ExpenseTable context={context} rows={rows} onRefresh={refresh} />
          ) : null}
        </Card>
      </div>
    </PageContainer>
  );
}

function RecurringTemplatesPanel({
  context,
  rows,
  loading,
  error,
  onRefresh,
}: {
  context: ExpensesContext;
  rows: readonly RecurringTemplateRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [intervalUnit, setIntervalUnit] = useState<'DAY' | 'WEEK' | 'MONTH' | 'YEAR'>('MONTH');
  const [intervalCount, setIntervalCount] = useState('1');
  const [anchorDate, setAnchorDate] = useState('');
  const [settlementSource, setSettlementSource] = useState<ExpenseSettlementSource>('BANK');
  const [stepUpThreshold, setStepUpThreshold] = useState('');
  const [secondApproverThreshold, setSecondApproverThreshold] = useState('');
  const [generatingTemplateId, setGeneratingTemplateId] = useState<string | null>(null);
  const [periodDate, setPeriodDate] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function send(command: Record<string, unknown>, success: string): Promise<void> {
    const response = await fetch('/api/expenses/commands', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        ...command,
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        stationId: context.stationId,
      }),
    });
    const body = await readJson(response);
    if (!response.ok) throw new Error(apiMessage(body, 'The recurring expense command failed.'));
    setActionError(null);
    setActionMessage(success);
    onRefresh();
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await send(
        {
          commandType: 'CreateRecurringExpenseTemplate',
          description: description.trim(),
          amount: amount.trim(),
          currency: 'USD',
          settlementSource,
          intervalUnit,
          intervalCount: Number(intervalCount),
          anchorDate,
          approvalPolicy: {
            approvalRequired: true,
            ...(stepUpThreshold.trim() ? { stepUpThreshold: stepUpThreshold.trim() } : {}),
            ...(secondApproverThreshold.trim()
              ? { secondApproverThreshold: secondApproverThreshold.trim() }
              : {}),
          },
        },
        'Recurring rule saved.',
      );
      setDescription('');
      setAmount('');
      setAnchorDate('');
      setStepUpThreshold('');
      setSecondApproverThreshold('');
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'The recurring rule could not be saved.',
      );
      setActionMessage(null);
    }
  }

  async function generate(templateId: string) {
    setGeneratingTemplateId(templateId);
    try {
      await send(
        { commandType: 'GenerateRecurringCostPeriod', templateId, businessDate: periodDate },
        'Recurring expense generated and submitted for approval.',
      );
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'The recurring period could not be generated.',
      );
      setActionMessage(null);
    } finally {
      setGeneratingTemplateId(null);
    }
  }

  return (
    <Card as="section" className="panel" aria-labelledby="recurring-expense-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Owner configuration</p>
          <h2 id="recurring-expense-heading">Recurring cost rules</h2>
        </div>
        <StatusBadge tone="informational">Versioned</StatusBadge>
      </div>
      <p>
        Rules create a normal submitted expense on a due date. They never bypass approval or create
        a cash, bank, payable, or reimbursement movement.
      </p>
      <form className="form-grid" onSubmit={createTemplate}>
        <Field id="recurring-description" label="Description" required>
          <input
            id="recurring-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
        </Field>
        <Field id="recurring-amount" label="Amount" required>
          <input
            id="recurring-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            required
          />
        </Field>
        <Field id="recurring-interval-unit" label="Every" required>
          <select
            id="recurring-interval-unit"
            value={intervalUnit}
            onChange={(event) => setIntervalUnit(event.target.value as typeof intervalUnit)}
          >
            <option value="DAY">Day(s)</option>
            <option value="WEEK">Week(s)</option>
            <option value="MONTH">Month(s)</option>
            <option value="YEAR">Year(s)</option>
          </select>
        </Field>
        <Field id="recurring-interval-count" label="Interval count" required>
          <input
            id="recurring-interval-count"
            type="number"
            min="1"
            max="3650"
            value={intervalCount}
            onChange={(event) => setIntervalCount(event.target.value)}
            required
          />
        </Field>
        <Field id="recurring-anchor-date" label="First due date" required>
          <input
            id="recurring-anchor-date"
            type="date"
            value={anchorDate}
            onChange={(event) => setAnchorDate(event.target.value)}
            required
          />
        </Field>
        <Field id="recurring-settlement" label="Settlement source" required>
          <select
            id="recurring-settlement"
            value={settlementSource}
            onChange={(event) => setSettlementSource(event.target.value as ExpenseSettlementSource)}
          >
            {EXPENSE_SETTLEMENT_SOURCES.map((option) => (
              <option key={option} value={option}>
                {settlementLabel(option)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="recurring-step-up" label="Step-up threshold" optional>
          <input
            id="recurring-step-up"
            value={stepUpThreshold}
            onChange={(event) => setStepUpThreshold(event.target.value)}
            inputMode="decimal"
          />
        </Field>
        <Field id="recurring-second-approver" label="Second approver threshold" optional>
          <input
            id="recurring-second-approver"
            value={secondApproverThreshold}
            onChange={(event) => setSecondApproverThreshold(event.target.value)}
            inputMode="decimal"
          />
        </Field>
        <div>
          <Button type="submit">Save recurring rule</Button>
        </div>
      </form>
      <Field
        id="recurring-period-date"
        label="Generate due period"
        hint="The date must match a configured occurrence."
      >
        <input
          id="recurring-period-date"
          type="date"
          value={periodDate}
          onChange={(event) => setPeriodDate(event.target.value)}
        />
      </Field>
      {loading ? <LoadingState label="Loading recurring rules" /> : null}
      {error ? (
        <ErrorState
          title="Recurring rules could not be loaded"
          message={error}
          action={
            <Button type="button" variant="secondary" onClick={onRefresh}>
              Try again
            </Button>
          }
        />
      ) : null}
      {actionError ? <ErrorState title="Recurring action failed" message={actionError} /> : null}
      {actionMessage ? (
        <SuccessState title="Recurring action complete" message={actionMessage} />
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title="No recurring rules"
          message="Owner-configured recurring costs will appear here."
        />
      ) : null}
      {rows.length > 0 ? (
        <TableScrollRegion label="Recurring expense rules">
          <table className="responsive-table">
            <caption className="visually-hidden">Recurring expense rules</caption>
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Schedule</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.templateId}>
                  <td data-label="Rule">{row.description}</td>
                  <td data-label="Schedule">
                    Every {row.intervalCount} {row.intervalUnit.toLowerCase()}(s) from{' '}
                    {formatBusinessDate(row.anchorDate)}
                  </td>
                  <td data-label="Amount" className="numeric">
                    {formatMoney(row.amount, row.currency)}
                  </td>
                  <td data-label="Status">
                    <StatusBadge tone={row.active ? 'positive' : 'locked'}>
                      {row.active ? 'Active' : 'Inactive'}
                    </StatusBadge>
                  </td>
                  <td data-label="Action">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={
                        !row.active || !periodDate || generatingTemplateId === row.templateId
                      }
                      loading={generatingTemplateId === row.templateId}
                      onClick={() => void generate(row.templateId)}
                    >
                      Generate
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      ) : null}
    </Card>
  );
}

type ExpenseFormProps = Readonly<{
  submitting: boolean;
  error: string | null;
  successMessage: string | null;
  onSubmit: (
    payload: Readonly<{
      businessDate: string;
      description: string;
      category?: string;
      amount: string;
      currency: 'USD';
      classification: ExpenseClassification;
      settlementSource: ExpenseSettlementSource;
    }>,
    idempotencyKey: string,
  ) => Promise<void>;
}>;

function ExpenseForm({ submitting, error, successMessage, onSubmit }: ExpenseFormProps) {
  const idempotencyKey = useRef<string | null>(null);
  const [businessDate, setBusinessDate] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [classification, setClassification] = useState<ExpenseClassification>('OPERATING_EXPENSE');
  const [settlementSource, setSettlementSource] = useState<ExpenseSettlementSource>('CASH');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      await onSubmit(
        {
          businessDate,
          description: description.trim(),
          ...(category.trim() ? { category: category.trim() } : {}),
          amount: amount.trim(),
          currency: 'USD',
          classification,
          settlementSource,
        },
        idempotencyKey.current,
      );
      idempotencyKey.current = null;
      setBusinessDate('');
      setDescription('');
      setCategory('');
      setAmount('');
      setClassification('OPERATING_EXPENSE');
      setSettlementSource('CASH');
    } catch {
      // The parent renders the command error and keeps the idempotency key for retry.
    }
  }

  return (
    <Card as="section" className="panel" aria-labelledby="expense-form-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Named command</p>
          <h2 id="expense-form-heading">Submit an expense</h2>
        </div>
        <StatusBadge tone="informational">SubmitExpense</StatusBadge>
      </div>
      <p>
        Record the economic expense separately from how it is settled. The server decides the
        resulting approval and posting state.
      </p>
      <form className="form-grid" onSubmit={submit}>
        <Field id="expense-business-date" label="Business date" required>
          <input
            id="expense-business-date"
            type="date"
            value={businessDate}
            onChange={(event) => setBusinessDate(event.target.value)}
            required
          />
        </Field>
        <Field id="expense-description" label="Description" required>
          <input
            id="expense-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
        </Field>
        <Field
          id="expense-category"
          label="Category"
          optional
          hint="Use configured tenant terminology when available."
        >
          <input
            id="expense-category"
            type="text"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </Field>
        <Field
          id="expense-amount"
          label="Amount"
          required
          hint="Enter the exact amount without rounding in the browser."
        >
          <input
            id="expense-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </Field>
        <Field id="expense-currency" label="Currency">
          <input id="expense-currency" type="text" value="USD" readOnly aria-readonly="true" />
        </Field>
        <Field id="expense-classification" label="Expense classification" required>
          <select
            id="expense-classification"
            value={classification}
            onChange={(event) => setClassification(event.target.value as ExpenseClassification)}
            required
          >
            {EXPENSE_CLASSIFICATIONS.map((option) => (
              <option key={option} value={option}>
                {classificationLabel(option)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="expense-settlement-source" label="Settlement source" required>
          <select
            id="expense-settlement-source"
            value={settlementSource}
            onChange={(event) => setSettlementSource(event.target.value as ExpenseSettlementSource)}
            required
          >
            {EXPENSE_SETTLEMENT_SOURCES.map((option) => (
              <option key={option} value={option}>
                {settlementLabel(option)}
              </option>
            ))}
          </select>
        </Field>
        {error ? <ErrorState title="Expense was not submitted" message={error} /> : null}
        {successMessage ? (
          <SuccessState title="Expense submitted" message={successMessage} />
        ) : null}
        <div>
          <Button type="submit" loading={submitting}>
            Submit expense
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ExpenseTable({
  context,
  rows,
  onRefresh,
}: {
  context: ExpensesContext;
  rows: readonly ExpenseRow[];
  onRefresh: () => Promise<unknown>;
}) {
  const [actingExpenseId, setActingExpenseId] = useState<string | null>(null);
  const [reasonByExpenseId, setReasonByExpenseId] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function runAction(row: ExpenseRow, commandType: string, requiresReason: boolean) {
    const reason = reasonByExpenseId[row.id]?.trim() ?? '';
    if (requiresReason && !reason) {
      setActionError('Enter a reason before rejecting or reversing an expense.');
      setActionMessage(null);
      return;
    }
    setActingExpenseId(row.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const response = await fetch('/api/expenses/commands', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          commandType,
          expenseId: row.id,
          expectedVersion: row.version,
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          stationId: context.stationId,
          ...(requiresReason ? { reason } : {}),
        }),
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(apiMessage(body, 'The expense action could not be completed.'));
      setActionMessage(`${formatStatusLabel(commandType.replace('Expense', ''))} completed.`);
      setReasonByExpenseId((current) => ({ ...current, [row.id]: '' }));
      await onRefresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'The expense action could not be completed.',
      );
    } finally {
      setActingExpenseId(null);
    }
  }

  return (
    <TableScrollRegion label="Submitted expenses">
      {actionError ? <ErrorState title="Expense action failed" message={actionError} /> : null}
      {actionMessage ? (
        <SuccessState title="Expense action complete" message={actionMessage} />
      ) : null}
      <table className="responsive-table">
        <caption className="visually-hidden">
          Submitted expenses for the active station context
        </caption>
        <thead>
          <tr>
            <th scope="col">Business date</th>
            <th scope="col">Description</th>
            <th scope="col">Amount</th>
            <th scope="col">Classification</th>
            <th scope="col">Settlement</th>
            <th scope="col">State</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td data-label="Business date" className="numeric">
                {formatBusinessDate(row.businessDate)}
              </td>
              <td data-label="Description">
                <strong>{row.description}</strong>
                {row.category ? (
                  <>
                    <br />
                    <small>{row.category}</small>
                  </>
                ) : null}
              </td>
              <td data-label="Amount" className="numeric">
                {formatMoney(row.amount, row.currency)}
              </td>
              <td data-label="Classification">{classificationLabel(row.classification)}</td>
              <td data-label="Settlement">{settlementLabel(row.settlementSource)}</td>
              <td data-label="State">
                <StatusBadge tone={statusTone(row.state)}>
                  {formatStatusLabel(row.state)}
                </StatusBadge>
              </td>
              <td data-label="Actions">
                {row.state === 'SUBMITTED' && context.canApprove ? (
                  <div className="button-row">
                    <Button
                      type="button"
                      variant="secondary"
                      loading={actingExpenseId === row.id}
                      disabled={actingExpenseId !== null}
                      onClick={() => void runAction(row, 'ApproveExpense', false)}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      loading={actingExpenseId === row.id}
                      disabled={actingExpenseId !== null}
                      onClick={() => void runAction(row, 'ReturnExpense', true)}
                    >
                      Return
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      loading={actingExpenseId === row.id}
                      disabled={actingExpenseId !== null}
                      onClick={() => void runAction(row, 'RejectExpense', true)}
                    >
                      Reject
                    </Button>
                    <input
                      aria-label={`Reason for expense ${row.description}`}
                      placeholder="Reason for return/rejection"
                      value={reasonByExpenseId[row.id] ?? ''}
                      onChange={(event) =>
                        setReasonByExpenseId((current) => ({
                          ...current,
                          [row.id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ) : null}
                {row.state === 'APPROVED' && context.canPost ? (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={actingExpenseId === row.id}
                    disabled={actingExpenseId !== null}
                    onClick={() => void runAction(row, 'PostExpense', false)}
                  >
                    Post
                  </Button>
                ) : null}
                {row.state === 'POSTED' && context.canReverse ? (
                  <div className="button-row">
                    <Button
                      type="button"
                      variant="secondary"
                      loading={actingExpenseId === row.id}
                      disabled={actingExpenseId !== null}
                      onClick={() => void runAction(row, 'ReverseExpense', true)}
                    >
                      Reverse
                    </Button>
                    <input
                      aria-label={`Reason for reversing expense ${row.description}`}
                      placeholder="Reason for reversal"
                      value={reasonByExpenseId[row.id] ?? ''}
                      onChange={(event) =>
                        setReasonByExpenseId((current) => ({
                          ...current,
                          [row.id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ) : null}
                {(row.state === 'SUBMITTED' && !context.canApprove) ||
                (row.state === 'APPROVED' && !context.canPost) ||
                (row.state === 'POSTED' && !context.canReverse) ||
                ['DRAFT', 'RETURNED', 'REJECTED', 'REVERSED'].includes(row.state) ? (
                  <span className="field-hint">No action available</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScrollRegion>
  );
}
