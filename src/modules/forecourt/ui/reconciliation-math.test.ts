import { describe, expect, it } from 'vitest';

import { computeTotals, litresBetween } from './reconciliation-math';
import { evaluateSubmit } from './submit-rules';

describe('reconciliation maths', () => {
  it('works out litres only for ordered, valid readings', () => {
    expect(litresBetween('1000', '1100.5')?.toFixed(3)).toBe('100.500');
    expect(litresBetween('1000', '900')).toBeNull();
    expect(litresBetween('1000', '')).toBeNull();
  });

  it('totals sales, payments and cash the way the server does', () => {
    const totals = computeTotals({
      readings: [
        { openingReading: '0', closingReading: '100', unitPrice: '1.65' },
        { openingReading: '10', closingReading: '30', unitPrice: '1.55' },
      ],
      payments: [
        { method: 'CASH', amount: '100' },
        { method: 'ECOCASH', amount: '90' },
      ],
      expenses: [{ paymentMethod: 'CASH', amount: '5' }],
      countedCash: '90',
    });
    expect(totals.expectedSales.toFixed(2)).toBe('196.00');
    expect(totals.accountedSales.toFixed(2)).toBe('190.00');
    expect(totals.salesDifference.toFixed(2)).toBe('-6.00');
    expect(totals.cash.net.toFixed(2)).toBe('95.00');
    expect(totals.cash.difference?.toFixed(2)).toBe('-5.00');
  });

  it('leaves the cash difference empty until the cash is counted', () => {
    const totals = computeTotals({ readings: [], payments: [], expenses: [], countedCash: '' });
    expect(totals.cash.difference).toBeNull();
  });
});

describe('evaluateSubmit', () => {
  const ready = {
    shiftState: 'COMPLETED',
    readingsComplete: true,
    hasPayments: true,
    cashCounted: true,
    differences: { sales: false, cash: false, stock: false },
    explanations: {},
  };

  it('allows a complete, balanced reconciliation', () => {
    expect(evaluateSubmit(ready).canSubmit).toBe(true);
  });

  it('blocks submission while the shift is open, with the plain reason', () => {
    const result = evaluateSubmit({ ...ready, shiftState: 'OPEN' });
    expect(result.canSubmit).toBe(false);
    expect(result.blocked).toEqual({
      code: 'SHIFT_NOT_CLOSED',
      reason: 'Close the shift meters, then submit the figures.',
    });
  });

  it('needs a real explanation of at least ten characters for every difference', () => {
    const base = { ...ready, differences: { sales: false, cash: true, stock: false } };
    expect(evaluateSubmit({ ...base, explanations: { CASH: 'short' } }).blocked?.code).toBe(
      'DIFFERENCE_NOT_EXPLAINED',
    );
    expect(
      evaluateSubmit({ ...base, explanations: { CASH: 'Till was five dollars short' } }).canSubmit,
    ).toBe(true);
    const checks = evaluateSubmit({ ...base, explanations: {} }).checks;
    expect(checks.find((check) => check.id === 'differences')?.ok).toBe(false);
  });

  it('blocks submitting while offline', () => {
    expect(evaluateSubmit({ ...ready, offline: true }).blocked?.reason).toBe(
      'Connect to the internet to submit.',
    );
  });
});
