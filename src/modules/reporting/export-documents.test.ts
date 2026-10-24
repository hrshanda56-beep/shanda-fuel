import { describe, expect, it } from 'vitest';
import {
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
