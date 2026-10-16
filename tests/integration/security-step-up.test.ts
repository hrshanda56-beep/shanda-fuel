import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';
import { POST as authPost } from '../../src/app/api/auth/[...all]/route';
import { POST as mfaVerifyPost } from '../../src/app/api/auth/mfa/setup/verify/route';
import { POST as mfaSetupPost } from '../../src/app/api/auth/mfa/setup/route';
import { POST as stepUpPost } from '../../src/app/api/auth/step-up/route';
import { resolveAuthenticatedActor } from '../../src/modules/identity';
import { assertStepUp } from '../../src/platform/security';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for step-up integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const ids = {
  tenant: 'a1f00000-0000-4000-8000-000000000001',
  otherTenant: 'a1f00000-0000-4000-8000-000000000002',
  actor: 'a1f00000-0000-4000-8000-000000000011',
  membership: 'a1f00000-0000-4000-8000-000000000021',
  otherMembership: 'a1f00000-0000-4000-8000-000000000022',
  session: 'a1f00000-0000-4000-8000-000000000031',
  otherSession: 'a1f00000-0000-4000-8000-000000000032',
  legal: 'a1f00000-0000-4000-8000-000000000041',
  otherLegal: 'a1f00000-0000-4000-8000-000000000042',
};

let client: Sql;

async function cookie(token: string): Promise<string> {
  return `shanda-fuel.session_token=${token}.${await makeSignature(token, process.env.BETTER_AUTH_SECRET!)}`;
}

function totpCode(secret: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = secret.replace(/=+$/, '').toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalized) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('Invalid test TOTP secret');
    buffer = (buffer << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(value % 1_000_000).padStart(6, '0');
}

function cookieFromSetCookie(header: string | null): string | undefined {
  const match = header?.match(/shanda-fuel\.session_token=([^;]+)/);
  return match ? `shanda-fuel.session_token=${match[1]}` : undefined;
}

function stepUpRequest(
  tenantId: string,
  password: string,
  totp: string,
  sessionToken: string,
): Request {
  return new Request('http://127.0.0.1:3000/api/auth/step-up', {
    method: 'POST',
    headers: { cookie: sessionToken, 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId, password, totpCode: totp }),
  });
}

