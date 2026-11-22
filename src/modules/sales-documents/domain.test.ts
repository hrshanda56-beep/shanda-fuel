import { describe, expect, it } from 'vitest';
import {
  computeDocumentTotals,
  formatDocumentNumber,
  invoiceBalance,
  lineGross,
  paymentState,
} from './domain';

describe('lineGross', () => {
  it('is quantity times price before discount, exact', () => {
    expect(lineGross('1000', '1.45')).toBe('1450.0000');
    expect(lineGross('0.1', '0.3')).toBe('0.0300');
  });
});

const line = (over: Partial<Parameters<typeof computeDocumentTotals>[0][number]> = {}) => ({
  quantity: '1',
  unitPrice: '0',
  discountAmount: '0',
  taxRate: '0',
  ...over,
});

describe('computeDocumentTotals', () => {
  it('adds up exactly without floating point drift', () => {
    const totals = computeDocumentTotals([
      line({ quantity: '3', unitPrice: '0.1' }),
      line({ quantity: '3', unitPrice: '0.2' }),
    ]);
    expect(totals.subtotal).toBe('0.9000');
    expect(totals.total).toBe('0.9000');
  });

  it('takes the discount off before working out tax', () => {
    const totals = computeDocumentTotals([
      line({ quantity: '10', unitPrice: '12.50', discountAmount: '25', taxRate: '15' }),
    ]);
    // gross 125, discount 25, net 100, tax 15
    expect(totals.lines[0]).toEqual({
      netAmount: '100.0000',
      taxAmount: '15.0000',
      lineTotal: '115.0000',
    });
    expect(totals).toMatchObject({
      subtotal: '125.0000',
      discountTotal: '25.0000',
      taxTotal: '15.0000',
      total: '115.0000',
    });
  });

  it('rounds each line once so the printed lines add up to the total', () => {
    const totals = computeDocumentTotals([
      line({ quantity: '1', unitPrice: '0.33335', taxRate: '15' }),
      line({ quantity: '1', unitPrice: '0.33335', taxRate: '15' }),
    ]);
    const sum = totals.lines.reduce((acc, l) => acc + Number(l.lineTotal) * 10000, 0);
    expect(sum / 10000).toBeCloseTo(Number(totals.total), 4);
  });

  it('supports fractional quantities such as litres', () => {
    const totals = computeDocumentTotals([line({ quantity: '45.250', unitPrice: '1.543210' })]);
    // 45.25 x 1.54321 = 69.8302525, rounded once to four decimals
    expect(totals.total).toBe('69.8303');
  });

  it('works with no tax and no lines', () => {
    expect(computeDocumentTotals([]).total).toBe('0.0000');
    expect(computeDocumentTotals([line({ unitPrice: '5' })]).taxTotal).toBe('0.0000');
  });

  it('refuses a discount larger than the line and a tax rate out of range', () => {
    expect(() =>
      computeDocumentTotals([line({ unitPrice: '10', discountAmount: '10.01' })]),
    ).toThrow(/discount/);
    expect(() => computeDocumentTotals([line({ unitPrice: '10', taxRate: '101' })])).toThrow(
      /tax rate/,
    );
    expect(() => computeDocumentTotals([line({ unitPrice: '10', taxRate: '-1' })])).toThrow(
      /tax rate/,
    );
  });
});

describe('formatDocumentNumber', () => {
  it('pads the sequence and carries the year', () => {
    expect(formatDocumentNumber('QT', 2026, 7)).toBe('QT-2026-0007');
    expect(formatDocumentNumber('INV', 2027, 12345)).toBe('INV-2027-12345');
  });

  it('rejects unsafe prefixes and bad numbers', () => {
    expect(() => formatDocumentNumber('A B', 2026, 1)).toThrow();
    expect(() => formatDocumentNumber('', 2026, 1)).toThrow();
    expect(() => formatDocumentNumber('QT', 2026, 0)).toThrow();
    expect(() => formatDocumentNumber('QT', 1999, 1)).toThrow();
  });
});

describe('invoice payment state', () => {
  it('moves from unpaid to part paid to paid', () => {
    expect(paymentState('100.0000', [])).toBe('UNPAID');
    expect(paymentState('100.0000', ['40.0000'])).toBe('PART_PAID');
    expect(paymentState('100.0000', ['40.0000', '60.0000'])).toBe('PAID');
    expect(invoiceBalance('100.0000', ['40.0000'])).toBe('60.0000');
  });

  it('flags an overpayment instead of hiding it', () => {
    expect(paymentState('100.0000', ['100.0000', '0.0100'])).toBe('OVERPAID');
  });
});
