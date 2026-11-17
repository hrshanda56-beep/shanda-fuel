import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ForecourtCommandContext, ForecourtTransaction } from './application';

/**
 * Expenses typed into a shift report are real costs, so approving the report puts each one into
 * the Expenses book as a posted, already-paid expense. That is what makes them reach the Expenses
 * page, daily profit and the income statement.
 *
 * Nothing here asks anyone to approve twice: the person who approved the report is the approver.
 * The expense reference is derived from the report line, so posting the same report again never
 * creates a second expense.
 */
export const SHIFT_EXPENSE_REFERENCE_PREFIX = 'SHIFTREPORT-';

const FALLBACK_CATEGORY_CODE = 'OTHER';
const FALLBACK_CATEGORY_NAME = 'Other';

type ReportExpenseRow = {
  id: string;
  category: string;
  description: string;
  amount: string;
  paymentMethod: string;
  personPaid: string | null;
  enteredBy: string;
};

type CategoryRow = { id: string; code: string; name: string };

const PAYMENT_METHOD: Record<string, 'STATION_CASH' | 'ECOCASH' | 'BANK' | 'CARD'> = {
  CASH: 'STATION_CASH',
  ECOCASH: 'ECOCASH',
  BANK_TRANSFER: 'BANK',
  POS: 'CARD',
};

const SETTLEMENT_SOURCE: Record<string, 'CASH' | 'MOBILE_MONEY' | 'BANK'> = {
  CASH: 'CASH',
  ECOCASH: 'MOBILE_MONEY',
  BANK_TRANSFER: 'BANK',
  POS: 'BANK',
};

export function shiftExpenseReference(businessDate: string, reportExpenseId: string): string {
  return `${SHIFT_EXPENSE_REFERENCE_PREFIX}${businessDate}-${reportExpenseId.slice(0, 8)}`;
}

const normalise = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');

/** The category the attendant typed, matched to a real one by name or code; otherwise "Other". */
export function matchExpenseCategory(
  typed: string,
  categories: readonly CategoryRow[],
): CategoryRow | undefined {
  const wanted = normalise(typed);
  return categories.find(
    (category) => normalise(category.name) === wanted || normalise(category.code) === wanted,
  );
}

export async function postShiftExpensesInTransaction(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
  input: { reconciliationId: string; businessDate: string },
): Promise<{ posted: number }> {
  const lines = await transaction.execute<ReportExpenseRow>(sql`
    select id, category, description, amount::text as amount, payment_method as "paymentMethod",
           person_paid as "personPaid", entered_by as "enteredBy"
    from app.reconciliation_expenses
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and reconciliation_id = ${input.reconciliationId} and amount > 0
    order by id
  `);
  if (lines.length === 0) return { posted: 0 };

  const categories = await transaction.execute<CategoryRow>(sql`
    select id, code, name from app.expense_categories
    where tenant_id = ${context.tenantId} and status = 'ACTIVE' and classification = 'OPERATING'
  `);
  let fallback = categories.find((category) => category.code === FALLBACK_CATEGORY_CODE);
  const actor = context.actor.membershipId;
  let posted = 0;

  for (const line of lines) {
    const reference = shiftExpenseReference(input.businessDate, line.id);
    const existing = await transaction.execute(sql`
      select 1 from app.expenses
      where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
        and reference = ${reference}
    `);
    if (existing.length > 0) continue;

    let category = matchExpenseCategory(line.category, categories);
    let description = line.description;
    if (!category) {
      if (!fallback) {
        const id = randomUUID();
        await transaction.execute(sql`
          insert into app.expense_categories (id, tenant_id, code, name, classification, created_by)
          values (${id}, ${context.tenantId}, ${FALLBACK_CATEGORY_CODE}, ${FALLBACK_CATEGORY_NAME},
                  'OPERATING', ${actor})
          on conflict do nothing
        `);
        const created = await transaction.execute<CategoryRow>(sql`
          select id, code, name from app.expense_categories
          where tenant_id = ${context.tenantId} and code = ${FALLBACK_CATEGORY_CODE}
            and status = 'ACTIVE' and classification = 'OPERATING'
        `);
        fallback = created[0];
      }
      if (!fallback) continue;
      category = fallback;
      // Keep what the attendant wrote about the cost when it fits no category.
      description = `${line.category}: ${line.description}`;
    }

    const expenseId = randomUUID();
    await transaction.execute(sql`
      insert into app.expenses (
        id, tenant_id, legal_entity_id, station_id, category_id, expense_date, description,
        payee, reference, payment_method, currency, amount, state, version, required_approvals,
        submitted_by
      ) values (
        ${expenseId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
        ${category.id}, ${input.businessDate}, ${description}, ${line.personPaid},
        ${reference}, ${PAYMENT_METHOD[line.paymentMethod] ?? null}, 'USD', ${line.amount},
        'SUBMITTED', 0, 1, ${line.enteredBy}
      )
    `);
    await transaction.execute(sql`
      insert into app.expense_approvals (id, tenant_id, expense_id, decision, actor_membership_id)
      values (${randomUUID()}, ${context.tenantId}, ${expenseId}, 'APPROVED', ${actor})
    `);
    await transaction.execute(sql`
      update app.expenses set state = 'APPROVED', version = version + 1, updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${expenseId}
    `);
    await transaction.execute(sql`
      update app.expenses
      set state = 'POSTED', posted_by = ${actor}, posted_at = now(),
          version = version + 1, updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${expenseId}
    `);
    await transaction.execute(sql`
      insert into app.expense_recognition_movements (
        id, tenant_id, legal_entity_id, station_id, category_id, classification, movement_type,
        source_type, source_id, recognition_date, currency, amount, actor_membership_id
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
        ${category.id}, 'OPERATING', 'RECOGNITION', 'EXPENSE', ${expenseId},
        ${input.businessDate}, 'USD', ${line.amount}, ${actor}
      )
    `);
    const source = SETTLEMENT_SOURCE[line.paymentMethod];
    if (source) {
      // Paid out during the shift, so it is not an unpaid bill.
      await transaction.execute(sql`
        insert into app.expense_payments (
          id, tenant_id, legal_entity_id, station_id, expense_id, payment_date, currency, amount,
          settlement_source, external_reference, state, recorded_by
        ) values (
          ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
          ${expenseId}, ${input.businessDate}, 'USD', ${line.amount}, ${source},
          'Paid during the shift (shift report)', 'RECORDED', ${actor}
        )
      `);
    }
    posted += 1;
  }
  return { posted };
}
