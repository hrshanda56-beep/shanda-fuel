import 'server-only';

import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorizeExpenseCommand, resolveExpenseCommandContext } from './application';

const querySchema = z
  .object({
    tenantId: z.string().uuid(),
    legalEntityId: z.string().uuid().optional(),
    stationId: z.string().uuid().optional(),
    state: z
      .enum(['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'POSTED', 'REVERSED'])
      .optional(),
    fromBusinessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    toBusinessDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .superRefine((value, refinement) => {
    if (!value.legalEntityId && !value.stationId) {
      refinement.addIssue({
        code: 'custom',
        path: ['legalEntityId'],
        message: 'A legal entity or station context is required',
      });
    }
    if (
      value.fromBusinessDate &&
      value.toBusinessDate &&
      value.fromBusinessDate > value.toBusinessDate
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['toBusinessDate'],
        message: 'The end business date must not precede the start date',
      });
    }
  });

export type ExpenseListItem = Readonly<{
  expenseId: string;
  legalEntityId: string;
  stationId: string | null;
  businessDate: string;
  description: string;
  category: string | null;
  amount: string;
  currency: string;
  classification: string;
  settlementSource: string;
  state: string;
  version: number;
}>;

export type RecurringExpenseTemplateListItem = Readonly<{
  templateId: string;
  legalEntityId: string;
  stationId: string | null;
  description: string;
  category: string | null;
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

export async function getExpensesFromRequest(request: Request, input: unknown) {
  const query = querySchema.parse(input);
  const context = await resolveExpenseCommandContext({
    request,
    requestedTenantId: query.tenantId,
    legalEntityId: query.legalEntityId,
    stationId: query.stationId,
  });
  authorizeExpenseCommand(context, 'expense.view');

  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
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
    }>(sql`
      select id, legal_entity_id, station_id, business_date, description, category,
             amount::text, currency, classification, settlement_source, state, version
      from app.expenses
      where tenant_id = ${context.tenantId}
        and legal_entity_id = ${context.legalEntityId}
        ${context.stationId ? sql`and station_id = ${context.stationId}` : sql``}
        ${query.state ? sql`and state = ${query.state}` : sql``}
        ${query.fromBusinessDate ? sql`and business_date >= ${query.fromBusinessDate}` : sql``}
        ${query.toBusinessDate ? sql`and business_date <= ${query.toBusinessDate}` : sql``}
      order by business_date desc, id desc
    `);

    return rows.map<ExpenseListItem>((row) => ({
      expenseId: row.id,
      legalEntityId: row.legal_entity_id,
      stationId: row.station_id,
      businessDate: row.business_date,
      description: row.description,
      category: row.category,
      amount: row.amount,
      currency: row.currency,
      classification: row.classification,
      settlementSource: row.settlement_source,
      state: row.state,
      version: Number(row.version),
    }));
  });
}

export async function getRecurringExpenseTemplatesFromRequest(request: Request, input: unknown) {
  const query = z
    .object({
      tenantId: z.string().uuid(),
      legalEntityId: z.string().uuid().optional(),
      stationId: z.string().uuid().optional(),
    })
    .refine((value) => value.legalEntityId || value.stationId, {
      message: 'A legal entity or station context is required',
    })
    .parse(input);
  const context = await resolveExpenseCommandContext({
    request,
    requestedTenantId: query.tenantId,
    legalEntityId: query.legalEntityId,
    stationId: query.stationId,
  });
  authorizeExpenseCommand(context, 'expense.recurring.manage');

  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
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
      required_approver_count: number | string;
      requires_step_up: boolean;
      version: number | string;
    }>(sql`
      select id, legal_entity_id, station_id, description, category, amount::text, currency,
             settlement_source, interval_unit, interval_count, anchor_date, active,
             approval_required, required_approver_count, requires_step_up, version
      from app.expense_recurring_templates
      where tenant_id = ${context.tenantId}
        and legal_entity_id = ${context.legalEntityId}
        ${context.stationId ? sql`and station_id = ${context.stationId}` : sql``}
      order by active desc, description asc, id asc
    `);
    return rows.map<RecurringExpenseTemplateListItem>((row) => ({
      templateId: row.id,
      legalEntityId: row.legal_entity_id,
      stationId: row.station_id,
      description: row.description,
      category: row.category,
      amount: row.amount,
      currency: row.currency,
      settlementSource: row.settlement_source,
      intervalUnit: row.interval_unit,
      intervalCount: Number(row.interval_count),
      anchorDate: row.anchor_date,
      active: row.active,
      approvalRequired: row.approval_required,
      requiredApproverCount: Number(row.required_approver_count),
      requiresStepUp: row.requires_step_up,
      version: Number(row.version),
    }));
  });
}
