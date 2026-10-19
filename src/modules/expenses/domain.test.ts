import { describe, expect, it } from 'vitest';
import {
  assertApproverAllowed,
  assertCategoryUsableForExpense,
  assertExpenseTransition,
  assertPeriodWithinTemplate,
  assertRecognitionNotFuture,
  assertSettlementReference,
  assertSettlementWithinOutstanding,
  dailyRecognitionSchedule,
  expenseRequiresStepUp,
  monthPeriod,
  outstandingAmount,
  paymentStatus,
  positiveMoney,
  recognitionAmountForDate,
  requiredApprovals,
  sumMoney,
  validateExpensePolicy,
  validateExpenseSubmission,
  UNCONFIGURED_EXPENSE_POLICY,
  EXPENSE_STATES,
} from './domain';

const now = new Date('2026-10-18T10:00:00Z');

describe('expense state machine', () => {
  it('allows only the documented transitions', () => {
    assertExpenseTransition('SUBMITTED', 'APPROVED');
    assertExpenseTransition('SUBMITTED', 'REJECTED');
    assertExpenseTransition('APPROVED', 'POSTED');
    assertExpenseTransition('POSTED', 'REVERSED');
    const allowed = new Set([
      'SUBMITTED>APPROVED',
      'SUBMITTED>REJECTED',
      'APPROVED>POSTED',
      'POSTED>REVERSED',
    ]);
    for (const from of EXPENSE_STATES) {
      for (const to of EXPENSE_STATES) {
        if (allowed.has(`${from}>${to}`)) continue;
        expect(() => assertExpenseTransition(from, to)).toThrow();
      }
    }
  });

  it('treats rejected and reversed expenses as terminal', () => {
    expect(() => assertExpenseTransition('REJECTED', 'SUBMITTED')).toThrow();
    expect(() => assertExpenseTransition('REVERSED', 'POSTED')).toThrow();
  });
});

describe('expense validation', () => {
  it('accepts exact decimals and rejects zero, negative, over-precise and malformed money', () => {
    expect(positiveMoney('10.1000').amount.toString()).toBe('10.1');
    expect(() => positiveMoney('0')).toThrow(/greater than zero/);
    expect(() => positiveMoney('-1')).toThrow();
    expect(() => positiveMoney('1.00001')).toThrow();
    expect(() => positiveMoney('abc')).toThrow();
  });

  it('keeps 0.1 + 0.2 exact', () => {
    expect(sumMoney(['0.1', '0.2'])).toBe('0.3000');
    expect(outstandingAmount('100.0000', ['33.3333', '33.3333'])).toBe('33.3334');
  });

  it('validates submission fields and refuses future dates', () => {
    const ok = validateExpenseSubmission(
      { expenseDate: '2026-10-18', description: '  Cleaning  ', amount: '25.5', payee: ' ' },
      now,
    );
    expect(ok.description).toBe('Cleaning');
    expect(ok.payee).toBeNull();
    expect(() =>
      validateExpenseSubmission({ expenseDate: '2026-10-25', description: 'x', amount: '1' }, now),
    ).toThrow(/future/);
    expect(() =>
      validateExpenseSubmission({ expenseDate: '2026-02-30', description: 'x', amount: '1' }, now),
    ).toThrow(/valid/);
    expect(() =>
      validateExpenseSubmission({ expenseDate: '2026-10-18', description: ' ', amount: '1' }, now),
    ).toThrow(/description/);
  });

  it('never allows direct inventory cost as an expense and separates fixed costs', () => {
    expect(() => assertCategoryUsableForExpense('DIRECT_INVENTORY_COST', 'MANUAL_EXPENSE')).toThrow(
      /landed cost/,
    );
    expect(() =>
      assertCategoryUsableForExpense('DIRECT_INVENTORY_COST', 'RECURRING_COST'),
    ).toThrow();
    expect(() => assertCategoryUsableForExpense('FIXED_COST', 'MANUAL_EXPENSE')).toThrow();
    expect(() => assertCategoryUsableForExpense('OPERATING', 'RECURRING_COST')).toThrow();
    assertCategoryUsableForExpense('OPERATING', 'MANUAL_EXPENSE');
    assertCategoryUsableForExpense('FIXED_COST', 'RECURRING_COST');
  });
});

