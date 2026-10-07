import { describe, expect, it } from 'vitest';

import type { AuthorizationActor } from '../platform/security';
import { allowsE2ENavigationFixture, buildNavigationProjection } from './navigation-projection';

const scope = { tenantId: 'tenant-a', scopeType: 'TENANT' as const };

function actor(roleCode: 'OWNER' | 'SUPERVISOR' | 'ATTENDANT'): AuthorizationActor {
  return {
    userId: 'user-a',
    membershipId: 'membership-a',
    tenantId: 'tenant-a',
    membershipActive: true,
    roleAssignments: [
      {
        tenantId: 'tenant-a',
        roleCode,
        scopeType: 'TENANT',
      },
    ],
  };
}

describe('server navigation projection', () => {
  it('allows the synthetic projection only for the explicit non-production E2E fixture', () => {
    expect(allowsE2ENavigationFixture('e2e', 'synthetic')).toBe(true);
    expect(allowsE2ENavigationFixture('production', 'synthetic')).toBe(false);
    expect(allowsE2ENavigationFixture('e2e', null)).toBe(false);
  });

  it('projects only permissions granted to the actor', () => {
    const projection = buildNavigationProjection({ actor: actor('ATTENDANT'), scope });
    const visible = projection.filter((entry) => entry.visible).map((entry) => entry.key);

    expect(visible).toEqual([]);
    expect(projection.every((entry) => entry.visible === entry.enabled)).toBe(true);
  });

  it('keeps tenant-scoped owner navigation available', () => {
    const projection = buildNavigationProjection({ actor: actor('OWNER'), scope });
    expect(projection.filter((entry) => entry.visible).map((entry) => entry.key)).toEqual([
      'today',
      'daily-operations',
      'reconciliations',
      'inventory',
      'cash',
      'settlements',
      'customers',
      'suppliers',
      'reports',
      'settings',
    ]);
  });

  it('does not let a tenant-scoped grant project into another tenant', () => {
    const projection = buildNavigationProjection({
      actor: actor('OWNER'),
      scope: { tenantId: 'tenant-b', scopeType: 'TENANT' },
    });
    expect(projection.every((entry) => !entry.visible)).toBe(true);
  });
});
