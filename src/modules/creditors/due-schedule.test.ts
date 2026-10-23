import { describe, expect, it } from 'vitest';
import { bucketForDueDate, buildDueSchedule, type DueInvoice } from './due-schedule';

const asOf = '2026-10-23';

function invoice(partial: Partial<DueInvoice> & Pick<DueInvoice, 'documentId'>): DueInvoice {
  return {
    supplierId: 's1',
    supplierName: 'Supplier One',
    referenceNumber: partial.documentId,
    documentDate: '2026-10-01',
    dueDate: null,
    paymentTerms: 'CREDIT',
    creditPeriodDays: null,
    balance: '10.0000',
    ...partial,
  };
}

describe('bucketForDueDate', () => {
  it('puts the edges in the right bucket', () => {
    expect(bucketForDueDate('2026-10-22', asOf)).toBe('OVERDUE');
    expect(bucketForDueDate('2026-10-23', asOf)).toBe('WITHIN_7');
    expect(bucketForDueDate('2026-10-30', asOf)).toBe('WITHIN_7');
    expect(bucketForDueDate('2026-10-31', asOf)).toBe('DAYS_8_TO_14');
    expect(bucketForDueDate('2026-11-06', asOf)).toBe('DAYS_8_TO_14');
    expect(bucketForDueDate('2026-11-07', asOf)).toBe('DAYS_15_TO_30');
    expect(bucketForDueDate('2026-11-22', asOf)).toBe('DAYS_15_TO_30');
    expect(bucketForDueDate('2026-11-23', asOf)).toBe('LATER');
    expect(bucketForDueDate(null, asOf)).toBe('NO_DUE_DATE');
  });
});

describe('buildDueSchedule', () => {
  it('sums exactly, sorts by due date and skips settled invoices', () => {
    const result = buildDueSchedule(
      [
        invoice({ documentId: 'b', dueDate: '2026-10-28', balance: '0.1000' }),
        invoice({ documentId: 'a', dueDate: '2026-10-25', balance: '0.2000' }),
        invoice({ documentId: 'late', dueDate: '2026-10-01', balance: '1234.5678' }),
        invoice({ documentId: 'paid', dueDate: '2026-10-25', balance: '0.0000' }),
        invoice({ documentId: 'open', dueDate: null, balance: '5.0000' }),
      ],
      asOf,
    );
    const by = Object.fromEntries(result.groups.map((g) => [g.bucket, g]));
    expect(by.WITHIN_7!.rows.map((r) => r.documentId)).toEqual(['a', 'b']);
    expect(by.WITHIN_7!.total).toBe('0.3000');
    expect(by.OVERDUE!.total).toBe('1234.5678');
    expect(by.OVERDUE!.rows[0]!.daysUntilDue).toBe(-22);
    expect(by.NO_DUE_DATE!.count).toBe(1);
    expect(result.total).toBe('1239.8678');
    expect(result.groups.flatMap((g) => g.rows)).toHaveLength(4);
  });

  it('returns every group, empty ones included, with zero totals', () => {
    const result = buildDueSchedule([], asOf);
    expect(result.groups).toHaveLength(6);
    expect(result.groups.every((g) => g.total === '0.0000' && g.count === 0)).toBe(true);
    expect(result.total).toBe('0.0000');
  });
});
