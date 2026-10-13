import 'server-only';

import { clerkClient, getAuth as getClerkAuth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';

import { getServerEnv } from '../config/env';
import { getDatabase } from '../db';
import { AppError } from '../errors';
import { readClerkStepUpAssertion } from './clerk-step-up';

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
  stepUpAction?: string;
  strongAuthenticationMethod?: 'clerk-mfa' | 'clerk-reverification' | 'better-auth-totp';
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

export function getAuthProviderName(): AuthProviderName {
  const configured = assertAuthProviderName(process.env.AUTH_PROVIDER);
  const env = getServerEnv();
  if (env.AUTH_PROVIDER !== configured) {
    throw new AppError('INVARIANT_VIOLATION', 'Authentication provider configuration is invalid');
  }
  return configured;
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
  const clerkAssertion = readClerkStepUpAssertion(request);
  const assertionMatchesSession =
    clerkAssertion?.providerSessionId === auth.sessionId &&
    clerkAssertion.internalUserId === identity;
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

export async function clerkUserHasMfa(providerUserId: string): Promise<boolean> {
  const client = await clerkClient();
  const user = await client.users.getUser(providerUserId);
  return (
    user.twoFactorEnabled === true || user.totpEnabled === true || user.backupCodeEnabled === true
  );
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

export async function revokeClerkUserSessions(
  providerUserId: string,
): Promise<ClerkSessionRevocationResult> {
  const client = await clerkClient();
  const sessions = await client.sessions.getSessionList({
    userId: providerUserId,
    status: 'active',
  });
  const results = await Promise.allSettled(
    sessions.data.map((session) => client.sessions.revokeSession(session.id)),
  );
  const sessionsRevoked = results.filter((result) => result.status === 'fulfilled').length;
  return {
    activeSessionsFound: sessions.data.length,
    sessionsRevoked,
    complete: sessionsRevoked === sessions.data.length,
  };
}
