import { describe, expect, it } from 'vitest';
import {
  categoryCodeFromName,
  categoryShares,
  formatFriendlyDate,
  friendlyError,
  inPeriod,
  isStepUpMessage,
  matchesFilter,
  matchesSearch,
  monthRange,
  monthTitle,
  parseAmount,
  periodRange,
  statusView,
  type ExpenseRow,
} from './expense-format';

const base: ExpenseRow = {
  expenseId: 'e1',
  stationId: 's1',
  category: { id: 'c1', code: 'REPAIRS', name: 'Repairs' },
  expenseDate: '2026-10-05',
  description: 'Pump hose',
  payee: 'Hardware Hut',
  reference: 'R-9',
  amount: '40.0000',
  state: 'SUBMITTED',
  version: 1,
  requiredApprovals: 1,
  approvals: 0,
  submittedAt: '2026-10-05T08:00:00Z',
  rejectionReason: null,
  reversalReason: null,
  settledAmount: '0.0000',
  outstanding: null,
  paymentStatus: null,
};

describe('statusView', () => {
  it('uses everyday words and never the stored state names', () => {
    expect(statusView(base).label).toBe('Waiting for approval');
    expect(statusView({ ...base, requiredApprovals: 2, approvals: 1 }).label).toBe(
      'Waiting for approval (1 of 2)',
    );
    expect(statusView({ ...base, state: 'APPROVED' }).label).toBe('Approved, ready to record');
    expect(statusView({ ...base, state: 'REVERSED' }).label).toBe('Cancelled');
    expect(statusView({ ...base, state: 'POSTED', paymentStatus: 'UNPAID' }).label).toBe(
      'Not paid yet',
    );
    expect(statusView({ ...base, state: 'POSTED', paymentStatus: 'PARTIALLY_PAID' }).label).toBe(
      'Partly paid',
    );
    expect(statusView({ ...base, state: 'POSTED', paymentStatus: 'PAID' }).label).toBe('Paid');
  });
});

describe('filters and search', () => {
  it('groups rows by what the person needs to do', () => {
    const posted = { ...base, state: 'POSTED', paymentStatus: 'UNPAID' };
    expect(matchesFilter(base, 'waiting')).toBe(true);
    expect(matchesFilter(posted, 'unpaid')).toBe(true);
    expect(matchesFilter({ ...posted, paymentStatus: 'PARTIALLY_PAID' }, 'unpaid')).toBe(true);
    expect(matchesFilter({ ...posted, paymentStatus: 'PAID' }, 'paid')).toBe(true);
    expect(matchesFilter({ ...base, state: 'REJECTED' }, 'closed')).toBe(true);
    expect(matchesFilter({ ...base, state: 'APPROVED' }, 'ready')).toBe(true);
    expect(matchesFilter(base, 'paid')).toBe(false);
  });

  it('searches description, payee, category and receipt number', () => {
    expect(matchesSearch(base, 'hose')).toBe(true);
    expect(matchesSearch(base, 'HUT')).toBe(true);
    expect(matchesSearch(base, 'repairs')).toBe(true);
    expect(matchesSearch(base, 'r-9')).toBe(true);
    expect(matchesSearch(base, 'diesel')).toBe(false);
    expect(matchesSearch(base, '  ')).toBe(true);
  });
});

describe('dates', () => {
  it('computes month ranges including leap years and year boundaries', () => {
    expect(monthRange('2026-10-19')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('2026-01-15', 'last')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('2026-10-19', 'all')).toBeNull();
    expect(inPeriod('2026-10-05', periodRange('2026-10-19', 'month'))).toBe(true);
    expect(inPeriod('2026-09-30', periodRange('2026-10-19', 'month'))).toBe(false);
  });

  it('formats friendly dates', () => {
    expect(formatFriendlyDate('2026-10-05')).toBe('5 Oct 2026');
    expect(formatFriendlyDate('2026-10-05T08:00:00Z')).toBe('5 Oct 2026');
    expect(formatFriendlyDate(null)).toBe('—');
    expect(monthTitle('2026-10-01')).toBe('October 2026');
  });
});

describe('amount and category helpers', () => {
  it('accepts positive amounts with at most two decimals', () => {
    expect(parseAmount('25.50')).toBe('25.50');
    expect(parseAmount('1,250')).toBe('1250');
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('0.00')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('makes a code from a category name', () => {
    expect(categoryCodeFromName('Staff meals & tea')).toBe('STAFF_MEALS_TEA');
    expect(categoryCodeFromName('  ')).toBeNull();
  });

  it('adds category totals exactly and sorts biggest first', () => {
    const result = categoryShares([
      { categoryId: 'a', name: 'Repairs', amount: '0.1000' },
      { categoryId: 'a', name: 'Repairs', amount: '0.2000' },
      { categoryId: 'b', name: 'Tea', amount: '0.9000' },
      { categoryId: 'c', name: 'Zero', amount: '0.0000' },
    ]);
    expect(result.total).toBe('1.2000');
    expect(result.shares.map((row) => row.name)).toEqual(['Tea', 'Repairs']);
    expect(result.shares[1]?.amount).toBe('0.3000');
  });
});

describe('friendlyError', () => {
  it('rewrites known server messages', () => {
    expect(friendlyError('The expense changed since it was loaded; reload and retry', 'x')).toMatch(
      /Someone changed this expense/,
    );
    expect(
      friendlyError('The settlement exceeds the outstanding balance of this obligation', 'x'),
    ).toBe('That is more than what is still owed on this expense.');
    expect(friendlyError('', 'Could not save')).toBe('Could not save');
    expect(friendlyError('Something odd', 'x')).toBe('Something odd');
  });

  it('recognises step-up requests', () => {
    expect(isStepUpMessage('Reverse requires a recent strong-authentication step-up')).toBe(true);
    expect(isStepUpMessage('Amount is wrong')).toBe(false);
  });
});
