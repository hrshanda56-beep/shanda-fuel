import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readLockBlockers } from '../../src/modules/forecourt/lock-blockers';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the lock blockers test.');
}

// The tenant and people are fixed; the station and everything under it are new on every run,
// because dips can never be deleted and the counts must start from nothing.
const ids = {
  tenant: 'a5c00000-0000-4000-8000-000000000001',
  legal: 'a5c00000-0000-4000-8000-000000000011',
  user: 'a5c00000-0000-4000-8000-000000000031',
  membership: 'a5c00000-0000-4000-8000-000000000041',
  product: 'a5c00000-0000-4000-8000-000000000051',
  station: randomUUID(),
  tank: randomUUID(),
  day: randomUUID(),
  shiftA: randomUUID(),
  shiftB: randomUUID(),
  reconA: randomUUID(),
  reconB: randomUUID(),
  dipOtherDay: randomUUID(),
  dipToday: randomUUID(),
};
const stationCode = `A5${ids.station.slice(0, 6)}`;

let client: Sql;
const scope = { tenantId: ids.tenant, stationId: ids.station, businessDayId: ids.day };

describe('A5: what stops a business day from being locked', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A5 Lock Tenant', 'a5-lock-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.user}', 'A5 Lock Actor', 'a5-lock-actor@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.user}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A5 Lock Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', '${stationCode}', 'A5 Lock Station', 'ACTIVE', 'Africa/Harare');
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.tenant}', 'A5LK-DSL', 'Diesel') on conflict (id) do nothing;
      insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, status, created_by, updated_by) values
        ('${ids.tank}', '${ids.tenant}', '${ids.station}', 'T1', '${ids.product}', 10000, 'ACTIVE', '${ids.membership}', '${ids.membership}');
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state) values
        ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-10-03', 'NOT_STARTED');
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date) values
        ('${ids.shiftA}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-10-03T04:00:00Z', '2026-10-03T12:00:00Z', '2026-10-03'),
        ('${ids.shiftB}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-10-03T12:00:00Z', '2026-10-03T20:00:00Z', '2026-10-03');
      insert into app.reconciliations (id, tenant_id, station_id, business_day_id, shift_id, supervisor_id, created_by, state) values
        ('${ids.reconA}', '${ids.tenant}', '${ids.station}', '${ids.day}', '${ids.shiftA}', '${ids.membership}', '${ids.membership}', 'DRAFT'),
        ('${ids.reconB}', '${ids.tenant}', '${ids.station}', '${ids.day}', '${ids.shiftB}', '${ids.membership}', '${ids.membership}', 'DRAFT');
    `);
  });

  afterAll(async () => {
    await client.end();
  });

  const read = () => readLockBlockers(drizzle(client), scope);

  it('names reports not submitted and a tank with no dip', async () => {
    const result = await read();
    expect(result.counts).toMatchObject({
      draft: 2,
      submitted: 0,
      returned: 0,
      tanksWithoutDip: 1,
    });
    expect(result.reason).toBe(
      '2 shift reports are not submitted yet. 1 tank has no dip reading for this day.',
    );
  });

  it('counts a dip recorded on another day as still missing for this day', async () => {
    await client.unsafe(`
      insert into app.tank_dips (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
      values ('${ids.dipOtherDay}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '2026-10-02T10:00:00Z', '2026-10-02', 5000, '${ids.membership}');
    `);
    expect((await read()).counts.tanksWithoutDip).toBe(1);
  });

  it('is clear for the tank once it has a dip on the day', async () => {
    await client.unsafe(`
      insert into app.tank_dips (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
      values ('${ids.dipToday}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '2026-10-03T10:00:00Z', '2026-10-03', 4800, '${ids.membership}');
    `);
    expect((await read()).counts.tanksWithoutDip).toBe(0);
  });

  it('ignores a dip that was voided', async () => {
    await client.unsafe(`
      update app.tank_dips set voided_at = now(), voided_by = '${ids.membership}', void_reason = 'Entered in error'
      where id = '${ids.dipToday}';
    `);
    expect((await read()).counts.tanksWithoutDip).toBe(1);
  });
});
