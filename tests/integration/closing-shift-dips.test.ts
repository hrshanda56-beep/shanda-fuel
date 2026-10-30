import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { tanksMissingClosingDip } from '../../src/modules/forecourt/closing-shift-dips';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the closing shift dips test.');
}

// Tenant and people are fixed; the station and all under it are new each run (dips are permanent).
const ids = {
  tenant: 'a4c00000-0000-4000-8000-000000000001',
  legal: 'a4c00000-0000-4000-8000-000000000011',
  user: 'a4c00000-0000-4000-8000-000000000031',
  membership: 'a4c00000-0000-4000-8000-000000000041',
  product: 'a4c00000-0000-4000-8000-000000000051',
  station: randomUUID(),
  tankDiesel: randomUUID(),
  tankPetrol: randomUUID(),
  day: randomUUID(),
  dayTemplate: randomUUID(),
  nightTemplate: randomUUID(),
  dayShift: randomUUID(),
  nightShift: randomUUID(),
  adHocShift: randomUUID(),
  dayRecon: randomUUID(),
  nightRecon: randomUUID(),
  adHocRecon: randomUUID(),
  dipDiesel: randomUUID(),
  dipPetrol: randomUUID(),
};
const code = ids.station.slice(0, 6);

let client: Sql;
const find = (reconciliationId: string) =>
  tanksMissingClosingDip(drizzle(client), {
    tenantId: ids.tenant,
    stationId: ids.station,
    reconciliationId,
  });

describe('A4: the last shift of the day needs a dip for every active tank', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A4 Dips Tenant', 'a4-dips-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.user}', 'A4 Dips Actor', 'a4-dips-actor@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.user}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A4 Dips Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A4${code}', 'A4 Dips Station', 'ACTIVE', 'Africa/Harare');
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.tenant}', 'A4DP-DSL', 'Diesel') on conflict (id) do nothing;
      insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, status, created_by, updated_by) values
        ('${ids.tankDiesel}', '${ids.tenant}', '${ids.station}', 'T1', '${ids.product}', 10000, 'ACTIVE', '${ids.membership}', '${ids.membership}'),
        ('${ids.tankPetrol}', '${ids.tenant}', '${ids.station}', 'T2', '${ids.product}', 10000, 'ACTIVE', '${ids.membership}', '${ids.membership}');
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state) values
        ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-10-04', 'NOT_STARTED');
      insert into app.shift_templates (id, tenant_id, station_id, code, name, created_by) values
        ('${ids.dayTemplate}', '${ids.tenant}', '${ids.station}', 'DAY', 'Day', '${ids.membership}'),
        ('${ids.nightTemplate}', '${ids.tenant}', '${ids.station}', 'NIGHT', 'Night', '${ids.membership}');
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, shift_template_id, business_date) values
        ('${ids.dayShift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-10-04T04:00:00Z', '2026-10-04T16:00:00Z', '${ids.dayTemplate}', '2026-10-04'),
        ('${ids.nightShift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-10-04T16:00:00Z', '2026-10-05T04:00:00Z', '${ids.nightTemplate}', '2026-10-04'),
        ('${ids.adHocShift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-10-05T04:00:00Z', '2026-10-05T05:00:00Z', null, '2026-10-04');
      insert into app.reconciliations (id, tenant_id, station_id, business_day_id, shift_id, supervisor_id, created_by, state) values
        ('${ids.dayRecon}', '${ids.tenant}', '${ids.station}', '${ids.day}', '${ids.dayShift}', '${ids.membership}', '${ids.membership}', 'DRAFT'),
        ('${ids.nightRecon}', '${ids.tenant}', '${ids.station}', '${ids.day}', '${ids.nightShift}', '${ids.membership}', '${ids.membership}', 'DRAFT'),
        ('${ids.adHocRecon}', '${ids.tenant}', '${ids.station}', '${ids.day}', '${ids.adHocShift}', '${ids.membership}', '${ids.membership}', 'DRAFT');
    `);
  });

  afterAll(async () => {
    await client.end();
  });

  it('is not required of an earlier shift of the day', async () => {
    expect(await find(ids.dayRecon)).toEqual([]);
  });

  it('is not required of a shift that was opened without a template', async () => {
    expect(await find(ids.adHocRecon)).toEqual([]);
  });

  it('names every tank when the closing shift has no dip at all', async () => {
    expect(await find(ids.nightRecon)).toEqual(['T1', 'T2']);
  });

  it('names only the tank still missing once one is linked', async () => {
    await client.unsafe(`
      insert into app.tank_dips (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
      values ('${ids.dipDiesel}', '${ids.tenant}', '${ids.station}', '${ids.tankDiesel}', '2026-10-04T20:00:00Z', '2026-10-04', 5000, '${ids.membership}');
      insert into app.reconciliation_dip_refs (tenant_id, station_id, reconciliation_id, dip_id, tank_id, product_id, entered_by)
      values ('${ids.tenant}', '${ids.station}', '${ids.nightRecon}', '${ids.dipDiesel}', '${ids.tankDiesel}', '${ids.product}', '${ids.membership}');
    `);
    expect(await find(ids.nightRecon)).toEqual(['T2']);
  });

  it('is clear when every active tank has a dip linked', async () => {
    await client.unsafe(`
      insert into app.tank_dips (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
      values ('${ids.dipPetrol}', '${ids.tenant}', '${ids.station}', '${ids.tankPetrol}', '2026-10-04T20:05:00Z', '2026-10-04', 6000, '${ids.membership}');
      insert into app.reconciliation_dip_refs (tenant_id, station_id, reconciliation_id, dip_id, tank_id, product_id, entered_by)
      values ('${ids.tenant}', '${ids.station}', '${ids.nightRecon}', '${ids.dipPetrol}', '${ids.tankPetrol}', '${ids.product}', '${ids.membership}');
    `);
    expect(await find(ids.nightRecon)).toEqual([]);
  });

  it('ignores a tank that is no longer active', async () => {
    await client.unsafe(`update app.tanks set status = 'INACTIVE' where id = '${ids.tankDiesel}'`);
    await client.unsafe(
      `delete from app.reconciliation_dip_refs where reconciliation_id = '${ids.nightRecon}' and tank_id = '${ids.tankPetrol}'`,
    );
    // T1 is inactive and T2's link is gone, so only T2 can be missing.
    expect(await find(ids.nightRecon)).toEqual(['T2']);
  });
});
