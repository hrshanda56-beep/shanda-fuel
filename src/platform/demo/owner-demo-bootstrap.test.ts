import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

const databaseUrl = process.env.OWNER_DEMO_BOOTSTRAP_TEST_DATABASE_URL;
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
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'synthetic-owner-demo-secret-32-characters',
    AUDIT_SIGNING_KEY_ID: 'owner-demo-test',
    AUDIT_SIGNING_KEY: 'synthetic-owner-demo-signing-key',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function runBootstrap(): void {
  execFileSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', bootstrapRunner],
    { cwd: repoRoot, env: demoEnvironment(), stdio: 'pipe' },
  );
}

function runMigrations(): void {
  execFileSync('pnpm', ['exec', 'drizzle-kit', 'migrate', '--config', 'drizzle.config.ts'], {
    cwd: repoRoot,
    env: demoEnvironment({ DATABASE_DIRECT_URL: databaseUrl! }),
    stdio: 'pipe',
  });
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
      env: demoEnvironment({ DEMO_PASSWORD: 'SyntheticDemo!12', DEMO_RESET: reset ? '1' : '0' }),
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
