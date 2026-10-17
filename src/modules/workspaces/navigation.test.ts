import { describe, expect, it } from 'vitest';
import { buildLoginRedirectPath, safeNextPath, stationReconciliationsPath } from './navigation';

describe('workspace navigation safety', () => {
  it('preserves authenticated context in login redirects', () => {
    expect(
      buildLoginRedirectPath(
        'https://fuel.shandahr.com/stations/bindura?tenantId=tenant-1&stationId=station-2',
      ),
    ).toBe('/login?next=%2Fstations%2Fbindura%3FtenantId%3Dtenant-1%26stationId%3Dstation-2');
  });

  it('rejects external and backslash-based next destinations', () => {
    expect(safeNextPath('//evil.example', 'https://fuel.shandahr.com')).toBe('/');
    expect(safeNextPath('/%5Cevil.example', 'https://fuel.shandahr.com')).toBe('/');
    expect(safeNextPath('https://evil.example/path', 'https://fuel.shandahr.com')).toBe('/');
  });

  it('preserves a same-origin path, query and fragment', () => {
    expect(
      safeNextPath(
        '/?tenantId=tenant-1&stationId=station-2#workspace',
        'https://fuel.shandahr.com',
      ),
    ).toBe('/?tenantId=tenant-1&stationId=station-2#workspace');
  });

  it('builds station-specific reconciliation links with tenant context', () => {
    expect(stationReconciliationsPath('bindura', 'tenant-1')).toBe(
      '/stations/bindura/reconciliations?tenantId=tenant-1',
    );
  });
});
