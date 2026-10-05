import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';

import {
  ACCEPTED_PROVIDER_MEMBERSHIP,
  ACCEPTED_PROVISIONING_DB_ROLE,
  assertAcceptedProvisioningRole,
  loadDatabaseRoleSnapshot,
} from '../../scripts/first-user-provisioning';

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.FIRST_USER_PROVISIONING_PG18_TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.FIRST_USER_PROVISIONING_PG18_TEST_ADMIN_DATABASE_URL;
const enabled =
  process.env.FIRST_USER_PROVISIONING_PG18_TEST_DATABASE === 'true' &&
  process.env.APP_ENV === 'local' &&
  Boolean(databaseUrl && adminDatabaseUrl);
const integration = enabled ? describe : describe.skip;
const repoRoot = path.resolve(import.meta.dirname, '../..');

type MembershipMutation = (adminClient: ReturnType<typeof postgres>) => Promise<void>;

let operatorClient: ReturnType<typeof postgres> | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;

async function establishExactProviderMembership(): Promise<void> {
  // REVOKE is grantor-sensitive on PostgreSQL 18. Delete only these named
  // synthetic relationship pairs so a prior drift case cannot survive under
  // a different grantor and make the catalog fixture non-repeatable.
  await adminClient!`
    delete from pg_auth_members
     where (roleid, member) in (
       (
         (select oid from pg_roles where rolname = 'first_user_provisioner'),
         (select oid from pg_roles where rolname = 'migration_owner')
       ),
       (
         (select oid from pg_roles where rolname = 'first_user_provisioner'),
         (select oid from pg_roles where rolname = 'first_user_unrelated')
       ),
       (
         (select oid from pg_roles where rolname = 'first_user_unrelated'),
         (select oid from pg_roles where rolname = 'first_user_provisioner')
       ),
       (
         (select oid from pg_roles where rolname = 'migration_owner'),
         (select oid from pg_roles where rolname = 'first_user_provisioner')
       )
     )
  `;
  await adminClient!`
    grant first_user_provisioner to migration_owner
      with admin option, inherit false, set false
  `;

  // A local PostgreSQL bootstrap superuser is the grantor for GRANT statements.
  // Neon supplies cloud_admin as the provider grantor, so this disposable PG18
  // fixture adjusts only the synthetic catalog row to the provider-equivalent
  // state that the real preflight must validate.
  await adminClient!`
    update pg_auth_members
       set grantor = (select oid from pg_roles where rolname = 'cloud_admin')
     where roleid = (select oid from pg_roles where rolname = 'first_user_provisioner')
       and member = (select oid from pg_roles where rolname = 'migration_owner')
  `;
}

async function assertLiveCapabilities(): Promise<void> {
  const rows = await operatorClient!<
    { member: boolean; usage: boolean; setRole: boolean; admin: boolean }[]
  >`
    select
      pg_has_role('migration_owner', 'first_user_provisioner', 'MEMBER') as member,
      pg_has_role('migration_owner', 'first_user_provisioner', 'USAGE') as usage,
      pg_has_role('migration_owner', 'first_user_provisioner', 'SET') as "setRole",
      exists (
        select 1
        from pg_auth_members membership
        join pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_roles member_role on member_role.oid = membership.member
        join pg_roles grantor_role on grantor_role.oid = membership.grantor
        where granted_role.rolname = 'first_user_provisioner'
          and member_role.rolname = 'migration_owner'
          and grantor_role.rolname = 'cloud_admin'
          and membership.admin_option
      ) as admin
  `;
  expect(rows).toEqual([{ member: true, usage: false, setRole: false, admin: true }]);
}

async function runPatchedPreflight(): Promise<'passed' | 'rejected'> {
  const scriptPath = path.join(repoRoot, 'scripts/first-user-provisioning.ts');
  try {
    await execFileAsync(
      process.execPath,
      [
        '--conditions=react-server',
        '--import',
        'tsx',
        scriptPath,
        '--inspect',
        '--environment',
        'production',
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, APP_ENV: 'local', DATABASE_URL: databaseUrl },
        maxBuffer: 1024 * 1024,
      },
    );
    return 'passed';
  } catch {
    return 'rejected';
  }
}

