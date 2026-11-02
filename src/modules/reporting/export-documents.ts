import { deflateRawSync } from 'node:zlib';
import type { ReportDefinition } from './catalog';
import { buildReportCsv, reportCsvFilename } from './export-csv';
import type { ManagementReport } from './contracts';

export type ReportExportFormat = 'csv' | 'pdf' | 'xlsx';

const EXPORT_FORMATS: readonly ReportExportFormat[] = ['csv', 'pdf', 'xlsx'];

export function parseReportExportFormat(value: string | undefined): ReportExportFormat {
  if (value && EXPORT_FORMATS.includes(value as ReportExportFormat)) {
    return value as ReportExportFormat;
  }
  return 'csv';
}

export function reportExportContentType(format: ReportExportFormat): string {
  switch (format) {
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'pdf':
      return 'application/pdf';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
}

export function reportExportFilename(
  slug: string,
  fromDate: string,
  toDate: string,
  stationCount: number,
  format: ReportExportFormat,
): string {
  if (format === 'csv') return reportCsvFilename(slug, fromDate, toDate, stationCount);
  const csvName = reportCsvFilename(slug, fromDate, toDate, stationCount);
  return `${csvName.slice(0, -'.csv'.length)}.${format}`;
}

/** Parses the repository's own RFC-4180-style output without converting numeric strings. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\r') {
      // CRLF is emitted by buildReportCsv; LF is handled below.
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function spreadsheetText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function isSpreadsheetNumber(value: string): boolean {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function columnName(column: number): string {
  let value = column + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

/** Title and period line shown above the table in the PDF and the workbook. */
export type ReportExportMeta = Readonly<{ title: string; subtitle?: string }>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function readableDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${match[3]} ${month} ${match[1]}` : value;
}

/** Heading block for a download: report title plus the business dates it covers. */
export function reportExportMeta(
  title: string,
  fromDate: string,
  toDate: string,
  stationCount: number,
): ReportExportMeta {
  const period =
    fromDate === toDate
      ? readableDate(fromDate)
      : `${readableDate(fromDate)} to ${readableDate(toDate)}`;
  const stations =
    stationCount > 0 ? ` · ${stationCount} station${stationCount === 1 ? '' : 's'}` : '';
  return { title, subtitle: `${period}${stations}` };
}

const HEADER_STYLE = 1;
const TITLE_STYLE = 2;
const FIRST_NUMBER_STYLE = 3;

/**
 * Decimals Excel displays; the stored value is never rounded. Money and litres (three or four
 * decimals) show two, a price per litre (five or more) shows three, and values that already have
 * up to two decimals are shown as they are.
 */
function decimalPlaces(value: string): number {
  const decimals = value.split('.')[1]?.length ?? 0;
  if (decimals >= 5) return 3;
  if (decimals >= 3) return 2;
  return decimals;
}

type Worksheet = Readonly<{ xml: string; decimalFormats: readonly number[] }>;

/**
 * One sheet: optional title block, a shaded bold header row that stays in view, readable column
 * widths and a per-column number format. Values are written exactly as the CSV carries them; the
 * number format only changes how many decimals Excel displays.
 */
function worksheetXml(rows: readonly (readonly string[])[], meta?: ReportExportMeta): Worksheet {
  const lead = meta ? 3 : 0;
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 1);
  const decimals = Array.from({ length: columnCount }, (_, column) =>
    rows
      .slice(1)
      .reduce(
        (maximum, row) =>
          isSpreadsheetNumber(row[column] ?? '')
            ? Math.max(maximum, decimalPlaces(row[column]!))
            : maximum,
        0,
      ),
  );
  const decimalFormats = [...new Set(decimals.filter((places) => places > 0))].sort(
    (a, b) => a - b,
  );
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.min(
      60,
      Math.max(
        10,
        rows.reduce((maximum, row) => Math.max(maximum, (row[column] ?? '').length), 0) + 3,
      ),
    ),
  );

  const textCell = (reference: string, value: string, style: number) =>
    `<c r="${reference}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(spreadsheetText(value))}</t></is></c>`;
  const leadXml = meta
    ? `<row r="1" ht="22" customHeight="1">${textCell('A1', meta.title, TITLE_STYLE)}</row>` +
      (meta.subtitle ? `<row r="2">${textCell('A2', meta.subtitle, 0)}</row>` : '')
    : '';
  const rowXml = rows
    .map((row, rowIndex) => {
      const sheetRow = lead + rowIndex + 1;
      const cells = row
        .map((value, columnIndex) => {
          const reference = `${columnName(columnIndex)}${sheetRow}`;
          if (rowIndex === 0) return textCell(reference, value, HEADER_STYLE);
          if (isSpreadsheetNumber(value)) {
            const places = decimals[columnIndex] ?? 0;
            const style = places > 0 ? FIRST_NUMBER_STYLE + decimalFormats.indexOf(places) : 0;
            return `<c r="${reference}"${style ? ` s="${style}"` : ''} t="n"><v>${value}</v></c>`;
          }
          return textCell(reference, value, 0);
        })
        .join('');
      return `<row r="${sheetRow}">${cells}</row>`;
    })
    .join('');
  const headerRow = lead + 1;
  const pane = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>`;
  const cols = widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnName(columnCount - 1)}${Math.max(lead + rows.length, 1)}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><cols>${cols}</cols><sheetData>${leadXml}${rowXml}</sheetData></worksheet>`;
  return { xml, decimalFormats };
}

