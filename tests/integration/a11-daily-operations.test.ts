import { seedClerkSession, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { GET as dailyOperationsGet } from '../../src/app/api/forecourt/operations/daily/route';
import { GET as operationsOverviewGet } from '../../src/app/api/forecourt/operations/overview/route';

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
  historicalDay: 'a11b0000-0000-4000-8000-000000000151',
  overviewRecon: 'a11b0000-0000-4000-8000-000000000152',
  overviewRevision: 'a11b0000-0000-4000-8000-000000000153',
  overviewEvent: 'a11b0000-0000-4000-8000-000000000154',
  overviewPermissionGrant: 'a11b0000-0000-4000-8000-000000000155',
  overviewLockPermissionGrant: 'a11b0000-0000-4000-8000-000000000159',
  overviewAuditPermissionGrant: 'a11b0000-0000-4000-8000-000000000158',
  outsideStationDay: 'a11b0000-0000-4000-8000-000000000157',
};

const overviewNavigationDays = Array.from({ length: 30 }, (_, index) => ({
  id: `a11b0000-0000-4000-8000-${String(160 + index).padStart(12, '0')}`,
  date: `2026-08-${String(index + 1).padStart(2, '0')}`,
}));

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
        ...clerkHeaders(token),
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
  const signedToken = token;
  const request = requestFor(tenantId, stationId, actor);
  for (const [key, value] of Object.entries(clerkHeaders(signedToken)))
    request.headers.set(key, value);
  return request;
}

async function signedOverviewRequest(
  tenantId: string,
  stationId: string,
  actor: 'supervisor' | 'attendant' = 'supervisor',
  businessDayId?: string,
) {
  const token =
    actor === 'supervisor' ? 'a11-supervisor-session-token' : 'a11-attendant-session-token';
  const signedToken = token;
  const params = new URLSearchParams({ tenantId, stationId });
  if (businessDayId) params.set('businessDayId', businessDayId);
  return new Request(`http://127.0.0.1:3000/api/forecourt/operations/overview?${params}`, {
    headers: {
      ...clerkHeaders(signedToken),
    },
  });
}

