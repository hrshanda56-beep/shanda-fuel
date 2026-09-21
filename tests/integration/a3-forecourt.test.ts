import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { createTrustedTenantTransactionContext } from '../../src/platform/db/tenant-context';
import {
  createForecourtCommandContext,
  databaseForecourtTransactionPort,
  type ForecourtCommandContext,
  type ForecourtTransaction,
} from '../../src/modules/forecourt/application';
import {
  databaseAuditPort,
  databaseIdempotencyPort,
  databaseOutboxPort,
} from '../../src/modules/forecourt/persistence';
import { businessDayLockedEvent } from '../../src/modules/forecourt/contracts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A3 forecourt integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const ids = {
  tenantA: 'a3000000-0000-4000-8000-000000000001',
  tenantB: 'a3000000-0000-4000-8000-000000000002',
  legalA: 'a3000000-0000-4000-8000-000000000011',
  legalB: 'a3000000-0000-4000-8000-000000000012',
  legalA2: 'a3000000-0000-4000-8000-000000000013',
  stationA: 'a3000000-0000-4000-8000-000000000021',
  stationB: 'a3000000-0000-4000-8000-000000000022',
  stationA2: 'a3000000-0000-4000-8000-000000000023',
  actorA: 'a3000000-0000-4000-8000-000000000031',
  actorB: 'a3000000-0000-4000-8000-000000000032',
  membershipA: 'a3000000-0000-4000-8000-000000000041',
  membershipB: 'a3000000-0000-4000-8000-000000000042',
  productA: 'a3000000-0000-4000-8000-000000000051',
  pumpA: 'a3000000-0000-4000-8000-000000000061',
  nozzleA: 'a3000000-0000-4000-8000-000000000071',
  meterA: 'a3000000-0000-4000-8000-000000000081',
  installationA: 'a3000000-0000-4000-8000-000000000091',
  dayA: 'a3000000-0000-4000-8000-000000000101',
  shiftA: 'a3000000-0000-4000-8000-000000000111',
  openingA: 'a3000000-0000-4000-8000-000000000121',
  closingA: 'a3000000-0000-4000-8000-000000000122',
  segmentA: 'a3000000-0000-4000-8000-000000000131',
  priceA: 'a3000000-0000-4000-8000-000000000141',
  reconciliationA: 'a3000000-0000-4000-8000-000000000151',
  revisionA: 'a3000000-0000-4000-8000-000000000161',
  auditA: 'a3000000-0000-4000-8000-000000000172',
  outboxA: 'a3000000-0000-4000-8000-000000000171',
  rollbackAudit: 'a3000000-0000-4000-8000-000000000173',
  rollbackOutbox: 'a3000000-0000-4000-8000-000000000174',
  replayAudit: 'a3000000-0000-4000-8000-000000000175',
  replayOutbox: 'a3000000-0000-4000-8000-000000000176',
  rollbackRequest: 'a3000000-0000-4000-8000-000000000177',
  replayRequest: 'a3000000-0000-4000-8000-000000000178',
};

let client: Sql;
let raceClient: Sql;

async function setContext(tenantId: string, actorId: string, membershipId: string) {
  await client.unsafe(`select set_config('app.tenant_id', '${tenantId}', false)`);
  await client.unsafe(`select set_config('app.actor_id', '${actorId}', false)`);
  await client.unsafe(`select set_config('app.membership_id', '${membershipId}', false)`);
}

function productionContext(requestId: string): ForecourtCommandContext {
  const transaction = createTrustedTenantTransactionContext({
    tenantId: ids.tenantA,
    actorId: ids.actorA,
    membershipId: ids.membershipA,
    requestId,
  });
  const authority = {
    actor: {
      identityId: ids.actorA,
      session: {
        sessionId: 'a3000000-0000-4000-8000-000000000179',
        userId: ids.actorA,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        strongAuthenticationVerified: true,
      },
    },
    membership: {
      tenantId: ids.tenantA,
      membershipId: ids.membershipA,
      identityId: ids.actorA,
      actorId: ids.actorA,
      status: 'ACTIVE' as const,
      roleAssignments: [
        {
          tenantId: ids.tenantA,
          scopeType: 'STATION' as const,
          legalEntityId: ids.legalA,
          stationId: ids.stationA,
          roleCode: 'SUPERVISOR' as const,
        },
      ],
      temporaryGrants: [],
    },
    authorization: {
      userId: ids.actorA,
      membershipId: ids.membershipA,
      tenantId: ids.tenantA,
      membershipActive: true,
      strongAuthenticationVerified: true,
      roleAssignments: [
        {
          tenantId: ids.tenantA,
          scopeType: 'STATION' as const,
          legalEntityId: ids.legalA,
          stationId: ids.stationA,
          roleCode: 'SUPERVISOR' as const,
        },
      ],
      temporaryGrants: [],
    },
    transaction,
  };
  return createForecourtCommandContext({
    authority,
    station: { id: ids.stationA, tenantId: ids.tenantA, legalEntityId: ids.legalA },
  });
}

