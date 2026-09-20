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

let client: ReturnType<typeof postgres>;

async function setTenantContext(
  sql: Sql | TransactionSql,
  tenantId: string,
  actorId: string,
): Promise<void> {
  await sql`select set_config('app.tenant_id', ${tenantId}, false)`;
  await sql`select set_config('app.actor_id', ${actorId}, false)`;
}

describe('A1 PostgreSQL tenant isolation', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
    const proposal = readFileSync(
      resolve(process.cwd(), 'docs/architecture/a1-platform-security-migration.sql'),
      'utf8',
    );
    await client.unsafe(proposal);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('isolates SELECT and UPDATE across tenants', async () => {
    await client.begin(async (transaction) => {
      await setTenantContext(transaction, tenantA, actorA);
      await transaction`
        insert into app.tenants (id, name, slug)
        values (${tenantA}, 'Tenant A', 'a-isolation-test')
        on conflict (id) do update set name = excluded.name
      `;
      await transaction`
        insert into app.legal_entities (id, tenant_id, legal_name)
        values (${legalEntityA}, ${tenantA}, 'Tenant A Legal Entity')
        on conflict (id) do nothing
      `;

      await setTenantContext(transaction, tenantB, actorB);
      await transaction`
        insert into app.tenants (id, name, slug)
        values (${tenantB}, 'Tenant B', 'b-isolation-test')
        on conflict (id) do update set name = excluded.name
      `;
      await transaction`
        insert into app.legal_entities (id, tenant_id, legal_name)
        values (${legalEntityB}, ${tenantB}, 'Tenant B Legal Entity')
        on conflict (id) do nothing
      `;

      await setTenantContext(transaction, tenantA, actorA);
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
  });

  it('rejects a cross-tenant composite foreign-key link', async () => {
    await setTenantContext(client, tenantA, actorA);
    await expect(
      client`
        insert into app.stations (id, tenant_id, legal_entity_id, code, name)
        values ('77777777-7777-4777-8777-777777777777', ${tenantA}, ${legalEntityB}, 'BAD', 'Bad link')
      `,
    ).rejects.toThrow();
  });
});
