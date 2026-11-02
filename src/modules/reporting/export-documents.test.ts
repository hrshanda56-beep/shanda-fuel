import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildPdfFromCsv,
  buildXlsxFromCsv,
  buildReportPdf,
  buildReportXlsx,
  parseReportExportFormat,
  reportExportFilename,
  reportExportMeta,
} from './export-documents';
import type { ManagementReport } from './contracts';

const report = {
  stations: [],
  filters: {
    fromDate: '2026-10-01',
    toDate: '2026-10-31',
    stationIds: [],
  },
  cash: {
    cashEvidence: '100.1000',
    collected: '90.0000',
    awaitingCollection: '10.1000',
    banked: '50.0000',
    collectedButNotBanked: '40.0000',
    cashVariance: '-0.0001',
  },
} as unknown as ManagementReport;

/** Reads every entry of a ZIP from its central directory, the way a spreadsheet app would. */
function readZip(buffer: Buffer): Map<string, string> {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(endAt + 10);
  let cursor = buffer.readUInt32LE(endAt + 16);
  const files = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const data = inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize));
    expect(data.length).toBe(size);
    files.set(name, data.toString('utf8'));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('report document contents match the CSV they come from', () => {
  const csv = ['Station,Litres,Note', 'Main,"1,200.500",ok', 'Depot,0.0001,=1+1'].join('\n');

  it('writes every CSV cell into the XLSX worksheet, numbers as numbers', () => {
    const files = readZip(buildXlsxFromCsv(csv));
    expect([...files.keys()]).toContain('xl/worksheets/sheet1.xml');
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('Station');
    expect(sheet).toContain('Main');
    expect(sheet).toContain('0.0001');
    expect((sheet.match(/<row /g) ?? []).length).toBe(3);
  });

  it('shows money and litres at two decimals and prices at three, keeping exact values (B9)', () => {
    const files = readZip(
      buildXlsxFromCsv('Item,Money,Litres,Price,Count\nA,450.0000,1200.500,1.455000,12'),
    );
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    const styles = files.get('xl/styles.xml')!;
    // Stored values are untouched; only the display format differs.
    expect(sheet).toContain('<c r="B2" s="3" t="n"><v>450.0000</v></c>');
    expect(sheet).toContain('<c r="C2" s="3" t="n"><v>1200.500</v></c>');
    expect(sheet).toContain('<c r="D2" s="4" t="n"><v>1.455000</v></c>');
    expect(sheet).toContain('<c r="E2" t="n"><v>12</v></c>');
    expect(styles).toContain('formatCode="#,##0.00"');
    expect(styles).toContain('formatCode="#,##0.000"');
  });

  it('neutralises spreadsheet formulas in the XLSX and keeps the text', () => {
    const sheet = readZip(buildXlsxFromCsv(csv)).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).not.toMatch(/<t[^>]*>=1\+1</);
    expect(sheet).toContain('&apos;=1+1');
  });

  it('puts every CSV cell into the PDF text', () => {
    const text = buildPdfFromCsv(csv).toString('latin1');
    expect(text).toContain('Station');
    expect(text).toContain('Main');
    expect(text).toContain('0.0001');
  });
});

describe('report document exports', () => {
  it('defaults unknown formats to CSV and names browser downloads', () => {
    expect(parseReportExportFormat(undefined)).toBe('csv');
    expect(parseReportExportFormat('docx')).toBe('csv');
    expect(reportExportFilename('profit-loss', '2026-10-01', '2026-10-31', 0, 'pdf')).toBe(
      'profit-loss_2026-10-01_to_2026-10-31.pdf',
    );
    expect(reportExportFilename('profit-loss', '2026-10-01', '2026-10-31', 1, 'xlsx')).toBe(
      'profit-loss_2026-10-01_to_2026-10-31_1-station.xlsx',
    );
  });

  it('creates a valid PDF header without recomputing report values', () => {
    const pdf = buildReportPdf('cash', report);
    expect(pdf.subarray(0, 8).toString('binary')).toBe('%PDF-1.4');
    expect(pdf.toString('ascii')).toContain('%%EOF');
  });

  it('creates an XLSX ZIP containing the report worksheet', () => {
    const xlsx = buildReportXlsx('cash', report);
    expect(xlsx.subarray(0, 2).toString('binary')).toBe('PK');
    expect(xlsx.length).toBeGreaterThan(500);
  });
});

describe('report document layout', () => {
  const meta = reportExportMeta('Income Statement', '2026-10-01', '2026-10-31', 2);
  const rows = Array.from({ length: 120 }, (_, index) => `Station ${index},${index}.5000,Café`);
  const csv = ['Station,Litres,Note', ...rows].join('\r\n');

  it('builds the period line from business dates', () => {
    expect(meta).toEqual({
      title: 'Income Statement',
      subtitle: '01 Oct 2026 to 31 Oct 2026 · 2 stations',
    });
    expect(reportExportMeta('Cash', '2026-10-05', '2026-10-05', 0).subtitle).toBe('05 Oct 2026');
  });

  it('lays the PDF out as a titled table that repeats its header on every page', () => {
    const text = buildPdfFromCsv(csv, meta).toString('latin1');
    expect(text).toContain('(Income Statement)');
    expect(text).toContain('(01 Oct 2026 to 31 Oct 2026');
    expect(text).toContain('/Helvetica-Bold');
    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain(`Page 1 of ${pages}`);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    expect((text.match(/\(Station\) Tj/g) ?? []).length).toBe(pages);
    // Accented text is drawn, not replaced by "?".
    expect(text).toContain('Caf\xe9');
  });

  it('draws dashes and quotes from the WinAnsi set', () => {
    const text = buildPdfFromCsv('Note\r\nA – B “q”\r\n').toString('latin1');
    expect(text).toContain('A \x96 B \x93q\x94');
  });

  it('draws an empty report as its heading plus a plain note', () => {
    const text = buildPdfFromCsv('Station,Litres\r\n', meta).toString('latin1');
    expect(text).toContain('(Station) Tj');
    expect(text).toContain('No rows for this period.');
    expect(text).toContain('Page 1 of 1');
  });

  it('never prints text wider than its column', () => {
    const long = `Station,Note\r\nMain,${'x'.repeat(400)}`;
    const text = buildPdfFromCsv(long).toString('latin1');
    expect(text).toContain('...)');
    expect(text).not.toContain('x'.repeat(400));
  });

  it('styles the workbook: title block, frozen bold header, number formats', () => {
    const files = readZip(buildXlsxFromCsv('Station,Litres\r\nMain,1200.5\r\nDepot,3\r\n', meta));
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('Income Statement');
    expect(sheet).toContain('<pane ySplit="4"');
    expect(sheet).toContain('<c r="A4" s="1"');
    expect(sheet).toContain('<c r="B5" s="3" t="n"><v>1200.5</v>');
    expect(sheet).toContain('<cols>');
    const styles = files.get('xl/styles.xml')!;
    expect(styles).toContain('formatCode="#,##0.0"');
    expect(styles).toContain('<b/>');
  });

  it('keeps the original row layout when no title is given', () => {
    const sheet = readZip(buildXlsxFromCsv('A,B\r\n1,2\r\n')).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<pane ySplit="1"');
    expect(sheet).toContain('<row r="1">');
  });
});
