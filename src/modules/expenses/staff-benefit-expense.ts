import 'server-only';

import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { loadStaffBenefitMonth } from '../customers/staff-benefit-expense-read';
import {
  STAFF_BENEFIT_EXPENSE_CATEGORY_CODE,
  STAFF_BENEFIT_EXPENSE_CATEGORY_NAME,
  benefitExpenseDate,
  staffBenefitExpenseDescription,
} from '../customers/staff-benefit-expense';
import {
  authorizeExpenseCommand,
  type ExpenseCommandContext,
  type ExpenseTransaction,
} from './application';
import type { ExpenseCommandInput } from './contracts';
import { createExpenseCategoryInTransaction, submitExpenseInTransaction } from './persistence';

/**
 * Posts one account's staff fuel benefit for a closed month as an ordinary SUBMITTED expense, so it
 * then needs the usual approval and posting and can be corrected or reversed like any expense.
 * Nothing here posts by itself: a person chooses the account and month and confirms the figure.
 *
 * The same account, station and month cannot be submitted twice: the expense reference is unique
 * among active expenses at a station (see `staffBenefitExpenseReference`).
 */
export async function submitStaffBenefitExpenseInTransaction(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
  input: ExpenseCommandInput<'SubmitStaffBenefitExpense'>,
) {
  authorizeExpenseCommand(context, 'expense.submit');
  const month = await loadStaffBenefitMonth(transaction, {
    tenantId: context.tenantId,
    stationId: input.stationId,
    accountId: input.accountId,
    month: input.month,
  });
  if (!month.closed) {
    throw new AppError(
      'CONFLICT',
      'This month is not over yet at the station. Post the staff fuel benefit after the month ends.',
    );
  }
  if (month.existingExpense) {
    throw new AppError(
      'CONFLICT',
      'The staff fuel benefit for this person and month has already been entered. Reverse that expense first if it was wrong.',
      { expenseId: month.existingExpense.id },
    );
  }
  if (month.cost.status === 'NO_FUEL') {
    throw new AppError('CONFLICT', 'No fuel was taken on this account in that month.');
  }
  if (month.cost.status === 'UNAVAILABLE') {
    throw new AppError(
      'CONFLICT',
      `The cost of the fuel is not available for ${month.cost.missing.join(', ')}. Nothing was entered.`,
    );
  }
  if (month.cost.total !== normalizeAmount(input.expectedAmount)) {
    throw new AppError(
      'CONFLICT',
      'The cost changed since you looked at it. Reload the page, check the new figure and confirm again.',
      { currentAmount: month.cost.total },
    );
  }
  const categoryId = await ensureCategory(transaction, context);
  const result = await submitExpenseInTransaction(transaction, context, {
    commandType: 'SubmitExpense',
    tenantId: context.tenantId,
    stationId: input.stationId,
    categoryId,
    expenseDate: benefitExpenseDate(input.month),
    description: staffBenefitExpenseDescription(month.staffName, input.month),
    reference: month.reference,
    amount: month.cost.total,
  });
  return { ...result, accountId: input.accountId, month: input.month };
}

function normalizeAmount(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(4, '0')}`;
}

async function ensureCategory(
  transaction: ExpenseTransaction,
  context: ExpenseCommandContext,
): Promise<string> {
  const rows = await transaction.execute<{ id: string; classification: string; status: string }>(
    sql`
      select id, classification, status from app.expense_categories
      where tenant_id = ${context.tenantId} and code = ${STAFF_BENEFIT_EXPENSE_CATEGORY_CODE}
    `,
  );
  const found = rows[0];
  if (found) {
    if (found.status !== 'ACTIVE' || found.classification !== 'OPERATING') {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'The Staff fuel benefit expense category is inactive or not an operating category.',
      );
    }
    return found.id;
  }
  authorizeExpenseCommand(context, 'expense.manage');
  const created = await createExpenseCategoryInTransaction(transaction, context, {
    commandType: 'CreateExpenseCategory',
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: STAFF_BENEFIT_EXPENSE_CATEGORY_CODE,
    name: STAFF_BENEFIT_EXPENSE_CATEGORY_NAME,
    classification: 'OPERATING',
  });
  return created.categoryId;
}
