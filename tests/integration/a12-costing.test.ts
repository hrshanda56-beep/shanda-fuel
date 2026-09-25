import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for A12.3 costing integration tests.');

const ids = {
  tenant: 'a1220000-0000-4000-8000-000000000001',
  legal: 'a1220000-0000-4000-8000-000000000011',
  station: 'a1220000-0000-4000-8000-000000000021',
  stationTwo: 'a1220000-0000-4000-8000-000000000022',
  actor: 'a1220000-0000-4000-8000-000000000031',
  membership: 'a1220000-0000-4000-8000-000000000041',
  product: 'a1220000-0000-4000-8000-000000000051',
  productTwo: 'a1220000-0000-4000-8000-000000000052',
  tank: 'a1220000-0000-4000-8000-000000000061',
  tankTwo: 'a1220000-0000-4000-8000-000000000062',
  openingMovement: 'a1220000-0000-4000-8000-000000000070',
  costEvent: 'a1220000-0000-4000-8000-000000000071',
  costEventSource: 'a1220000-0000-4000-8000-000000000081',
  positiveSaleCostSource: 'a1220000-0000-4000-8000-000000000080',
  saleCostEvent: 'a1220000-0000-4000-8000-000000000082',
  saleSegment: 'a1220000-0000-4000-8000-000000000083',
  saleMovement: 'a1220000-0000-4000-8000-000000000084',
  saleBoundaryOpening: 'a1220000-0000-4000-8000-000000000085',
  saleBoundaryClosing: 'a1220000-0000-4000-8000-000000000086',
  saleBusinessDay: 'a1220000-0000-4000-8000-000000000087',
  saleShift: 'a1220000-0000-4000-8000-000000000088',
  salePump: 'a1220000-0000-4000-8000-000000000089',
  saleNozzle: 'a1220000-0000-4000-8000-000000000090',
  saleMeter: 'a1220000-0000-4000-8000-000000000092',
  saleInstallation: 'a1220000-0000-4000-8000-000000000093',
  wrongStreamCostEvent: 'a1220000-0000-4000-8000-000000000094',
  wrongStreamSource: 'a1220000-0000-4000-8000-000000000095',
  wrongAttribution: 'a1220000-0000-4000-8000-000000000096',
  saleAttribution: 'a1220000-0000-4000-8000-000000000097',
  wrongStreamSegment: 'a1220000-0000-4000-8000-000000000098',
  wrongStreamMovement: 'a1220000-0000-4000-8000-000000000099',
  wrongStreamBoundaryOpening: 'a1220000-0000-4000-8000-000000000100',
  wrongStreamBoundaryClosing: 'a1220000-0000-4000-8000-000000000101',
  effectiveSegment: 'a1220000-0000-4000-8000-000000000102',
  effectiveMovement: 'a1220000-0000-4000-8000-000000000103',
  effectiveCostEvent: 'a1220000-0000-4000-8000-000000000104',
  effectiveBoundaryOpening: 'a1220000-0000-4000-8000-000000000105',
  effectiveBoundaryClosing: 'a1220000-0000-4000-8000-000000000106',
  businessSegment: 'a1220000-0000-4000-8000-000000000107',
  businessMovement: 'a1220000-0000-4000-8000-000000000108',
  businessCostEvent: 'a1220000-0000-4000-8000-000000000109',
  businessBoundaryOpening: 'a1220000-0000-4000-8000-000000000110',
  businessBoundaryClosing: 'a1220000-0000-4000-8000-000000000111',
  revaluation: 'a1220000-0000-4000-8000-000000000091',
};

let client: Sql;

async function setContext(tenantId: string, stationId: string): Promise<void> {
  await client.unsafe(`
    select set_config('app.tenant_id', '${tenantId}', false);
    select set_config('app.actor_id', '${ids.actor}', false);
    select set_config('app.membership_id', '${ids.membership}', false);
    select set_config('app.station_id', '${stationId}', false);
  `);
}

