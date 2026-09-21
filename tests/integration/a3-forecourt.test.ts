import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { makeSignature } from 'better-auth/crypto';
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
import {
  businessDayLockedEvent,
  meterSegmentSealedEvent,
} from '../../src/modules/forecourt/contracts';
import { litres, money, unitPrice } from '../../src/platform/domain/primitives';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';

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
  actorC: 'a3000000-0000-4000-8000-000000000033',
  actorD: 'a3000000-0000-4000-8000-000000000034',
  membershipA: 'a3000000-0000-4000-8000-000000000041',
  membershipB: 'a3000000-0000-4000-8000-000000000042',
  membershipC: 'a3000000-0000-4000-8000-000000000043',
  membershipD: 'a3000000-0000-4000-8000-000000000044',
  productA: 'a3000000-0000-4000-8000-000000000051',
  productB: 'a3000000-0000-4000-8000-000000000052',
  productC: 'a3000000-0000-4000-8000-000000000053',
  pumpA: 'a3000000-0000-4000-8000-000000000061',
  pumpB: 'a3000000-0000-4000-8000-000000000062',
  nozzleA: 'a3000000-0000-4000-8000-000000000071',
  nozzleB: 'a3000000-0000-4000-8000-000000000072',
  meterA: 'a3000000-0000-4000-8000-000000000081',
  meterB: 'a3000000-0000-4000-8000-000000000082',
  installationA: 'a3000000-0000-4000-8000-000000000091',
  installationB: 'a3000000-0000-4000-8000-000000000092',
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
  routeSession: 'a3000000-0000-4000-8000-000000000179',
  negativeSession: 'a3000000-0000-4000-8000-000000000180',
  routeOpening: 'a3000000-0000-4000-8000-000000000181',
  routeClosing: 'a3000000-0000-4000-8000-000000000182',
  routeSegment: 'a3000000-0000-4000-8000-000000000183',
  routeDay: 'a3000000-0000-4000-8000-000000000187',
  routeShift: 'a3000000-0000-4000-8000-000000000188',
  closureDay: 'a3000000-0000-4000-8000-000000000190',
  closurePrice: 'a3000000-0000-4000-8000-000000000191',
  closureReconciliation: 'a3000000-0000-4000-8000-000000000192',
  closureRevision: 'a3000000-0000-4000-8000-000000000193',
  correctionSegment: 'a3000000-0000-4000-8000-000000000194',
  correctionReconciliation: 'a3000000-0000-4000-8000-000000000195',
  correctionRevision: 'a3000000-0000-4000-8000-000000000196',
  correctionOutbox: 'a3000000-0000-4000-8000-000000000197',
  correctionOpening: 'a3000000-0000-4000-8000-000000000205',
  correctionClosing: 'a3000000-0000-4000-8000-000000000206',
  bypassOpening: 'a3000000-0000-4000-8000-000000000215',
  bypassClosing: 'a3000000-0000-4000-8000-000000000216',
  bypassSegment: 'a3000000-0000-4000-8000-000000000217',
  auditFailurePrice: 'a3000000-0000-4000-8000-000000000218',
  outboxFailurePrice: 'a3000000-0000-4000-8000-000000000219',
  routeRacePrice: 'a3000000-0000-4000-8000-000000000220',
  negativePrice: 'a3000000-0000-4000-8000-000000000221',
  forgedBoundaryPrice: 'a3000000-0000-4000-8000-000000000222',
  routeRaceOpening: 'a3000000-0000-4000-8000-000000000223',
  routeRaceClosing: 'a3000000-0000-4000-8000-000000000224',
  routeRaceSegment: 'a3000000-0000-4000-8000-000000000225',
  commandRaceDay: 'a3000000-0000-4000-8000-000000000226',
  commandRaceReconciliation: 'a3000000-0000-4000-8000-000000000227',
  commandRaceRevision: 'a3000000-0000-4000-8000-000000000228',
  raceSegment: 'a3000000-0000-4000-8000-000000000198',
  racePrice: 'a3000000-0000-4000-8000-000000000199',
  raceReconciliation: 'a3000000-0000-4000-8000-000000000200',
  raceRevision: 'a3000000-0000-4000-8000-000000000201',
  raceDay: 'a3000000-0000-4000-8000-000000000202',
  raceShift: 'a3000000-0000-4000-8000-000000000207',
  raceOpening: 'a3000000-0000-4000-8000-000000000208',
  raceClosing: 'a3000000-0000-4000-8000-000000000209',
  handoverA: 'a3000000-0000-4000-8000-000000000210',
  handoverB: 'a3000000-0000-4000-8000-000000000211',
  closureShift: 'a3000000-0000-4000-8000-000000000212',
  closureBoundary: 'a3000000-0000-4000-8000-000000000213',
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
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    client = postgres(databaseUrl, { max: 1, prepare: false });
    raceClient = postgres(databaseUrl, { max: 2, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenantA}', 'A3 Tenant A', 'a3-tenant-a'),
        ('${ids.tenantB}', 'A3 Tenant B', 'a3-tenant-b') on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.actorA}', 'A3 Actor A', 'a3-actor-a@example.test'),
        ('${ids.actorB}', 'A3 Actor B', 'a3-actor-b@example.test'),
        ('${ids.actorC}', 'A3 Actor C', 'a3-actor-c@example.test'),
        ('${ids.actorD}', 'A3 Actor D', 'a3-actor-d@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membershipA}', '${ids.tenantA}', '${ids.actorA}', 'ACTIVE'),
        ('${ids.membershipB}', '${ids.tenantB}', '${ids.actorB}', 'ACTIVE'),
        ('${ids.membershipC}', '${ids.tenantA}', '${ids.actorC}', 'ACTIVE'),
        ('${ids.membershipD}', '${ids.tenantA}', '${ids.actorD}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legalA}', '${ids.tenantA}', 'A3 Legal A'),
        ('${ids.legalA2}', '${ids.tenantA}', 'A3 Legal A2'),
        ('${ids.legalB}', '${ids.tenantB}', 'A3 Legal B') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.stationA}', '${ids.tenantA}', '${ids.legalA}', 'A3A', 'A3 Station A', 'ACTIVE'),
        ('${ids.stationA2}', '${ids.tenantA}', '${ids.legalA2}', 'A3A2', 'A3 Station A2', 'ACTIVE'),
        ('${ids.stationB}', '${ids.tenantB}', '${ids.legalB}', 'A3B', 'A3 Station B', 'ACTIVE') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values
          ('${ids.tenantA}', '${ids.membershipA}', 'SUPERVISOR', 'STATION', '${ids.legalA}', '${ids.stationA}'),
          ('${ids.tenantA}', '${ids.membershipA}', 'ATTENDANT', 'STATION', '${ids.legalA}', '${ids.stationA}'),
          ('${ids.tenantA}', '${ids.membershipA}', 'ADMINISTRATOR', 'STATION', '${ids.legalA}', '${ids.stationA}')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values ('${ids.tenantA}', '${ids.membershipD}', 'ATTENDANT', 'STATION', '${ids.legalA}', '${ids.stationA}')
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.productC}', '${ids.tenantA}', 'A3-TEST-PRODUCT', 'Test Product')
        on conflict (id) do nothing;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values ('${ids.routeSession}', '2030-01-01T00:00:00Z', 'a3-route-session-token', '${ids.actorA}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values ('${ids.negativeSession}', '2030-01-01T00:00:00Z', 'a3-negative-session-token', '${ids.actorD}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
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
        insert into app.meter_boundaries (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
          values
            ('${ids.bypassOpening}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', 'CORRECTION', 'AVAILABLE', 1020.000, '2026-09-20T15:00:00Z', '2026-09-20T15:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}'),
            ('${ids.bypassClosing}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', 'CORRECTION', 'AVAILABLE', 1021.000, '2026-09-20T16:00:00Z', '2026-09-20T16:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}');
        insert into app.meter_segments (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, expected_sale_value, boundary_reason, segment_start_at, segment_end_at, sealed_at)
          values ('${ids.segmentA}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', '${ids.openingA}', '${ids.closingA}', '${ids.productA}', '${ids.membershipA}', '${ids.membershipA}', 1000.000, 1010.125, 10.125, 1.500000, 15.1875, 'SHIFT_CLOSE', '2026-09-20T06:00:00Z', '2026-09-20T14:00:00Z', '2026-09-20T14:00:01Z');
        insert into app.meter_segments (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, expected_sale_value, boundary_reason, segment_start_at, segment_end_at, sealed_at)
          values ('${ids.bypassSegment}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', '${ids.bypassOpening}', '${ids.bypassClosing}', '${ids.productA}', '${ids.membershipA}', '${ids.membershipA}', 1020.000, 1021.000, 1.000, 1.500000, 1.5000, 'CORRECTION', '2026-09-20T15:00:00Z', '2026-09-20T16:00:00Z', '2026-09-20T16:00:01Z');
        select app.seal_meter_segment('${ids.tenantA}', '${ids.stationA}', '${ids.segmentA}', 0);
      `);

      const visible = await client<{ id: string }[]>`select id from app.meter_segments`;
      expect(visible.map((row) => row.id)).toEqual([ids.segmentA, ids.bypassSegment]);
      await setContext(ids.tenantB, ids.actorB, ids.membershipB);
      expect(await client`select id from app.meter_segments`).toEqual([]);
      await setContext(ids.tenantA, ids.actorA, ids.membershipA);
      await expect(
        client.unsafe(
          `update app.meter_segments set state = 'SEALED', version = 1 where id = '${ids.bypassSegment}'`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        client<
          {
            can_update: boolean;
            can_execute: boolean;
          }[]
        >`select
          has_table_privilege('app_runtime', 'app.meter_segments', 'UPDATE') as can_update,
          has_function_privilege('app_runtime', 'app.seal_meter_segment(uuid,uuid,uuid,integer)', 'EXECUTE') as can_execute`,
      ).resolves.toEqual([{ can_update: false, can_execute: true }]);
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
      await expect(
        client.unsafe(`
          insert into app.meter_segments (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, expected_sale_value, boundary_reason, segment_start_at, segment_end_at, sealed_at, state)
          values ('a3000000-0000-4000-8000-000000000132', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', '${ids.openingA}', '${ids.closingA}', '${ids.productA}', '${ids.membershipA}', '${ids.membershipA}', 1000.000, 1010.125, 10.125, 1.500000, 15.1875, 'SHIFT_CLOSE', '2026-09-20T06:00:00Z', '2026-09-20T14:00:00Z', '2026-09-20T14:00:01Z', 'SEALED')
        `),
      ).rejects.toThrow(/OPEN/);
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

  it('rolls back when the real A1 audit persistence fails', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    const context = productionContext('a3000000-0000-4000-8000-000000000184');
    const before = await client<
      { version: number }[]
    >`select version from app.meter_installations where id = ${ids.installationA}`;
    await client.unsafe(`
      create or replace function public.a3_fail_audit() returns trigger language plpgsql as $$
      begin raise exception 'test audit persistence failure'; end; $$;
      drop trigger if exists a3_fail_audit_trigger on platform.security_events;
      create trigger a3_fail_audit_trigger before insert on platform.security_events for each row execute function public.a3_fail_audit();
    `);
    try {
      await expect(
        databaseForecourtTransactionPort.run(context, async (transaction) =>
          databaseIdempotencyPort.run(
            transaction,
            {
              tenantId: ids.tenantA,
              commandType: 'SealSegment',
              idempotencyKey: 'a3-audit-fail-1',
              requestHash: 'a3-audit-fail-hash',
            },
            async () => {
              await transaction.execute(
                sql`update app.meter_installations set version = version + 1 where id = ${ids.installationA}`,
              );
              await databaseAuditPort.append({
                transaction,
                context,
                commandType: 'SealSegment',
                subjectType: 'MeterSegment',
                subjectId: ids.segmentA,
                provenance: {
                  actorId: ids.actorA,
                  membershipId: ids.membershipA,
                  tenantId: ids.tenantA,
                  stationId: ids.stationA,
                  requestId: context.requestId,
                },
              });
              return { ok: true };
            },
          ),
        ),
      ).rejects.toThrow(/Failed query/);
    } finally {
      await client.unsafe(
        'drop trigger if exists a3_fail_audit_trigger on platform.security_events; drop function if exists public.a3_fail_audit();',
      );
    }
    const after = await client<
      { version: number }[]
    >`select version from app.meter_installations where id = ${ids.installationA}`;
    expect(after[0]?.version).toBe(before[0]?.version);
    expect(
      await client`select 1 from app.forecourt_idempotency_records where idempotency_key = 'a3-audit-fail-1'`,
    ).toEqual([]);
  });

  it('rolls back when the real outbox persistence fails', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    const context = productionContext('a3000000-0000-4000-8000-000000000185');
    const before = await client<
      { version: number }[]
    >`select version from app.meter_installations where id = ${ids.installationA}`;
    await client.unsafe(`
      create or replace function public.a3_fail_outbox() returns trigger language plpgsql as $$
      begin raise exception 'test outbox persistence failure'; end; $$;
      drop trigger if exists a3_fail_outbox_trigger on app.forecourt_outbox;
      create trigger a3_fail_outbox_trigger before insert on app.forecourt_outbox for each row execute function public.a3_fail_outbox();
    `);
    try {
      await expect(
        databaseForecourtTransactionPort.run(context, async (transaction) =>
          databaseIdempotencyPort.run(
            transaction,
            {
              tenantId: ids.tenantA,
              commandType: 'SealSegment',
              idempotencyKey: 'a3-outbox-fail-1',
              requestHash: 'a3-outbox-fail-hash',
            },
            async () => {
              await transaction.execute(
                sql`update app.meter_installations set version = version + 1 where id = ${ids.installationA}`,
              );
              const event = businessDayLockedEvent({
                eventId: 'a3000000-0000-4000-8000-000000000186',
                tenantId: ids.tenantA,
                stationId: ids.stationA,
                businessDayId: ids.dayA,
                businessDate: '2026-09-20',
                lockedAt: '2026-09-20T23:00:00Z',
                legalEntityId: ids.legalA,
              });
              await databaseAuditPort.append({
                transaction,
                context,
                commandType: 'SealSegment',
                subjectType: 'MeterSegment',
                subjectId: ids.segmentA,
                provenance: {
                  actorId: ids.actorA,
                  membershipId: ids.membershipA,
                  tenantId: ids.tenantA,
                  stationId: ids.stationA,
                  requestId: context.requestId,
                },
              });
              await databaseOutboxPort.publish({ transaction, event, context });
              return { ok: true };
            },
          ),
        ),
      ).rejects.toThrow(/Failed query/);
    } finally {
      await client.unsafe(
        'drop trigger if exists a3_fail_outbox_trigger on app.forecourt_outbox; drop function if exists public.a3_fail_outbox();',
      );
    }
    const after = await client<
      { version: number }[]
    >`select version from app.meter_installations where id = ${ids.installationA}`;
    expect(after[0]?.version).toBe(before[0]?.version);
    expect(
      await client`select 1 from app.forecourt_idempotency_records where idempotency_key = 'a3-outbox-fail-1'`,
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

  it('executes SealSegment through the real authenticated route with the segment subject id', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    await client.unsafe(
      `update app.meter_installations set version = 1 where id = '${ids.installationA}'`,
    );
    await client.unsafe(`
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.routeDay}', '${ids.tenantA}', '${ids.stationA}', '2026-09-21', 'NOT_STARTED');
      update app.station_business_days set state = 'OPEN' where id = '${ids.routeDay}';
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
        values ('${ids.routeShift}', '${ids.tenantA}', '${ids.stationA}', '${ids.routeDay}', 'PLANNED', '2026-09-21T06:00:00Z', '2026-09-21T14:00:00Z', '2026-09-21');
      update app.shifts set state = 'OPEN' where id = '${ids.routeShift}';
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${ids.routeOpening}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.routeDay}', '${ids.routeShift}', 'PRICE_CHANGE', 'AVAILABLE', 1010.125, '2026-09-21T06:00:00Z', '2026-09-21T06:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}'),
        ('${ids.routeClosing}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.routeDay}', '${ids.routeShift}', 'SHIFT_CLOSE', 'AVAILABLE', 1012.125, '2026-09-21T07:00:00Z', '2026-09-21T07:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}')
    `);
    const rawToken = 'a3-route-session-token';
    const signedToken = `${rawToken}.${await makeSignature(rawToken, process.env.BETTER_AUTH_SECRET!)}`;
    const sealInput = {
      commandType: 'SealSegment',
      tenantId: ids.tenantA,
      stationId: ids.stationA,
      segmentId: ids.routeSegment,
      nozzleId: ids.nozzleA,
      meterInstallationId: ids.installationA,
      businessDayId: ids.routeDay,
      shiftId: ids.routeShift,
      openingBoundaryId: ids.routeOpening,
      closingBoundaryId: ids.routeClosing,
      productId: ids.productA,
      responsibleAttendantId: ids.membershipA,
      startAt: '2026-09-21T06:00:00.000Z',
      endAt: '2026-09-21T07:00:00.000Z',
      expectedVersion: 0,
    };
    const response = await forecourtCommandPost(
      new Request('http://127.0.0.1:3000/api/forecourt/commands', {
        method: 'POST',
        headers: {
          cookie: `shanda-fuel.session_token=${signedToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'a3-real-route-seal-1',
        },
        body: JSON.stringify(sealInput),
      }),
    );
    if (response.status !== 201) {
      throw new Error(`SealSegment route failed: ${await response.clone().text()}`);
    }
    const invalidAttendant = await forecourtCommandPost(
      new Request('http://127.0.0.1:3000/api/forecourt/commands', {
        method: 'POST',
        headers: {
          cookie: `shanda-fuel.session_token=${signedToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'a3-real-route-invalid-attendant',
        },
        body: JSON.stringify({
          ...sealInput,
          segmentId: 'a3000000-0000-4000-8000-000000000189',
          responsibleAttendantId: ids.membershipB,
        }),
      }),
    );
    expect(invalidAttendant.status).toBe(403);
    expect(
      await client`select 1 from app.meter_segments where id = 'a3000000-0000-4000-8000-000000000189'`,
    ).toEqual([]);
    const replay = await forecourtCommandPost(
      new Request('http://127.0.0.1:3000/api/forecourt/commands', {
        method: 'POST',
        headers: {
          cookie: `shanda-fuel.session_token=${signedToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'a3-real-route-seal-1',
        },
        body: JSON.stringify(sealInput),
      }),
    );
    expect(replay.status).toBe(201);
    const conflict = await forecourtCommandPost(
      new Request('http://127.0.0.1:3000/api/forecourt/commands', {
        method: 'POST',
        headers: {
          cookie: `shanda-fuel.session_token=${signedToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'a3-real-route-seal-1',
        },
        body: JSON.stringify({ ...sealInput, endAt: '2026-09-21T07:30:00.000Z' }),
      }),
    );
    expect(conflict.status).toBe(409);
    const segment = await client<{ id: string; state: string; version: number }[]>`
      select id, state, version from app.meter_segments where id = ${ids.routeSegment}
    `;
    expect(segment).toEqual([{ id: ids.routeSegment, state: 'SEALED', version: 1 }]);
    const audit = await client<{ subject_id: string }[]>`
      select details->>'subjectId' as subject_id from platform.security_events
      where event_code = 'FORECOURT.SealSegment' and details->>'subjectId' = ${ids.routeSegment}
    `;
    expect(audit).toHaveLength(1);
  });

  it('executes price, reconciliation, and business-day commands through the authenticated route', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    const rawToken = 'a3-route-session-token';
    const signedToken = `${rawToken}.${await makeSignature(rawToken, process.env.BETTER_AUTH_SECRET!)}`;

    await client.unsafe(`
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.productB}', '${ids.tenantA}', 'A3-GASOLINE', 'Gasoline');
      insert into app.pumps (id, tenant_id, station_id, number)
        values ('${ids.pumpB}', '${ids.tenantA}', '${ids.stationA}', '2');
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id)
        values ('${ids.nozzleB}', '${ids.tenantA}', '${ids.stationA}', '${ids.pumpB}', '1', '${ids.productB}');
      insert into app.meters (id, tenant_id, serial_number)
        values ('${ids.meterB}', '${ids.tenantA}', 'A3-METER-2');
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values ('${ids.installationB}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleB}', '${ids.meterB}', '2026-09-20T00:00:00Z', '${ids.membershipA}');
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.closureDay}', '${ids.tenantA}', '${ids.stationA}', '2026-09-22', 'NOT_STARTED');
      update app.station_business_days set state = 'OPEN' where id = '${ids.closureDay}';
      update app.station_business_days set state = 'OPERATIONS_COMPLETE' where id = '${ids.closureDay}';
      update app.station_business_days set state = 'CLOSED' where id = '${ids.closureDay}';
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.closureShift}', '${ids.tenantA}', '${ids.stationA}', '${ids.closureDay}', 'PLANNED', '2026-09-22T06:00:00Z', '2026-09-22T14:00:00Z', '2026-09-22');
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason,
         reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${ids.closureBoundary}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleB}', '${ids.installationB}', '${ids.closureDay}', '${ids.closureShift}', 'PRICE_CHANGE',
         'AVAILABLE', 3000.000, '2026-09-22T06:00:00Z', '2026-09-22T06:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}');
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, effective_to, unit_price, state, requested_by)
      values
        ('${ids.closurePrice}', '${ids.tenantA}', '${ids.stationA}', '${ids.productB}', '2026-09-22T00:00:00Z', '2026-09-23T00:00:00Z', 1.800000, 'DRAFT', '${ids.membershipC}');
      update app.selling_prices set state = 'PENDING_APPROVAL' where id = '${ids.closurePrice}';
      insert into app.reconciliations
        (id, tenant_id, station_id, business_day_id, state)
      values
        ('${ids.closureReconciliation}', '${ids.tenantA}', '${ids.stationA}', '${ids.closureDay}', 'DRAFT');
      insert into app.reconciliation_revisions
        (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance, variance_classification, declarations, source_segment_ids, source_shift_ids)
      values
        ('${ids.closureRevision}', '${ids.tenantA}', '${ids.stationA}', '${ids.closureReconciliation}', 1, 'READY', 0, 0, 0, 'INFORMATIONAL', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
      update app.reconciliation_revisions set state = 'SUBMITTED' where id = '${ids.closureRevision}';
      update app.reconciliation_revisions set state = 'PENDING_APPROVAL' where id = '${ids.closureRevision}';
    `);

    async function postCommand(input: Record<string, unknown>, key: string) {
      return forecourtCommandPost(
        new Request('http://127.0.0.1:3000/api/forecourt/commands', {
          method: 'POST',
          headers: {
            cookie: `shanda-fuel.session_token=${signedToken}`,
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify(input),
        }),
      );
    }

    expect(
      (
        await postCommand(
          {
            commandType: 'ApprovePriceChange',
            tenantId: ids.tenantA,
            stationId: ids.stationA,
            priceId: ids.closurePrice,
            expectedVersion: 0,
          },
          'a3-route-price-approve-1',
        )
      ).status,
    ).toBe(200);

    await client.unsafe(
      `update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id = '${ids.closurePrice}'`,
    );
    expect(
      (
        await postCommand(
          {
            commandType: 'ActivatePriceChange',
            tenantId: ids.tenantA,
            stationId: ids.stationA,
            priceId: ids.closurePrice,
            expectedVersion: 1,
          },
          'a3-route-price-activate-1',
        )
      ).status,
    ).toBe(200);

    expect(
      (
        await postCommand(
          {
            commandType: 'ApproveReconciliation',
            tenantId: ids.tenantA,
            stationId: ids.stationA,
            revisionId: ids.closureRevision,
            expectedVersion: 0,
          },
          'a3-route-reconciliation-approve-1',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postCommand(
          {
            commandType: 'PostReconciliation',
            tenantId: ids.tenantA,
            stationId: ids.stationA,
            revisionId: ids.closureRevision,
            expectedVersion: 1,
          },
          'a3-route-reconciliation-post-1',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postCommand(
          {
            commandType: 'LockReconciliation',
            tenantId: ids.tenantA,
            stationId: ids.stationA,
            revisionId: ids.closureRevision,
            expectedVersion: 2,
          },
          'a3-route-reconciliation-lock-1',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await postCommand(
          {
            commandType: 'LockBusinessDay',
            tenantId: ids.tenantA,
            stationId: ids.stationA,
            businessDayId: ids.closureDay,
            expectedVersion: 0,
          },
          'a3-route-business-day-lock-1',
        )
      ).status,
    ).toBe(200);

    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.selling_prices where id = ${ids.closurePrice}
      `,
    ).resolves.toEqual([{ state: 'ACTIVE', version: 3 }]);
    await expect(
      client<
        {
          state: string;
          version: number;
          approved_by: string;
          posted_by: string;
          locked_by: string;
        }[]
      >`
        select state, version, approved_by, posted_by, locked_by
        from app.reconciliation_revisions where id = ${ids.closureRevision}
      `,
    ).resolves.toEqual([
      {
        state: 'LOCKED',
        version: 3,
        approved_by: ids.membershipA,
        posted_by: ids.membershipA,
        locked_by: ids.membershipA,
      },
    ]);
    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.station_business_days where id = ${ids.closureDay}
      `,
    ).resolves.toEqual([{ state: 'LOCKED', version: 1 }]);
    const eventTypes = await client<{ event_type: string }[]>`
      select event_type from app.forecourt_outbox
      where tenant_id = ${ids.tenantA} and station_id = ${ids.stationA}
        and event_id in (
          select event_id from app.forecourt_outbox
          where aggregate_id in (${ids.closurePrice}, ${ids.closureReconciliation}, ${ids.closureDay})
        )
      order by created_at
    `;
    expect(eventTypes.map((row) => row.event_type).sort()).toEqual(
      [
        'forecourt.price_boundary_activated.v1',
        'reconciliation.approved.v1',
        'reconciliation.posted.v1',
        'forecourt.business_day_locked.v1',
      ].sort(),
    );
  });

  it('rolls back failed production audit and outbox writes and permits a clean idempotent retry', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    const rawToken = 'a3-route-session-token';
    const signedToken = `${rawToken}.${await makeSignature(rawToken, process.env.BETTER_AUTH_SECRET!)}`;
    async function postCommand(input: Record<string, unknown>, key: string) {
      return forecourtCommandPost(
        new Request('http://127.0.0.1:3000/api/forecourt/commands', {
          method: 'POST',
          headers: {
            cookie: `shanda-fuel.session_token=${signedToken}`,
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify(input),
        }),
      );
    }

    await client.unsafe(`
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, effective_to, unit_price, state, requested_by)
      values
        ('${ids.auditFailurePrice}', '${ids.tenantA}', '${ids.stationA}', '${ids.productB}', '2026-09-23T00:00:00Z', '2026-09-24T00:00:00Z', 1.810000, 'DRAFT', '${ids.membershipC}'),
        ('${ids.outboxFailurePrice}', '${ids.tenantA}', '${ids.stationA}', '${ids.productB}', '2026-09-24T00:00:00Z', '2026-09-25T00:00:00Z', 1.820000, 'DRAFT', '${ids.membershipC}');
      update app.selling_prices
      set state = 'PENDING_APPROVAL'
      where id in ('${ids.auditFailurePrice}', '${ids.outboxFailurePrice}');
    `);

    await client.unsafe(`
      create or replace function public.a3_fail_audit() returns trigger
      language plpgsql as $$ begin raise exception 'forced A3 audit failure'; end; $$;
      create trigger a3_fail_audit before insert on platform.security_events
      for each row execute function public.a3_fail_audit();
    `);
    try {
      const failedAudit = await postCommand(
        {
          commandType: 'ApprovePriceChange',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          priceId: ids.auditFailurePrice,
          expectedVersion: 0,
        },
        'a3-route-audit-failure',
      );
      expect(failedAudit.status).toBe(500);
    } finally {
      await client.unsafe('drop trigger if exists a3_fail_audit on platform.security_events');
    }
    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.selling_prices where id = ${ids.auditFailurePrice}
      `,
    ).resolves.toEqual([{ state: 'PENDING_APPROVAL', version: 0 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from app.forecourt_idempotency_records
        where command_type = 'ApprovePriceChange' and idempotency_key = 'a3-route-audit-failure'
      `,
    ).resolves.toEqual([{ count: 0 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from platform.security_events
        where event_code = 'FORECOURT.ApprovePriceChange'
          and details->>'subjectId' = ${ids.auditFailurePrice}
      `,
    ).resolves.toEqual([{ count: 0 }]);

    expect(
      (
        await postCommand(
          {
            commandType: 'ApprovePriceChange',
            tenantId: ids.tenantA,
            stationId: ids.stationA,
            priceId: ids.outboxFailurePrice,
            expectedVersion: 0,
          },
          'a3-route-outbox-prepare',
        )
      ).status,
    ).toBe(200);
    await client.unsafe(
      `update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id = '${ids.outboxFailurePrice}'`,
    );
    await client.unsafe(`
      create or replace function public.a3_fail_outbox() returns trigger
      language plpgsql as $$ begin raise exception 'forced A3 outbox failure'; end; $$;
      create trigger a3_fail_outbox before insert on app.forecourt_outbox
      for each row execute function public.a3_fail_outbox();
    `);
    try {
      const failedOutbox = await postCommand(
        {
          commandType: 'ActivatePriceChange',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          priceId: ids.outboxFailurePrice,
          expectedVersion: 1,
        },
        'a3-route-outbox-failure',
      );
      expect(failedOutbox.status).toBe(500);
    } finally {
      await client.unsafe('drop trigger if exists a3_fail_outbox on app.forecourt_outbox');
    }
    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.selling_prices where id = ${ids.outboxFailurePrice}
      `,
    ).resolves.toEqual([{ state: 'PENDING_STATION_ACTIVATION', version: 1 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from app.forecourt_idempotency_records
        where command_type = 'ActivatePriceChange' and idempotency_key = 'a3-route-outbox-failure'
      `,
    ).resolves.toEqual([{ count: 0 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from platform.security_events
        where event_code = 'FORECOURT.ActivatePriceChange'
          and details->>'subjectId' = ${ids.outboxFailurePrice}
      `,
    ).resolves.toEqual([{ count: 0 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from app.forecourt_outbox
        where aggregate_id = ${ids.outboxFailurePrice}
      `,
    ).resolves.toEqual([{ count: 0 }]);

    expect(
      (
        await postCommand(
          {
            commandType: 'ActivatePriceChange',
            tenantId: ids.tenantA,
            stationId: ids.stationA,
            priceId: ids.outboxFailurePrice,
            expectedVersion: 1,
          },
          'a3-route-outbox-failure',
        )
      ).status,
    ).toBe(200);
    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.selling_prices where id = ${ids.outboxFailurePrice}
      `,
    ).resolves.toEqual([{ state: 'ACTIVE', version: 3 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from platform.security_events
        where event_code = 'FORECOURT.ActivatePriceChange'
          and details->>'subjectId' = ${ids.outboxFailurePrice}
      `,
    ).resolves.toEqual([{ count: 1 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from app.forecourt_outbox
        where aggregate_id = ${ids.outboxFailurePrice}
      `,
    ).resolves.toEqual([{ count: 1 }]);
    await expect(
      client<{ status: string }[]>`
        select status from app.forecourt_idempotency_records
        where command_type = 'ActivatePriceChange' and idempotency_key = 'a3-route-outbox-failure'
      `,
    ).resolves.toEqual([{ status: 'COMPLETED' }]);
  });

  it('rejects price-route permission, assurance, station, version, provenance, and boundary forgeries', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    const actorRawToken = 'a3-route-session-token';
    const actorToken = `${actorRawToken}.${await makeSignature(actorRawToken, process.env.BETTER_AUTH_SECRET!)}`;
    const attendantRawToken = 'a3-negative-session-token';
    const attendantToken = `${attendantRawToken}.${await makeSignature(attendantRawToken, process.env.BETTER_AUTH_SECRET!)}`;
    async function postWithToken(token: string, input: Record<string, unknown>, key: string) {
      return forecourtCommandPost(
        new Request('http://127.0.0.1:3000/api/forecourt/commands', {
          method: 'POST',
          headers: {
            cookie: `shanda-fuel.session_token=${token}`,
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify(input),
        }),
      );
    }
    await client.unsafe(`
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, effective_to, unit_price, state, requested_by)
      values
        ('${ids.negativePrice}', '${ids.tenantA}', '${ids.stationA}', '${ids.productC}', '2026-09-26T00:00:00Z', '2026-09-27T00:00:00Z', 1.910000, 'DRAFT', '${ids.membershipD}'),
        ('${ids.forgedBoundaryPrice}', '${ids.tenantA}', '${ids.stationA}', '${ids.productC}', '2026-09-27T00:00:00Z', '2026-09-28T00:00:00Z', 1.920000, 'DRAFT', '${ids.membershipD}');
      update app.selling_prices set state = 'PENDING_APPROVAL'
      where id in ('${ids.negativePrice}', '${ids.forgedBoundaryPrice}');
    `);

    const priceInput = {
      commandType: 'ApprovePriceChange',
      tenantId: ids.tenantA,
      stationId: ids.stationA,
      priceId: ids.negativePrice,
      expectedVersion: 0,
    };
    expect((await postWithToken(attendantToken, priceInput, 'a3-price-no-permission')).status).toBe(
      403,
    );

    await client.unsafe(
      `update auth.session set strong_authentication_verified = false where id = '${ids.routeSession}'`,
    );
    try {
      expect((await postWithToken(actorToken, priceInput, 'a3-price-weak-assurance')).status).toBe(
        403,
      );
    } finally {
      await client.unsafe(
        `update auth.session set strong_authentication_verified = true where id = '${ids.routeSession}'`,
      );
    }

    expect(
      (
        await postWithToken(
          actorToken,
          { ...priceInput, stationId: ids.stationB },
          'a3-price-wrong-station',
        )
      ).status,
    ).toBe(404);
    expect(
      (await postWithToken(actorToken, { ...priceInput, expectedVersion: 99 }, 'a3-price-stale'))
        .status,
    ).toBe(409);
    expect(
      (
        await postWithToken(
          actorToken,
          { ...priceInput, approvedBy: ids.membershipD },
          'a3-price-actor-injection',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await postWithToken(
          actorToken,
          { ...priceInput, approvedAt: '2026-09-21T00:00:00.000Z' },
          'a3-price-timestamp-injection',
        )
      ).status,
    ).toBe(400);

    expect((await postWithToken(actorToken, priceInput, 'a3-price-negative-control')).status).toBe(
      200,
    );
    expect(
      (
        await postWithToken(
          actorToken,
          { ...priceInput, priceId: ids.forgedBoundaryPrice },
          'a3-price-forged-approve',
        )
      ).status,
    ).toBe(200);
    await client.unsafe(
      `update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id = '${ids.forgedBoundaryPrice}'`,
    );
    const forged = await postWithToken(
      actorToken,
      {
        commandType: 'ActivatePriceChange',
        tenantId: ids.tenantA,
        stationId: ids.stationA,
        priceId: ids.forgedBoundaryPrice,
        expectedVersion: 1,
      },
      'a3-price-forged-boundary',
    );
    expect(forged.status).toBe(409);
    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.selling_prices where id = ${ids.forgedBoundaryPrice}
      `,
    ).resolves.toEqual([{ state: 'PENDING_STATION_ACTIVATION', version: 1 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from app.forecourt_idempotency_records
        where command_type = 'ActivatePriceChange' and idempotency_key = 'a3-price-forged-boundary'
      `,
    ).resolves.toEqual([{ count: 0 }]);
  });

  it('persists correction and reversal lineage and carries it into the outbox snapshot', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    await client.unsafe(`
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason,
         reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${ids.correctionOpening}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', 'CORRECTION',
         'AVAILABLE', 1010.000, '2026-09-20T14:00:00Z', '2026-09-20T14:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}'),
        ('${ids.correctionClosing}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', 'CORRECTION',
         'AVAILABLE', 1015.000, '2026-09-20T15:00:00Z', '2026-09-20T15:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}');
      insert into app.meter_segments
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
         opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by,
         opening_reading, closing_reading, litres, unit_price, expected_sale_value, boundary_reason,
         segment_start_at, segment_end_at, sealed_at, state, correction_of_segment_id)
      values
        ('${ids.correctionSegment}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}',
         '${ids.correctionOpening}', '${ids.correctionClosing}', '${ids.productA}', '${ids.membershipA}', '${ids.membershipA}',
         1010.000, 1015.000, 5.000, 1.500000, 7.5000, 'CORRECTION',
         '2026-09-20T14:00:00Z', '2026-09-20T15:00:00Z', '2026-09-20T15:00:01Z', 'OPEN', '${ids.segmentA}');
      insert into app.reconciliation_revisions
        (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance,
         variance_classification, declarations, source_segment_ids, source_shift_ids, source_revision_id, correction_of_revision_id)
      values
        ('${ids.correctionRevision}', '${ids.tenantA}', '${ids.stationA}', '${ids.reconciliationA}', 2, 'READY', 15, 15, 0,
         'INFORMATIONAL', '[]'::jsonb, '["${ids.correctionSegment}"]'::jsonb, '["${ids.shiftA}"]'::jsonb, '${ids.revisionA}', '${ids.revisionA}');
      update app.meter_segments set state = 'SEALED', version = 1 where id = '${ids.correctionSegment}';
    `);

    const context = productionContext('a3000000-0000-4000-8000-000000000203');
    const event = meterSegmentSealedEvent(
      ids.correctionOutbox,
      {
        id: ids.correctionSegment,
        tenantId: ids.tenantA,
        stationId: ids.stationA,
        nozzleId: ids.nozzleA,
        meterInstallationId: ids.installationA,
        meterId: ids.meterA,
        businessDayId: ids.dayA,
        shiftId: ids.shiftA,
        openingBoundaryId: ids.correctionOpening,
        closingBoundaryId: ids.correctionClosing,
        productId: ids.productA,
        attendantId: ids.membershipA,
        enteredBy: ids.membershipA,
        openingReading: '1010.000',
        closingReading: '1015.000',
        litres: litres('5.000'),
        unitPrice: unitPrice('1.500000'),
        currency: 'USD',
        expectedSaleValue: money('7.5000', 'USD'),
        openingBoundaryReason: 'CORRECTION',
        boundaryReason: 'CORRECTION',
        startAt: '2026-09-20T14:00:00.000Z',
        endAt: '2026-09-20T15:00:00.000Z',
        sealedAt: '2026-09-20T15:00:01.000Z',
        controlledException: false,
        correctionOfSegmentId: ids.segmentA,
        version: 1,
      },
      { legalEntityId: ids.legalA, businessDate: '2026-09-20' },
    );
    await databaseForecourtTransactionPort.run(context, (transaction) =>
      databaseOutboxPort.publish({ transaction, event, context }),
    );

    const persisted = await client<
      {
        correction_of_segment_id: string;
        state: string;
        version: number;
      }[]
    >`
      select correction_of_segment_id, state, version
      from app.meter_segments where id = ${ids.correctionSegment}
    `;
    expect(persisted).toEqual([
      { correction_of_segment_id: ids.segmentA, state: 'SEALED', version: 1 },
    ]);
    const revisionLineage = await client<
      {
        source_revision_id: string;
        correction_of_revision_id: string;
        source_segment_ids: string[];
      }[]
    >`
      select source_revision_id, correction_of_revision_id, source_segment_ids
      from app.reconciliation_revisions where id = ${ids.correctionRevision}
    `;
    expect(revisionLineage).toEqual([
      {
        source_revision_id: ids.revisionA,
        correction_of_revision_id: ids.revisionA,
        source_segment_ids: [ids.correctionSegment],
      },
    ]);
    const snapshot = await client<{ payload: Record<string, unknown> }[]>`
      select payload from app.forecourt_outbox where event_id = ${ids.correctionOutbox}
    `;
    expect(snapshot[0]?.payload.correctionOfSegmentId).toBe(ids.segmentA);
    await expect(
      client.unsafe(`
        insert into app.meter_segments
          (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
           opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by,
           opening_reading, closing_reading, litres, unit_price, expected_sale_value, boundary_reason,
           segment_start_at, segment_end_at, sealed_at, state, correction_of_segment_id)
        values
          ('a3000000-0000-4000-8000-000000000204', '${ids.tenantA}', '${ids.stationA2}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}',
           '${ids.correctionOpening}', '${ids.correctionClosing}', '${ids.productA}', '${ids.membershipA}', '${ids.membershipA}',
           1010, 1015, 5, 1.5, 7.5, 'CORRECTION', '2026-09-20T14:00:00Z', '2026-09-20T15:00:00Z', '2026-09-20T15:00:01Z', 'OPEN', '${ids.segmentA}')
      `),
    ).rejects.toThrow();
  });

  it('covers the PostgreSQL stale-winner matrix for seal, handover, price, reconciliation, and day lock', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    await client.unsafe(`
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.raceDay}', '${ids.tenantA}', '${ids.stationA}', '2026-09-23', 'NOT_STARTED');
      update app.station_business_days set state = 'OPEN' where id = '${ids.raceDay}';
      update app.station_business_days set state = 'OPERATIONS_COMPLETE' where id = '${ids.raceDay}';
      update app.station_business_days set state = 'CLOSED' where id = '${ids.raceDay}';
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.raceShift}', '${ids.tenantA}', '${ids.stationA}', '${ids.raceDay}', 'PLANNED', '2026-09-23T06:00:00Z', '2026-09-23T14:00:00Z', '2026-09-23');
      update app.shifts set state = 'OPEN' where id = '${ids.raceShift}';
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason,
         reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${ids.raceOpening}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.raceDay}', '${ids.raceShift}', 'SHIFT_OPEN',
         'AVAILABLE', 2000.000, '2026-09-23T06:00:00Z', '2026-09-23T06:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}'),
        ('${ids.raceClosing}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.raceDay}', '${ids.raceShift}', 'SHIFT_CLOSE',
         'AVAILABLE', 2010.000, '2026-09-23T14:00:00Z', '2026-09-23T14:00:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}');
      insert into app.meter_segments
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
         opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by,
         opening_reading, closing_reading, litres, unit_price, expected_sale_value, boundary_reason,
         segment_start_at, segment_end_at, sealed_at, state)
      values
        ('${ids.raceSegment}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.raceDay}', '${ids.raceShift}',
         '${ids.raceOpening}', '${ids.raceClosing}', '${ids.productA}', '${ids.membershipA}', '${ids.membershipA}',
         2000.000, 2010.000, 10.000, 1.500000, 15.0000, 'SHIFT_CLOSE',
         '2026-09-23T06:00:00Z', '2026-09-23T14:00:00Z', '2026-09-23T14:00:01Z', 'OPEN');
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
      values
        ('${ids.racePrice}', '${ids.tenantA}', '${ids.stationA2}', '${ids.productA}', '2026-09-23T00:00:00Z', 1.900000, 'DRAFT', '${ids.membershipC}');
      update app.selling_prices set state = 'PENDING_APPROVAL' where id = '${ids.racePrice}';
      insert into app.reconciliations
        (id, tenant_id, station_id, business_day_id, state)
      values ('${ids.raceReconciliation}', '${ids.tenantA}', '${ids.stationA}', '${ids.raceDay}', 'DRAFT');
      insert into app.reconciliation_revisions
        (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance, variance_classification, declarations)
      values ('${ids.raceRevision}', '${ids.tenantA}', '${ids.stationA}', '${ids.raceReconciliation}', 1, 'READY', 0, 0, 0, 'INFORMATIONAL', '[]'::jsonb);
      update app.reconciliation_revisions set state = 'SUBMITTED' where id = '${ids.raceRevision}';
      update app.reconciliation_revisions set state = 'PENDING_APPROVAL' where id = '${ids.raceRevision}';
    `);

    async function staleWinnerRace(
      tableName: string,
      id: string,
      expectedVersion: number,
      updateClause: string,
      stationId = ids.stationA,
    ): Promise<[number, number]> {
      let releaseFirst!: () => void;
      let firstLocked!: () => void;
      const firstLockedPromise = new Promise<void>((resolve) => {
        firstLocked = resolve;
      });
      const firstReleasePromise = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const first = raceClient.begin(async (transaction) => {
        await transaction.unsafe(
          `select id from app.${tableName} where tenant_id = '${ids.tenantA}' and station_id = '${stationId}' and id = '${id}' for update`,
        );
        firstLocked();
        await firstReleasePromise;
        const updated = await transaction.unsafe(
          `update app.${tableName} set ${updateClause}, version = version + 1 where tenant_id = '${ids.tenantA}' and station_id = '${stationId}' and id = '${id}' and version = ${expectedVersion} returning id`,
        );
        return updated.length;
      });
      await firstLockedPromise;
      const second = raceClient.begin(async (transaction) => {
        await transaction.unsafe(
          `select id from app.${tableName} where tenant_id = '${ids.tenantA}' and station_id = '${stationId}' and id = '${id}' for update`,
        );
        const updated = await transaction.unsafe(
          `update app.${tableName} set ${updateClause}, version = version + 1 where tenant_id = '${ids.tenantA}' and station_id = '${stationId}' and id = '${id}' and version = ${expectedVersion} returning id`,
        );
        return updated.length;
      });
      releaseFirst();
      return Promise.all([first, second]) as Promise<[number, number]>;
    }

    await expect(
      staleWinnerRace('meter_segments', ids.raceSegment, 0, "state = 'SEALED'"),
    ).resolves.toEqual([1, 0]);
    await expect(
      staleWinnerRace(
        'selling_prices',
        ids.racePrice,
        0,
        `state = 'APPROVED', approved_by = '${ids.membershipA}', approved_at = clock_timestamp()`,
        ids.stationA2,
      ),
    ).resolves.toEqual([1, 0]);
    await expect(
      staleWinnerRace(
        'reconciliation_revisions',
        ids.raceRevision,
        0,
        `state = 'APPROVED', approved_by = '${ids.membershipA}', approved_at = clock_timestamp()`,
      ),
    ).resolves.toEqual([1, 0]);
    await expect(
      staleWinnerRace('station_business_days', ids.raceDay, 0, "state = 'LOCKED'"),
    ).resolves.toEqual([1, 0]);

    const rawToken = 'a3-route-session-token';
    const signedToken = `${rawToken}.${await makeSignature(rawToken, process.env.BETTER_AUTH_SECRET!)}`;
    async function postHandover(boundaryId: string, key: string) {
      return forecourtCommandPost(
        new Request('http://127.0.0.1:3000/api/forecourt/commands', {
          method: 'POST',
          headers: {
            cookie: `shanda-fuel.session_token=${signedToken}`,
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify({
            commandType: 'HandoverAttendant',
            tenantId: ids.tenantA,
            stationId: ids.stationA,
            boundaryId,
            priorBoundaryId: ids.routeOpening,
            nozzleId: ids.nozzleA,
            meterInstallationId: ids.installationA,
            businessDayId: ids.routeDay,
            shiftId: ids.routeShift,
            newAttendantId: ids.membershipA,
            expectedVersion: 0,
          }),
        }),
      );
    }
    const handovers = await Promise.all([
      postHandover(ids.handoverA, 'a3-race-handover-a'),
      postHandover(ids.handoverB, 'a3-race-handover-b'),
    ]);
    expect(handovers.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await client<{ count: number }[]>`
        select count(*)::int as count from app.meter_boundaries
        where id in (${ids.handoverA}, ${ids.handoverB})
      `,
    ).toEqual([{ count: 1 }]);
    expect(
      await client<
        { version: number }[]
      >`select version from app.shifts where id = ${ids.routeShift}`,
    ).toEqual([{ version: 1 }]);
  });

  it('serializes concurrent trusted command routes for seal, price, reconciliation, and day lock', async () => {
    process.env.AUDIT_SIGNING_KEY_ID = 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY = 'integration-a3-secret';
    const rawToken = 'a3-route-session-token';
    const signedToken = `${rawToken}.${await makeSignature(rawToken, process.env.BETTER_AUTH_SECRET!)}`;
    async function postCommand(input: Record<string, unknown>, key: string) {
      return forecourtCommandPost(
        new Request('http://127.0.0.1:3000/api/forecourt/commands', {
          method: 'POST',
          headers: {
            cookie: `shanda-fuel.session_token=${signedToken}`,
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify(input),
        }),
      );
    }
    await client.unsafe(`
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason,
         reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${ids.routeRaceOpening}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.routeDay}', '${ids.routeShift}', 'PRICE_CHANGE',
         'AVAILABLE', 1012.125, '2026-09-21T07:30:00Z', '2026-09-21T07:30:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}'),
        ('${ids.routeRaceClosing}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.routeDay}', '${ids.routeShift}', 'SHIFT_CLOSE',
         'AVAILABLE', 1015.125, '2026-09-21T08:30:00Z', '2026-09-21T08:30:01Z', '${ids.membershipA}', '${ids.membershipA}', '${ids.membershipA}');
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, effective_to, unit_price, state, requested_by)
      values ('${ids.routeRacePrice}', '${ids.tenantA}', '${ids.stationA}', '${ids.productB}', '2026-09-25T00:00:00Z', '2026-09-26T00:00:00Z', 1.830000, 'DRAFT', '${ids.membershipC}');
      update app.selling_prices set state = 'PENDING_APPROVAL' where id = '${ids.routeRacePrice}';
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.commandRaceDay}', '${ids.tenantA}', '${ids.stationA}', '2026-09-26', 'NOT_STARTED');
      update app.station_business_days set state = 'OPEN' where id = '${ids.commandRaceDay}';
      update app.station_business_days set state = 'OPERATIONS_COMPLETE' where id = '${ids.commandRaceDay}';
      update app.station_business_days set state = 'CLOSED' where id = '${ids.commandRaceDay}';
      insert into app.reconciliations
        (id, tenant_id, station_id, business_day_id, state)
      values ('${ids.commandRaceReconciliation}', '${ids.tenantA}', '${ids.stationA}', '${ids.commandRaceDay}', 'DRAFT');
      update app.reconciliations set state = 'READY' where id = '${ids.commandRaceReconciliation}';
      insert into app.reconciliation_revisions
        (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance,
         variance_classification, declarations, submitted_by)
      values ('${ids.commandRaceRevision}', '${ids.tenantA}', '${ids.stationA}', '${ids.commandRaceReconciliation}', 1,
        'READY', 0, 0, 0, 'INFORMATIONAL', '[]'::jsonb, null);
      update app.reconciliation_revisions
      set state = 'SUBMITTED', submitted_by = '${ids.membershipC}'
      where id = '${ids.commandRaceRevision}';
      update app.reconciliation_revisions set state = 'PENDING_APPROVAL' where id = '${ids.commandRaceRevision}';
    `);

    const sealInput = {
      commandType: 'SealSegment',
      tenantId: ids.tenantA,
      stationId: ids.stationA,
      segmentId: ids.routeRaceSegment,
      nozzleId: ids.nozzleA,
      meterInstallationId: ids.installationA,
      businessDayId: ids.routeDay,
      shiftId: ids.routeShift,
      openingBoundaryId: ids.routeRaceOpening,
      closingBoundaryId: ids.routeRaceClosing,
      productId: ids.productA,
      responsibleAttendantId: ids.membershipA,
      startAt: '2026-09-21T07:30:00.000Z',
      endAt: '2026-09-21T08:30:00.000Z',
      expectedVersion: 0,
    };
    const seals = await Promise.all([
      postCommand(sealInput, 'a3-command-race-seal-a'),
      postCommand(sealInput, 'a3-command-race-seal-b'),
    ]);
    expect(seals.map((response) => response.status).sort()).toEqual([201, 409]);

    const priceApproval = await postCommand(
      {
        commandType: 'ApprovePriceChange',
        tenantId: ids.tenantA,
        stationId: ids.stationA,
        priceId: ids.routeRacePrice,
        expectedVersion: 0,
      },
      'a3-command-race-price-approve',
    );
    expect(priceApproval.status).toBe(200);
    await client.unsafe(
      `update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id = '${ids.routeRacePrice}'`,
    );
    const activations = await Promise.all([
      postCommand(
        {
          commandType: 'ActivatePriceChange',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          priceId: ids.routeRacePrice,
          expectedVersion: 1,
        },
        'a3-command-race-price-a',
      ),
      postCommand(
        {
          commandType: 'ActivatePriceChange',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          priceId: ids.routeRacePrice,
          expectedVersion: 1,
        },
        'a3-command-race-price-b',
      ),
    ]);
    expect(activations.map((response) => response.status).sort()).toEqual([200, 409]);

    const approvals = await Promise.all([
      postCommand(
        {
          commandType: 'ApproveReconciliation',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          revisionId: ids.commandRaceRevision,
          expectedVersion: 0,
        },
        'a3-command-race-reconciliation-approve-a',
      ),
      postCommand(
        {
          commandType: 'ApproveReconciliation',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          revisionId: ids.commandRaceRevision,
          expectedVersion: 0,
        },
        'a3-command-race-reconciliation-approve-b',
      ),
    ]);
    expect(approvals.map((response) => response.status).sort()).toEqual([200, 409]);

    const postings = await Promise.all([
      postCommand(
        {
          commandType: 'PostReconciliation',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          revisionId: ids.commandRaceRevision,
          expectedVersion: 1,
        },
        'a3-command-race-reconciliation-post-a',
      ),
      postCommand(
        {
          commandType: 'PostReconciliation',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          revisionId: ids.commandRaceRevision,
          expectedVersion: 1,
        },
        'a3-command-race-reconciliation-post-b',
      ),
    ]);
    expect(postings.map((response) => response.status).sort()).toEqual([200, 409]);

    const locks = await Promise.all([
      postCommand(
        {
          commandType: 'LockBusinessDay',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          businessDayId: ids.commandRaceDay,
          expectedVersion: 0,
        },
        'a3-command-race-day-lock-a',
      ),
      postCommand(
        {
          commandType: 'LockBusinessDay',
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          businessDayId: ids.commandRaceDay,
          expectedVersion: 0,
        },
        'a3-command-race-day-lock-b',
      ),
    ]);
    expect(locks.map((response) => response.status).sort()).toEqual([200, 409]);

    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.meter_segments where id = ${ids.routeRaceSegment}
      `,
    ).resolves.toEqual([{ state: 'SEALED', version: 1 }]);
    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.selling_prices where id = ${ids.routeRacePrice}
      `,
    ).resolves.toEqual([{ state: 'ACTIVE', version: 3 }]);
    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.reconciliation_revisions where id = ${ids.commandRaceRevision}
      `,
    ).resolves.toEqual([{ state: 'POSTED', version: 2 }]);
    await expect(
      client<{ state: string; version: number }[]>`
        select state, version from app.station_business_days where id = ${ids.commandRaceDay}
      `,
    ).resolves.toEqual([{ state: 'LOCKED', version: 1 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from app.forecourt_outbox
        where aggregate_id in (${ids.routeRaceSegment}, ${ids.routeRacePrice}, ${ids.commandRaceReconciliation}, ${ids.commandRaceDay})
      `,
    ).resolves.toEqual([{ count: 4 }]);
    await expect(
      client<{ count: number }[]>`
        select count(*)::int as count from platform.security_events
        where event_code in ('FORECOURT.SealSegment', 'FORECOURT.ActivatePriceChange',
          'FORECOURT.ApproveReconciliation', 'FORECOURT.PostReconciliation', 'FORECOURT.LockBusinessDay')
          and details->>'subjectId' in (${ids.routeRaceSegment}, ${ids.routeRacePrice}, ${ids.commandRaceRevision}, ${ids.commandRaceDay})
      `,
    ).resolves.toEqual([{ count: 5 }]);
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
