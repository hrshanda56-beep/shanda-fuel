import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

const databaseUrl = process.env.OWNER_DEMO_BOOTSTRAP_TEST_DATABASE_URL;
const bootstrapDatabaseUrl = databaseUrl
  ? (() => {
      const url = new URL(databaseUrl);
      url.username = 'neondb_owner';
      url.password = '';
      return url.toString();
    })()
  : undefined;
const repoRoot = resolve(process.cwd());
const bootstrapRunner = resolve(repoRoot, 'scripts/demo/bootstrap-owner-demo.ts');
const setupRunner = resolve(repoRoot, 'scripts/demo/setup-owner-demo.sh');
const migrationDirectory = resolve(repoRoot, 'src/platform/db/migrations');

const expectedRuntimeRoles = ['app_runtime', 'job_runtime', 'diagnostics_readonly'];
const expectedRoles = ['migration_owner', ...expectedRuntimeRoles, 'first_user_provisioner'].sort();

function demoEnvironment(overrides: Record<string, string> = {}) {
  return {
    ...process.env,
    APP_ENV: 'demo',
    APP_URL: 'https://owner-demo.example.test',
    DATABASE_URL: bootstrapDatabaseUrl,
    BETTER_AUTH_SECRET: 'synthetic-owner-demo-secret-32-characters',
    AUDIT_SIGNING_KEY_ID: 'owner-demo-test',
    AUDIT_SIGNING_KEY: 'synthetic-owner-demo-signing-key',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function runBootstrap(): void {
  const result = spawnSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', bootstrapRunner],
    { cwd: repoRoot, env: demoEnvironment(), encoding: 'utf8' },
  );
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
}

function runBootstrapExpectingFailure(expectedMessage: string): void {
  const result = spawnSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', bootstrapRunner],
    { cwd: repoRoot, env: demoEnvironment(), encoding: 'utf8' },
  );
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain(expectedMessage);
}

function runMigrations(): void {
  const result = spawnSync(
    'pnpm',
    ['exec', 'drizzle-kit', 'migrate', '--config', 'drizzle.config.ts'],
    {
      cwd: repoRoot,
      env: demoEnvironment({ DATABASE_DIRECT_URL: bootstrapDatabaseUrl! }),
      encoding: 'utf8',
    },
  );
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
}

function runSeed(reset = false): void {
  execFileSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      resolve(repoRoot, 'scripts/demo/seed-owner-demo.ts'),
    ],
    {
      cwd: repoRoot,
      // The role-authority path is exercised by bootstrap and migrations above.
      // The existing command fixture requires the local test owner/superuser
      // boundary for its intentional postgres-only sealing capability.
      env: demoEnvironment({
        DATABASE_URL: databaseUrl!,
        DEMO_PASSWORD: 'SyntheticDemo!12',
        DEMO_RESET: reset ? '1' : '0',
      }),
      stdio: 'pipe',
    },
  );
}

