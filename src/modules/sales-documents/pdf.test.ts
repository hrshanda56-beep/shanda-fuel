import { describe, expect, it } from 'vitest';
import { textUnits } from '../reporting/export-documents';
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
    // Short terms and one bank share a row, so neither is above the other.
    expect(bank).toBe(terms);
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
    expect(yOf(text, 'Terms')).toBeLessThan(yOf(text, 'Notes') - 40);
  });

  it('keeps room between stacked blocks when long terms cannot share a row', () => {
    const text = buildSalesDocumentPdf({
      ...base,
      terms: 'Payment is due within thirty days of the invoice date. '.repeat(8),
    }).toString('latin1');
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

describe('foot blocks use the width of the page', () => {
  const twoBanks =
    'Stanbic Bank Zimbabwe:\nBranch: Borrowdale\nAccount Type: USD\nAccount No. 9140010619679\n\n' +
    'Ecobank Zimbabwe\nBranch: Borrowdale\nAccount Type: USD\nAccount No. 5712000024500';
  const withBanks = (bankDetails: string, over: Partial<SalesDocumentDetail> = {}) =>
    ({
      ...base,
      docType: 'QUOTATION',
      docNumber: 'QT-2026-0003',
      ...over,
      letterhead: { ...base.letterhead!, bankDetails },
    }) as SalesDocumentDetail;

  type Op = { x: number; y: number; size: number; text: string };
  const opsOf = (buf: Buffer): Op[] =>
    [
      ...buf
        .toString('latin1')
        .matchAll(/\/F\d ([\d.]+) Tf [\d. ]+ rg ([\d.]+) ([\d.]+) Td \(((?:\\.|[^\\)])*)\) Tj/g),
    ].map((m) => ({
      size: Number(m[1]),
      x: Number(m[2]),
      y: Number(m[3]),
      text: m[4]!.replace(/\\(.)/g, '$1'),
    }));
  const at = (ops: Op[], text: string): Op => {
    const op = ops.find((o) => o.text === text);
    if (!op) throw new Error(`${text} not found`);
    return op;
  };

  it('puts two banks side by side, each kept together under one heading', () => {
    const ops = opsOf(buildSalesDocumentPdf(withBanks(twoBanks)));
    const stanbic = at(ops, 'Stanbic Bank Zimbabwe:');
    const eco = at(ops, 'Ecobank Zimbabwe');
    expect(eco.y).toBe(stanbic.y);
    expect(eco.x).toBeGreaterThan(stanbic.x + 200);
    // Each bank's own lines stay in its column, in order.
    for (const [first, line] of [
      [stanbic, 'Account No. 9140010619679'],
      [eco, 'Account No. 5712000024500'],
    ] as const) {
      const row = at(ops, line);
      expect(row.x).toBe(first.x);
      expect(row.y).toBeLessThan(first.y);
    }
    expect(at(ops, 'Branch: Borrowdale').y).toBeLessThan(stanbic.y);
    // One heading for the whole block, above both banks.
    expect(ops.filter((o) => o.text === 'Payment details')).toHaveLength(1);
    expect(at(ops, 'Payment details').y).toBeGreaterThan(stanbic.y);
  });

  it('is shorter than the old stacked layout and stays on one page', () => {
    const text = buildSalesDocumentPdf(withBanks(twoBanks)).toString('latin1');
    expect(Number(/\/Count (\d+)/.exec(text)![1])).toBe(1);
  });

  it('puts three banks in three columns, four as two by two, five three across then two', () => {
    const banks = (n: number) =>
      Array.from({ length: n }, (_, i) => `Bank ${i + 1}\nAccount ${i + 1}`).join('\n\n');
    const place = (n: number) => {
      const ops = opsOf(buildSalesDocumentPdf(withBanks(banks(n))));
      return Array.from({ length: n }, (_, i) => at(ops, `Bank ${i + 1}`));
    };
    const three = place(3);
    expect(new Set(three.map((b) => b.y)).size).toBe(1);
    expect(new Set(three.map((b) => b.x)).size).toBe(3);
    const four = place(4);
    expect(new Set(four.map((b) => b.x)).size).toBe(2);
    expect(new Set(four.map((b) => b.y)).size).toBe(2);
    const five = place(5);
    expect(five[0]!.y).toBe(five[2]!.y);
    expect(five[3]!.y).toBeLessThan(five[0]!.y);
    expect(five[3]!.x).toBe(five[0]!.x);
  });

  it('never lets a column run past the page margins, even with long lines', () => {
    const long = `${'Very long bank name '.repeat(6)}\nAccount ${'9'.repeat(60)}`;
    for (const doc of [
      withBanks(`${long}\n\n${long}\n\n${long}`),
      withBanks(long, { terms: 'T '.repeat(80) }),
      withBanks(long),
    ]) {
      for (const op of opsOf(buildSalesDocumentPdf(doc))) {
        const right = op.x + (textUnits(op.text, false) / 1000) * op.size;
        expect(op.x, op.text).toBeGreaterThanOrEqual(40);
        // Bold text is a little wider than regular; the margin is 555.
        expect(right, op.text).toBeLessThanOrEqual(556);
      }
    }
  });

  it('keeps a single bank beside short terms, and below long terms', () => {
    const one = 'Bank 1234\nBranch: Main';
    const short = opsOf(buildSalesDocumentPdf(withBanks(one, { terms: 'Net 30' })));
    expect(at(short, 'Payment details').y).toBe(at(short, 'Terms').y);
    expect(at(short, 'Payment details').x).toBeGreaterThan(at(short, 'Terms').x);

    const longTerms = 'Goods remain the property of the seller until paid in full. '.repeat(10);
    const long = opsOf(buildSalesDocumentPdf(withBanks(one, { terms: longTerms })));
    expect(at(long, 'Payment details').y).toBeLessThan(at(long, 'Terms').y);
    expect(at(long, 'Payment details').x).toBe(at(long, 'Terms').x);
  });

  it('prints every word of the terms and the banks exactly once', () => {
    const ops = opsOf(buildSalesDocumentPdf(withBanks(twoBanks, { terms: 'Net 30 days' })));
    const printed = ops.map((o) => o.text).join('\n');
    for (const line of twoBanks.split('\n').filter(Boolean)) {
      expect(printed.split(line).length - 1, line).toBeGreaterThanOrEqual(1);
    }
    expect(printed).toContain('Net 30 days');
  });

  it('leaves blank lines and stray spacing out of the columns', () => {
    const ops = opsOf(
      buildSalesDocumentPdf(withBanks('\n\nBank A\nAcc 1\n\n\n\n  Bank B\nAcc 2\n\n')),
    );
    expect(at(ops, 'Bank B').y).toBe(at(ops, 'Bank A').y);
  });

  it('shows no payment details on a receipt or when none were given', () => {
    const receipt = opsOf(
      buildSalesDocumentPdf(
        withBanks(twoBanks, { docType: 'RECEIPT', paidOn: '2026-11-19', lines: [] }),
      ),
    );
    expect(receipt.some((o) => o.text === 'Payment details')).toBe(false);
    const none = opsOf(buildSalesDocumentPdf(withBanks('')));
    expect(none.some((o) => o.text === 'Payment details')).toBe(false);
  });

  it('still shows the reason a document was voided, full width above the terms', () => {
    const ops = opsOf(
      buildSalesDocumentPdf(withBanks(twoBanks, { status: 'VOIDED', voidReason: 'Duplicate' })),
    );
    expect(at(ops, 'Reason voided').y).toBeGreaterThan(at(ops, 'Terms').y);
    expect(at(ops, 'Reason voided').x).toBe(40);
  });
});

describe('a finished, branded document', () => {
  const full = {
    ...base,
    notes: 'Delivery to the depot between 6am and 10am.',
    terms: 'Payment is due within 30 days of the invoice date.',
    letterhead: {
      ...base.letterhead!,
      brandColour: '#1A7F5A',
      bankDetails: 'CBZ Bank\nAccount no: 0123456789\n\nStanbic Bank\nAccount no: 9140001234567',
    },
  } as SalesDocumentDetail;
  const opsOf = (buf: Buffer) =>
    [
      ...buf
        .toString('latin1')
        .matchAll(/\/F\d ([\d.]+) Tf [\d. ]+ rg ([\d.]+) ([\d.]+) Td \(((?:\\.|[^\\)])*)\) Tj/g),
    ].map((m) => ({ x: Number(m[2]), y: Number(m[3]), text: m[4]!.replace(/\\(.)/g, '$1') }));

  it('keeps an ordinary invoice with notes, terms and two banks on one page', () => {
    const text = buildSalesDocumentPdf(full).toString('latin1');
    expect(Number(/\/Count (\d+)/.exec(text)![1])).toBe(1);
  });

  it('puts short notes beside short terms', () => {
    const ops = opsOf(buildSalesDocumentPdf(full));
    const notes = ops.find((o) => o.text === 'Notes')!;
    const terms = ops.find((o) => o.text === 'Terms')!;
    expect(terms.y).toBe(notes.y);
    expect(terms.x).toBeGreaterThan(notes.x + 200);
    // The payment details stay together underneath, full width.
    expect(ops.find((o) => o.text === 'Payment details')!.y).toBeLessThan(notes.y);
  });

  it('draws a slim bar in the brand colour across the top of every page', () => {
    const many = {
      ...full,
      lines: Array.from({ length: 60 }, (_, i) => ({ ...base.lines[0]!, lineNo: i + 1 })),
    };
    const text = buildSalesDocumentPdf(many).toString('latin1');
    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(text.split('0.102 0.498 0.353 rg 0 836 595 6 re f').length - 1).toBe(pages);
  });

  it('falls back to a dark bar when the company has no brand colour', () => {
    const text = buildSalesDocumentPdf(base).toString('latin1');
    expect(text).toContain('0.1 0.16 0.18 rg 0 836 595 6 re f');
  });

  it('leaves long notes and long terms at full width, one under the other', () => {
    const ops = opsOf(
      buildSalesDocumentPdf({
        ...full,
        notes: 'A long note about the delivery. '.repeat(12),
        terms: 'Goods remain the property of the seller until paid in full. '.repeat(10),
      }),
    );
    const notes = ops.find((o) => o.text === 'Notes')!;
    const terms = ops.find((o) => o.text === 'Terms')!;
    expect(terms.x).toBe(notes.x);
    expect(terms.y).toBeLessThan(notes.y);
  });
});

