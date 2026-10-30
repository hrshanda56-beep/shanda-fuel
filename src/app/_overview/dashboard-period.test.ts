import { describe, expect, it } from 'vitest';
import { asAtLabel, resolveDashboardPeriod } from './dashboard-period';

// 2026-10-29 is a Thursday.
const TODAY = '2026-10-29';

describe('resolveDashboardPeriod (B1)', () => {
  it('defaults to today when nothing is chosen', () => {
    expect(resolveDashboardPeriod({}, TODAY)).toMatchObject({
      period: 'today',
      fromDate: TODAY,
      toDate: TODAY,
      phrase: 'today',
    });
  });

  it('this week runs from Monday to today', () => {
    expect(resolveDashboardPeriod({ period: 'week' }, TODAY)).toMatchObject({
      period: 'week',
      fromDate: '2026-10-26',
      toDate: TODAY,
      phrase: 'this week',
    });
    // On a Monday the week is just that day.
    expect(resolveDashboardPeriod({ period: 'week' }, '2026-10-26').fromDate).toBe('2026-10-26');
    // On a Sunday it reaches back to the Monday before.
    expect(resolveDashboardPeriod({ period: 'week' }, '2026-11-01').fromDate).toBe('2026-10-26');
  });

  it('this month runs from the 1st to today', () => {
    expect(resolveDashboardPeriod({ period: 'month' }, TODAY)).toMatchObject({
      fromDate: '2026-10-01',
      toDate: TODAY,
      phrase: 'this month',
    });
  });

  it('accepts a valid custom range and says it in words', () => {
    const result = resolveDashboardPeriod(
      { period: 'custom', fromDate: '2026-10-03', toDate: '2026-10-09' },
      TODAY,
    );
    expect(result).toMatchObject({
      period: 'custom',
      fromDate: '2026-10-03',
      toDate: '2026-10-09',
    });
    expect(result.phrase).toBe('03 Oct 2026 to 09 Oct 2026');
  });

  it('falls back to today for a custom range that is incomplete, backwards or not a date', () => {
    for (const bad of [
      { period: 'custom' },
      { period: 'custom', fromDate: '2026-10-09', toDate: '2026-10-03' },
      { period: 'custom', fromDate: 'nonsense', toDate: '2026-10-03' },
    ]) {
      expect(resolveDashboardPeriod(bad, TODAY)).toMatchObject({
        period: 'today',
        fromDate: TODAY,
      });
    }
  });

  it('never runs past today', () => {
    expect(
      resolveDashboardPeriod(
        { period: 'custom', fromDate: '2026-10-20', toDate: '2026-12-31' },
        TODAY,
      ).toDate,
    ).toBe(TODAY);
  });

  it('ignores an unknown period name', () => {
    expect(resolveDashboardPeriod({ period: 'forever' }, TODAY).period).toBe('today');
  });
});

describe('asAtLabel', () => {
  it('names the time in station time, for tiles that are a position and not a period', () => {
    expect(asAtLabel(new Date('2026-10-29T12:05:00Z'))).toBe('As at 14:05');
  });
});
