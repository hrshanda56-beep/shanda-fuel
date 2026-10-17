import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ExactDecimal, money, type CurrencyCode } from '../../platform/domain/primitives';
import { AppError } from '../../platform/errors';
import {
  assertExpenseTransition,
  assertExpenseApprovalActor,
  calculateExpenseApproval,
  classifyExpense,
  isRecurringExpenseDue,
  validateExpense,
  validateRecurringExpenseRule,
  type ExpenseClassification,
  type ExpenseApprovalPolicy,
  type ExpenseSettlementSource,
  type ExpenseState,
  type RecurringIntervalUnit,
} from './domain';
import type { ExpenseCommandContext, ExpenseTransaction } from './application';

/**
 * SQL contract for A0's canonical app.expenses tables. This adapter deliberately
 * uses explicit SQL so the module does not depend on an unapproved Drizzle schema.
 * Required columns are listed in the handoff returned with this slice.
 */
type ExpenseRow = {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  station_id: string | null;
  business_date: string;
  description: string;
  category: string | null;
  amount: string;
  currency: string;
  classification: string;
  settlement_source: string;
  state: string;
  version: number | string;
  submitted_by: string | null;
};

function scopedExpenseWhere(context: ExpenseCommandContext, expenseId: string) {
  return sql`
    tenant_id = ${context.tenantId}
    and legal_entity_id = ${context.legalEntityId}
    and id = ${expenseId}
    ${context.stationId ? sql`and station_id = ${context.stationId}` : sql``}
  `;
}

async function loadExpenseForUpdate(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  expenseId: string,
): Promise<ExpenseRow> {
  const rows = await transaction.execute<ExpenseRow>(sql`
    select id, tenant_id, legal_entity_id, station_id, business_date, description, category,
           amount::text, currency, classification, settlement_source, state, version,
           submitted_by
    from app.expenses
    where ${scopedExpenseWhere(context, expenseId)}
    for update
  `);
  const expense = rows[0];
  if (!expense) throw new AppError('NOT_FOUND', 'The expense was not found');
  return expense;
}

function currency(value: string): CurrencyCode {
  return value as CurrencyCode;
}

function validateRow(row: ExpenseRow): void {
  validateExpense({
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    ...(row.station_id ? { stationId: row.station_id } : {}),
    businessDate: row.business_date,
    description: row.description,
    ...(row.category ? { category: row.category } : {}),
    amount: row.amount,
    currency: currency(row.currency),
    classification: row.classification as ExpenseClassification,
    settlementSource: row.settlement_source as ExpenseSettlementSource,
    state: row.state as ExpenseState,
  });
}

async function insertRecognitionEvent(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  row: ExpenseRow,
  recognitionType: 'RECOGNITION' | 'REVERSAL',
): Promise<void> {
  validateRow(row);
  const classification = classifyExpense({
    classification: row.classification as ExpenseClassification,
    settlementSource: row.settlement_source as ExpenseSettlementSource,
  });
  const amount =
    recognitionType === 'RECOGNITION'
      ? money(row.amount, currency(row.currency)).amount.toString()
      : new ExactDecimal(`-${row.amount}`).toString();

  await transaction.execute(sql`
    insert into app.expense_recognition_events (
      id, tenant_id, legal_entity_id, station_id, expense_id, recognition_type,
      recognition_date, amount, currency, classification, recognition_kind, effective_at, created_by
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${row.legal_entity_id}, ${row.station_id}, ${row.id},
      ${recognitionType}, ${row.business_date}, ${amount}, ${row.currency}, ${row.classification},
      ${classification.recognitionKind}, now(), ${context.authority.membership.membershipId}
    )
  `);
}

export async function submitExpenseInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: {
    businessDate: string;
    description: string;
    category?: string;
    amount: string;
    currency: string;
    classification: ExpenseClassification;
    settlementSource: ExpenseSettlementSource;
  },
) {
  const id = randomUUID();
  const validated = validateExpense({
    id,
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    ...(context.stationId ? { stationId: context.stationId } : {}),
    businessDate: input.businessDate,
    description: input.description,
    ...(input.category ? { category: input.category } : {}),
    amount: input.amount,
    currency: currency(input.currency),
    classification: input.classification,
    settlementSource: input.settlementSource,
  });

  await transaction.execute(sql`
    insert into app.expenses (
      id, tenant_id, legal_entity_id, station_id, business_date, description, category,
      amount, currency, classification, settlement_source, state, version,
      created_by, submitted_by, submitted_at
    ) values (
      ${id}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId ?? null},
      ${validated.businessDate}, ${validated.description}, ${validated.category ?? null},
      ${validated.amount.amount.toString()}, ${validated.amount.currency}, ${validated.classification},
      ${validated.settlementSource}, 'SUBMITTED', 0,
      ${context.authority.membership.membershipId}, ${context.authority.membership.membershipId}, now()
    )
  `);

  return {
    expenseId: id,
    state: 'SUBMITTED' as const,
    version: 0,
    amount: validated.amount.amount.toString(),
    currency: validated.amount.currency,
    classification: validated.classification,
    settlementSource: validated.settlementSource,
  };
}

