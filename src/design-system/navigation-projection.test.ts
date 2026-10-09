import { describe, expect, it } from 'vitest';

import type { AuthorizationActor } from '../platform/security';
import {
  allowsE2ENavigationFixture,
  buildNavigationProjection,
  isAttendantWorkspaceActor,
} from './navigation-projection';

const scope = { tenantId: 'tenant-a', scopeType: 'TENANT' as const };

function actor(roleCode: 'OWNER' | 'SUPERVISOR' | 'FINANCE' | 'ATTENDANT'): AuthorizationActor {
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

  it('gives an attendant only My Shift and no management destination', () => {
    const projection = buildNavigationProjection({ actor: actor('ATTENDANT'), scope });
    const visible = projection.filter((entry) => entry.visible).map((entry) => entry.key);

    expect(visible).toEqual(['my-shift']);
    expect(projection.every((entry) => entry.visible === entry.enabled)).toBe(true);
  });

  it('decides the attendant landing from permissions, not the role name', () => {
    const attendant = actor('ATTENDANT');
    expect(isAttendantWorkspaceActor({ actor: attendant, scope })).toBe(true);
    // A supervisor holds the same shift/meter permissions plus management ones.
    expect(isAttendantWorkspaceActor({ actor: actor('SUPERVISOR'), scope })).toBe(false);
    expect(isAttendantWorkspaceActor({ actor: actor('OWNER'), scope })).toBe(false);
    // Without shift/meter permissions there is no attendant workspace either.
    const stranger: AuthorizationActor = { ...attendant, roleAssignments: [] };
    expect(isAttendantWorkspaceActor({ actor: stranger, scope })).toBe(false);
  });

  it('keeps supervisor navigation unchanged and never adds My Shift to it', () => {
    const visible = buildNavigationProjection({ actor: actor('SUPERVISOR'), scope })
      .filter((entry) => entry.visible)
      .map((entry) => entry.key);
    expect(visible).not.toContain('my-shift');
    expect(visible).toEqual(
      expect.arrayContaining(['today', 'daily-operations', 'reconciliations']),
    );
  });

  it('routes finance users to the authorized reports workspace without settings access', () => {
    const projection = buildNavigationProjection({ actor: actor('FINANCE'), scope });
    const visible = projection.filter((entry) => entry.visible).map((entry) => entry.key);

    expect(visible).toContain('reports');
    expect(visible).toContain('customers');
    expect(visible).not.toContain('my-shift');
  });

  it('does not show My Shift for a station the attendant is not assigned to', () => {
    const stationActor: AuthorizationActor = {
      ...actor('ATTENDANT'),
      roleAssignments: [
        {
          tenantId: 'tenant-a',
          roleCode: 'ATTENDANT',
          scopeType: 'STATION',
          legalEntityId: 'le-a',
          stationId: 'station-a',
        },
      ],
    };
    const own = {
      tenantId: 'tenant-a',
      scopeType: 'STATION' as const,
      legalEntityId: 'le-a',
      stationId: 'station-a',
    };
    expect(isAttendantWorkspaceActor({ actor: stationActor, scope: own })).toBe(true);
    expect(
      isAttendantWorkspaceActor({ actor: stationActor, scope: { ...own, stationId: 'station-b' } }),
    ).toBe(false);
    expect(
      isAttendantWorkspaceActor({
        actor: stationActor,
        scope: { ...own, tenantId: 'tenant-b' },
      }),
    ).toBe(false);
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
