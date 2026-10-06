import { describe, expect, it } from 'vitest';

import { parseManagementReportQuery } from './queries';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('management report date defaults', () => {
  it('uses the server-resolved station date when the request omits a date', () => {
    expect(
      parseManagementReportQuery(
        { tenantId, stationId: '22222222-2222-4222-8222-222222222222' },
        '2026-10-05',
      ),
    ).toMatchObject({ fromDate: '2026-10-05', toDate: '2026-10-05' });
  });

  it('preserves an explicit report date rather than replacing it', () => {
    expect(
      parseManagementReportQuery(
        { tenantId, fromDate: '2026-09-01', toDate: '2026-09-03' },
        '2026-10-05',
      ),
    ).toMatchObject({ fromDate: '2026-09-01', toDate: '2026-09-03' });
  });
});