async function transitionExpenseInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: {
    expenseId: string;
    expectedVersion: number;
    target: 'RETURNED' | 'APPROVED' | 'REJECTED';
    reason?: string;
  },
) {
  if (input.reason !== undefined && !input.reason.trim()) {
    throw new AppError('VALIDATION_FAILED', 'A reason is required');
  }
  const expense = await loadExpenseForUpdate(transaction, context, input.expenseId);
  if (Number(expense.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The expense is stale', {
      expectedVersion: input.expectedVersion,
      actualVersion: Number(expense.version),
    });
  }
  assertExpenseTransition(expense.state as ExpenseState, input.target);
  if (input.target === 'APPROVED') {
    assertExpenseApprovalActor(expense.submitted_by, context.authority.membership.membershipId);
  }

  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.expenses
    set state = ${input.target},
        approved_by = case when ${input.target} = 'APPROVED' then ${context.authority.membership.membershipId} else approved_by end,
        approved_at = case when ${input.target} = 'APPROVED' then now() else approved_at end,
        returned_by = case when ${input.target} = 'RETURNED' then ${context.authority.membership.membershipId} else returned_by end,
        returned_at = case when ${input.target} = 'RETURNED' then now() else returned_at end,
        return_reason = case when ${input.target} = 'RETURNED' then ${input.reason?.trim() ?? null} else return_reason end,
        rejected_by = case when ${input.target} = 'REJECTED' then ${context.authority.membership.membershipId} else rejected_by end,
        rejected_at = case when ${input.target} = 'REJECTED' then now() else rejected_at end,
        rejection_reason = case when ${input.target} = 'REJECTED' then ${input.reason?.trim() ?? null} else rejection_reason end,
        version = version + 1,
        updated_at = now()
    where ${scopedExpenseWhere(context, input.expenseId)}
      and version = ${input.expectedVersion}
      and state = ${expense.state}
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The expense became stale');
  return {
    expenseId: expense.id,
    state: input.target,
    version: Number(updated[0].version),
  };
}

export function returnExpenseInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: { expenseId: string; expectedVersion: number; reason: string },
) {
  return transitionExpenseInTransaction(transaction, context, { ...input, target: 'RETURNED' });
}

export function approveExpenseInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: { expenseId: string; expectedVersion: number },
) {
  return transitionExpenseInTransaction(transaction, context, { ...input, target: 'APPROVED' });
}

export function rejectExpenseInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: { expenseId: string; expectedVersion: number; reason: string },
) {
  return transitionExpenseInTransaction(transaction, context, { ...input, target: 'REJECTED' });
}

export async function postExpenseInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: { expenseId: string; expectedVersion: number },
) {
  const expense = await loadExpenseForUpdate(transaction, context, input.expenseId);
  if (Number(expense.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The expense is stale', {
      expectedVersion: input.expectedVersion,
      actualVersion: Number(expense.version),
    });
  }
  assertExpenseTransition(expense.state as ExpenseState, 'POSTED');
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.expenses
    set state = 'POSTED', posted_by = ${context.authority.membership.membershipId},
        posted_at = now(), version = version + 1, updated_at = now()
    where ${scopedExpenseWhere(context, input.expenseId)}
      and version = ${input.expectedVersion}
      and state = 'APPROVED'
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The expense became stale');
  const postedRow = { ...expense, state: 'POSTED' };
  await insertRecognitionEvent(transaction, context, postedRow, 'RECOGNITION');
  return { expenseId: expense.id, state: 'POSTED' as const, version: Number(updated[0].version) };
}

export async function reverseExpenseInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: { expenseId: string; expectedVersion: number; reason: string },
) {
  if (!input.reason.trim())
    throw new AppError('VALIDATION_FAILED', 'A reversal reason is required');
  const expense = await loadExpenseForUpdate(transaction, context, input.expenseId);
  if (Number(expense.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The expense is stale', {
      expectedVersion: input.expectedVersion,
      actualVersion: Number(expense.version),
    });
  }
  assertExpenseTransition(expense.state as ExpenseState, 'REVERSED');
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.expenses
    set state = 'REVERSED', reversed_by = ${context.authority.membership.membershipId},
        reversed_at = now(), reversal_reason = ${input.reason.trim()},
        version = version + 1, updated_at = now()
    where ${scopedExpenseWhere(context, input.expenseId)}
      and version = ${input.expectedVersion}
      and state = 'POSTED'
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The expense became stale');
  await insertRecognitionEvent(transaction, context, { ...expense, state: 'REVERSED' }, 'REVERSAL');
  return {
    expenseId: expense.id,
    state: 'REVERSED' as const,
    version: Number(updated[0].version),
    reason: input.reason.trim(),
  };
}

