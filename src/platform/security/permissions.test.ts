import { describe, expect, it } from 'vitest';
import {
  authorize,
  assertRoleMutationAllowed,
  DEFAULT_ROLE_PERMISSIONS,
  isAuthorized,
  isPermissionGranted,
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
  strongAuthenticationVerified: true,
  stepUpTenantId: tenantId,
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
        permissionCode: 'station.view',
        requestedScope: { tenantId, scopeType: 'STATION', legalEntityId, stationId },
      }),
    ).toBe(true);
  });

  it('denies a station grant in another station or tenant', () => {
    expect(
      isAuthorized({
        actor,
        permissionCode: 'station.view',
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
        permissionCode: 'station.view',
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
        permissionCode: 'membership.manage',
        requestedScope: { tenantId, scopeType: 'STATION', legalEntityId, stationId },
      }),
    ).toBe(false);
  });

  it('requires privileged assurance to be bound to the requested tenant', () => {
    const requestedScope = { tenantId, scopeType: 'STATION' as const, legalEntityId, stationId };
    expect(
      isPermissionGranted({
        actor: { ...actor, stepUpTenantId: undefined },
        permissionCode: 'meter.reset',
        requestedScope,
      }),
    ).toBe(true);
    expect(
      isAuthorized({
        actor: { ...actor, stepUpTenantId: undefined },
        permissionCode: 'meter.reset',
        requestedScope,
      }),
    ).toBe(false);
    expect(
      isAuthorized({
        actor: { ...actor, stepUpTenantId: '77777777-7777-4777-8777-777777777777' },
        permissionCode: 'meter.reset',
        requestedScope,
      }),
    ).toBe(false);
  });

  it('says a check is needed, not that the person is refused, when only the step-up is missing', () => {
    const requestedScope = { tenantId, scopeType: 'STATION' as const, legalEntityId, stationId };
    const withoutCheck = { ...actor, stepUpTenantId: undefined };
    let thrown: unknown;
    try {
      authorize({ actor: withoutCheck, permissionCode: 'meter.reset', requestedScope });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'STEP_UP_REQUIRED',
      httpStatus: 403,
      details: { stepUpRequired: true, permissionCode: 'meter.reset' },
    });
    expect((thrown as Error).message).toMatch(/step-up/);
    // A person who does not hold the permission at all is still simply refused.
    expect(() =>
      authorize({ actor: withoutCheck, permissionCode: 'membership.manage', requestedScope }),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('does not let generic approval authority lock a business day', () => {
    const genericApprovalOnly: AuthorizationActor = {
      ...actor,
      strongAuthenticationExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      roleAssignments: [],
      temporaryGrants: [
        {
          permissionCode: 'approval.act',
          tenantId,
          scopeType: 'STATION',
          legalEntityId,
          stationId,
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        },
      ],
    };
    const requestedScope = { tenantId, scopeType: 'STATION' as const, legalEntityId, stationId };
    expect(
      isAuthorized({ actor: genericApprovalOnly, permissionCode: 'approval.act', requestedScope }),
    ).toBe(true);
    expect(
      isAuthorized({
        actor: genericApprovalOnly,
        permissionCode: 'business_day.lock',
        requestedScope,
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

  it('does not authorize a revoked temporary grant', () => {
    const temporaryActor = {
      ...actor,
      roleAssignments: [],
      temporaryGrants: [
        {
          permissionCode: 'report.view' as const,
          tenantId,
          scopeType: 'TENANT' as const,
          expiresAt: new Date('2026-09-20T18:00:00.000Z'),
          revokedAt: new Date('2026-09-20T09:00:00.000Z'),
        },
      ],
    };
    expect(
      isAuthorized({
        actor: temporaryActor,
        permissionCode: 'report.view',
        requestedScope: { tenantId, scopeType: 'TENANT' },
        now: new Date('2026-09-20T10:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('keeps the default catalogue centrally defined', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.OWNER).toContain('audit.view');
    expect(DEFAULT_ROLE_PERMISSIONS.ATTENDANT).not.toContain('membership.manage');
    expect(
      scopeCovers(
        { tenantId, scopeType: 'TENANT' },
        { tenantId, scopeType: 'STATION', legalEntityId, stationId },
      ),
    ).toBe(true);
  });

  it('keeps customer lifecycle management with OWNER and ADMINISTRATOR', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.OWNER).toContain('customer.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.ADMINISTRATOR).toContain('customer.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.FINANCE).not.toContain('customer.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.FINANCE).not.toContain('customer.account.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.FINANCE).not.toContain('customer.account.adjust');
    expect(DEFAULT_ROLE_PERMISSIONS.FINANCE).not.toContain('customer.limit.override');
    expect(DEFAULT_ROLE_PERMISSIONS.FINANCE).toContain('customer.payment.record');
    expect(DEFAULT_ROLE_PERMISSIONS.FINANCE).toContain('customer.credit.authorize');
  });

  it('lets Finance send a reconciliation back but not a supervisor or attendant', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.FINANCE).toContain('reconciliation.return');
    expect(DEFAULT_ROLE_PERMISSIONS.SUPERVISOR).not.toContain('reconciliation.return');
    expect(DEFAULT_ROLE_PERMISSIONS.ATTENDANT).not.toContain('reconciliation.return');
  });

  it('rejects a tenant scope carrying narrower identifiers', () => {
    expect(() =>
      scopeCovers(
        { tenantId, scopeType: 'TENANT', legalEntityId },
        { tenantId, scopeType: 'TENANT' },
      ),
    ).toThrow('narrower identifiers');
  });

  it('protects ownership and prevents self-elevation', () => {
    expect(() =>
      assertRoleMutationAllowed({
        actorMembershipId: 'same',
        targetMembershipId: 'same',
        targetRoleCode: 'ADMINISTRATOR',
        operation: 'GRANT',
        targetCurrentlyOwner: false,
        activeOwnerCount: 2,
      }),
    ).toThrow('own role assignment');
    expect(() =>
      assertRoleMutationAllowed({
        actorMembershipId: 'owner-a',
        targetMembershipId: 'owner-b',
        targetRoleCode: 'OWNER',
        operation: 'REVOKE',
        targetCurrentlyOwner: true,
        activeOwnerCount: 1,
      }),
    ).toThrow('last active owner');
    expect(() =>
      assertRoleMutationAllowed({
        actorMembershipId: 'owner-a',
        targetMembershipId: 'member-b',
        targetRoleCode: 'OWNER',
        operation: 'GRANT',
        targetCurrentlyOwner: false,
        activeOwnerCount: 1,
      }),
    ).toThrow('ownership transfer');
  });

  it('never grants the A3 forecourt high-impact permissions to ATTENDANT', () => {
    // A3 review finding: ATTENDANT must remain limited to routine boundary
    // capture (station.view, shift.view, meter.view, meter.boundary.capture,
    // tenant.context.select) and must never carry the named authoritative
    // capabilities reserved for SUPERVISOR/ADMINISTRATOR/FINANCE/OWNER.
    const highImpactA3Permissions = [
      'shift.template.manage',
      'price.change.prepare',
      'reconciliation.submit',
      'price.change.boundary',
      'meter.reset',
      'meter.replace',
      'meter.correction.execute',
      'exception.manage',
    ] as const;
    const attendantPermissions = DEFAULT_ROLE_PERMISSIONS.ATTENDANT;
    expect(attendantPermissions).not.toContain('reconciliation.view');
    expect(attendantPermissions).not.toContain('reconciliation.submit');
    expect(attendantPermissions).toContain('meter.boundary.capture');
    for (const permissionCode of highImpactA3Permissions) {
      expect(attendantPermissions).not.toContain(permissionCode);
    }
  });

  it('keeps cash collection recording separate from receipt and bank confirmation authority', () => {
    const requestedScope = { tenantId, scopeType: 'STATION' as const, legalEntityId, stationId };
    expect(isAuthorized({ actor, permissionCode: 'cash.collection.record', requestedScope })).toBe(
      true,
    );
    expect(isAuthorized({ actor, permissionCode: 'cash.collection.receive', requestedScope })).toBe(
      false,
    );
    expect(isAuthorized({ actor, permissionCode: 'cash.deposit.confirm', requestedScope })).toBe(
      false,
    );
    expect(
      isAuthorized({
        actor: {
          ...actor,
          strongAuthenticationAt: new Date('2030-01-01T08:00:00.000Z'),
          strongAuthenticationExpiresAt: new Date('2030-01-01T18:00:00.000Z'),
          roleAssignments: [
            {
              ...actor.roleAssignments[0]!,
              roleCode: 'ADMINISTRATOR',
            },
          ],
        },
        permissionCode: 'cash.deposit.confirm',
        requestedScope,
      }),
    ).toBe(true);
  });
});
