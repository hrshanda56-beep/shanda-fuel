import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

import { signSecurityEvent } from '../../src/platform/security/audit-signing';
import {
  ACCEPTED_PROVISIONING_DB_ROLE,
  READ_ONLY_GRANT_PLAN,
  assertAcceptedProvisioningRole,
  createPostgresRepository,
  listScopeOptions,
  preparePlan,
  provisionFirstUser,
  revokeFirstUserAccess,
  type ScopeIds,
} from '../../scripts/first-user-provisioning';

/*
 * This suite is deliberately opt-in. The operator tool must never discover or
 * guess a database from a developer shell, and APP_ENV=production is never a
 * permitted integration-test environment.
 */
const databaseUrl = process.env.DATABASE_URL;
const adminDatabaseUrl = process.env.FIRST_USER_PROVISIONING_TEST_ADMIN_DATABASE_URL;
const appRuntimeDatabaseUrl = process.env.FIRST_USER_PROVISIONING_TEST_APP_RUNTIME_DATABASE_URL;
const enabled =
  process.env.FIRST_USER_PROVISIONING_TEST_DATABASE === 'true' &&
  process.env.APP_ENV === 'local' &&
  Boolean(databaseUrl && adminDatabaseUrl && appRuntimeDatabaseUrl);
const integration = enabled ? describe : describe.skip;

const scope: ScopeIds | undefined =
  process.env.FIRST_USER_PROVISIONING_TEST_TENANT_ID &&
  process.env.FIRST_USER_PROVISIONING_TEST_LEGAL_ENTITY_ID &&
  process.env.FIRST_USER_PROVISIONING_TEST_STATION_ID
    ? {
        tenantId: process.env.FIRST_USER_PROVISIONING_TEST_TENANT_ID,
        legalEntityId: process.env.FIRST_USER_PROVISIONING_TEST_LEGAL_ENTITY_ID,
        stationId: process.env.FIRST_USER_PROVISIONING_TEST_STATION_ID,
      }
    : undefined;
const fixtureTest = scope ? it : it.skip;
let client: ReturnType<typeof postgres> | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let appRuntimeClient: ReturnType<typeof postgres> | undefined;

