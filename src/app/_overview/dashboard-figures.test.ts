import { describe, expect, it } from 'vitest';

import {
  chartBuckets,
  dailyTotals,
  litresSeries,
  axisLabels,
  plotValue,
  productTotals,
  signedLitres,
  signedMoney,
  varianceTone,
} from './dashboard-figures';

const row = (overrides: Partial<Parameters<typeof dailyTotals>[0][number]> = {}) => ({
  reportDate: '2026-10-11',
  stationId: 's1',
  litresSold: '578.125',
  salesValue: '1100.10',
  cashVariance: '-0.10',
  customerCreditEvidence: '20.00',
  prepaidEvidence: '5.05',
  reconciliationIds: ['r1'],
  ...overrides,
});

describe('dailyTotals', () => {
  it('is null without an approved report, never zero', () => {
    expect(dailyTotals([])).toBeNull();
  });

  it('ignores rows that only carry collections, deposits or dips', () => {
    const unapproved = row({ salesValue: '0', litresSold: '0', cashVariance: '0' });
    expect(dailyTotals([{ ...unapproved, reconciliationIds: [] }])).toBeNull();
    const totals = dailyTotals([
      row({ salesValue: '10', stationId: 's1' }),
      { ...row({ salesValue: '0', stationId: 's2' }), reconciliationIds: [] },
    ]);
    expect(totals).toMatchObject({ stationCount: 1, salesValue: '10' });
  });

  it('keeps an approved zero as zero and a shortage negative', () => {
    expect(dailyTotals([row({ cashVariance: '0.0000' })])?.cashVariance).toBe('0');
    expect(
      dailyTotals([
        row({ cashVariance: '-30.85' }),
        row({ stationId: 's2', cashVariance: '-0.15' }),
      ])?.cashVariance,
    ).toBe('-31');
  });

  it('sums stations with exact decimals', () => {
    const totals = dailyTotals([
      row(),
      row({ stationId: 's2', litresSold: '705.875', salesValue: '0.20', cashVariance: '0.30' }),
    ]);
    expect(totals).toMatchObject({
      stationCount: 2,
      litresSold: '1284',
      salesValue: '1100.3',
      cashVariance: '0.2',
      accountSales: '50.1',
    });
  });
});

describe('chartBuckets', () => {
  it('uses one bucket per day for 7D and 30D, ending today', () => {
    const week = chartBuckets('7D', '2026-10-11');
    expect(week.fromDate).toBe('2026-10-05');
    expect(week.buckets).toHaveLength(7);
    expect(week.buckets.at(-1)).toMatchObject({
      from: '2026-10-11',
      to: '2026-10-11',
      label: '11 Oct',
    });
    expect(chartBuckets('30D', '2026-10-11').buckets).toHaveLength(30);
  });

  it('groups 90D into 13 weeks and 12M into calendar months', () => {
    const quarter = chartBuckets('90D', '2026-10-11');
    expect(quarter.buckets).toHaveLength(13);
    expect(quarter.buckets.at(-1)?.to).toBe('2026-10-11');
    const year = chartBuckets('12M', '2026-10-11');
    expect(year.fromDate).toBe('2025-10-12');
    expect(year.buckets[0]).toMatchObject({ key: '2025-10', from: '2025-10-12', to: '2025-10-31' });
    expect(year.buckets.at(-1)).toMatchObject({
      key: '2026-10',
      from: '2026-10-01',
      to: '2026-10-11',
    });
    expect(year.buckets).toHaveLength(13);
  });
});

describe('litresSeries', () => {
  const buckets = chartBuckets('7D', '2026-10-11').buckets;
  const sales = [
    { businessDate: '2026-10-10', productName: 'Petrol', litres: '706' },
    { businessDate: '2026-10-10', productName: 'Diesel', litres: '578.5' },
    { businessDate: '2026-10-11', productName: 'Diesel', litres: '10' },
  ];

  it('leaves days without an approved report as gaps', () => {
    const series = litresSeries(sales, buckets);
    expect(series.slice(0, 5).every((point) => point.litres === null)).toBe(true);
    expect(series[5]).toMatchObject({
      litres: '1284.5',
      products: [
        { name: 'Diesel', litres: '578.5' },
        { name: 'Petrol', litres: '706' },
      ],
    });
  });

  it('totals each product over the range', () => {
    expect(productTotals(sales)).toEqual([
      { name: 'Diesel', litres: '588.5' },
      { name: 'Petrol', litres: '706' },
    ]);
  });
});

describe('small helpers', () => {
  it('keeps gaps as null and reads variance direction', () => {
    expect(plotValue(null)).toBeNull();
    expect(plotValue('12.5')).toBe(12.5);
    expect(varianceTone('0.00')).toBe('none');
    expect(varianceTone('-1')).toBe('short');
    expect(varianceTone('2')).toBe('over');
  });
});

describe('signed display', () => {
  it('puts the sign before the unit and leaves zero unsigned', () => {
    expect(signedMoney('-30.85')).toBe('−USD 30.85');
    expect(signedMoney('2')).toBe('+USD 2.00');
    expect(signedMoney('0.00')).toBe('USD 0.00');
    expect(signedLitres('-12.4')).toBe('−12 L');
    expect(signedLitres('1284.5')).toBe('+1,285 L');
  });

  it('thins axis labels evenly', () => {
    const labels = Array.from({ length: 30 }, (_, i) => String(i));
    expect(axisLabels(labels)).toEqual(['0', '6', '12', '17', '23', '29']);
    expect(axisLabels(['a', 'b'])).toEqual(['a', 'b']);
  });
});
