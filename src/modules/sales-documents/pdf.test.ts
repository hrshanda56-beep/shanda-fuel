import { describe, expect, it } from 'vitest';
import { buildSalesDocumentPdf, formatAmount, readJpeg } from './pdf';
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

describe('logo and brand colour', () => {
  // A minimal JPEG header: SOI, then a start-of-frame for a 64 x 32 RGB picture.
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1,
    3, 0x11, 1, 0xff, 0xd9,
  ]).toString('base64');

  it('reads a JPEG size and rejects anything else', () => {
    expect(readJpeg(jpeg)).toMatchObject({ width: 64, height: 32 });
    expect(readJpeg(Buffer.from('not a picture').toString('base64'))).toBeNull();
    expect(readJpeg(null)).toBeNull();
  });

  it('embeds the logo and uses the brand colour', () => {
    const doc = {
      ...base,
      letterhead: { ...base.letterhead, logoJpegBase64: jpeg, brandColour: '#1A7F5A' },
    } as SalesDocumentDetail;
    const text = buildSalesDocumentPdf(doc).toString('latin1');
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Im1 Do');
    expect(text).toContain('0.102 0.498 0.353 rg');
  });

  it('prints without a logo exactly as before', () => {
    expect(buildSalesDocumentPdf(base).toString('latin1')).not.toContain('/Subtype /Image');
  });
});
