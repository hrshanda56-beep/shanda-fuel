import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { makeSignature } from 'better-auth/crypto';
import { resolveAuthenticatedActor } from '../../src/modules/identity/authenticated-actor';
import {
  loadTenantMembershipWithDatabase,
  resolveTenantExecutionContext,
} from '../../src/modules/tenancy/authority';
import { getAuth } from '../../src/platform/auth/server';
import * as schema from '../../src/platform/db/schema';
import type { Database } from '../../src/platform/db';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A1 isolation integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const legalEntityA = '33333333-3333-4333-8333-333333333333';
const legalEntityB = '44444444-4444-4444-8444-444444444444';
const actorA = '55555555-5555-4555-8555-555555555555';
const actorB = '66666666-6666-4666-8666-666666666666';
const actorWithoutMembership = '99999999-9999-4999-8999-999999999999';
const membershipA = '77777777-7777-4777-8777-777777777777';
const membershipB = '88888888-8888-4888-8888-888888888888';
const tenantInactive = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorInactive = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const membershipInactive = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const roleAssignmentA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const temporaryGrantA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const forgedMembership = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const authSessionToken = 'a1-auth-session-token';
const authSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const expiredSessionToken = 'a1-expired-session-token';
const expiredSessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const noMembershipSessionToken = 'a1-no-membership-session-token';
const noMembershipSessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const runtimeRoles = ['app_runtime', 'job_runtime', 'diagnostics_readonly'] as const;

let client: ReturnType<typeof postgres>;
let runtimeClient: ReturnType<typeof postgres>;
let runtimeDatabase: Database;

async function setTenantContext(
  sql: Sql | TransactionSql,
  tenantId: string,
  actorId: string,
  membershipId: string,
): Promise<void> {
  await sql`select set_config('app.tenant_id', ${tenantId}, false)`;
  await sql`select set_config('app.actor_id', ${actorId}, false)`;
  await sql`select set_config('app.membership_id', ${membershipId}, false)`;
}

async function clearTenantContext(sql: Sql | TransactionSql): Promise<void> {
  await sql`reset app.tenant_id`;
  await sql`reset app.actor_id`;
  await sql`reset app.membership_id`;
}

