import { describe, expect, it } from 'vitest';
import {
  buildDailyReport,
  formatDailyReportText,
  plainAmount,
  type DailyReportInput,
} from './daily-report-model';

const reading = (
  productId: string,
  productName: string,
  pumpNumber: string,
  nozzleNumber: string,
  openingReading: string,
  closingReading: string,
  litresSold: string,
  unitPrice = '2.06',
) => ({
  pumpNumber,
  nozzleNumber,
  productId,
  productName,
  openingReading,
  closingReading,
  litresSold,
  unitPrice,
  salesValue: '0.0000',
});

const base: DailyReportInput = {
  stationName: 'Test station',
  timezone: 'Africa/Harare',
  businessDate: '2026-10-21',
  state: 'APPROVED',
  shiftStartAt: null,
  shiftEndAt: null,
  supervisorName: 'Leon',
  attendantNames: ['Judie', 'Mugabe'],
  readings: [
    reading('p', 'Petrol', '1', 'B', '115125.51', '115983.42', '857.91'),
    reading('p', 'Petrol', '1', 'A', '39414.08', '40135.85', '721.77'),
    reading('d', 'Diesel', '2', 'A', '229387.82', '230170.28', '782.45'),
    reading('d', 'Diesel', '2', 'B', '97632.26', '99391.38', '1759.12'),
  ],
  expenses: [
    { category: 'Food', description: '', amount: '6.00', paymentMethod: 'CASH' },
    { category: 'Transport', description: '', amount: '15.00', paymentMethod: 'CASH' },
  ],
  dips: [
    {
      tankCode: 'P1',
      productName: 'Petrol',
      measuredAt: '2026-10-21T16:00:00.000Z',
      rawMeasurement: '936',
      measurementUnit: 'mm',
      physicalLitres: '5794.000',
    },
    {
      tankCode: 'P1',
      productName: 'Petrol',
      measuredAt: '2026-10-21T04:00:00.000Z',
      rawMeasurement: '1186',
      measurementUnit: 'mm',
      physicalLitres: '7394.000',
    },
  ],
  cash: { countedCash: '5696.0000', netExpectedCash: '5700.0000', cashVariance: '-4.0000' },
  drops: [{ toLocation: 'Safe', amount: '2673.0000', state: 'ACCEPTED' }],
  monthToDate: { fromDate: '2026-10-01', products: [], expenses: '0', shifts: 0 },
};

describe('buildDailyReport', () => {
  const report = buildDailyReport(base);

  it('totals litres per product exactly, as in the client message', () => {
    expect(report.products.map((p) => [p.productName, p.totalLitres])).toEqual([
      ['Diesel', '2541.57'],
      ['Petrol', '1579.68'],
    ]);
  });

  it('orders pumps and pairs the earliest and latest dip as opening and closing', () => {
    expect(report.products[1]!.pumps.map((p) => p.label)).toEqual(['A1', 'B1']);
    expect(report.dips[0]).toMatchObject({
      tankCode: 'P1',
      opening: { measurement: '1186', litres: '7394.000' },
      closing: { measurement: '936', litres: '5794.000' },
    });
  });

  it('shows one dip as a single reading rather than inventing an opening', () => {
    const single = buildDailyReport({ ...base, dips: [base.dips[0]!] });
    expect(single.dips[0]!.opening).toBeNull();
  });

  it('totals expenses and drops, and reports none as null, never zero', () => {
    expect(report.expenses.total).toBe('21.00');
    expect(report.drops.total).toBe('2673.00');
    const empty = buildDailyReport({ ...base, expenses: [], drops: [] });
    expect(empty.expenses.total).toBeNull();
    expect(empty.drops.total).toBeNull();
  });

  it('lists every distinct price when pumps sold at different prices', () => {
    const mixed = buildDailyReport({
      ...base,
      readings: [
        reading('p', 'Petrol', '1', 'A', '0', '10', '10', '2.06'),
        reading('p', 'Petrol', '1', 'B', '0', '10', '10', '2.10'),
      ],
    });
    expect(mixed.products[0]!.prices).toEqual(['2.06', '2.10']);
  });
});

describe('formatDailyReportText', () => {
  it('writes the totals, cash, dips and people in the WhatsApp layout', () => {
    const text = formatDailyReportText(buildDailyReport(base));
    expect(text).toContain('PETROL SALES');
    expect(text).toContain('Total litres sold: 1579.68');
    expect(text).toContain('Total litres sold: 2541.57');
    expect(text).toContain('Drop: 2673.00');
    expect(text).toContain('Excess/Shortfall: -4.00');
    expect(text).toContain('Opening: 1186mm-7394.00Ltr');
    expect(text).toContain('Attendants: Judie, Mugabe');
    expect(text).toContain('Supervisor: Leon');
  });

  it('says so when nothing was counted instead of printing zero', () => {
    const text = formatDailyReportText(
      buildDailyReport({ ...base, cash: null, drops: [], dips: [] }),
    );
    expect(text).toContain('Available cash: not counted');
    expect(text).toContain('Drop: none recorded');
  });
});

describe('plainAmount', () => {
  it('keeps cents, drops extra zeros and never rounds', () => {
    expect(plainAmount('1560.0000')).toBe('1560.00');
    expect(plainAmount('1.600000')).toBe('1.60');
    expect(plainAmount('-5.0000')).toBe('-5.00');
    expect(plainAmount('12')).toBe('12.00');
    expect(plainAmount('0.12345')).toBe('0.12345');
    expect(plainAmount('n/a')).toBe('n/a');
  });
});