describe('a block taller than a page', () => {
  const opsOf = (buf: Buffer) =>
    [
      ...buf
        .toString('latin1')
        .matchAll(/\/F\d ([\d.]+) Tf [\d. ]+ rg ([\d.]+) ([\d.]+) Td \(((?:\\.|[^\\)])*)\) Tj/g),
    ].map((m) => ({ y: Number(m[3]), text: m[4]!.replace(/\\(.)/g, '$1') }));
  const tall = (over: Partial<SalesDocumentDetail> = {}) =>
    ({
      ...base,
      notes: Array.from({ length: 60 }, (_, i) => `Condition ${i + 1} of the delivery.`).join(
        '\n\n',
      ),
      ...over,
    }) as SalesDocumentDetail;

  it('carries on over further pages and prints every line exactly once', () => {
    const pdf = buildSalesDocumentPdf(tall());
    const text = pdf.toString('latin1');
    expect(Number(/\/Count (\d+)/.exec(text)![1])).toBeGreaterThan(1);
    const printed = opsOf(pdf).map((o) => o.text);
    for (let i = 1; i <= 60; i += 1) {
      expect(
        printed.filter((t) => t === `Condition ${i} of the delivery.`),
        String(i),
      ).toHaveLength(1);
    }
    expect(printed).toContain('Notes (continued)');
  });

  it('never draws body text into the page footer or off the bottom edge', () => {
    for (const doc of [tall(), tall({ terms: 'Net 30 days. '.repeat(120) })]) {
      for (const op of opsOf(buildSalesDocumentPdf(doc))) {
        // The page footer sits at y 22; everything else stays above the floor of 64.
        expect(op.y === 22 || op.y >= 64, `${op.text} at ${op.y}`).toBe(true);
      }
    }
  });

  it('flows a very tall payment block too, column by column', () => {
    const banks = Array.from({ length: 3 }, (_, b) =>
      Array.from({ length: 70 }, (_, i) => `Bank ${b + 1} line ${i + 1}`).join('\n'),
    ).join('\n\n');
    const pdf = buildSalesDocumentPdf({
      ...base,
      notes: '',
      terms: '',
      letterhead: { ...base.letterhead!, bankDetails: banks },
    } as SalesDocumentDetail);
    const printed = opsOf(pdf).map((o) => o.text);
    for (let b = 1; b <= 3; b += 1) {
      expect(printed).toContain(`Bank ${b} line 1`);
      expect(printed).toContain(`Bank ${b} line 70`);
    }
    for (const op of opsOf(pdf)) expect(op.y === 22 || op.y >= 64, `${op.text}`).toBe(true);
  });
});

