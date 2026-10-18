import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getAuth: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ getAuth: mocks.getAuth, clerkClient: vi.fn() }));
vi.mock('../db', () => ({
  getDatabase: () => ({ transaction: mocks.transaction, execute: mocks.execute }),
}));
import { resolveClerkSession } from './provider';
import { issueClerkStepUpAssertion } from './clerk-step-up';
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe('Clerk session boundary', () => {
  it.each([true, false])(
    'honors login MFA policy %s when consuming an Owner assertion',
    async (requireMfa) => {
      vi.stubEnv('REQUIRE_LOGIN_MFA', String(requireMfa));
      vi.stubEnv('AUDIT_SIGNING_KEY_ID', 'unit-test');
      vi.stubEnv('AUDIT_SIGNING_KEY', 'unit-test-signing-secret-long-enough');
      mocks.getAuth.mockReturnValue({
        isAuthenticated: true,
        userId: 'user_1',
        sessionId: 'sess_1',
        sessionClaims: { exp: 2100000000 },
        factorVerificationAge: [0, -1],
      });
      mocks.transaction.mockImplementation(async (callback: Function) =>
        callback({ execute: mocks.execute }),
      );
      mocks.execute.mockResolvedValue([{ internal_user_id: 'internal_1' }]);
      const cookie = issueClerkStepUpAssertion({
        providerSessionId: 'sess_1',
        internalUserId: 'internal_1',
        tenantId: 'tenant_1',
        action: 'LOCK_BUSINESS_DAY',
        level: 'strict',
      }).split(';', 1)[0]!;
      const session = await resolveClerkSession(
        new Request('https://fuel.test', { headers: { cookie } }),
      );
      expect(session?.strongAuthenticationVerified).toBe(!requireMfa);
      expect(session?.stepUpTenantId).toBe(requireMfa ? undefined : 'tenant_1');
    },
  );
  it('does not resolve an anonymous identity', async () => {
    mocks.getAuth.mockReturnValue({ isAuthenticated: false });
    expect(await resolveClerkSession(new Request('https://fuel.test'))).toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('denies an unprovisioned identity', async () => {
    mocks.getAuth.mockReturnValue({ isAuthenticated: true, userId: 'user_1', sessionId: 'sess_1' });
    mocks.execute.mockResolvedValue([]);
    await expect(resolveClerkSession(new Request('https://fuel.test'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it.each([
    [-1, -1],
    [0, -1],
    [10, 10],
    [NaN, 0],
    [Infinity, 0],
  ])('rejects invalid or stale factor ages %j', async (first, second) => {
    mocks.getAuth.mockReturnValue({
      isAuthenticated: true,
      userId: 'user_1',
      sessionId: 'sess_1',
      sessionClaims: { exp: 2100000000 },
      factorVerificationAge: [first, second],
    });
    mocks.transaction.mockImplementation(async (callback: Function) =>
      callback({ execute: mocks.execute }),
    );
    mocks.execute.mockResolvedValue([{ internal_user_id: 'internal_1' }]);
    const session = await resolveClerkSession(new Request('https://fuel.test'));
    expect(session?.strongAuthenticationVerified).toBe(false);
  });
  it('accepts verified recent MFA without inventing a tenant/action grant', async () => {
    mocks.getAuth.mockReturnValue({
      isAuthenticated: true,
      userId: 'user_1',
      sessionId: 'sess_1',
      sessionClaims: { exp: 2100000000 },
      factorVerificationAge: [0, 1],
    });
    mocks.transaction.mockImplementation(async (callback: Function) =>
      callback({ execute: mocks.execute }),
    );
    mocks.execute.mockResolvedValue([{ internal_user_id: 'internal_1' }]);
    const session = await resolveClerkSession(new Request('https://fuel.test'));
    expect(session).toMatchObject({
      internalUserId: 'internal_1',
      strongAuthenticationVerified: true,
      strongAuthenticationMethod: 'clerk-mfa',
    });
    expect(session?.stepUpTenantId).toBeUndefined();
    expect(session?.stepUpAction).toBeUndefined();
  });
});

it('returns identity and persisted GET authority from one parameterized database call', async () => {
  vi.stubEnv('CONSOLIDATED_CONTEXT_READS', '1');
  mocks.getAuth.mockReturnValue({
    isAuthenticated: true,
    userId: 'user_combined',
    sessionId: 'sess_combined',
    sessionClaims: { exp: 2100000000 },
  });
  const snapshot: unknown[] = [];
  mocks.execute.mockResolvedValue([
    { internal_user_id: '11111111-1111-4111-8111-111111111111', navigation_snapshot: snapshot },
  ]);
  const session = await resolveClerkSession(new Request('http://localhost/api/probe'));
  expect(session?.navigationSnapshot).toBe(snapshot);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it('keeps mutation authentication separate from navigation discovery', async () => {
  vi.stubEnv('CONSOLIDATED_CONTEXT_READS', '1');
  mocks.getAuth.mockReturnValue({
    isAuthenticated: true,
    userId: 'user_mutation',
    sessionId: 'sess_mutation',
    sessionClaims: { exp: 2100000000 },
  });
  mocks.execute.mockResolvedValue([{ internal_user_id: '11111111-1111-4111-8111-111111111111' }]);
  const session = await resolveClerkSession(
    new Request('http://localhost/api/probe', { method: 'POST' }),
  );
  expect(session?.navigationSnapshot).toBeUndefined();
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});
