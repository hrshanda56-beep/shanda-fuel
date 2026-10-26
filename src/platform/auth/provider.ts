import { markReadTiming } from '../observability/read-timing';
import 'server-only';

import { clerkClient, getAuth as getClerkAuth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';

import { getServerEnv } from '../config/env';
import { getDatabase } from '../db';
import { AppError } from '../errors';
import { readClerkStepUpAssertion } from './clerk-step-up';
import { clerkCredentialName } from './credential-name';
import { memoizeRequestRead } from '../security/request-read-scope';

export type AuthProviderName = 'CLERK';

export type ProviderSession = {
  provider: AuthProviderName;
  providerUserId: string;
  internalUserId: string;
  navigationSnapshot?: unknown[];
  providerSessionId: string;
  expiresAt: Date;
  strongAuthenticatedAt?: Date;
  strongAuthenticationExpiresAt?: Date;
  strongAuthenticationVerified?: boolean;
  stepUpLevel?: 0 | 1 | 2;
  stepUpExpiresAt?: Date;
  stepUpTenantId?: string;
  stepUpAction?: string;
  strongAuthenticationMethod?: 'clerk-mfa' | 'clerk-reverification';
};

export type ClerkCredentialIdentity = {
  providerUserId: string;
  providerSessionId?: string;
};

export type ClerkSessionRevocationResult = {
  activeSessionsFound: number;
  sessionsRevoked: number;
  complete: boolean;
};

const CLERK_STEP_UP_MAX_AGE_MINUTES = 10;
const identityRead = Symbol('clerk-internal-identity');

export async function resolveClerkSession(request: Request): Promise<ProviderSession | null> {
  const auth = getClerkAuth(request as unknown as Parameters<typeof getClerkAuth>[0]);
  markReadTiming('identity.clerk.headers.ready');
  if (!auth.isAuthenticated || !auth.userId || !auth.sessionId) return null;

  // The reviewed identity capability takes explicit provider/user arguments and
  // uses its owner-only RLS policy. It does not read connection-local context.
  // Do not spend BEGIN/context/COMMIT round trips for this single read.
  const includeSnapshot =
    request.method === 'GET' && process.env.CONSOLIDATED_CONTEXT_READS === '1';
  const rows = await memoizeRequestRead(identityRead, auth.userId, () =>
    getDatabase().execute<{ internal_user_id: string; navigation_snapshot?: unknown[] }>(
      includeSnapshot
        ? sql`
      select identity.internal_user_id, snapshot.navigation_snapshot
      from app.resolve_auth_identity('CLERK', ${auth.userId}) identity
      cross join lateral (
        select coalesce(jsonb_agg(navigation), '[]'::jsonb) as navigation_snapshot
        from app.read_navigation_context(identity.internal_user_id) navigation
      ) snapshot
    `
        : sql`
      select internal_user_id
      from app.resolve_auth_identity('CLERK', ${auth.userId})
    `,
    ),
  );
  markReadTiming('identity.database.mapping.ready');
  const identity = rows[0]?.internal_user_id ?? null;

  if (!identity) {
    throw new AppError('FORBIDDEN', 'The authentication identity is not provisioned');
  }

  const claims = auth.sessionClaims as { exp?: number; iat?: number } | null;
  const expiresAt = claims?.exp ? new Date(claims.exp * 1000) : new Date(Date.now() + 60_000);
  const factorAges = auth.factorVerificationAge;
  const hasRecentMfa =
    Array.isArray(factorAges) &&
    factorAges.length === 2 &&
    factorAges.every(
      (age) =>
        typeof age === 'number' &&
        Number.isFinite(age) &&
        age >= 0 &&
        age < CLERK_STEP_UP_MAX_AGE_MINUTES,
    );
  const strongAuthenticatedAt = hasRecentMfa
    ? new Date(Date.now() - Math.max(factorAges[0], factorAges[1]) * 60_000)
    : undefined;
  const strongAuthenticationExpiresAt = strongAuthenticatedAt
    ? new Date(strongAuthenticatedAt.getTime() + CLERK_STEP_UP_MAX_AGE_MINUTES * 60_000)
    : undefined;
  const clerkAssertion = readClerkStepUpAssertion(request);
  const assertionMatchesSession =
    clerkAssertion?.providerSessionId === auth.sessionId &&
    clerkAssertion.internalUserId === identity &&
    (clerkAssertion.level === 'strict_mfa' || !getServerEnv().REQUIRE_LOGIN_MFA);
  const assertionIsStrictMfa = assertionMatchesSession && clerkAssertion.level === 'strict_mfa';
  const effectiveStrongAuthentication = hasRecentMfa || assertionMatchesSession;
  const effectiveStrongAuthenticatedAt = hasRecentMfa
    ? strongAuthenticatedAt
    : assertionMatchesSession
      ? clerkAssertion?.issuedAt
      : undefined;
  const effectiveStrongAuthenticationExpiresAt = hasRecentMfa
    ? strongAuthenticationExpiresAt
    : assertionMatchesSession
      ? clerkAssertion?.expiresAt
      : undefined;
  return {
    provider: 'CLERK',
    providerUserId: auth.userId,
    internalUserId: identity,
    ...(rows[0]?.navigation_snapshot ? { navigationSnapshot: rows[0].navigation_snapshot } : {}),
    providerSessionId: auth.sessionId,
    expiresAt,
    strongAuthenticatedAt: effectiveStrongAuthenticatedAt,
    strongAuthenticationExpiresAt: effectiveStrongAuthenticationExpiresAt,
    strongAuthenticationVerified: effectiveStrongAuthentication,
    strongAuthenticationMethod:
      hasRecentMfa || assertionIsStrictMfa
        ? 'clerk-mfa'
        : assertionMatchesSession
          ? 'clerk-reverification'
          : undefined,
    stepUpLevel: effectiveStrongAuthentication ? 1 : undefined,
    stepUpExpiresAt: effectiveStrongAuthenticationExpiresAt,
    stepUpTenantId: assertionMatchesSession ? clerkAssertion?.tenantId : undefined,
    stepUpAction: assertionMatchesSession ? clerkAssertion?.action : undefined,
  };
}

/** Clerk's official server-side reverification check for privileged actions. */
export function hasRecentClerkMfa(request: Request): boolean {
  const auth = getClerkAuth(request as unknown as Parameters<typeof getClerkAuth>[0]);
  return auth.isAuthenticated && auth.has({ reverification: 'strict_mfa' });
}

export function hasRecentClerkReverification(
  request: Request,
  level: 'strict' | 'strict_mfa',
): boolean {
  const auth = getClerkAuth(request as unknown as Parameters<typeof getClerkAuth>[0]);
  return auth.isAuthenticated && auth.has({ reverification: level });
}

/**
 * True when the person signed in (or re-verified) recently enough, using the configured reuse
 * window rather than Clerk's fixed one. A fresh password sign-in therefore counts as a step-up.
 * Strict MFA needs the second factor to be that recent too.
 */
export function hasRecentClerkSignIn(
  request: Request,
  level: 'strict' | 'strict_mfa',
  withinMinutes: number,
): boolean {
  const auth = getClerkAuth(request as unknown as Parameters<typeof getClerkAuth>[0]);
  if (!auth.isAuthenticated) return false;
  const ages = auth.factorVerificationAge;
  if (!Array.isArray(ages)) return false;
  const recent = (age: unknown) =>
    typeof age === 'number' && Number.isFinite(age) && age >= 0 && age < withinMinutes;
  return level === 'strict_mfa' ? ages.length === 2 && ages.every(recent) : recent(ages[0]);
}

export async function clerkUserHasMfa(providerUserId: string): Promise<boolean> {
  const client = await clerkClient();
  const user = await client.users.getUser(providerUserId);
  return (
    user.twoFactorEnabled === true || user.totpEnabled === true || user.backupCodeEnabled === true
  );
}

export async function createClerkCredentialIdentity(input: {
  username?: string;
  email?: string;
  password: string;
  firstName?: string;
  lastName?: string;
}): Promise<ClerkCredentialIdentity> {
  const client = await clerkClient();
  const user = await client.users.createUser({
    ...(input.username ? { username: input.username } : {}),
    ...(input.email ? { emailAddress: [input.email] } : {}),
    password: input.password,
    ...clerkCredentialName(input.firstName, input.lastName),
  });
  return { providerUserId: user.id };
}

export async function deleteClerkCredentialIdentity(providerUserId: string): Promise<void> {
  const client = await clerkClient();
  await client.users.deleteUser(providerUserId);
}

export async function revokeClerkUserSessions(
  providerUserId: string,
): Promise<ClerkSessionRevocationResult> {
  const client = await clerkClient();
  // Collect all pages before revoking: mutations would otherwise shift offsets.
  const sessionIds = new Set<string>();
  let offset = 0;
  while (true) {
    const page = await client.sessions.getSessionList({
      userId: providerUserId,
      status: 'active',
      limit: 100,
      offset,
    });
    for (const session of page.data) sessionIds.add(session.id);
    offset += page.data.length;
    if (page.data.length === 0 || offset >= page.totalCount || page.data.length < 100) break;
  }
  const results = await Promise.allSettled(
    [...sessionIds].map((id) => client.sessions.revokeSession(id)),
  );
  const sessionsRevoked = results.filter((result) => result.status === 'fulfilled').length;
  return {
    activeSessionsFound: sessionIds.size,
    sessionsRevoked,
    complete: sessionsRevoked === sessionIds.size,
  };
}
