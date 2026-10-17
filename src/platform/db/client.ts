import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { assertDatabaseConfigured } from '../config/env';
import { AppError } from '../errors';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

let pooledClient: Sql | undefined;
let pooledDatabase: Database | undefined;

export function getDatabase(): Database {
  if (pooledDatabase) return pooledDatabase;

  const url = assertDatabaseConfigured();
  pooledClient = postgres(url, {
    max: 10,
    prepare: false,
    onnotice: () => undefined,
    connection: { TimeZone: 'UTC' },
  });
  pooledDatabase = drizzle(pooledClient, { schema });
  return pooledDatabase;
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
  if (pooledClient) await pooledClient.end({ timeout: 1 });
  pooledClient = undefined;
  pooledDatabase = undefined;
}
