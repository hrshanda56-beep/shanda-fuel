import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { makeSignature } from 'better-auth/crypto';
import { GET as dailyOperationsGet } from '../../src/app/api/forecourt/operations/daily/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A11 daily operations integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const ids = {
  tenant: 'a11b0000-0000-4000-8000-000000000001',
  otherTenant: 'a11b0000-0000-4000-8000-000000000002',
  legal: 'a11b0000-0000-4000-8000-000000000011',
  station: 'a11b0000-0000-4000-8000-000000000021',
  outsideStation: 'a11b0000-0000-4000-8000-000000000022',
  supervisorActor: 'a11b0000-0000-4000-8000-000000000031',
  supervisorMembership: 'a11b0000-0000-4000-8000-000000000041',
  supervisorSession: 'a11b0000-0000-4000-8000-000000000051',
  attendantActor: 'a11b0000-0000-4000-8000-000000000032',
  attendantMembership: 'a11b0000-0000-4000-8000-000000000042',
  attendantSession: 'a11b0000-0000-4000-8000-000000000052',
  product: 'a11b0000-0000-4000-8000-000000000061',
  pump: 'a11b0000-0000-4000-8000-000000000071',
  nozzle: 'a11b0000-0000-4000-8000-000000000081',
  meter: 'a11b0000-0000-4000-8000-000000000091',
  installation: 'a11b0000-0000-4000-8000-000000000101',
  futureInstallation: 'a11b0000-0000-4000-8000-000000000102',
  oldPrice: 'a11b0000-0000-4000-8000-000000000111',
  futurePrice: 'a11b0000-0000-4000-8000-000000000112',
  day: 'a11b0000-0000-4000-8000-000000000121',
  shift: 'a11b0000-0000-4000-8000-000000000131',
  oldBoundary: 'a11b0000-0000-4000-8000-000000000141',
  futureBoundary: 'a11b0000-0000-4000-8000-000000000142',
};

let client: Sql;

function requestFor(
  tenantId: string,
  stationId: string,
  actor: 'supervisor' | 'attendant' = 'supervisor',
): Request {
  const token =
    actor === 'supervisor' ? 'a11-supervisor-session-token' : 'a11-attendant-session-token';
  return new Request(
    `http://127.0.0.1:3000/api/forecourt/operations/daily?tenantId=${tenantId}&stationId=${stationId}&businessDayId=${ids.day}&shiftId=${ids.shift}`,
    {
      headers: {
        cookie: `shanda-fuel.session_token=${token}.${'signature-placeholder'}`,
      },
    },
  );
}

async function signedRequest(
  tenantId: string,
  stationId: string,
  actor: 'supervisor' | 'attendant' = 'supervisor',
) {
  const token =
    actor === 'supervisor' ? 'a11-supervisor-session-token' : 'a11-attendant-session-token';
  const signedToken = `${token}.${await makeSignature(token, process.env.BETTER_AUTH_SECRET!)}`;
  const request = requestFor(tenantId, stationId, actor);
  request.headers.set('cookie', `shanda-fuel.session_token=${signedToken}`);
  return request;
}

