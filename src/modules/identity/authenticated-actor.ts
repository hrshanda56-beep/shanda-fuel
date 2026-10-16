import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '../../platform/db';
import { authSession } from '../../platform/db/schema';
import { AppError } from '../../platform/errors';
import {
  assertSessionActive,
  invalidateExpiredAssurance,
  type SessionRecord,
} from '../../platform/security';
import { getAuth } from '../../platform/auth';
import {
  getAuthProviderName,
  resolveClerkSession,
  revokeClerkUserSessions,
} from '../../platform/auth/provider';

/**
 * Adapter boundary for Better Auth. Better Auth resolves identity/session
 * mechanics; Shanda Fuel adds membership and business authorization context.
 */
export type AuthenticatedActorContext = {
  identityId: string;
  session: SessionRecord;
};

export type AuthenticatedActorResolver = (
  request: Request,
) => Promise<AuthenticatedActorContext | null>;

export type BetterAuthSessionReader = {
  api: {
    getSession: (input: {
      headers: Headers;
      query?: { disableCookieCache?: boolean };
    }) => Promise<unknown>;
  };
};

export type BetterAuthPasswordVerifier = {
  api: {
    getSession: (input: {
      headers: Headers;
      query?: { disableCookieCache?: boolean };
    }) => Promise<unknown>;
    verifyPassword: (input: { headers: Headers; body: { password: string } }) => Promise<unknown>;
    verifyTOTP: (input: { headers: Headers; body: { code: string } }) => Promise<unknown>;
  };
};

export type BetterAuthSessionRevoker = {
  api: {
    revokeSessions: (input: { headers: Headers }) => Promise<unknown>;
  };
};

export type BetterAuthServer = BetterAuthSessionReader & BetterAuthSessionRevoker;

const betterAuthSessionSchema = z.object({
  user: z.object({ id: z.string().uuid() }),
  session: z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    expiresAt: z.coerce.date(),
    revokedAt: z.coerce.date().nullable().optional(),
    strongAuthenticatedAt: z.coerce.date().nullable().optional(),
    strongAuthenticationExpiresAt: z.coerce.date().nullable().optional(),
    strongAuthenticationVerified: z
      .boolean()
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    stepUpLevel: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    stepUpExpiresAt: z.coerce.date().nullable().optional(),
    stepUpTenantId: z.string().uuid().nullable().optional(),
  }),
});

/** Resolve the current server session from Better Auth; browser claims are ignored. */
export async function resolveAuthenticatedActor(
  request: Request,
  auth?: BetterAuthSessionReader,
  now = new Date(),
): Promise<AuthenticatedActorContext | null> {
  if (getAuthProviderName() === 'CLERK') {
    const providerSession = await resolveClerkSession(request);
    if (!providerSession) return null;
    const session: SessionRecord = {
      sessionId: providerSession.providerSessionId,
      userId: providerSession.internalUserId,
      expiresAt: providerSession.expiresAt,
      strongAuthenticatedAt: providerSession.strongAuthenticatedAt,
      strongAuthenticationExpiresAt: providerSession.strongAuthenticationExpiresAt,
      strongAuthenticationVerified: providerSession.strongAuthenticationVerified,
      stepUpLevel: providerSession.stepUpLevel,
      stepUpExpiresAt: providerSession.stepUpExpiresAt,
      stepUpTenantId: providerSession.stepUpTenantId,
      stepUpAction: providerSession.stepUpAction,
      strongAuthenticationMethod: providerSession.strongAuthenticationMethod,
    };
    assertSessionActive(session, now);
    return {
      identityId: providerSession.internalUserId,
      session: invalidateExpiredAssurance(session, now),
    };
  }
  const result = await (auth ?? (await getAuth())).api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!result) return null;
  const parsed = betterAuthSessionSchema.safeParse(result);
  if (!parsed.success || parsed.data.user.id !== parsed.data.session.userId) {
    throw new AppError('UNAUTHENTICATED', 'The authentication session is invalid');
  }
  const session: SessionRecord = {
    sessionId: parsed.data.session.id,
    userId: parsed.data.session.userId,
    // Better Auth may return a previously serialized session. Privileged
    // authorization must use the durable assurance state, so an expired or
    // revoked session cannot be accepted from a cache.
    ...(await loadAuthoritativeBetterAuthSession(parsed.data.session.id, parsed.data.user.id)),
  };
  assertSessionActive(session, now);
  return { identityId: parsed.data.user.id, session: invalidateExpiredAssurance(session, now) };
}

async function loadAuthoritativeBetterAuthSession(
  sessionId: string,
  userId: string,
): Promise<Omit<SessionRecord, 'sessionId' | 'userId'>> {
  const rows = await getDatabase()
    .select({
      expiresAt: authSession.expiresAt,
      revokedAt: authSession.revokedAt,
      strongAuthenticatedAt: authSession.strongAuthenticatedAt,
      strongAuthenticationExpiresAt: authSession.strongAuthenticationExpiresAt,
      strongAuthenticationVerified: authSession.strongAuthenticationVerified,
      stepUpLevel: authSession.stepUpLevel,
      stepUpExpiresAt: authSession.stepUpExpiresAt,
      stepUpTenantId: authSession.stepUpTenantId,
    })
    .from(authSession)
    .where(and(eq(authSession.id, sessionId), eq(authSession.userId, userId)));
  const session = rows[0];
  if (!session) throw new AppError('UNAUTHENTICATED', 'The authentication session is invalid');
  return {
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt ?? undefined,
    strongAuthenticatedAt: session.strongAuthenticatedAt ?? undefined,
    strongAuthenticationExpiresAt: session.strongAuthenticationExpiresAt ?? undefined,
    strongAuthenticationVerified: session.strongAuthenticationVerified ?? undefined,
    stepUpLevel: (session.stepUpLevel ?? undefined) as 0 | 1 | 2 | undefined,
    stepUpExpiresAt: session.stepUpExpiresAt ?? undefined,
    stepUpTenantId: session.stepUpTenantId ?? undefined,
  };
}

/** Revoke all Better Auth sessions for the authenticated identity on compromise. */
export async function revokeIdentitySessions(
  request: Request,
  auth?: BetterAuthSessionRevoker,
): Promise<void> {
  if (getAuthProviderName() === 'CLERK') {
    const session = await resolveClerkSession(request);
    if (session) await revokeClerkUserSessions(session.providerUserId);
    return;
  }
  await (auth ?? (await getAuth())).api.revokeSessions({ headers: request.headers });
}

export async function requireAuthenticatedActor(
  request: Request,
  resolve: AuthenticatedActorResolver = resolveAuthenticatedActor,
  now = new Date(),
): Promise<AuthenticatedActorContext> {
  const actor = await resolve(request);
  if (!actor) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  assertSessionActive(actor.session, now);
  return actor;
}
