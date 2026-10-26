import { preparedDrizzleClient } from './prepared-client';
import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { assertDatabaseConfigured } from '../config/env';
import { AppError } from '../errors';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

interface PoolState {
  client?: Sql;
  database?: Database;
}

// Next dev re-evaluates this module on HMR and per bundle; module-level state
// would open a fresh pool each time and exhaust the database's connections.
const globalPool = globalThis as typeof globalThis & { __shandaDbPool?: PoolState };
const pool: PoolState =
  process.env.NODE_ENV === 'production' ? {} : (globalPool.__shandaDbPool ??= {});

export function getDatabase(): Database {
  if (pool.database) return pool.database;

  const url = assertDatabaseConfigured();
  const pooledClient = postgres(url, {
    max: 10,
    prepare: process.env.DATABASE_PREPARED_STATEMENTS === '1',
    onnotice: () => undefined,
  });
  const queryClient =
    process.env.DATABASE_PREPARED_STATEMENTS === '1'
      ? preparedDrizzleClient(pooledClient)
      : pooledClient;
  pool.client = pooledClient;
  pool.database = drizzle(queryClient, { schema });
  return pool.database;
}

export async function checkDatabase(): Promise<{ status: 'ok' } | { status: 'unavailable' }> {
  try {
    await getDatabase().execute('select 1');
    return { status: 'ok' };
  } catch {
    return { status: 'unavailable' };
  }
}

export function requireDatabaseUrlForMigration(): string {
  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new AppError(
      'DEPENDENCY_UNAVAILABLE',
      'DATABASE_DIRECT_URL or DATABASE_URL is required for migrations',
    );
  }
  return url;
}

export async function closeDatabase(): Promise<void> {
  if (pool.client) await pool.client.end({ timeout: 1 });
  pool.client = undefined;
  pool.database = undefined;
}