describe('A11 daily operations composition read', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';

    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A11 Operations Tenant', 'a11-operations-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
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
    `);
    await seedClerkSession(
      client,
      ids.supervisorSession,
      'a11-supervisor-session-token',
      ids.supervisorActor,
      true,
    );
    await seedClerkSession(
      client,
      ids.attendantSession,
      'a11-attendant-session-token',
      ids.attendantActor,
      false,
    );
    await client.unsafe(`
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
      values
        ('${ids.historicalDay}', '${ids.tenant}', '${ids.station}', '2020-01-01', 'NOT_STARTED'),
        ${overviewNavigationDays.map(({ id, date }) => `('${id}', '${ids.tenant}', '${ids.station}', '${date}', 'NOT_STARTED')`).join(',\n        ')}
      on conflict (id) do nothing;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.outsideStationDay}', '${ids.tenant}', '${ids.outsideStation}', '2026-09-22', 'NOT_STARTED')
      on conflict (id) do nothing;
      insert into app.reconciliations
        (id, tenant_id, station_id, business_day_id, shift_id, supervisor_id, created_by, state)
      values ('${ids.overviewRecon}', '${ids.tenant}', '${ids.station}', '${ids.day}', '${ids.shift}', '${ids.supervisorMembership}', '${ids.supervisorMembership}', 'DRAFT')
      on conflict (id) do nothing;
      insert into app.reconciliation_revisions
        (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance, currency, variance_classification)
      values ('${ids.overviewRevision}', '${ids.tenant}', '${ids.station}', '${ids.overviewRecon}', 1, 'READY', 100.0000, 100.0000, 0.0000, 'USD', 'INFORMATIONAL')
      on conflict (id) do nothing;
      insert into app.temporary_permission_grants
        (id, tenant_id, membership_id, permission_code, scope_type, legal_entity_id, station_id, expires_at, reason)
      values ('${ids.overviewPermissionGrant}', '${ids.tenant}', '${ids.attendantMembership}', 'business_day.view', 'STATION', '${ids.legal}', '${ids.station}', '2030-01-01T00:00:00Z', 'A11 overview authorization test')
      on conflict (id) do nothing;
      insert into app.temporary_permission_grants
        (id, tenant_id, membership_id, permission_code, scope_type, legal_entity_id, station_id, expires_at, reason)
      values ('${ids.overviewAuditPermissionGrant}', '${ids.tenant}', '${ids.supervisorMembership}', 'audit.view', 'STATION', '${ids.legal}', '${ids.station}', '2030-01-01T00:00:00Z', 'A11 overview audit authorization test')
        on conflict (id) do nothing;
      insert into app.temporary_permission_grants
        (id, tenant_id, membership_id, permission_code, scope_type, legal_entity_id, station_id, expires_at, reason)
      values ('${ids.overviewLockPermissionGrant}', '${ids.tenant}', '${ids.supervisorMembership}', 'business_day.lock', 'STATION', '${ids.legal}', '${ids.station}', '2030-01-01T00:00:00Z', 'A11 overview lock step-up test')
      on conflict (id) do nothing;
      insert into platform.security_events
        (id, tenant_id, membership_id, actor_id, event_code, request_id, occurred_at, details, key_id, algorithm, signature)
      values
        ('${ids.overviewEvent}', '${ids.tenant}', '${ids.supervisorMembership}', '${ids.supervisorActor}', 'BUSINESS_DAY_OPENED', 'a11b0000-0000-4000-8000-000000000156', '2026-09-23T05:00:00Z', '{"subjectType":"BUSINESS_DAY","subjectId":"${ids.day}"}'::jsonb, 'a11-test-key', 'hmac-sha256', 'a11-test-signature')
      on conflict (id) do nothing;
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

  it('lists the station attendants for a supervisor, by name only, and none for another station', async () => {
    const own = await dailyOperationsGet(await signedRequest(ids.tenant, ids.station));
    const body = (await own.json()) as { attendants?: Array<Record<string, unknown>> };
    expect(own.status).toBe(200);
    expect(body.attendants).toEqual([{ id: ids.attendantMembership, name: 'A11 Attendant' }]);
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

  it('resolves an explicit historical day outside the 30-day navigation list', async () => {
    const response = await operationsOverviewGet(
      await signedOverviewRequest(ids.tenant, ids.station, 'supervisor', ids.historicalDay),
    );
    const body = (await response.json()) as {
      selectedBusinessDay: {
        id: string;
        date: string;
        state: string;
        version: number;
        openedAt: string | null;
        closedAt: string | null;
      };
      businessDays: Array<{ id: string }>;
      status: { close: string; approval: string };
    };

    expect(response.status).toBe(200);
    expect(body.selectedBusinessDay).toMatchObject({
      id: ids.historicalDay,
      date: '2020-01-01',
      state: 'NOT_STARTED',
      version: 0,
      openedAt: null,
      closedAt: null,
    });
    expect(body.businessDays).toHaveLength(30);
    expect(body.businessDays.some((day) => day.id === ids.historicalDay)).toBe(false);
    expect(body.status).toEqual({ close: 'NOT_STARTED', approval: 'NO_REVISION' });
  });

  it('does not substitute another day for an explicit nonexistent or out-of-scope day', async () => {
    const nonexistent = await operationsOverviewGet(
      await signedOverviewRequest(
        ids.tenant,
        ids.station,
        'supervisor',
        'a11b0000-0000-4000-8000-000000000999',
      ),
    );
    const outsideStation = await operationsOverviewGet(
      await signedOverviewRequest(ids.tenant, ids.outsideStation, 'supervisor', ids.day),
    );
    const wrongStationDay = await operationsOverviewGet(
      await signedOverviewRequest(ids.tenant, ids.station, 'supervisor', ids.outsideStationDay),
    );
    const crossTenant = await operationsOverviewGet(
      await signedOverviewRequest(ids.otherTenant, ids.station, 'supervisor', ids.day),
    );

    expect(nonexistent.status).toBe(404);
    expect((await nonexistent.json()).error).toBe('NOT_FOUND');
    expect(wrongStationDay.status).toBe(404);
    expect([403, 404]).toContain(outsideStation.status);
    expect([403, 404]).toContain(crossTenant.status);
  });

  it('fails closed for missing or invalid station context', async () => {
    const signedToken = 'a11-supervisor-session-token';
    const missingStation = await operationsOverviewGet(
      new Request(
        `http://127.0.0.1:3000/api/forecourt/operations/overview?tenantId=${ids.tenant}`,
        { headers: { ...clerkHeaders(signedToken) } },
      ),
    );
    const invalidStation = await operationsOverviewGet(
      new Request(
        `http://127.0.0.1:3000/api/forecourt/operations/overview?tenantId=${ids.tenant}&stationId=not-a-uuid`,
        { headers: { ...clerkHeaders(signedToken) } },
      ),
    );

    expect(missingStation.status).toBe(400);
    expect(invalidStation.status).toBe(400);
  });

  it('enforces reconciliation visibility and omits activity from the operations overview', async () => {
    const supervisorResponse = await operationsOverviewGet(
      await signedOverviewRequest(ids.tenant, ids.station, 'supervisor', ids.day),
    );
    const attendantResponse = await operationsOverviewGet(
      await signedOverviewRequest(ids.tenant, ids.station, 'attendant', ids.day),
    );
    const supervisorBody = (await supervisorResponse.json()) as {
      reconciliations: Array<{ id: string }>;
      visibility: { reconciliations: boolean };
      status: { close: string; approval: string };
      actions: {
        OpenBusinessDay: { canExecute: boolean };
        CloseBusinessDay: { canExecute: boolean };
        LockBusinessDay: {
          canExecute: boolean;
          permissionGranted: boolean;
          requiresStepUp: boolean;
        };
        StartShift: { canExecute: boolean };
        CloseMeters: { canExecute: boolean };
        CompleteShift: { canExecute: boolean };
      };
    };
    const attendantBody = (await attendantResponse.json()) as {
      shifts: Array<{ id: string }>;
      reconciliations: Array<{ id: string }>;
      visibility: { reconciliations: boolean };
      status: { close: string; approval: string };
      actions: Record<string, { canExecute: boolean }>;
    };

    expect(supervisorResponse.status).toBe(200);
    expect(supervisorBody.visibility).toEqual({ reconciliations: true });
    expect(supervisorBody.status).toEqual({ close: 'READY_FOR_REVIEW', approval: 'READY' });
    expect(supervisorBody.actions).toMatchObject({
      OpenBusinessDay: { canExecute: true },
      CloseBusinessDay: { canExecute: true },
      LockBusinessDay: { canExecute: false, permissionGranted: true, requiresStepUp: true },
      StartShift: { canExecute: true },
      CloseMeters: { canExecute: true },
      CompleteShift: { canExecute: true },
    });
    expect(supervisorBody.reconciliations.map((item) => item.id)).toContain(ids.overviewRecon);
    // Nothing is offered for approval until it has been submitted.
    expect(
      (supervisorBody.reconciliations as Array<{ id: string; youMayApprove?: boolean }>).find(
        (item) => item.id === ids.overviewRecon,
      )?.youMayApprove,
    ).toBe(false);
    expect(supervisorBody).not.toHaveProperty('timeline');
    expect(supervisorBody.visibility).not.toHaveProperty('auditTimeline');
    expect(attendantResponse.status).toBe(200);
    expect(attendantBody.visibility).toEqual({ reconciliations: false });
    expect(attendantBody.status).toEqual({ close: 'IN_PROGRESS', approval: 'NO_REVISION' });
    expect(Object.values(attendantBody.actions).every((action) => !action.canExecute)).toBe(true);
    expect(attendantBody.shifts.map((shift) => shift.id)).toContain(ids.shift);
    expect(attendantBody.reconciliations).toHaveLength(0);
    expect(attendantBody).not.toHaveProperty('timeline');
  });
});
