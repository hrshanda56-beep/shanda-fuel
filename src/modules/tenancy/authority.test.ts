import { describe, expect, it } from 'vitest';
import { AppError } from '../../platform/errors';
import type { AuthenticatedActorContext } from '../identity';
import { resolveTenantExecutionContext, type MembershipRecord } from './authority';

const tenantId = '11111111-1111-4111-8111-111111111111';
const identityId = '22222222-2222-4222-8222-222222222222';
const membershipId = '33333333-3333-4333-8333-333333333333';
const actor: AuthenticatedActorContext = {
  identityId,
  session: {
    sessionId: '44444444-4444-4444-8444-444444444444',
    userId: identityId,
    expiresAt: new Date('2026-09-20T11:00:00.000Z'),
  },
};

function membership(status: MembershipRecord['status']): MembershipRecord {
  return {
    tenantId,
    membershipId,
    identityId,
    actorId: identityId,
    status,
    roleAssignments: [
      {
        tenantId,
        scopeType: 'TENANT',
        roleCode: 'SUPERVISOR',
      },
    ],
    temporaryGrants: [],
  };
}

describe('tenant authority resolver', () => {
  it('authenticates before validating the requested tenant identifier', async () => {
    const calls: string[] = [];

    await expect(
      resolveTenantExecutionContext({
        request: new Request('https://fuel.example.test'),
        requestedTenantId: 'not-a-uuid',
        resolveActor: async () => {
          calls.push('authenticate');
          throw new AppError('UNAUTHENTICATED', 'Authentication is required');
        },
        loadMembership: async () => {
          calls.push('load-membership');
          return null;
        },
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(calls).toEqual(['authenticate']);
  });

  it.each(['INVITED', 'SUSPENDED', 'LOCKED', 'DISABLED'] as const)(
    'denies a %s membership before creating transaction authority',
    async (status) => {
      await expect(
        resolveTenantExecutionContext({
          request: new Request('https://fuel.example.test'),
          requestedTenantId: tenantId,
          resolveActor: async () => actor,
          loadMembership: async () => membership(status),
          now: new Date('2026-09-20T10:00:00.000Z'),
        }),
      ).rejects.toThrow('active membership');
    },
  );

  it('requires persisted membership instead of trusting a raw tenant UUID', async () => {
    await expect(
      resolveTenantExecutionContext({
        request: new Request('https://fuel.example.test'),
        requestedTenantId: tenantId,
        resolveActor: async () => actor,
        loadMembership: async () => null,
        now: new Date('2026-09-20T10:00:00.000Z'),
      }),
    ).rejects.toThrow('no membership');
  });

  it('creates a trusted transaction context only for an active membership', async () => {
    const resolved = await resolveTenantExecutionContext({
      request: new Request('https://fuel.example.test'),
      requestedTenantId: tenantId,
      resolveActor: async () => actor,
      loadMembership: async () => membership('ACTIVE'),
      now: new Date('2026-09-20T10:00:00.000Z'),
    });

    expect(resolved.transaction).toMatchObject({ tenantId, actorId: identityId, membershipId });
    expect(resolved.authorization.membershipActive).toBe(true);
    expect(resolved.membership.status).toBe('ACTIVE');
  });
});
