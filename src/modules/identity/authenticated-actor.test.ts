import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertStepUp } from '../../platform/security';

const { durableLookup } = vi.hoisted(() => ({ durableLookup: vi.fn() }));
vi.mock('../../platform/db', () => ({
  getDatabase: () => ({ select: () => ({ from: () => ({ where: durableLookup }) }) }),
}));
import {
  requireAuthenticatedActor,
  revokeIdentitySessions,
  resolveAuthenticatedActor,
  type AuthenticatedActorContext,
} from './authenticated-actor';

const request = new Request('https://fuel.example.test/app/home');
const actor: AuthenticatedActorContext = {
  identityId: '11111111-1111-4111-8111-111111111111',
  session: {
    sessionId: '22222222-2222-4222-8222-222222222222',
    userId: '11111111-1111-4111-8111-111111111111',
    membershipId: '33333333-3333-4333-8333-333333333333',
    expiresAt: new Date('2026-09-20T11:00:00.000Z'),
  },
};

describe('authenticated actor resolver', () => {
  beforeEach(() => {
    durableLookup.mockReset().mockResolvedValue([]);
  });

  it('rejects an absent or expired Better Auth session result', async () => {
    await expect(requireAuthenticatedActor(request, async () => null)).rejects.toThrow(
      'Authentication is required',
    );
    await expect(
      requireAuthenticatedActor(
        request,
        async () => ({
          ...actor,
          session: { ...actor.session, expiresAt: new Date('2026-09-20T09:00:00.000Z') },
        }),
        new Date('2026-09-20T10:00:00.000Z'),
      ),
    ).rejects.toThrow('no longer active');
  });

  it('returns the validated actor context', async () => {
    await expect(
      requireAuthenticatedActor(request, async () => actor, new Date('2026-09-20T10:00:00.000Z')),
    ).resolves.toEqual(actor);
  });

  it('rejects mismatched Better Auth identity/session claims before a durable lookup', async () => {
    await expect(
      resolveAuthenticatedActor(
        request,
        {
          api: {
            getSession: async () => ({
              user: { id: actor.identityId },
              session: {
                id: actor.session.sessionId,
                userId: '66666666-6666-4666-8666-666666666666',
                expiresAt: actor.session.expiresAt,
              },
            }),
          },
        },
        new Date('2026-09-20T10:00:00.000Z'),
      ),
    ).rejects.toThrow('invalid');
  });

  it('fails closed when a Better Auth claim has no authoritative session record', async () => {
    await expect(
      resolveAuthenticatedActor(
        request,
        {
          api: {
            getSession: async () => ({
              user: { id: actor.identityId },
              session: {
                id: actor.session.sessionId,
                userId: actor.identityId,
                expiresAt: actor.session.expiresAt,
              },
            }),
          },
        },
        new Date('2026-09-20T10:00:00.000Z'),
      ),
    ).rejects.toThrow('invalid');
  });

  it('can revoke all sessions through Better Auth for identity compromise', async () => {
    let revoked = false;
    await revokeIdentitySessions(request, {
      api: {
        revokeSessions: async () => {
          revoked = true;
        },
      },
    });
    expect(revoked).toBe(true);
  });

  const provider = {
    api: {
      getSession: async () => ({
        user: { id: actor.identityId },
        session: {
          id: actor.session.sessionId,
          userId: actor.identityId,
          expiresAt: new Date('2030-01-01T00:00:00Z'),
          stepUpLevel: 1,
          stepUpExpiresAt: new Date('2030-01-01T00:00:00Z'),
        },
      }),
    },
  };

  it('uses durable assurance instead of a fresh provider claim', async () => {
    durableLookup.mockResolvedValue([
      {
        expiresAt: actor.session.expiresAt,
        strongAuthenticationVerified: true,
        strongAuthenticatedAt: new Date('2026-09-20T09:50:00Z'),
        strongAuthenticationExpiresAt: actor.session.expiresAt,
        stepUpLevel: 1,
        stepUpExpiresAt: new Date('2026-09-20T09:59:00Z'),
        stepUpTenantId: actor.identityId,
      },
    ]);
    const now = new Date('2026-09-20T10:00:00Z');
    const resolved = await resolveAuthenticatedActor(request, provider, now);
    expect(resolved?.session.sessionId).toBe(actor.session.sessionId);
    expect(() => assertStepUp(resolved!.session, 1, now, actor.identityId)).toThrow(
      'current step-up authentication',
    );
  });

  it('fails closed when the authoritative database lookup fails', async () => {
    durableLookup.mockRejectedValue(new Error('synthetic database lookup failure'));
    await expect(resolveAuthenticatedActor(request, provider)).rejects.toThrow(
      'synthetic database lookup failure',
    );
  });

  it.each([
    { expiresAt: new Date('2026-09-20T09:59:00Z') },
    { expiresAt: actor.session.expiresAt, revokedAt: new Date('2026-09-20T09:59:00Z') },
  ])('rejects inactive durable session state despite valid provider claims', async (durable) => {
    durableLookup.mockResolvedValue([durable]);
    await expect(
      resolveAuthenticatedActor(request, provider, new Date('2026-09-20T10:00:00Z')),
    ).rejects.toThrow();
  });
});
