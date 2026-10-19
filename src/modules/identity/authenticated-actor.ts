import 'server-only';
import { AppError } from '../../platform/errors';
import {
  assertSessionActive,
  invalidateExpiredAssurance,
  type SessionRecord,
} from '../../platform/security';
import { resolveClerkSession, revokeClerkUserSessions } from '../../platform/auth/provider';

/** Clerk authenticates identity; Shanda Fuel resolves business authority. */
export type AuthenticatedActorContext = {
  identityId: string;
  /** Persisted authority fetched with identity for this GET only; validated by context readers. */
  navigationSnapshot?: unknown[];
  session: SessionRecord;
};

export type AuthenticatedActorResolver = (
  request: Request,
) => Promise<AuthenticatedActorContext | null>;

export async function resolveAuthenticatedActor(
  request: Request,
  now = new Date(),
): Promise<AuthenticatedActorContext | null> {
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
    ...(providerSession.navigationSnapshot
      ? { navigationSnapshot: providerSession.navigationSnapshot }
      : {}),
    session: invalidateExpiredAssurance(session, now),
  };
}

/** Revoke every active Clerk session for the authenticated identity. */
export async function revokeIdentitySessions(request: Request): Promise<void> {
  const session = await resolveClerkSession(request);
  if (!session) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  const result = await revokeClerkUserSessions(session.providerUserId);
  if (!result.complete) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', 'Session revocation is incomplete');
  }
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
