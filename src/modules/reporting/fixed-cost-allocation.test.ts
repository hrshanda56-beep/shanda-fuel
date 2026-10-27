import { describe, expect, it } from 'vitest';
import { fixedCostAmountForDate, fixedCostIsActiveOnDate } from './fixed-cost-allocation';

function sum(values: readonly string[]): string {
  return values.reduce((total, value) => total + BigInt(value.replace('.', '')), 0n).toString();
}

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
