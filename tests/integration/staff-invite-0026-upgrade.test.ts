import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the 0025 -> 0026 staff invitation upgrade test.');
}

let client: ReturnType<typeof postgres>;
const migrationPath = resolve(
  import.meta.dirname,
  '../../src/platform/db/migrations/0026_staff_invite_onboarding.sql',
);
const currentMigrationPath = resolve(
  import.meta.dirname,
  '../../src/platform/db/migrations/0028_clerk_target_identity_revocation.sql',
);
const latestMigrationPath = resolve(
  import.meta.dirname,
  '../../src/platform/db/migrations/0029_staff_number_registry_rls.sql',
);
const previousMigrationPath = resolve(
  import.meta.dirname,
  '../../src/platform/db/migrations/0027_clerk_staff_number_auth.sql',
);

describe('0025 to 0026 staff invitation database upgrade', () => {
  beforeAll(() => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('runs the unchanged migration from a 0025-shaped schema and rolls back safely', async () => {
    const migrationSql = await readFile(migrationPath, 'utf8');
    const migrationHash = createHash('sha256').update(migrationSql).digest('hex');
    const currentMigrationSql = await readFile(currentMigrationPath, 'utf8');
    const currentMigrationHash = createHash('sha256').update(currentMigrationSql).digest('hex');
    const latestMigrationSql = await readFile(latestMigrationPath, 'utf8');
    const latestMigrationHash = createHash('sha256').update(latestMigrationSql).digest('hex');
    const previousMigrationSql = await readFile(previousMigrationPath, 'utf8');
    const previousMigrationHash = createHash('sha256').update(previousMigrationSql).digest('hex');
    const rollback = new Error('rollback disposable 0025 to 0026 upgrade');

    await expect(
      client.begin(async (transaction) => {
        // 0026 and 0027 explicitly name auth.user. Restore that historical
        // relation name inside this rollback-only transaction and execute the
        // original SQL verbatim; do not rewrite old migrations for app.users.
        await transaction.unsafe(`
          ALTER TABLE app.users RENAME TO "user";
          ALTER TABLE app."user" SET SCHEMA auth;
        `);
        await transaction.unsafe(`
          DROP FUNCTION IF EXISTS app.accept_manual_staff_invitation(text, uuid, text, uuid);
          DROP FUNCTION IF EXISTS app.resolve_manual_staff_invitation(text, text);
          DROP FUNCTION IF EXISTS app.resolve_staff_number_for_user(uuid);
          DROP FUNCTION IF EXISTS app.resolve_staff_number_for_invitation(uuid);
          DROP FUNCTION IF EXISTS app.reserve_staff_number(uuid, text);
          DROP FUNCTION IF EXISTS app.resolve_provider_identity(text, uuid);
          DROP FUNCTION IF EXISTS app.resolve_auth_identity(text, text);
          DROP TABLE IF EXISTS app.auth_session_assurance;
          ALTER TABLE app.staff_invitations
            DROP CONSTRAINT IF EXISTS staff_invitations_staff_number_registry_fk,
            DROP CONSTRAINT IF EXISTS staff_invitations_manual_staff_number_ck,
            DROP CONSTRAINT IF EXISTS staff_invitations_delivery_method_ck;
          DROP INDEX IF EXISTS app.staff_invitations_pending_staff_number_idx;
          ALTER TABLE app.staff_invitations
            DROP COLUMN IF EXISTS staff_number_registry_id,
            DROP COLUMN IF EXISTS delivery_method;
          DROP TABLE IF EXISTS app.staff_number_registry;
          DROP TABLE IF EXISTS app.auth_identities;
          -- Rollback-only historical fixture: old 0025 required email. Later
          -- username-only synthetic fixtures must not prevent schema replay.
          UPDATE auth."user" SET email = id::text || '@historical-fixture.invalid' WHERE email IS NULL;
          ALTER TABLE auth."user" ALTER COLUMN email SET NOT NULL;
          DROP POLICY IF EXISTS membership_roles_staff_invitation_acceptance
            ON app.membership_role_assignments;
          DROP POLICY IF EXISTS memberships_staff_invitation_acceptance ON app.memberships;
          DROP POLICY IF EXISTS memberships_staff_management ON app.memberships;
          DROP POLICY IF EXISTS memberships_staff_management_update ON app.memberships;
          DROP POLICY IF EXISTS tenants_staff_invitation_lookup ON app.tenants;
          DROP FUNCTION IF EXISTS app.resolve_staff_invitation(text);
          DROP FUNCTION IF EXISTS app.accept_staff_invitation(text, uuid, uuid);
          DROP TABLE IF EXISTS app.staff_invitation_stations;
          DROP TABLE IF EXISTS app.staff_invitations;
          DROP INDEX IF EXISTS auth.auth_user_normalized_email_uidx;
          DELETE FROM drizzle.__drizzle_migrations
          WHERE created_at >= (SELECT created_at FROM drizzle.__drizzle_migrations
            WHERE hash = '${migrationHash}');
        `);

        const before = await transaction<{ migration_count: number; table_name: string }[]>`
          select count(*)::int as migration_count, table_name
          from information_schema.tables
          where table_schema = 'app'
            and table_name in ('staff_invitations', 'staff_invitation_stations')
          group by table_name
        `;
        expect(before).toEqual([]);

        const beforeMigrations = await transaction<{ migration_count: number }[]>`
          select count(*)::int as migration_count from drizzle.__drizzle_migrations
        `;
        expect(beforeMigrations).toEqual([{ migration_count: 26 }]);

        await transaction.unsafe(migrationSql);

        const after = await transaction<
          { table_name: string; force_rls: boolean; owner: string }[]
        >`
          select
            c.relname as table_name,
            c.relforcerowsecurity as force_rls,
            pg_get_userbyid(c.relowner) as owner
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app'
            and c.relname in ('staff_invitations', 'staff_invitation_stations')
          order by c.relname
        `;
        expect(after).toEqual([
          { table_name: 'staff_invitation_stations', force_rls: true, owner: 'migration_owner' },
          { table_name: 'staff_invitations', force_rls: true, owner: 'migration_owner' },
        ]);

        await transaction`
          insert into drizzle.__drizzle_migrations (hash, created_at)
          values (${migrationHash}, ${Date.now()})
        `;

        const migration = await transaction<{ hash: string }[]>`
          select hash from drizzle.__drizzle_migrations order by created_at desc limit 1
        `;
        expect(migration).toEqual([{ hash: migrationHash }]);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('records 0026 exactly once with the migration source hash', async () => {
    const latestMigrationSql = await readFile(
      resolve(
        import.meta.dirname,
        '../../src/platform/db/migrations/0032_custom_staff_numbers.sql',
      ),
      'utf8',
    );
    const latestMigrationHash = createHash('sha256').update(latestMigrationSql).digest('hex');
    const rows = await client<
      {
        migration_count: number;
        latest_hash: string;
        exact_hash_count: number;
      }[]
    >`
      select
        count(*)::int as migration_count,
        (select hash from drizzle.__drizzle_migrations order by created_at desc limit 1) as latest_hash,
        count(*) filter (
          where hash = '22f56a2cdd441a77a124e421e9c4a57b186bd1e773ee70b1897e5235f992bb83'
        )::int as exact_hash_count
      from drizzle.__drizzle_migrations
    `;

    expect(rows).toEqual([
      {
        migration_count: 33,
        latest_hash: latestMigrationHash,
        exact_hash_count: 1,
      },
    ]);
  });

  it('creates the tables with forced RLS and migration ownership', async () => {
    const rows = await client<
      {
        relname: string;
        rls_enabled: boolean;
        force_rls: boolean;
        owner: string;
      }[]
    >`
      select
        c.relname,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as force_rls,
        pg_get_userbyid(c.relowner) as owner
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app'
        and c.relname in ('staff_invitations', 'staff_invitation_stations')
      order by c.relname
    `;

    expect(rows).toEqual([
      {
        relname: 'staff_invitation_stations',
        rls_enabled: true,
        force_rls: true,
        owner: 'migration_owner',
      },
      {
        relname: 'staff_invitations',
        rls_enabled: true,
        force_rls: true,
        owner: 'migration_owner',
      },
    ]);
  });

  it('keeps runtime access least-privilege and preserves auth email uniqueness', async () => {
    const privileges = await client<
      {
        table_name: string;
        app_select: boolean;
        app_insert: boolean;
        app_update: boolean;
        app_delete: boolean;
        job_select: boolean;
        job_insert: boolean;
        job_update: boolean;
        job_delete: boolean;
      }[]
    >`
      select
        c.relname as table_name,
        has_table_privilege('app_runtime', c.oid, 'SELECT') as app_select,
        has_table_privilege('app_runtime', c.oid, 'INSERT') as app_insert,
        has_table_privilege('app_runtime', c.oid, 'UPDATE') as app_update,
        has_table_privilege('app_runtime', c.oid, 'DELETE') as app_delete,
        exists (
          select 1
          from information_schema.role_table_grants grant_row
          where grant_row.grantee = 'job_runtime'
            and grant_row.table_schema = 'app'
            and grant_row.table_name = c.relname
        ) as job_has_explicit_grant
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app'
        and c.relname in ('staff_invitations', 'staff_invitation_stations')
      order by c.relname
    `;

    expect(privileges).toEqual([
      {
        table_name: 'staff_invitation_stations',
        app_select: true,
        app_insert: true,
        app_update: true,
        app_delete: false,
        job_has_explicit_grant: false,
      },
      {
        table_name: 'staff_invitations',
        app_select: true,
        app_insert: true,
        app_update: true,
        app_delete: false,
        job_has_explicit_grant: false,
      },
    ]);

    const indexes = await client<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where (schemaname = 'app' and tablename in ('staff_invitations', 'staff_invitation_stations'))
         or (schemaname = 'app' and indexname = 'auth_user_normalized_email_uidx')
      order by indexname
    `;

    expect(indexes.map((row) => row.indexname)).toContain('auth_user_normalized_email_uidx');
    expect(indexes.map((row) => row.indexname)).toContain('staff_invitations_pending_email_uidx');
  });
});