describe('A3 PostgreSQL forecourt isolation and resource constraints', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
    raceClient = postgres(databaseUrl, { max: 2, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenantA}', 'A3 Tenant A', 'a3-tenant-a'),
        ('${ids.tenantB}', 'A3 Tenant B', 'a3-tenant-b') on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.actorA}', 'A3 Actor A', 'a3-actor-a@example.test'),
        ('${ids.actorB}', 'A3 Actor B', 'a3-actor-b@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membershipA}', '${ids.tenantA}', '${ids.actorA}', 'ACTIVE'),
        ('${ids.membershipB}', '${ids.tenantB}', '${ids.actorB}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legalA}', '${ids.tenantA}', 'A3 Legal A'),
        ('${ids.legalA2}', '${ids.tenantA}', 'A3 Legal A2'),
        ('${ids.legalB}', '${ids.tenantB}', 'A3 Legal B') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.stationA}', '${ids.tenantA}', '${ids.legalA}', 'A3A', 'A3 Station A', 'ACTIVE'),
        ('${ids.stationA2}', '${ids.tenantA}', '${ids.legalA2}', 'A3A2', 'A3 Station A2', 'ACTIVE'),
        ('${ids.stationB}', '${ids.tenantB}', '${ids.legalB}', 'A3B', 'A3 Station B', 'ACTIVE') on conflict (id) do nothing;
    `);
  });

  afterAll(async () => {
    await client?.end();
    await raceClient?.end();
  });

  it('enforces tenant visibility, composite links, RLS, and nozzle installation exclusivity', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await setContext(ids.tenantA, ids.actorA, ids.membershipA);
      await client.unsafe(`
        insert into app.products (id, tenant_id, code, name) values ('${ids.productA}', '${ids.tenantA}', 'A3-DIESEL', 'Diesel');
        insert into app.pumps (id, tenant_id, station_id, number) values ('${ids.pumpA}', '${ids.tenantA}', '${ids.stationA}', '1');
        insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id) values ('${ids.nozzleA}', '${ids.tenantA}', '${ids.stationA}', '${ids.pumpA}', '1', '${ids.productA}');
        insert into app.meters (id, tenant_id, serial_number) values ('${ids.meterA}', '${ids.tenantA}', 'A3-METER-1');
        insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
          values ('${ids.installationA}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.meterA}', '2026-09-20T00:00:00Z', '${ids.membershipA}');
        insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
          values ('${ids.dayA}', '${ids.tenantA}', '${ids.stationA}', '2026-09-20', 'NOT_STARTED');
        update app.station_business_days set state = 'OPEN' where id = '${ids.dayA}';
        insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
          values ('${ids.shiftA}', '${ids.tenantA}', '${ids.stationA}', '${ids.dayA}', 'PLANNED', '2026-09-20T06:00:00Z', '2026-09-20T14:00:00Z', '2026-09-20');
        update app.shifts set state = 'OPEN' where id = '${ids.shiftA}';
        insert into app.meter_boundaries (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
          values
            ('${ids.openingA}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', 'SHIFT_OPEN', 'AVAILABLE', 1000.000, '2026-09-20T06:00:00Z', '2026-09-20T06:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}'),
            ('${ids.closingA}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', 'SHIFT_CLOSE', 'AVAILABLE', 1010.125, '2026-09-20T14:00:00Z', '2026-09-20T14:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}');
        insert into app.meter_segments (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, expected_sale_value, boundary_reason, segment_start_at, segment_end_at, sealed_at)
          values ('${ids.segmentA}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', '${ids.openingA}', '${ids.closingA}', '${ids.productA}', '${ids.membershipA}', '${ids.membershipA}', 1000.000, 1010.125, 10.125, 1.500000, 15.1875, 'SHIFT_CLOSE', '2026-09-20T06:00:00Z', '2026-09-20T14:00:00Z', '2026-09-20T14:00:01Z');
      `);

      const visible = await client<{ id: string }[]>`select id from app.meter_segments`;
      expect(visible.map((row) => row.id)).toEqual([ids.segmentA]);
      await setContext(ids.tenantB, ids.actorB, ids.membershipB);
      expect(await client`select id from app.meter_segments`).toEqual([]);
      await setContext(ids.tenantA, ids.actorA, ids.membershipA);
      await expect(
        client.unsafe(`
        insert into app.meter_installations (tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values ('${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.meterA}', '2026-09-21T00:00:00Z', '${ids.membershipA}')
      `),
      ).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('forces RLS on every A3 tenant-owned table', async () => {
    const rows = await client<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname in (
        'products', 'pumps', 'nozzles', 'meters', 'meter_installations',
        'station_business_days', 'shifts', 'selling_prices', 'meter_boundaries',
        'meter_segments', 'reconciliations', 'reconciliation_revisions', 'payment_declarations',
        'forecourt_idempotency_records', 'forecourt_outbox'
      ) order by c.relname
    `;
    expect(rows).toHaveLength(15);
    expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it('rejects same-tenant cross-station parent and child references', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await setContext(ids.tenantA, ids.actorA, ids.membershipA);
      await expect(
        client.unsafe(`
          insert into app.shifts (tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
          values ('${ids.tenantA}', '${ids.stationA2}', '${ids.dayA}', 'PLANNED', '2026-09-20T06:00:00Z', '2026-09-20T14:00:00Z', '2026-09-20')
        `),
      ).rejects.toThrow();
      await expect(
        client.unsafe(`
          insert into app.meter_boundaries (tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
          values ('${ids.tenantA}', '${ids.stationA2}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', 'SHIFT_OPEN', 'AVAILABLE', 1000.000, '2026-09-20T06:00:00Z', '2026-09-20T06:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}')
        `),
      ).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('rejects authoritative workflow states on direct INSERT', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await setContext(ids.tenantA, ids.actorA, ids.membershipA);
      await expect(
        client.unsafe(`
          insert into app.station_business_days (tenant_id, station_id, business_date, state)
          values ('${ids.tenantA}', '${ids.stationA}', '2026-09-21', 'CLOSED')
        `),
      ).rejects.toThrow(/NOT_STARTED/);
      await expect(
        client.unsafe(`
          insert into app.shifts (tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
          values ('${ids.tenantA}', '${ids.stationA}', '${ids.dayA}', 'OPEN', '2026-09-21T06:00:00Z', '2026-09-21T14:00:00Z', '2026-09-21')
        `),
      ).rejects.toThrow(/PLANNED/);
      await expect(
        client.unsafe(`
          insert into app.selling_prices (tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
          values ('${ids.tenantA}', '${ids.stationA}', '${ids.productA}', '2026-09-21T00:00:00Z', 1.700000, 'ACTIVE', '${ids.membershipA}')
        `),
      ).rejects.toThrow(/DRAFT/);
      await expect(
        client.unsafe(`
          insert into app.reconciliations (tenant_id, station_id, business_day_id, state)
          values ('${ids.tenantA}', '${ids.stationA}', '${ids.dayA}', 'APPROVED')
        `),
      ).rejects.toThrow(/DRAFT/);
      await expect(
        client.unsafe(`
          insert into app.reconciliation_revisions (tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance, variance_classification, declarations)
          values ('${ids.tenantA}', '${ids.stationA}', '${ids.reconciliationA}', 99, 'LOCKED', 0, 0, 0, 'INFORMATIONAL', '[]'::jsonb)
        `),
      ).rejects.toThrow(/READY/);
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('rejects runtime rewrites of sealed, locked, approved, and activated history', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await setContext(ids.tenantA, ids.actorA, ids.membershipA);
      await expect(
        client.unsafe(`update app.meter_segments set litres = 10.000 where id = '${ids.segmentA}'`),
      ).rejects.toThrow();
      await expect(
        client.unsafe(`delete from app.meter_segments where id = '${ids.segmentA}'`),
      ).rejects.toThrow();

      await client.unsafe(`
        insert into app.selling_prices (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
        values ('${ids.priceA}', '${ids.tenantA}', '${ids.stationA}', '${ids.productA}', '2026-09-20T15:00:00Z', 1.600000, 'DRAFT', '${ids.membershipA}');
        update app.selling_prices set state = 'PENDING_APPROVAL' where id = '${ids.priceA}';
        update app.selling_prices set state = 'APPROVED' where id = '${ids.priceA}';
        update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id = '${ids.priceA}';
        update app.selling_prices set state = 'BOUNDARIES_IN_PROGRESS' where id = '${ids.priceA}';
        update app.selling_prices set state = 'ACTIVE' where id = '${ids.priceA}';
        insert into app.reconciliations (id, tenant_id, station_id, business_day_id, state)
        values ('${ids.reconciliationA}', '${ids.tenantA}', '${ids.stationA}', '${ids.dayA}', 'DRAFT');
        update app.reconciliations set state = 'READY' where id = '${ids.reconciliationA}';
        update app.reconciliations set state = 'SUBMITTED' where id = '${ids.reconciliationA}';
        update app.reconciliations set state = 'PENDING_APPROVAL' where id = '${ids.reconciliationA}';
        update app.reconciliations set state = 'APPROVED' where id = '${ids.reconciliationA}';
        insert into app.reconciliation_revisions (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance, variance_classification, declarations, approved_by)
        values ('${ids.revisionA}', '${ids.tenantA}', '${ids.stationA}', '${ids.reconciliationA}', 1, 'READY', 15.1875, 15.1875, 0, 'INFORMATIONAL', '[]'::jsonb, '${ids.membershipA}');
        update app.reconciliation_revisions set state = 'SUBMITTED' where id = '${ids.revisionA}';
        update app.reconciliation_revisions set state = 'PENDING_APPROVAL' where id = '${ids.revisionA}';
        update app.reconciliation_revisions set state = 'APPROVED' where id = '${ids.revisionA}';
      `);
      await expect(
        client.unsafe(
          `update app.selling_prices set unit_price = 1.700000 where id = '${ids.priceA}'`,
        ),
      ).rejects.toThrow();
      await expect(
        client.unsafe(
          `update app.reconciliation_revisions set expected_sales = 99 where id = '${ids.revisionA}'`,
        ),
      ).rejects.toThrow();
      await client.unsafe(
        `update app.reconciliations set state = 'POSTED' where id = '${ids.reconciliationA}'`,
      );
      await client.unsafe(
        `update app.reconciliations set state = 'LOCKED' where id = '${ids.reconciliationA}'`,
      );
      await expect(
        client.unsafe(
          `update app.reconciliations set state = 'APPROVED' where id = '${ids.reconciliationA}'`,
        ),
      ).rejects.toThrow();

      await client.unsafe(
        `update app.station_business_days set state = 'OPERATIONS_COMPLETE' where id = '${ids.dayA}'`,
      );
      await client.unsafe(
        `update app.station_business_days set state = 'CLOSED' where id = '${ids.dayA}'`,
      );
      await client.unsafe(
        `update app.station_business_days set state = 'LOCKED' where id = '${ids.dayA}'`,
      );
      await expect(
        client.unsafe(
          `update app.station_business_days set business_date = '2026-09-21' where id = '${ids.dayA}'`,
        ),
      ).rejects.toThrow();

      await expect(
        client.unsafe(`update app.shifts set state = 'COMPLETED' where id = '${ids.shiftA}'`),
      ).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('persists idempotency, audit, and outbox records with database guards', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await setContext(ids.tenantA, ids.actorA, ids.membershipA);
      await client.unsafe(`
        insert into app.forecourt_idempotency_records
          (tenant_id, command_type, idempotency_key, request_hash, status, result_payload)
        values ('${ids.tenantA}', 'ConfirmBoundary', 'integration-key-1', 'hash-1', 'COMPLETED', '{"value":"ok"}'::jsonb);
      `);
      await expect(
        client.unsafe(`
          insert into app.forecourt_idempotency_records
            (tenant_id, command_type, idempotency_key, request_hash, status, result_payload)
          values ('${ids.tenantA}', 'ConfirmBoundary', 'integration-key-1', 'hash-2', 'COMPLETED', '{}'::jsonb)
        `),
      ).rejects.toThrow();

      await client.unsafe(`
        insert into platform.security_events
          (id, tenant_id, actor_id, membership_id, event_code, request_id, details, key_id, algorithm, signature)
        values ('${ids.auditA}', '${ids.tenantA}', '${ids.actorA}', '${ids.membershipA}', 'FORECOURT.ConfirmBoundary', '${ids.actorA}', '{"subjectType":"MeterSegment","subjectId":"${ids.segmentA}"}'::jsonb, 'test-key', 'hmac-sha256', 'test-signature');
      `);
      await expect(
        client.unsafe(
          `update platform.security_events set event_code = 'rewrite' where tenant_id = '${ids.tenantA}'`,
        ),
      ).rejects.toThrow();

      await client.unsafe(`
        insert into app.forecourt_outbox
          (event_id, tenant_id, station_id, event_type, event_version, aggregate_type, aggregate_id, payload)
        values ('${ids.outboxA}', '${ids.tenantA}', '${ids.stationA}', 'forecourt.meter_segment_sealed.v1', 1, 'MeterSegment', '${ids.segmentA}', '{"segmentId":"${ids.segmentA}"}'::jsonb);
        update app.forecourt_outbox set published_at = now() where event_id = '${ids.outboxA}';
      `);
      await expect(
        client.unsafe(
          `update app.forecourt_outbox set payload = '{}'::jsonb where event_id = '${ids.outboxA}'`,
        ),
      ).rejects.toThrow();
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('rolls back business mutation, idempotency, A1 audit, and outbox atomically', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    const context = productionContext(ids.rollbackRequest);
    const before = await client<{ version: number }[]>`
      select version from app.meter_installations where id = ${ids.installationA}
    `;

    await expect(
      databaseForecourtTransactionPort.run(context, async (transaction) =>
        databaseIdempotencyPort.run(
          transaction,
          {
            tenantId: ids.tenantA,
            commandType: 'SealSegment',
            idempotencyKey: 'integration-rollback-1',
            requestHash: 'rollback-hash-1',
          },
          async () => {
            await transaction.execute(sql`
              update app.meter_installations
              set version = version + 1
              where tenant_id = ${ids.tenantA} and station_id = ${ids.stationA} and id = ${ids.installationA}
            `);
            const event = businessDayLockedEvent({
              eventId: ids.rollbackOutbox,
              tenantId: ids.tenantA,
              stationId: ids.stationA,
              businessDayId: ids.dayA,
              businessDate: '2026-09-20',
              lockedAt: '2026-09-20T23:00:00.000Z',
              legalEntityId: ids.legalA,
            });
            await databaseAuditPort.append({
              transaction,
              context,
              commandType: 'SealSegment',
              subjectType: 'MeterInstallation',
              subjectId: ids.installationA,
              before: { version: before[0]?.version },
              after: { version: (before[0]?.version ?? 0) + 1 },
              provenance: {
                actorId: ids.actorA,
                membershipId: ids.membershipA,
                tenantId: ids.tenantA,
                stationId: ids.stationA,
                requestId: ids.rollbackRequest,
              },
            });
            await databaseOutboxPort.publish({ transaction, event, context });
            throw new Error('forced integration rollback');
          },
        ),
      ),
    ).rejects.toThrow('forced integration rollback');

    const after = await client<{ version: number }[]>`
      select version from app.meter_installations where id = ${ids.installationA}
    `;
    expect(after[0]?.version).toBe(before[0]?.version);
    expect(
      await client`select 1 from app.forecourt_idempotency_records where idempotency_key = 'integration-rollback-1'`,
    ).toEqual([]);
    expect(
      await client`select 1 from platform.security_events where id = ${ids.rollbackAudit}`,
    ).toEqual([]);
    expect(
      await client`select 1 from app.forecourt_outbox where event_id = ${ids.rollbackOutbox}`,
    ).toEqual([]);
  });

  it('replays a completed durable command once and rejects a different request hash', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    const context = productionContext(ids.replayRequest);
    let effectCount = 0;
    const request = {
      tenantId: ids.tenantA,
      commandType: 'SealSegment',
      idempotencyKey: 'integration-replay-1',
      requestHash: 'replay-hash-1',
    } as const;
    const effect = async (transaction: ForecourtTransaction) => {
      effectCount += 1;
      await transaction.execute(sql`
        update app.meter_installations
        set version = version + 1
        where tenant_id = ${ids.tenantA} and station_id = ${ids.stationA} and id = ${ids.installationA}
      `);
      const event = businessDayLockedEvent({
        eventId: ids.replayOutbox,
        tenantId: ids.tenantA,
        stationId: ids.stationA,
        businessDayId: ids.dayA,
        businessDate: '2026-09-20',
        lockedAt: '2026-09-20T23:10:00.000Z',
        legalEntityId: ids.legalA,
      });
      await databaseAuditPort.append({
        transaction,
        context,
        commandType: 'SealSegment',
        subjectType: 'MeterInstallation',
        subjectId: ids.installationA,
        provenance: {
          actorId: ids.actorA,
          membershipId: ids.membershipA,
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          requestId: ids.replayRequest,
        },
      });
      await databaseOutboxPort.publish({ transaction, event, context });
      return { segmentId: ids.segmentA };
    };

    const first = await databaseForecourtTransactionPort.run(context, (transaction) =>
      databaseIdempotencyPort.run(transaction, request, () => effect(transaction)),
    );
    const second = await databaseForecourtTransactionPort.run(context, (transaction) =>
      databaseIdempotencyPort.run(transaction, request, () => effect(transaction)),
    );
    expect(first).toEqual({ segmentId: ids.segmentA });
    expect(second).toEqual(first);
    expect(effectCount).toBe(1);

    await expect(
      databaseForecourtTransactionPort.run(context, (transaction) =>
        databaseIdempotencyPort.run(
          transaction,
          { ...request, requestHash: 'replay-hash-different' },
          () => effect(transaction),
        ),
      ),
    ).rejects.toThrow(/reused with a new request/);
    expect(effectCount).toBe(1);
    expect(
      await client`select count(*)::int as count from app.forecourt_outbox where event_id = ${ids.replayOutbox}`,
    ).toEqual([{ count: 1 }]);
    expect(
      await client`select count(*)::int as count from platform.security_events where request_id = ${ids.replayRequest}`,
    ).toEqual([{ count: 1 }]);
  });

  it('serializes concurrent installation updates and rejects the stale winner', async () => {
    const current = await client<{ version: number }[]>`
      select version from app.meter_installations where id = ${ids.installationA}
    `;
    const expectedVersion = current[0]?.version ?? 0;
    let releaseFirst!: () => void;
    let firstLocked!: () => void;
    const firstLockedPromise = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });
    const firstReleasePromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = raceClient.begin(async (transaction) => {
      await transaction`
        select id from app.meter_installations
        where tenant_id = ${ids.tenantA} and station_id = ${ids.stationA} and id = ${ids.installationA}
        for update
      `;
      firstLocked();
      await firstReleasePromise;
      const updated = await transaction`
        update app.meter_installations
        set version = version + 1
        where tenant_id = ${ids.tenantA} and station_id = ${ids.stationA}
          and id = ${ids.installationA} and version = ${expectedVersion}
        returning id
      `;
      return updated.length;
    });

    await firstLockedPromise;
    const second = raceClient.begin(async (transaction) => {
      await transaction`
        select id from app.meter_installations
        where tenant_id = ${ids.tenantA} and station_id = ${ids.stationA} and id = ${ids.installationA}
        for update
      `;
      const updated = await transaction`
        update app.meter_installations
        set version = version + 1
        where tenant_id = ${ids.tenantA} and station_id = ${ids.stationA}
          and id = ${ids.installationA} and version = ${expectedVersion}
        returning id
      `;
      return updated.length;
    });
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 0]);
    await client`
      update app.meter_installations set version = ${expectedVersion}
      where tenant_id = ${ids.tenantA} and station_id = ${ids.stationA} and id = ${ids.installationA}
    `;
  });
});
