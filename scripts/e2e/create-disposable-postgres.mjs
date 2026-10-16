/** Local synthetic browser harness only. Creates a NEW database; never drops or seeds one. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const [database, portText] = process.argv.slice(2);
if (!/^remediation_[a-z0-9_]+$/.test(database ?? '') || !/^\d+$/.test(portText ?? '')) {
  throw new Error(
    'Usage: node scripts/e2e/create-disposable-postgres.mjs remediation_NAME LOCAL_PORT',
  );
}
const port = Number(portText);
if (port < 1024 || port > 65535) throw new Error('A dedicated local test port is required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Explicit options ignore inherited production URLs and PG* connection settings.
const options = {
  host: '127.0.0.1',
  port,
  username: 'postgres',
  password: '',
  max: 1,
  onnotice: () => {},
};
const admin = postgres({ ...options, database: 'postgres' });
try {
  const [server] = await admin`select current_setting('server_version_num')::int version,
    current_setting('TimeZone') timezone, host(inet_server_addr()) address`;
  if (
    server.version < 180000 ||
    server.version >= 190000 ||
    server.timezone !== 'UTC' ||
    server.address !== '127.0.0.1'
  ) {
    throw new Error('An isolated loopback PostgreSQL 18 server in UTC is required');
  }
  // Deliberately no IF EXISTS/reset/drop: fixture reuse must never be hidden.
  await admin.unsafe(`create database ${database}`);
} finally {
  await admin.end();
}
const client = postgres({ ...options, database });
try {
  for (const file of ['ops/db/bootstrap.sql', 'scripts/db/bootstrap-first-user-provisioner.sql']) {
    await client.unsafe(readFileSync(path.join(root, file), 'utf8'));
  }
  await client.unsafe(
    `grant create, connect on database ${database} to migration_owner with grant option`,
  );
  await client.unsafe('set role migration_owner');
  await migrate(drizzle(client), {
    migrationsFolder: path.join(root, 'src/platform/db/migrations'),
  });
  await client.unsafe('reset role');
  await client.unsafe('alter role app_runtime login');
  const [role] =
    await client`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname='app_runtime'`;
  if (!role || Object.values(role).some(Boolean)) throw new Error('Unsafe test runtime role');
  const [catalog] = await client`select count(*)::int total,
    count(*) filter (where c.relrowsecurity and c.relforcerowsecurity)::int protected
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r'`;
  if (!catalog.total || catalog.total !== catalog.protected)
    throw new Error('Application RLS/FORCE RLS mismatch');
  console.log(JSON.stringify({ database, postgres: 18, timezone: 'UTC', ...catalog }));
} finally {
  await client.end();
}
