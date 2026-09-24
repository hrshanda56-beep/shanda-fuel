import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for pnpm test:integration. Configure a dedicated test PostgreSQL database; the canonical integration gate does not skip.',
  );
}
let client: ReturnType<typeof postgres>;

describe('PostgreSQL integration harness', () => {
  beforeAll(() => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('connects to the configured PostgreSQL test database', async () => {
    const result = await client<{ one: number }[]>`select 1 as one`;
    expect(result[0]?.one).toBe(1);
  });

  it('sees the namespaces from the canonical migration', async () => {
    const rows = await client<{ schema_name: string }[]>`
      select schema_name
      from information_schema.schemata
      where schema_name in ('auth', 'app', 'platform')
      order by schema_name
    `;

    expect(rows.map((row) => row.schema_name)).toEqual(['app', 'auth', 'platform']);
  });

  it('sees the ordered canonical migration history and security objects', async () => {
    const migrations = await client<{ tag: string }[]>`
      select hash as tag from drizzle.__drizzle_migrations order by created_at
    `;
    expect(migrations).toHaveLength(9);

    const objects = await client<{ schema_name: string; table_name: string }[]>`
      select table_schema as schema_name, table_name
      from information_schema.tables
      where (table_schema, table_name) in (
        ('auth', 'user'), ('auth', 'session'), ('auth', 'account'), ('auth', 'verification'),
        ('app', 'tenants'), ('app', 'memberships'), ('app', 'forecourt_idempotency_records'),
        ('app', 'forecourt_outbox'), ('app', 'cash_collections'),
        ('app', 'cash_collection_allocations'), ('app', 'bank_deposits'),
        ('app', 'bank_deposit_allocations'), ('platform', 'security_events')
      )
      order by table_schema, table_name
    `;
    expect(objects).toHaveLength(13);

    const policies = await client<{ policyname: string }[]>`
      select policyname
      from pg_policies
      where schemaname = 'platform' and tablename = 'security_events'
      order by policyname
    `;
    expect(policies.map((row) => row.policyname)).toEqual([
      'security_events_append',
      'security_events_context',
    ]);

    const constraintNames = await client<{ conname: string }[]>`
      select c.conname
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where n.nspname in ('auth', 'app', 'platform')
    `;
    expect(constraintNames).toContainEqual({
      conname: 'temporary_permission_grants_permission_code_fk',
    });
    expect(constraintNames.every(({ conname }) => conname.length <= 63)).toBe(true);
  });
});