describe('production TOTP step-up establishment', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-step-up-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-step-up-secret';
    client = postgres(databaseUrl!, { max: 2, prepare: false });
    const password = await hashPassword('correct-password');
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Step Up Tenant', 'step-up-tenant'),
        ('${ids.otherTenant}', 'Step Up Other Tenant', 'step-up-other-tenant')
      on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.actor}', 'Step Up Actor', 'step-up-actor@example.test')
      on conflict (id) do nothing;
      insert into auth.account (account_id, provider_id, user_id, password)
        values ('${ids.actor}', 'credential', '${ids.actor}', '${password}')
      on conflict (provider_id, account_id) do update set password = excluded.password;
      update auth."user" set two_factor_enabled = false where id = '${ids.actor}';
      delete from auth.two_factor where user_id = '${ids.actor}';
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE'),
        ('${ids.otherMembership}', '${ids.otherTenant}', '${ids.actor}', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Step Up Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'Step Up Other Legal')
      on conflict (id) do nothing;
      insert into auth.session (id, expires_at, token, user_id, revoked_at,
        strong_authentication_verified, strong_authenticated_at,
        strong_authentication_expires_at, step_up_level, step_up_expires_at,
        step_up_tenant_id)
      values
        ('${ids.session}', '2030-01-01T00:00:00Z', 'step-up-session-token', '${ids.actor}', null, null, null, null, null, null, null),
        ('${ids.otherSession}', '2030-01-01T00:00:00Z', 'step-up-other-session-token', '${ids.actor}', null, null, null, null, null, null, null)
      on conflict (id) do update set
        expires_at = excluded.expires_at,
        revoked_at = null,
        strong_authentication_verified = null,
        strong_authenticated_at = null,
        strong_authentication_expires_at = null,
        step_up_level = null,
        step_up_expires_at = null,
        step_up_tenant_id = null;
    `);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('requires enrollment, verifies both factors, and preserves session/tenant boundaries', async () => {
    const sessionCookie = await cookie('step-up-session-token');
    const otherSessionCookie = await cookie('step-up-other-session-token');

    const unenrolled = await stepUpPost(
      stepUpRequest(ids.tenant, 'correct-password', '123456', sessionCookie),
    );
    expect(unenrolled.status).toBe(403);

    const unenrolledState = await client<
      { step_up_tenant_id: string | null; step_up_level: number | null }[]
    >`
      select step_up_tenant_id, step_up_level from auth.session where id = ${ids.session}
    `;
    expect(unenrolledState[0]).toEqual({ step_up_tenant_id: null, step_up_level: null });

    const passwordOnly = await stepUpPost(
      new Request('http://127.0.0.1:3000/api/auth/step-up', {
        method: 'POST',
        headers: { cookie: sessionCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: ids.tenant, password: 'correct-password' }),
      }),
    );
    expect(passwordOnly.status).toBe(400);

    const setup = await mfaSetupPost(
      new Request('http://127.0.0.1:3000/api/auth/mfa/setup', {
        method: 'POST',
        headers: { cookie: sessionCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'correct-password' }),
      }),
    );
    expect(setup.status).toBe(200);
    const setupBody = (await setup.json()) as { totpURI: string; backupCodes: string[] };
    expect(setupBody.backupCodes.length).toBeGreaterThan(0);
    const secret = new URL(setupBody.totpURI).searchParams.get('secret');
    expect(secret).toBeTruthy();

    const enrollment = await mfaVerifyPost(
      new Request('http://127.0.0.1:3000/api/auth/mfa/setup/verify', {
        method: 'POST',
        headers: { cookie: sessionCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ code: totpCode(secret!) }),
      }),
    );
    expect(enrollment.status).toBe(200);
    const effectiveSessionCookie =
      cookieFromSetCookie(enrollment.headers.get('set-cookie')) ?? sessionCookie;

    const wrongTotp = await stepUpPost(
      stepUpRequest(ids.tenant, 'correct-password', '123123', effectiveSessionCookie),
    );
    expect(wrongTotp.status).toBe(403);

    const actorAfterWrongTotp = await resolveAuthenticatedActor(
      new Request('http://127.0.0.1:3000/api/forecourt/commands', {
        headers: { cookie: effectiveSessionCookie },
      }),
    );
    expect(actorAfterWrongTotp).not.toBeNull();
    const afterWrongTotp = await client<
      { step_up_tenant_id: string | null; step_up_level: number | null }[]
    >`
      select step_up_tenant_id, step_up_level
      from auth.session where id = ${actorAfterWrongTotp!.session.sessionId}
    `;
    expect(afterWrongTotp[0]).toEqual({ step_up_tenant_id: null, step_up_level: null });
    expect(() => assertStepUp(actorAfterWrongTotp!.session, 1, new Date(), ids.tenant)).toThrow(
      'Strong authentication is required for this action',
    );

    const wrongPassword = await stepUpPost(
      stepUpRequest(ids.tenant, 'wrong-password', totpCode(secret!), effectiveSessionCookie),
    );
    expect(wrongPassword.status).toBe(403);

    const success = await stepUpPost(
      stepUpRequest(ids.tenant, 'correct-password', totpCode(secret!), effectiveSessionCookie),
    );
    expect(success.status).toBe(200);
    const successBody = (await success.json()) as {
      status: string;
      stepUpLevel: number;
      expiresAt: string;
    };
    expect(successBody).toMatchObject({ status: 'active', stepUpLevel: 1 });

    const request = new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      headers: { cookie: effectiveSessionCookie },
    });
    const actor = await resolveAuthenticatedActor(request);
    expect(actor).not.toBeNull();

    const rows = await client<
      { step_up_tenant_id: string; step_up_level: number; expires_epoch: string }[]
    >`
      select step_up_tenant_id,
             step_up_level,
             extract(epoch from step_up_expires_at)::text as expires_epoch
      from auth.session where id = ${actor!.session.sessionId}
    `;
    expect(rows[0]?.step_up_tenant_id).toBe(ids.tenant);
    expect(rows[0]?.step_up_level).toBe(1);
    expect(Number(rows[0]?.expires_epoch)).toBeCloseTo(Date.parse(successBody.expiresAt) / 1000, 3);

    assertStepUp(actor!.session, 1, new Date(), ids.tenant);
    expect(() => assertStepUp(actor!.session, 1, new Date(), ids.otherTenant)).toThrow(
      'current step-up authentication',
    );

    const otherSession = await resolveAuthenticatedActor(
      new Request('http://127.0.0.1:3000/api/forecourt/commands', {
        headers: { cookie: otherSessionCookie },
      }),
    );
    expect(otherSession).not.toBeNull();
    expect(() => assertStepUp(otherSession!.session, 1, new Date(), ids.tenant)).toThrow(
      'Strong authentication is required for this action',
    );

    await client`
      update auth.session
      set step_up_expires_at = timezone('UTC', now()) - interval '1 minute',
          strong_authentication_expires_at = now() + interval '1 hour'
      where id = ${actor!.session.sessionId}
    `;
    const expiredActor = await resolveAuthenticatedActor(request);
    expect(() => assertStepUp(expiredActor!.session, 1, new Date(), ids.tenant)).toThrow(
      'current step-up authentication',
    );

    await client`
      update auth.session
      set expires_at = now() + interval '1 hour',
          revoked_at = null
      where id = ${actor!.session.sessionId}
    `;
    const logout = await authPost(
      new Request('http://127.0.0.1:3000/api/auth/sign-out', {
        method: 'POST',
        headers: { cookie: effectiveSessionCookie },
      }),
    );
    expect(logout.status).toBe(200);
    expect(await resolveAuthenticatedActor(request)).toBeNull();

    const events = await client<{ event_code: string; details: string }[]>`
      select event_code, details::text from platform.security_events
      where actor_id = ${ids.actor}
        and details->'metadata'->>'sessionId' = ${actor!.session.sessionId}
        and event_code in ('SECURITY.STEP_UP_FAILED', 'SECURITY.STEP_UP_SUCCEEDED')
    `;
    expect(events.some((event) => event.event_code === 'SECURITY.STEP_UP_FAILED')).toBe(true);
    expect(events.some((event) => event.event_code === 'SECURITY.STEP_UP_SUCCEEDED')).toBe(true);
    expect(events.every((event) => !event.details.includes('correct-password'))).toBe(true);
    expect(events.every((event) => !event.details.includes('123123'))).toBe(true);
  });
});