describe('A12.3 PostgreSQL costing and projection persistence', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
    await setContext(ids.tenant, ids.station);
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'A12.2 Tenant', 'a122-tenant') on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values ('${ids.actor}', 'A12.2 Operator', 'a122@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${ids.legal}', '${ids.tenant}', 'A12.2 Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A122-1', 'A12.2 Station 1', 'ACTIVE'),
        ('${ids.stationTwo}', '${ids.tenant}', '${ids.legal}', 'A122-2', 'A12.2 Station 2', 'ACTIVE') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'TENANT', null, null) on conflict do nothing;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.tenant}', 'A122-DIESEL', 'A12.2 Diesel'),
        ('${ids.productTwo}', '${ids.tenant}', 'A122-PETROL', 'A12.2 Petrol') on conflict (id) do nothing;
      insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, created_by, updated_by) values
        ('${ids.tank}', '${ids.tenant}', '${ids.station}', 'A122-D1', '${ids.product}', '20000', '${ids.membership}', '${ids.membership}'),
        ('${ids.tankTwo}', '${ids.tenant}', '${ids.stationTwo}', 'A122-P1', '${ids.productTwo}', '12000', '${ids.membership}', '${ids.membership}') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number, status)
        values ('${ids.salePump}', '${ids.tenant}', '${ids.station}', 'A122-SALE', 'ACTIVE') on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
        values ('${ids.saleNozzle}', '${ids.tenant}', '${ids.station}', '${ids.salePump}', '1', '${ids.product}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values ('${ids.saleMeter}', '${ids.tenant}', 'A122-SALE-METER') on conflict (id) do nothing;
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values ('${ids.saleInstallation}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleMeter}', '2026-09-25T00:00:00Z', '${ids.membership}') on conflict (id) do nothing;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state, opened_at)
        values ('${ids.saleBusinessDay}', '${ids.tenant}', '${ids.station}', '2026-09-25', 'NOT_STARTED', null) on conflict (id) do nothing;
      update app.station_business_days set state='OPEN', opened_at=now()
        where id='${ids.saleBusinessDay}' and state='NOT_STARTED';
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date, opened_at)
        values ('${ids.saleShift}', '${ids.tenant}', '${ids.station}', '${ids.saleBusinessDay}', 'PLANNED', '2026-09-25T00:00:00Z', '2026-09-26T00:00:00Z', '2026-09-25', null) on conflict (id) do nothing;
      update app.shifts set state='OPEN', opened_at=now()
        where id='${ids.saleShift}' and state='PLANNED';
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${ids.saleBoundaryOpening}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', 'SHIFT_OPEN', 'AVAILABLE', '100.000', '2026-09-25T06:00:00Z', '2026-09-25T06:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${ids.saleBoundaryClosing}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', 'SHIFT_CLOSE', 'AVAILABLE', '110.000', '2026-09-25T08:00:00Z', '2026-09-25T08:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}')
      on conflict (id) do nothing;
      insert into app.meter_segments
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, expected_sale_value, currency, boundary_reason, segment_start_at, segment_end_at, sealed_at, state, version)
      values ('${ids.saleSegment}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', '${ids.saleBoundaryOpening}', '${ids.saleBoundaryClosing}', '${ids.product}', '${ids.membership}', '${ids.membership}', '100.000', '110.000', '10.000', '1.500000', '15.0000', 'USD', 'SHIFT_CLOSE', '2026-09-25T06:00:00Z', '2026-09-25T08:00:00Z', '2026-09-25T08:00:01Z', 'OPEN', 0)
      on conflict (id) do nothing;
      select app.seal_meter_segment('${ids.tenant}', '${ids.station}', '${ids.saleSegment}', 0);
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values
        ('${ids.openingMovement}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'OPENING_BALANCE', '100.000', '2026-09-25T05:00:00Z', '2026-09-25', 'OPENING_BALANCE', '${ids.costEventSource}', '${ids.membership}'),
        ('${ids.saleMovement}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE', '-10.000', '2026-09-25T08:00:00Z', '2026-09-25', 'METER_SEGMENT_SALE', '${ids.saleSegment}', '${ids.membership}')
      on conflict (id) do nothing;
      insert into app.inventory_cost_events
        (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at, business_date, amount, currency, actor_membership_id)
      values ('${ids.saleCostEvent}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${ids.saleSegment}', '2026-09-25T08:00:00Z', '2026-09-25', '-12.3456', 'USD', '${ids.membership}')
      on conflict (id) do nothing;
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${ids.wrongStreamBoundaryOpening}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', 'DELIVERY', 'AVAILABLE', '200.000', '2026-09-25T10:00:00Z', '2026-09-25T10:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${ids.wrongStreamBoundaryClosing}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', 'SHIFT_CLOSE', 'AVAILABLE', '210.000', '2026-09-25T12:00:00Z', '2026-09-25T12:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${ids.effectiveBoundaryOpening}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', 'DELIVERY', 'AVAILABLE', '300.000', '2026-09-25T14:00:00Z', '2026-09-25T14:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${ids.effectiveBoundaryClosing}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', 'SHIFT_CLOSE', 'AVAILABLE', '310.000', '2026-09-25T16:00:00Z', '2026-09-25T16:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${ids.businessBoundaryOpening}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', 'DELIVERY', 'AVAILABLE', '400.000', '2026-09-25T18:00:00Z', '2026-09-25T18:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${ids.businessBoundaryClosing}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', 'SHIFT_CLOSE', 'AVAILABLE', '410.000', '2026-09-25T20:00:00Z', '2026-09-25T20:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}')
      on conflict (id) do nothing;
      insert into app.meter_segments
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, expected_sale_value, currency, boundary_reason, segment_start_at, segment_end_at, sealed_at, state, version)
      values
        ('${ids.wrongStreamSegment}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', '${ids.wrongStreamBoundaryOpening}', '${ids.wrongStreamBoundaryClosing}', '${ids.product}', '${ids.membership}', '${ids.membership}', '200.000', '210.000', '10.000', '1.500000', '15.0000', 'USD', 'SHIFT_CLOSE', '2026-09-25T10:00:00Z', '2026-09-25T12:00:00Z', '2026-09-25T12:00:01Z', 'OPEN', 0),
        ('${ids.effectiveSegment}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', '${ids.effectiveBoundaryOpening}', '${ids.effectiveBoundaryClosing}', '${ids.product}', '${ids.membership}', '${ids.membership}', '300.000', '310.000', '10.000', '1.500000', '15.0000', 'USD', 'SHIFT_CLOSE', '2026-09-25T14:00:00Z', '2026-09-25T16:00:00Z', '2026-09-25T16:00:01Z', 'OPEN', 0),
        ('${ids.businessSegment}', '${ids.tenant}', '${ids.station}', '${ids.saleNozzle}', '${ids.saleInstallation}', '${ids.saleBusinessDay}', '${ids.saleShift}', '${ids.businessBoundaryOpening}', '${ids.businessBoundaryClosing}', '${ids.product}', '${ids.membership}', '${ids.membership}', '400.000', '410.000', '10.000', '1.500000', '15.0000', 'USD', 'SHIFT_CLOSE', '2026-09-25T18:00:00Z', '2026-09-25T20:00:00Z', '2026-09-25T20:00:01Z', 'OPEN', 0)
      on conflict (id) do nothing;
      select app.seal_meter_segment('${ids.tenant}', '${ids.station}', '${ids.wrongStreamSegment}', 0);
      select app.seal_meter_segment('${ids.tenant}', '${ids.station}', '${ids.effectiveSegment}', 0);
      select app.seal_meter_segment('${ids.tenant}', '${ids.station}', '${ids.businessSegment}', 0);
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values
        ('${ids.wrongStreamMovement}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE', '-10.000', '2026-09-25T12:00:00Z', '2026-09-25', 'METER_SEGMENT_SALE', '${ids.wrongStreamSegment}', '${ids.membership}'),
        ('${ids.effectiveMovement}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE', '-10.000', '2026-09-25T16:00:00Z', '2026-09-25', 'METER_SEGMENT_SALE', '${ids.effectiveSegment}', '${ids.membership}'),
        ('${ids.businessMovement}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE', '-10.000', '2026-09-25T20:00:00Z', '2026-09-25', 'METER_SEGMENT_SALE', '${ids.businessSegment}', '${ids.membership}')
      on conflict (id) do nothing;
      insert into app.inventory_cost_events
        (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at, business_date, amount, currency, actor_membership_id)
      values
        ('${ids.wrongStreamCostEvent}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${ids.wrongStreamSegment}', '2026-09-25T12:00:00Z', '2026-09-25', '-12.3456', 'USD', '${ids.membership}'),
        ('${ids.effectiveCostEvent}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${ids.effectiveSegment}', '2026-09-25T15:59:00Z', '2026-09-25', '-12.3456', 'USD', '${ids.membership}'),
        ('${ids.businessCostEvent}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${ids.businessSegment}', '2026-09-25T20:00:00Z', '2026-09-26', '-12.3456', 'USD', '${ids.membership}')
      on conflict (id) do nothing;
    `);
  });

  afterAll(async () => client?.end());

  it('enforces signed event source idempotency, append-only authority, and exact scales', async () => {
    await setContext(ids.tenant, ids.station);
    await client.unsafe(`
      insert into app.inventory_cost_events
        (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at, business_date, amount, currency, actor_membership_id)
      values
        ('${ids.costEvent}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'OPENING_COST', 'OPENING_BALANCE', '${ids.costEventSource}', '2026-09-25T06:00:00Z', '2026-09-25', '123.4567', 'USD', '${ids.membership}')
      on conflict (id) do nothing;
    `);
    await expect(
      client.unsafe(`
      insert into app.inventory_cost_events
        (tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at, business_date, amount, currency, actor_membership_id)
      values
        ('${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'OPENING_COST', 'OPENING_BALANCE', '${ids.costEventSource}', '2026-09-25T06:00:00Z', '2026-09-25', '123.4567', 'USD', '${ids.membership}')
    `),
    ).rejects.toMatchObject({ constraint_name: 'inventory_cost_events_source_uidx' });
    await expect(
      client.unsafe(
        `update app.inventory_cost_events set amount='1.0000' where id='${ids.costEvent}'`,
      ),
    ).rejects.toThrow('append-only');
    const scales = await client.unsafe<{ column_name: string; numeric_scale: number }[]>(`
      select column_name, numeric_scale from information_schema.columns
      where table_schema='app' and table_name='inventory_cost_events' and column_name='amount'
    `);
    expect(scales).toEqual([{ column_name: 'amount', numeric_scale: 4 }]);
    await expect(
      client.unsafe(`
        insert into app.inventory_cost_events
          (tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at, business_date, amount, currency, actor_membership_id)
        values ('${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${ids.positiveSaleCostSource}', '2026-09-25T08:00:00Z', '2026-09-25', '1.0000', 'USD', '${ids.membership}')
      `),
    ).rejects.toMatchObject({ constraint_name: 'inventory_cost_events_sale_cogs_negative_ck' });
  });

  it('allows only the controlled projection writer to mutate stream state', async () => {
    await client.unsafe('set role app_runtime');
    try {
      await setContext(ids.tenant, ids.station);
      await expect(
        client.unsafe(`
          insert into app.inventory_cost_stream_state
            (tenant_id, station_id, tank_id, product_id, quantity_litres, valuation_status)
          values ('${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', '1.000', 'UNVALUED')
        `),
      ).rejects.toThrow(/permission denied/);
      await client.unsafe(`
        select app.upsert_inventory_cost_stream_state(
          '${ids.tenant}'::uuid, '${ids.station}'::uuid, '${ids.tank}'::uuid, '${ids.product}'::uuid,
          '100.000'::numeric, '123.4567'::numeric, 'USD'::text, '1.23456700'::numeric,
          'VALUED'::text, '2026-09-25T06:00:00Z'::timestamptz, '${ids.openingMovement}'::uuid,
          '2026-09-25T06:00:00Z'::timestamptz, '${ids.costEvent}'::uuid, 1::integer
        )
      `);
      await expect(
        client.unsafe(`
          update app.inventory_cost_stream_state
             set quantity_litres='101.000'
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and tank_id='${ids.tank}' and product_id='${ids.product}'
        `),
      ).rejects.toThrow(/permission denied/);
      const persisted = await client.unsafe<
        { quantity_litres: string; projection_version: number }[]
      >(`
        select quantity_litres, projection_version
        from app.inventory_cost_stream_state
        where tenant_id='${ids.tenant}' and station_id='${ids.station}'
          and tank_id='${ids.tank}' and product_id='${ids.product}'
      `);
      expect(persisted).toEqual([{ quantity_litres: '100.000', projection_version: 1 }]);

      await setContext(ids.tenant, ids.stationTwo);
      await expect(
        client.unsafe(`
          select app.upsert_inventory_cost_stream_state(
            '${ids.tenant}'::uuid, '${ids.station}'::uuid, '${ids.tank}'::uuid, '${ids.product}'::uuid,
            '100.000'::numeric, '123.4567'::numeric, 'USD'::text, '1.23456700'::numeric,
            'VALUED'::text, null, null, null, null, 2::integer
          )
        `),
      ).rejects.toThrow(/station context mismatch/);
      await setContext('a1230000-0000-4000-8000-000000000001', ids.station);
      await expect(
        client.unsafe(`
          select app.upsert_inventory_cost_stream_state(
            '${ids.tenant}'::uuid, '${ids.station}'::uuid, '${ids.tank}'::uuid, '${ids.product}'::uuid,
            '100.000'::numeric, '123.4567'::numeric, 'USD'::text, '1.23456700'::numeric,
            'VALUED'::text, null, null, null, null, 2::integer
          )
        `),
      ).rejects.toThrow(/tenant context mismatch/);
      await setContext(ids.tenant, ids.station);
      await expect(
        client.unsafe(`
          select app.upsert_inventory_cost_stream_state(
            '${ids.tenant}'::uuid, '${ids.station}'::uuid, '${ids.tank}'::uuid, '${ids.product}'::uuid,
            '-1.000'::numeric, null, null, null, 'UNVALUED'::text,
            null, null, null, null, 2::integer
          )
        `),
      ).rejects.toThrow(/inventory_cost_stream_state_quantity_nonnegative_ck/);
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('represents an unvalued stream without fake zero cost and isolates station keys through RLS', async () => {
    await setContext(ids.tenant, ids.station);
    await client.unsafe(`
      insert into app.inventory_cost_stream_state
        (tenant_id, station_id, tank_id, product_id, quantity_litres, valuation_status)
      values ('${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', '100.125', 'UNVALUED')
      on conflict (tenant_id, station_id, tank_id, product_id) do update set quantity_litres='100.125', valuation_status='UNVALUED', inventory_value=null, weighted_average_cost=null, currency=null;
      insert into app.inventory_cost_stream_state
        (tenant_id, station_id, tank_id, product_id, quantity_litres, valuation_status)
      values ('${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', '50.000', 'UNVALUED')
      on conflict (tenant_id, station_id, tank_id, product_id) do nothing;
    `);
    await expect(
      client.unsafe(`
        update app.inventory_cost_stream_state
           set valuation_status='VALUED', inventory_value='1.0000', weighted_average_cost='0.01000000', currency=null
         where tenant_id='${ids.tenant}' and station_id='${ids.station}' and tank_id='${ids.tank}' and product_id='${ids.product}'
      `),
    ).rejects.toMatchObject({ constraint_name: 'inventory_cost_stream_state_valuation_pair_ck' });
    await expect(
      client.unsafe(`
        update app.inventory_cost_stream_state
           set valuation_status='VALUED', inventory_value='1.0000', weighted_average_cost='0.01000000', currency='   '
         where tenant_id='${ids.tenant}' and station_id='${ids.station}' and tank_id='${ids.tank}' and product_id='${ids.product}'
      `),
    ).rejects.toMatchObject({ constraint_name: 'inventory_cost_stream_state_valuation_pair_ck' });
    await expect(
      client.unsafe(`
        update app.inventory_cost_stream_state
           set valuation_status='UNVALUED', inventory_value=null, weighted_average_cost=null, currency='USD'
         where tenant_id='${ids.tenant}' and station_id='${ids.station}' and tank_id='${ids.tank}' and product_id='${ids.product}'
      `),
    ).rejects.toMatchObject({ constraint_name: 'inventory_cost_stream_state_valuation_pair_ck' });
    await client.unsafe('set role app_runtime');
    try {
      await setContext(ids.tenant, ids.station);
      const firstStation = await client.unsafe<{ station_id: string }[]>(
        `select station_id from app.inventory_cost_stream_state order by station_id`,
      );
      expect(firstStation).toEqual([{ station_id: ids.station }]);
      await setContext(ids.tenant, ids.stationTwo);
      const secondStation = await client.unsafe<{ station_id: string }[]>(
        `select station_id from app.inventory_cost_stream_state`,
      );
      expect(secondStation).toEqual([{ station_id: ids.stationTwo }]);
      await setContext(ids.tenant, ids.station);
      const unvalued = await client.unsafe<
        { inventory_value: string | null; weighted_average_cost: string | null }[]
      >(
        `select inventory_value, weighted_average_cost from app.inventory_cost_stream_state where station_id='${ids.station}'`,
      );
      expect(unvalued).toEqual([{ inventory_value: null, weighted_average_cost: null }]);
    } finally {
      await client.unsafe('reset role');
    }
  });

  it('accepts canonical valued attribution and rejects a wrong-stream SALE_COGS authority', async () => {
    await setContext(ids.tenant, ids.stationTwo);
    await setContext(ids.tenant, ids.station);
    await expect(
      client.unsafe(`
        insert into app.inventory_sale_cost_attributions
          (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id, sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis, replay_fingerprint, sale_cost_event_id, effective_at, business_date)
        values ('${ids.wrongAttribution}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', '${ids.wrongStreamMovement}', '${ids.wrongStreamSegment}', '10.000', '1.23456000', '12.3456', 'VALUED', 'PRE_SALE_WAC', 'a122-wrong-stream-fingerprint', '${ids.wrongStreamCostEvent}', '2026-09-25T12:00:00Z', '2026-09-25')
      `),
    ).rejects.toThrow('signed SALE_COGS');
    await expect(
      client.unsafe(`
        insert into app.inventory_sale_cost_attributions
          (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id, sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis, replay_fingerprint, sale_cost_event_id, effective_at, business_date)
        values ('${ids.wrongAttribution}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', '${ids.effectiveMovement}', '${ids.effectiveSegment}', '10.000', '1.23456000', '12.3456', 'VALUED', 'PRE_SALE_WAC', 'a122-wrong-effective-fingerprint', '${ids.effectiveCostEvent}', '2026-09-25T16:00:00Z', '2026-09-25')
      `),
    ).rejects.toThrow('valued sale attribution must reference its signed SALE_COGS event');
    await expect(
      client.unsafe(`
        insert into app.inventory_sale_cost_attributions
          (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id, sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis, replay_fingerprint, sale_cost_event_id, effective_at, business_date)
        values ('${ids.wrongAttribution}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', '${ids.businessMovement}', '${ids.businessSegment}', '10.000', '1.23456000', '12.3456', 'VALUED', 'PRE_SALE_WAC', 'a122-wrong-business-date-fingerprint', '${ids.businessCostEvent}', '2026-09-25T20:00:00Z', '2026-09-25')
      `),
    ).rejects.toThrow('valued sale attribution must reference its signed SALE_COGS event');
    await expect(
      client.unsafe(`
        insert into app.inventory_sale_cost_attributions
          (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id, sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis, replay_fingerprint, sale_cost_event_id, effective_at, business_date)
        values ('${ids.wrongAttribution}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', '${ids.saleMovement}', '${ids.saleSegment}', '10.000', '1.23456000', '12.3456', 'UNVALUED', 'PRE_SALE_WAC', 'a122-unvalued-fingerprint', '${ids.saleCostEvent}', '2026-09-25T08:00:00Z', '2026-09-25')
      `),
    ).rejects.toMatchObject({ constraint_name: 'inventory_sale_cost_attributions_status_ck' });
    await client.unsafe(`
      insert into app.inventory_sale_cost_attributions
        (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id, sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis, replay_fingerprint, sale_cost_event_id, effective_at, business_date)
      values ('${ids.saleAttribution}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', '${ids.saleMovement}', '${ids.saleSegment}', '10.000', '1.23456000', '12.3456', 'VALUED', 'PRE_SALE_WAC', 'a122-canonical-fingerprint', '${ids.saleCostEvent}', '2026-09-25T08:00:00Z', '2026-09-25')
      on conflict do nothing;
    `);
    const valued = await client.unsafe<{ inventory_movement_id: string }[]>(
      `select inventory_movement_id from app.inventory_sale_cost_attributions where meter_segment_id='${ids.saleSegment}'`,
    );
    expect(valued).toEqual([{ inventory_movement_id: ids.saleMovement }]);
    await expect(
      client.unsafe(
        `update app.inventory_sale_cost_attributions set replay_fingerprint='rewritten' where id='${ids.saleAttribution}'`,
      ),
    ).rejects.toThrow('immutable');
  });

  it('installs one-attribution uniqueness and protects revaluation transitions', async () => {
    const constraints = await client.unsafe<{ conname: string }[]>(`
      select conname from pg_constraint
      where conrelid='app.inventory_sale_cost_attributions'::regclass
        and conname in ('inventory_sale_cost_attributions_segment_uidx', 'inventory_sale_cost_attributions_movement_uidx')
    `);
    expect(constraints.map((row) => row.conname).sort()).toEqual([
      'inventory_sale_cost_attributions_movement_uidx',
      'inventory_sale_cost_attributions_segment_uidx',
    ]);
    await setContext(ids.tenant, ids.station);
    await client.unsafe(`
      insert into app.inventory_cost_revaluations
        (id, tenant_id, station_id, tank_id, product_id, reason, effective_at, business_date, requested_by)
      values ('${ids.revaluation}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'A12.2 integration foundation', '2026-09-25T10:00:00Z', '2026-09-25', '${ids.membership}')
      on conflict (id) do nothing;
      update app.inventory_cost_revaluations
         set status='APPROVED', approved_by='${ids.membership}', approved_at='2026-09-25T10:01:00Z'
       where id='${ids.revaluation}';
    `);
    await expect(
      client.unsafe(
        `update app.inventory_cost_revaluations set reason='rewritten' where id='${ids.revaluation}'`,
      ),
    ).rejects.toThrow('immutable');
  });
});
