import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql, type TransactionSql } from 'postgres';

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
const membershipA = '77777777-7777-4777-8777-777777777777';
const membershipB = '88888888-8888-4888-8888-888888888888';
const runtimeRole = 'a1_runtime_test';

let client: ReturnType<typeof postgres>;

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

describe('A1 PostgreSQL tenant isolation', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
    const proposal = readFileSync(
      resolve(process.cwd(), 'docs/architecture/a1-platform-security-migration.sql'),
      'utf8',
    );
    await client.unsafe(proposal);
    await client.unsafe(`
      insert into app.tenants (id, name, slug)
      values
        ('${tenantA}', 'Tenant A', 'a-isolation-test'),
        ('${tenantB}', 'Tenant B', 'b-isolation-test')
      on conflict (id) do nothing;
      insert into auth."user" (id, name, email)
      values
        ('${actorA}', 'Actor A', 'a-isolation@example.test'),
        ('${actorB}', 'Actor B', 'b-isolation@example.test')
      on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status)
      values
        ('${membershipA}', '${tenantA}', '${actorA}', 'ACTIVE'),
        ('${membershipB}', '${tenantB}', '${actorB}', 'ACTIVE')
      on conflict (id) do update set status = 'ACTIVE';
    `);
    await client.unsafe(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = '${runtimeRole}') then
          create role ${runtimeRole}
            login password 'a1-runtime-test'
            nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
        end if;
      end $$;
    `);
    await client.unsafe(
      `alter role ${runtimeRole} nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`,
    );
    await client.unsafe(`grant usage on schema app, platform to ${runtimeRole}`);
    await client.unsafe(`grant select, insert, update, delete on
      app.tenants, app.legal_entities, app.stations, app.memberships,
      app.membership_role_assignments, app.temporary_permission_grants to ${runtimeRole}`);
    await client.unsafe(`grant select, insert on platform.security_events to ${runtimeRole}`);
    await client.unsafe(`revoke update, delete on platform.security_events from ${runtimeRole}`);
    await client.unsafe(`grant execute on function
      app.current_tenant_id(), app.current_actor_id(), app.current_membership_id(),
      app.has_active_membership()
      to ${runtimeRole}`);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('isolates SELECT and UPDATE across tenants', async () => {
    await client.unsafe(`set role ${runtimeRole}`);
    try {
      await client.begin(async (transaction) => {
        await setTenantContext(transaction, tenantA, actorA, membershipA);
        await transaction`
          update app.tenants set name = 'Tenant A'
          where id = ${tenantA}
        `;
        await transaction`
          insert into app.legal_entities (id, tenant_id, legal_name)
          values (${legalEntityA}, ${tenantA}, 'Tenant A Legal Entity')
          on conflict (id) do nothing
        `;

        await setTenantContext(transaction, tenantB, actorB, membershipB);
        await transaction`
          update app.tenants set name = 'Tenant B'
          where id = ${tenantB}
        `;
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
          update app.tenants set name = 'cross-tenant-write'
          where id = ${tenantB}
        `;
        expect(crossTenantUpdate.count).toBe(0);
      });
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('rejects cross-tenant INSERT and DELETE, and fails closed without context', async () => {
    await client.unsafe(`set role ${runtimeRole}`);
    try {
      await setTenantContext(client, tenantA, actorA, membershipA);
      await expect(
        client`
          insert into app.tenants (id, name, slug)
          values ('77777777-7777-4777-8777-777777777777', 'Tenant B Copy', 'b-copy')
        `,
      ).rejects.toThrow();

      const crossTenantDelete = await client`
        delete from app.tenants where id = ${tenantB}
      `;
      expect(crossTenantDelete.count).toBe(0);

      await client.unsafe('reset app.tenant_id');
      await client.unsafe('reset app.actor_id');
      await client.unsafe('reset app.membership_id');
      const visibleWithoutContext = await client<{ id: string }[]>`
        select id from app.tenants
      `;
      expect(visibleWithoutContext).toEqual([]);
      await expect(
        client`
          insert into app.tenants (id, name, slug)
          values ('88888888-8888-4888-8888-888888888888', 'No Context', 'no-context')
        `,
      ).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('requires an active persisted membership, not just tenant and actor UUIDs', async () => {
    await client.unsafe(`set role ${runtimeRole}`);
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
      await client.unsafe(`set role ${runtimeRole}`);
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
    await client.unsafe(`set role ${runtimeRole}`);
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

  it('uses a non-bypass runtime role that cannot disable RLS', async () => {
    const role = await client<{ rolbypassrls: boolean }[]>`
      select rolbypassrls from pg_roles where rolname = ${runtimeRole}
    `;
    expect(role[0]?.rolbypassrls).toBe(false);

    await client.unsafe(`set role ${runtimeRole}`);
    try {
      await expect(
        client.unsafe('alter table app.tenants disable row level security'),
      ).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('denies UPDATE and DELETE of persisted security events to the runtime role', async () => {
    await client.unsafe(`set role ${runtimeRole}`);
    try {
      await setTenantContext(client, tenantA, actorA, membershipA);
      const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await client`
        insert into platform.security_events (
          id, event_scope, tenant_id, membership_id, actor_id, event_code,
          request_id, details, key_id, algorithm, signature
        ) values (
          ${eventId}, 'TENANT', ${tenantA}, ${membershipA}, ${actorA},
          'SECURITY_TEST', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          '{}'::jsonb, 'test-key', 'hmac-sha256', 'test-signature'
        )
      `;
      await expect(
        client`update platform.security_events set event_code = 'MUTATED' where id = ${eventId}`,
      ).rejects.toThrow();
      await expect(
        client`delete from platform.security_events where id = ${eventId}`,
      ).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('allows identity-scoped pre-tenant events without exposing them to tenant reads', async () => {
    await client.unsafe(`set role ${runtimeRole}`);
    try {
      await client.unsafe('reset app.tenant_id');
      await client.unsafe('reset app.membership_id');
      await client.unsafe(`select set_config('app.actor_id', '${actorA}', false)`);
      await client`
        insert into platform.security_events (
          id, event_scope, actor_id, event_code, request_id,
          details, key_id, algorithm, signature
        ) values (
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'IDENTITY', ${actorA},
          'LOGIN', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          '{}'::jsonb, 'test-key', 'hmac-sha256', 'test-signature'
        )
      `;
      const visible = await client`select id from platform.security_events`;
      expect(visible).toEqual([]);
    } finally {
      await client.unsafe('reset role');
      await client.unsafe('reset app.actor_id');
    }
  });
});