type RecurringTemplateInput = {
  description: string;
  category?: string;
  amount: string;
  currency: string;
  settlementSource: ExpenseSettlementSource;
  intervalUnit: RecurringIntervalUnit;
  intervalCount: number;
  anchorDate: string;
  active?: boolean;
  approvalPolicy: ExpenseApprovalPolicy;
};

function recurringTemplateRule(
  context: ExpenseCommandContext,
  id: string,
  input: RecurringTemplateInput,
) {
  return validateRecurringExpenseRule({
    id,
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    ...(context.stationId ? { stationId: context.stationId } : {}),
    ...input,
    currency: currency(input.currency),
  });
}

function approvalColumns(
  amount: string,
  currencyCode: CurrencyCode,
  policy: ExpenseApprovalPolicy,
) {
  const approval = calculateExpenseApproval(amount, currencyCode, policy);
  return {
    approvalRequired: approval.approvalRequired,
    requiredApproverCount: approval.requiredApproverCount,
    requiresStepUp: approval.requiresStepUp,
    stepUpThreshold: approval.stepUpThreshold ?? null,
    secondApproverThreshold: approval.secondApproverThreshold ?? null,
  };
}

export async function createRecurringExpenseTemplateInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: RecurringTemplateInput,
) {
  const id = randomUUID();
  const rule = recurringTemplateRule(context, id, input);
  const approval = approvalColumns(
    rule.amount.amount.toString(),
    rule.amount.currency,
    input.approvalPolicy,
  );
  await transaction.execute(sql`
    insert into app.expense_recurring_templates (
      id, tenant_id, legal_entity_id, station_id, description, category, amount, currency,
      settlement_source, interval_unit, interval_count, anchor_date, active,
      approval_required, required_approver_count, requires_step_up, step_up_threshold,
      second_approver_threshold, version, created_by, updated_by
    ) values (
      ${rule.id}, ${rule.tenantId}, ${rule.legalEntityId}, ${rule.stationId ?? null},
      ${rule.description}, ${rule.category ?? null}, ${rule.amount.amount.toString()}, ${rule.amount.currency},
      ${rule.settlementSource}, ${rule.intervalUnit}, ${rule.intervalCount}, ${rule.anchorDate}, ${rule.active},
      ${approval.approvalRequired}, ${approval.requiredApproverCount}, ${approval.requiresStepUp},
      ${approval.stepUpThreshold}, ${approval.secondApproverThreshold}, 0,
      ${context.authority.membership.membershipId}, ${context.authority.membership.membershipId}
    )
  `);
  return { templateId: id, version: 0, active: rule.active, amount: rule.amount.amount.toString() };
}

export async function updateRecurringExpenseTemplateInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: RecurringTemplateInput & { templateId: string; expectedVersion: number },
) {
  const existing = await transaction.execute<{ id: string; version: number | string }>(sql`
    select id, version
    from app.expense_recurring_templates
    where tenant_id = ${context.tenantId}
      and legal_entity_id = ${context.legalEntityId}
      and id = ${input.templateId}
      ${context.stationId ? sql`and station_id = ${context.stationId}` : sql``}
    for update
  `);
  if (!existing[0]) throw new AppError('NOT_FOUND', 'The recurring expense template was not found');
  if (Number(existing[0].version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The recurring expense template is stale');
  }
  const rule = recurringTemplateRule(context, input.templateId, input);
  const approval = approvalColumns(
    rule.amount.amount.toString(),
    rule.amount.currency,
    input.approvalPolicy,
  );
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.expense_recurring_templates
    set description = ${rule.description}, category = ${rule.category ?? null},
        amount = ${rule.amount.amount.toString()}, currency = ${rule.amount.currency},
        settlement_source = ${rule.settlementSource}, interval_unit = ${rule.intervalUnit},
        interval_count = ${rule.intervalCount}, anchor_date = ${rule.anchorDate}, active = ${rule.active},
        approval_required = ${approval.approvalRequired}, required_approver_count = ${approval.requiredApproverCount},
        requires_step_up = ${approval.requiresStepUp}, step_up_threshold = ${approval.stepUpThreshold},
        second_approver_threshold = ${approval.secondApproverThreshold}, version = version + 1,
        updated_by = ${context.authority.membership.membershipId}, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${input.templateId}
      and version = ${input.expectedVersion}
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The recurring expense template became stale');
  return { templateId: input.templateId, version: Number(updated[0].version), active: rule.active };
}

export async function deactivateRecurringExpenseTemplateInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: { templateId: string; expectedVersion: number },
) {
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.expense_recurring_templates
    set active = false, version = version + 1,
        updated_by = ${context.authority.membership.membershipId}, updated_at = now()
    where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
      and id = ${input.templateId}
      ${context.stationId ? sql`and station_id = ${context.stationId}` : sql``}
      and version = ${input.expectedVersion}
      and active = true
    returning version
  `);
  if (!updated[0])
    throw new AppError('CONFLICT', 'The recurring expense template is stale or inactive');
  return { templateId: input.templateId, version: Number(updated[0].version), active: false };
}

export async function generateRecurringCostPeriodInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: { templateId: string; businessDate: string },
) {
  const templates = await transaction.execute<{
    id: string;
    tenant_id: string;
    legal_entity_id: string;
    station_id: string | null;
    description: string;
    category: string | null;
    amount: string;
    currency: string;
    settlement_source: string;
    interval_unit: string;
    interval_count: number | string;
    anchor_date: string;
    active: boolean;
    approval_required: boolean;
    step_up_threshold: string | null;
    second_approver_threshold: string | null;
  }>(sql`
    select id, tenant_id, legal_entity_id, station_id, description, category, amount::text,
           currency, settlement_source, interval_unit, interval_count, anchor_date, active,
           approval_required, step_up_threshold::text, second_approver_threshold::text
    from app.expense_recurring_templates
    where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
      and id = ${input.templateId}
      ${context.stationId ? sql`and station_id = ${context.stationId}` : sql``}
    for update
  `);
  const template = templates[0];
  if (!template) throw new AppError('NOT_FOUND', 'The recurring expense template was not found');
  if (!template.active)
    throw new AppError('CONFLICT', 'The recurring expense template is inactive');
  const rule = validateRecurringExpenseRule({
    id: template.id,
    tenantId: template.tenant_id,
    legalEntityId: template.legal_entity_id,
    ...(template.station_id ? { stationId: template.station_id } : {}),
    description: template.description,
    ...(template.category ? { category: template.category } : {}),
    amount: template.amount,
    currency: currency(template.currency),
    settlementSource: template.settlement_source as ExpenseSettlementSource,
    intervalUnit: template.interval_unit as RecurringIntervalUnit,
    intervalCount: Number(template.interval_count),
    anchorDate: template.anchor_date,
    active: template.active,
    approvalPolicy: {
      approvalRequired: template.approval_required,
      ...(template.step_up_threshold ? { stepUpThreshold: template.step_up_threshold } : {}),
      ...(template.second_approver_threshold
        ? { secondApproverThreshold: template.second_approver_threshold }
        : {}),
    },
  });
  if (!isRecurringExpenseDue(rule, input.businessDate)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The requested date is not due under this recurring rule',
    );
  }
  const approval = approvalColumns(rule.amount.amount.toString(), rule.amount.currency, {
    approvalRequired: rule.approvalPolicy.approvalRequired,
    ...(rule.approvalPolicy.stepUpThreshold
      ? { stepUpThreshold: rule.approvalPolicy.stepUpThreshold.toString() }
      : {}),
    ...(rule.approvalPolicy.secondApproverThreshold
      ? { secondApproverThreshold: rule.approvalPolicy.secondApproverThreshold.toString() }
      : {}),
  });
  const expenseId = randomUUID();
  await transaction.execute(sql`
    insert into app.expenses (
      id, tenant_id, legal_entity_id, station_id, recurring_template_id, business_date,
      description, category, amount, currency, classification, settlement_source, state,
      approval_required, required_approver_count, requires_step_up, version,
      created_by, submitted_by, submitted_at
    ) values (
      ${expenseId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId ?? null},
      ${template.id}, ${input.businessDate}, ${rule.description}, ${rule.category ?? null},
      ${rule.amount.amount.toString()}, ${rule.amount.currency}, 'RECURRING_FIXED_COST',
      ${rule.settlementSource}, 'SUBMITTED', ${approval.approvalRequired},
      ${approval.requiredApproverCount}, ${approval.requiresStepUp}, 0,
      ${context.authority.membership.membershipId}, ${context.authority.membership.membershipId}, now()
    )
  `);
  return {
    expenseId,
    templateId: template.id,
    businessDate: input.businessDate,
    state: 'SUBMITTED' as const,
    version: 0,
    amount: rule.amount.amount.toString(),
    currency: rule.amount.currency,
  };
}
