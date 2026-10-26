import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { hasAlternateApprover } from '../../platform/security/separation-of-duties';
import { assertStepUp, type ExpenseCommandContext, type ExpenseTransaction } from './application';
import type { ExpenseCommandInput } from './contracts';
import {
  assertApproverAllowed,
  assertBusinessDate,
  assertCategoryUsableForExpense,
  assertExpenseTransition,
  assertPeriodWithinTemplate,
  assertRecognitionNotFuture,
  assertSettlementReference,
  assertSettlementWithinOutstanding,
  expenseRequiresStepUp,
  isStaffFuelCategory,
  monthPeriod,
  outstandingAmount,
  paymentStatus,
  positiveMoney,
  recognitionAmountForDate,
  requiredApprovals,
  STAFF_FUEL_CATEGORY_CODE,
  STAFF_FUEL_EXPENSE_MESSAGE,
  validateExpensePolicy,
  validateExpenseSubmission,
  UNCONFIGURED_EXPENSE_POLICY,
  type ExpenseCategoryClassification,
  type ExpensePolicy,
  type ExpenseState,
} from './domain';

type StationContext = ExpenseCommandContext & { stationId: string };

function requireStation(context: ExpenseCommandContext): StationContext {
  if (!context.stationId) {
    throw new AppError('VALIDATION_FAILED', 'This expense command requires a station');
  }
  return context as StationContext;
}

function actorId(context: ExpenseCommandContext): string {
  return context.authority.membership.membershipId;
}

function assertVersion(actual: number | string, expected: number, label: string): void {
  if (Number(actual) !== expected) {
    throw new AppError('CONFLICT', `The ${label} changed since it was loaded; reload and retry`, {
      expectedVersion: expected,
      actualVersion: Number(actual),
    });
  }
}

export async function loadExpensePolicy(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
): Promise<ExpensePolicy> {
  const rows = await transaction.execute<{
    step_up_threshold: string | null;
    second_approval_threshold: string | null;
  }>(sql`
    select step_up_threshold::text, second_approval_threshold::text
    from app.expense_policies
    where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
  `);
  const row = rows[0];
  if (!row) return UNCONFIGURED_EXPENSE_POLICY;
  return {
    stepUpThreshold: row.step_up_threshold,
    secondApprovalThreshold: row.second_approval_threshold,
  };
}

type CategoryRow = {
  id: string;
  code: string;
  name: string;
  classification: ExpenseCategoryClassification;
  status: string;
};

async function loadCategory(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  categoryId: string,
): Promise<CategoryRow> {
  const rows = await transaction.execute<CategoryRow>(sql`
    select id, code, name, classification, status
    from app.expense_categories
    where tenant_id = ${context.tenantId} and id = ${categoryId}
  `);
  const category = rows[0];
  if (!category) throw new AppError('NOT_FOUND', 'The expense category was not found');
  if (category.status !== 'ACTIVE') {
    throw new AppError('INVARIANT_VIOLATION', 'The expense category is inactive');
  }
  return category;
}

type ExpenseRow = {
  id: string;
  station_id: string;
  category_id: string;
  expense_date: string;
  amount: string;
  state: ExpenseState;
  version: number | string;
  required_approvals: number;
  submitted_by: string;
};

