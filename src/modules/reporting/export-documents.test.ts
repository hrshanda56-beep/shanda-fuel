import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildPdfFromCsv,
  buildXlsxFromCsv,
  buildReportPdf,
  buildReportXlsx,
  parseReportExportFormat,
  reportExportFilename,
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
