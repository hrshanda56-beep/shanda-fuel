import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';
import { POST } from '../../src/app/api/forecourt/commands/route';
import { closeDatabase } from '../../src/platform/db/client';
import { seedActiveStepUp } from './auth-session-fixtures';
import { resolveAuthenticatedActor } from '../../src/modules/identity';

const fixtureUrl = process.env.DATABASE_URL;
if (!fixtureUrl) throw new Error('A disposable PostgreSQL DATABASE_URL is required');
const ids = Object.fromEntries(
  ['tenant', 'legal', 'station', 'outside', 'actor', 'membership', 'reconciliation'].map((key) => [
    key,
    randomUUID(),
  ]),
) as Record<string, string>;
let fixture: Sql;

async function approval(
  options: {
    role?: 'OWNER' | 'SUPERVISOR' | 'ATTENDANT';
    session?: 'expired' | 'revoked';
    stepUp?: 'expired' | 'wrong-tenant' | 'missing';
    stationId?: string;
  } = {},
) {
  const sessionId = randomUUID();
  const token = randomUUID();
  await fixture`update app.membership_role_assignments set role_code = ${options.role ?? 'OWNER'}
    where membership_id = ${ids.membership!}`;
  await fixture`insert into auth.session(id, token, user_id, expires_at)
    values (${sessionId}, ${token}, ${ids.actor!}, now() + interval '1 hour')`;
  await seedActiveStepUp(fixture, sessionId, ids.tenant!);
  if (options.session === 'expired') {
    await fixture`update auth.session set expires_at = timezone('UTC', now()) - interval '1 minute' where id = ${sessionId}`;
  }
  if (options.session === 'revoked') {
    await fixture`update auth.session set revoked_at = now() where id = ${sessionId}`;
  }
  if (options.stepUp === 'expired') {
    await fixture`update auth.session set step_up_expires_at = timezone('UTC', now()) - interval '1 minute'
      where id = ${sessionId}`;
  }
  if (options.stepUp === 'wrong-tenant') {
    await fixture`update auth.session set step_up_tenant_id = ${randomUUID()} where id = ${sessionId}`;
  }
  if (options.stepUp === 'missing') {
    await fixture`update auth.session set step_up_level = null, step_up_expires_at = null,
      step_up_tenant_id = null where id = ${sessionId}`;
  }
  const signature = await makeSignature(token, process.env.BETTER_AUTH_SECRET!);
  return POST(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      method: 'POST',
      headers: {
        cookie: `shanda-fuel.session_token=${token}.${signature}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        commandType: 'ApproveProductionReconciliation',
        tenantId: ids.tenant,
        stationId: options.stationId ?? ids.station,
        reconciliationId: ids.reconciliation,
        expectedVersion: 0,
      }),
    }),
  );
}

describe('approval HTTP session and step-up boundary', () => {
  beforeAll(async () => {
    fixture = postgres(fixtureUrl, { max: 1, prepare: false });
    if (process.env.TEST_RUNTIME_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL;
      await closeDatabase();
    }
    await fixture`insert into app.tenants(id, name, slug)
      values (${ids.tenant!}, 'Synthetic approval boundary', ${ids.tenant!})`;
    await fixture`insert into app.legal_entities(id, tenant_id, legal_name)
      values (${ids.legal!}, ${ids.tenant!}, 'Synthetic approval legal')`;
    for (const station of [ids.station!, ids.outside!]) {
      await fixture`insert into app.stations(id, tenant_id, legal_entity_id, code, name, status, timezone)
        values (${station}, ${ids.tenant!}, ${ids.legal!}, ${station}, 'Synthetic station', 'ACTIVE', 'Africa/Harare')`;
    }
    await fixture`insert into auth."user"(id, name, email)
      values (${ids.actor!}, 'Synthetic approver', ${ids.actor! + '@example.test'})`;
    await fixture`insert into app.memberships(id, tenant_id, identity_id, status)
      values (${ids.membership!}, ${ids.tenant!}, ${ids.actor!}, 'ACTIVE')`;
    await fixture`insert into app.membership_role_assignments(tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values (${ids.tenant!}, ${ids.membership!}, 'OWNER', 'STATION', ${ids.legal!}, ${ids.station!})`;
  });

  afterAll(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = fixtureUrl;
    await fixture?.end();
  });

  // No reconciliation is seeded: the positive control must reach NOT_FOUND.
  // Denials must precede resource lookup, without granting financial authority.
  it('allows a current Owner session with tenant-bound step-up through authorization', async () => {
    expect((await approval()).status).toBe(404);
  });
  it.each(['expired', 'revoked'] as const)(
    'rejects a %s session despite active MFA evidence',
    async (session) => {
      expect((await approval({ session })).status).toBe(401);
    },
  );
  it.each(['expired', 'wrong-tenant', 'missing'] as const)(
    'rejects %s step-up on a current Owner session',
    async (stepUp) => {
      expect((await approval({ stepUp })).status).toBe(403);
    },
  );
  it.each(['SUPERVISOR', 'ATTENDANT'] as const)(
    'does not treat %s plus MFA as approval permission',
    async (role) => {
      expect((await approval({ role })).status).toBe(403);
    },
  );
  it('denies a station-scoped Owner at another station even with current MFA', async () => {
    expect((await approval({ stationId: ids.outside })).status).toBe(403);
  });
  it('cannot borrow a different user session even when provider claims match each other', async () => {
    const otherUser = randomUUID();
    const otherSession = randomUUID();
    await fixture`insert into auth."user"(id, name, email)
      values (${otherUser}, 'Other synthetic identity', ${otherUser + '@example.test'})`;
    await fixture`insert into auth.session(id, token, user_id, expires_at)
      values (${otherSession}, ${randomUUID()}, ${otherUser}, timestamp '2030-01-01')`;
    await seedActiveStepUp(fixture, otherSession, ids.tenant!);
    await expect(
      resolveAuthenticatedActor(new Request('http://127.0.0.1:3000/api/forecourt/commands'), {
        api: {
          getSession: async () => ({
            user: { id: ids.actor },
            session: { id: otherSession, userId: ids.actor, expiresAt: '2030-01-01' },
          }),
        },
      }),
    ).rejects.toThrow('invalid');
  });
  it('leaves financial commands and authoritative records absent after all probes', async () => {
    const rows = await fixture`select
      (select count(*)::int from app.reconciliations where tenant_id = ${ids.tenant!}) as reconciliations,
      (select count(*)::int from app.inventory_movements where tenant_id = ${ids.tenant!}) as movements`;
    expect(rows[0]).toEqual({ reconciliations: 0, movements: 0 });
  });
});
