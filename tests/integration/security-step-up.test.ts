import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as stepUpPost } from '../../src/app/api/auth/step-up/route';
import { resolveAuthenticatedActor, revokeIdentitySessions } from '../../src/modules/identity';
import { assertStepUp } from '../../src/platform/security';
import { issueClerkStepUpAssertion } from '../../src/platform/auth/clerk-step-up';
import {
  seedClerkSession,
  clerkHeaders,
  fixtureSession,
  setFixtureStrongAuthentication,
} from './auth-session-fixtures';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for Clerk step-up integration tests.');
const ids = {
  tenant: 'a1f00000-0000-4000-8000-000000000001',
  otherTenant: 'a1f00000-0000-4000-8000-000000000002',
  actor: 'a1f00000-0000-4000-8000-000000000011',
  membership: 'a1f00000-0000-4000-8000-000000000021',
  otherMembership: 'a1f00000-0000-4000-8000-000000000022',
  session: 'a1f00000-0000-4000-8000-000000000031',
  otherSession: 'a1f00000-0000-4000-8000-000000000032',
};
let client: Sql;
const request = (token = 'step-up-session', cookie?: string) =>
  new Request('http://127.0.0.1:3000/api/auth/step-up', {
    method: 'POST',
    headers: {
      ...clerkHeaders(token),
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tenantId: ids.tenant, action: 'LOCK_BUSINESS_DAY' }),
  });
const assertion = (overrides: Partial<Parameters<typeof issueClerkStepUpAssertion>[0]> = {}) =>
  issueClerkStepUpAssertion({
    providerSessionId: ids.session,
    internalUserId: ids.actor,
    tenantId: ids.tenant,
    action: 'LOCK_BUSINESS_DAY',
    level: 'strict_mfa',
    ...overrides,
  }).split(';')[0]!;

describe('Clerk server identity, assurance, and revocation boundary', () => {
  beforeAll(async () => {
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-step-up-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-step-up-secret';
    client = postgres(databaseUrl, { max: 2, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Step Up Tenant', 'step-up-tenant'),
        ('${ids.otherTenant}', 'Step Up Other Tenant', 'step-up-other-tenant')
      on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.actor}', 'Step Up Actor', 'step-up-actor@example.test')
      on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE'),
        ('${ids.otherMembership}', '${ids.otherTenant}', '${ids.actor}', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type)
        values ('${ids.tenant}', '${ids.membership}', 'OWNER', 'TENANT')
      on conflict do nothing;
    `);
    await seedClerkSession(client, ids.session, 'step-up-session', ids.actor, false);
    await seedClerkSession(client, ids.otherSession, 'other-session', ids.actor, false);
  });
  afterAll(async () => {
    await client?.end();
  });

  it('rejects unauthenticated sessions and stale MFA at the real actor boundary', async () => {
    expect(await resolveAuthenticatedActor(request('unknown'))).toBeNull();
    const actor = await resolveAuthenticatedActor(request());
    expect(actor?.identityId).toBe(ids.actor);
    expect(() => assertStepUp(actor!.session, 1, new Date(), ids.tenant)).toThrow(
      'Strong authentication',
    );
  });

  it('requires a server challenge and fresh Clerk reverification, then audits success', async () => {
    const challenge = await stepUpPost(request());
    expect(challenge.status).toBe(403);
    const challengeCookie = challenge.headers.get('set-cookie')?.split(';')[0];
    expect(challengeCookie).toContain('shanda-fuel.clerk-step-up-challenge=');
    expect((await stepUpPost(request('step-up-session', challengeCookie))).status).toBe(403);
    setFixtureStrongAuthentication(ids.session, true);
    const success = await stepUpPost(request('step-up-session', challengeCookie));
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({ status: 'active', stepUpLevel: 1 });
    const cookie = success.headers.get('set-cookie')?.split(';')[0];
    const actor = await resolveAuthenticatedActor(request('step-up-session', cookie));
    assertStepUp(actor!.session, 1, new Date(), ids.tenant, 'LOCK_BUSINESS_DAY');
    const events = await client<{ details: string }[]>`
      select details::text from platform.security_events
      where tenant_id = ${ids.tenant} and actor_id = ${ids.actor}
        and event_code = 'SECURITY.STEP_UP_SUCCEEDED'
    `;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => !/password|totpCode|secret/i.test(event.details))).toBe(true);
  });

  it('binds assertions to the tenant, session, identity, and expiry', async () => {
    setFixtureStrongAuthentication(ids.session, false);
    const valid = await resolveAuthenticatedActor(request('step-up-session', assertion()));
    assertStepUp(valid!.session, 1, new Date(), ids.tenant, 'LOCK_BUSINESS_DAY');
    expect(() => assertStepUp(valid!.session, 1, new Date(), ids.otherTenant)).toThrow(
      'current step-up',
    );
    for (const cookie of [
      assertion({ providerSessionId: ids.otherSession }),
      assertion({ internalUserId: ids.otherTenant }),
      assertion({ now: new Date(Date.now() - 16 * 60_000) }),
      // Always change the last character (a fixed 'x' would leave the cookie intact 1 time in 64).
      assertion().replace(/.$/, (last) => (last === 'x' ? 'y' : 'x')),
    ]) {
      const actor = await resolveAuthenticatedActor(request('step-up-session', cookie));
      expect(() => assertStepUp(actor!.session, 1, new Date(), ids.tenant)).toThrow();
    }
    const other = await resolveAuthenticatedActor(request('other-session', assertion()));
    expect(() => assertStepUp(other!.session, 1, new Date(), ids.tenant)).toThrow();
  });

  it('fails closed when a Clerk subject has no application mapping', async () => {
    fixtureSession(ids.otherSession).userId = 'user_unprovisioned';
    await expect(resolveAuthenticatedActor(request('other-session'))).rejects.toThrow(
      'not provisioned',
    );
    fixtureSession(ids.otherSession).userId = fixtureSession(ids.session).userId;
  });

  it('revokes all provider sessions without mutating business identity', async () => {
    await revokeIdentitySessions(request());
    expect(await resolveAuthenticatedActor(request())).toBeNull();
    expect(await resolveAuthenticatedActor(request('other-session'))).toBeNull();
    const users = await client<{ id: string }[]>`select id from app.users where id = ${ids.actor}`;
    expect(users).toEqual([{ id: ids.actor }]);
  });
});