describe('A1 PostgreSQL tenant isolation and canonical security', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
    const tables = await client<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'app' and table_name in ('tenants', 'memberships')
      order by table_name
    `;
    expect(tables.map((row) => row.table_name)).toEqual(['memberships', 'tenants']);

    await client.unsafe(`
      insert into app.tenants (id, name, slug)
      values
        ('${tenantA}', 'Tenant A', 'a-isolation-test'),
        ('${tenantB}', 'Tenant B', 'b-isolation-test'),
        ('${tenantInactive}', 'Tenant Inactive', 'inactive-membership-test')
      on conflict (id) do nothing;
      insert into auth."user" (id, name, email)
        values
          ('${actorA}', 'Actor A', 'a-isolation@example.test'),
          ('${actorB}', 'Actor B', 'b-isolation@example.test'),
          ('${actorWithoutMembership}', 'Actor Without Membership', 'no-membership@example.test'),
          ('${actorInactive}', 'Actor Inactive', 'inactive-membership@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status)
        values
          ('${membershipA}', '${tenantA}', '${actorA}', 'ACTIVE'),
          ('${membershipB}', '${tenantB}', '${actorB}', 'ACTIVE'),
          ('${membershipInactive}', '${tenantInactive}', '${actorInactive}', 'SUSPENDED')
        on conflict (id) do update set status = 'ACTIVE';
      update app.memberships
      set status = 'SUSPENDED'
      where id = '${membershipInactive}';
      insert into app.membership_role_assignments (
        id, tenant_id, membership_id, role_code, scope_type
      ) values (
        '${roleAssignmentA}', '${tenantA}', '${membershipA}', 'SUPERVISOR', 'TENANT'
      )
      on conflict (id) do update set
        tenant_id = excluded.tenant_id,
        membership_id = excluded.membership_id,
        role_code = excluded.role_code,
        scope_type = excluded.scope_type;
      insert into app.temporary_permission_grants (
        id, tenant_id, membership_id, permission_code, scope_type, expires_at, reason
      ) values (
        '${temporaryGrantA}', '${tenantA}', '${membershipA}', 'report.view', 'TENANT',
        '2030-01-01T00:00:00Z', 'A1 runtime authority integration test'
      )
      on conflict (id) do update set
        tenant_id = excluded.tenant_id,
        membership_id = excluded.membership_id,
        permission_code = excluded.permission_code,
        scope_type = excluded.scope_type,
        expires_at = excluded.expires_at,
        revoked_at = null,
        reason = excluded.reason;
    `);

    runtimeClient = postgres(databaseUrl, { max: 1, prepare: false });
    await runtimeClient.unsafe('set role app_runtime');
    runtimeDatabase = drizzle(runtimeClient, { schema });
  });

  afterAll(async () => {
    await client?.end();
    await runtimeClient?.end();
  });

  it('loads authority through app_runtime and rejects forged or invalid membership context', async () => {
    const session = {
      sessionId: authSessionId,
      userId: actorA,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    };
    const request = new Request('http://127.0.0.1:3000/api/test');
    const loadRuntimeMembership = (identityId: string, tenantId: string) =>
      loadTenantMembershipWithDatabase(identityId, tenantId, runtimeDatabase);

    const active = await resolveTenantExecutionContext({
      request,
      requestedTenantId: tenantA,
      resolveActor: async () => ({ identityId: actorA, session }),
      loadMembership: loadRuntimeMembership,
      now: new Date('2026-09-20T10:00:00Z'),
    });
    expect(active.membership.membershipId).toBe(membershipA);
    expect(active.membership.roleAssignments).toEqual([
      expect.objectContaining({ roleCode: 'SUPERVISOR', tenantId: tenantA, scopeType: 'TENANT' }),
    ]);
    expect(active.membership.temporaryGrants).toEqual([
      expect.objectContaining({ permissionCode: 'report.view', tenantId: tenantA }),
    ]);

    await expect(
      resolveTenantExecutionContext({
        request,
        requestedTenantId: tenantB,
        resolveActor: async () => ({ identityId: actorA, session }),
        loadMembership: loadRuntimeMembership,
      }),
    ).rejects.toThrow('no membership');

    await expect(
      resolveTenantExecutionContext({
        request,
        requestedTenantId: tenantA,
        resolveActor: async () => ({ identityId: actorB, session: { ...session, userId: actorB } }),
        loadMembership: loadRuntimeMembership,
      }),
    ).rejects.toThrow('no membership');

    await expect(
      resolveTenantExecutionContext({
        request,
        requestedTenantId: tenantInactive,
        resolveActor: async () => ({
          identityId: actorInactive,
          session: { ...session, userId: actorInactive },
        }),
        loadMembership: loadRuntimeMembership,
      }),
    ).rejects.toThrow('active membership');

    await runtimeClient.begin(async (transaction) => {
      await setTenantContext(transaction, tenantA, actorA, forgedMembership);
      const activeMembership = await transaction<{ active: boolean }[]>`
        select app.has_active_membership() as active
      `;
      const assignments = await transaction<{ id: string }[]>`
        select id
        from app.membership_role_assignments
        where tenant_id = ${tenantA} and membership_id = ${membershipA}
      `;
      expect(activeMembership[0]?.active).toBe(false);
      expect(assignments).toEqual([]);
    });
  });

  it('verifies Better Auth UUID identity compatibility and the membership foreign key', async () => {
    const columns = await client<
      { table_schema: string; table_name: string; column_name: string; data_type: string }[]
    >`
      select table_schema, table_name, column_name, data_type
      from information_schema.columns
      where (table_schema, table_name, column_name) in (
        ('auth', 'user', 'id'), ('app', 'memberships', 'identity_id')
      )
      order by table_schema
    `;
    expect(columns.map((row) => row.data_type)).toEqual(['uuid', 'uuid']);
    expect(columns.map((row) => row.column_name)).toEqual(['identity_id', 'id']);
    const types = await client<
      { table_schema: string; table_name: string; column_name: string; udt_name: string }[]
    >`
      select table_schema, table_name, column_name, udt_name
      from information_schema.columns
      where (table_schema, table_name, column_name) in (
        ('auth', 'user', 'id'), ('app', 'memberships', 'identity_id')
      )
      order by table_schema
    `;
    expect(types.map((row) => row.udt_name)).toEqual(['uuid', 'uuid']);

    const foreignKey = await client<{ count: string }[]>`
      select count(*)::text as count
      from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_namespace child_ns on child_ns.oid = child.relnamespace
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
      where c.contype = 'f'
        and child_ns.nspname = 'app'
        and child.relname = 'memberships'
        and parent_ns.nspname = 'auth'
        and parent.relname = 'user'
    `;
    expect(foreignKey[0]?.count).toBe('1');
  });

  it('isolates SELECT and UPDATE across tenants', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await client.begin(async (transaction) => {
        await setTenantContext(transaction, tenantA, actorA, membershipA);
        await transaction`update app.tenants set name = 'Tenant A' where id = ${tenantA}`;
        await transaction`
          insert into app.legal_entities (id, tenant_id, legal_name)
          values (${legalEntityA}, ${tenantA}, 'Tenant A Legal Entity')
          on conflict (id) do nothing
        `;

        await setTenantContext(transaction, tenantB, actorB, membershipB);
        await transaction`update app.tenants set name = 'Tenant B' where id = ${tenantB}`;
        await transaction`
          insert into app.legal_entities (id, tenant_id, legal_name)
          values (${legalEntityB}, ${tenantB}, 'Tenant B Legal Entity')
          on conflict (id) do nothing
        `;

        await setTenantContext(transaction, tenantA, actorA, membershipA);
        const visible = await transaction<{ id: string }[]>`
          select id from app.tenants order by id
        `;
        expect(visible.map((row) => row.id)).toEqual([tenantA]);
        const crossTenantUpdate = await transaction`
          update app.tenants set name = 'cross-tenant-write' where id = ${tenantB}
        `;
        expect(crossTenantUpdate.count).toBe(0);
      });
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('rejects cross-tenant INSERT and DELETE, and fails closed without context', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await setTenantContext(client, tenantA, actorA, membershipA);
      await expect(
        client`
          insert into app.tenants (id, name, slug)
          values ('77777777-7777-4777-8777-777777777777', 'Tenant B Copy', 'b-copy')
        `,
      ).rejects.toThrow();
      const crossTenantDelete = await client`delete from app.tenants where id = ${tenantB}`;
      expect(crossTenantDelete.count).toBe(0);

      await clearTenantContext(client);
      const visibleWithoutContext = await client<{ id: string }[]>`select id from app.tenants`;
      expect(visibleWithoutContext).toEqual([]);
      await expect(
        client`
          insert into app.tenants (id, name, slug)
          values ('66666666-6666-4666-8666-666666666666', 'No Context', 'no-context')
        `,
      ).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('requires an active persisted membership, not just tenant and actor UUIDs', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await setTenantContext(client, tenantA, actorA, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
      const rawUuidOnly = await client<{ id: string }[]>`select id from app.tenants`;
      expect(rawUuidOnly).toEqual([]);
    } finally {
      await client.unsafe('reset role');
    }

    for (const status of ['INVITED', 'SUSPENDED', 'LOCKED', 'DISABLED'] as const) {
      await client.unsafe(
        `update app.memberships set status = '${status}' where id = '${membershipA}'`,
      );
      await client.unsafe('set role app_runtime');
      try {
        await setTenantContext(client, tenantA, actorA, membershipA);
        const visible = await client<{ id: string }[]>`select id from app.tenants`;
        expect(visible).toEqual([]);
      } finally {
        await client.unsafe('reset role');
      }
      await client.unsafe(
        `update app.memberships set status = 'ACTIVE' where id = '${membershipA}'`,
      );
    }
  });

  it('rejects a cross-tenant composite foreign-key link', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await setTenantContext(client, tenantA, actorA, membershipA);
      await expect(
        client`
          insert into app.stations (id, tenant_id, legal_entity_id, code, name)
          values ('99999999-9999-4999-8999-999999999999', ${tenantA}, ${legalEntityB}, 'BAD', 'Bad link')
        `,
      ).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('proves runtime role ownership, RLS, and no bypass privileges', async () => {
    const roles = await client<{ rolname: string; rolbypassrls: boolean; rolinherit: boolean }[]>`
      select rolname, rolbypassrls, rolinherit
      from pg_roles
      where rolname in ('app_runtime', 'job_runtime', 'diagnostics_readonly')
      order by rolname
    `;
    expect(roles.map((row) => row.rolname)).toEqual([...runtimeRoles].sort());
    expect(roles.every((row) => row.rolbypassrls === false && row.rolinherit === false)).toBe(true);

    const owners = await client<{ relname: string; owner: string }[]>`
      select c.relname, r.rolname as owner
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_roles r on r.oid = c.relowner
      where n.nspname in ('app', 'platform')
        and c.relname in ('tenants', 'legal_entities', 'stations', 'memberships',
          'membership_role_assignments', 'temporary_permission_grants', 'security_events')
      order by c.relname
    `;
    expect(owners).toEqual([
      { relname: 'legal_entities', owner: 'migration_owner' },
      { relname: 'membership_role_assignments', owner: 'migration_owner' },
      { relname: 'memberships', owner: 'migration_owner' },
      { relname: 'security_events', owner: 'migration_owner' },
      { relname: 'stations', owner: 'migration_owner' },
      { relname: 'temporary_permission_grants', owner: 'migration_owner' },
      { relname: 'tenants', owner: 'migration_owner' },
    ]);

    const rls = await client<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('app', 'platform')
        and c.relname in ('tenants', 'legal_entities', 'stations', 'memberships',
          'membership_role_assignments', 'temporary_permission_grants', 'security_events')
      order by c.relname
    `;
    expect(rls).toHaveLength(7);
    expect(rls.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    for (const role of ['app_runtime', 'job_runtime'] as const) {
      await client.unsafe(`set role ${role}`);
      try {
        await expect(
          client.unsafe('alter table app.tenants disable row level security'),
        ).rejects.toThrow();
        await expect(
          client.unsafe('alter policy tenants_context on app.tenants using (true)'),
        ).rejects.toThrow();
      } finally {
        await client.unsafe('reset role');
      }
    }
  });

  it('enforces the security-event privilege matrix with real PostgreSQL roles', async () => {
    const privileges = await client<
      { grantee: string; privilege_type: string; has_privilege: boolean }[]
    >`
      select grantee, privilege_type,
        has_table_privilege(grantee, 'platform.security_events', privilege_type) as has_privilege
      from (values
        ('app_runtime', 'UPDATE'), ('app_runtime', 'DELETE'), ('app_runtime', 'TRUNCATE'),
        ('job_runtime', 'UPDATE'), ('job_runtime', 'DELETE'), ('job_runtime', 'TRUNCATE'),
        ('diagnostics_readonly', 'INSERT'), ('diagnostics_readonly', 'UPDATE'),
        ('diagnostics_readonly', 'DELETE'), ('diagnostics_readonly', 'TRUNCATE'),
        ('app_runtime', 'REFERENCES'), ('app_runtime', 'TRIGGER')
      ) as expected(grantee, privilege_type)
    `;
    expect(privileges.every((row) => row.has_privilege === false)).toBe(true);

    await client.unsafe('set role app_runtime');
    try {
      await setTenantContext(client, tenantA, actorA, membershipA);
      const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      await client`
        insert into platform.security_events (
          id, tenant_id, membership_id, actor_id, event_code,
          request_id, details, key_id, algorithm, signature
        ) values (
          ${eventId}, ${tenantA}, ${membershipA}, ${actorA}, 'SECURITY_TEST',
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '{}'::jsonb, 'test-key',
          'hmac-sha256', 'test-signature'
        )
      `;
      await expect(
        client`update platform.security_events set event_code = 'MUTATED' where id = ${eventId}`,
      ).rejects.toThrow();
      await expect(
        client`delete from platform.security_events where id = ${eventId}`,
      ).rejects.toThrow();
      await expect(client`truncate platform.security_events`).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }

    await client.unsafe('set role job_runtime');
    try {
      await setTenantContext(client, tenantA, actorA, membershipA);
      await expect(
        client`update platform.security_events set event_code = 'MUTATED'`,
      ).rejects.toThrow();
      await expect(client`delete from platform.security_events`).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }

    await client.unsafe('set role diagnostics_readonly');
    try {
      await expect(
        client`insert into platform.security_events (id, tenant_id, event_code, request_id, key_id, signature) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', ${tenantA}, 'DIAGNOSTIC_TEST', '11111111-1111-4111-8111-111111111111', 'test-key', 'test-signature')`,
      ).rejects.toThrow();
      await expect(
        client`update platform.security_events set event_code = 'MUTATED'`,
      ).rejects.toThrow();
      await expect(client`delete from platform.security_events`).rejects.toThrow();
      await expect(client`truncate platform.security_events`).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('rejects pre-tenant events in the tenant-scoped security event stream', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await clearTenantContext(client);
      await client.unsafe(`select set_config('app.actor_id', '${actorA}', false)`);
      await expect(client`
        insert into platform.security_events (
          id, tenant_id, actor_id, event_code, request_id,
          details, key_id, algorithm, signature
        ) values (
          '12121212-1212-4121-8121-121212121212', null, ${actorA}, 'LOGIN',
          '13131313-1313-4131-8131-131313131313', '{}'::jsonb, 'test-key',
          'hmac-sha256', 'test-signature'
        )
      `).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
      await clearTenantContext(client);
    }
  });

  it('persists Better Auth user/session/account/verification rows and loads a session through the adapter', async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    const authSecret = process.env.BETTER_AUTH_SECRET;
    if (!authSecret) throw new Error('BETTER_AUTH_SECRET is required for this integration test');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 60 * 1000);
    await client`
      insert into auth.session (id, expires_at, token, user_id, ip_address, user_agent)
      values (${authSessionId}, ${expiresAt}, ${authSessionToken}, ${actorA}, '127.0.0.1', 'vitest')
      on conflict (id) do update set expires_at = excluded.expires_at
    `;
    await client`
      insert into auth.session (id, expires_at, token, user_id)
      values (${expiredSessionId}, ${expiredAt}, ${expiredSessionToken}, ${actorA})
      on conflict (id) do update set expires_at = excluded.expires_at
    `;
    await client`
      insert into auth.session (id, expires_at, token, user_id)
      values (${noMembershipSessionId}, ${expiresAt}, ${noMembershipSessionToken}, ${actorWithoutMembership})
      on conflict (id) do update set expires_at = excluded.expires_at
    `;
    await client`
      insert into auth.account (id, account_id, provider_id, user_id, password)
      values ('14141414-1414-4141-8141-141414141414', ${actorA}, 'credential', ${actorA}, 'integration-hash')
      on conflict (id) do nothing
    `;
    await client`
      insert into auth.verification (id, identifier, value, expires_at)
      values ('15151515-1515-4151-8151-151515151515', 'integration@example.test', 'verification-value', ${expiresAt})
      on conflict (id) do nothing
    `;

    const counts = await client<
      {
        user_count: string;
        session_count: string;
        account_count: string;
        verification_count: string;
      }[]
    >`
      select
        (select count(*) from auth."user")::text as user_count,
        (select count(*) from auth.session where token in (${authSessionToken}, ${expiredSessionToken}, ${noMembershipSessionToken}))::text as session_count,
        (select count(*) from auth.account where id = '14141414-1414-4141-8141-141414141414')::text as account_count,
        (select count(*) from auth.verification where id = '15151515-1515-4151-8151-151515151515')::text as verification_count
    `;
    expect(counts[0]).toMatchObject({
      session_count: '3',
      account_count: '1',
      verification_count: '1',
    });
    expect(Number(counts[0]?.user_count)).toBeGreaterThanOrEqual(3);

    const auth = getAuth();
    const signedSessionToken = `${authSessionToken}.${await makeSignature(authSessionToken, authSecret)}`;
    const signedExpiredSessionToken = `${expiredSessionToken}.${await makeSignature(expiredSessionToken, authSecret)}`;
    const request = new Request('http://127.0.0.1:3000/api/auth/get-session', {
      headers: { cookie: `shanda-fuel.session_token=${signedSessionToken}` },
    });
    const loaded = await auth.api.getSession({ headers: request.headers });
    expect(loaded?.user.id).toBe(actorA);
    expect(loaded?.session.userId).toBe(actorA);
    const expired = await auth.api.getSession({
      headers: new Headers({ cookie: `shanda-fuel.session_token=${signedExpiredSessionToken}` }),
    });
    expect(expired).toBeNull();

    const actor = await resolveAuthenticatedActor(request, auth);
    expect(actor?.identityId).toBe(actorA);
    const activeContext = await resolveTenantExecutionContext({
      request,
      requestedTenantId: tenantA,
      resolveActor: (currentRequest) => resolveAuthenticatedActor(currentRequest, auth),
    });
    expect(activeContext.membership.membershipId).toBe(membershipA);

    const noMembershipRequest = new Request('http://127.0.0.1:3000/api/auth/get-session', {
      headers: { cookie: `shanda-fuel.session_token=${noMembershipSessionToken}` },
    });
    await expect(
      resolveTenantExecutionContext({
        request: noMembershipRequest,
        requestedTenantId: tenantA,
        resolveActor: (currentRequest) => resolveAuthenticatedActor(currentRequest, auth),
      }),
    ).rejects.toThrow();
  });
});
