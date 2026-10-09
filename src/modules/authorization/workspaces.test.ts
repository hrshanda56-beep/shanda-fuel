import { describe, expect, it } from 'vitest';
import { buildPermissionNavigationProjection, resolveLandingPath } from './workspaces';
import type { AuthorizationActor } from '../../platform/security';

const tenantId = '11111111-1111-4111-8111-111111111111';
const legalEntityId = '22222222-2222-4222-8222-222222222222';
const stationId = '33333333-3333-4333-8333-333333333333';

const stationScope = { tenantId, scopeType: 'STATION' as const, legalEntityId, stationId };

function actor(
  roleCode: AuthorizationActor['roleAssignments'][number]['roleCode'],
): AuthorizationActor {
  return {
    userId: '44444444-4444-4444-8444-444444444444',
    membershipId: '55555555-5555-4555-8555-555555555555',
    tenantId,
    membershipActive: true,
    roleAssignments: [{ ...stationScope, roleCode }],
  };
}

function visibleKeys(actorValue: AuthorizationActor) {
  return buildPermissionNavigationProjection({ actor: actorValue, scopes: [stationScope] })
    .filter((item) => item.visible)
    .map((item) => item.key);
}

describe('permission-driven workspaces', () => {
  it('keeps attendants on the minimal today workspace', () => {
    const value = actor('ATTENDANT');
    expect(resolveLandingPath({ actor: value, scopes: [stationScope] })).toBe('/today');
    expect(visibleKeys(value)).toEqual(['today']);
  });

  it('gives supervisors operations without management or finance navigation', () => {
    const value = actor('SUPERVISOR');
    expect(resolveLandingPath({ actor: value, scopes: [stationScope] })).toBe('/operations/daily');
    expect(visibleKeys(value)).toEqual([
      'today',
      'daily-operations',
      'reconciliations',
      'inventory',
      'cash',
      'settlements',
      'customers',
      'reports',
    ]);
  });

  it('uses finance permissions for the finance landing without relying on role labels for access', () => {
    const value = actor('FINANCE');
    expect(resolveLandingPath({ actor: value, scopes: [stationScope] })).toBe('/reports');
    const keys = visibleKeys(value);
    expect(keys).toContain('reports');
    expect(keys).toContain('customers');
    expect(keys).not.toContain('settings');
  });

  it('falls back when a role assignment does not carry its default permission', () => {
    const value = actor('ATTENDANT');
    const supervisorWithoutBusinessDay = {
      ...value,
      roleAssignments: [{ ...stationScope, roleCode: 'ATTENDANT' as const }],
    } satisfies AuthorizationActor;
    expect(
      resolveLandingPath({ actor: supervisorWithoutBusinessDay, scopes: [stationScope] }),
    ).toBe('/today');
  });
});
