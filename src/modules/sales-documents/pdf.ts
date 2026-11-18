import { fitText, pdfText, textUnits } from '../reporting/export-documents';
import { lineGross } from './domain';
import { formatAmount, isZero } from './format';
import type { SalesDocumentDetail } from './queries';

export { formatAmount };

/**
 * Portrait A4 quotation / invoice / receipt, drawn with the same hand-written PDF writer helpers
 * as the report downloads (standard Helvetica, no new dependency). Everything printed comes from
 * the stored document and its letterhead snapshot, so a later change to the company profile never
 * alters an issued document. The letterhead may carry a small JPEG logo (embedded as-is, no image
 * library) and a brand colour used for the title and rules.
 */

const W = 595;
const H = 842;
const M = 40;
const USABLE = W - 2 * M;
const INK = '0.1 0.16 0.18';
const MUTED = '0.35 0.4 0.42';

const round = (n: number): number => Math.round(n * 100) / 100;
const width = (text: string, size: number, bold = false): number =>
  (textUnits(text, bold) / 1000) * size;

/** Splits text into lines no wider than `max` points, honouring line breaks. */
function wrap(text: string, max: number, size: number, bold = false): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const rawWord of paragraph.split(/\s+/).filter(Boolean)) {
      let word = rawWord;
      if (width(line ? `${line} ${word}` : word, size, bold) <= max) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) out.push(line);
      line = '';
      // A single word wider than the column is cut so it can never overlap its neighbour.
      while (width(word, size, bold) > max && word.length > 1) {
        let end = word.length - 1;
        while (end > 1 && width(word.slice(0, end), size, bold) > max) end -= 1;
        out.push(word.slice(0, end));
        word = word.slice(end);
      }
      line = word;
    }
    out.push(line);
  }
  return out;
}

const TITLES = { QUOTATION: 'QUOTATION', INVOICE: 'INVOICE', RECEIPT: 'RECEIPT' } as const;

