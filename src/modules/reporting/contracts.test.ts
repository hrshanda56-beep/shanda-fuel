import { describe, expect, it } from 'vitest';
import { managementReportQuerySchema } from './contracts';

const tenantId = '11111111-1111-4111-8111-111111111111';
const a = '22222222-2222-4222-8222-222222222222';
const b = '33333333-3333-4333-8333-333333333333';

describe('management report query stations', () => {
  it('means every station when none is given', () => {
    const parsed = managementReportQuerySchema.parse({ tenantId });
    expect(parsed.stationIds).toEqual([]);
  });

  it('keeps the legacy single station working', () => {
    const parsed = managementReportQuerySchema.parse({ tenantId, stationId: a });
    expect(parsed.stationIds).toEqual([a]);
  });

  it('accepts a comma-separated list from a URL and sorts it', () => {
    const parsed = managementReportQuerySchema.parse({ tenantId, stationIds: `${b}, ${a},${b}` });
    expect(parsed.stationIds).toEqual([a, b]);
  });

  it('accepts an array', () => {
    expect(managementReportQuerySchema.parse({ tenantId, stationIds: [b, a] }).stationIds).toEqual([
      a,
      b,
    ]);
  });

  it('rejects a station that is not a uuid', () => {
    expect(() => managementReportQuerySchema.parse({ tenantId, stationIds: 'nope' })).toThrow();
  });
});
