import { describe, expect, it } from 'vitest';
import { classifyDueDate, daysUntilDue, isOverdueStatus } from './due-status';

const today = '2026-10-21';

describe('classifyDueDate', () => {
  it.each([
    [null, 'NO_DUE_DATE'],
    ['2026-11-30', 'NOT_DUE'],
    ['2026-10-29', 'NOT_DUE'],
    ['2026-10-28', 'DUE_SOON'],
    ['2026-10-22', 'DUE_SOON'],
    ['2026-10-21', 'DUE_TODAY'],
    ['2026-10-20', 'OVERDUE_1_7'],
    ['2026-10-14', 'OVERDUE_1_7'],
    ['2026-10-13', 'OVERDUE_8_14'],
    ['2026-10-07', 'OVERDUE_8_14'],
    ['2026-10-06', 'OVERDUE_15_30'],
    ['2026-09-21', 'OVERDUE_15_30'],
    ['2026-09-20', 'OVERDUE_OVER_30'],
  ] as const)('classifies %s as %s', (due, expected) => {
    expect(classifyDueDate(due, today)).toBe(expected);
  });

  it('uses the configured due-soon window', () => {
    expect(classifyDueDate('2026-10-31', today, 14)).toBe('DUE_SOON');
    expect(classifyDueDate('2026-10-31', today, 7)).toBe('NOT_DUE');
  });

  it('counts calendar days across month and year ends', () => {
    expect(daysUntilDue('2027-01-02', '2026-12-30')).toBe(3);
    expect(daysUntilDue('2026-03-01', '2026-02-28')).toBe(1);
  });

  it('flags only late invoices as overdue and rejects malformed dates', () => {
    expect(isOverdueStatus('DUE_TODAY')).toBe(false);
    expect(isOverdueStatus('OVERDUE_15_30')).toBe(true);
    expect(() => classifyDueDate('21/10/2026', today)).toThrow('Expected a calendar date');
  });
});
