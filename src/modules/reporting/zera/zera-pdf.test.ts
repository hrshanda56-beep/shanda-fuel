import { describe, expect, it } from 'vitest';
import { buildZeraPdf, ZERA_SECTIONS } from './zera-pdf';

const labels = [
  'Representative name',
  'Position',
  'Phone',
  'Email',
  'Station name',
  'Licence number',
  'Address',
  'Region',
  'Fuel supplied: Diesel (L)',
  'Fuel supplied: Petrol (L)',
  'Fuel supplied: Total (L)',
  'Fuel sold: Diesel (L)',
  'Fuel sold: Petrol (L)',
  'Notes',
];

const input = (notes: string) => ({
  periodLabel: 'October 2026',
  stationName: 'Tei Energy - Msasa',
  version: 2,
  savedAt: '2026-11-02T08:30:00Z',
  answers: labels.map((label, i) => ({ label, value: label === 'Notes' ? notes : `Answer ${i}` })),
});

const pageCount = (pdf: Buffer): number => Number(/\/Count (\d+)/.exec(pdf.toString('latin1'))![1]);

describe('ZERA return PDF', () => {
  it('fits a complete return with a short note on one page', () => {
    expect(ZERA_SECTIONS.at(-1)!.to).toBe(14);
    expect(pageCount(buildZeraPdf(input('Pump 3 was out of service for two days.')))).toBe(1);
  });

  it('does not repeat the Notes heading as a label above the note', () => {
    const text = buildZeraPdf(input('A note.')).toString('latin1');
    expect(text).toContain('(NOTES) Tj');
    expect(text).not.toContain('(Notes) Tj');
  });

  it('lets a very long note flow onto more pages without losing any of it', () => {
    const note = 'Stock counts were verified by the supervisor. '.repeat(60);
    const pdf = buildZeraPdf(input(note));
    expect(pageCount(pdf)).toBeGreaterThan(1);
    expect(pdf.toString('latin1')).toContain('Page 2 of');
  });
});