describe.skipIf(!databaseUrl)('hosted owner-demo bootstrap lifecycle', () => {
  it('bootstraps, migrates all 22 entries, seeds, resets idempotently, and refuses production', async () => {
    const sql = postgres(databaseUrl!, { max: 2, prepare: false });
    try {
      const preflight = await sql<{ table_exists: boolean }[]>`
        select to_regclass('drizzle.__drizzle_migrations') is not null as table_exists
      `;
      expect(preflight[0]?.table_exists).toBe(false);

      // Keep migration_owner and first_user_provisioner from the fresh-role phase;
      // this phase specifically exercises the hosted case where runtime roles pre-exist.
      await sql.unsafe(`
        create role neondb_owner login createrole nosuperuser nocreatedb inherit noreplication nobypassrls;
        alter database shanda_fuel_demo owner to neondb_owner;
      `);
      const bootstrapPrincipal = await sql<{ rolsuper: boolean; rolcreaterole: boolean }[]>`
        select rolsuper, rolcreaterole from pg_roles where rolname = 'neondb_owner'
      `;
      expect(bootstrapPrincipal[0]).toEqual({ rolsuper: false, rolcreaterole: true });
      const initiallyAbsent = await sql<{ count: string }[]>`
        select count(*)::text as count from pg_roles where rolname in ${sql(expectedRoles)}
      `;
      expect(initiallyAbsent[0]?.count).toBe('0');

      runBootstrap();
      const roles = await sql<
        {
          rolname: string;
          rolcanlogin: boolean;
          rolsuper: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolinherit: boolean;
          rolreplication: boolean;
          rolbypassrls: boolean;
          has_config: boolean;
        }[]
      >`
        select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
          rolreplication, rolbypassrls, rolconfig is not null as has_config
        from pg_roles
        where rolname in ${sql(expectedRoles)}
        order by rolname
      `;
      expect(roles.map((role) => role.rolname)).toEqual(expectedRoles);
      expect(
        roles
          .filter((role) => expectedRuntimeRoles.includes(role.rolname))
          .every(
            (role) =>
              !role.rolcanlogin &&
              !role.rolsuper &&
              !role.rolcreatedb &&
              !role.rolcreaterole &&
              !role.rolinherit &&
              !role.rolreplication &&
              !role.rolbypassrls &&
              !role.has_config,
          ),
      ).toBe(true);
      const provisioner = roles.find((role) => role.rolname === 'first_user_provisioner');
      expect(provisioner).toMatchObject({
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolbypassrls: false,
        has_config: false,
      });
      const migrationAuthority = await sql<{ can_set: boolean }[]>`
        select pg_has_role('neondb_owner', 'migration_owner', 'SET') as can_set
      `;
      expect(migrationAuthority[0]?.can_set).toBe(true);

      await sql.unsafe(`
        revoke app_runtime from neondb_owner;
        revoke job_runtime from neondb_owner;
        revoke diagnostics_readonly from neondb_owner;
        drop role app_runtime;
        drop role job_runtime;
        drop role diagnostics_readonly;
        create role app_runtime nologin nosuperuser nocreatedb nocreaterole inherit noreplication nobypassrls;
        create role job_runtime nologin nosuperuser nocreatedb nocreaterole inherit noreplication nobypassrls;
        create role diagnostics_readonly nologin nosuperuser nocreatedb nocreaterole inherit noreplication nobypassrls;
        grant app_runtime to neondb_owner with admin option;
        grant job_runtime to neondb_owner with admin option;
        grant diagnostics_readonly to neondb_owner with admin option;
      `);
      runBootstrap();
      const preexistingRoles = await sql<
        { rolname: string; rolinherit: boolean; admin_option: boolean }[]
      >`
        select r.rolname, r.rolinherit, membership.admin_option
        from pg_roles r
        join pg_auth_members membership on membership.roleid = r.oid
        join pg_roles member on member.oid = membership.member
        where r.rolname in ('app_runtime', 'job_runtime', 'diagnostics_readonly')
          and member.rolname = 'neondb_owner'
        order by r.rolname
      `;
      expect(preexistingRoles).toEqual([
        { rolname: 'app_runtime', rolinherit: false, admin_option: true },
        { rolname: 'diagnostics_readonly', rolinherit: false, admin_option: true },
        { rolname: 'job_runtime', rolinherit: false, admin_option: true },
      ]);

      await sql`alter role app_runtime set statement_timeout = '1s'`;
      runBootstrapExpectingFailure('unsafe pre-existing role state (ROLE_CONFIG)');
      await sql`alter role app_runtime reset all`;
      runBootstrap();

      runMigrations();
      const journal = JSON.parse(
        readFileSync(resolve(migrationDirectory, 'meta/_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] };
      const expectedHashes = journal.entries
        .map(({ tag }) =>
          createHash('sha256')
            .update(readFileSync(resolve(migrationDirectory, `${tag}.sql`)))
            .digest('hex'),
        )
        .sort();
      const applied = await sql<{ hash: string }[]>`
        select hash from drizzle.__drizzle_migrations order by hash
      `;
      expect(applied).toHaveLength(22);
      expect(applied.map(({ hash }) => hash)).toEqual(expectedHashes);

      runSeed();
      const fixture = await sql<
        {
          tenant_name: string;
          legal_name: string;
          station_codes: string[];
          account_count: string;
        }[]
      >`
        select t.name as tenant_name, le.legal_name,
          array_agg(s.code order by s.code) as station_codes,
          (select count(*) from auth.account a join auth."user" u on u.id = a.user_id
            where u.email = 'demo-owner@tei-oils.example.test' and a.provider_id = 'credential') as account_count
        from app.tenants t
        join app.legal_entities le on le.tenant_id = t.id
        join app.stations s on s.tenant_id = t.id and s.legal_entity_id = le.id
        where t.slug = 'tei-oils-owner-demo'
        group by t.name, le.legal_name
      `;
      expect(fixture).toEqual([
        {
          tenant_name: 'T.E.I Oils',
          legal_name: 'Triumph Energy',
          station_codes: ['ARCTURUS', 'BINDURA', 'GAZEBO', 'MARUTA'],
          account_count: '1',
        },
      ]);

      runBootstrap();
      runMigrations();
      runSeed(true);
      const rerun = await sql<
        { tenant_count: string; station_count: string; account_count: string }[]
      >`
        select
          (select count(*) from app.tenants where slug = 'tei-oils-owner-demo') as tenant_count,
          (select count(*) from app.stations s join app.tenants t on t.id = s.tenant_id
            where t.slug = 'tei-oils-owner-demo') as station_count,
          (select count(*) from auth.account a join auth."user" u on u.id = a.user_id
            where u.email = 'demo-owner@tei-oils.example.test' and a.provider_id = 'credential') as account_count
      `;
      expect(rerun[0]).toEqual({ tenant_count: '1', station_count: '4', account_count: '1' });
      const appliedAfterRerun = await sql<{ count: string }[]>`
        select count(*)::text as count from drizzle.__drizzle_migrations
      `;
      expect(appliedAfterRerun[0]?.count).toBe('22');

      const productionRefusal = spawnSync('bash', [setupRunner], {
        cwd: repoRoot,
        env: demoEnvironment({ APP_ENV: 'production' }),
        encoding: 'utf8',
      });
      expect(productionRefusal.status).toBe(2);
      expect(`${productionRefusal.stdout}${productionRefusal.stderr}`).toContain(
        'Refusing hosted owner-demo setup unless APP_ENV=demo.',
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 120_000);
});
