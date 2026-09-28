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

  it('denies auth schema reads to non-auth runtime roles', async () => {
    const privileges = await client<
      {
        rolname: string;
        table_name: string;
        schema_usage: boolean;
        can_select: boolean;
      }[]
    >`
      select
        r.rolname,
        c.relname as table_name,
        has_schema_privilege(r.rolname, 'auth', 'USAGE') as schema_usage,
        has_table_privilege(r.rolname, c.oid, 'SELECT') as can_select
      from pg_roles r
      cross join pg_namespace n
      cross join pg_class c
      where r.rolname in ('job_runtime', 'diagnostics_readonly')
        and n.nspname = 'auth'
        and c.relnamespace = n.oid
        and c.relkind in ('r', 'p')
        and c.relname in ('user', 'session', 'account', 'verification', 'two_factor')
      order by r.rolname, c.relname
    `;

    expect(privileges).toHaveLength(10);
    expect(
      privileges.every(
        ({ schema_usage, can_select }) => schema_usage === false && can_select === false,
      ),
    ).toBe(true);
  });

  it('sees the ordered canonical migration history and security objects', async () => {
    const migrations = await client<{ tag: string }[]>`
      select hash as tag from drizzle.__drizzle_migrations order by created_at
    `;
    expect(migrations).toHaveLength(20);

    const stepUpBinding = await client<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'auth'
        and table_name = 'session'
        and column_name = 'step_up_tenant_id'
    `;
    expect(stepUpBinding).toEqual([{ column_name: 'step_up_tenant_id' }]);

    const objects = await client<{ schema_name: string; table_name: string }[]>`
      select table_schema as schema_name, table_name
      from information_schema.tables
      where (table_schema, table_name) in (
        ('auth', 'user'), ('auth', 'session'), ('auth', 'account'), ('auth', 'verification'),
        ('auth', 'two_factor'),
        ('app', 'tenants'), ('app', 'memberships'), ('app', 'forecourt_idempotency_records'),
        ('app', 'forecourt_outbox'), ('app', 'cash_collections'),
        ('app', 'cash_collection_allocations'), ('app', 'bank_deposits'),
        ('app', 'bank_deposit_allocations'), ('app', 'payment_providers'),
        ('app', 'provider_accounts'), ('app', 'provider_settlements'),
        ('app', 'provider_settlement_allocations'), ('platform', 'security_events')
      )
      order by table_schema, table_name
    `;
    expect(objects).toHaveLength(18);

    const a12Table = await client<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      select c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = 'reconciliation_meter_reading_segments'
    `;
    expect(a12Table).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);

    const a12Constraints = await client<{ conname: string }[]>`
      select c.conname
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'app'
        and c.conname in (
          'reconciliation_meter_reading_segments_reconciliation_fk',
          'reconciliation_meter_reading_segments_revision_fk',
          'reconciliation_meter_reading_segments_reading_fk',
          'reconciliation_meter_reading_segments_meter_segment_fk',
          'reconciliation_meter_reading_segments_nonnegative_litres_ck'
        )
      order by c.conname
    `;
    expect(a12Constraints.map((row) => row.conname)).toEqual([
      'reconciliation_meter_reading_segments_meter_segment_fk',
      'reconciliation_meter_reading_segments_nonnegative_litres_ck',
      'reconciliation_meter_reading_segments_reading_fk',
      'reconciliation_meter_reading_segments_reconciliation_fk',
      'reconciliation_meter_reading_segments_revision_fk',
    ]);

    const a12Policies = await client<{ policyname: string }[]>`
      select policyname
      from pg_policies
      where schemaname = 'app' and tablename = 'reconciliation_meter_reading_segments'
      order by policyname
    `;
    expect(a12Policies.map((row) => row.policyname)).toEqual(['tenant_context']);

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
