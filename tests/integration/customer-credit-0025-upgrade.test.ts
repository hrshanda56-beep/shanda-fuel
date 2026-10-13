import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for the 0024 -> 0025 migration upgrade test. Configure a dedicated test PostgreSQL database.',
  );
}

const migrationPath = resolve(
  import.meta.dirname,
  '../../src/platform/db/migrations/0025_customer_credit_station_scope.sql',
);

let client: ReturnType<typeof postgres>;

describe('customer credit migration upgrade path', () => {
  beforeAll(() => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('upgrades a 0024 schema to 0025_customer_credit_station_scope', async () => {
    const migrationSql = await readFile(migrationPath, 'utf8');
    const migrationHash = createHash('sha256').update(migrationSql).digest('hex');
    const rollback = new Error('rollback disposable migration upgrade transaction');

    await expect(
      client.begin(async (transaction) => {
        // The CI database has the complete history applied. Revert only the
        // objects owned by 0025 inside this transaction to model its 0024
        // starting point, then execute the production migration unchanged.
        await transaction.unsafe(`
          DROP TABLE IF EXISTS app.customer_account_stations;
          ALTER TABLE app.customer_ledger_entries
            DROP CONSTRAINT IF EXISTS customer_ledger_entries_receiving_station_fk,
            DROP COLUMN IF EXISTS receiving_station_id;
          ALTER TABLE app.customer_accounts
            DROP CONSTRAINT IF EXISTS customer_accounts_customer_legal_entity_fk,
            DROP CONSTRAINT IF EXISTS customer_accounts_station_scope_ck,
            DROP CONSTRAINT IF EXISTS customer_accounts_tenant_id_id_legal_entity_uidx,
            DROP COLUMN IF EXISTS station_scope_configured,
            DROP COLUMN IF EXISTS station_scope,
            DROP COLUMN IF EXISTS legal_entity_id;
          ALTER TABLE app.customers
            DROP CONSTRAINT IF EXISTS customers_legal_entity_fk,
            DROP CONSTRAINT IF EXISTS customers_tenant_id_id_legal_entity_uidx,
            DROP COLUMN IF EXISTS legal_entity_id;
          DELETE FROM drizzle.__drizzle_migrations
          WHERE created_at >= (
            SELECT created_at
            FROM drizzle.__drizzle_migrations
            WHERE hash = '${migrationHash}'
          );
        `);

        const before = await transaction<
          {
            table_name: string;
            column_name: string;
          }[]
        >`
          select table_name, column_name
          from information_schema.columns
          where (table_schema, table_name, column_name) in (
            ('app', 'customers', 'legal_entity_id'),
            ('app', 'customer_accounts', 'legal_entity_id'),
            ('app', 'customer_accounts', 'station_scope'),
            ('app', 'customer_accounts', 'station_scope_configured'),
            ('app', 'customer_ledger_entries', 'receiving_station_id'),
            ('app', 'customer_account_stations', 'id')
          )
        `;
        expect(before).toEqual([]);

        await transaction.unsafe(migrationSql);

        await transaction`
          insert into drizzle.__drizzle_migrations (hash, created_at)
          values (${migrationHash}, ${Date.now()})
        `;

        const after = await transaction<
          {
            table_name: string;
            column_name: string;
          }[]
        >`
          select table_name, column_name
          from information_schema.columns
          where (table_schema, table_name, column_name) in (
            ('app', 'customers', 'legal_entity_id'),
            ('app', 'customer_accounts', 'legal_entity_id'),
            ('app', 'customer_accounts', 'station_scope'),
            ('app', 'customer_accounts', 'station_scope_configured'),
            ('app', 'customer_ledger_entries', 'receiving_station_id'),
            ('app', 'customer_account_stations', 'id')
          )
          order by table_name, column_name
        `;
        expect(after).toEqual([
          { table_name: 'customer_account_stations', column_name: 'id' },
          { table_name: 'customer_accounts', column_name: 'legal_entity_id' },
          { table_name: 'customer_accounts', column_name: 'station_scope' },
          { table_name: 'customer_accounts', column_name: 'station_scope_configured' },
          { table_name: 'customer_ledger_entries', column_name: 'receiving_station_id' },
          { table_name: 'customers', column_name: 'legal_entity_id' },
        ]);

        const constraints = await transaction<{ conname: string }[]>`
          select conname
          from pg_constraint
          where conname in (
            'customers_legal_entity_fk',
            'customer_accounts_customer_legal_entity_fk',
            'customer_ledger_entries_receiving_station_fk',
            'customer_account_stations_account_fk',
            'customer_account_stations_station_fk'
          )
          order by conname
        `;
        expect(constraints.map(({ conname }) => conname)).toEqual([
          'customer_account_stations_account_fk',
          'customer_account_stations_station_fk',
          'customer_accounts_customer_legal_entity_fk',
          'customer_ledger_entries_receiving_station_fk',
          'customers_legal_entity_fk',
        ]);

        const rls = await transaction<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
          select c.relrowsecurity, c.relforcerowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'customer_account_stations'
        `;
        expect(rls).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);

        const migration = await transaction<{ hash: string }[]>`
          select hash
          from drizzle.__drizzle_migrations
          order by created_at desc
          limit 1
        `;
        expect(migration).toEqual([{ hash: migrationHash }]);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