async function lockExpense(
  transaction: ExpenseTransaction,
  context: StationContext,
  expenseId: string,
): Promise<ExpenseRow> {
  const rows = await transaction.execute<ExpenseRow>(sql`
    select id, station_id, category_id, expense_date, amount::text as amount, state, version,
           required_approvals, submitted_by
    from app.expenses
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${expenseId}
    for update
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'The expense was not found at this station');
  return rows[0];
}

async function settledAmounts(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  target: { expenseId?: string; recurringPeriodId?: string },
): Promise<string[]> {
  const rows = await transaction.execute<{ amount: string }>(sql`
    select amount::text as amount
    from app.expense_payments
    where tenant_id = ${context.tenantId} and state = 'RECORDED'
      ${
        target.expenseId
          ? sql`and expense_id = ${target.expenseId}`
          : sql`and recurring_period_id = ${target.recurringPeriodId!}`
      }
  `);
  return rows.map((row) => row.amount);
}

export async function createExpenseCategoryInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: ExpenseCommandInput<'CreateExpenseCategory'>,
) {
  // The staff fuel benefit category is created by the month-end staff benefit flow alone.
  if (
    input.code !== STAFF_FUEL_CATEGORY_CODE &&
    isStaffFuelCategory({ code: input.code, name: input.name })
  ) {
    throw new AppError('VALIDATION_FAILED', STAFF_FUEL_EXPENSE_MESSAGE);
  }
  const existing = await transaction.execute(sql`
    select 1 from app.expense_categories
    where tenant_id = ${context.tenantId} and code = ${input.code}
  `);
  if (existing.length > 0) {
    throw new AppError('CONFLICT', 'An expense category with this code already exists');
  }
  const categoryId = randomUUID();
  await transaction.execute(sql`
    insert into app.expense_categories (id, tenant_id, code, name, classification, created_by)
    values (${categoryId}, ${context.tenantId}, ${input.code}, ${input.name},
            ${input.classification}, ${actorId(context)})
  `);
  return {
    categoryId,
    code: input.code,
    name: input.name,
    classification: input.classification,
    version: 0,
  };
}

export async function setExpensePolicyInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: ExpenseCommandInput<'SetExpensePolicy'>,
) {
  const policy = validateExpensePolicy({
    stepUpThreshold: input.stepUpThreshold,
    secondApprovalThreshold: input.secondApprovalThreshold,
  });
  const rows = await transaction.execute<{ id: string; version: number | string }>(sql`
    select id, version from app.expense_policies
    where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
    for update
  `);
  const current = rows[0];
  if (current) {
    if (input.expectedVersion === undefined) {
      throw new AppError('CONFLICT', 'An expense policy exists; send its expected version');
    }
    assertVersion(current.version, input.expectedVersion, 'expense policy');
    await transaction.execute(sql`
      update app.expense_policies
      set step_up_threshold = ${policy.stepUpThreshold},
          second_approval_threshold = ${policy.secondApprovalThreshold},
          version = version + 1, updated_by = ${actorId(context)}, updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${current.id}
    `);
    return { policyId: current.id, version: Number(current.version) + 1, ...policy };
  }
  if (input.expectedVersion !== undefined) {
    throw new AppError('CONFLICT', 'No expense policy exists yet; omit the expected version');
  }
  const policyId = randomUUID();
  const inserted = await transaction.execute(sql`
    insert into app.expense_policies (
      id, tenant_id, legal_entity_id, step_up_threshold, second_approval_threshold, updated_by
    ) values (
      ${policyId}, ${context.tenantId}, ${context.legalEntityId}, ${policy.stepUpThreshold},
      ${policy.secondApprovalThreshold}, ${actorId(context)}
    )
    on conflict (tenant_id, legal_entity_id) do nothing
    returning id
  `);
  if (inserted.length === 0) {
    throw new AppError('CONFLICT', 'An expense policy was created concurrently; reload');
  }
  return { policyId, version: 0, ...policy };
}

export async function submitExpenseInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'SubmitExpense'>,
  /** Only the month-end staff benefit flow may use the staff fuel category. */
  options: { allowStaffFuel?: boolean } = {},
) {
  const context = requireStation(rawContext);
  const category = await loadCategory(transaction, context, input.categoryId);
  assertCategoryUsableForExpense(category.classification, 'MANUAL_EXPENSE');
  if (!options.allowStaffFuel && isStaffFuelCategory(category)) {
    throw new AppError('VALIDATION_FAILED', STAFF_FUEL_EXPENSE_MESSAGE);
  }
  const validated = validateExpenseSubmission(input);
  if (validated.reference) {
    const duplicate = await transaction.execute(sql`
      select 1 from app.expenses
      where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
        and reference = ${validated.reference} and state not in ('REJECTED', 'REVERSED')
    `);
    if (duplicate.length > 0) {
      throw new AppError('CONFLICT', 'An active expense with this reference already exists', {
        reference: validated.reference,
      });
    }
  }
  if (input.shiftId) {
    const shifts = await transaction.execute<{
      opened_at: Date | string;
      state: string;
      business_date: string;
    }>(
      sql`select opened_at,state,business_date from app.shifts where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${input.shiftId} for update`,
    );
    const shift = shifts[0];
    const now = await transaction.execute<{ now: Date | string }>(
      sql`select clock_timestamp() as now`,
    );
    if (
      !shift ||
      shift.state !== 'OPEN' ||
      !input.observedAt ||
      Date.parse(input.observedAt) < new Date(shift.opened_at).getTime() ||
      Date.parse(input.observedAt) > new Date(now[0]!.now).getTime() ||
      input.expenseDate !== shift.business_date
    )
      throw new AppError(
        'CONFLICT',
        'Shift expense must belong to the open station shift and its business date',
      );
  }
  const policy = await loadExpensePolicy(transaction, context);
  const approvalsRequired = requiredApprovals(validated.amount.amount.toString(), policy);
  const expenseId = randomUUID();
  await transaction.execute(sql`
    insert into app.expenses (
      id, tenant_id, legal_entity_id, station_id, category_id, expense_date, description,
      payee, reference, payment_method, currency, amount, state, version, required_approvals, submitted_by, shift_id, observed_at
    ) values (
      ${expenseId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${input.categoryId}, ${validated.expenseDate}, ${validated.description},
      ${validated.payee}, ${validated.reference}, ${input.paymentMethod ?? null}, 'USD', ${validated.amount.amount.toString()},
      'SUBMITTED', 0, ${approvalsRequired}, ${actorId(context)}, ${input.shiftId ?? null}, ${input.observedAt ?? null}::timestamptz
    )
  `);
  return {
    expenseId,
    state: 'SUBMITTED' as const,
    version: 0,
    requiredApprovals: approvalsRequired,
    amount: validated.amount.amount.value.toFixed(4),
  };
}

export async function approveExpenseInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'ApproveExpense'>,
) {
  const context = requireStation(rawContext);
  const expense = await lockExpense(transaction, context, input.expenseId);
  assertVersion(expense.version, input.expectedVersion, 'expense');
  assertExpenseTransition(expense.state, 'APPROVED');
  const policy = await loadExpensePolicy(transaction, context);
  if (expenseRequiresStepUp(expense.amount, policy)) {
    assertStepUp(context, 'Approving an expense at this amount');
  }
  const priors = await transaction.execute<{ actor_membership_id: string }>(sql`
    select actor_membership_id from app.expense_approvals
    where tenant_id = ${context.tenantId} and expense_id = ${expense.id}
  `);
  const alternateApproverExists = await hasAlternateApprover(transaction, {
    tenantId: context.tenantId,
    stationId: context.stationId,
    excludeMembershipId: expense.submitted_by,
    permission: 'expense.approve',
  });
  assertApproverAllowed({
    submitterMembershipId: expense.submitted_by,
    approverMembershipId: actorId(context),
    alternateApproverExists,
    priorApproverIds: priors.map((row) => row.actor_membership_id),
  });
  await transaction.execute(sql`
    insert into app.expense_approvals (id, tenant_id, expense_id, decision, actor_membership_id)
    values (${randomUUID()}, ${context.tenantId}, ${expense.id}, 'APPROVED', ${actorId(context)})
  `);
  const approvals = priors.length + 1;
  const complete = approvals >= expense.required_approvals;
  await transaction.execute(sql`
    update app.expenses
    set state = ${complete ? 'APPROVED' : 'SUBMITTED'}, version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${expense.id}
  `);
  return {
    expenseId: expense.id,
    state: complete ? ('APPROVED' as const) : ('SUBMITTED' as const),
    version: Number(expense.version) + 1,
    approvals,
    requiredApprovals: expense.required_approvals,
  };
}

export async function rejectExpenseInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'RejectExpense'>,
) {
  const context = requireStation(rawContext);
  const expense = await lockExpense(transaction, context, input.expenseId);
  assertVersion(expense.version, input.expectedVersion, 'expense');
  assertExpenseTransition(expense.state, 'REJECTED');
  const prior = await transaction.execute(sql`
    select 1 from app.expense_approvals
    where tenant_id = ${context.tenantId} and expense_id = ${expense.id}
      and actor_membership_id = ${actorId(context)}
  `);
  if (prior.length > 0) {
    throw new AppError('CONFLICT', 'This approver has already decided on the expense');
  }
  await transaction.execute(sql`
    insert into app.expense_approvals (
      id, tenant_id, expense_id, decision, reason, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${expense.id}, 'REJECTED', ${input.reason},
      ${actorId(context)}
    )
  `);
  await transaction.execute(sql`
    update app.expenses
    set state = 'REJECTED', rejected_by = ${actorId(context)}, rejected_at = now(),
        rejection_reason = ${input.reason}, version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${expense.id}
  `);
  return {
    expenseId: expense.id,
    state: 'REJECTED' as const,
    version: Number(expense.version) + 1,
  };
}

export async function postExpenseInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'PostExpense'>,
) {
  const context = requireStation(rawContext);
  const expense = await lockExpense(transaction, context, input.expenseId);
  assertVersion(expense.version, input.expectedVersion, 'expense');
  assertExpenseTransition(expense.state, 'POSTED');
  const policy = await loadExpensePolicy(transaction, context);
  if (expenseRequiresStepUp(expense.amount, policy)) {
    assertStepUp(context, 'Posting an expense at this amount');
  }
  const classificationRows = await transaction.execute<{ classification: string }>(sql`
    select classification from app.expense_categories
    where tenant_id = ${context.tenantId} and id = ${expense.category_id}
  `);
  const classification = classificationRows[0]?.classification;
  if (classification !== 'OPERATING') {
    throw new AppError('INVARIANT_VIOLATION', 'Only operating expenses can be posted here');
  }
  await transaction.execute(sql`
    update app.expenses
    set state = 'POSTED', posted_by = ${actorId(context)}, posted_at = now(),
        version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${expense.id}
  `);
  await transaction.execute(sql`
    insert into app.expense_recognition_movements (
      id, tenant_id, legal_entity_id, station_id, category_id, classification, movement_type,
      source_type, source_id, recognition_date, currency, amount, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${expense.category_id}, 'OPERATING', 'RECOGNITION', 'EXPENSE', ${expense.id},
      ${expense.expense_date}, 'USD', ${expense.amount}, ${actorId(context)}
    )
  `);
  return {
    expenseId: expense.id,
    state: 'POSTED' as const,
    version: Number(expense.version) + 1,
    recognizedAmount: expense.amount,
    recognitionDate: expense.expense_date,
  };
}

export async function reverseExpenseInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'ReverseExpense'>,
) {
  const context = requireStation(rawContext);
  const expense = await lockExpense(transaction, context, input.expenseId);
  assertVersion(expense.version, input.expectedVersion, 'expense');
  assertExpenseTransition(expense.state, 'REVERSED');
  const settled = await settledAmounts(transaction, context, { expenseId: expense.id });
  if (settled.length > 0) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Reverse the recorded settlements before reversing this expense',
      { recordedSettlements: settled.length },
    );
  }
  const original = await transaction.execute<{ id: string }>(sql`
    select id from app.expense_recognition_movements
    where tenant_id = ${context.tenantId} and source_type = 'EXPENSE'
      and source_id = ${expense.id} and movement_type = 'RECOGNITION'
  `);
  if (!original[0]) {
    throw new AppError('INVARIANT_VIOLATION', 'The expense recognition movement is missing');
  }
  await transaction.execute(sql`
    update app.expenses
    set state = 'REVERSED', reversed_by = ${actorId(context)}, reversed_at = now(),
        reversal_reason = ${input.reason}, version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${expense.id}
  `);
  await transaction.execute(sql`
    insert into app.expense_recognition_movements (
      id, tenant_id, legal_entity_id, station_id, category_id, classification, movement_type,
      source_type, source_id, recognition_date, currency, amount, reversal_of_id,
      actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${expense.category_id}, 'OPERATING', 'REVERSAL', 'EXPENSE', ${expense.id},
      ${expense.expense_date}, 'USD', ${expense.amount}, ${original[0].id}, ${actorId(context)}
    )
  `);
  return {
    expenseId: expense.id,
    state: 'REVERSED' as const,
    version: Number(expense.version) + 1,
  };
}

type PeriodRow = {
  id: string;
  station_id: string;
  template_id: string;
  category_id: string;
  period_start: string;
  period_end: string;
  amount: string;
  version: number | string;
};

async function lockPeriod(
  transaction: ExpenseTransaction,
  context: StationContext,
  periodId: string,
): Promise<PeriodRow> {
  const rows = await transaction.execute<PeriodRow>(sql`
    select id, station_id, template_id, category_id, period_start, period_end,
           amount::text as amount, version
    from app.recurring_cost_periods
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${periodId}
    for update
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'The recurring-cost period was not found');
  return rows[0];
}

async function assertCashMovementLink(
  transaction: ExpenseTransaction,
  context: StationContext,
  cashMovementId: string,
  amount: string,
): Promise<void> {
  const rows = await transaction.execute<{
    movement_type: string;
    station_id: string;
    amount: string;
  }>(sql`
    select movement_type, station_id, amount::text as amount
    from app.cash_movements
    where tenant_id = ${context.tenantId} and id = ${cashMovementId}
  `);
  const movement = rows[0];
  if (!movement || movement.station_id !== context.stationId) {
    throw new AppError('NOT_FOUND', 'The cash movement was not found at this station');
  }
  if (movement.movement_type !== 'DISBURSEMENT') {
    throw new AppError('INVARIANT_VIOLATION', 'Only a cash disbursement can settle an expense');
  }
  if (movement.amount !== amount) {
    throw new AppError('INVARIANT_VIOLATION', 'The cash movement amount must equal the settlement');
  }
  const used = await transaction.execute(sql`
    select 1 from app.expense_payments
    where tenant_id = ${context.tenantId} and cash_movement_id = ${cashMovementId}
  `);
  if (used.length > 0) {
    throw new AppError('CONFLICT', 'This cash movement already settles another obligation');
  }
}

export async function recordExpensePaymentInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'RecordExpensePayment'>,
) {
  const context = requireStation(rawContext);
  assertBusinessDate(input.paymentDate, 'paymentDate');
  const amount = positiveMoney(input.amount).amount.value.toFixed(4);
  assertSettlementReference({
    source: input.settlementSource,
    cashMovementId: input.cashMovementId,
    externalReference: input.externalReference,
  });
  const target = input.expenseId
    ? await (async () => {
        const expense = await lockExpense(transaction, context, input.expenseId!);
        assertVersion(expense.version, input.expectedVersion, 'expense');
        if (expense.state !== 'POSTED') {
          throw new AppError(
            'INVARIANT_VIOLATION',
            'Only a posted expense can be settled; payment never creates the expense',
          );
        }
        return {
          total: expense.amount,
          version: Number(expense.version),
          kind: 'EXPENSE' as const,
        };
      })()
    : await (async () => {
        const period = await lockPeriod(transaction, context, input.recurringPeriodId!);
        assertVersion(period.version, input.expectedVersion, 'recurring-cost period');
        return { total: period.amount, version: Number(period.version), kind: 'PERIOD' as const };
      })();
  const targetRef = input.expenseId
    ? { expenseId: input.expenseId }
    : { recurringPeriodId: input.recurringPeriodId! };
  const settled = await settledAmounts(transaction, context, targetRef);
  assertSettlementWithinOutstanding(target.total, settled, amount);
  const policy = await loadExpensePolicy(transaction, context);
  if (expenseRequiresStepUp(amount, policy)) {
    assertStepUp(context, 'Recording a settlement at this amount');
  }
  if (input.cashMovementId) {
    await assertCashMovementLink(transaction, context, input.cashMovementId, amount);
  }
  const paymentId = randomUUID();
  await transaction.execute(sql`
    insert into app.expense_payments (
      id, tenant_id, legal_entity_id, station_id, expense_id, recurring_period_id, payment_date,
      currency, amount, settlement_source, cash_movement_id, external_reference, state, recorded_by
    ) values (
      ${paymentId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${input.expenseId ?? null}, ${input.recurringPeriodId ?? null}, ${input.paymentDate},
      'USD', ${amount}, ${input.settlementSource}, ${input.cashMovementId ?? null},
      ${input.externalReference ?? null}, 'RECORDED', ${actorId(context)}
    )
  `);
  await bumpTargetVersion(transaction, context, targetRef);
  const after = [...settled, amount];
  return {
    paymentId,
    targetType: target.kind,
    targetId: input.expenseId ?? input.recurringPeriodId!,
    amount,
    version: target.version + 1,
    paymentStatus: paymentStatus(target.total, after),
    outstanding: outstandingAmount(target.total, after),
  };
}