integration('first-user provisioning PostgreSQL hardening', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    adminClient = postgres(adminDatabaseUrl!, { max: 1, prepare: false });
    appRuntimeClient = postgres(appRuntimeDatabaseUrl!, { max: 1, prepare: false });
    const rows = await client<{ currentUser: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      select current_user as "currentUser", r.rolsuper, r.rolbypassrls
      from pg_roles r
      where r.rolname = current_user
    `;
    expect(rows).toHaveLength(1);
    assertAcceptedProvisioningRole(rows[0]!);
  });

  afterAll(async () => {
    await client?.end();
    await adminClient?.end();
    await appRuntimeClient?.end();
  });

  it('requires the dedicated non-superuser, NOBYPASSRLS operator role', async () => {
    const rows = await client!<{ currentUser: string }[]>`select current_user as "currentUser"`;
    expect(rows[0]?.currentUser).toBe(ACCEPTED_PROVISIONING_DB_ROLE);

    const forceRlsRows = await client!<{ tableName: string; forceRls: boolean }[]>`
      select c.relname as "tableName", c.relforcerowsecurity as "forceRls"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where (n.nspname = 'app' and c.relname in (
        'tenants', 'legal_entities', 'stations', 'memberships',
        'membership_role_assignments', 'temporary_permission_grants'
      )) or (n.nspname = 'platform' and c.relname = 'security_events')
      order by n.nspname, c.relname
    `;
    expect(forceRlsRows).toHaveLength(7);
    expect(forceRlsRows.every((row) => row.forceRls)).toBe(true);
  });

  fixtureTest('exposes only the filtered capability reads to the operator role', async () => {
    await expect(client!`select count(*)::integer as count from app.tenants`).rejects.toThrow();
    await expect(
      client!`select platform.first_user_provisioning_set_context('scope_read')`,
    ).rejects.toThrow();
    await expect(
      client!`select platform.first_user_provisioning_permission_definitions(${['tenant.manage']}::text[])`,
    ).rejects.toThrow();
    await expect(
      appRuntimeClient!`select platform.first_user_provisioning_scope_options(
        ${scope!.tenantId}::uuid, ${scope!.legalEntityId}::uuid, ${scope!.stationId}::uuid
      )`,
    ).rejects.toThrow();

    const options = await listScopeOptions(client!, { tenantId: scope!.tenantId });
    expect(options.tenants).toHaveLength(1);
    expect(options.tenants[0]?.id).toBe(scope!.tenantId);
    expect(options.legalEntities.every((entity) => entity.tenantId === scope!.tenantId)).toBe(true);
    expect(options.stations.every((station) => station.tenantId === scope!.tenantId)).toBe(true);
  });

  fixtureTest('runs dry-run planning in a read-only transaction', async () => {
    const email = `first-user-dry-run-${Date.now()}@example.test`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await client!.begin(async (transaction) => {
      await transaction.unsafe('set transaction read only');
      const plan = await preparePlan(createPostgresRepository(transaction), {
        email,
        displayName: 'Integration Dry Run',
        scope: scope!,
        expiresAt,
        lockScope: false,
      });
      expect(plan.grants).toEqual(READ_ONLY_GRANT_PLAN);
      expect(plan.operationId).toMatch(UUID_PATTERN);
    });
  });

  fixtureTest('creates one exact operation and safely refuses a duplicate', async () => {
    const email = `first-user-success-${Date.now()}@example.test`;
    const auditKey = { keyId: 'integration-first-user', secret: 'integration-only-secret' };
    let result: Awaited<ReturnType<typeof provisionFirstUser>> | undefined;
    let revoked = false;

    try {
      result = await client!.begin(async (transaction) =>
        provisionFirstUser({
          repository: createPostgresRepository(transaction),
          request: {
            email,
            displayName: 'Integration Success',
            scope: scope!,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
          password: 'integration-only-password',
          auditKey,
          hasher: async () => 'integration-password-hash',
        }),
      );

      expect(result.permissionCodes).toEqual(
        READ_ONLY_GRANT_PLAN.map((grant) => grant.permissionCode),
      );
      const identity = await createPostgresRepository(client!).findIdentityByEmail(
        email,
        scope!.tenantId,
      );
      expect(identity?.memberships).toHaveLength(1);
      expect(identity?.memberships[0]?.status).toBe('ACTIVE');

      await expect(
        client!.begin(async (transaction) =>
          provisionFirstUser({
            repository: createPostgresRepository(transaction),
            request: {
              email,
              displayName: 'Duplicate Attempt',
              scope: scope!,
              expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            },
            password: 'integration-only-password',
            auditKey,
            hasher: async () => 'integration-password-hash',
          }),
        ),
      ).rejects.toThrow('duplicate provisioning is refused');

      const revokeResult = await client!.begin(async (transaction) =>
        revokeFirstUserAccess({
          repository: createPostgresRepository(transaction),
          email,
          userId: result!.userId,
          operationId: result!.operationId,
          scope: scope!,
          auditKey,
        }),
      );
      expect(revokeResult).toMatchObject({
        revokedGrantCount: READ_ONLY_GRANT_PLAN.length,
        membershipDisabled: true,
      });
      revoked = true;
    } finally {
      if (result && !revoked) {
        await client!
          .begin(async (transaction) =>
            revokeFirstUserAccess({
              repository: createPostgresRepository(transaction),
              email,
              userId: result!.userId,
              operationId: result!.operationId,
              scope: scope!,
              auditKey,
            }),
          )
          .catch(() => undefined);
      }
    }
  });

  fixtureTest('writes failure audit evidence through the tenant-scoped capability', async () => {
    const event = signSecurityEvent(
      {
        eventId: randomUUID(),
        tenantId: scope!.tenantId,
        eventCode: 'ACCESS.PROVISIONING_FAILED',
        requestId: randomUUID(),
        occurredAt: new Date().toISOString(),
        details: {
          actorType: 'SUPPORT',
          initiatedBy: 'first-production-user-provisioning',
          subjectType: 'access.provisioning.request',
          subjectId: 'provision',
          metadata: { mode: 'provision', outcome: 'failure' },
        },
      },
      { keyId: 'integration-first-user', secret: 'integration-only-secret' },
    );

    await expect(
      client!.begin(async (transaction) => {
        await transaction`
          select platform.first_user_provisioning_append_failure(
            ${scope!.tenantId}::uuid, ${JSON.stringify(event)}::jsonb
          )
        `;
        throw new Error('expected failure-audit rollback');
      }),
    ).rejects.toThrow('expected failure-audit rollback');
  });

  fixtureTest(
    'rolls back the complete provisioning transaction after capability-only grant inspection',
    async () => {
      const email = `first-user-rollback-${Date.now()}@example.test`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await expect(
        client!.begin(async (transaction) => {
          const repository = createPostgresRepository(transaction);
          const result = await provisionFirstUser({
            repository,
            request: {
              email,
              displayName: 'Integration Rollback',
              scope: scope!,
              expiresAt,
            },
            password: 'integration-only-password',
            auditKey: { keyId: 'integration-first-user', secret: 'integration-only-secret' },
            hasher: async () => 'integration-password-hash',
          });
          const grants = await repository.listUnrevokedTemporaryGrants({
            tenantId: scope!.tenantId,
            membershipId: result.membershipId,
          });
          expect(grants).toHaveLength(READ_ONLY_GRANT_PLAN.length);
          expect(
            grants
              .map((grant) => ({
                permissionCode: grant.permissionCode,
                scopeType: grant.scopeType,
              }))
              .sort((left, right) => left.permissionCode.localeCompare(right.permissionCode)),
          ).toEqual(
            [...READ_ONLY_GRANT_PLAN]
              .map((grant) => ({
                permissionCode: grant.permissionCode,
                scopeType: grant.scopeType,
              }))
              .sort((left, right) => left.permissionCode.localeCompare(right.permissionCode)),
          );
          expect(grants.some((grant) => grant.permissionCode === 'provider.view')).toBe(false);
          expect(
            grants.every((grant) => grant.reason.startsWith('first-production-user-provisioning:')),
          ).toBe(true);
          expect(grants.every((grant) => grant.tenantId === scope!.tenantId)).toBe(true);
          throw new Error('expected integration rollback');
        }),
      ).rejects.toThrow('expected integration rollback');

      const users = await adminClient!<
        { id: string }[]
      >`select id::text from auth."user" where email = ${email}`;
      expect(users).toHaveLength(0);
    },
  );
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