function stylesXml(decimalFormats: readonly number[]): string {
  const numFmts = decimalFormats.length
    ? `<numFmts count="${decimalFormats.length}">${decimalFormats
        .map(
          (places, index) =>
            `<numFmt numFmtId="${164 + index}" formatCode="#,##0.${'0'.repeat(places)}"/>`,
        )
        .join('')}</numFmts>`
    : '';
  const numberXfs = decimalFormats
    .map(
      (_, index) =>
        `<xf numFmtId="${164 + index}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}<fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="14"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EDEF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF7A8A90"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${3 + decimalFormats.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>${numberXfs}</cellXfs></styleSheet>`;
}

type ZipEntry = Readonly<{ name: string; data: Buffer }>;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff]!;
  return (value ^ 0xffffffff) >>> 0;
}

/** Small standards-compliant ZIP writer for the dependency-free XLSX export. */
function zip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function buildReportXlsx(
  slug: ReportDefinition['slug'],
  report: ManagementReport,
  meta?: ReportExportMeta,
): Buffer {
  return buildXlsxFromCsv(buildReportCsv(slug, report), meta);
}

/** Same workbook, from CSV text the repository itself produced. */
export function buildXlsxFromCsv(csv: string, meta?: ReportExportMeta): Buffer {
  const rows = parseCsv(csv);
  const worksheet = worksheetXml(rows, meta);
  const sheet = Buffer.from(worksheet.xml, 'utf8');
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        'utf8',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'utf8',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'utf8',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'utf8',
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    {
      name: 'xl/styles.xml',
      data: Buffer.from(stylesXml(worksheet.decimalFormats), 'utf8'),
    },
  ];
  return zip(entries);
}

/** Helvetica advance widths (1/1000 em) for ASCII 32-126, used to size and align columns. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
] as const;
const BOLD_FACTOR = 1.07;

/** Characters outside ASCII that the PDF's WinAnsi encoding can still draw. */
const WIN_ANSI: Readonly<Record<number, number>> = {
  0x20ac: 0x80,
  0x2026: 0x85,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
};

const WIN_ANSI_BYTES = new Set(Object.values(WIN_ANSI));

/** Maps text to single-byte WinAnsi characters; anything undrawable becomes "?". */
function pdfChars(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) out += character;
    else if (code >= 0xa0 && code <= 0xff) out += character;
    else if (WIN_ANSI[code] !== undefined) out += String.fromCharCode(WIN_ANSI[code]!);
    else if (WIN_ANSI_BYTES.has(code))
      out += character; // already mapped (fitText then pdfText)
    else if (code === 0x09 || code === 0x0a || code === 0x0d) out += ' ';
    else out += '?';
  }
  return out;
}