const driftCases: readonly [string, MembershipMutation][] = [
  [
    'wrong grantor',
    async (admin) => {
      await admin!`
        update pg_auth_members
           set grantor = (select oid from pg_roles where rolname = 'wolftech')
         where roleid = (select oid from pg_roles where rolname = 'first_user_provisioner')
           and member = (select oid from pg_roles where rolname = 'migration_owner')
      `;
    },
  ],
  [
    'ADMIN=false',
    async (admin) => {
      await admin!`
        update pg_auth_members
           set admin_option = false
         where roleid = (select oid from pg_roles where rolname = 'first_user_provisioner')
           and member = (select oid from pg_roles where rolname = 'migration_owner')
      `;
    },
  ],
  [
    'INHERIT=true',
    async (admin) => {
      await admin!`
        update pg_auth_members
           set inherit_option = true
         where roleid = (select oid from pg_roles where rolname = 'first_user_provisioner')
           and member = (select oid from pg_roles where rolname = 'migration_owner')
      `;
    },
  ],
  [
    'SET=true',
    async (admin) => {
      await admin!`
        update pg_auth_members
           set set_option = true
         where roleid = (select oid from pg_roles where rolname = 'first_user_provisioner')
           and member = (select oid from pg_roles where rolname = 'migration_owner')
      `;
    },
  ],
  [
    'an extra membership',
    async (admin) => {
      await admin!`grant first_user_unrelated to first_user_provisioner`;
    },
  ],
  [
    'a reverse membership',
    async (admin) => {
      // PostgreSQL rejects this cycle through GRANT before the preflight can
      // inspect it, so create the named adversarial catalog row directly.
      await admin!`
        insert into pg_auth_members (oid, roleid, member, grantor, admin_option, inherit_option, set_option)
        values (
          (select coalesce(max(oid::bigint), 0) + 1 from pg_auth_members),
          (select oid from pg_roles where rolname = 'migration_owner'),
          (select oid from pg_roles where rolname = 'first_user_provisioner'),
          (select oid from pg_roles where rolname = 'wolftech'),
          true, false, false
        )
      `;
    },
  ],
  [
    'a second member receiving first_user_provisioner',
    async (admin) => {
      await admin!`grant first_user_provisioner to first_user_unrelated`;
    },
  ],
];

integration('first-user provisioning provider membership preflight on PostgreSQL 18', () => {
  beforeAll(async () => {
    const operator = new URL(databaseUrl!);
    const admin = new URL(adminDatabaseUrl!);
    expect(operator.hostname).toBe('127.0.0.1');
    expect(operator.port).toBe('55433');
    expect(admin.hostname).toBe('127.0.0.1');
    expect(admin.port).toBe('55433');

    operatorClient = postgres(databaseUrl!, { max: 1, prepare: false });
    adminClient = postgres(adminDatabaseUrl!, { max: 1, prepare: false });

    const versionRows = await operatorClient!<{ version: string; currentUser: string }[]>`
      select version(), current_user as "currentUser"
    `;
    expect(versionRows[0]?.version).toMatch(/^PostgreSQL 18\./);
    expect(versionRows[0]?.currentUser).toBe(ACCEPTED_PROVISIONING_DB_ROLE);

    const migrationRows = await operatorClient!<{ functionExists: string | null }[]>`
      select to_regprocedure('platform.first_user_provisioning_assert_runtime_role()')::text
        as "functionExists"
    `;
    expect(migrationRows[0]?.functionExists).toBe(
      'platform.first_user_provisioning_assert_runtime_role()',
    );

    await establishExactProviderMembership();
  });

  afterAll(async () => {
    if (adminClient) await establishExactProviderMembership();
    await operatorClient?.end();
    await adminClient?.end();
  });

  it('accepts the exact provider tuple through the SQL-backed preflight', async () => {
    const snapshot = await loadDatabaseRoleSnapshot(operatorClient!);
    expect(snapshot.memberships).toEqual([ACCEPTED_PROVIDER_MEMBERSHIP]);
    expect(snapshot.memberCapability).toBe(true);
    expect(snapshot.usageCapability).toBe(false);
    expect(snapshot.setCapability).toBe(false);
    expect(snapshot.adminCapability).toBe(true);
    expect(() => assertAcceptedProvisioningRole(snapshot)).not.toThrow();
    await assertLiveCapabilities();
    expect(await runPatchedPreflight()).toBe('passed');
  });

  it.each(driftCases)('rejects %s through the SQL-backed preflight', async (_label, mutate) => {
    await establishExactProviderMembership();
    await mutate(adminClient!);
    try {
      const snapshot = await loadDatabaseRoleSnapshot(operatorClient!);
      expect(() => assertAcceptedProvisioningRole(snapshot)).toThrow();
      expect(await runPatchedPreflight()).toBe('rejected');
    } finally {
      await establishExactProviderMembership();
    }
  });
});
