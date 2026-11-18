import { describe, expect, it } from 'vitest';
import { buildSalesDocumentPdf, formatAmount } from './pdf';
import type { SalesDocumentDetail } from './queries';

const base: SalesDocumentDetail = {
  id: 'd',
  docType: 'INVOICE',
  status: 'ISSUED',
  docNumber: 'INV-2026-0001',
  recipientName: 'Acme (Pvt) Ltd',
  issueDate: '2026-11-18',
  validUntil: null,
  dueDate: '2026-12-18',
  total: '115.0000',
  currency: 'USD',
  version: 2,
  paymentState: 'PART_PAID',
  balance: '65.0000',
  revision: 1,
  recipientAddress: '1 Main Road\nHarare',
  recipientTaxNumber: null,
  recipientEmail: 'a@b.co',
  customerId: null,
  taxLabel: 'VAT',
  subtotal: '125.0000',
  discountTotal: '25.0000',
  taxTotal: '15.0000',
  notes: 'Thanks',
  terms: 'Net 30',
  letterhead: {
    displayName: 'Shanda Fuel',
    address: 'Station Rd',
    phone: '123',
    email: null,
    taxLabel: 'VAT',
    taxNumber: 'V1',
    bankDetails: 'Bank 1234',
    footer: 'Thank you',
  },
  sourceDocumentId: null,
  sourceDocNumber: null,
  paymentMethod: null,
  paymentReference: null,
  paidOn: null,
  voidReason: null,
  lines: [
    {
      lineNo: 1,
      productId: null,
      description: 'Diesel 50 - a rather long description of the goods '.repeat(3),
      quantity: '10.000',
      unitLabel: 'L',
      unitPrice: '12.5000',
      discountAmount: '25.0000',
      taxRate: '15.0000',
      netAmount: '100.0000',
      taxAmount: '15.0000',
      lineTotal: '115.0000',
    },
  ],
  receipts: [{ id: 'r', docNumber: 'RC-1', paidOn: '2026-11-19', total: '50.0000' }],
};

describe('formatAmount', () => {
  it('rounds half up exactly and groups thousands', () => {
    expect(formatAmount('1234567.8950')).toBe('1,234,567.90');
    expect(formatAmount('0.0050')).toBe('0.01');
    expect(formatAmount('0.0049')).toBe('0.00');
    expect(formatAmount('12.5000', 4, 2)).toBe('12.50');
    expect(formatAmount('10.000', 3, 0)).toBe('10');
    expect(formatAmount('-3.5000')).toBe('-3.50');
  });
});

describe('buildSalesDocumentPdf', () => {
  it('produces a multi-page PDF for a long document', () => {
    const many = {
      ...base,
      lines: Array.from({ length: 60 }, (_, i) => ({ ...base.lines[0]!, lineNo: i + 1 })),
    };
    const text = buildSalesDocumentPdf(many).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(Number(/\/Count (\d+)/.exec(text)![1])).toBeGreaterThan(1);
    expect(text).toContain('INV-2026-0001');
  });

  it('renders quotation, receipt and void variants', () => {
    const variants: Partial<SalesDocumentDetail>[] = [
      { docType: 'QUOTATION', validUntil: '2026-12-01', docNumber: null, status: 'DRAFT' },
      { docType: 'RECEIPT', paidOn: '2026-11-19', paymentMethod: 'Cash', lines: [] },
      { status: 'VOIDED', voidReason: 'Duplicate' },
    ];
    for (const over of variants) {
      expect(buildSalesDocumentPdf({ ...base, ...over }).length).toBeGreaterThan(500);
    }
  });
});
