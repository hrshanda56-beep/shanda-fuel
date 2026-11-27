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
/** The lowest y a body line may use; the page footer sits below it. */
const FLOOR = M + 24;
/** Every logo is scaled to fit this box, keeping its shape. */
const LOGO_W = 140;
const LOGO_H = 56;

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

/** Space between side-by-side columns. */
const COL_GAP = 24;
/** Height of a block's small heading, and of one line of its body. */
const LABEL_H = 17;
const LINE_H = 14;
/** Space between two rows of columns inside one block. */
const ROW_GAP = 12;
/** Terms longer than this, at half width, go full width instead of beside the bank. */
const MAX_PAIRED_TERMS_LINES = 6;

/** One block of the foot: a heading over one or more side-by-side paragraphs. */
type Group = { label: string; paragraphs: string[] };
type Section = { label: string; x: number; rows: { x: number; lines: string[] }[][]; body: number };
/** Sections that share one top edge, left to right. */
type Band = { sections: Section[]; height: number };

/** Paragraphs are separated by a blank line, e.g. one bank after another. */
const paragraphsOf = (text: string): string[] =>
  text
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);

/** How many columns a block of `count` paragraphs uses: up to three across, four as two by two. */
const columnsFor = (count: number): number => (count <= 3 ? count : count === 4 ? 2 : 3);

/** Lays one group out inside the box [x, x + w], splitting its paragraphs into columns. */
function sectionOf(group: Group, x: number, w: number): Section {
  const per = Math.max(1, columnsFor(group.paragraphs.length));
  const colW = (w - (per - 1) * COL_GAP) / per;
  const rows: Section['rows'] = [];
  for (let at = 0; at < group.paragraphs.length; at += per) {
    rows.push(
      group.paragraphs.slice(at, at + per).map((text, i) => ({
        x: x + i * (colW + COL_GAP),
        lines: wrap(text, colW, 9.5),
      })),
    );
  }
  const body = rows.reduce(
    (sum, row, i) =>
      sum + Math.max(...row.map((c) => c.lines.length)) * LINE_H + (i > 0 ? ROW_GAP : 0),
    0,
  );
  return { label: group.label, x, rows, body };
}

const bandOf = (sections: Section[]): Band => ({
  sections,
  height: LABEL_H + Math.max(...sections.map((s) => s.body)),
});

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

/** A very light wash of the accent, for panels: the accent mixed with white. */
function tintOf(accent: string | null, strength = 0.92): string {
  if (!accent) return '0.95 0.97 0.97';
  return accent
    .split(' ')
    .map((c) => (Number(c) * (1 - strength) + strength).toFixed(3))
    .join(' ');
}

class Pages {
  readonly pages: string[][] = [];
  y = 0;
  private ops: string[] = [];

  /** `band` is the colour of the slim bar across the top edge of every page. */
  constructor(private readonly band: string) {
    this.newPage();
  }

  newPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
    this.rect(0, H - 6, W, 6, this.band);
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

  line(x1: number, y: number, x2: number, color = '0.48 0.54 0.56', weight = 0.6): void {
    this.ops.push(
      `${color} RG ${weight} w ${round(x1)} ${round(y)} m ${round(x2)} ${round(y)} l S`,
    );
  }

  /** Makes sure `need` points are free, otherwise starts a new page. Returns true if it did. */
  ensure(need: number): boolean {
    if (this.y - need >= FLOOR) return false;
    this.newPage();
    return true;
  }
}

