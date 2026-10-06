import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

const APPROVED_APP_ENV = 'demo';
const APPROVED_DATABASE_NAME = 'shanda_fuel_demo';
const REQUIRED_ROLE_NAMES = [
  'migration_owner',
  'app_runtime',
  'job_runtime',
  'diagnostics_readonly',
  'first_user_provisioner',
] as const;

const databaseUrl = process.env.DATABASE_URL;
const appEnv = process.env.APP_ENV;

if (appEnv !== APPROVED_APP_ENV) {
  throw new Error('Refusing owner-demo role bootstrap unless APP_ENV=demo.');
}
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

const database = new URL(databaseUrl);
const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ''));
if (databaseName !== APPROVED_DATABASE_NAME) {
  throw new Error('Refusing owner-demo role bootstrap for an unexpected database name.');
}

const repoRoot = resolve(import.meta.dirname, '../..');
const bootstrapFiles = ['ops/db/bootstrap.sql', 'scripts/db/bootstrap-first-user-provisioner.sql'];

async function main() {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    for (const relativePath of bootstrapFiles) {
      const bootstrapSql = await readFile(resolve(repoRoot, relativePath), 'utf8');
      await sql.unsafe(bootstrapSql);
    }

    await sql.unsafe(`
      alter role migration_owner nologin;
      alter role app_runtime nologin;
      alter role job_runtime nologin;
      alter role diagnostics_readonly nologin;
    `);

    const roles = await sql<{ rolname: string }[]>`
      select rolname
      from pg_roles
      where rolname in ${sql(REQUIRED_ROLE_NAMES)}
      order by rolname
    `;

    const actualRoleNames = roles.map((role) => role.rolname);
    const expectedRoleNames = [...REQUIRED_ROLE_NAMES].sort();
    if (actualRoleNames.join('|') !== expectedRoleNames.join('|')) {
      throw new Error('Owner-demo role bootstrap did not create the complete required role set.');
    }

    const unsafeRuntimeRoles = await sql<{ rolname: string }[]>`
      select rolname
      from pg_roles
      where rolname in ${sql(['app_runtime', 'job_runtime', 'diagnostics_readonly'])}
        and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit
          or rolreplication or rolbypassrls or rolconfig is not null)
      order by rolname
    `;
    if (unsafeRuntimeRoles.length > 0) {
      throw new Error('Owner-demo runtime roles do not have the required least-privilege flags.');
    }

    const unsafeProvisioner = await sql<{ rolname: string }[]>`
      select rolname
      from pg_roles
      where rolname = 'first_user_provisioner'
        and (not rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit
          or rolreplication or rolbypassrls or rolconfig is not null)
    `;
    if (unsafeProvisioner.length > 0) {
      throw new Error('Owner-demo first-user provisioner role has unsafe attributes.');
    }

    console.log('Owner-demo prerequisite roles ready.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Owner-demo role bootstrap failed.');
  process.exitCode = 1;
});
