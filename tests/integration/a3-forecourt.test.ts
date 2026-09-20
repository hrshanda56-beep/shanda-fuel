import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';

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
  stationA: 'a3000000-0000-4000-8000-000000000021',
  stationB: 'a3000000-0000-4000-8000-000000000022',
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
};

let client: Sql;

async function setContext(tenantId: string, actorId: string, membershipId: string) {
  await client.unsafe(`select set_config('app.tenant_id', '${tenantId}', false)`);
  await client.unsafe(`select set_config('app.actor_id', '${actorId}', false)`);
  await client.unsafe(`select set_config('app.membership_id', '${membershipId}', false)`);
}

describe('A3 PostgreSQL forecourt isolation and resource constraints', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
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
        ('${ids.legalB}', '${ids.tenantB}', 'A3 Legal B') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.stationA}', '${ids.tenantA}', '${ids.legalA}', 'A3A', 'A3 Station A', 'ACTIVE'),
        ('${ids.stationB}', '${ids.tenantB}', '${ids.legalB}', 'A3B', 'A3 Station B', 'ACTIVE') on conflict (id) do nothing;
    `);
  });

  afterAll(async () => {
    await client?.end();
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
          values ('${ids.dayA}', '${ids.tenantA}', '${ids.stationA}', '2026-09-20', 'OPEN');
        insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
          values ('${ids.shiftA}', '${ids.tenantA}', '${ids.stationA}', '${ids.dayA}', 'OPEN', '2026-09-20T06:00:00Z', '2026-09-20T14:00:00Z', '2026-09-20');
        insert into app.meter_boundaries (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by)
          values
            ('${ids.openingA}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', 'SHIFT_OPEN', 'AVAILABLE', 1000.000, '2026-09-20T06:00:00Z', '2026-09-20T06:00:01Z', '${ids.membershipA}', '${ids.membershipA}'),
            ('${ids.closingA}', '${ids.tenantA}', '${ids.stationA}', '${ids.nozzleA}', '${ids.installationA}', '${ids.dayA}', '${ids.shiftA}', 'SHIFT_CLOSE', 'AVAILABLE', 1010.125, '2026-09-20T14:00:00Z', '2026-09-20T14:00:01Z', '${ids.membershipA}', '${ids.membershipA}');
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
        'meter_segments', 'reconciliations', 'reconciliation_revisions', 'payment_declarations'
      ) order by c.relname
    `;
    expect(rows).toHaveLength(13);
    expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });
});
