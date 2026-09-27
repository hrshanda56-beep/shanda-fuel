import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { makeSignature } from 'better-auth/crypto';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';
import { seedActiveStepUp } from './auth-session-fixtures';
import { stationBusinessDayBounds } from './station-business-time';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A3 forecourt integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

// A distinct fixture namespace from tests/integration/a3-forecourt.test.ts so both
// files can seed the same database without id collisions.
const ids = {
  tenant: 'a3b00000-0000-4000-8000-000000000001',
  legal: 'a3b00000-0000-4000-8000-000000000011',
  // A distinct station per test that calls OpenBusinessDay: the (tenant,
  // station, business_date) uniqueness constraint means every test sharing a
  // station would fight over "today" in the station's timezone.
  station: 'a3b00000-0000-4000-8000-000000000021',
  stationMismatch: 'a3b00000-0000-4000-8000-000000000023',
  stationIdempotent: 'a3b00000-0000-4000-8000-000000000024',
  stationFullDay: 'a3b00000-0000-4000-8000-000000000025',
  actor: 'a3b00000-0000-4000-8000-000000000031',
  membership: 'a3b00000-0000-4000-8000-000000000041',
  product: 'a3b00000-0000-4000-8000-000000000051',
  pump: 'a3b00000-0000-4000-8000-000000000061',
  nozzle: 'a3b00000-0000-4000-8000-000000000071',
  meter: 'a3b00000-0000-4000-8000-000000000081',
  installation: 'a3b00000-0000-4000-8000-000000000091',
  price: 'a3b00000-0000-4000-8000-000000000101',
  session: 'a3b00000-0000-4000-8000-000000000111',
  pumpFullDay: 'a3b00000-0000-4000-8000-000000000062',
  nozzleFullDay: 'a3b00000-0000-4000-8000-000000000073',
  meterFullDay: 'a3b00000-0000-4000-8000-000000000082',
  installationFullDay: 'a3b00000-0000-4000-8000-000000000093',
  priceFullDay: 'a3b00000-0000-4000-8000-000000000102',
  // A separate approver: a reconciliation cannot be approved by its own submitter.
  approverActor: 'a3b00000-0000-4000-8000-000000000032',
  approverMembership: 'a3b00000-0000-4000-8000-000000000042',
  approverSession: 'a3b00000-0000-4000-8000-000000000112',

  // ResolveMeterException security/concurrency matrix fixtures.
  stationException: 'a3b00000-0000-4000-8000-000000000026',
  pumpException: 'a3b00000-0000-4000-8000-000000000063',
  nozzleExceptionA: 'a3b00000-0000-4000-8000-000000000074',
  nozzleExceptionB: 'a3b00000-0000-4000-8000-000000000075',
  meterExceptionA: 'a3b00000-0000-4000-8000-000000000083',
  meterExceptionB: 'a3b00000-0000-4000-8000-000000000084',
  installationExceptionA: 'a3b00000-0000-4000-8000-000000000094',
  installationExceptionB: 'a3b00000-0000-4000-8000-000000000095',
  dayException: 'a3b00000-0000-4000-8000-000000000201',
  shiftException: 'a3b00000-0000-4000-8000-000000000202',
  dayExceptionOther: 'a3b00000-0000-4000-8000-000000000203',
  shiftExceptionOther: 'a3b00000-0000-4000-8000-000000000204',
  // ATTENDANT-only at stationException: lacks exception.manage.
  attendantOnlyActor: 'a3b00000-0000-4000-8000-000000000033',
  attendantOnlyMembership: 'a3b00000-0000-4000-8000-000000000043',
  attendantOnlySession: 'a3b00000-0000-4000-8000-000000000113',
  // SUPERVISOR only at a different station (stationFullDay), no role at stationException.
  outsiderActor: 'a3b00000-0000-4000-8000-000000000034',
  outsiderMembership: 'a3b00000-0000-4000-8000-000000000044',
  outsiderSession: 'a3b00000-0000-4000-8000-000000000114',
};

let client: Sql;

