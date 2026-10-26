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

import {
  deactivateStaffMemberFromRequest,
  signUpFromInvitation,
  generateManualStaffActivationFromRequest,
  updateStaffAssignmentFromRequest,
} from './commands';
import { getDatabase } from '../../platform/db';

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
      stepUpAction: 'DEACTIVATE_STAFF_MEMBER',
      strongAuthenticationMethod: 'clerk-mfa',
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
  it('regenerates a code for the existing staff number and appends an audit event', async () => {
    transactionExecute.mockReset();
    transactionExecute
      .mockResolvedValueOnce([
        {
          id: targetMembershipId,
          status: 'PENDING',
          delivery_method: 'MANUAL',
          staff_number_registry_id: ownerMembershipId,
          staff_number: 'SF-12345678',
        },
      ])
      .mockResolvedValueOnce([]);
    const result = await generateManualStaffActivationFromRequest(request, {
      commandType: 'GenerateManualStaffActivation',
      tenantId,
      invitationId: targetMembershipId,
    });
    expect(result.staffNumber).toBe('SF-12345678');
    expect(result.activationCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(transactionExecute).toHaveBeenCalledTimes(2);
    expect(appendSecurityEvent).toHaveBeenCalled();
  });
  it('rejects invalid signup input before database access', async () => {
    await expect(signUpFromInvitation({ token: 'unused', password: 'short' })).rejects.toThrow();
    expect(transactionExecute).not.toHaveBeenCalled();
  });

  it('creates an invited Clerk account and registers its mapping', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          invited_email: 'invited@example.test',
          invited_name: 'Invited user',
          existing_identity: false,
        },
      ])
      .mockResolvedValueOnce([]);
    vi.mocked(getDatabase).mockReturnValue({
      transaction: async (work: Function) => work({ execute }),
    } as never);
    const createClerkIdentity = vi.fn().mockResolvedValue({ providerUserId: 'user_invited' });
    await expect(
      signUpFromInvitation(
        { token: 'a'.repeat(43), password: 'valid-fixture-password' },
        { createClerkIdentity },
      ),
    ).resolves.toEqual({ email: 'invited@example.test' });
    expect(createClerkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'invited@example.test' }),
    );
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('cleans up the provider identity if database registration fails', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          invited_email: 'invited@example.test',
          invited_name: 'Invited user',
          existing_identity: false,
        },
      ])
      .mockRejectedValueOnce(new Error('registration failed'));
    vi.mocked(getDatabase).mockReturnValue({
      transaction: async (work: Function) => work({ execute }),
    } as never);
    const createClerkIdentity = vi.fn().mockResolvedValue({ providerUserId: 'user_invited' });
    const deleteClerkIdentity = vi.fn().mockResolvedValue(undefined);
    await expect(
      signUpFromInvitation(
        { token: 'a'.repeat(43), password: 'valid-fixture-password' },
        { createClerkIdentity, deleteClerkIdentity },
      ),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(deleteClerkIdentity).toHaveBeenCalledWith('user_invited');
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

describe("Changing a staff member's access", () => {
  const stationId = '10000000-0000-4000-8000-0000000000a1';
  const entityId = '10000000-0000-4000-8000-0000000000b1';
  const change = {
    commandType: 'UpdateStaffAssignment',
    tenantId,
    membershipId: targetMembershipId,
    assignedRole: 'SUPERVISOR',
    scopeType: 'STATION',
    legalEntityId: entityId,
    stationIds: [stationId],
  };
  function privilegedAuthority(overrides: Record<string, unknown> = {}) {
    const typed = authority as unknown as { actor: { session: Record<string, unknown> } };
    return {
      ...(authority as unknown as Record<string, unknown>),
      actor: {
        ...typed.actor,
        session: { ...typed.actor.session, stepUpAction: 'PRIVILEGED_OPERATION', ...overrides },
      },
    } as never;
  }

  it('needs a current step-up and touches nothing without it', async () => {
    resolveAuthority.mockResolvedValueOnce(privilegedAuthority({ stepUpExpiresAt: undefined }));
    await expect(updateStaffAssignmentFromRequest(request, change)).rejects.toThrow('step-up');
    expect(transactionExecute).not.toHaveBeenCalled();
  });

  it('will not let someone change their own access', async () => {
    resolveAuthority.mockResolvedValueOnce(privilegedAuthority());
    await expect(
      updateStaffAssignmentFromRequest(request, { ...change, membershipId: ownerMembershipId }),
    ).rejects.toThrow('your own access');
    expect(transactionExecute).not.toHaveBeenCalled();
  });

  it('refuses to demote the last active owner', async () => {
    resolveAuthority.mockResolvedValueOnce(privilegedAuthority());
    transactionExecute
      .mockResolvedValueOnce([]) // tenant lock
      .mockResolvedValueOnce([{ status: 'ACTIVE' }]) // target
      .mockResolvedValueOnce([{ role_code: 'OWNER', scope_type: 'TENANT' }]) // current
      .mockResolvedValueOnce([{ count: '1' }]); // owners
    await expect(updateStaffAssignmentFromRequest(request, change)).rejects.toThrow(
      'last active owner',
    );
    expect(appendSecurityEvent).not.toHaveBeenCalled();
  });

  it('replaces the assignments and writes an audit event', async () => {
    resolveAuthority.mockResolvedValueOnce(privilegedAuthority());
    transactionExecute
      .mockResolvedValueOnce([]) // tenant lock
      .mockResolvedValueOnce([{ status: 'ACTIVE' }]) // target
      .mockResolvedValueOnce([
        {
          role_code: 'ATTENDANT',
          scope_type: 'STATION',
          legal_entity_id: entityId,
          station_id: 'x',
        },
      ]) // current
      .mockResolvedValueOnce([{ station_id: stationId }]) // station check
      .mockResolvedValue([]); // delete + insert
    const result = await updateStaffAssignmentFromRequest(request, change);
    expect(result).toMatchObject({ role: 'SUPERVISOR', scopeType: 'STATION' });
    expect(appendSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: 'STAFF.ASSIGNMENT_CHANGED',
        subjectId: targetMembershipId,
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('only lets an owner change an administrator', async () => {
    const typed = privilegedAuthority() as unknown as Record<string, unknown>;
    resolveAuthority.mockResolvedValueOnce({
      ...typed,
      authorization: {
        roleAssignments: [{ tenantId, scopeType: 'TENANT', roleCode: 'ADMINISTRATOR' }],
        temporaryGrants: [],
      },
    } as never);
    transactionExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ role_code: 'ADMINISTRATOR', scope_type: 'TENANT' }]);
    await expect(updateStaffAssignmentFromRequest(request, change)).rejects.toThrow(
      'Only an owner',
    );
  });
});