async function bumpTargetVersion(
  transaction: ExpenseTransaction,
  context: StationContext,
  target: { expenseId?: string; recurringPeriodId?: string },
): Promise<void> {
  if (target.expenseId) {
    await transaction.execute(sql`
      update app.expenses set version = version + 1, updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${target.expenseId}
    `);
  } else {
    await transaction.execute(sql`
      update app.recurring_cost_periods set version = version + 1, updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${target.recurringPeriodId!}
    `);
  }
}

export async function reverseExpensePaymentInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'ReverseExpensePayment'>,
) {
  const context = requireStation(rawContext);
  const rows = await transaction.execute<{
    id: string;
    expense_id: string | null;
    recurring_period_id: string | null;
    state: string;
  }>(sql`
    select id, expense_id, recurring_period_id, state
    from app.expense_payments
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${input.paymentId}
  `);
  const payment = rows[0];
  if (!payment) throw new AppError('NOT_FOUND', 'The settlement was not found at this station');
  // Lock the target first so concurrent settlements/reversals serialize on one row.
  let currentVersion: number | string;
  if (payment.expense_id) {
    currentVersion = (await lockExpense(transaction, context, payment.expense_id)).version;
  } else {
    currentVersion = (await lockPeriod(transaction, context, payment.recurring_period_id!)).version;
  }
  assertVersion(currentVersion, input.expectedVersion, 'obligation');
  const locked = await transaction.execute<{ state: string }>(sql`
    select state from app.expense_payments
    where tenant_id = ${context.tenantId} and id = ${payment.id} for update
  `);
  if (locked[0]?.state !== 'RECORDED') {
    throw new AppError('CONFLICT', 'This settlement has already been reversed');
  }
  await transaction.execute(sql`
    update app.expense_payments
    set state = 'REVERSED', reversed_by = ${actorId(context)}, reversed_at = now(),
        reversal_reason = ${input.reason}
    where tenant_id = ${context.tenantId} and id = ${payment.id}
  `);
  const targetRef = payment.expense_id
    ? { expenseId: payment.expense_id }
    : { recurringPeriodId: payment.recurring_period_id! };
  await bumpTargetVersion(transaction, context, targetRef);
  return {
    paymentId: payment.id,
    state: 'REVERSED' as const,
    version: Number(currentVersion) + 1,
  };
}

