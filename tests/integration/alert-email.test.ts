import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { seedActiveStepUp, seedClerkSession, clerkHeaders } from './auth-session-fixtures';
import {
  GET as settingsGet,
  POST as settingsPost,
} from '../../src/app/api/alerts/email-settings/route';
import { GET as cronGet } from '../../src/app/api/cron/alert-digests/route';
import { createDigestPorts, listDigestRecipients } from '../../src/modules/alerts/persistence';
import type { DigestRecipient } from '../../src/modules/alerts/run-digests';
import { requireAuthenticatedActor } from '../../src/modules/identity/authenticated-actor';
import {
  authorizeDigestJob,
  digestActorOverride,
  runAsDigestRecipient,
} from '../../src/modules/identity/digest-actor';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for alert email tests.');

const CRON_SECRET = 'integration-cron-secret-0123456789abcdef';
const id = (n: number) => `ae100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = {
  tenantA: id(1),
  tenantB: id(2),
  tenantC: id(3),
  tenantD: id(4),
  legalA: id(11),
  legalB: id(12),
  legalC: id(13),
  legalD: id(14),
  s1: id(21),
  s2: id(22),
  s3Inactive: id(23),
  sB: id(24),
  sC: id(25),
  sD: id(26),
};
// One person per case: [name, role, scope, extra]
const people = {
  ownerA: id(101),
  financeA: id(102),
  supervisorA: id(103),
  wideSupervisorA: id(104),
  attendantA: id(105),
  suspendedA: id(106),
  optedOutA: id(107),
  expiredA: id(108),
  ownerB: id(109),
  ownerC: id(110),
  ownerD: id(111),
};
// membership id = person id + 1000 offset
const membership = (person: string) =>
  person.replace('ae100000-0000-4000-8000-', 'ae100000-0000-4000-9000-');
const session = (person: string) =>
  person.replace('ae100000-0000-4000-8000-', 'ae100000-0000-4000-a000-');
const token = (name: string) => `ae1-${name}-token`;

let client: Sql;

/** Run `work` as the application runtime role inside one tenant, person and membership. */
async function asRuntime<T>(
  tenant: string,
  person: string,
  work: (tx: Sql) => Promise<T>,
): Promise<T> {
  return (await client.begin(async (tx) => {
    await tx`set local role app_runtime`;
    await tx`select set_config('app.tenant_id', ${tenant}, true),
                    set_config('app.actor_id', ${person}, true),
                    set_config('app.membership_id', ${membership(person)}, true)`;
    return work(tx as unknown as Sql);
  })) as T;
}

async function api(who: string, method: 'GET' | 'POST', body?: Record<string, unknown>) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': `ae1-${Math.random().toString(16).slice(2)}`,
  });
  for (const [name, value] of Object.entries(clerkHeaders(token(who)))) headers.set(name, value);
  if (method === 'GET') {
    const response = await settingsGet(
      new Request(
        `http://127.0.0.1:3000/api/alerts/email-settings?tenantId=${ids.tenantA}&stationId=${ids.s1}`,
        { headers },
      ),
    );
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }
  const response = await settingsPost(
    new Request('http://127.0.0.1:3000/api/alerts/email-settings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tenantId: ids.tenantA, stationId: ids.s1, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const recipientKeys = async () =>
  (await listDigestRecipients(500))
    .filter((r) =>
      Object.values([ids.tenantA, ids.tenantB, ids.tenantC, ids.tenantD]).includes(r.tenantId),
    )
    .map((r) => `${r.membershipId}@${r.stationId}`)
    .sort();
const key = (person: string, station: string) => `${membership(person)}@${station}`;

describe('alert email (ADR-020)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-ae1-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-ae1-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenantA}', 'Email A', 'ae1-a'), ('${ids.tenantB}', 'Email B', 'ae1-b'),
        ('${ids.tenantC}', 'Email C', 'ae1-c'), ('${ids.tenantD}', 'Email D', 'ae1-d')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legalA}', '${ids.tenantA}', 'A Legal'), ('${ids.legalB}', '${ids.tenantB}', 'B Legal'),
        ('${ids.legalC}', '${ids.tenantC}', 'C Legal'), ('${ids.legalD}', '${ids.tenantD}', 'D Legal')
        on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.s1}', '${ids.tenantA}', '${ids.legalA}', 'AE1S1', 'Station One', 'ACTIVE', 'Africa/Harare'),
        ('${ids.s2}', '${ids.tenantA}', '${ids.legalA}', 'AE1S2', 'Station Two', 'ACTIVE', 'Africa/Harare'),
        ('${ids.s3Inactive}', '${ids.tenantA}', '${ids.legalA}', 'AE1S3', 'Closed Station', 'INACTIVE', 'Africa/Harare'),
        ('${ids.sB}', '${ids.tenantB}', '${ids.legalB}', 'AE1SB', 'Station B', 'ACTIVE', 'Africa/Harare'),
        ('${ids.sC}', '${ids.tenantC}', '${ids.legalC}', 'AE1SC', 'Station C', 'ACTIVE', 'Africa/Harare'),
        ('${ids.sD}', '${ids.tenantD}', '${ids.legalD}', 'AE1SD', 'Station D', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
    `);
    const rows: Array<
      [string, string, string, string, string, string | null, string | null, string]
    > = [
      // person, tenant, role, scope, status, legal, station, extra SQL for expires_at
      [people.ownerA, ids.tenantA, 'OWNER', 'TENANT', 'ACTIVE', null, null, 'null'],
      [people.financeA, ids.tenantA, 'FINANCE', 'LEGAL_ENTITY', 'ACTIVE', ids.legalA, null, 'null'],
      [
        people.supervisorA,
        ids.tenantA,
        'SUPERVISOR',
        'STATION',
        'ACTIVE',
        ids.legalA,
        ids.s1,
        'null',
      ],
      [people.wideSupervisorA, ids.tenantA, 'SUPERVISOR', 'TENANT', 'ACTIVE', null, null, 'null'],
      [
        people.attendantA,
        ids.tenantA,
        'ATTENDANT',
        'STATION',
        'ACTIVE',
        ids.legalA,
        ids.s1,
        'null',
      ],
      [people.suspendedA, ids.tenantA, 'ADMINISTRATOR', 'TENANT', 'SUSPENDED', null, null, 'null'],
      [people.optedOutA, ids.tenantA, 'ADMINISTRATOR', 'TENANT', 'ACTIVE', null, null, 'null'],
      [
        people.expiredA,
        ids.tenantA,
        'OWNER',
        'TENANT',
        'ACTIVE',
        null,
        null,
        "now() - interval '1 day'",
      ],
      [people.ownerB, ids.tenantB, 'OWNER', 'TENANT', 'ACTIVE', null, null, 'null'],
      [people.ownerC, ids.tenantC, 'OWNER', 'TENANT', 'ACTIVE', null, null, 'null'],
      [people.ownerD, ids.tenantD, 'OWNER', 'TENANT', 'ACTIVE', null, null, 'null'],
    ];
    for (const [person, tenant, role, scope, status, legal, station, expires] of rows) {
      await client.unsafe(`
        insert into app.users (id, name, email) values
          ('${person}', 'Person ${person.slice(-3)}', 'ae1-${person.slice(-3)}@example.test')
          on conflict (id) do nothing;
        insert into app.memberships (id, tenant_id, identity_id, status)
          values ('${membership(person)}', '${tenant}', '${person}', '${status}')
          on conflict (id) do nothing;
        insert into app.membership_role_assignments
          (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id, expires_at)
          select '${tenant}', '${membership(person)}', '${role}', '${scope}',
                 ${legal ? `'${legal}'` : 'null'}, ${station ? `'${station}'` : 'null'}, ${expires}
          where not exists (select 1 from app.membership_role_assignments
                            where membership_id = '${membership(person)}');
      `);
    }
    // Master switch: A and B on, C explicitly off, D never saved.
    await client.unsafe(`
      insert into app.alert_email_settings (tenant_id, enabled, version, updated_by) values
        ('${ids.tenantA}', true, 0, '${membership(people.ownerA)}'),
        ('${ids.tenantB}', true, 0, '${membership(people.ownerB)}'),
        ('${ids.tenantC}', false, 0, '${membership(people.ownerC)}')
        on conflict (tenant_id) do update set enabled = excluded.enabled, version = 0;
      insert into app.alert_email_preferences (tenant_id, membership_id, receive)
        values ('${ids.tenantA}', '${membership(people.optedOutA)}', false)
        on conflict do nothing;
    `);
    // One worked day at station one with no reconciliation: a late daily report for people who may
    // see reconciliations.
    await client.unsafe(`
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${id(31)}', '${ids.tenantA}', '${ids.s1}', (now() at time zone 'Africa/Harare')::date - 5, 'NOT_STARTED')
        on conflict (id) do nothing;
      update app.station_business_days set state = 'OPEN' where id = '${id(31)}' and state = 'NOT_STARTED';
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
        values ('${id(32)}', '${ids.tenantA}', '${ids.s1}', '${id(31)}', 'PLANNED',
                now() - interval '5 days', now() - interval '5 days' + interval '8 hours',
                (now() at time zone 'Africa/Harare')::date - 5)
        on conflict (id) do nothing;
      update app.shifts set state = 'OPEN' where id = '${id(32)}' and state = 'PLANNED';
    `);
    for (const who of ['ownerA', 'attendantA', 'supervisorA', 'ownerB'] as const) {
      await seedClerkSession(client, session(people[who]), token(who), people[who], true);
      await seedActiveStepUp(
        client,
        session(people[who]),
        who === 'ownerB' ? ids.tenantB : ids.tenantA,
      );
    }
  });

  afterAll(async () => client?.end());

  describe('who gets emailed', () => {
    it('lists exactly the right people and stations, and never anyone it should not', async () => {
      expect(await recipientKeys()).toEqual(
        [
          key(people.ownerA, ids.s1),
          key(people.ownerA, ids.s2),
          key(people.financeA, ids.s1),
          key(people.financeA, ids.s2),
          key(people.supervisorA, ids.s1), // a supervisor: only their own station
          key(people.ownerB, ids.sB),
        ].sort(),
      );
      // Not: attendant, supervisor with organisation-wide scope, suspended, opted out, expired role,
      // an organisation with the switch off or never saved, or a closed station.
    });

    it('returns exactly the documented columns', async () => {
      const rows = await client`select * from app.alert_digest_recipients(1)`;
      expect(Object.keys(rows[0]!).sort()).toEqual(
        [
          'display_name',
          'email',
          'identity_id',
          'legal_entity_id',
          'membership_id',
          'station_id',
          'station_name',
          'tenant_id',
        ].sort(),
      );
    });

    it('caps the list and treats a missing or negative cap as zero', async () => {
      expect(await client`select * from app.alert_digest_recipients(2)`).toHaveLength(2);
      expect(await client`select * from app.alert_digest_recipients(0)`).toHaveLength(0);
      expect(await client`select * from app.alert_digest_recipients(-5)`).toHaveLength(0);
      expect(await client`select * from app.alert_digest_recipients(null)`).toHaveLength(0);
    });

    it('is a locked-down definer: fixed search path, owned by the migration owner, not public', async () => {
      const [fn] = await client`
        select p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig,
               has_function_privilege('public', p.oid, 'execute') as public_exec
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'alert_digest_recipients'`;
      expect(fn).toMatchObject({ prosecdef: true, owner: 'migration_owner', public_exec: false });
      expect(fn!.proconfig).toEqual(['search_path=pg_catalog, app, pg_temp']);
      const roles = await client`select 1 from pg_roles where rolname = 'diagnostics_readonly'`;
      if (roles.length) {
        const [d] =
          await client`select has_function_privilege('diagnostics_readonly', 'app.alert_digest_recipients(integer)', 'execute') as ok`;
        expect(d!.ok).toBe(false);
      }
    });

    it('runs as the runtime role without any tenant context (that is how the job calls it)', async () => {
      const rows = await client.begin(async (tx) => {
        await tx`set local role app_runtime`;
        return tx`select membership_id from app.alert_digest_recipients(500) where tenant_id = ${ids.tenantA}`;
      });
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('the runtime role stays inside its own organisation', () => {
    it('sees only its own organisation’s switch and only its own preference', async () => {
      const settings = await asRuntime(
        ids.tenantA,
        people.ownerA,
        (tx) => tx`select tenant_id from app.alert_email_settings`,
      );
      expect(settings.map((r) => r.tenant_id)).toEqual([ids.tenantA]);
      // optedOutA's row exists, but ownerA cannot read another person's choice.
      const prefs = await asRuntime(
        ids.tenantA,
        people.ownerA,
        (tx) => tx`select membership_id from app.alert_email_preferences`,
      );
      expect(prefs).toEqual([]);
      const mine = await asRuntime(
        ids.tenantA,
        people.optedOutA,
        (tx) => tx`select receive from app.alert_email_preferences`,
      );
      expect(mine.map((r) => r.receive)).toEqual([false]);
    });

    it('cannot change another organisation’s switch or write another person’s preference', async () => {
      const changed = await asRuntime(
        ids.tenantA,
        people.ownerA,
        (tx) =>
          tx`update app.alert_email_settings set enabled = false where tenant_id = ${ids.tenantB} returning tenant_id`,
      );
      expect(changed).toEqual([]);
      await expect(
        asRuntime(
          ids.tenantA,
          people.ownerA,
          (tx) =>
            tx`insert into app.alert_email_preferences (tenant_id, membership_id, receive)
               values (${ids.tenantA}, ${membership(people.financeA)}, false)`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('delivery records are append-only and per person', async () => {
      await asRuntime(
        ids.tenantA,
        people.ownerA,
        (tx) =>
          tx`insert into app.alert_deliveries (tenant_id, membership_id, station_id, item_ids, message_id)
           values (${ids.tenantA}, ${membership(people.ownerA)}, ${ids.s1}, ARRAY['x']::text[], 'msg-own')`,
      );
      await expect(
        asRuntime(
          ids.tenantA,
          people.ownerA,
          (tx) =>
            tx`insert into app.alert_deliveries (tenant_id, membership_id, station_id, item_ids, message_id)
               values (${ids.tenantA}, ${membership(people.financeA)}, ${ids.s1}, ARRAY['x']::text[], 'msg-forged')`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asRuntime(
          ids.tenantA,
          people.ownerA,
          (tx) => tx`update app.alert_deliveries set message_id = 'z'`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asRuntime(ids.tenantA, people.ownerA, (tx) => tx`delete from app.alert_deliveries`),
      ).rejects.toMatchObject({ code: '42501' });
      // Even the owning role cannot rewrite history.
      await expect(client`update app.alert_deliveries set message_id = 'z'`).rejects.toThrow(
        /append-only/,
      );
      const other = await asRuntime(
        ids.tenantA,
        people.financeA,
        (tx) => tx`select message_id from app.alert_deliveries`,
      );
      expect(other).toEqual([]);
      const crossTenant = await asRuntime(
        ids.tenantB,
        people.ownerB,
        (tx) => tx`select message_id from app.alert_deliveries`,
      );
      expect(crossTenant).toEqual([]);
    });
  });

  describe('settings through the API', () => {
    it('a person can switch themselves off and on, and only themselves', async () => {
      expect((await api('supervisorA', 'GET')).body).toMatchObject({
        enabled: true,
        canManage: false,
        receive: true,
      });
      expect((await api('supervisorA', 'POST', { scope: 'ME', receive: false })).status).toBe(200);
      expect((await api('supervisorA', 'GET')).body.receive).toBe(false);
      expect(await recipientKeys()).not.toContain(key(people.supervisorA, ids.s1));
      expect((await api('supervisorA', 'POST', { scope: 'ME', receive: true })).status).toBe(200);
      expect(await recipientKeys()).toContain(key(people.supervisorA, ids.s1));
    });

    it('only an owner or administrator can change the organisation switch, and it is versioned', async () => {
      const denied = await api('attendantA', 'POST', {
        scope: 'ORGANISATION',
        enabled: false,
        expectedVersion: 0,
      });
      expect(denied.status).toBe(403);

      const blind = await api('ownerA', 'POST', { scope: 'ORGANISATION', enabled: false });
      expect(blind.status).toBe(409);
      const off = await api('ownerA', 'POST', {
        scope: 'ORGANISATION',
        enabled: false,
        expectedVersion: 0,
      });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ enabled: false, version: 1 });
      expect(
        (await recipientKeys()).filter((k) => k.includes(`@${ids.s1}`) || k.includes(`@${ids.s2}`)),
      ).toEqual([]);

      const on = await api('ownerA', 'POST', {
        scope: 'ORGANISATION',
        enabled: true,
        expectedVersion: 1,
      });
      expect(on.status).toBe(200);
      expect(await recipientKeys()).toContain(key(people.ownerA, ids.s1));
    });
  });

  describe('the run, as the recipient', () => {
    const recipient = async (person: string, station: string): Promise<DigestRecipient> => {
      const found = (await listDigestRecipients(500)).find(
        (r) => r.membershipId === membership(person) && r.stationId === station,
      );
      if (!found) throw new Error('recipient missing');
      return found;
    };
    const request = new Request(`http://127.0.0.1:3000/api/cron/alert-digests`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const sender = { send: async () => ({ messageId: 'unused' }) };

    it('only acts as a person inside a run with a real ticket', async () => {
      expect(() => authorizeDigestJob(request, 'a-different-secret-of-some-length-0123')).toThrow();
      expect(() => authorizeDigestJob(new Request('http://x/y'), CRON_SECRET)).toThrow();
      expect(() => authorizeDigestJob(request, undefined)).toThrow();
      expect(() => runAsDigestRecipient({} as never, people.ownerA, async () => 1)).toThrow();

      const ticket = authorizeDigestJob(request, CRON_SECRET);
      const seen = await runAsDigestRecipient(ticket, people.ownerA, async () => {
        const actor = await requireAuthenticatedActor(new Request('http://x/y'));
        return actor.identityId;
      });
      expect(seen).toBe(people.ownerA);
      // Outside the run nothing is impersonated.
      expect(digestActorOverride()).toBeUndefined();
      await expect(requireAuthenticatedActor(new Request('http://x/y'))).rejects.toThrow();
    });

    it('loads alerts with the person’s own access and remembers what was sent', async () => {
      const ticket = authorizeDigestJob(request, CRON_SECRET);
      const ports = createDigestPorts({ ticket, appUrl: 'http://127.0.0.1:3000', sender });
      const owner = await recipient(people.ownerA, ids.s1);
      const loaded = await ports.loadAlerts(owner);
      // The owner sees the late daily report.
      expect(loaded.items.map((item) => item.id)).toContain('reports-late');
      // An attendant at the same station is not allowed to see reconciliations, so is not told.
      const attendant: DigestRecipient = {
        ...owner,
        identityId: people.attendantA,
        membershipId: membership(people.attendantA),
      };
      expect((await ports.loadAlerts(attendant)).items.map((item) => item.id)).not.toContain(
        'reports-late',
      );

      // Reading as a person from another organisation sees nothing of this one.
      const stranger: DigestRecipient = {
        ...owner,
        identityId: people.ownerB,
        membershipId: membership(people.ownerB),
      };
      const strangerLoad = await ports.loadAlerts(stranger);
      expect(strangerLoad.items).toEqual([]);

      expect((await ports.lastSentItemIds(owner)).length).toBeGreaterThan(0); // the delivery test above
      await ports.recordSent(owner, ['cash-unbanked', 'reports-late'], 'msg-1');
      expect(await ports.lastSentItemIds(owner)).toEqual(['cash-unbanked', 'reports-late']);
      // Another person at the same station has their own history.
      const finance = await recipient(people.financeA, ids.s1);
      expect(await ports.lastSentItemIds(finance)).toEqual([]);
      // Another station for the same person too.
      const second = await recipient(people.ownerA, ids.s2);
      expect(await ports.lastSentItemIds(second)).toEqual([]);
    });
  });

  describe('the scheduled route', () => {
    const call = (headers: Record<string, string> = {}) =>
      cronGet(new Request('http://127.0.0.1:3000/api/cron/alert-digests', { headers }));
    const saved = {
      cron: process.env.CRON_SECRET,
      key: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL,
    };
    afterAll(() => {
      for (const [name, value] of [
        ['CRON_SECRET', saved.cron],
        ['RESEND_API_KEY', saved.key],
        ['RESEND_FROM_EMAIL', saved.from],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it('refuses when no secret is configured', async () => {
      delete process.env.CRON_SECRET;
      expect((await call({ authorization: `Bearer ${CRON_SECRET}` })).status).toBe(503);
    });

    it('refuses a missing or wrong secret', async () => {
      process.env.CRON_SECRET = CRON_SECRET;
      expect((await call()).status).toBe(401);
      expect(
        (await call({ authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong' })).status,
      ).toBe(401);
      expect((await call({ authorization: CRON_SECRET })).status).toBe(401);
    });

    it('refuses to run when email is not configured', async () => {
      process.env.CRON_SECRET = CRON_SECRET;
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_FROM_EMAIL;
      expect((await call({ authorization: `Bearer ${CRON_SECRET}` })).status).toBe(503);
    });
  });
});
