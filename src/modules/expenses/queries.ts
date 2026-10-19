import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { authorize, isPermissionGranted } from '../../platform/security/permissions';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import type { AuthenticatedActorContext } from '../identity';
import { resolveExpenseReadContext } from './read-context';
import type { ExpenseCommandContext } from './application';
import { EXPENSE_STATES, outstandingAmount, paymentStatus } from './domain';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const expenseScopeQuerySchema = z
  .object({
    tenantId: uuid,
    legalEntityId: uuid.optional(),
    stationId: uuid.optional(),
  })
  .refine((value) => value.legalEntityId || value.stationId, {
    message: 'stationId or legalEntityId is required',
  });

export const expenseListQuerySchema = z
  .object({
    tenantId: uuid,
    legalEntityId: uuid.optional(),
    stationId: uuid.optional(),
    state: z.enum(EXPENSE_STATES).optional(),
    from: date.optional(),
    to: date.optional(),
    expenseId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((value) => value.legalEntityId || value.stationId, {
    message: 'stationId or legalEntityId is required',
  });

export const expenseSummaryQuerySchema = z
  .object({
    tenantId: uuid,
    legalEntityId: uuid.optional(),
    stationId: uuid.optional(),
    from: date,
    to: date,
  })
  .refine((value) => value.legalEntityId || value.stationId, {
    message: 'stationId or legalEntityId is required',
  });

async function readContext(
  request: Request,
  input: { tenantId: string; legalEntityId?: string; stationId?: string },
  actor?: AuthenticatedActorContext,
): Promise<ExpenseCommandContext> {
  const context = await resolveExpenseReadContext({
    request,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: input.stationId,
    authenticatedActor: actor,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'expense.view',
    requestedScope: context.scope,
  });
  return context;
}

type ExpenseListRow = {
  id: string;
  station_id: string;
  category_id: string;
  category_code: string;
  category_name: string;
  expense_date: string;
  description: string;
  payee: string | null;
  reference: string | null;
  amount: string;
  state: string;
  version: number | string;
  required_approvals: number;
  approvals: number | string;
  submitted_by: string;
  submitted_at: string;
  posted_at: string | null;
  reversal_reason: string | null;
  rejection_reason: string | null;
  settled: string;
};

export async function listExpensesFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
) {
  const input = expenseListQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<ExpenseListRow>(sql`
      select e.id, e.station_id, e.category_id, c.code as category_code, c.name as category_name,
        e.expense_date, e.description, e.payee, e.reference, e.amount::text as amount, e.state,
        e.version, e.required_approvals,
        (select count(*) from app.expense_approvals a
           where a.tenant_id = e.tenant_id and a.expense_id = e.id and a.decision = 'APPROVED') as approvals,
        e.submitted_by, e.submitted_at::text as submitted_at, e.posted_at::text as posted_at,
        e.reversal_reason, e.rejection_reason,
        coalesce((select sum(p.amount) from app.expense_payments p
           where p.tenant_id = e.tenant_id and p.expense_id = e.id and p.state = 'RECORDED'), 0)::text as settled
      from app.expenses e
      join app.expense_categories c on c.tenant_id = e.tenant_id and c.id = e.category_id
      where e.tenant_id = ${context.tenantId}
        and e.legal_entity_id = ${context.legalEntityId}
        ${context.stationId ? sql`and e.station_id = ${context.stationId}` : sql``}
        ${input.state ? sql`and e.state = ${input.state}` : sql``}
        ${input.from ? sql`and e.expense_date >= ${input.from}` : sql``}
        ${input.to ? sql`and e.expense_date <= ${input.to}` : sql``}
        ${input.expenseId ? sql`and e.id = ${input.expenseId}` : sql``}
      order by e.expense_date desc, e.submitted_at desc, e.id
      limit ${input.limit}
    `);
    const items = rows.map((row) => {
      const settled = [row.settled];
      const posted = row.state === 'POSTED';
      return {
        expenseId: row.id,
        stationId: row.station_id,
        category: { id: row.category_id, code: row.category_code, name: row.category_name },
        expenseDate: row.expense_date,
        description: row.description,
        payee: row.payee,
        reference: row.reference,
        currency: 'USD' as const,
        amount: row.amount,
        state: row.state,
        version: Number(row.version),
        requiredApprovals: row.required_approvals,
        approvals: Number(row.approvals),
        submittedBy: row.submitted_by,
        submittedAt: row.submitted_at,
        postedAt: row.posted_at,
        rejectionReason: row.rejection_reason,
        reversalReason: row.reversal_reason,
        settledAmount: Number(row.settled) === 0 ? '0.0000' : row.settled,
        outstanding: posted ? outstandingAmount(row.amount, settled) : null,
        paymentStatus: posted ? paymentStatus(row.amount, settled) : null,
      };
    });
    if (!input.expenseId) return { items };
    if (items.length === 0) throw new AppError('NOT_FOUND', 'The expense was not found');
    const approvals = await transaction.execute<{
      actor_membership_id: string;
      decision: string;
      reason: string | null;
      decided_at: string;
    }>(sql`
      select actor_membership_id, decision, reason, decided_at::text as decided_at
      from app.expense_approvals
      where tenant_id = ${context.tenantId} and expense_id = ${input.expenseId}
      order by decided_at, id
    `);
    const payments = await transaction.execute<{
      id: string;
      payment_date: string;
      amount: string;
      settlement_source: string;
      cash_movement_id: string | null;
      external_reference: string | null;
      state: string;
      reversal_reason: string | null;
    }>(sql`
      select id, payment_date, amount::text as amount, settlement_source, cash_movement_id,
             external_reference, state, reversal_reason
      from app.expense_payments
      where tenant_id = ${context.tenantId} and expense_id = ${input.expenseId}
      order by recorded_at, id
    `);
    return {
      items,
      detail: {
        approvals: approvals.map((row) => ({
          actorMembershipId: row.actor_membership_id,
          decision: row.decision,
          reason: row.reason,
          decidedAt: row.decided_at,
        })),
        payments: payments.map((row) => ({
          paymentId: row.id,
          paymentDate: row.payment_date,
          amount: row.amount,
          settlementSource: row.settlement_source,
          cashMovementId: row.cash_movement_id,
          externalReference: row.external_reference,
          state: row.state,
          reversalReason: row.reversal_reason,
        })),
      },
    };
  });
}