function pdfText(value: string): string {
  return pdfChars(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

/** Width of text in 1/1000 em units. */
function textUnits(value: string, bold = false): number {
  let units = 0;
  for (const character of pdfChars(value)) {
    const code = character.charCodeAt(0);
    units += code >= 32 && code <= 126 ? HELVETICA_WIDTHS[code - 32]! : 556;
  }
  return bold ? units * BOLD_FACTOR : units;
}

/** Shortens text with "..." so that it fits the given width in points. */
function fitText(value: string, width: number, size: number, bold = false): string {
  const clean = pdfChars(value);
  const fits = (candidate: string) => (textUnits(candidate, bold) / 1000) * size <= width;
  if (fits(clean)) return clean;
  let end = clean.length;
  while (end > 0 && !fits(`${clean.slice(0, end)}...`)) end -= 1;
  return end > 0 ? `${clean.slice(0, end)}...` : '';
}

export function buildReportPdf(
  slug: ReportDefinition['slug'],
  report: ManagementReport,
  meta?: ReportExportMeta,
): Buffer {
  return buildPdfFromCsv(buildReportCsv(slug, report), meta);
}

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const PAGE_MARGIN = 36;
const CELL_PADDING = 3;

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Same PDF, from CSV text the repository itself produced: a landscape A4 table with a title
 * block, shaded header row repeated on every page, aligned columns (numbers on the right) and
 * page numbers. Cell text is written exactly as the CSV carries it; text that cannot fit is cut
 * with "..." rather than overlapping its neighbour.
 */
export function buildPdfFromCsv(csv: string, meta?: ReportExportMeta): Buffer {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const usable = PAGE_WIDTH - 2 * PAGE_MARGIN;

  const naturalUnits = Array.from({ length: columnCount }, (_, column) =>
    Math.max(
      textUnits(header[column] ?? '', true),
      ...body.map((row) => textUnits(row[column] ?? '')),
    ),
  );
  const naturalWidths = (size: number) =>
    naturalUnits.map((units) => (units / 1000) * size + 2 * CELL_PADDING);
  const total = (widths: readonly number[]) => widths.reduce((sum, width) => sum + width, 0);

  let fontSize = 9;
  while (fontSize > 6 && total(naturalWidths(fontSize)) > usable) fontSize -= 0.5;
  let widths = naturalWidths(fontSize);
  const used = total(widths);
  if (used > usable) {
    widths = widths.map((width) => (width * usable) / used);
  } else if (used > 0) {
    const stretch = Math.min(1.6, usable / used);
    widths = widths.map((width) => width * stretch);
  }
  const lefts = widths.map((_, index) => PAGE_MARGIN + total(widths.slice(0, index)));

  const rowHeight = fontSize + 7;
  const headerHeight = rowHeight + 3;
  const tableTop = PAGE_HEIGHT - PAGE_MARGIN - (meta ? 44 : 0);
  const tableBottom = PAGE_MARGIN + 6;
  const rowsPerPage = Math.max(1, Math.floor((tableTop - tableBottom - headerHeight) / rowHeight));
  const pageCount = Math.max(1, Math.ceil(body.length / rowsPerPage));

  const pageContent = (pageIndex: number): Buffer => {
    const ops: string[] = [];
    if (meta) {
      ops.push(
        `BT /F2 15 Tf 0.1 0.16 0.18 rg ${PAGE_MARGIN} ${PAGE_HEIGHT - PAGE_MARGIN - 8} Td (${pdfText(fitText(meta.title, usable, 15, true))}) Tj ET`,
      );
      if (meta.subtitle) {
        ops.push(
          `BT /F1 9 Tf 0.35 0.4 0.42 rg ${PAGE_MARGIN} ${PAGE_HEIGHT - PAGE_MARGIN - 24} Td (${pdfText(fitText(meta.subtitle, usable, 9))}) Tj ET`,
        );
      }
    }
    const headerBottom = tableTop - headerHeight;
    ops.push(
      `0.9 0.93 0.94 rg ${PAGE_MARGIN} ${round(headerBottom)} ${usable} ${headerHeight} re f`,
    );
    header.forEach((cell, column) => {
      const text = pdfText(fitText(cell, widths[column]! - 2 * CELL_PADDING, fontSize, true));
      ops.push(
        `BT /F2 ${fontSize} Tf 0.1 0.16 0.18 rg ${round(lefts[column]! + CELL_PADDING)} ${round(headerBottom + (headerHeight - fontSize) / 2 + 0.2 * fontSize)} Td (${text}) Tj ET`,
      );
    });
    ops.push(
      `0.48 0.54 0.56 RG 0.6 w ${PAGE_MARGIN} ${round(headerBottom)} m ${PAGE_MARGIN + usable} ${round(headerBottom)} l S`,
    );

    const pageRows = body.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    pageRows.forEach((row, rowIndex) => {
      const bottom = headerBottom - (rowIndex + 1) * rowHeight;
      if ((pageIndex * rowsPerPage + rowIndex) % 2 === 1) {
        ops.push(
          `0.965 0.972 0.975 rg ${PAGE_MARGIN} ${round(bottom)} ${usable} ${rowHeight} re f`,
        );
      }
      const baseline = round(bottom + (rowHeight - fontSize) / 2 + 0.2 * fontSize);
      row.forEach((cell, column) => {
        if (cell === '' || column >= columnCount) return;
        const room = widths[column]! - 2 * CELL_PADDING;
        const text = fitText(cell, room, fontSize);
        const right = isSpreadsheetNumber(cell);
        const x = right
          ? lefts[column]! + widths[column]! - CELL_PADDING - (textUnits(text) / 1000) * fontSize
          : lefts[column]! + CELL_PADDING;
        ops.push(
          `BT /F1 ${fontSize} Tf 0.1 0.16 0.18 rg ${round(x)} ${baseline} Td (${pdfText(text)}) Tj ET`,
        );
      });
    });
    if (body.length === 0) {
      ops.push(
        `BT /F1 ${fontSize} Tf 0.35 0.4 0.42 rg ${PAGE_MARGIN + CELL_PADDING} ${round(headerBottom - rowHeight + 3)} Td (No rows for this period.) Tj ET`,
      );
    }
    const footer = `Page ${pageIndex + 1} of ${pageCount}`;
    ops.push(
      `BT /F1 8 Tf 0.35 0.4 0.42 rg ${round(PAGE_MARGIN + usable - (textUnits(footer) / 1000) * 8)} ${PAGE_MARGIN - 18} Td (${footer}) Tj ET`,
    );
    return Buffer.from(ops.join('\n'), 'latin1');
  };

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
  const pageRefs: string[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    pageRefs.push(`${pageObject} 0 R`);
    const content = pageContent(pageIndex);
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`,
        'latin1',
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
        content,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageCount} >>`,
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
  for (let index = 1; index < offsets.length; index += 1) {
    xref.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
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

export function buildReportExport(
  format: ReportExportFormat,
  slug: ReportDefinition['slug'],
  report: ManagementReport,
  meta?: ReportExportMeta,
): string | Buffer {
  if (format === 'csv') return buildReportCsv(slug, report);
  if (format === 'pdf') return buildReportPdf(slug, report, meta);
  return buildReportXlsx(slug, report, meta);
}

export function buildExportFromCsv(
  format: ReportExportFormat,
  csv: string,
  meta?: ReportExportMeta,
): string | Buffer {
  if (format === 'csv') return csv;
  if (format === 'pdf') return buildPdfFromCsv(csv, meta);
  return buildXlsxFromCsv(csv, meta);
}
