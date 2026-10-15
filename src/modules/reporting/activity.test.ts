import { describe, expect, it } from 'vitest';
import {
  buildReportEventMetadata,
  periodLabel,
  relativeTime,
  stationScopeLabel,
  toActivityItem,
} from './activity';

describe('report activity', () => {
  it('labels periods by preset or by dates for a custom range', () => {
    expect(periodLabel('last-month', '2026-09-01', '2026-09-30')).toBe('Last month');
    expect(periodLabel('custom', '2026-08-01', '2026-08-31')).toBe('2026-08-01 to 2026-08-31');
    expect(periodLabel(undefined, '2026-08-01', '2026-08-31')).toBe('2026-08-01 to 2026-08-31');
    expect(periodLabel('bogus', '2026-08-01', '2026-08-31')).toBe('2026-08-01 to 2026-08-31');
  });

  it('summarises station scope without ids', () => {
    expect(stationScopeLabel([])).toBe('All stations');
    expect(stationScopeLabel(['Bindura'])).toBe('Bindura');
    expect(stationScopeLabel(['Harare', 'Bindura'])).toBe('Bindura and Harare');
    expect(stationScopeLabel(['A', 'B', 'C'])).toBe('3 stations');
  });

  it('builds event metadata and a readable item', () => {
    const metadata = buildReportEventMetadata({
      slug: 'cash',
      period: 'this-month',
      fromDate: '2026-10-01',
      toDate: '2026-10-08',
      stationNames: ['Bindura'],
    });
    expect(metadata).toMatchObject({ reportTitle: 'Cash Evidence to Bank', stationCount: 1 });
    expect(
      toActivityItem({
        id: 'e1',
        eventCode: 'REPORT.SHARED',
        occurredAt: '2026-10-08T10:00:00.000Z',
        metadata,
      }),
    ).toMatchObject({
      kind: 'SHARED',
      headline: 'Cash Evidence to Bank link shared',
      detail: 'This month · Bindura',
    });
  });

  it('ignores other events and events without context', () => {
    expect(
      toActivityItem({
        id: 'e',
        eventCode: 'CUSTOMER.LEGAL_ENTITY_SET',
        occurredAt: '',
        metadata: {},
      }),
    ).toBeNull();
    expect(
      toActivityItem({ id: 'e', eventCode: 'REPORT.EXPORTED', occurredAt: '', metadata: null }),
    ).toBeNull();
  });

  it('rejects an unknown report slug', () => {
    expect(() =>
      buildReportEventMetadata({ slug: 'x', fromDate: 'a', toDate: 'b', stationNames: [] }),
    ).toThrow();
  });

  it('formats relative time', () => {
    const now = new Date('2026-10-08T12:00:00Z');
    expect(relativeTime('2026-10-08T11:59:30Z', now)).toBe('Just now');
    expect(relativeTime('2026-10-08T11:30:00Z', now)).toBe('30 min ago');
    expect(relativeTime('2026-10-08T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-10-05T12:00:00Z', now)).toBe('3 d ago');
    expect(relativeTime('2026-09-01T12:00:00Z', now)).toBe('2026-09-01');
  });
});
