import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from 'better-auth/crypto';

import { signSecurityEvent } from '../../src/platform/security/audit-signing';
import {
  OWNER_BOOTSTRAP_DISPLAY_NAME,
  OWNER_BOOTSTRAP_EMAIL,
  OWNER_BOOTSTRAP_LEGAL_ENTITY_ID,
  OWNER_BOOTSTRAP_STATION_IDS,
  OWNER_BOOTSTRAP_TENANT_ID,
} from '../../scripts/first-owner-provisioning';

const databaseUrl = process.env.DATABASE_URL;
const adminDatabaseUrl = process.env.FIRST_USER_PROVISIONING_TEST_ADMIN_DATABASE_URL;
const appRuntimeDatabaseUrl = process.env.FIRST_USER_PROVISIONING_TEST_APP_RUNTIME_DATABASE_URL;
const enabled =
  process.env.FIRST_USER_PROVISIONING_TEST_DATABASE === 'true' &&
  process.env.APP_ENV === 'local' &&
  Boolean(databaseUrl && adminDatabaseUrl && appRuntimeDatabaseUrl);
const integration = enabled ? describe : describe.skip;

const configuredTenantId = process.env.FIRST_OWNER_PROVISIONING_TEST_TENANT_ID;
const configuredLegalEntityId = process.env.FIRST_OWNER_PROVISIONING_TEST_LEGAL_ENTITY_ID;
const configuredStationIds = (process.env.FIRST_OWNER_PROVISIONING_TEST_STATION_IDS ?? '').split(
  ',',
);
const auditKey = { keyId: 'integration-first-owner', secret: 'integration-only-secret' };

type Provisioned = { userId: string; membershipId: string; operationId: string };

let client: ReturnType<typeof postgres> | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let appRuntimeClient: ReturnType<typeof postgres> | undefined;

function event(
  eventCode: 'ACCESS.PROVISIONING_INITIATED' | 'ACCESS.PROVISIONING_COMPLETED',
  target: Provisioned,
  roleCode: string = 'OWNER',
) {
  return signSecurityEvent(
    {
      eventId: randomUUID(),
      tenantId: OWNER_BOOTSTRAP_TENANT_ID,
      membershipId: target.membershipId,
      eventCode,
      requestId: randomUUID(),
      occurredAt: new Date().toISOString(),
      details: {
        actorType: 'SUPPORT',
        initiatedBy: 'first-production-owner-provisioning',
        subjectType: 'auth.user',
        subjectId: target.userId,
        metadata: {
          operationId: target.operationId,
          legalEntityId: OWNER_BOOTSTRAP_LEGAL_ENTITY_ID,
          stationIds: [...OWNER_BOOTSTRAP_STATION_IDS],
          roleCode,
          scopeType: 'TENANT',
          outcome: 'success',
        },
      },
    },
    auditKey,
  );
}

async function plan(
  input: {
    tenant?: string;
    entity?: string;
    stations?: readonly string[];
    email?: string;
    displayName?: string;
  } = {},
) {
  return client!.begin(async (transaction) => {
    const rows = await transaction<{ value: Record<string, unknown> }[]>`
      select platform.first_owner_provisioning_plan(
        ${input.tenant ?? OWNER_BOOTSTRAP_TENANT_ID}::uuid,
        ${input.entity ?? OWNER_BOOTSTRAP_LEGAL_ENTITY_ID}::uuid,
        ${client!.array([...(input.stations ?? OWNER_BOOTSTRAP_STATION_IDS)])}::uuid[],
        ${input.email ?? OWNER_BOOTSTRAP_EMAIL},
        ${input.displayName ?? OWNER_BOOTSTRAP_DISPLAY_NAME}
      ) as value
    `;
    return rows[0]?.value;
  });
}

async function provision(roleCode = 'OWNER'): Promise<Provisioned> {
  const target = { userId: randomUUID(), membershipId: randomUUID(), operationId: randomUUID() };
  const passwordHash = await hashPassword('integration-owner-password');
  await client!.begin(async (transaction) => {
    await transaction`
      select platform.first_owner_provisioning_provision(
        ${target.userId}::uuid,
        ${target.membershipId}::uuid,
        ${target.operationId}::uuid,
        ${OWNER_BOOTSTRAP_TENANT_ID}::uuid,
        ${OWNER_BOOTSTRAP_LEGAL_ENTITY_ID}::uuid,
        ${client!.array([...OWNER_BOOTSTRAP_STATION_IDS])}::uuid[],
        ${OWNER_BOOTSTRAP_EMAIL},
        ${OWNER_BOOTSTRAP_DISPLAY_NAME},
        ${passwordHash},
        ${transaction.json(JSON.parse(JSON.stringify(event('ACCESS.PROVISIONING_INITIATED', target, roleCode))))}::jsonb,
        ${transaction.json(JSON.parse(JSON.stringify(event('ACCESS.PROVISIONING_COMPLETED', target, roleCode))))}::jsonb
      )
    `;
  });
  return target;
}

