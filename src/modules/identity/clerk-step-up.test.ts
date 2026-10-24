import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLERK_DEACTIVATE_STAFF_ACTION,
  CLERK_STEP_UP_ACTION,
  type ClerkReverificationLevel,
} from '../../platform/auth/clerk-step-up';

const mocks = vi.hoisted(() => ({
  resolveClerkSession: vi.fn(),
  clerkUserHasMfa: vi.fn(),
  hasRecentClerkReverification: vi.fn(),
  appendSecurityEvent: vi.fn(),
  withTenantTransaction: vi.fn(async (_context: unknown, callback: (transaction: {}) => unknown) =>
    callback({}),
  ),
}));

vi.mock('../../platform/auth/provider', () => ({
  resolveClerkSession: mocks.resolveClerkSession,
  clerkUserHasMfa: mocks.clerkUserHasMfa,
  hasRecentClerkReverification: mocks.hasRecentClerkReverification,
}));

vi.mock('../../platform/db', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}));

vi.mock('../audit/contracts', () => ({
  appendSecurityEvent: mocks.appendSecurityEvent,
}));

import { ClerkReverificationRequiredError, establishStepUp } from './step-up';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  actor: '22222222-2222-4222-8222-222222222222',
  membership: '33333333-3333-4333-8333-333333333333',
  session: 'sess_123',
};

const now = new Date('2026-10-11T10:00:00.000Z');

function request(cookie?: string): Request {
  return new Request('https://fuel.example.test/api/auth/step-up', {
    headers: cookie ? { cookie } : undefined,
  });
}

