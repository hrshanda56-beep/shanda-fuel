import { describe, expect, it } from 'vitest';
import { addDaysToDate, calculateDueDate, resolveCreditTerms } from './credit-terms';

const base = { documentType: 'INVOICE', documentDate: '2026-10-23' } as const;

describe('calculateDueDate', () => {
  it('adds days across month, year and leap boundaries', () => {
    expect(calculateDueDate('2026-10-23', 30)).toBe('2026-11-22');
    expect(calculateDueDate('2026-12-20', 14)).toBe('2027-01-03');
    expect(calculateDueDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(calculateDueDate('2027-02-28', 1)).toBe('2027-03-01');
    expect(calculateDueDate('2026-10-23', 0)).toBe('2026-10-23');
  });
  it('rejects unusable periods and dates', () => {
    expect(() => calculateDueDate('2026-10-23', -1)).toThrow(/whole number/);
    expect(() => calculateDueDate('2026-10-23', 1.5)).toThrow(/whole number/);
    expect(() => calculateDueDate('2026-10-23', 366)).toThrow(/whole number/);
    expect(() => addDaysToDate('2026-02-30', 1)).toThrow(/real calendar date/);
    expect(() => addDaysToDate('23/10/2026', 1)).toThrow(/YYYY-MM-DD/);
  });
});

describe('resolveCreditTerms', () => {
  it('refuses an invoice that does not say cash or credit', () => {
    expect(() => resolveCreditTerms(base)).toThrow(/Choose Cash or Credit/);
    expect(() => resolveCreditTerms({ ...base, dueDate: '2026-11-01' })).toThrow(
      /Choose Cash or Credit/,
    );
    expect(() => resolveCreditTerms({ ...base, creditPeriodDays: 30 })).toThrow(/Choose "Credit"/);
  });
  it('lets a credit note carry no terms', () => {
    expect(resolveCreditTerms({ documentType: 'CREDIT_NOTE', documentDate: '2026-10-23' })).toEqual(
      {
        paymentTerms: null,
        creditPeriodDays: null,
        dueDate: undefined,
      },
    );
  });
  it('calculates the due date for a credit purchase from its period', () => {
    expect(resolveCreditTerms({ ...base, paymentTerms: 'CREDIT', creditPeriodDays: 30 })).toEqual({
      paymentTerms: 'CREDIT',
      creditPeriodDays: 30,
      dueDate: '2026-11-22',
    });
  });
  it('accepts a matching typed due date and rejects a mismatching one', () => {
    expect(
      resolveCreditTerms({
        ...base,
        paymentTerms: 'CREDIT',
        creditPeriodDays: 7,
        dueDate: '2026-10-30',
      }).dueDate,
    ).toBe('2026-10-30');
    expect(() =>
      resolveCreditTerms({
        ...base,
        paymentTerms: 'CREDIT',
        creditPeriodDays: 7,
        dueDate: '2026-11-30',
      }),
    ).toThrow(/does not match the credit period/);
  });
  it('requires a period or a due date on credit, and allows a due date alone', () => {
    expect(() => resolveCreditTerms({ ...base, paymentTerms: 'CREDIT' })).toThrow(
      /needs a credit period/,
    );
    expect(resolveCreditTerms({ ...base, paymentTerms: 'CREDIT', dueDate: '2026-11-05' })).toEqual({
      paymentTerms: 'CREDIT',
      creditPeriodDays: null,
      dueDate: '2026-11-05',
    });
  });
  it('treats cash as having no period or due date', () => {
    expect(resolveCreditTerms({ ...base, paymentTerms: 'CASH' })).toEqual({
      paymentTerms: 'CASH',
      creditPeriodDays: null,
      dueDate: undefined,
    });
    expect(() =>
      resolveCreditTerms({ ...base, paymentTerms: 'CASH', creditPeriodDays: 5 }),
    ).toThrow(/no credit period/);
    expect(() =>
      resolveCreditTerms({ ...base, paymentTerms: 'CASH', dueDate: '2026-11-05' }),
    ).toThrow(/no credit period/);
  });
  it('rejects unknown terms and terms on credit notes', () => {
    expect(() => resolveCreditTerms({ ...base, paymentTerms: 'LATER' })).toThrow(/Cash or Credit/);
    expect(() =>
      resolveCreditTerms({
        ...base,
        documentType: 'CREDIT_NOTE',
        paymentTerms: 'CREDIT',
        creditPeriodDays: 3,
      }),
    ).toThrow(/not credit notes/);
  });
});