export function buildSalesDocumentPdf(doc: SalesDocumentDetail): Buffer {
  const lh = doc.letterhead;
  const accent = accentOf(lh?.brandColour);
  const tint = tintOf(accent);
  const p = new Pages(accent ?? INK);
  const title = TITLES[doc.docType];
  const money = (v: string) => formatAmount(v, 2);
  const cur = doc.currency;

  // ---- Letterhead (left) and document title + numbers (right) ----
  const companyName = lh?.displayName ?? '';
  const top = p.y;
  const logo = readJpeg(lh?.logoJpegBase64);
  let textX = M;
  let logoBottom = top;
  if (logo) {
    const scale = Math.min(LOGO_W / logo.width, LOGO_H / logo.height);
    const lw = logo.width * scale;
    const lhh = logo.height * scale;
    p.image(M, top - lhh, lw, lhh);
    textX = M + lw + 12;
    logoBottom = top - lhh - 6;
  }
  const textWidth = USABLE * 0.55 - (textX - M);
  // The full company name is always written out: a long one wraps onto more lines, never cut short.
  const nameLines = wrap(companyName, textWidth, 16, true);
  nameLines.forEach((line, i) => p.text(textX, top - 14 - i * 18, line, 16, { bold: true }));
  let leftY = top - 14 - (nameLines.length - 1) * 18 - 16;
  const companyLines = [
    ...(lh?.address ? wrap(lh.address, textWidth, 9) : []),
    lh?.phone ? `Tel: ${lh.phone}` : '',
    lh?.email ?? '',
    lh?.tin ? `TIN: ${lh.tin}` : '',
    lh?.registrationNumber ? `Company reg. no.: ${lh.registrationNumber}` : '',
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
  for (const line of wrap(doc.recipientName, USABLE * 0.6, 11, true)) {
    p.text(M, p.y, line, 11, { bold: true });
    p.y -= 13;
  }
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
    p.rect(M, p.y - 56, USABLE, 62, tint);
    p.rect(M, p.y - 56, 4, 62, accent ?? INK);
    p.text(M + 18, p.y - 14, 'Amount received', 9, { color: MUTED });
    p.text(M + 18, p.y - 40, `${cur} ${money(doc.total)}`, 22, { bold: true });
    const how = [doc.paymentMethod, doc.paymentReference ? `Ref ${doc.paymentReference}` : '']
      .filter(Boolean)
      .join(' - ');
    if (how) p.right(W - M - 14, p.y - 14, fitText(how, USABLE * 0.5, 9), 9, { color: MUTED });
    p.y -= 76;
  } else {
    drawLines(p, doc, accent);
    drawTotals(p, doc, tint);
  }

  // ---- Notes follow the totals; terms, payment details and the closing note sit at the foot ----
  // Generous breathing room: well clear of the prices, and between each block.
  // The gaps are generous when the page has room; when that would push the foot onto an extra
  // page, they tighten (see below) so the document stays on the page it fits on.
  let AFTER_TOTALS_GAP = 64;
  let BLOCK_GAP = 40;
  const DIVIDER = 18;
  const hasFoot = Boolean(doc.notes || doc.terms || lh?.bankDetails);
  // Notes, terms and payment details are laid out as bands of side-by-side columns, so the width
  // of the page is used instead of one narrow column running down it.
  const notesGroup: Group | null = doc.notes ? { label: 'Notes', paragraphs: [doc.notes] } : null;
  const termsGroup: Group | null = doc.terms ? { label: 'Terms', paragraphs: [doc.terms] } : null;
  const bankParagraphs =
    doc.docType === 'RECEIPT' || !lh?.bankDetails ? [] : paragraphsOf(lh.bankDetails);
  const bankGroup: Group | null = bankParagraphs.length
    ? { label: 'Payment details', paragraphs: bankParagraphs }
    : null;
  const voidGroup: Group | null =
    doc.status === 'VOIDED' && doc.voidReason
      ? { label: 'Reason voided', paragraphs: [doc.voidReason] }
      : null;

  const full = (group: Group): Band => bandOf([sectionOf(group, M, USABLE)]);
  const half = (USABLE - COL_GAP) / 2;
  const beside = (left: Group, right: Group): Band =>
    bandOf([sectionOf(left, M, half), sectionOf(right, M + half + COL_GAP, half)]);
  const linesAtHalf = (group: Group): number => wrap(group.paragraphs[0]!, half, 9.5).length;
  const short = (group: Group): boolean => linesAtHalf(group) <= MAX_PAIRED_TERMS_LINES;
  const present = (...groups: (Group | null)[]): Group[] =>
    groups.filter((g): g is Group => g !== null);

  // Every sensible arrangement of the foot; the shortest wins, and a tie keeps terms beside the
  // payment details. Long text keeps the full width, so nothing is ever squeezed.
  const heightOf = (list: Band[]): number =>
    list.reduce((sum, band) => sum + band.height + BLOCK_GAP, 0);
  const options: Band[][] = [];
  if (termsGroup && bankGroup && bankGroup.paragraphs.length === 1 && short(termsGroup)) {
    options.push([...present(notesGroup).map(full), beside(termsGroup, bankGroup)]);
  }
  if (notesGroup && termsGroup && short(notesGroup) && short(termsGroup)) {
    options.push([beside(notesGroup, termsGroup), ...present(bankGroup).map(full)]);
  }
  options.push(present(notesGroup, termsGroup, bankGroup).map(full));
  const bands: Band[] = [
    ...present(voidGroup).map(full),
    ...options.reduce((best, option) => (heightOf(option) < heightOf(best) ? option : best)),
  ];

  const labelColor = accent ?? MUTED;
  /** A block taller than this cannot fit even on a page of its own, so it has to flow. */
  const PAGE_ROOM = H - M - FLOOR - 8;

  /** Draws a block that is taller than a page, line by line, carrying on over as many pages as it needs. */
  const drawTallBand = (band: Band): void => {
    type Entry = { section: number; x: number; offset: number; text: string };
    const entries: Entry[] = [];
    band.sections.forEach((section, index) => {
      let top = LABEL_H;
      section.rows.forEach((row, i) => {
        if (i > 0) top += ROW_GAP;
        for (const cell of row) {
          cell.lines.forEach((text, n) =>
            entries.push({ section: index, x: cell.x, offset: top + n * LINE_H, text }),
          );
        }
        top += Math.max(...row.map((c) => c.lines.length)) * LINE_H;
      });
    });
    entries.sort((a, b) => a.offset - b.offset);
    let next = 0;
    let first = true;
    while (next < entries.length) {
      if (first) p.ensure(LABEL_H + 2 * LINE_H);
      else p.newPage();
      // How far down the block the lines on this page start, so they can be placed from the top.
      const shift = first ? 0 : entries[next]!.offset - LABEL_H;
      const chunk: Entry[] = [];
      while (
        next < entries.length &&
        (chunk.length === 0 || p.y - (entries[next]!.offset - shift) >= FLOOR)
      ) {
        chunk.push(entries[next]!);
        next += 1;
      }
      const live = new Set(chunk.map((entry) => entry.section));
      band.sections.forEach((section, index) => {
        if (!live.has(index)) return;
        const label = first ? section.label : `${section.label} (continued)`;
        p.text(section.x, p.y, label, 8.5, { color: labelColor, bold: true });
      });
      for (const entry of chunk) p.text(entry.x, p.y - (entry.offset - shift), entry.text, 9.5);
      p.y -= chunk[chunk.length - 1]!.offset - shift + LINE_H;
      first = false;
    }
    p.y -= BLOCK_GAP;
  };

  const drawBand = (band: Band): void => {
    if (band.height > PAGE_ROOM) {
      drawTallBand(band);
      return;
    }
    p.ensure(8 + band.height);
    for (const section of band.sections) {
      p.text(section.x, p.y, section.label, 8.5, { color: labelColor, bold: true });
      let y = p.y - LABEL_H;
      section.rows.forEach((row, i) => {
        if (i > 0) y -= ROW_GAP;
        for (const cell of row)
          cell.lines.forEach((l, n) => p.text(cell.x, y - n * LINE_H, l, 9.5));
        y -= Math.max(...row.map((c) => c.lines.length)) * LINE_H;
      });
    }
    p.y -= band.height + BLOCK_GAP;
  };

  const closing = lh?.footer ? wrap(lh.footer, USABLE, 8) : [];
  const footHeightAt = (gap: number): number =>
    bands.reduce((sum, band) => sum + band.height + gap, 0) +
    (bands.length ? DIVIDER : 0) +
    (closing.length ? closing.length * 11 + 16 : 0);
  if (hasFoot) {
    const room = p.y - FLOOR - 8;
    // From generous to tight; the first spacing that lets the foot fit on this page is used. A foot
    // that cannot fit even at the tightest keeps the generous spacing and flows onto the next page.
    const steps: [number, number][] = [
      [64, 40],
      [44, 30],
      [30, 22],
      [22, 16],
    ];
    const fit = steps.find(([after, between]) => after + footHeightAt(between) <= room);
    [AFTER_TOTALS_GAP, BLOCK_GAP] = fit ?? steps[0]!;
    p.y -= AFTER_TOTALS_GAP;
  }
  const footHeight = footHeightAt(BLOCK_GAP);
  // When the whole foot fits on this page, sit it at the bottom; otherwise let it flow on.
  const footTop = FLOOR + footHeight;
  if (footHeight > 0 && p.y - 8 >= footTop) p.y = footTop;
  if (bands.length) {
    p.ensure(DIVIDER + 40);
    p.line(M, p.y, W - M, '0.85 0.88 0.89');
    p.y -= DIVIDER;
  }
  for (const band of bands) drawBand(band);
  if (closing.length) {
    p.ensure(closing.length * 11 + 8);
    p.y -= 4;
    p.line(M, p.y, W - M, '0.85 0.88 0.89');
    p.y -= 12;
    for (const line of closing) {
      p.text(M, p.y, line, 8, { color: MUTED });
      p.y -= 11;
    }
  }

  return assemble(p.pages, doc.docNumber ?? title, logo);
}

