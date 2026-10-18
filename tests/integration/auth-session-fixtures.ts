import type { Sql } from 'postgres';
import { clerkFixtures } from '../vitest/clerk-integration';
import { issueClerkStepUpAssertion } from '../../src/platform/auth/clerk-step-up';

export const providerUserId = (id: string) => `user_integration_${id.replaceAll('-', '')}`;

/** Exercise the real database mapping while preserving the app UUID. */
export async function seedClerkSession(
  client: Sql,
  sessionId: string,
  token: string,
  internalUserId: string,
  strong = true,
  expiresAt = new Date('2030-01-01T00:00:00Z'),
) {
  const userId = providerUserId(internalUserId);
  await client`
    insert into app.auth_identities (provider, provider_user_id, internal_user_id)
    values ('CLERK', ${userId}, ${internalUserId})
    on conflict (provider, provider_user_id) do update
      set internal_user_id = excluded.internal_user_id
  `;
  clerkFixtures.sessions.set(token, {
    id: sessionId,
    userId,
    internalUserId,
    expiresAt,
    factorVerificationAge: strong ? [0, 0] : [60, 60],
    revoked: false,
  });
}

export function fixtureSession(sessionId: string) {
  const session = [...clerkFixtures.sessions.values()].find((session) => session.id === sessionId);
  if (!session) throw new Error(`Clerk integration session ${sessionId} was not seeded`);
  return session;
}

export function setFixtureStrongAuthentication(sessionId: string, strong: boolean) {
  fixtureSession(sessionId).factorVerificationAge = strong ? [0, 0] : [60, 60];
}

/** Test-process selector plus a real, signed application step-up assertion. */
export function clerkHeaders(token: string, command?: unknown): Record<string, string> {
  const action =
    (command as { commandType?: string } | undefined)?.commandType === 'LockBusinessDay'
      ? 'LOCK_BUSINESS_DAY'
      : 'PRIVILEGED_OPERATION';
  const session = clerkFixtures.sessions.get(token);
  const headers: Record<string, string> = { 'x-test-clerk-session': token };
  if (session?.tenantId && session.factorVerificationAge.every((age) => age >= 0 && age <= 10)) {
    headers.cookie = issueClerkStepUpAssertion({
      providerSessionId: session.id,
      internalUserId: session.internalUserId,
      tenantId: session.tenantId,
      action,
      level: 'strict_mfa',
    }).split(';')[0]!;
  }
  return headers;
}

/**
 * Shared financial-fixture API. Clerk owns the session; no legacy rows exist.
 */
export async function seedActiveStepUp(
  _client: Sql,
  sessionId: string,
  tenantId: string,
  level: 1 | 2 = 1,
) {
  Object.assign(fixtureSession(sessionId), { tenantId, level });
  setFixtureStrongAuthentication(sessionId, true);
}
