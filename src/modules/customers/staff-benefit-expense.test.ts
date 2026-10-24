import { describe, expect, it } from 'vitest';
import {
  assertBenefitMonth,
  benefitMonthEnd,
  benefitMonthStart,
  computeBenefitCost,
  isBenefitMonthClosed,
  staffBenefitExpenseDescription,
  staffBenefitExpenseReference,
} from './staff-benefit-expense';

const fuel = (productId: string, litres: string, soldValue = '0') => ({
  productId,
  productName: productId === 'd' ? 'Diesel' : 'Petrol',
  litres,
  soldValue,
});

describe('staff benefit month', () => {
  it('works out month bounds, including leap years', () => {
    expect(benefitMonthStart('2026-10')).toBe('2026-10-01');
    expect(benefitMonthEnd('2026-10')).toBe('2026-10-31');
    expect(benefitMonthEnd('2028-02')).toBe('2028-02-29');
    expect(benefitMonthEnd('2026-02')).toBe('2026-02-28');
  });

  it('rejects anything but YYYY-MM', () => {
    for (const bad of ['2026-13', '2026-1', '2026-10-01', 'October', '']) {
      expect(() => assertBenefitMonth(bad)).toThrow();
    }
  });

  it('is closed only once the station date is past the month end', () => {
    expect(isBenefitMonthClosed('2026-10', '2026-10-31')).toBe(false);
    expect(isBenefitMonthClosed('2026-10', '2026-11-01')).toBe(true);
    expect(isBenefitMonthClosed('2026-10', '2026-09-30')).toBe(false);
  });

  it('builds a stable reference per account and month', () => {
    expect(staffBenefitExpenseReference('acc-1', '2026-10')).toBe('STAFF-BENEFIT:acc-1:2026-10');
    expect(staffBenefitExpenseReference('acc-1', '2026-10')).not.toBe(
      staffBenefitExpenseReference('acc-1', '2026-11'),
    );
    expect(staffBenefitExpenseDescription(' Tendai ', '2026-10')).toContain('Tendai, 2026-10');
  });
});

describe('computeBenefitCost', () => {
  it('values litres at the restated average cost, exactly', () => {
    const result = computeBenefitCost(
      [fuel('d', '40.000', '60.0000'), fuel('p', '10.500', '17.0000')],
      [
        { productId: 'd', costedLitres: '1000.000', cogs: '850.0000' },
        { productId: 'p', costedLitres: '300.000', cogs: '263.1000' },
      ],
    );
    expect(result).toEqual({
      status: 'READY',
      total: '43.2085',
      lines: [
        {
          productId: 'd',
          productName: 'Diesel',
          litres: '40.000',
          soldValue: '60.0000',
          costPerLitre: '0.85000000',
          cost: '34.0000',
        },
        {
          productId: 'p',
          productName: 'Petrol',
          litres: '10.500',
          soldValue: '17.0000',
          costPerLitre: '0.87700000',
          cost: '9.2085',
        },
      ],
    });
  });

  it('does not drift on thirds', () => {
    const result = computeBenefitCost(
      [fuel('d', '30.000')],
      [{ productId: 'd', costedLitres: '3.000', cogs: '10.0000' }],
    );
    // 10 / 3 = 3.33333333 a litre (8 decimals), times 30 litres = 99.9999999, rounded to money.
    expect(result).toMatchObject({ status: 'READY', total: '100.0000' });
  });

  it('says nothing was taken rather than posting zero', () => {
    expect(computeBenefitCost([], [])).toEqual({ status: 'NO_FUEL' });
    expect(computeBenefitCost([fuel('d', '0.000')], [])).toEqual({ status: 'NO_FUEL' });
  });

  it('is unavailable, naming the product, when there is no cost for it', () => {
    expect(
      computeBenefitCost(
        [fuel('d', '5.000'), fuel('p', '5.000')],
        [{ productId: 'd', costedLitres: '100.000', cogs: '90.0000' }],
      ),
    ).toEqual({ status: 'UNAVAILABLE', missing: ['Petrol'] });
    expect(
      computeBenefitCost(
        [fuel('d', '5.000')],
        [{ productId: 'd', costedLitres: '0.000', cogs: '0.0000' }],
      ),
    ).toEqual({ status: 'UNAVAILABLE', missing: ['Diesel'] });
  });
});
