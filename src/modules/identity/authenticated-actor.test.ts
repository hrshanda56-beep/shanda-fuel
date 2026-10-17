import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), revoke: vi.fn() }));
vi.mock('../../platform/auth/provider', () => ({
  resolveClerkSession: mocks.resolve,
  revokeClerkUserSessions: mocks.revoke,
}));
import {
  requireAuthenticatedActor,
  resolveAuthenticatedActor,
  revokeIdentitySessions,
} from './authenticated-actor';
const request = new Request('https://fuel.test');
const now = new Date('2026-10-17T10:00:00Z');
const session = {
  providerUserId: 'user_1',
  internalUserId: 'internal_1',
  providerSessionId: 'sess_1',
  expiresAt: new Date('2026-10-17T11:00:00Z'),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue(session);
});
describe('Clerk actor resolution and compromise revocation', () => {
  it('requires authentication', async () => {
    mocks.resolve.mockResolvedValue(null);
    expect(await resolveAuthenticatedActor(request, now)).toBeNull();
    await expect(requireAuthenticatedActor(request)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
  it('maps Clerk identity and rejects expired sessions', async () => {
    expect(await resolveAuthenticatedActor(request, now)).toMatchObject({
      identityId: 'internal_1',
      session: { sessionId: 'sess_1', userId: 'internal_1' },
    });
    await expect(
      resolveAuthenticatedActor(request, new Date('2026-10-17T12:00:00Z')),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('invalidates stale assurance including action and tenant binding', async () => {
    mocks.resolve.mockResolvedValue({
      ...session,
      strongAuthenticationVerified: true,
      strongAuthenticatedAt: now,
      strongAuthenticationExpiresAt: now,
      stepUpExpiresAt: now,
      stepUpLevel: 1,
      stepUpTenantId: 'tenant_1',
      stepUpAction: 'LOCK_BUSINESS_DAY',
    });
    const actor = await resolveAuthenticatedActor(request, now);
    expect(actor?.session.strongAuthenticationVerified).toBe(false);
    expect(actor?.session.stepUpAction).toBeUndefined();
    expect(actor?.session.stepUpTenantId).toBeUndefined();
  });
  it('revokes the provider identity sessions', async () => {
    mocks.revoke.mockResolvedValue({ complete: true });
    await revokeIdentitySessions(request);
    expect(mocks.revoke).toHaveBeenCalledWith('user_1');
  });
  it('fails when revocation is incomplete or unavailable', async () => {
    mocks.revoke.mockResolvedValue({ complete: false });
    await expect(revokeIdentitySessions(request)).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    mocks.revoke.mockRejectedValue(new Error('unavailable'));
    await expect(revokeIdentitySessions(request)).rejects.toThrow('unavailable');
  });
  it('does not claim anonymous sessions were revoked', async () => {
    mocks.resolve.mockResolvedValue(null);
    await expect(revokeIdentitySessions(request)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