describe('A11 daily operations composition read', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A11 Operations Tenant', 'a11-operations-tenant')
        on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.supervisorActor}', 'A11 Supervisor', 'a11-supervisor@example.test'),
        ('${ids.attendantActor}', 'A11 Attendant', 'a11-attendant@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendantActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name)
        values ('${ids.legal}', '${ids.tenant}', 'A11 Operations Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A11OPS', 'A11 Operations Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.outsideStation}', '${ids.tenant}', '${ids.legal}', 'A11OUT', 'A11 Outside Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.product}', '${ids.tenant}', 'A11-DIESEL', 'A11 Diesel') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number, status)
        values ('${ids.pump}', '${ids.tenant}', '${ids.station}', '1', 'ACTIVE') on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
        values ('${ids.nozzle}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '1', '${ids.product}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values ('${ids.meter}', '${ids.tenant}', 'A11-METER-1') on conflict (id) do nothing;
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, effective_to, installed_by)
        values
          ('${ids.installation}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.meter}', '2020-01-01T00:00:00Z', '2026-09-23T15:00:00Z', '${ids.supervisorMembership}'),
          ('${ids.futureInstallation}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.meter}', '2026-09-23T16:00:00Z', null, '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, effective_to, unit_price, state, requested_by)
        values
          ('${ids.oldPrice}', '${ids.tenant}', '${ids.station}', '${ids.product}', '2020-01-01T00:00:00Z', '2026-09-23T15:00:00Z', 1.500000, 'DRAFT', '${ids.supervisorMembership}'),
          ('${ids.futurePrice}', '${ids.tenant}', '${ids.station}', '${ids.product}', '2026-09-23T16:00:00Z', null, 2.000000, 'DRAFT', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      update app.selling_prices set state='PENDING_APPROVAL'
        where id in ('${ids.oldPrice}', '${ids.futurePrice}') and state='DRAFT';
      update app.selling_prices set state='APPROVED', approved_by='${ids.supervisorMembership}', approved_at=now()
        where id in ('${ids.oldPrice}', '${ids.futurePrice}') and state='PENDING_APPROVAL';
      update app.selling_prices set state='PENDING_STATION_ACTIVATION'
        where id in ('${ids.oldPrice}', '${ids.futurePrice}') and state='APPROVED';
      update app.selling_prices set state='BOUNDARIES_IN_PROGRESS'
        where id in ('${ids.oldPrice}', '${ids.futurePrice}') and state='PENDING_STATION_ACTIVATION';
      update app.selling_prices set state='ACTIVE', activated_at=now()
        where id in ('${ids.oldPrice}', '${ids.futurePrice}') and state='BOUNDARIES_IN_PROGRESS';
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-09-23', 'NOT_STARTED') on conflict (id) do nothing;
      update app.station_business_days set state = 'OPEN', opened_at = now()
        where id = '${ids.day}' and state = 'NOT_STARTED';
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
        values ('${ids.shift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T06:00:00Z', '2026-09-23T14:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      update app.shifts set state = 'OPEN', opened_at = now()
        where id = '${ids.shift}' and state = 'PLANNED';
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
        values
          ('${ids.oldBoundary}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.installation}', '${ids.day}', '${ids.shift}', 'SHIFT_OPEN', 'AVAILABLE', 100000.000, '2026-09-23T05:00:00Z', '2026-09-23T05:01:00Z', '${ids.supervisorMembership}', '${ids.supervisorMembership}', '${ids.attendantMembership}'),
          ('${ids.futureBoundary}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.futureInstallation}', '${ids.day}', '${ids.shift}', 'SHIFT_CLOSE', 'AVAILABLE', 100500.000, '2026-09-23T15:00:00Z', '2026-09-23T15:01:00Z', '${ids.supervisorMembership}', '${ids.supervisorMembership}', '${ids.attendantMembership}')
        on conflict (id) do nothing;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values
          ('${ids.supervisorSession}', '2030-01-01T00:00:00Z', 'a11-supervisor-session-token', '${ids.supervisorActor}', true, now()),
          ('${ids.attendantSession}', '2030-01-01T00:00:00Z', 'a11-attendant-session-token', '${ids.attendantActor}', false, null)
        on conflict (id) do update set expires_at = excluded.expires_at;
    `);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('uses the requested shift interval for price, installation, and prior-boundary context', async () => {
    const response = await dailyOperationsGet(await signedRequest(ids.tenant, ids.station));
    const body = (await response.json()) as {
      availableReadings: Array<{
        meterInstallationId: string | null;
        sellingPriceId: string | null;
        unitPrice: string | null;
        previousReading: string | null;
      }>;
    };
    expect(response.status).toBe(200);
    expect(body.availableReadings[0]).toMatchObject({
      meterInstallationId: ids.installation,
      sellingPriceId: ids.oldPrice,
      unitPrice: '1.500000',
      previousReading: '100000.000',
    });
  });

  it('rejects cross-tenant, outside-station, and non-view actors', async () => {
    const crossTenant = await dailyOperationsGet(await signedRequest(ids.otherTenant, ids.station));
    const outsideStation = await dailyOperationsGet(
      await signedRequest(ids.tenant, ids.outsideStation),
    );
    const noViewPermission = await dailyOperationsGet(
      await signedRequest(ids.tenant, ids.station, 'attendant'),
    );
    expect(crossTenant.status).toBe(403);
    expect(outsideStation.status).toBe(403);
    expect(noViewPermission.status).toBe(403);
  });
});
