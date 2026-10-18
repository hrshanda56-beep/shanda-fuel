import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as inventoryCommandPost } from '../../src/app/api/inventory/commands/route';
import { GET as inventoryValuationGet } from '../../src/app/api/inventory/valuation/route';
import { GET as inventoryRevaluationGet } from '../../src/app/api/inventory/valuation/revaluations/[id]/route';

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
  wrongStreamTank: 'a1220000-0000-4000-8000-000000000113',
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
  phase2Session: 'a1220000-0000-4000-8000-000000000112',
};

let client: Sql;
let phase2PostedRevaluationId: string | null = null;
const phase = {
  day: randomUUID(),
  shift: randomUUID(),
  pump: randomUUID(),
  nozzle: randomUUID(),
  meter: randomUUID(),
  installation: randomUUID(),
  openingBoundary: randomUUID(),
  closingBoundary: randomUUID(),
  segment: randomUUID(),
  openingMovement: randomUUID(),
  openingSource: randomUUID(),
  openingCostEvent: randomUUID(),
  saleMovement: randomUUID(),
  saleCostEvent: randomUUID(),
  saleAttribution: randomUUID(),
  secondOpeningBoundary: randomUUID(),
  secondClosingBoundary: randomUUID(),
  secondSegment: randomUUID(),
  secondSaleMovement: randomUUID(),
  secondSaleCostEvent: randomUUID(),
  secondSaleAttribution: randomUUID(),
  openingLateTank: randomUUID(),
  openingLateDelivery: randomUUID(),
  openingLateAllocation: randomUUID(),
  openingLateDeliveryMovement: randomUUID(),
  openingLateReceiptCost: randomUUID(),
  openingLateOpeningBoundary: randomUUID(),
  openingLateClosingBoundary: randomUUID(),
  openingLateSegment: randomUUID(),
  openingLateSaleMovement: randomUUID(),
  openingLateSaleCost: randomUUID(),
  openingLateAttribution: randomUUID(),
  firstDelivery: randomUUID(),
  firstAllocation: randomUUID(),
  firstMovement: randomUUID(),
  secondDelivery: randomUUID(),
  secondAllocation: randomUUID(),
  secondMovement: randomUUID(),
  thirdDelivery: randomUUID(),
  thirdAllocation: randomUUID(),
  thirdMovement: randomUUID(),
};

async function setContext(tenantId: string, stationId: string): Promise<void> {
  await client.unsafe(`
    select set_config('app.tenant_id', '${tenantId}', false);
    select set_config('app.actor_id', '${ids.actor}', false);
    select set_config('app.membership_id', '${ids.membership}', false);
    select set_config('app.station_id', '${stationId}', false);
  `);
}

