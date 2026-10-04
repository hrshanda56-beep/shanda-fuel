import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

import {
  ACCEPTED_PROVISIONING_DB_ROLE,
  READ_ONLY_GRANT_PLAN,
  assertAcceptedProvisioningRole,
  createPostgresRepository,
  preparePlan,
  provisionFirstUser,
  type ScopeIds,
} from '../../scripts/first-user-provisioning';

/*
 * This suite is deliberately opt-in. The operator tool must never discover or
 * guess a database from a developer shell, and APP_ENV=production is never a
 * permitted integration-test environment.
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.FIRST_USER_PROVISIONING_TEST_DATABASE === 'true' &&
  process.env.APP_ENV === 'local' &&
  Boolean(databaseUrl);
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

integration('first-user provisioning PostgreSQL hardening', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
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
  });

  it('requires the dedicated non-superuser, NOBYPASSRLS operator role', async () => {
    const rows = await client!<{ currentUser: string }[]>`select current_user as "currentUser"`;
    expect(rows[0]?.currentUser).toBe(ACCEPTED_PROVISIONING_DB_ROLE);
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

  fixtureTest(
    'rolls back the complete provisioning transaction and records exact grants/audit subject',
    async () => {
      const email = `first-user-rollback-${Date.now()}@example.test`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await expect(
        client!.begin(async (transaction) => {
          const result = await provisionFirstUser({
            repository: createPostgresRepository(transaction),
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
          const grants = await transaction<
            { permissionCode: string; reason: string; expiresAt: Date }[]
          >`
            select permission_code as "permissionCode", reason, expires_at as "expiresAt"
            from app.temporary_permission_grants
            where membership_id = ${result.membershipId}
            order by permission_code
          `;
          expect(grants).toHaveLength(READ_ONLY_GRANT_PLAN.length);
          expect(grants.some((grant) => grant.permissionCode === 'provider.view')).toBe(false);
          expect(
            grants.every((grant) => grant.reason.startsWith('first-production-user-provisioning:')),
          ).toBe(true);
          expect(grants.every((grant) => grant.expiresAt > new Date())).toBe(true);
          const events = await transaction<
            { actorId: string | null; details: { subjectId?: string } }[]
          >`
            select actor_id as "actorId", details
            from platform.security_events
            where membership_id = ${result.membershipId}
            order by occurred_at
          `;
          expect(events).toHaveLength(2);
          expect(events.every((event) => event.actorId === null)).toBe(true);
          expect(events.every((event) => event.details.subjectId === result.userId)).toBe(true);
          throw new Error('expected integration rollback');
        }),
      ).rejects.toThrow('expected integration rollback');

      const users = await client!<
        { id: string }[]
      >`select id::text from auth."user" where email = ${email}`;
      expect(users).toHaveLength(0);
    },
  );
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
