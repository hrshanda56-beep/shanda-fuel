import { describe, expect, it } from 'vitest';
import type { AuthorizationActor, RoleCode } from '../../platform/security/permissions';
import { resolveSetupCapabilities } from './capabilities';

const tenantId = '11111111-1111-4111-8111-111111111111';
const stationId = '33333333-3333-4333-8333-333333333333';
const legalEntityId = '22222222-2222-4222-8222-222222222222';

const actorWith = (roleCode: RoleCode, scopeType: 'TENANT' | 'STATION' = 'TENANT') =>
  ({
    userId: '44444444-4444-4444-8444-444444444444',
    membershipId: '55555555-5555-4555-8555-555555555555',
    tenantId,
    membershipActive: true,
    // No fresh identity check: the person signed in some time ago and has not re-verified.
    roleAssignments: [
      scopeType === 'TENANT'
        ? { roleCode, tenantId, scopeType }
        : { roleCode, tenantId, scopeType, legalEntityId, stationId },
    ],
  }) as AuthorizationActor;

const stationScope = { tenantId, scopeType: 'STATION', legalEntityId, stationId } as const;

describe('resolveSetupCapabilities', () => {
  it.each(['OWNER', 'ADMINISTRATOR'] as const)(
    'lets %s finish every setup step without a fresh identity check',
    (role) => {
      const { capabilities } = resolveSetupCapabilities(actorWith(role), stationScope);
      expect(capabilities).toEqual({
        products: true,
        tanks: true,
        forecourt: true,
        shiftTemplates: true,
        priceRequest: true,
        priceApprove: true,
        priceActivate: true,
        suppliers: true,
      });
    },
  );

  it('does not offer fuel types or pumps to an attendant', () => {
    const { capabilities } = resolveSetupCapabilities(actorWith('ATTENDANT'), stationScope);
    expect(capabilities.products).toBe(false);
    expect(capabilities.forecourt).toBe(false);
  });

  it('does not offer another station to an owner assigned to one station only', () => {
    const other = { ...stationScope, stationId: '66666666-6666-4666-8666-666666666666' };
    const { capabilities } = resolveSetupCapabilities(actorWith('OWNER', 'STATION'), other);
    expect(capabilities.products).toBe(false);
  });
});
