import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionExecute = vi.hoisted(() => vi.fn());
const resolveAuthority = vi.hoisted(() => vi.fn());
const authorize = vi.hoisted(() => vi.fn());
const appendSecurityEvent = vi.hoisted(() => vi.fn());

vi.mock('../../platform/db/transaction', () => ({
  withTenantTransaction: vi.fn(async (_context, work) => work({ execute: transactionExecute })),
}));
vi.mock('../tenancy/server', () => ({ resolveTenantExecutionContext: resolveAuthority }));
vi.mock('../../platform/security/permissions', () => ({ authorize }));
vi.mock('../audit/contracts', () => ({ appendSecurityEvent }));
vi.mock('../../platform/config/env', () => ({
  getAuditSigningKey: vi.fn(() => ({ keyId: 'test', secret: 'test' })),
  getServerEnv: vi.fn(() => ({ APP_URL: 'http://localhost:3101' })),
}));
vi.mock('../../platform/db', () => ({ getDatabase: vi.fn() }));
vi.mock('../../platform/email', () => ({ createResendEmailSender: vi.fn() }));
vi.mock('../identity', () => ({ requireAuthenticatedActor: vi.fn() }));
vi.mock('./queries', () => ({ resolveInvitationView: vi.fn() }));
vi.mock('../../platform/auth/provider', () => ({
  createClerkCredentialIdentity: vi.fn(),
  deleteClerkCredentialIdentity: vi.fn(),
  getAuthProviderName: vi.fn(() => 'CLERK'),
  revokeClerkUserSessions: vi.fn(),
}));

import { deactivateStaffMemberFromRequest, signUpFromInvitation } from './commands';

const tenantId = '10000000-0000-4000-8000-000000000001';
const ownerMembershipId = '10000000-0000-4000-8000-000000000021';
const targetMembershipId = '10000000-0000-4000-8000-000000000022';
const request = new Request('http://localhost:3101/api/staff/commands');

const authority = {
  actor: {
    identityId: '10000000-0000-4000-8000-000000000011',
    session: {
      sessionId: '10000000-0000-4000-8000-000000000051',
      userId: '10000000-0000-4000-8000-000000000011',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      strongAuthenticatedAt: new Date('2026-10-12T10:00:00.000Z'),
      strongAuthenticationExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      strongAuthenticationVerified: true,
      stepUpLevel: 2,
      stepUpExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      stepUpTenantId: tenantId,
    },
  },
  membership: {
    tenantId,
    membershipId: ownerMembershipId,
    identityId: '10000000-0000-4000-8000-000000000011',
    actorId: '10000000-0000-4000-8000-000000000011',
    status: 'ACTIVE',
    roleAssignments: [],
    temporaryGrants: [],
  },
  authorization: {
    roleAssignments: [{ tenantId, scopeType: 'TENANT', roleCode: 'OWNER' }],
    temporaryGrants: [],
  },
  transaction: {
    tenantId,
    actorId: '10000000-0000-4000-8000-000000000011',
    membershipId: ownerMembershipId,
    requestId: '10000000-0000-4000-8000-000000000099',
  },
} as never;

function body() {
  return { commandType: 'DeactivateStaffMember', tenantId, membershipId: targetMembershipId };
}

function setupTransaction(targetStatus: 'ACTIVE' | 'DISABLED', providerUserId?: string) {
  transactionExecute
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { identity_id: '10000000-0000-4000-8000-000000000012', status: targetStatus },
    ])
    .mockResolvedValueOnce(providerUserId ? [{ provider_user_id: providerUserId }] : []);
  if (targetStatus === 'ACTIVE') {
    transactionExecute.mockResolvedValueOnce([{ count: '2' }]).mockResolvedValueOnce([]);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveAuthority.mockResolvedValue(authority);
  authorize.mockImplementation(() => undefined);
});

describe('Clerk staff deactivation revocation contract', () => {
  it('rejects local credential signup before database access', async () => {
    await expect(signUpFromInvitation({ token: 'unused', password: 'unused' })).rejects.toThrow(
      'Create your account with Clerk',
    );
    expect(transactionExecute).not.toHaveBeenCalled();
  });

  it('returns REVOKED only after complete provider revocation', async () => {
    setupTransaction('ACTIVE', 'clerk_user_redacted');
    const revokeClerkSessions = vi.fn().mockResolvedValue({
      activeSessionsFound: 1,
      sessionsRevoked: 1,
      complete: true,
    });

    await expect(
      deactivateStaffMemberFromRequest(request, body(), {
        revokeClerkSessions,
      }),
    ).resolves.toMatchObject({
      sessionsRevoked: true,
      revocationStatus: 'REVOKED',
    });
    expect(revokeClerkSessions).toHaveBeenCalledWith('clerk_user_redacted');
  });

  it('returns MAPPING_MISSING and never claims revocation when mapping is absent', async () => {
    setupTransaction('ACTIVE');
    const revokeClerkSessions = vi.fn();

    await expect(
      deactivateStaffMemberFromRequest(request, body(), {
        revokeClerkSessions,
      }),
    ).resolves.toMatchObject({
      sessionsRevoked: false,
      revocationStatus: 'MAPPING_MISSING',
    });
    expect(revokeClerkSessions).not.toHaveBeenCalled();
  });

  it('returns PROVIDER_ERROR while preserving the disabled membership for retry', async () => {
    setupTransaction('ACTIVE', 'clerk_user_redacted');
    const revokeClerkSessions = vi.fn().mockRejectedValue(new Error('provider unavailable'));

    await expect(
      deactivateStaffMemberFromRequest(request, body(), {
        revokeClerkSessions,
      }),
    ).resolves.toMatchObject({
      sessionsRevoked: false,
      revocationStatus: 'PROVIDER_ERROR',
    });
  });

  it('retries provider revocation for an already-disabled target', async () => {
    setupTransaction('DISABLED', 'clerk_user_redacted');
    const revokeClerkSessions = vi.fn().mockResolvedValue({
      activeSessionsFound: 0,
      sessionsRevoked: 0,
      complete: true,
    });

    await expect(
      deactivateStaffMemberFromRequest(request, body(), {
        revokeClerkSessions,
      }),
    ).resolves.toMatchObject({
      sessionsRevoked: true,
      revocationStatus: 'NO_ACTIVE_SESSIONS',
    });
    expect(revokeClerkSessions).toHaveBeenCalledWith('clerk_user_redacted');
  });

  it('authorizes the actor before opening the target transaction', async () => {
    authorize.mockImplementationOnce(() => {
      throw new Error('unauthorized actor');
    });

    await expect(deactivateStaffMemberFromRequest(request, body(), {})).rejects.toThrow(
      'unauthorized actor',
    );
    expect(transactionExecute).not.toHaveBeenCalled();
  });

  it('rejects deactivation without current step-up before opening the target transaction', async () => {
    const typedAuthority = authority as unknown as {
      actor: { identityId: string; session: Record<string, unknown> };
    };
    resolveAuthority.mockResolvedValueOnce({
      ...(authority as unknown as Record<string, unknown>),
      actor: {
        ...typedAuthority.actor,
        session: {
          ...typedAuthority.actor.session,
          stepUpLevel: undefined,
          stepUpExpiresAt: undefined,
        },
      },
    } as never);

    await expect(deactivateStaffMemberFromRequest(request, body(), {})).rejects.toThrow('step-up');
    expect(authorize).not.toHaveBeenCalled();
    expect(transactionExecute).not.toHaveBeenCalled();
  });
});
