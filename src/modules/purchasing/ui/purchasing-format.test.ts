import { describe, expect, it } from 'vitest';
import {
  amountAllowanceSentence,
  checkAllowanceInput,
  checkHeadline,
  checkOrderLines,
  coverageStatus,
  differenceText,
  litresAllowanceSentence,
  litresText,
  orderMatchesFilter,
  orderStatus,
  pricePerLitreText,
  totalOrderedLitres,
  vatModeText,
} from './purchasing-format';

describe('order wording', () => {
  it('uses everyday words for every status', () => {
    expect(orderStatus('SUBMITTED').label).toBe('Waiting for approval');
    expect(orderStatus('PARTIALLY_RECEIVED').label).toBe('Partly delivered');
    expect(orderStatus('APPROVED').label).not.toMatch(/_/);
  });
  it('groups statuses into plain filters', () => {
    expect(orderMatchesFilter('DRAFT', 'waiting')).toBe(true);
    expect(orderMatchesFilter('APPROVED', 'open')).toBe(true);
    expect(orderMatchesFilter('CANCELLED', 'finished')).toBe(true);
    expect(orderMatchesFilter('CANCELLED', 'open')).toBe(false);
  });
});

describe('number wording', () => {
  it('shows litres without trailing zeros', () => {
    expect(litresText('12000.000')).toBe('12,000 L');
    expect(litresText('1250.500')).toBe('1,250.5 L');
    expect(litresText(null)).toBe('—');
  });
  it('shows a per-litre price with at least two decimals', () => {
    expect(pricePerLitreText('1.45000000')).toBe('USD 1.45 per litre');
    expect(pricePerLitreText('1.4512500')).toBe('USD 1.4513 per litre');
    expect(pricePerLitreText(null)).toBe('No price set');
  });
  it('totals only active lines exactly', () => {
    expect(
      totalOrderedLitres([
        { orderedLitres: '0.100', status: 'ACTIVE' },
        { orderedLitres: '0.200', status: 'ACTIVE' },
        { orderedLitres: '5', status: 'REMOVED' },
      ]),
    ).toBe('0.300');
  });
  it('words differences', () => {
    expect(differenceText('70.000', 'litres')).toBe('70 L more');
    expect(differenceText('-0.070', 'price')).toBe('USD 0.07 less per litre');
    expect(differenceText('0.000', 'litres')).toBe('no difference');
  });
});

describe('invoice check wording', () => {
  it('names coverage in plain words', () => {
    expect(coverageStatus('UNBILLED').label).toBe('Not invoiced yet');
    expect(coverageStatus('OVER_BILLED').label).toBe('Invoiced for too much');
  });
  it('gives a clear headline per result', () => {
    expect(checkHeadline({ exceeded: true, invoicedLitres: '10' }).label).toBe('Needs a look');
    expect(checkHeadline({ exceeded: false, invoicedLitres: null }).label).toBe('No invoice yet');
    expect(checkHeadline({ exceeded: false, invoicedLitres: '10' }).label).toBe('Looks right');
  });
});

describe('settings wording and validation', () => {
  it('describes allowances and VAT', () => {
    expect(litresAllowanceSentence(null, null)).toBe('No difference allowed');
    expect(litresAllowanceSentence('50.000', '0.5000')).toBe('Up to 50 L or 0.5%');
    expect(amountAllowanceSentence('10.0000')).toBe('Up to USD 10');
    expect(vatModeText('NONE', null)).toBe('No VAT on supplier invoices');
    expect(vatModeText('EXCLUSIVE', '15')).toBe('Prices exclude VAT, 15% added on top');
  });
  it('accepts blank and plain numbers only', () => {
    expect(checkAllowanceInput('', 3)).toEqual({ ok: true, value: null });
    expect(checkAllowanceInput('1,250.5', 3)).toEqual({ ok: true, value: '1250.5' });
    expect(checkAllowanceInput('abc', 3)).toEqual({ ok: false });
    expect(checkAllowanceInput('1.23456', 4)).toEqual({ ok: false });
  });
});

describe('order line checks', () => {
  it('requires a fuel and litres', () => {
    expect(checkOrderLines([])).toMatchObject({ ok: false });
    expect(checkOrderLines([{ productId: '', litres: '10', price: '' }])).toMatchObject({
      ok: false,
      message: 'Choose the fuel.',
    });
    expect(checkOrderLines([{ productId: 'p', litres: '0', price: '' }])).toMatchObject({
      ok: false,
    });
  });
  it('returns exact strings and a null price when blank', () => {
    expect(
      checkOrderLines([{ productId: 'p', litres: '10,000', price: ' 1.45 ', lineId: 'l' }]),
    ).toEqual({
      ok: true,
      lines: [{ lineId: 'l', productId: 'p', orderedLitres: '10000', agreedUnitPrice: '1.45' }],
    });
    expect(checkOrderLines([{ productId: 'p', litres: '5', price: '' }])).toEqual({
      ok: true,
      lines: [{ productId: 'p', orderedLitres: '5', agreedUnitPrice: null }],
    });
  });
});
