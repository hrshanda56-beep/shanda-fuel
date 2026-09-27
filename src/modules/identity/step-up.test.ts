import { describe, expect, it, vi } from 'vitest';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import type { TenantExecutionContext } from '../tenancy/authority';
import { establishStepUp, STEP_UP_TTL_MS } from './step-up';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  actor: '22222222-2222-4222-8222-222222222222',
  membership: '33333333-3333-4333-8333-333333333333',
  session: '44444444-4444-4444-8444-444444444444',
  request: '55555555-5555-4555-8555-555555555555',
};

const now = new Date('2026-09-27T10:00:00.000Z');

function context(): TenantExecutionContext {
  const transaction = createTrustedTenantTransactionContext({
    tenantId: ids.tenant,
    actorId: ids.actor,
    membershipId: ids.membership,
    requestId: ids.request,
  });
  const session = {
    sessionId: ids.session,
    userId: ids.actor,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  };
  return {
    actor: { identityId: ids.actor, session },
    membership: {
      tenantId: ids.tenant,
      membershipId: ids.membership,
      identityId: ids.actor,
      actorId: ids.actor,
      status: 'ACTIVE',
      roleAssignments: [],
      temporaryGrants: [],
    },
    authorization: {
      userId: ids.actor,
      membershipId: ids.membership,
      tenantId: ids.tenant,
      membershipActive: true,
      roleAssignments: [],
      temporaryGrants: [],
    },
    transaction,
  };
}

function dependencies() {
  return {
    auth: {
      api: {
        getSession: vi.fn().mockResolvedValue({ user: { twoFactorEnabled: true } }),
        verifyPassword: vi.fn().mockResolvedValue({ status: true }),
        verifyTOTP: vi.fn().mockResolvedValue({ status: true }),
      },
    },
    persistence: {
      recordFailure: vi.fn().mockResolvedValue(undefined),
      establish: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('production step-up establishment', () => {
  it('verifies password and TOTP and establishes a short-lived tenant-bound result', async () => {
    const deps = dependencies();
    const request = new Request('https://fuel.example.test/api/auth/step-up', {
      headers: { cookie: 'shanda-fuel.session=bound-session' },
    });

    const result = await establishStepUp({
      request,
      context: context(),
      password: 'correct-password',
      totpCode: '123456',
      now,
      dependencies: deps,
    });

    expect(result).toEqual({
      level: 1,
      tenantId: ids.tenant,
      expiresAt: new Date(now.getTime() + STEP_UP_TTL_MS).toISOString(),
    });
    expect(deps.auth.api.verifyPassword).toHaveBeenCalledWith({
      headers: request.headers,
      body: { password: 'correct-password' },
    });
    expect(deps.auth.api.verifyTOTP).toHaveBeenCalledWith({
      headers: request.headers,
      body: { code: '123456' },
    });
    expect(deps.persistence.establish).toHaveBeenCalledWith(
      expect.objectContaining({ membership: expect.objectContaining({ tenantId: ids.tenant }) }),
      now,
      new Date(now.getTime() + STEP_UP_TTL_MS),
    );
    expect(deps.persistence.recordFailure).not.toHaveBeenCalled();
  });

  it('does not establish assurance after a failed challenge and records the failure', async () => {
    const deps = dependencies();
    deps.auth.api.verifyPassword.mockRejectedValue(new Error('invalid password'));

    await expect(
      establishStepUp({
        request: new Request('https://fuel.example.test/api/auth/step-up'),
        context: context(),
        password: 'wrong-password',
        totpCode: '123456',
        now,
        dependencies: deps,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(deps.persistence.recordFailure).toHaveBeenCalledTimes(1);
    expect(deps.persistence.recordFailure).toHaveBeenCalledWith(expect.anything(), now, 'password');
    expect(deps.persistence.establish).not.toHaveBeenCalled();
  });

  it('treats a provider response without successful status as a failed challenge', async () => {
    const deps = dependencies();
    deps.auth.api.verifyPassword.mockResolvedValue({ status: false });

    await expect(
      establishStepUp({
        request: new Request('https://fuel.example.test/api/auth/step-up'),
        context: context(),
        password: 'wrong-password',
        totpCode: '123456',
        now,
        dependencies: deps,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(deps.persistence.recordFailure).toHaveBeenCalledTimes(1);
  });

  it('does not establish assurance when TOTP verification fails', async () => {
    const deps = dependencies();
    deps.auth.api.verifyTOTP.mockResolvedValue({ status: false });

    await expect(
      establishStepUp({
        request: new Request('https://fuel.example.test/api/auth/step-up'),
        context: context(),
        password: 'correct-password',
        totpCode: '000000',
        now,
        dependencies: deps,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(deps.persistence.recordFailure).toHaveBeenCalledWith(expect.anything(), now, 'totp');
    expect(deps.persistence.establish).not.toHaveBeenCalled();
  });
});
