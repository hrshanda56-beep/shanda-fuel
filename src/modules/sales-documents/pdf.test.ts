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
    tin: null,
    registrationNumber: null,
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

  it('prints the unit after the quantity on an "Other" line', () => {
    const doc: SalesDocumentDetail = {
      ...base,
      lines: [
        { ...base.lines[0]!, description: 'Transport', quantity: '2.000', unitLabel: 'trip' },
        { ...base.lines[0]!, lineNo: 2, description: 'Handling', unitLabel: null },
      ],
    };
    const text = buildSalesDocumentPdf(doc).toString('latin1');
    expect(text).toContain('(2 trip)');
    expect(text).toContain('(10)');
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

describe('company numbers on the letterhead', () => {
  const withNumbers = {
    ...base,
    letterhead: { ...base.letterhead, tin: '1234567890', registrationNumber: '1234/2020' },
  } as SalesDocumentDetail;

  it('prints the TIN and company registration number under the contact lines', () => {
    const text = buildSalesDocumentPdf(withNumbers).toString('latin1');
    expect(text).toContain('(TIN: 1234567890)');
    expect(text).toContain('(Company reg. no.: 1234/2020)');
    expect(text).toContain('(VAT: V1)');
  });

  it('prints nothing for numbers that were not given, and for older issued letterheads', () => {
    const text = buildSalesDocumentPdf(base).toString('latin1');
    expect(text).not.toContain('TIN:');
    expect(text).not.toContain('Company reg. no.');
    const old = {
      ...base,
      letterhead: { displayName: 'Old Co', taxLabel: 'VAT', taxNumber: 'V9' },
    } as SalesDocumentDetail;
    expect(buildSalesDocumentPdf(old).toString('latin1')).toContain('(VAT: V9)');
  });
});

describe('long names are written out in full', () => {
  const company = 'Triumph Energy Investments (Private) Limited';
  const customer = 'Tandamanzi Drilling and Mining Services (Private) Limited';
  const long = {
    ...base,
    recipientName: customer,
    letterhead: { ...base.letterhead, displayName: company },
  } as SalesDocumentDetail;

  const textOf = (buf: Buffer): string =>
    [...buf.toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
      .map((m) => m[1]!.replace(/\\(.)/g, '$1'))
      .join(' ');

  it('never cuts a company or customer name short with dots', () => {
    const text = textOf(buildSalesDocumentPdf(long));
    expect(text).not.toContain('...');
    // Wrapped onto several lines, but every word of both names is present, in order.
    for (const name of [company, customer]) {
      const words = name.split(' ');
      let at = 0;
      for (const word of words) {
        at = text.indexOf(word, at);
        expect(at, word).toBeGreaterThanOrEqual(0);
        at += word.length;
      }
    }
  });

  it('keeps a short name on one line, as before', () => {
    expect(textOf(buildSalesDocumentPdf(base))).toContain('Acme (Pvt) Ltd');
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

describe('page balance', () => {
  /** The y position of the first text drawn with this exact string. */
  const yOf = (text: string, label: string): number => {
    const m = new RegExp(`([\\d.]+) ([\\d.]+) Td \\(${label}\\) Tj`).exec(text);
    if (!m) throw new Error(`${label} not found`);
    return Number(m[2]);
  };

  it('puts terms and payment details low on the page, with the closing note last', () => {
    const text = buildSalesDocumentPdf(base).toString('latin1');
    const notes = yOf(text, 'Notes');
    const terms = yOf(text, 'Terms');
    const bank = yOf(text, 'Payment details');
    const closing = yOf(text, 'Thank you');
    expect(terms).toBeLessThan(notes);
    expect(bank).toBeLessThan(terms);
    expect(closing).toBeLessThan(bank);
    expect(terms).toBeLessThan(250);
  });

  it('keeps the same order on a quotation and still on one page', () => {
    const text = buildSalesDocumentPdf({
      ...base,
      docType: 'QUOTATION',
      docNumber: 'QT-2026-0001',
    }).toString('latin1');
    expect(Number(/\/Count (\d+)/.exec(text)![1])).toBe(1);
    expect(yOf(text, 'Thank you')).toBeLessThan(yOf(text, 'Terms'));
  });

  it('leaves clear space between the prices and the notes, terms and payment details', () => {
    const text = buildSalesDocumentPdf({
      ...base,
      docType: 'QUOTATION',
      docNumber: 'QT-2026-0001',
      notes: 'Price delivered.',
    }).toString('latin1');
    const total = yOf(text, 'Total \\\\\\(USD\\\\\\)');
    // Notes sit well below the Total, and each block has room before the next.
    expect(total - yOf(text, 'Notes')).toBeGreaterThanOrEqual(40);
    expect(yOf(text, 'Terms') - yOf(text, 'Payment details')).toBeGreaterThanOrEqual(40);
  });

  it('lets the foot flow on when the body leaves no room for it', () => {
    const many = {
      ...base,
      lines: Array.from({ length: 22 }, (_, i) => ({ ...base.lines[0]!, lineNo: i + 1 })),
    };
    const text = buildSalesDocumentPdf(many).toString('latin1');
    expect(text).toContain('(Terms)');
    expect(text).toContain('(Thank you)');
  });
});

describe('logo box', () => {
  /** A header-only JPEG of the given size: enough for the PDF writer, which embeds it as-is. */
  const jpeg = (w: number, h: number): string =>
    Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      h >> 8,
      h & 255,
      w >> 8,
      w & 255,
      0x03,
      0x01,
      0x22,
      0x00,
      0x02,
      0x11,
      0x01,
      0x03,
      0x11,
      0x01,
      0xff,
      0xd9,
    ]).toString('base64');

  it.each([
    ['very wide', 3000, 200],
    ['very tall', 200, 3000],
    ['square', 500, 500],
    ['tiny', 20, 10],
  ])('fits a %s logo in the box without stretching', (_name, w, h) => {
    const text = buildSalesDocumentPdf({
      ...base,
      letterhead: { ...base.letterhead!, logoJpegBase64: jpeg(w, h) },
    } as SalesDocumentDetail).toString('latin1');
    const m = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im1 Do Q/.exec(text);
    expect(m).not.toBeNull();
    const dw = Number(m![1]);
    const dh = Number(m![2]);
    expect(dw).toBeLessThanOrEqual(140.01);
    expect(dh).toBeLessThanOrEqual(56.01);
    expect(dw / dh).toBeCloseTo(w / h, 1);
  });
});