function context(
  overrides: Partial<{
    identityId: string;
    tenantId: string;
    transactionTenantId: string;
    owner: boolean;
  }> = {},
) {
  const identityId = overrides.identityId ?? ids.actor;
  const tenantId = overrides.tenantId ?? ids.tenant;
  return {
    actor: {
      identityId,
      session: {
        sessionId: ids.session,
        userId: identityId,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    },
    membership: {
      tenantId,
      membershipId: ids.membership,
      identityId,
      actorId: identityId,
      status: 'ACTIVE' as const,
      roleAssignments:
        overrides.owner === false
          ? []
          : [{ tenantId, scopeType: 'TENANT' as const, roleCode: 'OWNER' as const }],
      temporaryGrants: [],
    },
    authorization: {
      userId: identityId,
      membershipId: ids.membership,
      tenantId,
      membershipActive: true,
      roleAssignments: [],
      temporaryGrants: [],
    },
    transaction: { tenantId: overrides.transactionTenantId ?? tenantId },
  } as never;
}

function providerSession() {
  return {
    provider: 'CLERK' as const,
    providerUserId: 'user_clerk_owner',
    internalUserId: ids.actor,
    providerSessionId: ids.session,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  };
}

function cookieFromChallenge(error: ClerkReverificationRequiredError): string {
  return error.challengeCookie.split(';', 1)[0]!;
}

async function establish(cookie?: string) {
  return establishStepUp({
    request: request(cookie),
    context: context(),
    action: CLERK_STEP_UP_ACTION,
    now,
  });
}

describe('Clerk privileged step-up policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('REQUIRE_LOGIN_MFA', 'false');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_fake_clerk_fixture');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_fake_clerk_fixture');
    vi.stubEnv('AUDIT_SIGNING_KEY_ID', 'test-step-up-key');
    vi.stubEnv('AUDIT_SIGNING_KEY', 'test-step-up-secret-that-is-long-enough');
    mocks.resolveClerkSession.mockResolvedValue(providerSession());
    mocks.clerkUserHasMfa.mockResolvedValue(false);
    mocks.hasRecentClerkReverification.mockReturnValue(false);
  });

  it('requires explicit Clerk reverification and then authorizes an eligible no-MFA Owner', async () => {
    let challenge: ClerkReverificationRequiredError;
    try {
      await establish();
      throw new Error('expected a reverification challenge');
    } catch (error) {
      expect(error).toBeInstanceOf(ClerkReverificationRequiredError);
      challenge = error as ClerkReverificationRequiredError;
    }

    expect(challenge!.level).toBe('strict');
    mocks.hasRecentClerkReverification.mockImplementation(
      (_request: Request, level: ClerkReverificationLevel) => level === 'strict',
    );

    const result = await establish(cookieFromChallenge(challenge!));

    expect(result.level).toBe(1);
    expect(result.setCookie).toContain('shanda-fuel.clerk-step-up=');
    expect(mocks.hasRecentClerkReverification).toHaveBeenCalledWith(expect.any(Request), 'strict');
  });

  it('fails closed when audit signing credentials are unavailable after reverification', async () => {
    let challenge: ClerkReverificationRequiredError;
    try {
      await establish();
      throw new Error('expected a reverification challenge');
    } catch (error) {
      expect(error).toBeInstanceOf(ClerkReverificationRequiredError);
      challenge = error as ClerkReverificationRequiredError;
    }

    const originalKeyId = process.env.AUDIT_SIGNING_KEY_ID;
    const originalSecret = process.env.AUDIT_SIGNING_KEY;
    delete process.env.AUDIT_SIGNING_KEY_ID;
    delete process.env.AUDIT_SIGNING_KEY;
    mocks.hasRecentClerkReverification.mockReturnValue(true);

    try {
      await expect(establish(cookieFromChallenge(challenge!))).rejects.toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        httpStatus: 503,
      });
    } finally {
      if (originalKeyId === undefined) delete process.env.AUDIT_SIGNING_KEY_ID;
      else process.env.AUDIT_SIGNING_KEY_ID = originalKeyId;
      if (originalSecret === undefined) delete process.env.AUDIT_SIGNING_KEY;
      else process.env.AUDIT_SIGNING_KEY = originalSecret;
    }
  });

  it('binds staff deactivation to its own no-MFA Owner step-up action', async () => {
    await expect(
      establishStepUp({
        request: request(),
        context: context(),
        action: CLERK_DEACTIVATE_STAFF_ACTION,
        now,
      }),
    ).rejects.toMatchObject({ level: 'strict' });
  });

  it('requires MFA for an Owner when login MFA policy is enabled', async () => {
    vi.stubEnv('REQUIRE_LOGIN_MFA', 'true');
    await expect(establish()).rejects.toMatchObject({ level: 'strict_mfa' });
  });

  it('requires strict MFA for a Clerk user with MFA enrolled', async () => {
    mocks.clerkUserHasMfa.mockResolvedValue(true);

    let challenge: ClerkReverificationRequiredError;
    try {
      await establish();
      throw new Error('expected a strict MFA challenge');
    } catch (error) {
      challenge = error as ClerkReverificationRequiredError;
    }
    expect(challenge!.level).toBe('strict_mfa');

    await expect(establish(cookieFromChallenge(challenge!))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.hasRecentClerkReverification).toHaveBeenCalledWith(
      expect.any(Request),
      'strict_mfa',
    );

    mocks.hasRecentClerkReverification.mockReturnValue(true);
    await expect(establish(cookieFromChallenge(challenge!))).resolves.toMatchObject({ level: 1 });
  });

  it('rejects missing and stale reverification evidence', async () => {
    let challenge: ClerkReverificationRequiredError;
    try {
      await establish();
      throw new Error('expected a reverification challenge');
    } catch (error) {
      challenge = error as ClerkReverificationRequiredError;
    }

    await expect(
      establishStepUp({
        request: request(cookieFromChallenge(challenge!)),
        context: context(),
        action: CLERK_STEP_UP_ACTION,
        now: new Date(now.getTime() + 6 * 60_000),
      }),
    ).rejects.toBeInstanceOf(ClerkReverificationRequiredError);

    await expect(establish(cookieFromChallenge(challenge!))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('fails closed when identity mapping or tenant authority is missing', async () => {
    mocks.resolveClerkSession.mockResolvedValueOnce(null);
    await expect(establish()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    mocks.resolveClerkSession.mockResolvedValue(providerSession());
    await expect(
      establishStepUp({
        request: request(),
        context: context({ identityId: '99999999-9999-4999-8999-999999999999' }),
        action: CLERK_STEP_UP_ACTION,
        now,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      establishStepUp({
        request: request(),
        context: context({ transactionTenantId: '99999999-9999-4999-8999-999999999999' }),
        action: CLERK_STEP_UP_ACTION,
        now,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      establishStepUp({
        request: request(),
        context: context({ owner: false }),
        action: CLERK_STEP_UP_ACTION,
        now,
      }),
    ).rejects.toBeInstanceOf(ClerkReverificationRequiredError);
  });
});
