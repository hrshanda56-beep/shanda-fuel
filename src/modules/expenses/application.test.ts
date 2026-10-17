import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../platform/errors';

vi.mock('../tenancy/authority', () => ({
  resolveTenantExecutionContext: vi.fn(),
}));

import {
  EXPENSE_COMMAND_TYPES,
  EXPENSE_PERMISSION_CODES,
  expenseRequestHash,
  resolveExpenseCommandContext,
} from './application';

describe('expense application boundary', () => {
  it('publishes named commands and expense-specific permissions for A0/A1 integration', () => {
    expect(EXPENSE_COMMAND_TYPES).toEqual([
      'SubmitExpense',
      'ReturnExpense',
      'ApproveExpense',
      'RejectExpense',
      'PostExpense',
      'ReverseExpense',
      'CreateRecurringExpenseTemplate',
      'UpdateRecurringExpenseTemplate',
      'DeactivateRecurringExpenseTemplate',
      'GenerateRecurringCostPeriod',
    ]);
    expect(EXPENSE_PERMISSION_CODES).toEqual([
      'expense.view',
      'expense.submit',
      'expense.approve',
      'expense.post',
      'expense.reverse',
      'expense.recurring.manage',
    ]);
  });

  it('hashes the complete request payload for idempotency', () => {
    expect(expenseRequestHash({ commandType: 'SubmitExpense', amount: '10.00' })).toHaveLength(64);
    expect(expenseRequestHash({ amount: '10.00' })).not.toBe(
      expenseRequestHash({ amount: '10.01' }),
    );
  });

  it('fails closed before resolving an underspecified expense context', async () => {
    await expect(
      resolveExpenseCommandContext({
        request: new Request('https://fuel.example.test'),
        requestedTenantId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' } satisfies Partial<AppError>);
  });
});