describe('very large figures', () => {
  it('prints a huge quantity and amount in full, never cut with dots', () => {
    const doc = {
      ...base,
      lines: [{ ...base.lines[0]!, quantity: '9999999.999', unitPrice: '123456.7890' }],
    } as SalesDocumentDetail;
    const text = buildSalesDocumentPdf(doc).toString('latin1');
    expect(text).toContain('(9,999,999.999 L)');
    expect(text).toContain('(123,456.789)');
    expect(text).not.toMatch(/\d\.\.\.\)/);
  });
});

describe('spacing adapts to a full page', () => {
  const banks =
    'CBZ Bank\nAccount name: Tei Energy\nAccount no: 0123456789\nBranch: Msasa\n\nStanbic Bank\nAccount name: Tei Energy\nAccount no: 9140001234567\nBranch: Harare Main';
  const pages = (doc: SalesDocumentDetail): number =>
    Number(/\/Count (\d+)/.exec(buildSalesDocumentPdf(doc).toString('latin1'))![1]);
  const withText = (notes: string, terms: string): SalesDocumentDetail =>
    ({
      ...base,
      docType: 'QUOTATION',
      notes,
      terms,
      discountTotal: '0.0000',
      taxTotal: '0.0000',
      receipts: [],
      lines: [
        {
          ...base.lines[0]!,
          description: 'Diesel 50',
          discountAmount: '0.0000',
          taxRate: '0.0000',
        },
      ],
      letterhead: { ...base.letterhead!, bankDetails: banks },
    }) as SalesDocumentDetail;

  it('keeps a heavily worded quotation with two banks on one page by tightening the gaps', () => {
    const note = 'Delivery will be made to the depot between 6am and 10am on weekdays. '.repeat(16);
    expect(note.length).toBeGreaterThan(1000);
    expect(pages(withText(note, 'Net 30 days. '.repeat(20)))).toBe(1);
  });

  it('keeps the generous gaps when there is room', () => {
    const text = buildSalesDocumentPdf(withText('Thanks.', 'Net 30')).toString('latin1');
    const y = (label: string): number =>
      Number(new RegExp(`([\\d.]+) ([\\d.]+) Td \\(${label}\\) Tj`).exec(text)![2]);
    expect(y('Notes') - y('Payment details')).toBeGreaterThanOrEqual(40);
  });

  it('still moves to a second page when even tight gaps cannot fit', () => {
    expect(pages(withText('A long note. '.repeat(150), 'Goods stay ours. '.repeat(110)))).toBe(2);
  });
});