export async function getExpenseSummaryFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
) {
  const input = expenseSummaryQuerySchema.parse(rawInput);
  if (input.from > input.to) throw new AppError('VALIDATION_FAILED', 'from cannot be after to');
  const context = await readContext(request, input, actor);
  const stationFilter = (column: ReturnType<typeof sql.raw>) =>
    context.stationId ? sql`and ${column} = ${context.stationId}` : sql``;
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const recognized = await transaction.execute<{
      classification: string;
      category_id: string;
      category_code: string;
      category_name: string;
      amount: string;
    }>(sql`
      select m.classification, m.category_id, c.code as category_code, c.name as category_name,
        sum(case when m.movement_type = 'RECOGNITION' then m.amount else -m.amount end)::text as amount
      from app.expense_recognition_movements m
      join app.expense_categories c on c.tenant_id = m.tenant_id and c.id = m.category_id
      where m.tenant_id = ${context.tenantId} and m.legal_entity_id = ${context.legalEntityId}
        ${stationFilter(sql.raw('m.station_id'))}
        and m.recognition_date >= ${input.from} and m.recognition_date <= ${input.to}
      group by m.classification, m.category_id, c.code, c.name
      order by m.classification, c.code
    `);
    const payables = await transaction.execute<{ expenses: string; recurring: string }>(sql`
      select
        coalesce((select sum(e.amount - coalesce(p.settled, 0))
          from app.expenses e
          left join (select tenant_id, expense_id, sum(amount) as settled
                     from app.expense_payments where state = 'RECORDED' group by 1, 2) p
            on p.tenant_id = e.tenant_id and p.expense_id = e.id
          where e.tenant_id = ${context.tenantId} and e.legal_entity_id = ${context.legalEntityId}
            ${stationFilter(sql.raw('e.station_id'))}
            and e.state = 'POSTED'), 0)::text as expenses,
        coalesce((select sum(r.amount - coalesce(p.settled, 0))
          from app.recurring_cost_periods r
          left join (select tenant_id, recurring_period_id, sum(amount) as settled
                     from app.expense_payments where state = 'RECORDED' group by 1, 2) p
            on p.tenant_id = r.tenant_id and p.recurring_period_id = r.id
          where r.tenant_id = ${context.tenantId} and r.legal_entity_id = ${context.legalEntityId}
            ${stationFilter(sql.raw('r.station_id'))}), 0)::text as recurring
    `);
    const pending = await transaction.execute<{ count: string }>(sql`
      select count(*)::text as count from app.expenses e
      where e.tenant_id = ${context.tenantId} and e.legal_entity_id = ${context.legalEntityId}
        ${stationFilter(sql.raw('e.station_id'))}
        and e.state in ('SUBMITTED', 'APPROVED')
    `);
    const total = (name: string) =>
      sumDecimal(recognized.filter((row) => row.classification === name).map((row) => row.amount));
    return {
      from: input.from,
      to: input.to,
      currency: 'USD' as const,
      operatingExpenses: total('OPERATING'),
      fixedCostRecognition: total('FIXED_COST'),
      byCategory: recognized.map((row) => ({
        classification: row.classification,
        categoryId: row.category_id,
        code: row.category_code,
        name: row.category_name,
        amount: row.amount,
      })),
      payables: {
        postedExpensesOutstanding: payables[0]?.expenses ?? '0.0000',
        recurringObligationsOutstanding: payables[0]?.recurring ?? '0.0000',
      },
      awaitingPostingCount: Number(pending[0]?.count ?? 0),
    };
  });
}