const dateText = (iso: string | null): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${Number(d)} ${months[Number(m) - 1] ?? ''} ${y}`;
};

type Logo = { data: Buffer; width: number; height: number };

/** Reads a baseline or progressive RGB JPEG's size from its header; null if not usable. */
export function readJpeg(base64: string | null | undefined): Logo | null {
  if (!base64) return null;
  const data = Buffer.from(base64, 'base64');
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = data.readUInt16BE(i + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      const height = data.readUInt16BE(i + 5);
      const width = data.readUInt16BE(i + 7);
      const components = data[i + 9];
      if (!width || !height || components !== 3) return null;
      return { data, width, height };
    }
    i += 2 + length;
  }
  return null;
}

/** "#1A7F5A" becomes the PDF colour triple "0.102 0.498 0.353"; anything else is ignored. */
function accentOf(hex: string | null | undefined): string | null {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return null;
  const channel = (at: number) => (parseInt(hex.slice(at, at + 2), 16) / 255).toFixed(3);
  return `${channel(1)} ${channel(3)} ${channel(5)}`;
}

class Pages {
  readonly pages: string[][] = [];
  y = 0;
  private ops: string[] = [];

  constructor() {
    this.newPage();
  }

  newPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = H - M;
  }

  text(
    x: number,
    y: number,
    value: string,
    size: number,
    opts: { bold?: boolean; color?: string } = {},
  ): void {
    if (!value) return;
    this.ops.push(
      `BT /${opts.bold ? 'F2' : 'F1'} ${size} Tf ${opts.color ?? INK} rg ${round(x)} ${round(y)} Td (${pdfText(value)}) Tj ET`,
    );
  }

  right(
    xRight: number,
    y: number,
    value: string,
    size: number,
    opts: { bold?: boolean; color?: string } = {},
  ): void {
    this.text(xRight - width(value, size, opts.bold), y, value, size, opts);
  }

  image(x: number, y: number, w: number, h: number): void {
    this.ops.push(`q ${round(w)} 0 0 ${round(h)} ${round(x)} ${round(y)} cm /Im1 Do Q`);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ops.push(`${color} rg ${round(x)} ${round(y)} ${round(w)} ${round(h)} re f`);
  }

  line(x1: number, y: number, x2: number, color = '0.48 0.54 0.56'): void {
    this.ops.push(`${color} RG 0.6 w ${round(x1)} ${round(y)} m ${round(x2)} ${round(y)} l S`);
  }

  /** Makes sure `need` points are free, otherwise starts a new page. Returns true if it did. */
  ensure(need: number): boolean {
    if (this.y - need >= M + 24) return false;
    this.newPage();
    return true;
  }
}

export function buildSalesDocumentPdf(doc: SalesDocumentDetail): Buffer {
  const p = new Pages();
  const lh = doc.letterhead;
  const title = TITLES[doc.docType];
  const money = (v: string) => formatAmount(v, 2);
  const cur = doc.currency;

  // ---- Letterhead (left) and document title + numbers (right) ----
  const companyName = lh?.displayName ?? '';
  const top = p.y;
  const logo = readJpeg(lh?.logoJpegBase64);
  const accent = accentOf(lh?.brandColour);
  let textX = M;
  let logoBottom = top;
  if (logo) {
    const scale = Math.min(150 / logo.width, 50 / logo.height);
    const lw = logo.width * scale;
    const lhh = logo.height * scale;
    p.image(M, top - lhh, lw, lhh);
    textX = M + lw + 12;
    logoBottom = top - lhh - 6;
  }
  const textWidth = USABLE * 0.55 - (textX - M);
  p.text(textX, top - 14, fitText(companyName, textWidth, 16, true), 16, { bold: true });
  let leftY = top - 30;
  const companyLines = [
    ...(lh?.address ? wrap(lh.address, textWidth, 9) : []),
    lh?.phone ? `Tel: ${lh.phone}` : '',
    lh?.email ?? '',
    lh?.taxNumber ? `${lh.taxLabel ?? 'Tax no.'}: ${lh.taxNumber}` : '',
  ].filter(Boolean);
  for (const text of companyLines) {
    p.text(textX, leftY, text, 9, { color: MUTED });
    leftY -= 12;
  }

  p.right(W - M, top - 18, title, 22, { bold: true, color: accent ?? INK });
  let rightY = top - 38;
  const status =
    doc.status === 'DRAFT' ? 'DRAFT - not issued' : doc.status === 'VOIDED' ? 'VOID' : '';
  if (status) {
    p.right(W - M, rightY, status, 10, { bold: true, color: '0.7 0.1 0.1' });
    rightY -= 14;
  }
  const meta: [string, string][] = [];
  if (doc.docNumber) meta.push(['Number', doc.docNumber]);
  meta.push([
    doc.docType === 'RECEIPT' ? 'Date received' : 'Date',
    dateText(doc.docType === 'RECEIPT' ? (doc.paidOn ?? doc.issueDate) : doc.issueDate),
  ]);
  if (doc.docType === 'QUOTATION' && doc.validUntil)
    meta.push(['Valid until', dateText(doc.validUntil)]);
  if (doc.docType === 'INVOICE' && doc.dueDate) meta.push(['Due date', dateText(doc.dueDate)]);
  if (doc.sourceDocNumber) {
    meta.push([doc.docType === 'RECEIPT' ? 'For invoice' : 'From quotation', doc.sourceDocNumber]);
  }
  for (const [label, value] of meta) {
    p.right(W - M - 110, rightY, label, 9, { color: MUTED });
    p.right(W - M, rightY, value, 9, { bold: true });
    rightY -= 12;
  }

  p.y = Math.min(leftY, rightY, logoBottom) - 10;
  p.line(M, p.y, W - M, accent ?? '0.48 0.54 0.56');
  p.y -= 18;

  // ---- Recipient ----
  p.text(
    M,
    p.y,
    doc.docType === 'QUOTATION'
      ? 'Prepared for'
      : doc.docType === 'RECEIPT'
        ? 'Received from'
        : 'Bill to',
    8,
    { color: MUTED, bold: true },
  );
  p.y -= 13;
  p.text(M, p.y, fitText(doc.recipientName, USABLE * 0.6, 11, true), 11, { bold: true });
  p.y -= 13;
  const recipientLines = [
    ...(doc.recipientAddress ? wrap(doc.recipientAddress, USABLE * 0.6, 9) : []),
    doc.recipientEmail ?? '',
    doc.recipientTaxNumber ? `${doc.taxLabel}: ${doc.recipientTaxNumber}` : '',
  ].filter(Boolean);
  for (const text of recipientLines) {
    p.text(M, p.y, text, 9, { color: MUTED });
    p.y -= 12;
  }
  p.y -= 10;

  // ---- Receipt: a payment summary instead of a lines table ----
  if (doc.docType === 'RECEIPT') {
    p.rect(M, p.y - 56, USABLE, 62, '0.95 0.97 0.97');
    p.text(M + 12, p.y - 14, 'Amount received', 9, { color: MUTED });
    p.text(M + 12, p.y - 40, `${cur} ${money(doc.total)}`, 22, { bold: true });
    const how = [doc.paymentMethod, doc.paymentReference ? `Ref ${doc.paymentReference}` : '']
      .filter(Boolean)
      .join(' - ');
    if (how) p.right(W - M - 12, p.y - 14, fitText(how, USABLE * 0.5, 9), 9, { color: MUTED });
    p.y -= 76;
  } else {
    drawLines(p, doc);
    drawTotals(p, doc);
  }

  // ---- Notes / terms / bank / footer ----
  const blocks: [string, string | null | undefined][] = [
    ['Notes', doc.notes],
    ['Terms', doc.terms],
    ['Payment details', doc.docType === 'RECEIPT' ? null : lh?.bankDetails],
    ['Reason voided', doc.status === 'VOIDED' ? doc.voidReason : null],
  ];
  for (const [label, text] of blocks) {
    if (!text) continue;
    const lines = wrap(text, USABLE, 9);
    p.ensure(20 + lines.length * 12);
    p.text(M, p.y, label, 8, { color: MUTED, bold: true });
    p.y -= 12;
    for (const line of lines) {
      p.text(M, p.y, line, 9);
      p.y -= 12;
    }
    p.y -= 6;
  }
  if (lh?.footer) {
    const lines = wrap(lh.footer, USABLE, 8);
    p.ensure(lines.length * 11 + 8);
    p.y -= 4;
    p.line(M, p.y, W - M, '0.85 0.88 0.89');
    p.y -= 12;
    for (const line of lines) {
      p.text(M, p.y, line, 8, { color: MUTED });
      p.y -= 11;
    }
  }

  return assemble(p.pages, doc.docNumber ?? title, logo);
}

function drawLines(p: Pages, doc: SalesDocumentDetail): void {
  const showDiscount = doc.lines.some((l) => !isZero(l.discountAmount));
  const showTax = doc.lines.some((l) => !isZero(l.taxRate));
  const cols = {
    qty: 52,
    price: 66,
    disc: showDiscount ? 56 : 0,
    tax: showTax ? 40 : 0,
    amount: 70,
  };
  const fixed = cols.qty + cols.price + cols.disc + cols.tax + cols.amount;
  const descW = USABLE - fixed - 8;
  const xDesc = M + 4;
  let x = M + descW + 8;
  const xQtyR = (x += cols.qty);
  const xPriceR = (x += cols.price);
  const xDiscR = showDiscount ? (x += cols.disc) : 0;
  const xTaxR = showTax ? (x += cols.tax) : 0;
  const xAmtR = W - M - 4;

  const header = () => {
    p.rect(M, p.y - 15, USABLE, 18, '0.9 0.93 0.94');
    const y = p.y - 10;
    p.text(xDesc, y, 'Description', 8.5, { bold: true });
    p.right(xQtyR, y, 'Qty', 8.5, { bold: true });
    p.right(xPriceR, y, 'Unit price', 8.5, { bold: true });
    if (showDiscount) p.right(xDiscR, y, 'Discount', 8.5, { bold: true });
    if (showTax) p.right(xTaxR, y, `${doc.taxLabel} %`, 8.5, { bold: true });
    p.right(xAmtR, y, `Amount (${doc.currency})`, 8.5, { bold: true });
    p.y -= 20;
  };
  header();

  if (doc.lines.length === 0) {
    p.text(xDesc, p.y - 8, 'No lines.', 9, { color: MUTED });
    p.y -= 20;
    return;
  }
  doc.lines.forEach((line, index) => {
    const lines = wrap(line.description, descW - 4, 9);
    const height = Math.max(1, lines.length) * 12 + 6;
    if (p.ensure(height)) header();
    if (index % 2 === 1) p.rect(M, p.y - height + 4, USABLE, height, '0.965 0.972 0.975');
    const baseline = p.y - 9;
    lines.forEach((l, i) => p.text(xDesc, baseline - i * 12, l, 9));
    const qty = `${formatAmount(line.quantity, 3, 0)}${line.unitLabel ? ` ${line.unitLabel}` : ''}`;
    p.right(xQtyR - 2, baseline, fitText(qty, cols.qty - 4, 9), 9);
    p.right(xPriceR - 2, baseline, formatAmount(line.unitPrice, 4, 2), 9);
    if (showDiscount) {
      p.right(
        xDiscR - 2,
        baseline,
        isZero(line.discountAmount) ? '' : money2(line.discountAmount),
        9,
      );
    }
    if (showTax) {
      p.right(xTaxR - 2, baseline, isZero(line.taxRate) ? '' : formatAmount(line.taxRate, 2, 0), 9);
    }
    p.right(xAmtR, baseline, money2(lineGross(line.quantity, line.unitPrice)), 9);
    p.y -= height;
  });
  p.line(M, p.y + 2, W - M);
  p.y -= 10;
}

const money2 = (v: string): string => formatAmount(v, 2);

function drawTotals(p: Pages, doc: SalesDocumentDetail): void {
  const rows: [string, string, boolean][] = [];
  const showBreakdown = !isZero(doc.discountTotal) || !isZero(doc.taxTotal);
  if (showBreakdown) {
    rows.push(['Subtotal', money2(doc.subtotal), false]);
    if (!isZero(doc.discountTotal)) rows.push(['Discount', `-${money2(doc.discountTotal)}`, false]);
    if (!isZero(doc.taxTotal)) rows.push([doc.taxLabel, money2(doc.taxTotal), false]);
  }
  rows.push([`Total (${doc.currency})`, money2(doc.total), true]);
  if (doc.docType === 'INVOICE' && doc.status === 'ISSUED' && doc.receipts.length > 0) {
    rows.push(['Paid so far', money2(subtract(doc.total, doc.balance ?? doc.total)), false]);
    rows.push([`Balance due (${doc.currency})`, money2(doc.balance ?? doc.total), true]);
  }
  p.ensure(rows.length * 16 + 12);
  const xLabel = W - M - 220;
  for (const [label, value, bold] of rows) {
    if (bold) p.line(xLabel, p.y + 11, W - M);
    p.text(xLabel, p.y, label, bold ? 10.5 : 9, { bold, color: bold ? INK : MUTED });
    p.right(W - M - 4, p.y, value, bold ? 10.5 : 9, { bold });
    p.y -= 16;
  }
  p.y -= 8;
}

/** a - b on 4-decimal strings, exactly. */
function subtract(a: string, b: string): string {
  const scale = (v: string): bigint => {
    const [i = '0', f = ''] = v.split('.');
    return BigInt(i + f.padEnd(4, '0').slice(0, 4));
  };
  const diff = scale(a) - scale(b);
  const digits = (diff < 0n ? -diff : diff).toString().padStart(5, '0');
  return `${diff < 0n ? '-' : ''}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