integration('first-owner provisioning PostgreSQL hardening', () => {
  let provisioned: Provisioned;

  beforeAll(() => {
    expect(configuredTenantId).toBe(OWNER_BOOTSTRAP_TENANT_ID);
    expect(configuredLegalEntityId).toBe(OWNER_BOOTSTRAP_LEGAL_ENTITY_ID);
    expect(configuredStationIds).toEqual([...OWNER_BOOTSTRAP_STATION_IDS]);
    client = postgres(databaseUrl!, { max: 4, prepare: false });
    adminClient = postgres(adminDatabaseUrl!, { max: 2, prepare: false });
    appRuntimeClient = postgres(appRuntimeDatabaseUrl!, { max: 2, prepare: false });
  });

  afterAll(async () => {
    await client?.end();
    await adminClient?.end();
    await appRuntimeClient?.end();
  });

  it('rejects wrong email, tenant, legal entity, station scope, and role', async () => {
    await expect(plan({ email: 'wrong-owner@example.test' })).rejects.toThrow(
      'approved fixed scope',
    );
    await expect(plan({ tenant: '11111111-1111-4111-8111-111111111111' })).rejects.toThrow(
      'approved fixed scope',
    );
    await expect(plan({ entity: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).rejects.toThrow(
      'approved fixed scope',
    );
    await expect(
      plan({
        stations: [
          ...OWNER_BOOTSTRAP_STATION_IDS.slice(0, 3),
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        ],
      }),
    ).rejects.toThrow('approved fixed scope');
    await expect(provision('ADMINISTRATOR')).rejects.toThrow('audit event is invalid');
  });

  it('rejects unauthorized callers without an RLS bypass', async () => {
    await expect(
      appRuntimeClient!`
        select platform.first_owner_provisioning_plan(
          ${OWNER_BOOTSTRAP_TENANT_ID}::uuid,
          ${OWNER_BOOTSTRAP_LEGAL_ENTITY_ID}::uuid,
          ${appRuntimeClient!.array([...OWNER_BOOTSTRAP_STATION_IDS])}::uuid[],
          ${OWNER_BOOTSTRAP_EMAIL},
          ${OWNER_BOOTSTRAP_DISPLAY_NAME}
        )
      `,
    ).rejects.toThrow();
    const hiddenRows = await appRuntimeClient!<
      { count: string }[]
    >`select count(*) from app.memberships`;
    expect(hiddenRows[0]?.count).toBe('0');
  });

  it('serializes concurrent fixed-scope attempts and creates one canonical OWNER', async () => {
    const results = await Promise.allSettled([provision(), provision()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const success = results.find(
      (result): result is PromiseFulfilledResult<Provisioned> => result.status === 'fulfilled',
    );
    expect(success).toBeDefined();
    provisioned = success!.value;

    const roleRows = await adminClient!<
      {
        roleCode: string;
        scopeType: string;
        legalEntityId: string | null;
        stationId: string | null;
      }[]
    >`
      select role_code as "roleCode", scope_type as "scopeType",
             legal_entity_id as "legalEntityId", station_id as "stationId"
      from app.membership_role_assignments
      where tenant_id = ${OWNER_BOOTSTRAP_TENANT_ID}::uuid
        and membership_id = ${provisioned.membershipId}::uuid
    `;
    expect(roleRows).toEqual([
      { roleCode: 'OWNER', scopeType: 'TENANT', legalEntityId: null, stationId: null },
    ]);

    const operationRows = await adminClient!<
      { bootstrapMode: string; stationIds: string[]; email: string }[]
    >`
      select bootstrap_mode as "bootstrapMode", station_ids as "stationIds", email
      from platform.first_user_provisioning_operations
      where operation_id = ${provisioned.operationId}::uuid
    `;
    expect(operationRows).toEqual([
      {
        bootstrapMode: 'OWNER',
        stationIds: [...OWNER_BOOTSTRAP_STATION_IDS],
        email: OWNER_BOOTSTRAP_EMAIL,
      },
    ]);
  });

  it('records audit evidence for the exact four approved stations', async () => {
    const events = await adminClient!<
      {
        eventCode: string;
        actorId: string | null;
        subjectId: string;
        details: Record<string, unknown>;
      }[]
    >`
      select event_code as "eventCode", actor_id as "actorId",
             details->>'subjectId' as "subjectId", details
      from platform.security_events
      where tenant_id = ${OWNER_BOOTSTRAP_TENANT_ID}::uuid
        and membership_id = ${provisioned.membershipId}::uuid
      order by occurred_at
    `;
    expect(events.map((row) => row.eventCode)).toEqual([
      'ACCESS.PROVISIONING_INITIATED',
      'ACCESS.PROVISIONING_COMPLETED',
    ]);
    expect(
      events.every((row) => row.actorId === null && row.subjectId === provisioned.userId),
    ).toBe(true);
    expect(events.every((row) => !JSON.stringify(row).match(/password|secret|token|cookie/i))).toBe(
      true,
    );
    expect(events.every((row) => row.details.metadata)).toBe(true);
    expect(events[0]?.details.metadata).toMatchObject({
      legalEntityId: OWNER_BOOTSTRAP_LEGAL_ENTITY_ID,
      roleCode: 'OWNER',
      scopeType: 'TENANT',
      stationIds: [...OWNER_BOOTSTRAP_STATION_IDS],
    });
  });

  it('refuses replay and any second OWNER bootstrap attempt', async () => {
    await expect(plan()).rejects.toThrow('already been consumed');
    await expect(provision()).rejects.toThrow();
  });
});
