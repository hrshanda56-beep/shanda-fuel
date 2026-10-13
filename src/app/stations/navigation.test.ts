import { describe, expect, it } from 'vitest';
import { stationReconciliationsPath } from './navigation';

describe('station navigation', () => {
  it('preserves the selected station and tenant in reconciliation breadcrumbs', () => {
    expect(stationReconciliationsPath('bindura', 'tenant-1')).toBe(
      '/stations/bindura/reconciliations?tenantId=tenant-1',
    );
  });
});
