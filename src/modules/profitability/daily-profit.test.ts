import { describe, expect, it } from 'vitest';
import { buildDailyProfit, profitSign } from './daily-profit';

const diesel = { productId: 'p-d', productCode: 'DIESEL', productName: 'Diesel' };
const petrol = { productId: 'p-p', productCode: 'PETROL', productName: 'Petrol' };
const sale = (date: string, fuel: typeof diesel, revenue: string, litres: string) => ({
  businessDate: date,
  ...fuel,
  recognizedRevenue: revenue,
  quantityLitres: litres,
});
const cost = (date: string, fuel: typeof diesel, cogs: string | null) => ({
  businessDate: date,
  productId: fuel.productId,
  restatedCogs: cogs,
  valuationStatus: cogs === null ? 'UNVALUED' : 'VALUED',
});

describe('buildDailyProfit', () => {
  const summary = buildDailyProfit({
    sales: [
      sale('2026-10-01', diesel, '1000.1000', '500.000'),
      sale('2026-10-01', petrol, '600.0000', '300.000'),
      sale('2026-10-02', diesel, '200.0000', '100.000'),
    ],
    costs: [
      cost('2026-10-01', diesel, '900.0500'),
      cost('2026-10-01', petrol, '550.0000'),
      cost('2026-10-02', diesel, '190.0000'),
    ],
    expenses: [
      { businessDate: '2026-10-01', classification: 'OPERATING', amount: '20.0000' },
      { businessDate: '2026-10-01', classification: 'FIXED_COST', amount: '33.3333' },
      { businessDate: '2026-10-02', classification: 'FIXED_COST', amount: '33.3334' },
      { businessDate: '2026-10-03', classification: 'FIXED_COST', amount: '33.3333' },
      { businessDate: '2026-10-01', classification: 'DIRECT_INVENTORY_COST', amount: '999.0000' },
    ],
    fuelBenefitByDate: [{ businessDate: '2026-10-02', amount: '5.0000' }],
  });

  it('splits gross profit per fuel with exact decimals and per litre', () => {
    const day = summary.days[0]!;
    expect(day.date).toBe('2026-10-01');
    const d = day.fuels.find((f) => f.productCode === 'DIESEL')!;
    expect(d.costOfFuelSold).toBe('900.0500');
    expect(d.grossProfit).toBe('100.0500');
    expect(d.grossProfitPerLitre).toBe('0.200100');
    expect(day.fuels.find((f) => f.productCode === 'PETROL')!.grossProfit).toBe('50.0000');
  });

  it('takes expenses and daily fixed costs off gross profit for operating profit', () => {
    const day = summary.days[0]!.combined;
    expect(day.grossProfit).toBe('150.0500');
    expect(day.expenses).toBe('20.0000');
    expect(day.fixedCosts).toBe('33.3333');
    expect(day.operatingProfit).toBe('96.7167');
  });

  it('keeps days that only have fixed cost and shows them as a loss', () => {
    const quiet = summary.days.find((d) => d.date === '2026-10-03')!;
    expect(quiet.fuels).toEqual([]);
    expect(quiet.combined.sales).toBe('0.0000');
    expect(quiet.combined.operatingProfit).toBe('-33.3333');
    expect(profitSign(quiet.combined.operatingProfit)).toBe('LOSS');
  });

  it('never counts direct inventory cost twice and ties the period to the days', () => {
    expect(summary.combined.expenses).toBe('20.0000');
    expect(summary.combined.fixedCosts).toBe('100.0000');
    expect(summary.combined.grossProfit).toBe('160.0500');
    expect(summary.combined.operatingProfit).toBe('35.0500');
    expect(summary.operatingProfitAfterBenefit).toBe('35.0500');
    expect(summary.fuelBenefit).toBe('5.0000');
  });

  it('posts staff fuel on the day it was issued, so the days add up to the period', () => {
    const second = summary.days.find((d) => d.date === '2026-10-02')!.combined;
    expect(second.fuelBenefit).toBe('5.0000');
    expect(second.operatingProfit).toBe('-28.3334');
    expect(summary.days[0]!.combined.fuelBenefit).toBe('0.0000');
    const total = summary.days.reduce((sum, day) => sum + Number(day.combined.operatingProfit), 0);
    expect(total.toFixed(4)).toBe(summary.combined.operatingProfit);
  });

  it('keeps a day that only has staff fuel, as a loss', () => {
    const result = buildDailyProfit({
      sales: [],
      costs: [],
      expenses: [],
      fuelBenefitByDate: [{ businessDate: '2026-10-05', amount: '12.5000' }],
    });
    expect(result.days).toHaveLength(1);
    expect(result.days[0]!.combined.operatingProfit).toBe('-12.5000');
    expect(result.fuelBenefit).toBe('12.5000');
  });

  it('shows unknown, not zero, when a sale has no cost yet', () => {
    const result = buildDailyProfit({
      sales: [sale('2026-10-01', diesel, '10.0000', '5.000')],
      costs: [cost('2026-10-01', diesel, null)],
      expenses: [{ businessDate: '2026-10-01', classification: 'OPERATING', amount: '1.0000' }],
    });
    expect(result.fuels[0]!.grossProfit).toBeNull();
    expect(result.combined.operatingProfit).toBeNull();
    expect(result.operatingProfitAfterBenefit).toBeNull();
    expect(profitSign(result.combined.operatingProfit)).toBe('UNKNOWN');
  });

  it('treats sales with no cost record at all as unvalued', () => {
    const result = buildDailyProfit({
      sales: [sale('2026-10-01', diesel, '10.0000', '5.000')],
      costs: [],
      expenses: [],
    });
    expect(result.combined.grossProfit).toBeNull();
    expect(result.fuels[0]!.unvaluedSaleCount).toBe(1);
  });

  it('has no per-litre figure when no litres were sold', () => {
    const result = buildDailyProfit({ sales: [], costs: [], expenses: [] });
    expect(result.days).toEqual([]);
    expect(result.combined.grossProfitPerLitre).toBeNull();
    expect(result.combined.operatingProfit).toBe('0.0000');
    expect(profitSign('0.0000')).toBe('BREAK_EVEN');
    expect(profitSign('1.0000')).toBe('PROFIT');
  });
});
