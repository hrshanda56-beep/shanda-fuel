import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { makeSignature } from 'better-auth/crypto';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';

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
};

let client: Sql;

function parseBusinessDate(businessDate: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) throw new Error(`Invalid business date: ${businessDate}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
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
        ('${ids.approverActor}', 'A3 Lifecycle Approver', 'a3-lifecycle-approver@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE'),
        ('${ids.approverMembership}', '${ids.tenant}', '${ids.approverActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A3 Lifecycle Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A3BL', 'A3 Lifecycle Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationMismatch}', '${ids.tenant}', '${ids.legal}', 'A3BLM', 'A3 Lifecycle Station Mismatch', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationIdempotent}', '${ids.tenant}', '${ids.legal}', 'A3BLI', 'A3 Lifecycle Station Idempotent', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationFullDay}', '${ids.tenant}', '${ids.legal}', 'A3BLF', 'A3 Lifecycle Station Full Day', 'ACTIVE', 'Africa/Harare')
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
          ('${ids.tenant}', '${ids.approverMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.stationFullDay}')
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.product}', '${ids.tenant}', 'A3BL-DIESEL', 'Diesel') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number)
        values
          ('${ids.pump}', '${ids.tenant}', '${ids.station}', '1'),
          ('${ids.pumpFullDay}', '${ids.tenant}', '${ids.stationFullDay}', '1')
        on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id)
        values
          ('${ids.nozzle}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '1', '${ids.product}'),
          ('${ids.nozzleFullDay}', '${ids.tenant}', '${ids.stationFullDay}', '${ids.pumpFullDay}', '1', '${ids.product}')
        on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values
          ('${ids.meter}', '${ids.tenant}', 'A3BL-METER-1'),
          ('${ids.meterFullDay}', '${ids.tenant}', 'A3BL-METER-2')
        on conflict (id) do nothing;
      insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values
          ('${ids.installation}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.meter}', '2020-01-01T00:00:00Z', '${ids.membership}'),
          ('${ids.installationFullDay}', '${ids.tenant}', '${ids.stationFullDay}', '${ids.nozzleFullDay}', '${ids.meterFullDay}', '2020-01-01T00:00:00Z', '${ids.membership}')
        on conflict (id) do nothing;
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
          ('${ids.approverSession}', '2030-01-01T00:00:00Z', 'a3b-approver-session-token', '${ids.approverActor}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
    `);
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

    const plannedStartAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const plannedEndAt = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
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

    // No production "create reconciliation draft" command exists yet in this
    // codebase (confirmed: SubmitReconciliation only loads an existing READY
    // revision) -- draft creation is static/config-shaped fixture data here,
    // matching the same precedent already used by every approved test in
    // tests/integration/a3-forecourt.test.ts.
    const reconciliationId = randomUUID();
    const revisionId = randomUUID();
    await client.unsafe(`
      insert into app.reconciliations (id, tenant_id, station_id, business_day_id, state)
        values ('${reconciliationId}', '${ids.tenant}', '${ids.stationFullDay}', '${businessDayId}', 'DRAFT');
      update app.reconciliations set state = 'READY' where id = '${reconciliationId}';
      insert into app.reconciliation_revisions
        (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance,
         variance_classification, declarations)
      values ('${revisionId}', '${ids.tenant}', '${ids.stationFullDay}', '${reconciliationId}', 1, 'READY', 0, 0, 0, 'INFORMATIONAL', '[]'::jsonb);
    `);

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

    // SubmitReconciliation persists 'SUBMITTED'; promotion to the
    // approval-eligible 'PENDING_APPROVAL' state has no production command in
    // this codebase yet either (same precedent used in the existing approved
    // stale-winner/race tests).
    await client.unsafe(
      `update app.reconciliation_revisions set state = 'PENDING_APPROVAL' where id = '${revisionId}'`,
    );

    const approve = await postCommand(
      {
        commandType: 'ApproveReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationFullDay,
        revisionId,
        expectedVersion: 1,
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
        expectedVersion: 2,
      },
      `a3bl-full-post-${revisionId}`,
      'a3b-approver-session-token',
    );
    expect(post.status).toBe(200);

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

    const outboxEvents = await client<
      { event_type: string }[]
    >`select event_type from app.forecourt_outbox where tenant_id = ${ids.tenant} and station_id = ${ids.stationFullDay}
      and (aggregate_id = ${businessDayId} or aggregate_id = ${shiftId}) order by event_type`;
    expect(outboxEvents.map((row) => row.event_type)).toEqual(
      expect.arrayContaining(['forecourt.business_day_opened.v1', 'forecourt.shift_started.v1']),
    );
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