async function postInventoryCommand(
  input: Record<string, unknown>,
  key: string,
): Promise<Response> {
  const token = 'a122-phase2-session-token';
  const signedToken = token;
  return inventoryCommandPost(
    new Request('http://127.0.0.1:3000/api/inventory/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(signedToken),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function getInventoryValuation(tenantId: string, stationId: string): Promise<Response> {
  const token = 'a122-phase2-session-token';
  const signedToken = token;
  return inventoryValuationGet(
    new Request(
      `http://127.0.0.1:3000/api/inventory/valuation?tenantId=${tenantId}&stationId=${stationId}`,
      { headers: { ...clerkHeaders(signedToken) } },
    ),
  );
}

async function getInventoryRevaluation(
  tenantId: string,
  stationId: string,
  revaluationId: string,
): Promise<Response> {
  const token = 'a122-phase2-session-token';
  const signedToken = token;
  return inventoryRevaluationGet(
    new Request(
      `http://127.0.0.1:3000/api/inventory/valuation/revaluations/${revaluationId}?tenantId=${tenantId}&stationId=${stationId}`,
      { headers: { ...clerkHeaders(signedToken) } },
    ),
    { params: Promise.resolve({ id: revaluationId }) },
  );
}

describe('A12.4 PostgreSQL late-cost revaluation workflow', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl, { max: 1, prepare: false, connection: { TimeZone: 'UTC' } });
    await setContext(ids.tenant, ids.station);
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'A12.2 Tenant', 'a122-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values ('${ids.actor}', 'A12.2 Operator', 'a122@example.test') on conflict (id) do nothing;
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
        ('${ids.tankTwo}', '${ids.tenant}', '${ids.stationTwo}', 'A122-P1', '${ids.productTwo}', '12000', '${ids.membership}', '${ids.membership}'),
        ('${ids.wrongStreamTank}', '${ids.tenant}', '${ids.stationTwo}', 'A122-WRONG', '${ids.productTwo}', '12000', '${ids.membership}', '${ids.membership}'),
        ('${phase.openingLateTank}', '${ids.tenant}', '${ids.stationTwo}', 'A122-P2-LATE-OPEN', '${ids.productTwo}', '12000', '${ids.membership}', '${ids.membership}') on conflict (id) do nothing;
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
        ('${ids.wrongStreamCostEvent}', '${ids.tenant}', '${ids.stationTwo}', '${ids.wrongStreamTank}', '${ids.productTwo}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${ids.wrongStreamSegment}', '2026-09-25T12:00:00Z', '2026-09-25', '-12.3456', 'USD', '${ids.membership}'),
        ('${ids.effectiveCostEvent}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${ids.effectiveSegment}', '2026-09-25T15:59:00Z', '2026-09-25', '-12.3456', 'USD', '${ids.membership}'),
        ('${ids.businessCostEvent}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${ids.businessSegment}', '2026-09-25T20:00:00Z', '2026-09-26', '-12.3456', 'USD', '${ids.membership}')
      on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.phase2Session, 'a122-phase2-session-token', ids.actor, true);
    await seedActiveStepUp(client, ids.phase2Session, ids.tenant);
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

  it('posts late receipt revaluations transactionally and incrementally through inventory commands', async () => {
    await setContext(ids.tenant, ids.stationTwo);
    await client.unsafe(`
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state, opened_at)
      values ('${phase.day}', '${ids.tenant}', '${ids.stationTwo}', '2026-09-27', 'NOT_STARTED', null);
      update app.station_business_days set state='OPEN', opened_at='2026-09-27T00:00:00Z'
      where id='${phase.day}';
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date, opened_at)
      values ('${phase.shift}', '${ids.tenant}', '${ids.stationTwo}', '${phase.day}', 'PLANNED', '2026-09-27T00:00:00Z', '2026-09-28T00:00:00Z', '2026-09-27', null);
      update app.shifts set state='OPEN', opened_at='2026-09-27T00:00:00Z'
      where id='${phase.shift}';
      insert into app.pumps (id, tenant_id, station_id, number, status)
      values ('${phase.pump}', '${ids.tenant}', '${ids.stationTwo}', 'A122-PHASE2', 'ACTIVE');
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
      values ('${phase.nozzle}', '${ids.tenant}', '${ids.stationTwo}', '${phase.pump}', '1', '${ids.productTwo}', 'ACTIVE');
      insert into app.meters (id, tenant_id, serial_number)
      values ('${phase.meter}', '${ids.tenant}', 'A122-PHASE2-METER');
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
      values ('${phase.installation}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.meter}', '2026-09-27T00:00:00Z', '${ids.membership}');
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${phase.openingBoundary}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.installation}', '${phase.day}', '${phase.shift}', 'SHIFT_OPEN', 'AVAILABLE', '0.000', '2026-09-27T05:00:00Z', '2026-09-27T05:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${phase.closingBoundary}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.installation}', '${phase.day}', '${phase.shift}', 'SHIFT_CLOSE', 'AVAILABLE', '10.000', '2026-09-27T08:00:00Z', '2026-09-27T08:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}');
      insert into app.meter_segments
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, expected_sale_value, currency, boundary_reason, segment_start_at, segment_end_at, sealed_at, state, version)
      values ('${phase.segment}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.installation}', '${phase.day}', '${phase.shift}', '${phase.openingBoundary}', '${phase.closingBoundary}', '${ids.productTwo}', '${ids.membership}', '${ids.membership}', '0.000', '10.000', '10.000', '1.500000', '15.0000', 'USD', 'SHIFT_CLOSE', '2026-09-27T05:00:00Z', '2026-09-27T08:00:00Z', '2026-09-27T08:00:01Z', 'OPEN', 0);
      select app.seal_meter_segment('${ids.tenant}', '${ids.stationTwo}', '${phase.segment}', 0);
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${phase.secondOpeningBoundary}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.installation}', '${phase.day}', '${phase.shift}', 'SHIFT_OPEN', 'AVAILABLE', '10.000', '2026-09-27T09:00:00Z', '2026-09-27T09:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${phase.secondClosingBoundary}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.installation}', '${phase.day}', '${phase.shift}', 'SHIFT_CLOSE', 'AVAILABLE', '20.000', '2026-09-27T10:00:00Z', '2026-09-27T10:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}');
      insert into app.meter_segments
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, expected_sale_value, currency, boundary_reason, segment_start_at, segment_end_at, sealed_at, state, version)
      values ('${phase.secondSegment}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.installation}', '${phase.day}', '${phase.shift}', '${phase.secondOpeningBoundary}', '${phase.secondClosingBoundary}', '${ids.productTwo}', '${ids.membership}', '${ids.membership}', '10.000', '20.000', '10.000', '1.500000', '15.0000', 'USD', 'SHIFT_CLOSE', '2026-09-27T09:00:00Z', '2026-09-27T10:00:00Z', '2026-09-27T10:00:01Z', 'OPEN', 0);
      select app.seal_meter_segment('${ids.tenant}', '${ids.stationTwo}', '${phase.secondSegment}', 0);
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
      values
        ('${phase.openingLateOpeningBoundary}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.installation}', '${phase.day}', '${phase.shift}', 'SHIFT_OPEN', 'AVAILABLE', '20.000', '2026-09-27T11:00:00Z', '2026-09-27T11:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
        ('${phase.openingLateClosingBoundary}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.installation}', '${phase.day}', '${phase.shift}', 'SHIFT_CLOSE', 'AVAILABLE', '30.000', '2026-09-27T12:00:00Z', '2026-09-27T12:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}');
      insert into app.meter_segments
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, expected_sale_value, currency, boundary_reason, segment_start_at, segment_end_at, sealed_at, state, version)
      values ('${phase.openingLateSegment}', '${ids.tenant}', '${ids.stationTwo}', '${phase.nozzle}', '${phase.installation}', '${phase.day}', '${phase.shift}', '${phase.openingLateOpeningBoundary}', '${phase.openingLateClosingBoundary}', '${ids.productTwo}', '${ids.membership}', '${ids.membership}', '20.000', '30.000', '10.000', '1.500000', '15.0000', 'USD', 'SHIFT_CLOSE', '2026-09-27T11:00:00Z', '2026-09-27T12:00:00Z', '2026-09-27T12:00:01Z', 'OPEN', 0);
      select app.seal_meter_segment('${ids.tenant}', '${ids.stationTwo}', '${phase.openingLateSegment}', 0);
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values
        ('${phase.openingMovement}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', 'OPENING_BALANCE', '100.000', '2026-09-27T04:00:00Z', '2026-09-27', 'OPENING_BALANCE', '${phase.openingSource}', '${ids.membership}'),
        ('${phase.saleMovement}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', 'SALE', '-10.000', '2026-09-27T08:00:00Z', '2026-09-27', 'METER_SEGMENT_SALE', '${phase.segment}', '${ids.membership}'),
        ('${phase.secondSaleMovement}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', 'SALE', '-10.000', '2026-09-27T10:00:00Z', '2026-09-27', 'METER_SEGMENT_SALE', '${phase.secondSegment}', '${ids.membership}'),
        ('${phase.openingLateDeliveryMovement}', '${ids.tenant}', '${ids.stationTwo}', '${phase.openingLateTank}', '${ids.productTwo}', 'DELIVERY', '100.000', '2026-09-27T07:00:00Z', '2026-09-27', 'FUEL_DELIVERY_ALLOCATION', '${phase.openingLateAllocation}', '${ids.membership}'),
        ('${phase.openingLateSaleMovement}', '${ids.tenant}', '${ids.stationTwo}', '${phase.openingLateTank}', '${ids.productTwo}', 'SALE', '-10.000', '2026-09-27T12:00:00Z', '2026-09-27', 'METER_SEGMENT_SALE', '${phase.openingLateSegment}', '${ids.membership}');
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date, note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by, confirmed_by, confirmed_at)
      values ('${phase.openingLateDelivery}', '${ids.tenant}', '${ids.stationTwo}', '${ids.productTwo}', 'A122-PHASE2-OPENING', '2026-09-27T07:00:00Z', '2026-09-27', '100.000', '100.000', '0.000', 'CONFIRMED', '${ids.membership}', '${ids.membership}', '2026-09-27T07:00:01Z');
      insert into app.fuel_delivery_allocations
        (id, tenant_id, station_id, delivery_id, tank_id, product_id, quantity_litres)
      values ('${phase.openingLateAllocation}', '${ids.tenant}', '${ids.stationTwo}', '${phase.openingLateDelivery}', '${phase.openingLateTank}', '${ids.productTwo}', '100.000');
      insert into app.inventory_cost_events
        (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at, business_date, amount, currency, actor_membership_id)
      values
        ('${phase.openingCostEvent}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', 'OPENING_COST', 'OPENING_BALANCE', '${phase.openingSource}', '2026-09-27T04:00:00Z', '2026-09-27', '100.0000', 'USD', '${ids.membership}'),
        ('${phase.saleCostEvent}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${phase.segment}', '2026-09-27T08:00:00Z', '2026-09-27', '-10.0000', 'USD', '${ids.membership}'),
        ('${phase.secondSaleCostEvent}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${phase.secondSegment}', '2026-09-27T10:00:00Z', '2026-09-27', '-10.0000', 'USD', '${ids.membership}'),
        ('${phase.openingLateReceiptCost}', '${ids.tenant}', '${ids.stationTwo}', '${phase.openingLateTank}', '${ids.productTwo}', 'RECEIPT_COST', 'FUEL_DELIVERY_ALLOCATION', '${phase.openingLateAllocation}', '2026-09-27T07:00:00Z', '2026-09-27', '100.0000', 'USD', '${ids.membership}'),
        ('${phase.openingLateSaleCost}', '${ids.tenant}', '${ids.stationTwo}', '${phase.openingLateTank}', '${ids.productTwo}', 'SALE_COGS', 'METER_SEGMENT_SALE', '${phase.openingLateSegment}', '2026-09-27T12:00:00Z', '2026-09-27', '-10.0000', 'USD', '${ids.membership}');
      insert into app.inventory_sale_cost_attributions
        (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id, sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis, replay_fingerprint, sale_cost_event_id, effective_at, business_date)
      values ('${phase.saleAttribution}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', '${phase.saleMovement}', '${phase.segment}', '10.000', '1.00000000', '10.0000', 'VALUED', 'PRE_SALE_WAC', 'a122-phase2-original', '${phase.saleCostEvent}', '2026-09-27T08:00:00Z', '2026-09-27');
      insert into app.inventory_sale_cost_attributions
        (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id, sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis, replay_fingerprint, sale_cost_event_id, effective_at, business_date)
      values ('${phase.secondSaleAttribution}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', '${phase.secondSaleMovement}', '${phase.secondSegment}', '10.000', '1.00000000', '10.0000', 'VALUED', 'PRE_SALE_WAC', 'a122-phase2-original-2', '${phase.secondSaleCostEvent}', '2026-09-27T10:00:00Z', '2026-09-27');
      insert into app.inventory_sale_cost_attributions
        (id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id, sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis, replay_fingerprint, sale_cost_event_id, effective_at, business_date)
      values ('${phase.openingLateAttribution}', '${ids.tenant}', '${ids.stationTwo}', '${phase.openingLateTank}', '${ids.productTwo}', '${phase.openingLateSaleMovement}', '${phase.openingLateSegment}', '10.000', '1.00000000', '10.0000', 'VALUED', 'PRE_SALE_WAC', 'a122-phase2-opening-original', '${phase.openingLateSaleCost}', '2026-09-27T12:00:00Z', '2026-09-27');
    `);

    const createdDelivery = await postInventoryCommand(
      {
        commandType: 'CreateDelivery',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        productId: ids.productTwo,
        deliveryNoteNumber: 'A122-PHASE2-1',
        deliveredAt: '2026-09-27T07:00:00Z',
        noteQuantityLitres: '100.000',
        actualQuantityLitres: '100.000',
        allocations: [{ tankId: ids.tankTwo, quantityLitres: '100.000' }],
      },
      'a122-phase2-create-delivery-1',
    );
    expect(createdDelivery.status).toBe(200);
    const createdDeliveryBody = (await createdDelivery.json()) as {
      deliveryId: string;
      allocationIds: string[];
    };
    const confirmedDelivery = await postInventoryCommand(
      {
        commandType: 'ConfirmDelivery',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        deliveryId: createdDeliveryBody.deliveryId,
      },
      'a122-phase2-confirm-delivery-1',
    );
    expect(confirmedDelivery.status).toBe(200);
    const firstAllocationId = createdDeliveryBody.allocationIds[0]!;
    const unvaluedAfterConfirmation = await client.unsafe<
      {
        quantity_litres: string;
        inventory_value: string | null;
        weighted_average_cost: string | null;
        currency: string | null;
        movement_id: string | null;
        cost_count: string;
      }[]
    >(`
      select state.quantity_litres::text as quantity_litres,
             state.inventory_value::text as inventory_value,
             state.weighted_average_cost::text as weighted_average_cost,
             state.currency,
             (select id::text from app.inventory_movements movement
              where movement.tenant_id=state.tenant_id and movement.station_id=state.station_id
                and movement.tank_id=state.tank_id and movement.product_id=state.product_id
                and movement.source_type='FUEL_DELIVERY_ALLOCATION' and movement.source_id='${firstAllocationId}') as movement_id,
             (select count(*)::text from app.inventory_cost_events event
              where event.tenant_id=state.tenant_id and event.station_id=state.station_id
                and event.tank_id=state.tank_id and event.product_id=state.product_id
                and event.source_type='FUEL_DELIVERY_ALLOCATION' and event.source_id='${firstAllocationId}') as cost_count
      from app.inventory_cost_stream_state state
      where state.tenant_id='${ids.tenant}' and state.station_id='${ids.stationTwo}'
        and state.tank_id='${ids.tankTwo}' and state.product_id='${ids.productTwo}'
    `);
    expect(unvaluedAfterConfirmation).toEqual([
      {
        quantity_litres: '180.000',
        inventory_value: null,
        weighted_average_cost: null,
        currency: null,
        movement_id: expect.any(String),
        cost_count: '0',
      },
    ]);

    const openingBalance = await postInventoryCommand(
      {
        commandType: 'RecordOpeningBalance',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        tankId: phase.openingLateTank,
        quantityLitres: '50.000',
        effectiveAt: '2026-09-27T06:00:00Z',
      },
      'a122-phase2-record-late-opening',
    );
    expect(openingBalance.status).toBe(200);
    const openingBalanceBody = (await openingBalance.json()) as {
      movementId: string;
      sourceId: string;
    };
    const unvaluedOpening = await client.unsafe<
      {
        quantity_litres: string;
        inventory_value: string | null;
        weighted_average_cost: string | null;
        currency: string | null;
        opening_cost_count: string;
      }[]
    >(`
      select state.quantity_litres::text as quantity_litres,
             state.inventory_value::text as inventory_value,
             state.weighted_average_cost::text as weighted_average_cost,
             state.currency,
             (select count(*)::text from app.inventory_cost_events event
              where event.tenant_id=state.tenant_id and event.station_id=state.station_id
                and event.tank_id=state.tank_id and event.product_id=state.product_id
                and event.event_type='OPENING_COST' and event.source_id='${openingBalanceBody.sourceId}') as opening_cost_count
      from app.inventory_cost_stream_state state
      where state.tenant_id='${ids.tenant}' and state.station_id='${ids.stationTwo}'
        and state.tank_id='${phase.openingLateTank}' and state.product_id='${ids.productTwo}'
    `);
    expect(unvaluedOpening).toEqual([
      {
        quantity_litres: '140.000',
        inventory_value: null,
        weighted_average_cost: null,
        currency: null,
        opening_cost_count: '0',
      },
    ]);
    const openingRequest = await postInventoryCommand(
      {
        commandType: 'RequestInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        tankId: phase.openingLateTank,
        productId: ids.productTwo,
        sourceType: 'OPENING_BALANCE',
        sourceId: openingBalanceBody.sourceId,
        amount: '50.0000',
        currency: 'USD',
        reason: 'Late historical opening cost',
      },
      'a122-phase2-request-late-opening',
    );
    expect(openingRequest.status).toBe(200);
    const openingRequestBody = (await openingRequest.json()) as { revaluationId: string };
    expect(
      (
        await postInventoryCommand(
          {
            commandType: 'ApproveInventoryCostRevaluation',
            tenantId: ids.tenant,
            stationId: ids.stationTwo,
            revaluationId: openingRequestBody.revaluationId,
          },
          'a122-phase2-approve-late-opening',
        )
      ).status,
    ).toBe(200);
    const openingPosted = await postInventoryCommand(
      {
        commandType: 'PostInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        revaluationId: openingRequestBody.revaluationId,
      },
      'a122-phase2-post-late-opening',
    );
    expect(openingPosted.status).toBe(200);
    const valuedOpening = await client.unsafe<
      { quantity_litres: string; inventory_value: string; valuation_status: string }[]
    >(`
      select quantity_litres::text as quantity_litres,
             inventory_value::text as inventory_value,
             valuation_status
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.stationTwo}'
        and tank_id='${phase.openingLateTank}' and product_id='${ids.productTwo}'
    `);
    expect(valuedOpening).toEqual([
      { quantity_litres: '140.000', inventory_value: '140.0000', valuation_status: 'VALUED' },
    ]);
    const preservedOpeningSale = await client.unsafe<
      { original_cogs: string; replay_fingerprint: string }[]
    >(`
      select original_cogs, replay_fingerprint
      from app.inventory_sale_cost_attributions
      where id='${phase.openingLateAttribution}'
    `);
    expect(preservedOpeningSale).toEqual([
      { original_cogs: '10.0000', replay_fingerprint: 'a122-phase2-opening-original' },
    ]);

    const requestPayload = {
      commandType: 'RequestInventoryCostRevaluation',
      tenantId: ids.tenant,
      stationId: ids.stationTwo,
      tankId: ids.tankTwo,
      productId: ids.productTwo,
      sourceType: 'FUEL_DELIVERY_ALLOCATION',
      sourceId: firstAllocationId,
      amount: '200.0000',
      currency: 'USD',
      reason: 'Late confirmed receipt cost',
    };
    for (const boundary of ['restatementFromAt', 'restatementThroughAt'] as const) {
      const bounded = await postInventoryCommand(
        { ...requestPayload, [boundary]: '2026-09-27T08:00:00Z' },
        `a122-phase2-bounded-${boundary}`,
      );
      expect(bounded.status).toBe(400);
      await expect(bounded.json()).resolves.toMatchObject({
        error: 'VALIDATION_FAILED',
        message:
          'Bounded restatement is deferred from v1; non-null boundary values are not supported',
      });
    }
    const boundedEnvelopeCount = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count
      from app.inventory_cost_revaluations
      where tenant_id='${ids.tenant}' and station_id='${ids.stationTwo}'
        and source_type='FUEL_DELIVERY_ALLOCATION' and source_id='${phase.firstAllocation}'
    `);
    expect(boundedEnvelopeCount).toEqual([{ count: '0' }]);

    const requested = await postInventoryCommand(requestPayload, 'a122-phase2-request-1');
    expect(requested.status).toBe(200);
    const requestedBody = (await requested.json()) as { revaluationId: string; status: string };
    phase2PostedRevaluationId = requestedBody.revaluationId;
    expect(requestedBody.status).toBe('REQUESTED');
    const approved = await postInventoryCommand(
      {
        commandType: 'ApproveInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        revaluationId: requestedBody.revaluationId,
      },
      'a122-phase2-approve-1',
    );
    expect(approved.status).toBe(200);
    const posted = await postInventoryCommand(
      {
        commandType: 'PostInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        revaluationId: requestedBody.revaluationId,
      },
      'a122-phase2-post-1',
    );
    expect(posted.status).toBe(200);
    const postedBody = await posted.json();

    const firstEvidence = await client.unsafe<
      {
        revaluation_status: string;
        sale_movement_id: string;
        ordinary_effective_at: string;
        original_cogs: string;
        cogs_delta: string;
        event_source_type: string;
        event_source_id: string;
        event_effective_at: string;
        event_amount: string;
        inventory_value: string;
        weighted_average_cost: string;
        quantity_litres: string;
        movement_count: string;
      }[]
    >(`
      select r.status as revaluation_status,
             line.sale_movement_id,
             ordinary.effective_at::text as ordinary_effective_at,
             line.original_cogs::text as original_cogs,
             line.cogs_delta::text as cogs_delta,
             event.source_type as event_source_type,
             event.source_id::text as event_source_id,
             event.effective_at::text as event_effective_at,
             event.amount::text as event_amount,
             state.inventory_value::text as inventory_value,
             state.weighted_average_cost::text as weighted_average_cost,
             state.quantity_litres::text as quantity_litres,
             (select count(*)::text from app.inventory_movements where tenant_id='${ids.tenant}' and station_id='${ids.stationTwo}' and tank_id='${ids.tankTwo}' and product_id='${ids.productTwo}') as movement_count
      from app.inventory_cost_revaluations r
      join app.inventory_cost_revaluation_lines line on line.tenant_id=r.tenant_id and line.revaluation_id=r.id
      join app.inventory_cost_events event on event.tenant_id=line.tenant_id and event.id=line.cogs_revaluation_event_id
      join app.inventory_cost_events ordinary on ordinary.tenant_id=r.tenant_id and ordinary.source_type=r.source_type and ordinary.source_id=r.source_id and ordinary.event_type='RECEIPT_COST'
      join app.inventory_cost_stream_state state on state.tenant_id=r.tenant_id and state.station_id=r.station_id and state.tank_id=r.tank_id and state.product_id=r.product_id
      where r.id='${requestedBody.revaluationId}'
      order by line.sale_effective_at, line.sale_movement_id
    `);
    expect(firstEvidence).toEqual([
      {
        revaluation_status: 'POSTED',
        sale_movement_id: phase.saleMovement,
        ordinary_effective_at: '2026-09-27 07:00:00+00',
        original_cogs: '10.0000',
        cogs_delta: '5.0000',
        event_source_type: 'INVENTORY_COST_REVALUATION_LINE',
        event_source_id: expect.any(String),
        event_effective_at: '2026-09-27 08:00:00+00',
        event_amount: '5.0000',
        inventory_value: '270.0000',
        weighted_average_cost: '1.50000000',
        quantity_litres: '180.000',
        movement_count: '4',
      },
      {
        revaluation_status: 'POSTED',
        sale_movement_id: phase.secondSaleMovement,
        ordinary_effective_at: '2026-09-27 07:00:00+00',
        original_cogs: '10.0000',
        cogs_delta: '5.0000',
        event_source_type: 'INVENTORY_COST_REVALUATION_LINE',
        event_source_id: expect.any(String),
        event_effective_at: '2026-09-27 10:00:00+00',
        event_amount: '5.0000',
        inventory_value: '270.0000',
        weighted_average_cost: '1.50000000',
        quantity_litres: '180.000',
        movement_count: '4',
      },
    ]);
    expect(firstEvidence[0]!.event_source_id).toBe(
      (
        await client.unsafe<{ id: string }[]>(
          `select id::text as id from app.inventory_cost_revaluation_lines where revaluation_id='${requestedBody.revaluationId}'`,
        )
      )[0]!.id,
    );
    expect(postedBody.conservation).toMatchObject({
      lateCostAmount: '200.0000',
      cogsDeltaTotal: '10.0000',
      endingInventoryValueIncrease: '190.0000',
      residual: '0.0000',
    });

    const retry = await postInventoryCommand(
      {
        commandType: 'PostInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        revaluationId: requestedBody.revaluationId,
      },
      'a122-phase2-post-1',
    );
    expect(await retry.json()).toEqual(postedBody);
    expect(
      (
        await postInventoryCommand(
          { ...requestPayload, amount: '201.0000' },
          'a122-phase2-request-1',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await postInventoryCommand(
          { ...requestPayload, amount: '200.0000' },
          'a122-phase2-request-reused-source',
        )
      ).status,
    ).toBe(409);

    await client.unsafe(`
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date, note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by, confirmed_by, confirmed_at)
      values ('${phase.secondDelivery}', '${ids.tenant}', '${ids.stationTwo}', '${ids.productTwo}', 'A122-PHASE2-2', '2026-09-27T06:00:00Z', '2026-09-27', '100.000', '100.000', '0.000', 'CONFIRMED', '${ids.membership}', '${ids.membership}', '2026-09-27T09:00:00Z');
      insert into app.fuel_delivery_allocations (id, tenant_id, station_id, delivery_id, tank_id, product_id, quantity_litres)
      values ('${phase.secondAllocation}', '${ids.tenant}', '${ids.stationTwo}', '${phase.secondDelivery}', '${ids.tankTwo}', '${ids.productTwo}', '100.000');
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values ('${phase.secondMovement}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', 'DELIVERY', '100.000', '2026-09-27T06:00:00Z', '2026-09-27', 'FUEL_DELIVERY_ALLOCATION', '${phase.secondAllocation}', '${ids.membership}');
    `);
    const secondRequest = await postInventoryCommand(
      { ...requestPayload, sourceId: phase.secondAllocation, amount: '100.0000' },
      'a122-phase2-request-2',
    );
    const secondRequestBody = (await secondRequest.json()) as { revaluationId: string };
    const secondApproved = await postInventoryCommand(
      {
        commandType: 'ApproveInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        revaluationId: secondRequestBody.revaluationId,
      },
      'a122-phase2-approve-2',
    );
    expect(secondApproved.status).toBe(200);
    const secondPosted = await postInventoryCommand(
      {
        commandType: 'PostInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        revaluationId: secondRequestBody.revaluationId,
      },
      'a122-phase2-post-2',
    );
    expect(secondPosted.status).toBe(200);
    const finalProjection = await client.unsafe<
      { inventory_value: string; quantity_litres: string }[]
    >(`
      select inventory_value::text as inventory_value, quantity_litres::text as quantity_litres
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.stationTwo}' and tank_id='${ids.tankTwo}' and product_id='${ids.productTwo}'
    `);
    expect(finalProjection).toEqual([{ inventory_value: '373.3334', quantity_litres: '280.000' }]);

    const beforeRollback = await client.unsafe<{ projection_version: number }[]>(`
      select projection_version from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.stationTwo}' and tank_id='${ids.tankTwo}' and product_id='${ids.productTwo}'
    `);
    await client.unsafe(`
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date, note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by, confirmed_by, confirmed_at)
      values ('${phase.thirdDelivery}', '${ids.tenant}', '${ids.stationTwo}', '${ids.productTwo}', 'A122-PHASE2-3', '2026-09-27T05:30:00Z', '2026-09-27', '100.000', '100.000', '0.000', 'CONFIRMED', '${ids.membership}', '${ids.membership}', '2026-09-27T09:00:00Z');
      insert into app.fuel_delivery_allocations (id, tenant_id, station_id, delivery_id, tank_id, product_id, quantity_litres)
      values ('${phase.thirdAllocation}', '${ids.tenant}', '${ids.stationTwo}', '${phase.thirdDelivery}', '${ids.tankTwo}', '${ids.productTwo}', '100.000');
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values ('${phase.thirdMovement}', '${ids.tenant}', '${ids.stationTwo}', '${ids.tankTwo}', '${ids.productTwo}', 'DELIVERY', '100.000', '2026-09-27T05:30:00Z', '2026-09-27', 'FUEL_DELIVERY_ALLOCATION', '${phase.thirdAllocation}', '${ids.membership}');
    `);
    const mismatchRequest = await postInventoryCommand(
      { ...requestPayload, sourceId: phase.thirdAllocation, amount: '100.0000', currency: 'ZWL' },
      'a122-phase2-request-3',
    );
    const mismatchRequestBody = (await mismatchRequest.json()) as { revaluationId: string };
    await postInventoryCommand(
      {
        commandType: 'ApproveInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.stationTwo,
        revaluationId: mismatchRequestBody.revaluationId,
      },
      'a122-phase2-approve-3',
    );
    expect(
      (
        await postInventoryCommand(
          {
            commandType: 'PostInventoryCostRevaluation',
            tenantId: ids.tenant,
            stationId: ids.stationTwo,
            revaluationId: mismatchRequestBody.revaluationId,
          },
          'a122-phase2-post-3',
        )
      ).status,
    ).toBe(409);
    const rollback = await client.unsafe<
      { status: string; event_count: string; line_count: string; projection_version: number }[]
    >(`
      select r.status,
             (select count(*)::text from app.inventory_cost_events where tenant_id=r.tenant_id and source_type='FUEL_DELIVERY_ALLOCATION' and source_id=r.source_id and event_type='RECEIPT_COST') as event_count,
             (select count(*)::text from app.inventory_cost_revaluation_lines where revaluation_id=r.id) as line_count,
             (select projection_version from app.inventory_cost_stream_state where tenant_id=r.tenant_id and station_id=r.station_id and tank_id=r.tank_id and product_id=r.product_id) as projection_version
      from app.inventory_cost_revaluations r where r.id='${mismatchRequestBody.revaluationId}'
    `);
    expect(rollback).toEqual([
      {
        status: 'APPROVED',
        event_count: '0',
        line_count: '0',
        projection_version: beforeRollback[0]!.projection_version,
      },
    ]);
  });

  it('serves an operator read model with station isolation and persisted revaluation lineage', async () => {
    await setContext(ids.tenant, ids.stationTwo);
    const stationTwoResponse = await getInventoryValuation(ids.tenant, ids.stationTwo);
    expect(stationTwoResponse.status).toBe(200);
    const stationTwoBody = (await stationTwoResponse.json()) as {
      streams: Array<{ station: { id: string }; quantityLitres: string }>;
      revaluations: Array<{ id: string; status: string; affectedSales: number }>;
      tankReport: {
        filters: { toDate: string };
        inventory: {
          rows: Array<{
            stationId: string;
            expectedLitres: string;
            capacityLitres: string;
          }>;
        };
      };
    };
    expect(stationTwoBody.tankReport.filters.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stationTwoBody.tankReport.inventory.rows.length).toBeGreaterThan(0);
    for (const tank of stationTwoBody.tankReport.inventory.rows) {
      expect(tank.stationId).toBe(ids.stationTwo);
      expect(typeof tank.expectedLitres).toBe('string');
      expect(typeof tank.capacityLitres).toBe('string');
      expect(tank).not.toHaveProperty('movementIds');
      expect(tank).not.toHaveProperty('deliveryIds');
    }
    for (const stream of stationTwoBody.streams)
      expect(typeof stream.quantityLitres).toBe('string');
    expect(stationTwoBody).not.toHaveProperty('sales');
    expect(stationTwoBody).not.toHaveProperty('suppliers');
    expect(stationTwoBody.streams.every((stream) => stream.station.id === ids.stationTwo)).toBe(
      true,
    );
    expect(
      stationTwoBody.revaluations.some(
        (item) => item.status === 'POSTED' && item.affectedSales > 0,
      ),
    ).toBe(true);
    const postedRevaluation = stationTwoBody.revaluations.find((item) => item.status === 'POSTED');
    expect(postedRevaluation).toBeDefined();
    const detailResponse = await getInventoryRevaluation(
      ids.tenant,
      ids.stationTwo,
      postedRevaluation!.id,
    );
    expect(detailResponse.status).toBe(200);
    const detailBody = (await detailResponse.json()) as {
      revaluation: {
        costAllocation: Record<string, unknown> | null;
        currentStreamProjection: Record<string, unknown>;
      };
    };
    expect(detailBody.revaluation.costAllocation).not.toHaveProperty('isConserved');
    expect(detailBody.revaluation.costAllocation).toHaveProperty('impliedEndingInventoryIncrease');
    expect(detailBody.revaluation).not.toHaveProperty('resultingProjection');
    expect(detailBody.revaluation.currentStreamProjection).toBeDefined();

    await setContext(ids.tenant, ids.station);
    const otherStationResponse = await getInventoryValuation(ids.tenant, ids.station);
    expect(otherStationResponse.status).toBe(200);
    const otherStationBody = (await otherStationResponse.json()) as {
      streams: Array<{ station: { id: string } }>;
      revaluations: Array<{ station: { id: string } }>;
    };
    expect(otherStationBody.streams.every((stream) => stream.station.id === ids.station)).toBe(
      true,
    );
    expect(otherStationBody.revaluations.every((item) => item.station.id === ids.station)).toBe(
      true,
    );
  });

  it('enforces tenant and station isolation for revaluation reads and transitions', async () => {
    expect(phase2PostedRevaluationId).toBeTruthy();
    const revaluationId = phase2PostedRevaluationId!;
    await client.unsafe('set role app_runtime');
    try {
      await setContext(ids.tenant, ids.station);
      const otherStationEnvelope = await client.unsafe<{ id: string }[]>(
        `select id::text as id from app.inventory_cost_revaluations where id='${revaluationId}'`,
      );
      const otherStationLines = await client.unsafe<{ id: string }[]>(
        `select id::text as id from app.inventory_cost_revaluation_lines where revaluation_id='${revaluationId}'`,
      );
      expect(otherStationEnvelope).toEqual([]);
      expect(otherStationLines).toEqual([]);

      await setContext('a1230000-0000-0000-0000-000000000001', ids.stationTwo);
      const otherTenantEnvelope = await client.unsafe<{ id: string }[]>(
        `select id::text as id from app.inventory_cost_revaluations where id='${revaluationId}'`,
      );
      const otherTenantLines = await client.unsafe<{ id: string }[]>(
        `select id::text as id from app.inventory_cost_revaluation_lines where revaluation_id='${revaluationId}'`,
      );
      expect(otherTenantEnvelope).toEqual([]);
      expect(otherTenantLines).toEqual([]);
    } finally {
      await client.unsafe('reset role');
    }

    await setContext(ids.tenant, ids.station);
    const approveOutsideStation = await postInventoryCommand(
      {
        commandType: 'ApproveInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.station,
        revaluationId,
      },
      'a122-phase2-rls-approve-outside-station',
    );
    expect(approveOutsideStation.status).toBe(404);
    const postOutsideStation = await postInventoryCommand(
      {
        commandType: 'PostInventoryCostRevaluation',
        tenantId: ids.tenant,
        stationId: ids.station,
        revaluationId,
      },
      'a122-phase2-rls-post-outside-station',
    );
    expect(postOutsideStation.status).toBe(404);
  });
});
