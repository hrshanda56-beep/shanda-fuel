import 'server-only';

import { clerkClient, getAuth as getClerkAuth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';

import { getServerEnv } from '../config/env';
import { getDatabase } from '../db';
import { AppError } from '../errors';

export type AuthProviderName = 'BETTER_AUTH' | 'CLERK';

export type ProviderSession = {
  provider: AuthProviderName;
  providerUserId: string;
  internalUserId: string;
  providerSessionId: string;
  expiresAt: Date;
  strongAuthenticatedAt?: Date;
  strongAuthenticationExpiresAt?: Date;
  strongAuthenticationVerified?: boolean;
  stepUpLevel?: 0 | 1 | 2;
  stepUpExpiresAt?: Date;
  stepUpTenantId?: string;
};

export type ClerkCredentialIdentity = {
  providerUserId: string;
  providerSessionId?: string;
};

const CLERK_STEP_UP_MAX_AGE_MINUTES = 10;

export function getAuthProviderName(): AuthProviderName {
  return getServerEnv().AUTH_PROVIDER;
}

export function assertAuthProviderName(value: unknown): AuthProviderName {
  if (value === 'BETTER_AUTH' || value === 'CLERK') return value;
  throw new AppError('INVARIANT_VIOLATION', 'Authentication provider configuration is invalid');
}

export async function resolveClerkSession(request: Request): Promise<ProviderSession | null> {
  const auth = getClerkAuth(request as unknown as Parameters<typeof getClerkAuth>[0]);
  if (!auth.isAuthenticated || !auth.userId || !auth.sessionId) return null;

  const identity = await getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`
      select
        set_config('app.auth_provider', 'CLERK', true),
        set_config('app.provider_user_id', ${auth.userId}, true)
    `);
    const rows = await transaction.execute<{ internal_user_id: string }>(sql`
      select internal_user_id
      from app.resolve_auth_identity('CLERK', ${auth.userId})
    `);
    return rows[0]?.internal_user_id ?? null;
  });

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
        typeof age === 'number' && Number.isFinite(age) && age <= CLERK_STEP_UP_MAX_AGE_MINUTES,
    );
  const strongAuthenticatedAt = hasRecentMfa
    ? new Date(Date.now() - Math.max(factorAges[0], factorAges[1]) * 60_000)
    : undefined;
  const strongAuthenticationExpiresAt = strongAuthenticatedAt
    ? new Date(strongAuthenticatedAt.getTime() + CLERK_STEP_UP_MAX_AGE_MINUTES * 60_000)
    : undefined;
  return {
    provider: 'CLERK',
    providerUserId: auth.userId,
    internalUserId: identity,
    providerSessionId: auth.sessionId,
    expiresAt,
    strongAuthenticatedAt,
    strongAuthenticationExpiresAt,
    strongAuthenticationVerified: hasRecentMfa,
    stepUpLevel: hasRecentMfa ? 1 : undefined,
    stepUpExpiresAt: strongAuthenticationExpiresAt,
  };
}

/** Clerk's official server-side reverification check for privileged actions. */
export function hasRecentClerkMfa(request: Request): boolean {
  const auth = getClerkAuth(request as unknown as Parameters<typeof getClerkAuth>[0]);
  return auth.isAuthenticated && auth.has({ reverification: 'strict_mfa' });
}

export async function createClerkCredentialIdentity(input: {
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
}): Promise<ClerkCredentialIdentity> {
  const client = await clerkClient();
  const user = await client.users.createUser({
    username: input.username,
    password: input.password,
    ...(input.firstName ? { firstName: input.firstName } : {}),
    ...(input.lastName ? { lastName: input.lastName } : {}),
  });
  return { providerUserId: user.id };
}

export async function deleteClerkCredentialIdentity(providerUserId: string): Promise<void> {
  const client = await clerkClient();
  await client.users.deleteUser(providerUserId);
}

export async function revokeClerkUserSessions(providerUserId: string): Promise<void> {
  const client = await clerkClient();
  const sessions = await client.sessions.getSessionList({
    userId: providerUserId,
    status: 'active',
  });
  await Promise.all(sessions.data.map((session) => client.sessions.revokeSession(session.id)));
}