function assemble(
  pages: readonly (readonly string[])[],
  titleText: string,
  logo: Logo | null,
): Buffer {
  const count = pages.length;
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.alloc(0),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      'latin1',
    ),
    Buffer.from(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      'latin1',
    ),
  ];
  if (logo) {
    objects.push(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.data.length} >>\nstream\n`,
          'latin1',
        ),
        logo.data,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }
  const refs: string[] = [];
  pages.forEach((ops, index) => {
    const pageObject = objects.length + 1;
    refs.push(`${pageObject} 0 R`);
    const footer = `Page ${index + 1} of ${count}`;
    const content = Buffer.from(
      [
        ...ops,
        `BT /F1 8 Tf ${MUTED} rg ${round(W - M - width(footer, 8))} ${M - 18} Td (${footer}) Tj ET`,
        `BT /F1 8 Tf ${MUTED} rg ${M} ${M - 18} Td (${pdfText(fitText(titleText, 300, 8))}) Tj ET`,
      ].join('\n'),
      'latin1',
    );
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${logo ? ' /XObject << /Im1 5 0 R >>' : ''} >> /Contents ${pageObject + 1} 0 R >>`,
        'latin1',
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
        content,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  });
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${refs.join(' ')}] /Count ${count} >>`,
    'latin1',
  );

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let position = parts[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(position);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      object,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    position += chunk.length;
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (let i = 1; i < offsets.length; i += 1) {
    xref.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  xref.push(
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(position),
    '%%EOF',
  );
  parts.push(Buffer.from(`${xref.join('\n')}\n`, 'latin1'));
  return Buffer.concat(parts);
}
