import 'server-only';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import {
  assertSessionActive,
  invalidateExpiredAssurance,
  type SessionRecord,
} from '../../platform/security';
import { getAuth } from '../../platform/auth';

/**
 * Adapter boundary for Better Auth. Better Auth resolves identity/session
 * mechanics; Shanda Fuel adds membership and business authorization context.
 */
export type AuthenticatedActorContext = {
  identityId: string;
  session: SessionRecord;
  displayName?: string;
  email?: string;
};

export type AuthenticatedActorResolver = (
  request: Request,
) => Promise<AuthenticatedActorContext | null>;

export type BetterAuthSessionReader = {
  api: {
    getSession: (input: {
      headers: Headers;
      query?: { disableCookieCache?: boolean; disableRefresh?: boolean };
    }) => Promise<unknown>;
  };
};

export type BetterAuthPasswordVerifier = {
  api: {
    getSession: (input: {
      headers: Headers;
      query?: { disableCookieCache?: boolean; disableRefresh?: boolean };
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
  user: z.object({
    id: z.string().uuid(),
    name: z.string().optional(),
    email: z.string().email().optional(),
  }),
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
  auth: BetterAuthSessionReader = getAuth(),
  now = new Date(),
): Promise<AuthenticatedActorContext | null> {
  const result = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!result) return null;
  const parsed = betterAuthSessionSchema.safeParse(result);
  if (!parsed.success || parsed.data.user.id !== parsed.data.session.userId) {
    throw new AppError('UNAUTHENTICATED', 'The authentication session is invalid');
  }
  const session: SessionRecord = {
    sessionId: parsed.data.session.id,
    userId: parsed.data.session.userId,
    expiresAt: parsed.data.session.expiresAt,
    revokedAt: parsed.data.session.revokedAt ?? undefined,
    strongAuthenticatedAt: parsed.data.session.strongAuthenticatedAt ?? undefined,
    strongAuthenticationExpiresAt: parsed.data.session.strongAuthenticationExpiresAt ?? undefined,
    strongAuthenticationVerified: parsed.data.session.strongAuthenticationVerified,
    stepUpLevel: parsed.data.session.stepUpLevel,
    stepUpExpiresAt: parsed.data.session.stepUpExpiresAt ?? undefined,
    stepUpTenantId: parsed.data.session.stepUpTenantId ?? undefined,
  };
  assertSessionActive(session, now);
  return {
    identityId: parsed.data.user.id,
    session: invalidateExpiredAssurance(session, now),
    ...(parsed.data.user.name ? { displayName: parsed.data.user.name } : {}),
    ...(parsed.data.user.email ? { email: parsed.data.user.email } : {}),
  };
}

/** Revoke all Better Auth sessions for the authenticated identity on compromise. */
export async function revokeIdentitySessions(
  request: Request,
  auth: BetterAuthSessionRevoker = getAuth(),
): Promise<void> {
  await auth.api.revokeSessions({ headers: request.headers });
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