function drawLines(p: Pages, doc: SalesDocumentDetail, accent: string | null): void {
  const showDiscount = doc.lines.some((l) => !isZero(l.discountAmount));
  const showTax = doc.lines.some((l) => !isZero(l.taxRate));
  // Each number column is as wide as its widest figure (never cut short), but no wider than a
  // cap, so a huge value still leaves room for the description.
  const sized = (min: number, max: number, texts: string[], header: string): number =>
    Math.min(
      max,
      Math.max(min, ...texts.map((t) => width(t, 9) + 10), width(header, 8.5, true) + 10),
    );
  const qtyText = (l: SalesDocumentDetail['lines'][number]): string =>
    `${formatAmount(l.quantity, 3, 0)}${l.unitLabel ? ` ${l.unitLabel}` : ''}`;
  const cols = {
    // Wide enough for a quantity with its unit, e.g. "12,500 L" or "3 trip".
    qty: sized(62, 120, doc.lines.map(qtyText), 'Qty'),
    price: sized(
      66,
      100,
      doc.lines.map((l) => formatAmount(l.unitPrice, 4, 2)),
      'Unit price',
    ),
    disc: showDiscount
      ? sized(
          56,
          90,
          doc.lines.map((l) => (isZero(l.discountAmount) ? '' : money2(l.discountAmount))),
          'Discount',
        )
      : 0,
    tax: showTax ? 40 : 0,
    amount: sized(
      70,
      110,
      doc.lines.map((l) => money2(lineGross(l.quantity, l.unitPrice))),
      `Amount (${doc.currency})`,
    ),
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
    p.line(M, p.y - 15, W - M, accent ?? '0.48 0.54 0.56', 1);
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
    const height = Math.max(1, lines.length) * 12 + 10;
    if (p.ensure(height)) header();
    if (index % 2 === 1) p.rect(M, p.y - height + 4, USABLE, height, '0.965 0.972 0.975');
    const baseline = p.y - 11;
    lines.forEach((l, i) => p.text(xDesc, baseline - i * 12, l, 9));
    p.right(xQtyR - 2, baseline, fitText(qtyText(line), cols.qty - 4, 9), 9);
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
  p.y -= 22;
}

const money2 = (v: string): string => formatAmount(v, 2);

function drawTotals(p: Pages, doc: SalesDocumentDetail, tint: string): void {
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
  p.ensure(rows.length * 20 + 12);
  const xLabel = W - M - 220;
  rows.forEach(([label, value, bold], index) => {
    // The amount the customer must act on (the last row) sits on a tinted panel.
    const last = bold && index === rows.length - 1;
    if (last) p.rect(xLabel - 8, p.y - 7, W - M - xLabel + 8, 24, tint);
    else if (bold) p.line(xLabel, p.y + 14, W - M);
    p.text(xLabel, p.y, label, bold ? 10.5 : 9, { bold, color: bold ? INK : MUTED });
    p.right(W - M - 4, p.y, value, bold ? 11.5 : 9, { bold });
    p.y -= last ? 24 : 20;
  });
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
        `0.85 0.88 0.89 RG 0.5 w ${M} ${M - 8} m ${W - M} ${M - 8} l S`,
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
