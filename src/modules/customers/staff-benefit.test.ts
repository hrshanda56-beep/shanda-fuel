import { describe, expect, it } from 'vitest';
import { ExactDecimal } from '../../platform/domain/primitives';
import {
  assertWithinStaffBenefitLimit,
  periodEnd,
  periodStart,
  staffBenefitPeriodSpend,
  staffBenefitUse,
  type StaffBenefitLine,
} from './staff-benefit';

const charge = (id: string, businessDate: string, amount: string): StaffBenefitLine => ({
  id,
  direction: 'INCREASE',
  entryType: 'CREDIT_FUEL_CHARGE',
  businessDate,
  amount,
});

describe('staff fuel benefit period', () => {
  it('uses the calendar month of the station business date', () => {
    expect(periodStart('2026-02-17')).toBe('2026-02-01');
    expect(periodEnd('2026-02-17')).toBe('2026-02-28');
    expect(periodEnd('2028-02-01')).toBe('2028-02-29');
  });

  it('counts only this month, exactly, and ignores payments', () => {
    const lines: StaffBenefitLine[] = [
      charge('a', '2026-09-30', '40.0000'),
      charge('b', '2026-10-01', '10.1000'),
      charge('c', '2026-10-20', '0.2000'),
      {
        id: 'p',
        direction: 'DECREASE',
        entryType: 'CUSTOMER_PAYMENT',
        businessDate: '2026-10-21',
        amount: '5',
      },
    ];
    expect(staffBenefitPeriodSpend(lines, '2026-10-22').toString()).toBe('10.3');
  });

  it('gives back a reversed charge', () => {
    const lines: StaffBenefitLine[] = [
      charge('a', '2026-10-02', '30'),
      charge('b', '2026-10-03', '20'),
      {
        id: 'r',
        direction: 'DECREASE',
        entryType: 'REVERSAL',
        businessDate: '2026-10-04',
        amount: '30',
        reversalOfEntryId: 'a',
      },
    ];
    expect(staffBenefitPeriodSpend(lines, '2026-10-05').toString()).toBe('20');
  });

  it('reports use and over-limit', () => {
    const use = staffBenefitUse('50', [charge('a', '2026-10-02', '50.0001')], '2026-10-05');
    expect(use).toMatchObject({
      limit: '50.0000',
      spent: '50.0001',
      remaining: '0.0000',
      over: true,
    });
    expect(staffBenefitUse('50', [], '2026-10-05')).toMatchObject({
      remaining: '50.0000',
      over: false,
    });
  });

  it('blocks a request past the limit, allows up to it', () => {
    const lines = [charge('a', '2026-10-02', '30')];
    const base = { limit: '50', lines, asAt: '2026-10-05', alreadyReserved: new ExactDecimal('5') };
    expect(() =>
      assertWithinStaffBenefitLimit({ ...base, requested: new ExactDecimal('15') }),
    ).not.toThrow();
    expect(() =>
      assertWithinStaffBenefitLimit({ ...base, requested: new ExactDecimal('15.0001') }),
    ).toThrow(/fuel benefit/);
  });
});