function parseBusinessDate(businessDate: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) throw new Error(`Invalid business date: ${businessDate}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

async function businessDayBoundsForStation(stationId: string, businessDate: string) {
  const rows = await client<{ timezone: string }[]>`
    select timezone from app.stations where id = ${stationId}
  `;
  if (rows.length !== 1) throw new Error(`Station ${stationId} was not found`);
  return stationBusinessDayBounds(businessDate, rows[0]!.timezone);
}

async function postCommand(
  input: Record<string, unknown>,
  key: string,
  token = 'a3b-session-token',
) {
  const signedToken = `${token}.${await makeSignature(token, process.env.BETTER_AUTH_SECRET!)}`;
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

describe('A3 production BusinessDate derivation and full-day lifecycle', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a3-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A3 Lifecycle Tenant', 'a3-lifecycle-tenant') on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.actor}', 'A3 Lifecycle Actor', 'a3-lifecycle-actor@example.test'),
        ('${ids.approverActor}', 'A3 Lifecycle Approver', 'a3-lifecycle-approver@example.test'),
        ('${ids.attendantOnlyActor}', 'A3 Lifecycle Attendant Only', 'a3-lifecycle-attendant-only@example.test'),
        ('${ids.outsiderActor}', 'A3 Lifecycle Outsider', 'a3-lifecycle-outsider@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE'),
        ('${ids.approverMembership}', '${ids.tenant}', '${ids.approverActor}', 'ACTIVE'),
        ('${ids.attendantOnlyMembership}', '${ids.tenant}', '${ids.attendantOnlyActor}', 'ACTIVE'),
        ('${ids.outsiderMembership}', '${ids.tenant}', '${ids.outsiderActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A3 Lifecycle Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A3BL', 'A3 Lifecycle Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationMismatch}', '${ids.tenant}', '${ids.legal}', 'A3BLM', 'A3 Lifecycle Station Mismatch', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationIdempotent}', '${ids.tenant}', '${ids.legal}', 'A3BLI', 'A3 Lifecycle Station Idempotent', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationFullDay}', '${ids.tenant}', '${ids.legal}', 'A3BLF', 'A3 Lifecycle Station Full Day', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationException}', '${ids.tenant}', '${ids.legal}', 'A3BLE', 'A3 Lifecycle Station Exception', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values
          ('${ids.tenant}', '${ids.membership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
          ('${ids.tenant}', '${ids.membership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}'),
          ('${ids.tenant}', '${ids.membership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.stationMismatch}'),
          ('${ids.tenant}', '${ids.membership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.stationIdempotent}'),
          ('${ids.tenant}', '${ids.membership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.stationFullDay}'),
          ('${ids.tenant}', '${ids.membership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.stationFullDay}'),
          ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.stationFullDay}'),
          ('${ids.tenant}', '${ids.membership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.stationException}'),
          ('${ids.tenant}', '${ids.approverMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.stationFullDay}'),
          ('${ids.tenant}', '${ids.attendantOnlyMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.stationException}'),
          ('${ids.tenant}', '${ids.outsiderMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.stationFullDay}')
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.product}', '${ids.tenant}', 'A3BL-DIESEL', 'Diesel') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number)
        values
          ('${ids.pump}', '${ids.tenant}', '${ids.station}', '1'),
          ('${ids.pumpFullDay}', '${ids.tenant}', '${ids.stationFullDay}', '1'),
          ('${ids.pumpException}', '${ids.tenant}', '${ids.stationException}', '1')
        on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id)
        values
          ('${ids.nozzle}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '1', '${ids.product}'),
          ('${ids.nozzleFullDay}', '${ids.tenant}', '${ids.stationFullDay}', '${ids.pumpFullDay}', '1', '${ids.product}'),
          ('${ids.nozzleExceptionA}', '${ids.tenant}', '${ids.stationException}', '${ids.pumpException}', '1', '${ids.product}'),
          ('${ids.nozzleExceptionB}', '${ids.tenant}', '${ids.stationException}', '${ids.pumpException}', '2', '${ids.product}')
        on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values
          ('${ids.meter}', '${ids.tenant}', 'A3BL-METER-1'),
          ('${ids.meterFullDay}', '${ids.tenant}', 'A3BL-METER-2'),
          ('${ids.meterExceptionA}', '${ids.tenant}', 'A3BL-METER-3'),
          ('${ids.meterExceptionB}', '${ids.tenant}', 'A3BL-METER-4')
        on conflict (id) do nothing;
      insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values
          ('${ids.installation}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.meter}', '2020-01-01T00:00:00Z', '${ids.membership}'),
          ('${ids.installationFullDay}', '${ids.tenant}', '${ids.stationFullDay}', '${ids.nozzleFullDay}', '${ids.meterFullDay}', '2020-01-01T00:00:00Z', '${ids.membership}'),
          ('${ids.installationExceptionA}', '${ids.tenant}', '${ids.stationException}', '${ids.nozzleExceptionA}', '${ids.meterExceptionA}', '2020-01-01T00:00:00Z', '${ids.membership}'),
          ('${ids.installationExceptionB}', '${ids.tenant}', '${ids.stationException}', '${ids.nozzleExceptionB}', '${ids.meterExceptionB}', '2020-01-01T00:00:00Z', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values
          ('${ids.dayException}', '${ids.tenant}', '${ids.stationException}', '2026-10-10', 'NOT_STARTED'),
          ('${ids.dayExceptionOther}', '${ids.tenant}', '${ids.stationException}', '2026-10-11', 'NOT_STARTED')
        on conflict (id) do nothing;
      update app.station_business_days set state = 'OPEN' where id in ('${ids.dayException}', '${ids.dayExceptionOther}') and state = 'NOT_STARTED';
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
        values
          ('${ids.shiftException}', '${ids.tenant}', '${ids.stationException}', '${ids.dayException}', 'PLANNED', '2026-10-10T06:00:00Z', '2026-10-10T14:00:00Z', '2026-10-10'),
          ('${ids.shiftExceptionOther}', '${ids.tenant}', '${ids.stationException}', '${ids.dayExceptionOther}', 'PLANNED', '2026-10-11T06:00:00Z', '2026-10-11T14:00:00Z', '2026-10-11')
        on conflict (id) do nothing;
      update app.shifts set state = 'OPEN' where id in ('${ids.shiftException}', '${ids.shiftExceptionOther}') and state = 'PLANNED';
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
        values
          ('${ids.price}', '${ids.tenant}', '${ids.station}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.membership}'),
          ('${ids.priceFullDay}', '${ids.tenant}', '${ids.stationFullDay}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.membership}')
        on conflict (id) do nothing;
      update app.selling_prices set state = 'PENDING_APPROVAL' where id in ('${ids.price}', '${ids.priceFullDay}') and state = 'DRAFT';
      update app.selling_prices set state = 'APPROVED', approved_by = '${ids.membership}', approved_at = clock_timestamp() where id in ('${ids.price}', '${ids.priceFullDay}') and state = 'PENDING_APPROVAL';
      update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id in ('${ids.price}', '${ids.priceFullDay}') and state = 'APPROVED';
      update app.selling_prices set state = 'BOUNDARIES_IN_PROGRESS' where id in ('${ids.price}', '${ids.priceFullDay}') and state = 'PENDING_STATION_ACTIVATION';
      update app.selling_prices set state = 'ACTIVE' where id in ('${ids.price}', '${ids.priceFullDay}') and state = 'BOUNDARIES_IN_PROGRESS';
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values
          ('${ids.session}', '2030-01-01T00:00:00Z', 'a3b-session-token', '${ids.actor}', true, now()),
          ('${ids.approverSession}', '2030-01-01T00:00:00Z', 'a3b-approver-session-token', '${ids.approverActor}', true, now()),
          ('${ids.attendantOnlySession}', '2030-01-01T00:00:00Z', 'a3b-attendant-only-session-token', '${ids.attendantOnlyActor}', true, now()),
          ('${ids.outsiderSession}', '2030-01-01T00:00:00Z', 'a3b-outsider-session-token', '${ids.outsiderActor}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
    `);
    await seedActiveStepUp(client, ids.session, ids.tenant);
    await seedActiveStepUp(client, ids.approverSession, ids.tenant);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('derives StartShift BusinessDate from the station IANA timezone, not the UTC calendar date', async () => {
    const businessDayId = randomUUID();
    const shiftId = randomUUID();

    const open = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId,
        expectedVersion: 0,
      },
      `a3bl-open-${businessDayId}`,
    );
    expect(open.status).toBe(200);
    const openBody = (await open.json()) as { businessDate: string };
    const businessDate = openBody.businessDate;

    // Pick a UTC instant whose naive UTC calendar date is the day BEFORE
    // `businessDate`, but whose Africa/Harare (UTC+2) local calendar date IS
    // `businessDate`. E.g. businessDate 2026-09-21 -> 2026-09-20T23:00:00Z is
    // 2026-09-21T01:00:00+02:00 in Harare. If the server ever fell back to
    // UTC-date-slicing this would be rejected as a mismatch.
    const { year, month, day } = parseBusinessDate(businessDate);
    const utcInstantWithEarlierUtcDate = new Date(
      Date.UTC(year, month - 1, day - 1, 23, 0, 0),
    ).toISOString();

    const start = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt: utcInstantWithEarlierUtcDate,
        plannedEndAt: new Date(Date.UTC(year, month - 1, day, 20, 0, 0)).toISOString(),
      },
      `a3bl-start-${shiftId}`,
    );
    expect(start.status).toBe(200);
    const startBody = (await start.json()) as { businessDate: string };
    expect(startBody.businessDate).toBe(businessDate);

    const rows = await client<{ business_date: string; state: string }[]>`
      select business_date, state from app.shifts where id = ${shiftId}
    `;
    expect(rows).toEqual([{ business_date: businessDate, state: 'OPEN' }]);
  });

  it('rejects StartShift when the start instant does not fall within the opened business day in the station timezone', async () => {
    const businessDayId = randomUUID();
    const shiftId = randomUUID();
    const open = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationMismatch,
        businessDayId,
        expectedVersion: 0,
      },
      `a3bl-open-mismatch-${businessDayId}`,
    );
    expect(open.status).toBe(200);
    const { businessDate } = (await open.json()) as { businessDate: string };
    const { year, month, day } = parseBusinessDate(businessDate);
    // Two full days later -- unambiguously outside this business day in any timezone.
    const wrongInstant = new Date(Date.UTC(year, month - 1, day + 2, 10, 0, 0)).toISOString();

    const start = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationMismatch,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt: wrongInstant,
        plannedEndAt: new Date(Date.UTC(year, month - 1, day + 2, 18, 0, 0)).toISOString(),
      },
      `a3bl-start-mismatch-${shiftId}`,
    );
    expect(start.status).toBe(422);
    const rows = await client<{ count: number }[]>`
      select count(*)::int as count from app.shifts where id = ${shiftId}
    `;
    expect(rows).toEqual([{ count: 0 }]);
  });

  it('opens a business day idempotently and rejects a second day for the same station and date under a different id', async () => {
    const firstId = randomUUID();
    const key = `a3bl-idempotent-open-${firstId}`;
    const first = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationIdempotent,
        businessDayId: firstId,
        expectedVersion: 0,
      },
      key,
    );
    expect(first.status).toBe(200);
    const replay = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationIdempotent,
        businessDayId: firstId,
        expectedVersion: 0,
      },
      key,
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());

    const secondId = randomUUID();
    const second = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationIdempotent,
        businessDayId: secondId,
        expectedVersion: 0,
      },
      `a3bl-conflicting-open-${secondId}`,
    );
    expect(second.status).toBe(409);
  });

  it('drives a full authoritative day from OpenBusinessDay through LockBusinessDay using only production commands for workflow state, including an operated zero-sales segment', async () => {
    const businessDayId = randomUUID();
    const shiftId = randomUUID();

    const open = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        businessDayId,
        expectedVersion: 0,
      },
      `a3bl-full-open-${businessDayId}`,
    );
    expect(open.status).toBe(200);
    const { businessDate } = (await open.json()) as { businessDate: string };

    const { plannedStartAt, plannedEndAt } = await businessDayBoundsForStation(
      ids.stationFullDay,
      businessDate,
    );
    const start = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt,
        plannedEndAt,
      },
      `a3bl-full-start-${shiftId}`,
    );
    expect(start.status).toBe(200);

    const openingBoundaryId = randomUUID();
    const openingBoundary = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        boundaryId: openingBoundaryId,
        nozzleId: ids.nozzleFullDay,
        meterInstallationId: ids.installationFullDay,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_OPEN',
        readingStatus: 'AVAILABLE',
        readingValue: '1000.000',
        exceptionReason: 'First reading on a freshly installed meter',
        expectedVersion: 1,
      },
      `a3bl-full-opening-boundary-${shiftId}`,
    );
    expect(openingBoundary.status).toBe(200);

    // Operated zero-sales: the closing reading equals the opening reading.
    // This is genuine zero litres, not "no meter evidence".
    const closingBoundaryId = randomUUID();
    const closingBoundary = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        boundaryId: closingBoundaryId,
        nozzleId: ids.nozzleFullDay,
        meterInstallationId: ids.installationFullDay,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '1000.000',
        expectedVersion: 1,
      },
      `a3bl-full-closing-boundary-${shiftId}`,
    );
    expect(closingBoundary.status).toBe(200);

    const boundaryTimes = await client<
      { id: string; effective_at: Date }[]
    >`select id, effective_at from app.meter_boundaries where id in (${openingBoundaryId}, ${closingBoundaryId})`;
    const openingAt = boundaryTimes.find((row) => row.id === openingBoundaryId)!.effective_at;
    const closingAt = boundaryTimes.find((row) => row.id === closingBoundaryId)!.effective_at;

    const segmentId = randomUUID();
    const seal = await postCommand(
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        segmentId,
        nozzleId: ids.nozzleFullDay,
        meterInstallationId: ids.installationFullDay,
        businessDayId,
        shiftId,
        openingBoundaryId,
        closingBoundaryId,
        productId: ids.product,
        responsibleAttendantId: ids.membership,
        startAt: new Date(openingAt).toISOString(),
        endAt: new Date(closingAt).toISOString(),
        expectedVersion: 0,
      },
      `a3bl-full-seal-${segmentId}`,
    );
    expect(seal.status).toBe(201);

    const segmentRows = await client<
      { litres: string; state: string }[]
    >`select litres, state from app.meter_segments where id = ${segmentId}`;
    expect(segmentRows).toEqual([{ litres: '0.000', state: 'SEALED' }]);

    const closeMeters = await postCommand(
      {
        commandType: 'CloseMeters',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        businessDayId,
        shiftId,
        expectedVersion: 1,
      },
      `a3bl-full-close-meters-${shiftId}`,
    );
    expect(closeMeters.status).toBe(200);

    const completeShift = await postCommand(
      {
        commandType: 'CompleteShift',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        businessDayId,
        shiftId,
        expectedVersion: 2,
      },
      `a3bl-full-complete-shift-${shiftId}`,
    );
    expect(completeShift.status).toBe(200);

    const reconciliationId = randomUUID();
    const revisionId = randomUUID();
    const createReconciliation = await postCommand(
      {
        commandType: 'CreateReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        businessDayId,
        reconciliationId,
        revisionId,
        expectedVersion: 0,
      },
      `a3bl-full-create-reconciliation-${reconciliationId}`,
    );
    expect(createReconciliation.status).toBe(200);
    const createBody = (await createReconciliation.json()) as {
      businessDate: string;
      revisionId: string;
    };
    expect(createBody.businessDate).toBe(businessDate);
    const draftRows = await client<
      { reconciliation_state: string; revision_state: string; expected_sales: string }[]
    >`
      select c.state as reconciliation_state, r.state as revision_state, r.expected_sales
      from app.reconciliations c
      join app.reconciliation_revisions r on r.tenant_id = c.tenant_id and r.station_id = c.station_id and r.reconciliation_id = c.id
      where c.id = ${reconciliationId}
    `;
    // Zero-sales segment: the reconciliation is server-derived from the sealed
    // effective segment, not caller-supplied.
    expect(draftRows).toEqual([
      { reconciliation_state: 'READY', revision_state: 'READY', expected_sales: '0.0000' },
    ]);

    // SubmitReconciliation drives READY -> SUBMITTED -> PENDING_APPROVAL on both
    // the revision and its parent reconciliation through one production command
    // (see commands.ts: requesting management review is not a distinct human
    // action in this domain -- domain.ts's requestReconciliationApproval takes
    // no actor -- so it is folded into submission rather than a separate command).
    const submit = await postCommand(
      {
        commandType: 'SubmitReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        revisionId,
        expectedVersion: 0,
        declarations: [],
      },
      `a3bl-full-submit-${revisionId}`,
    );
    expect(submit.status).toBe(200);
    const routedRows = await client<{ reconciliation_state: string; revision_state: string }[]>`
      select c.state as reconciliation_state, r.state as revision_state
      from app.reconciliations c
      join app.reconciliation_revisions r on r.tenant_id = c.tenant_id and r.station_id = c.station_id and r.reconciliation_id = c.id
      where c.id = ${reconciliationId}
    `;
    expect(routedRows).toEqual([
      { reconciliation_state: 'PENDING_APPROVAL', revision_state: 'PENDING_APPROVAL' },
    ]);

    const approve = await postCommand(
      {
        commandType: 'ApproveReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        revisionId,
        expectedVersion: 2,
      },
      `a3bl-full-approve-${revisionId}`,
      'a3b-approver-session-token',
    );
    expect(approve.status).toBe(200);

    const post = await postCommand(
      {
        commandType: 'PostReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        revisionId,
        expectedVersion: 3,
      },
      `a3bl-full-post-${revisionId}`,
      'a3b-approver-session-token',
    );
    expect(post.status).toBe(200);

    const lockRevision = await postCommand(
      {
        commandType: 'LockReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        revisionId,
        expectedVersion: 4,
      },
      `a3bl-full-lock-revision-${revisionId}`,
      'a3b-approver-session-token',
    );
    expect(lockRevision.status).toBe(200);

    const close = await postCommand(
      {
        commandType: 'CloseBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        businessDayId,
        expectedVersion: 1,
      },
      `a3bl-full-close-day-${businessDayId}`,
    );
    expect(close.status).toBe(200);

    const lock = await postCommand(
      {
        commandType: 'LockBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        businessDayId,
        expectedVersion: 3,
      },
      `a3bl-full-lock-day-${businessDayId}`,
    );
    expect(lock.status).toBe(200);

    const dayRows = await client<
      { state: string; business_date: string }[]
    >`select state, business_date from app.station_business_days where id = ${businessDayId}`;
    expect(dayRows).toEqual([{ state: 'LOCKED', business_date: businessDate }]);

    // The parent reconciliation was driven to LOCKED by production commands
    // only -- no test in this file ever writes app.reconciliations.state directly.
    const reconciliationRows = await client<{ state: string }[]>`
      select state from app.reconciliations where id = ${reconciliationId}
    `;
    expect(reconciliationRows).toEqual([{ state: 'LOCKED' }]);

    const outboxEvents = await client<
      { event_type: string }[]
    >`select event_type from app.forecourt_outbox where tenant_id = ${ids.tenant} and station_id = ${ids.stationFullDay}
      and (aggregate_id = ${businessDayId} or aggregate_id = ${shiftId}) order by event_type`;
    expect(outboxEvents.map((row) => row.event_type)).toEqual(
      expect.arrayContaining(['forecourt.business_day_opened.v1', 'forecourt.shift_started.v1']),
    );
  });

  it('denies ResolveMeterException for missing permission and for an actor with no role at the station', async () => {
    const boundaryId = randomUUID();
    const reported = await postCommand(
      {
        commandType: 'ReportMeterUnavailable',
        tenantId: ids.tenant,
        stationId: ids.stationException,
        boundaryId,
        nozzleId: ids.nozzleExceptionA,
        meterInstallationId: ids.installationExceptionA,
        businessDayId: ids.dayException,
        shiftId: ids.shiftException,
        responsibleAttendantId: ids.attendantOnlyMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'UNAVAILABLE',
        unavailableReason: 'Meter display unreadable',
        expectedVersion: 0,
      },
      `a3bl-exception-denial-report-${boundaryId}`,
    );
    expect(reported.status).toBe(200);

    const resolutionInput = (resolutionBoundaryId: string) => ({
      commandType: 'ResolveMeterException',
      tenantId: ids.tenant,
      stationId: ids.stationException,
      boundaryId: resolutionBoundaryId,
      nozzleId: ids.nozzleExceptionA,
      meterInstallationId: ids.installationExceptionA,
      businessDayId: ids.dayException,
      shiftId: ids.shiftException,
      responsibleAttendantId: ids.attendantOnlyMembership,
      reason: 'SHIFT_CLOSE',
      readingStatus: 'AVAILABLE',
      readingValue: '4500.000',
      exceptionBoundaryId: boundaryId,
      expectedVersion: 0,
    });

    const missingPermission = await postCommand(
      resolutionInput(randomUUID()),
      'a3bl-exception-denial-no-permission',
      'a3b-attendant-only-session-token',
    );
    expect(missingPermission.status).toBe(403);

    const wrongStation = await postCommand(
      resolutionInput(randomUUID()),
      'a3bl-exception-denial-wrong-station',
      'a3b-outsider-session-token',
    );
    expect(wrongStation.status).toBe(403);

    const stillBlocking = await client<{ status: string }[]>`
      select status from app.meter_exceptions where id = ${boundaryId}
    `;
    expect(stillBlocking).toEqual([{ status: 'BLOCKING' }]);
    const resolutionCount = await client<{ count: number }[]>`
      select count(*)::int as count from app.meter_exception_resolutions where exception_id = ${boundaryId}
    `;
    expect(resolutionCount).toEqual([{ count: 0 }]);
    const outboxCount = await client<{ count: number }[]>`
      select count(*)::int as count from app.forecourt_outbox
      where event_type = 'forecourt.meter_exception_resolved.v1' and payload->>'exceptionId' = ${boundaryId}
    `;
    expect(outboxCount).toEqual([{ count: 0 }]);
  });

  it('resolves a meter exception once and rejects a second resolution attempt as already resolved', async () => {
    const boundaryId = randomUUID();
    const reported = await postCommand(
      {
        commandType: 'ReportMeterUnavailable',
        tenantId: ids.tenant,
        stationId: ids.stationException,
        boundaryId,
        nozzleId: ids.nozzleExceptionA,
        meterInstallationId: ids.installationExceptionA,
        businessDayId: ids.dayException,
        shiftId: ids.shiftException,
        responsibleAttendantId: ids.attendantOnlyMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'UNAVAILABLE',
        unavailableReason: 'Meter display unreadable',
        expectedVersion: 0,
      },
      `a3bl-exception-already-report-${boundaryId}`,
    );
    expect(reported.status).toBe(200);

    const firstResolutionBoundary = randomUUID();
    const firstResolve = await postCommand(
      {
        commandType: 'ResolveMeterException',
        tenantId: ids.tenant,
        stationId: ids.stationException,
        boundaryId: firstResolutionBoundary,
        nozzleId: ids.nozzleExceptionA,
        meterInstallationId: ids.installationExceptionA,
        businessDayId: ids.dayException,
        shiftId: ids.shiftException,
        responsibleAttendantId: ids.attendantOnlyMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '4500.000',
        exceptionBoundaryId: boundaryId,
        expectedVersion: 0,
      },
      `a3bl-exception-already-resolve-first-${boundaryId}`,
    );
    expect(firstResolve.status).toBe(200);

    const secondResolutionBoundary = randomUUID();
    const secondResolve = await postCommand(
      {
        commandType: 'ResolveMeterException',
        tenantId: ids.tenant,
        stationId: ids.stationException,
        boundaryId: secondResolutionBoundary,
        nozzleId: ids.nozzleExceptionA,
        meterInstallationId: ids.installationExceptionA,
        businessDayId: ids.dayException,
        shiftId: ids.shiftException,
        responsibleAttendantId: ids.attendantOnlyMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '4600.000',
        exceptionBoundaryId: boundaryId,
        expectedVersion: 0,
      },
      `a3bl-exception-already-resolve-second-${boundaryId}`,
    );
    // The exception is no longer BLOCKING, so this is denied as a conflict
    // before any second mutation is attempted.
    expect(secondResolve.status).toBe(409);

    const resolutionRows = await client<{ resolution_boundary_id: string }[]>`
      select resolution_boundary_id from app.meter_exception_resolutions where exception_id = ${boundaryId}
    `;
    expect(resolutionRows).toEqual([{ resolution_boundary_id: firstResolutionBoundary }]);
  });

  it('rejects ResolveMeterException resolutions whose business day, shift, or nozzle/installation lineage does not match the exception scope', async () => {
    const boundaryId = randomUUID();
    const reported = await postCommand(
      {
        commandType: 'ReportMeterUnavailable',
        tenantId: ids.tenant,
        stationId: ids.stationException,
        boundaryId,
        nozzleId: ids.nozzleExceptionA,
        meterInstallationId: ids.installationExceptionA,
        businessDayId: ids.dayException,
        shiftId: ids.shiftException,
        responsibleAttendantId: ids.attendantOnlyMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'UNAVAILABLE',
        unavailableReason: 'Meter display unreadable',
        expectedVersion: 0,
      },
      `a3bl-exception-scope-report-${boundaryId}`,
    );
    expect(reported.status).toBe(200);

    // Cross business-day and cross-shift: a legitimate boundary in a different,
    // genuinely open business day/shift cannot resolve this exception.
    const crossDayResolve = await postCommand(
      {
        commandType: 'ResolveMeterException',
        tenantId: ids.tenant,
        stationId: ids.stationException,
        boundaryId: randomUUID(),
        nozzleId: ids.nozzleExceptionA,
        meterInstallationId: ids.installationExceptionA,
        businessDayId: ids.dayExceptionOther,
        shiftId: ids.shiftExceptionOther,
        responsibleAttendantId: ids.attendantOnlyMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '4500.000',
        exceptionBoundaryId: boundaryId,
        expectedVersion: 0,
      },
      `a3bl-exception-scope-cross-day-${boundaryId}`,
    );
    expect(crossDayResolve.status).toBe(409);

    // Cross nozzle/meter-installation: a legitimate boundary against a
    // different nozzle on the same day/shift cannot resolve this exception.
    const crossNozzleResolve = await postCommand(
      {
        commandType: 'ResolveMeterException',
        tenantId: ids.tenant,
        stationId: ids.stationException,
        boundaryId: randomUUID(),
        nozzleId: ids.nozzleExceptionB,
        meterInstallationId: ids.installationExceptionB,
        businessDayId: ids.dayException,
        shiftId: ids.shiftException,
        responsibleAttendantId: ids.attendantOnlyMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '100.000',
        exceptionBoundaryId: boundaryId,
        expectedVersion: 0,
      },
      `a3bl-exception-scope-cross-nozzle-${boundaryId}`,
    );
    expect(crossNozzleResolve.status).toBe(409);

    const stillBlocking = await client<{ status: string }[]>`
      select status from app.meter_exceptions where id = ${boundaryId}
    `;
    expect(stillBlocking).toEqual([{ status: 'BLOCKING' }]);
  });

  it('resolves exactly once under concurrent ResolveMeterException attempts with distinct idempotency keys', async () => {
    const boundaryId = randomUUID();
    const reported = await postCommand(
      {
        commandType: 'ReportMeterUnavailable',
        tenantId: ids.tenant,
        stationId: ids.stationException,
        boundaryId,
        nozzleId: ids.nozzleExceptionA,
        meterInstallationId: ids.installationExceptionA,
        businessDayId: ids.dayException,
        shiftId: ids.shiftException,
        responsibleAttendantId: ids.attendantOnlyMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'UNAVAILABLE',
        unavailableReason: 'Meter display unreadable',
        expectedVersion: 0,
      },
      `a3bl-exception-race-report-${boundaryId}`,
    );
    expect(reported.status).toBe(200);

    const raceInput = (resolutionBoundaryId: string) => ({
      commandType: 'ResolveMeterException',
      tenantId: ids.tenant,
      stationId: ids.stationException,
      boundaryId: resolutionBoundaryId,
      nozzleId: ids.nozzleExceptionA,
      meterInstallationId: ids.installationExceptionA,
      businessDayId: ids.dayException,
      shiftId: ids.shiftException,
      responsibleAttendantId: ids.attendantOnlyMembership,
      reason: 'SHIFT_CLOSE',
      readingStatus: 'AVAILABLE',
      readingValue: '4500.000',
      exceptionBoundaryId: boundaryId,
      expectedVersion: 0,
    });
    const [first, second] = await Promise.all([
      postCommand(raceInput(randomUUID()), `a3bl-exception-race-a-${boundaryId}`),
      postCommand(raceInput(randomUUID()), `a3bl-exception-race-b-${boundaryId}`),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const resolutionRows = await client<{ count: number }[]>`
      select count(*)::int as count from app.meter_exception_resolutions where exception_id = ${boundaryId}
    `;
    expect(resolutionRows).toEqual([{ count: 1 }]);
    const resolvedState = await client<{ status: string }[]>`
      select status from app.meter_exceptions where id = ${boundaryId}
    `;
    expect(resolvedState).toEqual([{ status: 'RESOLVED' }]);
    const outboxRows = await client<{ count: number }[]>`
      select count(*)::int as count from app.forecourt_outbox
      where event_type = 'forecourt.meter_exception_resolved.v1' and payload->>'exceptionId' = ${boundaryId}
    `;
    expect(outboxRows).toEqual([{ count: 1 }]);
  });

  it('cannot execute app.resolve_meter_exception as PUBLIC but app_runtime can', async () => {
    const publicCheck = await client<{ allowed: boolean }[]>`
      select has_function_privilege(
        'public',
        'app.resolve_meter_exception(uuid,uuid,uuid,uuid,text,uuid,uuid)',
        'EXECUTE'
      ) as allowed
    `;
    expect(publicCheck).toEqual([{ allowed: false }]);

    const runtimeCheck = await client<{ allowed: boolean }[]>`
      select has_function_privilege(
        'app_runtime',
        'app.resolve_meter_exception(uuid,uuid,uuid,uuid,text,uuid,uuid)',
        'EXECUTE'
      ) as allowed
    `;
    expect(runtimeCheck).toEqual([{ allowed: true }]);
  });
});