export async function createRecurringCostTemplateInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'CreateRecurringCostTemplate'>,
) {
  const context = requireStation(rawContext);
  const category = await loadCategory(transaction, context, input.categoryId);
  assertCategoryUsableForExpense(category.classification, 'RECURRING_COST');
  assertBusinessDate(input.startDate, 'startDate');
  if (input.endDate) {
    assertBusinessDate(input.endDate, 'endDate');
    if (input.endDate < input.startDate) {
      throw new AppError('VALIDATION_FAILED', 'endDate cannot be before startDate');
    }
  }
  const amount = positiveMoney(input.amount).amount.value.toFixed(4);
  const duplicate = await transaction.execute(sql`
    select 1 from app.recurring_cost_templates
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and name = ${input.name}
  `);
  if (duplicate.length > 0) {
    throw new AppError('CONFLICT', 'A recurring cost with this name already exists here');
  }
  const templateId = randomUUID();
  await transaction.execute(sql`
    insert into app.recurring_cost_templates (
      id, tenant_id, legal_entity_id, station_id, category_id, name, frequency, currency, amount,
      start_date, end_date, created_by
    ) values (
      ${templateId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${input.categoryId}, ${input.name}, 'MONTHLY', 'USD', ${amount}, ${input.startDate},
      ${input.endDate ?? null}, ${actorId(context)}
    )
  `);
  return { templateId, amount, frequency: 'MONTHLY' as const, version: 0 };
}

export async function generateRecurringCostPeriodInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'GenerateRecurringCostPeriod'>,
) {
  const context = requireStation(rawContext);
  const rows = await transaction.execute<{
    id: string;
    category_id: string;
    amount: string;
    start_date: string;
    end_date: string | null;
    status: string;
  }>(sql`
    select id, category_id, amount::text as amount, start_date, end_date, status
    from app.recurring_cost_templates
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${input.templateId}
    for share
  `);
  const template = rows[0];
  if (!template) throw new AppError('NOT_FOUND', 'The recurring-cost template was not found');
  if (template.status !== 'ACTIVE') {
    throw new AppError('INVARIANT_VIOLATION', 'The recurring-cost template is inactive');
  }
  const period = monthPeriod(input.periodStart);
  assertPeriodWithinTemplate(period, {
    startDate: template.start_date,
    endDate: template.end_date,
  });
  const existing = await transaction.execute(sql`
    select 1 from app.recurring_cost_periods
    where tenant_id = ${context.tenantId} and template_id = ${template.id}
      and period_start = ${period.start}
  `);
  if (existing.length > 0) {
    throw new AppError('CONFLICT', 'This period has already been generated');
  }
  const periodId = randomUUID();
  await transaction.execute(sql`
    insert into app.recurring_cost_periods (
      id, tenant_id, legal_entity_id, station_id, template_id, category_id, period_start,
      period_end, currency, amount, generated_by
    ) values (
      ${periodId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${template.id}, ${template.category_id}, ${period.start}, ${period.end}, 'USD',
      ${template.amount}, ${actorId(context)}
    )
  `);
  return {
    periodId,
    periodStart: period.start,
    periodEnd: period.end,
    amount: template.amount,
    version: 0,
  };
}

