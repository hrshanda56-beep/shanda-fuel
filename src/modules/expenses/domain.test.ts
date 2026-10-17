import { describe, expect, it } from 'vitest';
import {
  assertExpenseTransition,
  calculateExpenseApproval,
  classifyExpense,
  validateExpense,
  validateExpenseApprovalPolicy,
} from './domain';

describe('expense domain rules', () => {
  const baseInput = {
    id: 'expense-1',
    tenantId: 'tenant-1',
    legalEntityId: 'legal-1',
    stationId: 'station-1',
    businessDate: '2026-10-17',
    description: 'Generator service',
    category: 'maintenance',
    amount: '125.0050',
    currency: 'USD' as const,
    classification: 'OPERATING_EXPENSE' as const,
    settlementSource: 'PAYABLE' as const,
  };

  it('validates and normalizes an exact expense without inventing tax fields', () => {
    const expense = validateExpense(baseInput);

    expect(expense).toMatchObject({
      id: 'expense-1',
      businessDate: '2026-10-17',
      description: 'Generator service',
      category: 'maintenance',
      classification: 'OPERATING_EXPENSE',
      settlementSource: 'PAYABLE',
      state: 'DRAFT',
    });
    expect(expense.amount.amount.toString()).toBe('125.005');
    expect(expense).not.toHaveProperty('tax');
  });

  it('rejects missing scope/text, invalid dates, negative amounts, and excess money scale', () => {
    expect(() => validateExpense({ ...baseInput, tenantId: ' ' })).toThrow('Tenant id is required');
    expect(() => validateExpense({ ...baseInput, description: '' })).toThrow(
      'Expense description is required',
    );
    expect(() => validateExpense({ ...baseInput, businessDate: '2026-02-30' })).toThrow(
      'Expense business date must use YYYY-MM-DD',
    );
    expect(validateExpense({ ...baseInput, amount: '0' }).amount.amount.toString()).toBe('0');
    expect(() => validateExpense({ ...baseInput, amount: '-0.01' })).toThrow('cannot be negative');
    expect(() => validateExpense({ ...baseInput, amount: '1.00001' })).toThrow(
      'valid exact monetary amount',
    );
  });

  it('keeps economic classification separate from settlement source', () => {
    expect(
      classifyExpense({ classification: 'DIRECT_INVENTORY_COST', settlementSource: 'BANK' }),
    ).toEqual({
      classification: 'DIRECT_INVENTORY_COST',
      settlementSource: 'BANK',
      includedInOperatingExpenses: false,
      recognitionKind: 'DAILY_EXPENSE',
      economicBucket: 'INVENTORY_COST',
    });
    expect(
      classifyExpense({ classification: 'RECURRING_FIXED_COST', settlementSource: 'CASH' }),
    ).toMatchObject({
      includedInOperatingExpenses: true,
      recognitionKind: 'RECURRING_COST_RECOGNITION',
      economicBucket: 'OPERATING_EXPENSE',
      settlementSource: 'CASH',
    });
  });

  it('calculates approval requirements with exact inclusive thresholds', () => {
    const policy = {
      approvalRequired: true,
      stepUpThreshold: '250.00',
      secondApproverThreshold: '1000.00',
    } as const;

    expect(calculateExpenseApproval('249.9999', 'USD', policy)).toMatchObject({
      amount: '249.9999',
      approvalRequired: true,
      requiredApproverCount: 1,
      requiresStepUp: false,
    });
    expect(calculateExpenseApproval('250', 'USD', policy)).toMatchObject({
      requiredApproverCount: 1,
      requiresStepUp: true,
    });
    expect(calculateExpenseApproval('1000.0000', 'USD', policy)).toMatchObject({
      requiredApproverCount: 2,
      requiresStepUp: true,
      stepUpThreshold: '250',
      secondApproverThreshold: '1000',
    });
  });

  it('does not assume approval thresholds when policy disables approval', () => {
    expect(calculateExpenseApproval('999999.9999', 'USD', { approvalRequired: false })).toEqual({
      amount: '999999.9999',
      approvalRequired: false,
      requiredApproverCount: 0,
      requiresStepUp: false,
    });
    expect(() =>
      validateExpenseApprovalPolicy({ approvalRequired: false, stepUpThreshold: '1' }),
    ).toThrow('thresholds cannot be configured');
  });

  it('rejects invalid approval thresholds without rounding them', () => {
    expect(() =>
      validateExpenseApprovalPolicy({ approvalRequired: true, stepUpThreshold: '-0.01' }),
    ).toThrow('cannot be negative');
    expect(() => calculateExpenseApproval('10.00001', 'USD', { approvalRequired: true })).toThrow(
      'valid exact monetary amount',
    );
  });

  it('enforces named approval, correction, posting, and reversal transitions', () => {
    expect(() => assertExpenseTransition('DRAFT', 'APPROVED')).toThrow(
      'cannot transition from DRAFT',
    );
    expect(() => assertExpenseTransition('SUBMITTED', 'RETURNED')).not.toThrow();
    expect(() => assertExpenseTransition('RETURNED', 'SUBMITTED')).not.toThrow();
    expect(() => assertExpenseTransition('APPROVED', 'POSTED')).not.toThrow();
    expect(() => assertExpenseTransition('POSTED', 'REVERSED')).not.toThrow();
    expect(() => assertExpenseTransition('POSTED', 'DRAFT')).toThrow(
      'cannot transition from POSTED',
    );
  });
});
