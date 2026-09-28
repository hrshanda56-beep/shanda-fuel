import { describe, expect, it } from 'vitest';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import type { SessionRecord } from '../../platform/security';
import {
  assertCustomerCommandAuthorization,
  CUSTOMER_COMMAND_POLICY,
  type CustomerCommandContext,
} from './application';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  legalEntity: '22222222-2222-4222-8222-222222222222',
  station: '33333333-3333-4333-8333-333333333333',
  actor: '44444444-4444-4444-8444-444444444444',
  membership: '55555555-5555-4555-8555-555555555555',
  request: '66666666-6666-4666-8666-666666666666',
};

function context(sessionOverrides: Partial<SessionRecord> = {}): CustomerCommandContext {
  const session: SessionRecord = {
    sessionId: '77777777-7777-4777-8777-777777777777',
    userId: ids.actor,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    stepUpTenantId: ids.tenant,
    ...sessionOverrides,
  };
  const transaction = createTrustedTenantTransactionContext({
    tenantId: ids.tenant,
    actorId: ids.actor,
    membershipId: ids.membership,
    requestId: ids.request,
  });
  const roleAssignment = {
    tenantId: ids.tenant,
    scopeType: 'TENANT' as const,
    roleCode: 'FINANCE' as const,
  };
  const authority = {
    actor: { identityId: ids.actor, session },
    membership: {
      tenantId: ids.tenant,
      membershipId: ids.membership,
      identityId: ids.actor,
      actorId: ids.actor,
      status: 'ACTIVE' as const,
      roleAssignments: [roleAssignment],
      temporaryGrants: [],
    },
    authorization: {
      userId: ids.actor,
      membershipId: ids.membership,
      tenantId: ids.tenant,
      membershipActive: true,
      strongAuthenticationAt: session.strongAuthenticatedAt,
      strongAuthenticationExpiresAt: session.strongAuthenticationExpiresAt,
      strongAuthenticationVerified: session.strongAuthenticationVerified,
      stepUpLevel: session.stepUpLevel,
      stepUpTenantId: session.stepUpTenantId,
      roleAssignments: [roleAssignment],
      temporaryGrants: [],
    },
    transaction,
  };
  return {
    authority,
    tenantId: ids.tenant,
    requestId: ids.request,
    scope: { tenantId: ids.tenant, scopeType: 'TENANT' },
  };
}

describe('customer command assurance', () => {
  const command = {
    commandType: 'CreateCustomerAccount' as const,
    permissionCode: 'customer.account.manage' as const,
  };

  it('keeps customer policy declarations and enforces requiresStepUp', () => {
    expect(CUSTOMER_COMMAND_POLICY.CreateCustomerAccount?.requiresStepUp).toBe(true);
    const now = Date.now();

    expect(() =>
      assertCustomerCommandAuthorization({
        context: context({
          strongAuthenticatedAt: new Date(now - 60_000),
          strongAuthenticationExpiresAt: new Date(now + 30 * 60_000),
          strongAuthenticationVerified: true,
        }),
        ...command,
      }),
    ).toThrow(/step-up/);
  });

  it('rejects an expired step-up and an insufficient level', () => {
    const now = Date.now();
    const strongAuth = {
      strongAuthenticatedAt: new Date(now - 60_000),
      strongAuthenticationExpiresAt: new Date(now + 30 * 60_000),
      strongAuthenticationVerified: true,
    };
    expect(() =>
      assertCustomerCommandAuthorization({
        context: context({
          ...strongAuth,
          stepUpLevel: 0,
          stepUpExpiresAt: new Date(now + 10 * 60_000),
        }),
        ...command,
      }),
    ).toThrow(/step-up/);
    expect(() =>
      assertCustomerCommandAuthorization({
        context: context({
          ...strongAuth,
          stepUpLevel: 1,
          stepUpExpiresAt: new Date(now - 60_000),
        }),
        ...command,
      }),
    ).toThrow(/step-up/);
  });

  it('rejects expired strong authentication and accepts a valid active step-up', () => {
    const now = Date.now();
    expect(() =>
      assertCustomerCommandAuthorization({
        context: context({
          strongAuthenticatedAt: new Date(now - 60_000),
          strongAuthenticationExpiresAt: new Date(now - 60_000),
          strongAuthenticationVerified: true,
          stepUpLevel: 2,
          stepUpExpiresAt: new Date(now + 10 * 60_000),
        }),
        ...command,
      }),
    ).toThrow(/not authorized|Strong authentication/);

    expect(() =>
      assertCustomerCommandAuthorization({
        context: context({
          strongAuthenticatedAt: new Date(now - 60_000),
          strongAuthenticationExpiresAt: new Date(now + 30 * 60_000),
          strongAuthenticationVerified: true,
          stepUpLevel: 1,
          stepUpExpiresAt: new Date(now + 10 * 60_000),
        }),
        ...command,
      }),
    ).not.toThrow();
  });

  it('rejects permission-policy drift before command execution', () => {
    expect(() =>
      assertCustomerCommandAuthorization({
        context: context({
          strongAuthenticatedAt: new Date(Date.now() - 60_000),
          strongAuthenticationExpiresAt: new Date(Date.now() + 30 * 60_000),
          strongAuthenticationVerified: true,
          stepUpLevel: 1,
          stepUpExpiresAt: new Date(Date.now() + 10 * 60_000),
        }),
        commandType: 'CreateCustomerAccount',
        permissionCode: 'customer.view',
      }),
    ).toThrow(/permission does not match its authorization policy/);
  });
});
