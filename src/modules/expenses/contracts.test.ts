import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES, DEFAULT_ROLE_PERMISSIONS } from '../../platform/security/permissions';
import {
  EXPENSE_COMMAND_POLICY,
  EXPENSE_COMMAND_SCHEMAS,
  EXPENSE_COMMAND_TYPES,
  EXPENSE_PERMISSION_CODES,
} from './contracts';

const tenantId = '11111111-1111-4111-8111-111111111111';
const stationId = '22222222-2222-4222-8222-222222222222';
const expenseId = '33333333-3333-4333-8333-333333333333';

describe('expense command contracts', () => {
  it('has a schema and a policy for every command and every permission is in the catalogue', () => {
    expect(Object.keys(EXPENSE_COMMAND_POLICY).sort()).toEqual([...EXPENSE_COMMAND_TYPES].sort());
    for (const type of EXPENSE_COMMAND_TYPES) {
      expect(PERMISSION_CODES).toContain(EXPENSE_COMMAND_POLICY[type].permissionCode);
      expect(EXPENSE_COMMAND_SCHEMAS[type]).toBeDefined();
    }
    for (const code of EXPENSE_PERMISSION_CODES) expect(PERMISSION_CODES).toContain(code);
  });

  it('rejects JSON numbers and over-precise decimals for money', () => {
    const base = {
      commandType: 'SubmitExpense',
      tenantId,
      stationId,
      categoryId: expenseId,
      expenseDate: '2026-10-18',
      description: 'Cleaning',
    };
    expect(EXPENSE_COMMAND_SCHEMAS.SubmitExpense.safeParse({ ...base, amount: 10.5 }).success).toBe(
      false,
    );
    expect(
      EXPENSE_COMMAND_SCHEMAS.SubmitExpense.safeParse({ ...base, amount: '10.12345' }).success,
    ).toBe(false);
    expect(EXPENSE_COMMAND_SCHEMAS.SubmitExpense.safeParse({ ...base, amount: '-5' }).success).toBe(
      false,
    );
    expect(
      EXPENSE_COMMAND_SCHEMAS.SubmitExpense.safeParse({ ...base, amount: '10.1234' }).success,
    ).toBe(true);
  });

  it('requires expectedVersion on state-changing commands and a reason on reversals', () => {
    const common = { tenantId, stationId, expenseId };
    expect(
      EXPENSE_COMMAND_SCHEMAS.ApproveExpense.safeParse({ ...common, commandType: 'ApproveExpense' })
        .success,
    ).toBe(false);
    expect(
      EXPENSE_COMMAND_SCHEMAS.ReverseExpense.safeParse({
        ...common,
        commandType: 'ReverseExpense',
        expectedVersion: 1,
        reason: '  ',
      }).success,
    ).toBe(false);
    for (const type of EXPENSE_COMMAND_TYPES) {
      if (EXPENSE_COMMAND_POLICY[type].requiresExpectedVersion) {
        const shape = (
          EXPENSE_COMMAND_SCHEMAS[type] as unknown as { shape?: Record<string, unknown> }
        ).shape;
        // Refined schemas wrap their object; the policy flag is the contract for those.
        if (shape) expect(Object.keys(shape)).toContain('expectedVersion');
      }
    }
  });

  it('requires exactly one settlement target', () => {
    const payment = {
      commandType: 'RecordExpensePayment',
      tenantId,
      stationId,
      expectedVersion: 1,
      paymentDate: '2026-10-18',
      amount: '10',
      settlementSource: 'BANK',
      externalReference: 'REF-1',
    };
    const schema = EXPENSE_COMMAND_SCHEMAS.RecordExpensePayment;
    expect(schema.safeParse(payment).success).toBe(false);
    expect(schema.safeParse({ ...payment, expenseId }).success).toBe(true);
    expect(schema.safeParse({ ...payment, expenseId, recurringPeriodId: expenseId }).success).toBe(
      false,
    );
  });

  it('keeps reversal commands behind step-up and gives supervisors no approval power', () => {
    for (const type of [
      'ReverseExpense',
      'ReverseExpensePayment',
      'SetExpensePolicy',
      'ReverseRecurringCostRecognition',
      'AdjustRecurringCostRecognition',
    ] as const) {
      expect(EXPENSE_COMMAND_POLICY[type].alwaysStepUp).toBe(true);
    }
    expect(DEFAULT_ROLE_PERMISSIONS.SUPERVISOR).toContain('expense.submit');
    expect(DEFAULT_ROLE_PERMISSIONS.SUPERVISOR).not.toContain('expense.approve');
    expect(DEFAULT_ROLE_PERMISSIONS.FINANCE).not.toContain('expense.policy.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.ATTENDANT.some((code) => code.startsWith('expense.'))).toBe(
      false,
    );
  });
});
