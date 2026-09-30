import postgres, { type TransactionSql } from 'postgres';
import type { DatabaseRecoveryCheck } from './rehearsal';

const expectedTables = [
  'app.tenants',
  'app.legal_entities',
  'app.stations',
  'app.reconciliations',
  'platform.security_events',
] as const;

type DatabaseValidationRow = {
  tableName: string;
};

type CountRow = {
  tenantCount: number;
  stationCount: number;
};

async function countRows(transaction: TransactionSql): Promise<CountRow> {
  const rows = await transaction<CountRow[]>`
    select
      (select count(*)::int from app.tenants) as "tenantCount",
      (select count(*)::int from app.stations) as "stationCount"
  `;
  const row = rows[0];
  if (!row) throw new Error('Database validation returned no count row');
  return row;
}

export async function runDatabaseReadOnlyValidation(
  databaseUrl: string,
): Promise<DatabaseRecoveryCheck> {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    return await client.begin(async (transaction) => {
      await transaction.unsafe('set transaction read only');
      const settings = await transaction<{ readOnly: string }[]>`
        select current_setting('transaction_read_only') as "readOnly"
      `;
      const available = await transaction<DatabaseValidationRow[]>`
        select table_name as "tableName"
        from (
          values
            ('app.tenants'),
            ('app.legal_entities'),
            ('app.stations'),
            ('app.reconciliations'),
            ('platform.security_events')
        ) as expected(table_name)
        where to_regclass(table_name) is not null
        order by table_name
      `;
      const availableNames = new Set(available.map((row) => row.tableName));
      const allTablesPresent = expectedTables.every((tableName) => availableNames.has(tableName));
      if (!allTablesPresent || settings[0]?.readOnly !== 'on') {
        return {
          status: 'failed',
          readOnlyTransaction: settings[0]?.readOnly === 'on',
          expectedTables: expectedTables.length,
          availableTables: available.length,
          code: 'database_shape_or_readonly_check_failed',
        };
      }

      const counts = await countRows(transaction);
      return {
        status: 'passed',
        readOnlyTransaction: true,
        expectedTables: expectedTables.length,
        availableTables: available.length,
        tenantRows: counts.tenantCount,
        stationRows: counts.stationCount,
      };
    });
  } catch {
    return {
      status: 'failed',
      readOnlyTransaction: false,
      expectedTables: expectedTables.length,
      availableTables: 0,
      code: 'database_validation_failed',
    };
  } finally {
    await client.end();
  }
}

export const RECOVERY_DATABASE_EXPECTED_TABLES = expectedTables;
