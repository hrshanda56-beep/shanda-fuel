import { describe, expect, it } from 'vitest';
import {
  addDays,
  businessToday,
  isReportPeriod,
  isValidDateOnly,
  resolvePeriod,
  subtractMonths,
} from './period';

describe('report periods', () => {
  it('resolves this month from the first of the month to today', () => {
    expect(resolvePeriod('this-month', '2026-10-08')).toEqual({
      period: 'this-month',
      fromDate: '2026-10-01',
      toDate: '2026-10-08',
    });
  });

  it('resolves last month to the whole previous month, across a year boundary', () => {
    expect(resolvePeriod('last-month', '2026-10-08')).toMatchObject({
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });
    expect(resolvePeriod('last-month', '2026-01-15')).toMatchObject({
      fromDate: '2025-12-01',
      toDate: '2025-12-31',
    });
    expect(resolvePeriod('last-month', '2024-03-31')).toMatchObject({
      fromDate: '2024-02-01',
      toDate: '2024-02-29',
    });
  });

  it('resolves rolling periods to the day after the same date N months ago', () => {
    expect(resolvePeriod('3m', '2026-10-08')).toMatchObject({
      fromDate: '2026-07-09',
      toDate: '2026-10-08',
    });
    expect(resolvePeriod('12m', '2026-10-08')).toMatchObject({ fromDate: '2025-10-09' });
    expect(resolvePeriod('6m', '2026-03-31')).toMatchObject({ fromDate: '2025-10-01' });
  });

  it('clamps month arithmetic to shorter months', () => {
    expect(subtractMonths('2026-03-31', 1)).toBe('2026-02-28');
    expect(subtractMonths('2024-03-31', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('accepts a valid custom range and rejects incomplete or inverted ones', () => {
    expect(
      resolvePeriod('custom', '2026-10-08', { fromDate: '2026-08-01', toDate: '2026-08-31' }),
    ).toEqual({ period: 'custom', fromDate: '2026-08-01', toDate: '2026-08-31' });
    expect(resolvePeriod('custom', '2026-10-08')).toBeNull();
    expect(resolvePeriod('custom', '2026-10-08', { fromDate: '2026-08-01' })).toBeNull();
    expect(
      resolvePeriod('custom', '2026-10-08', { fromDate: '2026-09-02', toDate: '2026-09-01' }),
    ).toBeNull();
    expect(
      resolvePeriod('custom', '2026-10-08', { fromDate: '2026-02-30', toDate: '2026-03-01' }),
    ).toBeNull();
  });

  it('validates periods and dates', () => {
    expect(isReportPeriod('3m')).toBe(true);
    expect(isReportPeriod('weekly')).toBe(false);
    expect(isValidDateOnly('2026-02-29')).toBe(false);
    expect(isValidDateOnly('2024-02-29')).toBe(true);
  });

  it('uses the Harare calendar date, not UTC', () => {
    expect(businessToday(new Date('2026-10-08T23:30:00Z'))).toBe('2026-10-09');
  });
});
