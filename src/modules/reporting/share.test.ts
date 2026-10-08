import { describe, expect, it } from 'vitest';
import { privateReportPath } from './share';

const A = '11111111-1111-4111-8111-111111111111';

describe('privateReportPath', () => {
  it('keeps the report, tenant, stations and preset period', () => {
    expect(
      privateReportPath({
        slug: 'sales',
        tenantId: 't1',
        stationIds: [A],
        period: '3m',
        fromDate: '2026-07-09',
        toDate: '2026-10-08',
      }),
    ).toBe(`/reports/sales?tenantId=t1&stations=${A}&period=3m`);
  });

  it('keeps the dates only for a custom range', () => {
    expect(
      privateReportPath({
        slug: 'cash',
        tenantId: 't1',
        stationIds: [],
        period: 'custom',
        fromDate: '2026-08-01',
        toDate: '2026-08-31',
      }),
    ).toBe('/reports/cash?tenantId=t1&period=custom&from=2026-08-01&to=2026-08-31');
  });

  it('treats a missing or unknown period as a custom range', () => {
    expect(
      privateReportPath({
        slug: 'cash',
        tenantId: 't1',
        stationIds: [],
        fromDate: '2026-08-01',
        toDate: '2026-08-31',
      }),
    ).toContain('period=custom');
  });

  it('contains no credentials or tokens', () => {
    const path = privateReportPath({
      slug: 'sales',
      tenantId: 't1',
      stationIds: [],
      period: 'this-month',
      fromDate: '2026-10-01',
      toDate: '2026-10-08',
    });
    expect(path).not.toMatch(/token|key|secret|signature|session/i);
  });
});
