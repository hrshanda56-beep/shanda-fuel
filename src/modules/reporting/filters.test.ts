import { describe, expect, it } from 'vitest';
import {
  applyReportFilters,
  describeStations,
  parseReportFilters,
  resolveReportFilters,
  toggleStation,
} from './filters';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('report filters', () => {
  it('defaults to all stations and this month', () => {
    expect(parseReportFilters(new URLSearchParams())).toEqual({
      stationIds: [],
      period: 'this-month',
      customFrom: '',
      customTo: '',
    });
  });

  it('parses stations, dropping invalid and duplicate ids', () => {
    const filters = parseReportFilters(
      new URLSearchParams(`stations=${B},bad,${A},${B}&period=3m`),
    );
    expect(filters.stationIds).toEqual([A, B]);
    expect(filters.period).toBe('3m');
  });

  it('falls back to the default for an unknown period', () => {
    expect(parseReportFilters(new URLSearchParams('period=weekly')).period).toBe('this-month');
  });

  it('round-trips through the URL and keeps unrelated params', () => {
    const filters = parseReportFilters(
      new URLSearchParams(`stations=${A}&period=custom&from=2026-08-01&to=2026-08-31`),
    );
    const next = applyReportFilters(new URLSearchParams('tenantId=t1&stations=old'), filters);
    expect(next.get('tenantId')).toBe('t1');
    expect(parseReportFilters(next)).toEqual(filters);
  });

  it('omits default values from the URL', () => {
    const next = applyReportFilters(
      new URLSearchParams('tenantId=t1'),
      parseReportFilters(new URLSearchParams()),
    );
    expect(next.toString()).toBe('tenantId=t1');
  });

  it('resolves a custom range only when complete', () => {
    const incomplete = parseReportFilters(new URLSearchParams('period=custom&from=2026-08-01'));
    expect(resolveReportFilters(incomplete, '2026-10-08')).toBeNull();
    const complete = parseReportFilters(
      new URLSearchParams('period=custom&from=2026-08-01&to=2026-08-31'),
    );
    expect(resolveReportFilters(complete, '2026-10-08')).toMatchObject({ toDate: '2026-08-31' });
  });

  it('toggles stations and collapses a full selection to all', () => {
    const all = [A, B, C];
    expect(toggleStation([], A, all)).toEqual([A]);
    expect(toggleStation([A], B, all)).toEqual([A, B]);
    expect(toggleStation([A, B], C, all)).toEqual([]);
    expect(toggleStation([A, B], B, all)).toEqual([A]);
  });

  it('describes the selection', () => {
    const stations = [
      { id: A, name: 'Harare Central' },
      { id: B, name: 'Bulawayo' },
    ];
    expect(describeStations([], stations)).toBe('All stations');
    expect(describeStations([A], stations)).toBe('Harare Central');
    expect(describeStations([A, B], stations)).toBe('2 stations');
  });
});
