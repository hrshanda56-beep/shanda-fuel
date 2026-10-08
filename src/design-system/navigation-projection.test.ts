import { describe, expect, it } from 'vitest';

import type { AuthorizationActor } from '../platform/security';
import {
  allowsE2ENavigationFixture,
  buildNavigationProjection,
  resolveE2EEntryFixture,
} from './navigation-projection';

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
    expect(allowsE2ENavigationFixture('test', 'synthetic')).toBe(true);
    expect(allowsE2ENavigationFixture('e2e', 'synthetic')).toBe(false);
    expect(allowsE2ENavigationFixture('production', 'synthetic')).toBe(false);
    expect(allowsE2ENavigationFixture('test', 'synthetic', 'production')).toBe(false);
    expect(allowsE2ENavigationFixture('test', null)).toBe(false);
  });

  it('allows entry-state fixtures only in the test environment', () => {
    expect(resolveE2EEntryFixture('test', 'unavailable')).toBe('unavailable');
    expect(resolveE2EEntryFixture('test', 'no-authorised-context')).toBe('no-authorised-context');
    expect(resolveE2EEntryFixture('test', 'choose-context')).toBe('choose-context');
    expect(resolveE2EEntryFixture('production', 'unavailable')).toBeNull();
    expect(resolveE2EEntryFixture('test', 'unavailable', 'production')).toBeNull();
    expect(resolveE2EEntryFixture('test', 'unknown')).toBeNull();
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
