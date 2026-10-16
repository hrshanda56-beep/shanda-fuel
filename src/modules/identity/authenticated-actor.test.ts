import { describe, expect, it } from 'vitest';
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
});