export async function recognizeRecurringCostInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'RecognizeRecurringCost'>,
) {
  const context = requireStation(rawContext);
  const period = await lockPeriod(transaction, context, input.periodId);
  assertBusinessDate(input.recognitionDate, 'recognitionDate');
  assertRecognitionNotFuture(input.recognitionDate);
  const amount = recognitionAmountForDate(
    period.amount,
    monthPeriod(period.period_start),
    input.recognitionDate,
  );
  const existing = await transaction.execute(sql`
    select 1 from app.recurring_cost_recognitions
    where tenant_id = ${context.tenantId} and period_id = ${period.id}
      and recognition_date = ${input.recognitionDate}
  `);
  if (existing.length > 0) {
    throw new AppError('CONFLICT', 'This date has already been recognized for the period');
  }
  const recognitionId = randomUUID();
  await transaction.execute(sql`
    insert into app.recurring_cost_recognitions (
      id, tenant_id, legal_entity_id, station_id, period_id, recognition_date, currency, amount,
      state, recognized_by
    ) values (
      ${recognitionId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${period.id}, ${input.recognitionDate}, 'USD', ${amount}, 'RECOGNIZED', ${actorId(context)}
    )
  `);
  await transaction.execute(sql`
    insert into app.expense_recognition_movements (
      id, tenant_id, legal_entity_id, station_id, category_id, classification, movement_type,
      source_type, source_id, recognition_date, currency, amount, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${period.category_id}, 'FIXED_COST', 'RECOGNITION', 'RECURRING_COST_RECOGNITION',
      ${recognitionId}, ${input.recognitionDate}, 'USD', ${amount}, ${actorId(context)}
    )
  `);
  return { recognitionId, periodId: period.id, recognitionDate: input.recognitionDate, amount };
}

export async function reverseRecurringCostRecognitionInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'ReverseRecurringCostRecognition'>,
) {
  const context = requireStation(rawContext);
  const period = await lockPeriod(transaction, context, input.periodId);
  const rows = await transaction.execute<{ id: string; amount: string; state: string }>(sql`
    select id, amount::text as amount, state
    from app.recurring_cost_recognitions
    where tenant_id = ${context.tenantId} and period_id = ${period.id}
      and recognition_date = ${input.recognitionDate} and state = 'RECOGNIZED'
    order by recognized_at desc
    limit 1
    for update
  `);
  const recognition = rows[0];
  if (!recognition) throw new AppError('NOT_FOUND', 'No recognition exists for this date');
  if (recognition.state !== 'RECOGNIZED') {
    throw new AppError('CONFLICT', 'This recognition has already been reversed');
  }
  const original = await transaction.execute<{ id: string }>(sql`
    select id from app.expense_recognition_movements
    where tenant_id = ${context.tenantId} and source_type = 'RECURRING_COST_RECOGNITION'
      and source_id = ${recognition.id} and movement_type = 'RECOGNITION'
  `);
  if (!original[0]) {
    throw new AppError('INVARIANT_VIOLATION', 'The recognition movement is missing');
  }
  await transaction.execute(sql`
    update app.recurring_cost_recognitions
    set state = 'REVERSED', reversed_by = ${actorId(context)}, reversed_at = now(),
        reversal_reason = ${input.reason}
    where tenant_id = ${context.tenantId} and id = ${recognition.id}
  `);
  await transaction.execute(sql`
    insert into app.expense_recognition_movements (
      id, tenant_id, legal_entity_id, station_id, category_id, classification, movement_type,
      source_type, source_id, recognition_date, currency, amount, reversal_of_id,
      actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${period.category_id}, 'FIXED_COST', 'REVERSAL', 'RECURRING_COST_RECOGNITION',
      ${recognition.id}, ${input.recognitionDate}, 'USD', ${recognition.amount}, ${original[0].id},
      ${actorId(context)}
    )
  `);
  return { recognitionId: recognition.id, state: 'REVERSED' as const };
}

/**
 * Correct a recurring recognition without rewriting its original amount. The original row and
 * its recognition/reversal movements remain evidence; the new row is linked through
 * adjustment_of_id and becomes the one active recognition for that date.
 */
export async function adjustRecurringCostRecognitionInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'AdjustRecurringCostRecognition'>,
) {
  const context = requireStation(rawContext);
  const period = await lockPeriod(transaction, context, input.periodId);
  assertBusinessDate(input.recognitionDate, 'recognitionDate');
  assertRecognitionNotFuture(input.recognitionDate);
  if (input.recognitionDate < period.period_start || input.recognitionDate > period.period_end) {
    throw new AppError('VALIDATION_FAILED', 'The recognition date is outside the recurring period');
  }
  const amount = positiveMoney(input.amount).amount.value.toFixed(4);
  // The latest row for the date is the one being corrected: an active recognition is reversed and
  // replaced; one that was already reversed (a mistaken reversal) is only replaced.
  const rows = await transaction.execute<{ id: string; amount: string; state: string }>(sql`
    select id, amount::text as amount, state
    from app.recurring_cost_recognitions
    where tenant_id = ${context.tenantId} and period_id = ${period.id}
      and recognition_date = ${input.recognitionDate}
    order by recognized_at desc
    limit 1
    for update
  `);
  const original = rows[0];
  if (!original) throw new AppError('NOT_FOUND', 'No recognition exists for this date');
  const alreadyReversed = original.state === 'REVERSED';
  if (!alreadyReversed) {
    const originalMovement = await transaction.execute<{ id: string }>(sql`
      select id from app.expense_recognition_movements
      where tenant_id = ${context.tenantId}
        and source_type = 'RECURRING_COST_RECOGNITION'
        and source_id = ${original.id}
        and movement_type = 'RECOGNITION'
    `);
    if (!originalMovement[0]) {
      throw new AppError('INVARIANT_VIOLATION', 'The recognition movement is missing');
    }
    await transaction.execute(sql`
      update app.recurring_cost_recognitions
      set state = 'REVERSED', reversed_by = ${actorId(context)}, reversed_at = now(),
          reversal_reason = ${input.reason}
      where tenant_id = ${context.tenantId} and id = ${original.id}
    `);
    await transaction.execute(sql`
      insert into app.expense_recognition_movements (
        id, tenant_id, legal_entity_id, station_id, category_id, classification, movement_type,
        source_type, source_id, recognition_date, currency, amount, reversal_of_id,
        actor_membership_id
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
        ${period.category_id}, 'FIXED_COST', 'REVERSAL', 'RECURRING_COST_RECOGNITION',
        ${original.id}, ${input.recognitionDate}, 'USD', ${original.amount},
        ${originalMovement[0].id}, ${actorId(context)}
      )
    `);
  }
  const correctedId = randomUUID();
  await transaction.execute(sql`
    insert into app.recurring_cost_recognitions (
      id, tenant_id, legal_entity_id, station_id, period_id, recognition_date, currency, amount,
      state, recognized_by, adjustment_of_id
    ) values (
      ${correctedId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${period.id}, ${input.recognitionDate}, 'USD', ${amount}, 'RECOGNIZED',
      ${actorId(context)}, ${original.id}
    )
  `);
  await transaction.execute(sql`
    insert into app.expense_recognition_movements (
      id, tenant_id, legal_entity_id, station_id, category_id, classification, movement_type,
      source_type, source_id, recognition_date, currency, amount, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${period.category_id}, 'FIXED_COST', 'RECOGNITION', 'RECURRING_COST_RECOGNITION',
      ${correctedId}, ${input.recognitionDate}, 'USD', ${amount}, ${actorId(context)}
    )
  `);
  return {
    recognitionId: correctedId,
    adjustedFromId: original.id,
    periodId: period.id,
    recognitionDate: input.recognitionDate,
    amount,
  };
}

export async function correctExpenseFactsInTransaction(
  transaction: ExpenseTransaction,
  rawContext: ExpenseCommandContext,
  input: ExpenseCommandInput<'CorrectExpenseFacts'>,
) {
  const context = requireStation(rawContext);
  const rows = await transaction.execute<{ version: number }>(
    sql`select version from app.expenses where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${input.expenseId}`,
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Expense not found');
  assertVersion(rows[0].version, input.expectedVersion, 'expense');
  try {
    const result = await transaction.execute<{ result: Record<string, unknown> }>(
      sql`select app.correct_expense_version(${input.expenseId},${input.expectedVersionId},${input.amount},${input.description},${input.payee ?? null},${input.reference ?? null},${input.reason}) as result`,
    );
    return result[0]!.result;
  } catch (error) {
    const code =
      (error as { cause?: { code?: string }; code?: string }).cause?.code ??
      (error as { code?: string }).code;
    if (code === '42501')
      throw new AppError('FORBIDDEN', 'You cannot correct this station expense');
    if (code === '40001')
      throw new AppError(
        'CONFLICT',
        'Expense changed or is already in review; reload and use the controlled return or reversal process',
      );
    if (code === 'P0002') throw new AppError('NOT_FOUND', 'Expense not found');
    if (['22023', '23505', '23514'].includes(code ?? ''))
      throw new AppError('VALIDATION_FAILED', 'Invalid expense correction');
    throw error;
  }
}
