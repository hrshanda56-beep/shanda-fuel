import { seedClerkSession, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the meter-not-set-up shift close test.');
}

// Tenant and people are fixed; the station and all under it are new each run.
const ids = {
  tenant: 'a3d00000-0000-4000-8000-000000000001',
  legal: 'a3d00000-0000-4000-8000-000000000011',
  actor: 'a3d00000-0000-4000-8000-000000000031',
  membership: 'a3d00000-0000-4000-8000-000000000041',
  session: 'a3d00000-0000-4000-8000-000000000051',
  product: 'a3d00000-0000-4000-8000-000000000061',
  station: randomUUID(),
  pump: randomUUID(),
  day: randomUUID(),
  shift: randomUUID(),
  reconciliation: randomUUID(),
  nozzleWorking: randomUUID(),
  nozzleLateA: randomUUID(),
  nozzleLateB: randomUUID(),
  meterWorking: randomUUID(),
  meterLateA: randomUUID(),
  meterLateB: randomUUID(),
  installationWorking: randomUUID(),
  installationLateA: randomUUID(),
  installationLateB: randomUUID(),
};
const stationCode = `A3D${ids.station.slice(0, 5)}`;

let client: Sql;

async function closeMeters(version: number) {
  const input = {
    commandType: 'CloseMeters',
    tenantId: ids.tenant,
    stationId: ids.station,
    businessDayId: ids.day,
    shiftId: ids.shift,
    expectedVersion: version,
  };
  return forecourtCommandPost(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders('a3d-session-token', input),
        'content-type': 'application/json',
        'idempotency-key': `a3d-close-${randomUUID()}`,
      },
      body: JSON.stringify(input),
    }),
  );
}

describe('closing a shift whose meters are not set up as working', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a3-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A3D Meter Tenant', 'a3d-meter-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.actor}', 'A3D Actor', 'a3d-actor@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A3D Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', '${stationCode}', 'A3D Station', 'ACTIVE', 'Africa/Harare');
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.membership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict do nothing;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.tenant}', 'A3D-DIESEL', 'Diesel') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number) values
        ('${ids.pump}', '${ids.tenant}', '${ids.station}', '7');
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id) values
        ('${ids.nozzleWorking}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '1', '${ids.product}'),
        ('${ids.nozzleLateA}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '2', '${ids.product}'),
        ('${ids.nozzleLateB}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '3', '${ids.product}');
      insert into app.meters (id, tenant_id, serial_number) values
        ('${ids.meterWorking}', '${ids.tenant}', 'A3D-M-${ids.meterWorking.slice(0, 6)}'),
        ('${ids.meterLateA}', '${ids.tenant}', 'A3D-M-${ids.meterLateA.slice(0, 6)}'),
        ('${ids.meterLateB}', '${ids.tenant}', 'A3D-M-${ids.meterLateB.slice(0, 6)}');
      -- Nozzle 1 has been working for years. Nozzles 2 and 3 only start AFTER the shift opened.
      insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by) values
        ('${ids.installationWorking}', '${ids.tenant}', '${ids.station}', '${ids.nozzleWorking}', '${ids.meterWorking}', '2020-01-01T00:00:00Z', '${ids.membership}'),
        ('${ids.installationLateA}', '${ids.tenant}', '${ids.station}', '${ids.nozzleLateA}', '${ids.meterLateA}', now() + interval '2 days', '${ids.membership}'),
        ('${ids.installationLateB}', '${ids.tenant}', '${ids.station}', '${ids.nozzleLateB}', '${ids.meterLateB}', now() + interval '2 days', '${ids.membership}');
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state) values
        ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-10-29', 'NOT_STARTED');
      update app.station_business_days set state = 'OPEN' where id = '${ids.day}';
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date) values
        ('${ids.shift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-10-29T04:00:00Z', '2026-10-29T16:00:00Z', '2026-10-29');
      update app.shifts set state = 'OPEN', opened_at = '2026-10-29T04:05:00Z' where id = '${ids.shift}';
      insert into app.reconciliations (id, tenant_id, station_id, business_day_id, shift_id, supervisor_id, created_by, state) values
        ('${ids.reconciliation}', '${ids.tenant}', '${ids.station}', '${ids.day}', '${ids.shift}', '${ids.membership}', '${ids.membership}', 'DRAFT');
      insert into app.reconciliation_meter_readings
        (tenant_id, station_id, reconciliation_id, shift_id, nozzle_id, product_id, opening_reading, closing_reading, litres_sold, unit_price, sales_value, entered_by)
        select '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', '${ids.shift}', n, '${ids.product}', 100, 150, 50, 1.5, 75, '${ids.membership}'
        from unnest(array['${ids.nozzleWorking}', '${ids.nozzleLateA}', '${ids.nozzleLateB}']::uuid[]) as n;
      update app.reconciliations set state = 'SUBMITTED' where id = '${ids.reconciliation}';
    `);
    await seedClerkSession(client, ids.session, 'a3d-session-token', ids.actor, true);
  });

  afterAll(async () => {
    await client.end();
  });

  it('names every nozzle that is not set up, and tells the screen which station to open', async () => {
    const response = await closeMeters(0);
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      message?: string;
      details?: { reason?: string; stationId?: string };
    };
    const message = body.message ?? '';
    expect(message).toContain('pump 7 nozzle 2');
    expect(message).toContain('pump 7 nozzle 3');
    expect(message).not.toContain('pump 7 nozzle 1');
    expect(body.details).toMatchObject({
      reason: 'METER_NOT_SET_UP',
      stationId: ids.station,
    });
  });

  it('stops complaining about the meters once they count from before the shift opened', async () => {
    await client.unsafe(`
      update app.meter_installations set effective_from = '2020-01-01T00:00:00Z'
      where id in ('${ids.installationLateA}', '${ids.installationLateB}');
    `);
    const response = await closeMeters(0);
    const body = (await response.json()) as { message?: string; details?: { reason?: string } };
    // This fixture has no selling price, so the close still stops, but at a later check.
    expect(body.details?.reason).not.toBe('METER_NOT_SET_UP');
    expect(body.message ?? '').not.toContain('not set up as working');
  });
});
