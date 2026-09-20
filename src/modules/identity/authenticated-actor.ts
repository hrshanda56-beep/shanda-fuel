import { AppError } from '../../platform/errors';
import { assertSessionActive, type SessionRecord } from '../../platform/security';

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

export async function requireAuthenticatedActor(
  request: Request,
  resolve: AuthenticatedActorResolver,
  now = new Date(),
): Promise<AuthenticatedActorContext> {
  const actor = await resolve(request);
  if (!actor) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  assertSessionActive(actor.session, now);
  return actor;
}