describe('expense approval policy', () => {
  it('fails closed when no policy is configured', () => {
    expect(expenseRequiresStepUp('0.0100', UNCONFIGURED_EXPENSE_POLICY)).toBe(true);
    expect(requiredApprovals('1000000', UNCONFIGURED_EXPENSE_POLICY)).toBe(1);
  });

  it('applies thresholds at or above the boundary using exact comparison', () => {
    const policy = validateExpensePolicy({
      stepUpThreshold: '250',
      secondApprovalThreshold: '1000',
    });
    expect(policy).toEqual({ stepUpThreshold: '250.0000', secondApprovalThreshold: '1000.0000' });
    expect(expenseRequiresStepUp('249.9999', policy)).toBe(false);
    expect(expenseRequiresStepUp('250.0000', policy)).toBe(true);
    expect(requiredApprovals('999.9999', policy)).toBe(1);
    expect(requiredApprovals('1000.0000', policy)).toBe(2);
  });

  it('rejects incoherent thresholds', () => {
    expect(() =>
      validateExpensePolicy({ stepUpThreshold: '500', secondApprovalThreshold: '100' }),
    ).toThrow();
    expect(() =>
      validateExpensePolicy({ stepUpThreshold: '-1', secondApprovalThreshold: null }),
    ).toThrow();
    expect(() =>
      validateExpensePolicy({ stepUpThreshold: null, secondApprovalThreshold: '0' }),
    ).toThrow();
    expect(() =>
      validateExpensePolicy({ stepUpThreshold: '1.00001', secondApprovalThreshold: null }),
    ).toThrow();
  });

  it('blocks self-approval unless nobody else could approve and blocks double decisions', () => {
    expect(() =>
      assertApproverAllowed({
        submitterMembershipId: 'a',
        approverMembershipId: 'a',
        alternateApproverExists: true,
        priorApproverIds: [],
      }),
    ).toThrow(/submitted it/);
    assertApproverAllowed({
      submitterMembershipId: 'a',
      approverMembershipId: 'a',
      alternateApproverExists: false,
      priorApproverIds: [],
    });
    expect(() =>
      assertApproverAllowed({
        submitterMembershipId: 'a',
        approverMembershipId: 'b',
        alternateApproverExists: true,
        priorApproverIds: ['b'],
      }),
    ).toThrow(/already decided/);
  });
});

describe('settlement is separate from recognition', () => {
  it('requires a reference and only lets cash link a cash movement', () => {
    expect(() => assertSettlementReference({ source: 'BANK' })).toThrow();
    expect(() =>
      assertSettlementReference({ source: 'BANK', cashMovementId: 'x', externalReference: 'r' }),
    ).toThrow();
    assertSettlementReference({ source: 'CASH', cashMovementId: 'x' });
    assertSettlementReference({ source: 'REIMBURSEMENT', externalReference: 'vch-1' });
  });

  it('caps settlements at the outstanding balance exactly', () => {
    assertSettlementWithinOutstanding('100.0000', ['60.0000'], '40.0000');
    expect(() => assertSettlementWithinOutstanding('100.0000', ['60.0000'], '40.0001')).toThrow(
      /exceeds/,
    );
  });

  it('derives payment status from recorded settlements only', () => {
    expect(paymentStatus('100.0000', [])).toBe('UNPAID');
    expect(paymentStatus('100.0000', ['0.0001'])).toBe('PARTIALLY_PAID');
    expect(paymentStatus('100.0000', ['60', '40'])).toBe('PAID');
  });
});

describe('recurring cost schedule', () => {
  it('builds calendar-month periods and rejects mid-month starts', () => {
    expect(monthPeriod('2026-02-01')).toEqual({ start: '2026-02-01', end: '2026-02-28', days: 28 });
    expect(monthPeriod('2028-02-01').days).toBe(29);
    expect(monthPeriod('2026-10-01').end).toBe('2026-10-31');
    expect(() => monthPeriod('2026-10-15')).toThrow(/first day/);
  });

  it('splits an obligation exactly with the remainder on the last day', () => {
    const schedule = dailyRecognitionSchedule('1000.0000', 30);
    expect(schedule).toHaveLength(30);
    expect(schedule[0]).toBe('33.3333');
    expect(schedule[29]).toBe('33.3343');
    expect(sumMoney(schedule)).toBe('1000.0000');
    expect(sumMoney(dailyRecognitionSchedule('0.0100', 31))).toBe('0.0100');
    expect(sumMoney(dailyRecognitionSchedule('1234.5678', 31))).toBe('1234.5678');
  });

  it('prices a recognition date from the schedule and rejects dates outside the period', () => {
    const period = monthPeriod('2026-06-01');
    expect(recognitionAmountForDate('300.0000', period, '2026-06-10')).toBe('10.0000');
    expect(() => recognitionAmountForDate('300.0000', period, '2026-07-01')).toThrow();
  });

  it('refuses to recognize future dates and out-of-template periods', () => {
    expect(() => assertRecognitionNotFuture('2026-10-19', now)).toThrow();
    assertRecognitionNotFuture('2026-10-18', now);
    const period = monthPeriod('2026-10-01');
    expect(() =>
      assertPeriodWithinTemplate(period, { startDate: '2026-11-01', endDate: null }),
    ).toThrow();
    expect(() =>
      assertPeriodWithinTemplate(period, { startDate: '2026-01-01', endDate: '2026-09-30' }),
    ).toThrow();
    assertPeriodWithinTemplate(period, { startDate: '2026-10-15', endDate: null });
  });
});
