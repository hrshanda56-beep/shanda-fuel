import { describe, expect, it } from 'vitest';
import { REPORT_CATALOG, findReport } from '../catalog';
import { buildExportFromCsv } from '../export-documents';
import { buildTableReportCsv } from './csv';
import { TABLE_REPORTS, findTableReport } from './definitions';

describe('table reports', () => {
  it('are in the report catalogue and exportable', () => {
    for (const report of TABLE_REPORTS) {
      expect(findReport(report.slug)?.title).toBe(report.title);
      expect(findReport(report.slug)?.exportable).toBe(true);
    }
    const slugs = REPORT_CATALOG.map((report) => report.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('have unique column keys and plain-language headings', () => {
    for (const report of TABLE_REPORTS) {
      const keys = report.columns.map((column) => column.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const column of report.columns) expect(column.label.trim()).not.toBe('');
    }
  });

  it('writes a heading row alone for an empty report', () => {
    const definition = findTableReport('delivery-variance')!;
    const csv = buildTableReportCsv(definition, []);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('Delivery note');
  });

  it('keeps exact numbers and guards text cells against spreadsheet formulas', () => {
    const definition = findTableReport('stock-movements')!;
    const csv = buildTableReportCsv(definition, [
      {
        businessDate: '2026-10-01',
        effectiveAt: '2026-10-01T06:00:00Z',
        station: '=cmd|calc',
        tank: 'T1',
        product: 'Diesel',
        movementType: 'Fuel sold',
        quantityLitres: '-12.500',
        reason: null,
      },
    ]);
    const line = csv.split('\r\n')[1];
    expect(line).toContain(",'=cmd|calc,");
    expect(line).toContain(',-12.500,');
  });

  it('produces Excel and PDF files from the same table', () => {
    const definition = findTableReport('tank-dip-history')!;
    const csv = buildTableReportCsv(definition, [
      {
        businessDate: '2026-10-01',
        measuredAt: '2026-10-01T05:30:00Z',
        station: 'Main',
        tank: 'T1',
        product: 'Petrol',
        physicalLitres: '10000.000',
        notes: null,
      },
    ]);
    const xlsx = buildExportFromCsv('xlsx', csv) as Buffer;
    const pdf = buildExportFromCsv('pdf', csv) as Buffer;
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
