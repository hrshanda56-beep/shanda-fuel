import { describe, expect, it } from 'vitest';
import {
  allocateFixedCosts,
  fixedCostAmountForDate,
  fixedCostIsActiveOnDate,
} from './fixed-cost-allocation';

function sum(values: readonly string[]): string {
  return values.reduce((total, value) => total + BigInt(value.replace('.', '')), 0n).toString();
}

describe('allocateFixedCosts: one rule for every screen (B6)', () => {
  const rent = {
    id: 't-rent',
    stationId: 's1',
    amount: '3100.0000',
    startDate: '2026-10-15',
    endDate: null,
  };

  it('allocates monthly ÷ days in the month for each active day, from the start date', () => {
    const rows = allocateFixedCosts([rent], new Set(), '2026-10-01', '2026-10-31');
    expect(rows).toHaveLength(17);
    expect(rows[0]).toEqual({
      templateId: 't-rent',
      stationId: 's1',
      businessDate: '2026-10-15',
      amount: '100.0000',
    });
    expect(rows.every((row) => row.businessDate >= '2026-10-15')).toBe(true);
  });

  it('uses each month’s own length across a month end', () => {
    const rows = allocateFixedCosts([rent], new Set(), '2026-10-31', '2026-11-01');
    expect(rows.map((row) => [row.businessDate, row.amount])).toEqual([
      ['2026-10-31', '100.0000'],
      ['2026-11-01', '103.3333'],
    ]);
  });

  it('stops at the end date and never goes outside the window asked for', () => {
    const ended = { ...rent, endDate: '2026-10-17' };
    expect(
      allocateFixedCosts([ended], new Set(), '2026-10-16', '2026-10-31').map((r) => r.businessDate),
    ).toEqual(['2026-10-16', '2026-10-17']);
  });

  it('skips a day that already has a recorded recognition for the same cost', () => {
    const rows = allocateFixedCosts(
      [rent],
      new Set(['s1:2026-10-16:t-rent']),
      '2026-10-15',
      '2026-10-17',
    );
    expect(rows.map((row) => row.businessDate)).toEqual(['2026-10-15', '2026-10-17']);
  });

  it('adds up to the monthly amount over a whole active month', () => {
    const full = { ...rent, startDate: '2026-10-01' };
    const total = allocateFixedCosts([full], new Set(), '2026-10-01', '2026-10-31').reduce(
      (sum, row) => sum + BigInt(row.amount.replace('.', '')),
      0n,
    );
    expect(total).toBe(31000000n);
  });
});

describe('automatic fixed-cost allocation', () => {
  it('uses the calendar month length and preserves the configured amount', () => {
    for (const [month, days] of [
      ['2026-02', 28],
      ['2028-02', 29],
      ['2026-04', 30],
      ['2026-10', 31],
    ] as const) {
      const values = Array.from({ length: days }, (_, index) =>
        fixedCostAmountForDate('1000.0000', `${month}-${String(index + 1).padStart(2, '0')}`),
      );
      expect(sum(values)).toBe('10000000');
    }
  });

  it('charges a mid-month cost only on active dates', () => {
    expect(fixedCostIsActiveOnDate('2026-10-14', '2026-10-15', null)).toBe(false);
    expect(fixedCostIsActiveOnDate('2026-10-15', '2026-10-15', '2026-10-20')).toBe(true);
    expect(fixedCostIsActiveOnDate('2026-10-21', '2026-10-15', '2026-10-20')).toBe(false);
  });
});
