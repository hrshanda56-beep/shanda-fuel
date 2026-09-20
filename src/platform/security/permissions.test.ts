import { describe, expect, it } from 'vitest';
import {
  authorize,
  DEFAULT_ROLE_PERMISSIONS,
  isAuthorized,
  scopeCovers,
  type AuthorizationActor,
} from './permissions';

const tenantId = '11111111-1111-4111-8111-111111111111';
const legalEntityId = '22222222-2222-4222-8222-222222222222';
const stationId = '33333333-3333-4333-8333-333333333333';
const actor: AuthorizationActor = {
  userId: '44444444-4444-4444-8444-444444444444',
  membershipId: '55555555-5555-4555-8555-555555555555',
  tenantId,
  membershipActive: true,
  strongAuthenticationAt: new Date('2026-09-20T08:00:00.000Z'),
  strongAuthenticationExpiresAt: new Date('2026-09-20T18:00:00.000Z'),
  roleAssignments: [
    {
      roleCode: 'SUPERVISOR',
      tenantId,
      scopeType: 'STATION',
      legalEntityId,
      stationId,
    },
  ],
};

describe('permission authorization', () => {
  it('uses permission codes and permits a station-scoped supervisor action', () => {
    expect(
      isAuthorized({
        actor,
        permissionCode: 'shift.start',
        requestedScope: { tenantId, scopeType: 'STATION', legalEntityId, stationId },
      }),
    ).toBe(true);
  });

  it('denies a station grant in another station or tenant', () => {
    expect(
      isAuthorized({
        actor,
        permissionCode: 'shift.start',
        requestedScope: {
          tenantId,
          scopeType: 'STATION',
          legalEntityId,
          stationId: '66666666-6666-4666-8666-666666666666',
        },
      }),
    ).toBe(false);
    expect(
      isAuthorized({
        actor,
        permissionCode: 'shift.start',
        requestedScope: {
          tenantId: '77777777-7777-4777-8777-777777777777',
          scopeType: 'TENANT',
        },
      }),
    ).toBe(false);
  });

  it('requires strong authentication for high-risk permission codes', () => {
    expect(
      isAuthorized({
        actor: { ...actor, strongAuthenticationAt: undefined },
        permissionCode: 'reconciliation.post',
        requestedScope: { tenantId, scopeType: 'STATION', legalEntityId, stationId },
      }),
    ).toBe(false);
  });

  it('expires temporary grants and throws a safe forbidden error', () => {
    const now = new Date('2026-09-20T10:00:00.000Z');
    const temporaryActor = {
      ...actor,
      roleAssignments: [],
      temporaryGrants: [
        {
          permissionCode: 'report.export' as const,
          tenantId,
          scopeType: 'TENANT' as const,
          expiresAt: new Date('2026-09-20T09:00:00.000Z'),
        },
      ],
    };
    expect(
      isAuthorized({
        actor: temporaryActor,
        permissionCode: 'report.export',
        requestedScope: { tenantId, scopeType: 'TENANT' },
        now,
      }),
    ).toBe(false);
    expect(() =>
      authorize({
        actor: temporaryActor,
        permissionCode: 'report.export',
        requestedScope: { tenantId, scopeType: 'TENANT' },
        now,
      }),
    ).toThrow('not authorized');
  });

  it('keeps the default catalogue centrally defined', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.OWNER).toContain('audit.view');
    expect(DEFAULT_ROLE_PERMISSIONS.ATTENDANT).not.toContain('bank.account.manage');
    expect(
      scopeCovers(
        { tenantId, scopeType: 'TENANT' },
        { tenantId, scopeType: 'STATION', legalEntityId, stationId },
      ),
    ).toBe(true);
  });
});