function sumDecimal(values: readonly string[]): string {
  // Exact decimal sum via scaled bigint arithmetic (4 fractional digits).
  let total = 0n;
  for (const value of values) {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
    const scaled = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
    total += negative ? -scaled : scaled;
  }
  const negative = total < 0n;
  const abs = negative ? -total : total;
  return `${negative ? '-' : ''}${abs / 10000n}.${String(abs % 10000n).padStart(4, '0')}`;
}

export async function getExpenseReferenceFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
) {
  const input = expenseScopeQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const categories = await transaction.execute<{
      id: string;
      code: string;
      name: string;
      classification: string;
      status: string;
    }>(sql`
      select id, code, name, classification, status
      from app.expense_categories where tenant_id = ${context.tenantId} order by code
    `);
    const policy = await transaction.execute<{
      version: number | string;
      step_up_threshold: string | null;
      second_approval_threshold: string | null;
    }>(sql`
      select version, step_up_threshold::text, second_approval_threshold::text
      from app.expense_policies
      where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
    `);
    const templates = await transaction.execute<{
      id: string;
      station_id: string;
      category_id: string;
      name: string;
      amount: string;
      start_date: string;
      end_date: string | null;
      status: string;
    }>(sql`
      select id, station_id, category_id, name, amount::text as amount, start_date, end_date, status
      from app.recurring_cost_templates
      where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
        ${context.stationId ? sql`and station_id = ${context.stationId}` : sql``}
      order by name
    `);
    const periods = await transaction.execute<{
      id: string;
      station_id: string;
      template_id: string;
      period_start: string;
      period_end: string;
      amount: string;
      version: number | string;
      recognized: string;
      settled: string;
    }>(sql`
      select r.id, r.station_id, r.template_id, r.period_start, r.period_end,
        r.amount::text as amount, r.version,
        coalesce((select sum(x.amount) from app.recurring_cost_recognitions x
          where x.tenant_id = r.tenant_id and x.period_id = r.id and x.state = 'RECOGNIZED'), 0)::text as recognized,
        coalesce((select sum(p.amount) from app.expense_payments p
          where p.tenant_id = r.tenant_id and p.recurring_period_id = r.id and p.state = 'RECORDED'), 0)::text as settled
      from app.recurring_cost_periods r
      where r.tenant_id = ${context.tenantId} and r.legal_entity_id = ${context.legalEntityId}
        ${context.stationId ? sql`and r.station_id = ${context.stationId}` : sql``}
      order by r.period_start desc, r.id
      limit 120
    `);
    const may = (permissionCode: Parameters<typeof isPermissionGranted>[0]['permissionCode']) =>
      isPermissionGranted({
        actor: context.authority.authorization,
        permissionCode,
        requestedScope: context.scope,
      });
    return {
      /** What this person may do, so screens can hide actions that would be refused. */
      capabilities: {
        submit: may('expense.submit'),
        approve: may('expense.approve'),
        post: may('expense.post'),
        reverse: may('expense.reverse'),
        recordPayment: may('expense.payment.record'),
        reversePayment: may('expense.payment.reverse'),
        manageCategories: may('expense.manage'),
      },
      categories: categories.map((row) => ({
        categoryId: row.id,
        code: row.code,
        name: row.name,
        classification: row.classification,
        status: row.status,
      })),
      policy: policy[0]
        ? {
            version: Number(policy[0].version),
            stepUpThreshold: policy[0].step_up_threshold,
            secondApprovalThreshold: policy[0].second_approval_threshold,
          }
        : null,
      templates: templates.map((row) => ({
        templateId: row.id,
        stationId: row.station_id,
        categoryId: row.category_id,
        name: row.name,
        amount: row.amount,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
      })),
      periods: periods.map((row) => ({
        periodId: row.id,
        stationId: row.station_id,
        templateId: row.template_id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        amount: row.amount,
        version: Number(row.version),
        recognizedAmount: row.recognized,
        settledAmount: row.settled,
        outstanding: outstandingAmount(row.amount, [row.settled]),
        paymentStatus: paymentStatus(row.amount, [row.settled]),
      })),
    };
  });
}
