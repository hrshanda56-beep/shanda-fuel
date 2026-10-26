import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';
import { POST as setupCommandPost } from '../../src/app/api/setup/commands/route';
import { GET as priceChangeGet } from '../../src/app/api/forecourt/price-change/route';
import { stationBusinessDayBounds } from './station-business-time';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A3 forecourt integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

// A distinct fixture namespace from the other A3 integration test files so all
// three can seed the same database without id collisions.
const ids = {
  tenant: 'a3c00000-0000-4000-8000-000000000001',
  legal: 'a3c00000-0000-4000-8000-000000000011',
  actor: 'a3c00000-0000-4000-8000-000000000031',
  membership: 'a3c00000-0000-4000-8000-000000000041',
  actorB: 'a3c00000-0000-4000-8000-000000000032',
  membershipB: 'a3c00000-0000-4000-8000-000000000042',
  approverActor: 'a3c00000-0000-4000-8000-000000000033',
  approverMembership: 'a3c00000-0000-4000-8000-000000000043',
  session: 'a3c00000-0000-4000-8000-000000000051',
  sessionB: 'a3c00000-0000-4000-8000-000000000052',
  approverSession: 'a3c00000-0000-4000-8000-000000000053',
  product: 'a3c00000-0000-4000-8000-000000000061',

  // Shift-template stations/fixtures.
  stationTemplates: 'a3c00000-0000-4000-8000-000000000101',
  templateDefault: 'a3c00000-0000-4000-8000-000000000111',
  templateCustom: 'a3c00000-0000-4000-8000-000000000112',
  templateInactive: 'a3c00000-0000-4000-8000-000000000113',
  templateOtherStation: 'a3c00000-0000-4000-8000-000000000114',
  stationTemplatesOther: 'a3c00000-0000-4000-8000-000000000102',
  stationTemplatesOvernight: 'a3c00000-0000-4000-8000-000000000103',

  // Handover-segmented scenario.
  stationHandover: 'a3c00000-0000-4000-8000-000000000201',
  pumpHandover: 'a3c00000-0000-4000-8000-000000000211',
  nozzleHandover: 'a3c00000-0000-4000-8000-000000000221',
  meterHandover: 'a3c00000-0000-4000-8000-000000000231',
  installationHandover: 'a3c00000-0000-4000-8000-000000000241',
  priceHandover: 'a3c00000-0000-4000-8000-000000000251',

  // Price-segmented scenario.
  stationPrice: 'a3c00000-0000-4000-8000-000000000301',
  pumpPrice: 'a3c00000-0000-4000-8000-000000000311',
  nozzlePrice: 'a3c00000-0000-4000-8000-000000000321',
  meterPrice: 'a3c00000-0000-4000-8000-000000000331',
  installationPrice: 'a3c00000-0000-4000-8000-000000000341',
  priceOld: 'a3c00000-0000-4000-8000-000000000351',
  priceNew: 'a3c00000-0000-4000-8000-000000000352',

  // Correction-aware scenario.
  stationCorrection: 'a3c00000-0000-4000-8000-000000000401',
  pumpCorrection: 'a3c00000-0000-4000-8000-000000000411',
  nozzleCorrection: 'a3c00000-0000-4000-8000-000000000421',
  meterCorrection: 'a3c00000-0000-4000-8000-000000000431',
  installationCorrection: 'a3c00000-0000-4000-8000-000000000441',
  priceCorrection: 'a3c00000-0000-4000-8000-000000000451',

  // Midnight-crossing scenario.
  stationMidnight: 'a3c00000-0000-4000-8000-000000000501',
  pumpMidnight: 'a3c00000-0000-4000-8000-000000000511',
  nozzleMidnight: 'a3c00000-0000-4000-8000-000000000521',
  meterMidnight: 'a3c00000-0000-4000-8000-000000000531',
  installationMidnight: 'a3c00000-0000-4000-8000-000000000541',
  priceMidnight: 'a3c00000-0000-4000-8000-000000000551',
};

let client: Sql;

async function postCommand(
  input: Record<string, unknown>,
  key: string,
  token = 'a3c-session-token',
) {
  const signedToken = token;
  return forecourtCommandPost(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(signedToken, input),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function businessDayBoundsForStation(stationId: string, businessDate: string) {
  const rows = await client<{ timezone: string }[]>`
    select timezone from app.stations where id = ${stationId}
  `;
  if (rows.length !== 1) throw new Error(`Station ${stationId} was not found`);
  return stationBusinessDayBounds(businessDate, rows[0]!.timezone);
}

describe('A3 shift templates and multi-segment shifts through production commands', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';

    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a3-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });

    const stations = [
      ids.stationTemplates,
      ids.stationTemplatesOther,
      ids.stationTemplatesOvernight,
      ids.stationHandover,
      ids.stationPrice,
      ids.stationCorrection,
      ids.stationMidnight,
    ];
    const stationValues = stations
      .map(
        (station, index) =>
          `('${station}', '${ids.tenant}', '${ids.legal}', 'A3C-${index}', 'A3 Segmented Station ${index}', 'ACTIVE', 'Africa/Harare')`,
      )
      .join(',\n');

    const pumpNozzleMeterInstall = [
      [
        ids.stationHandover,
        ids.pumpHandover,
        ids.nozzleHandover,
        ids.meterHandover,
        ids.installationHandover,
      ],
      [ids.stationPrice, ids.pumpPrice, ids.nozzlePrice, ids.meterPrice, ids.installationPrice],
      [
        ids.stationCorrection,
        ids.pumpCorrection,
        ids.nozzleCorrection,
        ids.meterCorrection,
        ids.installationCorrection,
      ],
      [
        ids.stationMidnight,
        ids.pumpMidnight,
        ids.nozzleMidnight,
        ids.meterMidnight,
        ids.installationMidnight,
      ],
    ];

    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A3 Segmented Tenant', 'a3-segmented-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.actor}', 'A3 Segmented Attendant A', 'a3-segmented-attendant-a@example.test'),
        ('${ids.actorB}', 'A3 Segmented Attendant B', 'a3-segmented-attendant-b@example.test'),
        ('${ids.approverActor}', 'A3 Segmented Approver', 'a3-segmented-approver@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE'),
        ('${ids.membershipB}', '${ids.tenant}', '${ids.actorB}', 'ACTIVE'),
        ('${ids.approverMembership}', '${ids.tenant}', '${ids.approverActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A3 Segmented Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ${stationValues}
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values
          ${stations
            .map(
              (station) =>
                `('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${station}'),
                 ('${ids.tenant}', '${ids.membership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${station}'),
                 ('${ids.tenant}', '${ids.membershipB}', 'ATTENDANT', 'STATION', '${ids.legal}', '${station}'),
                 ('${ids.tenant}', '${ids.approverMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${station}')`,
            )
            .join(',\n')}
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.product}', '${ids.tenant}', 'A3C-DIESEL', 'Diesel') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number)
        values
          ${pumpNozzleMeterInstall.map(([station, pump]) => `('${pump}', '${ids.tenant}', '${station}', '1')`).join(',\n')}
        on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id)
        values
          ${pumpNozzleMeterInstall
            .map(
              ([station, pump, nozzle]) =>
                `('${nozzle}', '${ids.tenant}', '${station}', '${pump}', '1', '${ids.product}')`,
            )
            .join(',\n')}
        on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values
          ${pumpNozzleMeterInstall
            .map(([, , , meter], index) => `('${meter}', '${ids.tenant}', 'A3C-METER-${index}')`)
            .join(',\n')}
        on conflict (id) do nothing;
      insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values
          ${pumpNozzleMeterInstall
            .map(
              ([station, , nozzle, meter, installation]) =>
                `('${installation}', '${ids.tenant}', '${station}', '${nozzle}', '${meter}', '2020-01-01T00:00:00Z', '${ids.membership}')`,
            )
            .join(',\n')}
        on conflict (id) do nothing;
      -- The price-segmented scenario's old/new prices are seeded inside that test
      -- itself: the cutover instant they must share is only known once the real
      -- boundary confirmations run, and an ACTIVE price row's effective_to/from
      -- becomes immutable, so the range has to be fixed before activation.
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
        values
          ('${ids.priceHandover}', '${ids.tenant}', '${ids.stationHandover}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.membership}'),
          ('${ids.priceCorrection}', '${ids.tenant}', '${ids.stationCorrection}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.membership}'),
          ('${ids.priceMidnight}', '${ids.tenant}', '${ids.stationMidnight}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.membership}')
        on conflict (id) do nothing;
      update app.selling_prices set state = 'PENDING_APPROVAL' where id in
        ('${ids.priceHandover}', '${ids.priceCorrection}', '${ids.priceMidnight}') and state = 'DRAFT';
      update app.selling_prices set state = 'APPROVED', approved_by = '${ids.membership}', approved_at = clock_timestamp() where id in
        ('${ids.priceHandover}', '${ids.priceCorrection}', '${ids.priceMidnight}') and state = 'PENDING_APPROVAL';
      update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id in
        ('${ids.priceHandover}', '${ids.priceCorrection}', '${ids.priceMidnight}') and state = 'APPROVED';
      update app.selling_prices set state = 'BOUNDARIES_IN_PROGRESS' where id in
        ('${ids.priceHandover}', '${ids.priceCorrection}', '${ids.priceMidnight}') and state = 'PENDING_STATION_ACTIVATION';
      update app.selling_prices set state = 'ACTIVE' where id in
        ('${ids.priceHandover}', '${ids.priceCorrection}', '${ids.priceMidnight}') and state = 'BOUNDARIES_IN_PROGRESS';
    `);
    await seedClerkSession(client, ids.session, 'a3c-session-token', ids.actor, true);
    await seedClerkSession(client, ids.sessionB, 'a3c-session-token-b', ids.actorB, true);
    await seedClerkSession(
      client,
      ids.approverSession,
      'a3c-approver-session-token',
      ids.approverActor,
      true,
    );
    await seedActiveStepUp(client, ids.session, ids.tenant);
    await seedActiveStepUp(client, ids.approverSession, ids.tenant);
  });

  afterAll(async () => {
    await client?.end();
  });

  // ---------------------------------------------------------------------
  // Shift templates (Tasks 5-8)
  // ---------------------------------------------------------------------

  it('creates a default 480-minute shift template and a custom-duration template through DefineShiftTemplate', async () => {
    const defineDefault = await postCommand(
      {
        commandType: 'DefineShiftTemplate',
        tenantId: ids.tenant,
        stationId: ids.stationTemplates,
        shiftTemplateId: ids.templateDefault,
        expectedVersion: 0,
        code: 'DEFAULT',
        name: 'Default Shift',
        durationMinutes: 480,
      },
      `a3c-template-default-${ids.templateDefault}`,
      'a3c-approver-session-token',
    );
    expect(defineDefault.status).toBe(200);

    const defineCustom = await postCommand(
      {
        commandType: 'DefineShiftTemplate',
        tenantId: ids.tenant,
        stationId: ids.stationTemplates,
        shiftTemplateId: ids.templateCustom,
        expectedVersion: 0,
        code: 'NIGHT',
        name: 'Night Shift',
        durationMinutes: 600,
      },
      `a3c-template-custom-${ids.templateCustom}`,
      'a3c-approver-session-token',
    );
    expect(defineCustom.status).toBe(200);

    const defineInactive = await postCommand(
      {
        commandType: 'DefineShiftTemplate',
        tenantId: ids.tenant,
        stationId: ids.stationTemplates,
        shiftTemplateId: ids.templateInactive,
        expectedVersion: 0,
        code: 'RETIRED',
        name: 'Retired Shift',
        durationMinutes: 480,
        active: false,
      },
      `a3c-template-inactive-${ids.templateInactive}`,
      'a3c-approver-session-token',
    );
    expect(defineInactive.status).toBe(200);

    const defineOtherStation = await postCommand(
      {
        commandType: 'DefineShiftTemplate',
        tenantId: ids.tenant,
        stationId: ids.stationTemplatesOther,
        shiftTemplateId: ids.templateOtherStation,
        expectedVersion: 0,
        code: 'DEFAULT',
        name: 'Other Station Default',
        durationMinutes: 480,
      },
      `a3c-template-other-${ids.templateOtherStation}`,
      'a3c-approver-session-token',
    );
    expect(defineOtherStation.status).toBe(200);

    const rows = await client<{ code: string; duration_minutes: number; active: boolean }[]>`
      select code, duration_minutes, active from app.shift_templates
      where tenant_id = ${ids.tenant} and station_id = ${ids.stationTemplates} order by code
    `;
    expect(rows).toEqual(
      expect.arrayContaining([
        { code: 'DEFAULT', duration_minutes: 480, active: true },
        { code: 'NIGHT', duration_minutes: 600, active: true },
        { code: 'RETIRED', duration_minutes: 480, active: false },
      ]),
    );
  });

  it('honors a configured shift template duration in StartShift with no fixed clock window, rejects an inactive template, and rejects a template from another station', async () => {
    const businessDayId = randomUUID();
    const open = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationTemplates,
        businessDayId,
        expectedVersion: 0,
      },
      `a3c-template-open-${businessDayId}`,
    );
    expect(open.status).toBe(200);
    const { businessDate } = await json<{ businessDate: string }>(open);
    const { plannedStartAt } = await businessDayBoundsForStation(
      ids.stationTemplates,
      businessDate,
    );

    // Non-default duration: the shift's plannedEndAt is derived from the
    // template's 600-minute duration, not an 8-hour hardcoded rule.
    const shiftId = randomUUID();
    const start = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationTemplates,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt,
        shiftTemplateId: ids.templateCustom,
      },
      `a3c-template-start-${shiftId}`,
    );
    expect(start.status).toBe(200);

    const shiftRow = await client<
      { planned_start_at: Date; planned_end_at: Date; shift_template_id: string }[]
    >`select planned_start_at, planned_end_at, shift_template_id from app.shifts where id = ${shiftId}`;
    const minutes =
      (shiftRow[0]!.planned_end_at.getTime() - shiftRow[0]!.planned_start_at.getTime()) / 60_000;
    expect(minutes).toBe(600);
    expect(shiftRow[0]!.shift_template_id).toBe(ids.templateCustom);

    // Inactive template rejected.
    const inactiveShiftId = randomUUID();
    const inactiveAttempt = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationTemplates,
        businessDayId,
        shiftId: inactiveShiftId,
        expectedVersion: 0,
        plannedStartAt,
        shiftTemplateId: ids.templateInactive,
      },
      `a3c-template-inactive-attempt-${inactiveShiftId}`,
    );
    expect(inactiveAttempt.status).toBe(400);

    // Wrong-station template rejected (it belongs to stationTemplatesOther).
    const wrongStationShiftId = randomUUID();
    const wrongStationAttempt = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationTemplates,
        businessDayId,
        shiftId: wrongStationShiftId,
        expectedVersion: 0,
        plannedStartAt,
        shiftTemplateId: ids.templateOtherStation,
      },
      `a3c-template-wrong-station-attempt-${wrongStationShiftId}`,
    );
    expect(wrongStationAttempt.status).toBe(404);
  });

  it('honors the default 480-minute template overnight and still derives BusinessDate from the start-instant station timezone', async () => {
    const overnightTemplateId = randomUUID();
    const defineTemplate = await postCommand(
      {
        commandType: 'DefineShiftTemplate',
        tenantId: ids.tenant,
        stationId: ids.stationTemplatesOvernight,
        shiftTemplateId: overnightTemplateId,
        expectedVersion: 0,
        code: 'DEFAULT',
        name: 'Default Shift',
        durationMinutes: 480,
      },
      `a3c-template-overnight-define-${overnightTemplateId}`,
      'a3c-approver-session-token',
    );
    expect(defineTemplate.status).toBe(200);

    const businessDayId = randomUUID();
    const open = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationTemplatesOvernight,
        businessDayId,
        expectedVersion: 0,
      },
      `a3c-template-overnight-open-${businessDayId}`,
    );
    expect(open.status).toBe(200);
    const { businessDate } = await json<{ businessDate: string }>(open);

    // Start near local midnight in Africa/Harare (UTC+2): 23:30 local ->
    // 21:30Z on the business day.
    const [year, month, day] = businessDate.split('-').map(Number);
    const plannedStartAt = new Date(Date.UTC(year!, month! - 1, day!, 21, 30, 0)).toISOString();
    const shiftId = randomUUID();
    const start = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationTemplatesOvernight,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt,
        shiftTemplateId: overnightTemplateId,
      },
      `a3c-template-overnight-start-${shiftId}`,
    );
    expect(start.status).toBe(200);
    const startBody = await json<{ businessDate: string }>(start);
    expect(startBody.businessDate).toBe(businessDate);

    const shiftRow = await client<{ planned_end_at: Date }[]>`
      select planned_end_at from app.shifts where id = ${shiftId}
    `;
    // 480 minutes past 21:30Z crosses into the next UTC calendar day, proving
    // the template governs duration independent of any fixed clock window.
    expect(shiftRow[0]!.planned_end_at.toISOString()).toBe(
      new Date(Date.UTC(year!, month! - 1, day!, 21, 30, 0) + 480 * 60_000).toISOString(),
    );
  });

  // ---------------------------------------------------------------------
  // Task 1: handover-segmented shift through reconciliation
  // ---------------------------------------------------------------------

  it('drives a handover-segmented shift from OpenBusinessDay through LockBusinessDay with two attendants and one effective segment each', async () => {
    const businessDayId = randomUUID();
    const shiftId = randomUUID();

    const open = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        businessDayId,
        expectedVersion: 0,
      },
      `a3c-handover-open-${businessDayId}`,
    );
    expect(open.status).toBe(200);
    const { businessDate } = await json<{ businessDate: string }>(open);

    const { plannedStartAt, plannedEndAt } = await businessDayBoundsForStation(
      ids.stationHandover,
      businessDate,
    );
    const start = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt,
        plannedEndAt,
      },
      `a3c-handover-start-${shiftId}`,
    );
    expect(start.status).toBe(200);

    const openingBoundaryId = randomUUID();
    const openingBoundary = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        boundaryId: openingBoundaryId,
        nozzleId: ids.nozzleHandover,
        meterInstallationId: ids.installationHandover,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_OPEN',
        readingStatus: 'AVAILABLE',
        readingValue: '5000.000',
        exceptionReason: 'First reading on a freshly installed meter',
        expectedVersion: 1,
      },
      `a3c-handover-opening-${shiftId}`,
    );
    expect(openingBoundary.status).toBe(200);

    // Attendant A's mid-shift checkpoint reading, entered as the terminal-close
    // reason so it becomes segment A's real closing boundary; the subsequent
    // handover boundary carries this exact value forward for attendant B.
    const midCloseBoundaryId = randomUUID();
    const midClose = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        boundaryId: midCloseBoundaryId,
        nozzleId: ids.nozzleHandover,
        meterInstallationId: ids.installationHandover,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '5400.000',
        expectedVersion: 1,
      },
      `a3c-handover-midclose-${shiftId}`,
    );
    expect(midClose.status).toBe(200);

    const handoverBoundaryId = randomUUID();
    const handover = await postCommand(
      {
        commandType: 'HandoverAttendant',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        boundaryId: handoverBoundaryId,
        priorBoundaryId: midCloseBoundaryId,
        nozzleId: ids.nozzleHandover,
        meterInstallationId: ids.installationHandover,
        businessDayId,
        shiftId,
        newAttendantId: ids.membershipB,
        expectedVersion: 1,
      },
      `a3c-handover-handover-${shiftId}`,
    );
    expect(handover.status).toBe(200);

    const finalCloseBoundaryId = randomUUID();
    const finalClose = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        boundaryId: finalCloseBoundaryId,
        nozzleId: ids.nozzleHandover,
        meterInstallationId: ids.installationHandover,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membershipB,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '5900.000',
        expectedVersion: 2,
      },
      `a3c-handover-finalclose-${shiftId}`,
    );
    expect(finalClose.status).toBe(200);

    const boundaryTimes = await client<{ id: string; effective_at: Date }[]>`
      select id, effective_at from app.meter_boundaries
      where id in (${openingBoundaryId}, ${midCloseBoundaryId}, ${handoverBoundaryId}, ${finalCloseBoundaryId})
    `;
    const at = (id: string) =>
      boundaryTimes.find((row) => row.id === id)!.effective_at.toISOString();

    const segmentAId = randomUUID();
    const sealA = await postCommand(
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        segmentId: segmentAId,
        nozzleId: ids.nozzleHandover,
        meterInstallationId: ids.installationHandover,
        businessDayId,
        shiftId,
        openingBoundaryId,
        closingBoundaryId: midCloseBoundaryId,
        productId: ids.product,
        responsibleAttendantId: ids.membership,
        startAt: at(openingBoundaryId),
        endAt: at(midCloseBoundaryId),
        expectedVersion: 0,
      },
      `a3c-handover-seal-a-${segmentAId}`,
    );
    expect(sealA.status).toBe(201);

    const segmentBId = randomUUID();
    const sealB = await postCommand(
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        segmentId: segmentBId,
        nozzleId: ids.nozzleHandover,
        meterInstallationId: ids.installationHandover,
        businessDayId,
        shiftId,
        openingBoundaryId: handoverBoundaryId,
        closingBoundaryId: finalCloseBoundaryId,
        productId: ids.product,
        responsibleAttendantId: ids.membershipB,
        startAt: at(handoverBoundaryId),
        endAt: at(finalCloseBoundaryId),
        expectedVersion: 0,
      },
      `a3c-handover-seal-b-${segmentBId}`,
    );
    expect(sealB.status).toBe(201);

    const segmentRows = await client<
      { id: string; litres: string; attendant_id: string; expected_sale_value: string }[]
    >`select id, litres, attendant_id, expected_sale_value from app.meter_segments
       where id in (${segmentAId}, ${segmentBId}) order by segment_start_at`;
    expect(segmentRows).toEqual([
      {
        id: segmentAId,
        litres: '400.000',
        attendant_id: ids.membership,
        expected_sale_value: '600.0000',
      },
      {
        id: segmentBId,
        litres: '500.000',
        attendant_id: ids.membershipB,
        expected_sale_value: '750.0000',
      },
    ]);

    const closeMeters = await postCommand(
      {
        commandType: 'CloseMeters',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        businessDayId,
        shiftId,
        expectedVersion: 2,
      },
      `a3c-handover-closemeters-${shiftId}`,
    );
    expect(closeMeters.status).toBe(200);

    const completeShift = await postCommand(
      {
        commandType: 'CompleteShift',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        businessDayId,
        shiftId,
        expectedVersion: 3,
      },
      `a3c-handover-complete-${shiftId}`,
    );
    expect(completeShift.status).toBe(200);

    const reconciliationId = randomUUID();
    const revisionId = randomUUID();
    const createReconciliation = await postCommand(
      {
        commandType: 'CreateReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        businessDayId,
        reconciliationId,
        revisionId,
        expectedVersion: 0,
      },
      `a3c-handover-createrecon-${reconciliationId}`,
    );
    expect(createReconciliation.status).toBe(200);

    const revisionRows = await client<{ expected_sales: string; source_segment_ids: string[] }[]>`
      select expected_sales, source_segment_ids from app.reconciliation_revisions where id = ${revisionId}
    `;
    expect(revisionRows[0]!.expected_sales).toBe('1350.0000');
    expect(new Set(revisionRows[0]!.source_segment_ids)).toEqual(new Set([segmentAId, segmentBId]));

    const submit = await postCommand(
      {
        commandType: 'SubmitReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        revisionId,
        expectedVersion: 0,
        declarations: [{ category: 'CASH', amount: '1350.00' }],
      },
      `a3c-handover-submit-${revisionId}`,
    );
    expect(submit.status).toBe(200);

    const approve = await postCommand(
      {
        commandType: 'ApproveReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        revisionId,
        expectedVersion: 2,
      },
      `a3c-handover-approve-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(approve.status).toBe(200);

    const post = await postCommand(
      {
        commandType: 'PostReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        revisionId,
        expectedVersion: 3,
      },
      `a3c-handover-post-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(post.status).toBe(200);

    const lockRevision = await postCommand(
      {
        commandType: 'LockReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        revisionId,
        expectedVersion: 4,
      },
      `a3c-handover-lockrev-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(lockRevision.status).toBe(200);

    const close = await postCommand(
      {
        commandType: 'CloseBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        businessDayId,
        expectedVersion: 1,
      },
      `a3c-handover-closeday-${businessDayId}`,
    );
    expect(close.status).toBe(200);

    const lock = await postCommand(
      {
        commandType: 'LockBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationHandover,
        businessDayId,
        expectedVersion: 3,
      },
      `a3c-handover-lockday-${businessDayId}`,
    );
    expect(lock.status).toBe(200);

    const dayRows = await client<{ state: string }[]>`
      select state from app.station_business_days where id = ${businessDayId}
    `;
    expect(dayRows).toEqual([{ state: 'LOCKED' }]);

    const finalRevision = await client<
      {
        state: string;
        expected_sales: string;
        accounted_sales: string;
        variance: string;
        declarations: unknown;
      }[]
    >`select state, expected_sales, accounted_sales, variance, declarations
       from app.reconciliation_revisions where id = ${revisionId}`;
    expect(finalRevision).toEqual([
      {
        state: 'LOCKED',
        expected_sales: '1350.0000',
        accounted_sales: '1350.0000',
        variance: '0.0000',
        declarations: [
          expect.objectContaining({ category: 'CASH', amount: '1350', currency: 'USD' }),
        ],
      },
    ]);
    expect(businessDate).toBeTruthy();
  });

  // ---------------------------------------------------------------------
  // Task 2: price-segmented shift through reconciliation
  // ---------------------------------------------------------------------

  it('drives a price-segmented shift through RequestPriceChange, ApprovePriceChange, ConfirmPriceChangeBoundary, and ActivatePriceChange, then reconciles both segments exactly once', async () => {
    const businessDayId = randomUUID();
    const shiftId = randomUUID();

    // The old price is master data pre-existing before this scenario (like the
    // other stations' fixture prices), seeded up front but NOT yet activated:
    // its effective_to is the price-change cutover, which is only known once
    // the real cutover boundary below is confirmed, and an ACTIVE price row's
    // range is immutable, so it must be fixed before activation.
    await client.unsafe(`
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
        values ('${ids.priceOld}', '${ids.tenant}', '${ids.stationPrice}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.membership}')
        on conflict (id) do nothing;
    `);

    const open = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        businessDayId,
        expectedVersion: 0,
      },
      `a3c-price-open-${businessDayId}`,
    );
    expect(open.status).toBe(200);
    const { businessDate } = await json<{ businessDate: string }>(open);

    const { plannedStartAt, plannedEndAt } = await businessDayBoundsForStation(
      ids.stationPrice,
      businessDate,
    );
    const start = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt,
        plannedEndAt,
      },
      `a3c-price-start-${shiftId}`,
    );
    expect(start.status).toBe(200);

    const openingBoundaryId = randomUUID();
    const openingBoundary = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        boundaryId: openingBoundaryId,
        nozzleId: ids.nozzlePrice,
        meterInstallationId: ids.installationPrice,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_OPEN',
        readingStatus: 'AVAILABLE',
        readingValue: '8000.000',
        exceptionReason: 'First reading on a freshly installed meter',
        expectedVersion: 1,
      },
      `a3c-price-opening-${shiftId}`,
    );
    expect(openingBoundary.status).toBe(200);

    // The real physical reading progression happens on this ordinary
    // terminal-close boundary, which becomes the old segment's closing
    // boundary; its instant is the price-change cutover.
    const cutoverBoundaryId = randomUUID();
    const cutoverBoundary = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        boundaryId: cutoverBoundaryId,
        nozzleId: ids.nozzlePrice,
        meterInstallationId: ids.installationPrice,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '8300.000',
        expectedVersion: 1,
      },
      `a3c-price-cutover-${shiftId}`,
    );
    expect(cutoverBoundary.status).toBe(200);

    const cutoverRows = await client<{ effective_at: Date }[]>`
      select effective_at from app.meter_boundaries where id = ${cutoverBoundaryId}
    `;
    const cutover = cutoverRows[0]!.effective_at.toISOString();

    // Activate the old price directly and leave it open-ended: ActivatePriceChange must close it at
    // the changeover instant itself. Only the NEW price's activation is the scenario under test (see the RequestPriceChange ->
    // ApprovePriceChange -> ConfirmPriceChangeBoundary -> ActivatePriceChange
    // sequence below), matching how every other station's pre-existing active
    // price in this file is seeded.
    await client.unsafe(`
      update app.selling_prices set state = 'PENDING_APPROVAL' where id = '${ids.priceOld}' and state = 'DRAFT';
      update app.selling_prices set state = 'APPROVED', approved_by = '${ids.membership}', approved_at = clock_timestamp() where id = '${ids.priceOld}' and state = 'PENDING_APPROVAL';
      update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id = '${ids.priceOld}' and state = 'APPROVED';
      update app.selling_prices set state = 'BOUNDARIES_IN_PROGRESS' where id = '${ids.priceOld}' and state = 'PENDING_STATION_ACTIVATION';
      update app.selling_prices set state = 'ACTIVE' where id = '${ids.priceOld}' and state = 'BOUNDARIES_IN_PROGRESS';
    `);

    // The new price is drafted through the real setup command while the old price is still in use:
    // a second price for the same fuel must be possible.
    const draftNew = await setupCommandPost(
      new Request('http://127.0.0.1:3000/api/setup/commands', {
        method: 'POST',
        headers: {
          ...clerkHeaders('a3c-session-token', {}),
          'content-type': 'application/json',
          'idempotency-key': `a3c-price-draft-${shiftId}`,
        },
        body: JSON.stringify({
          commandType: 'DraftPriceChange',
          tenantId: ids.tenant,
          stationId: ids.stationPrice,
          productId: ids.product,
          unitPrice: '1.800000',
          currency: 'USD',
          effectiveFrom: new Date().toISOString(),
        }),
      }),
    );
    expect(draftNew.status).toBe(200);
    const priceNewId = (await json<{ priceId: string }>(draftNew)).priceId;

    // RequestPriceChange -> ApprovePriceChange (real commands).
    const request = await postCommand(
      {
        commandType: 'RequestPriceChange',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        priceId: priceNewId,
        expectedVersion: 0,
      },
      `a3c-price-request-${priceNewId}`,
      'a3c-approver-session-token',
    );
    expect(request.status).toBe(200);

    const approvePrice = await postCommand(
      {
        commandType: 'ApprovePriceChange',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        priceId: priceNewId,
        expectedVersion: 1,
      },
      `a3c-price-approve-${priceNewId}`,
      'a3c-approver-session-token',
    );
    expect(approvePrice.status).toBe(200);

    const preparePrice = await postCommand(
      {
        commandType: 'PreparePriceActivation',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        priceId: priceNewId,
        expectedVersion: 2,
      },
      `a3c-price-prepare-${priceNewId}`,
      'a3c-approver-session-token',
    );
    expect(preparePrice.status).toBe(200);

    // The "Change a price" screen's data: the change under way, and the pump still to be read.
    const readPriceChange = () =>
      priceChangeGet(
        new Request(
          `http://127.0.0.1:3000/api/forecourt/price-change?tenantId=${ids.tenant}&stationId=${ids.stationPrice}`,
          { headers: clerkHeaders('a3c-approver-session-token') },
        ),
      );
    const beforeReadings = await readPriceChange();
    expect(beforeReadings.status).toBe(200);
    const beforeBody = await json<{
      shift: { id: string } | null;
      products: Array<{
        currentPrice: string | null;
        change: { state: string; version: number } | null;
        nozzles: Array<{ done: boolean; lastReading: string | null }>;
      }>;
    }>(beforeReadings);
    const priceProduct = beforeBody.products[0]!;
    expect(priceProduct.currentPrice).toBe('1.500000');
    expect(priceProduct.change).toMatchObject({ state: 'PENDING_STATION_ACTIVATION', version: 3 });
    expect(priceProduct.nozzles).toEqual([
      expect.objectContaining({ done: false, lastReading: '8300.000' }),
    ]);
    expect(beforeBody.shift?.id).toBe(shiftId);

    // A price-change boundary is like an attendant handover: it must inherit
    // the immediately prior sealed reading verbatim (resolveOpeningReading),
    // it cannot introduce a fresh value itself -- it carries the cutover
    // boundary's exact value forward as the new segment's opening.
    const priceChangeBoundaryId = randomUUID();
    const priceBoundary = await postCommand(
      {
        commandType: 'ConfirmPriceChangeBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        boundaryId: priceChangeBoundaryId,
        nozzleId: ids.nozzlePrice,
        meterInstallationId: ids.installationPrice,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'PRICE_CHANGE',
        readingStatus: 'AVAILABLE',
        readingValue: '8300.000',
        priceChangeId: priceNewId,
        expectedVersion: 3,
      },
      `a3c-price-boundary-${shiftId}`,
    );
    expect(priceBoundary.status).toBe(200);
    const afterReadings = await json<{
      products: Array<{ nozzles: Array<{ done: boolean }> }>;
    }>(await readPriceChange());
    expect(afterReadings.products[0]!.nozzles).toEqual([expect.objectContaining({ done: true })]);

    const activate = await postCommand(
      {
        commandType: 'ActivatePriceChange',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        priceId: priceNewId,
        expectedVersion: 3,
      },
      `a3c-price-activate-${priceNewId}`,
      'a3c-approver-session-token',
    );
    expect(activate.status).toBe(200);

    // The changeover is one instant: the old price ends and the new one starts at the first
    // price-change meter reading.
    const changeover = await client<
      { id: string; effective_from: Date; effective_to: Date | null }[]
    >`
      select id, effective_from, effective_to from app.selling_prices
      where id in (${ids.priceOld}, ${priceNewId})
    `;
    const pcAt = (
      await client<{ effective_at: Date }[]>`
        select effective_at from app.meter_boundaries where id = ${priceChangeBoundaryId}
      `
    )[0]!.effective_at.toISOString();
    expect(changeover.find((row) => row.id === ids.priceOld)!.effective_to!.toISOString()).toBe(
      pcAt,
    );
    expect(changeover.find((row) => row.id === priceNewId)!.effective_from.toISOString()).toBe(
      pcAt,
    );

    const finalCloseBoundaryId = randomUUID();
    const finalClose = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        boundaryId: finalCloseBoundaryId,
        nozzleId: ids.nozzlePrice,
        meterInstallationId: ids.installationPrice,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '8700.000',
        expectedVersion: 1,
      },
      `a3c-price-finalclose-${shiftId}`,
    );
    expect(finalClose.status).toBe(200);

    const boundaryTimes = await client<{ id: string; effective_at: Date }[]>`
      select id, effective_at from app.meter_boundaries
      where id in (${openingBoundaryId}, ${cutoverBoundaryId}, ${priceChangeBoundaryId}, ${finalCloseBoundaryId})
    `;
    const at = (id: string) =>
      boundaryTimes.find((row) => row.id === id)!.effective_at.toISOString();

    const segmentOldId = randomUUID();
    const sealOld = await postCommand(
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        segmentId: segmentOldId,
        nozzleId: ids.nozzlePrice,
        meterInstallationId: ids.installationPrice,
        businessDayId,
        shiftId,
        openingBoundaryId,
        closingBoundaryId: cutoverBoundaryId,
        productId: ids.product,
        responsibleAttendantId: ids.membership,
        startAt: at(openingBoundaryId),
        endAt: cutover,
        expectedVersion: 0,
      },
      `a3c-price-seal-old-${segmentOldId}`,
    );
    expect(sealOld.status).toBe(201);

    const segmentNewId = randomUUID();
    const sealNew = await postCommand(
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        segmentId: segmentNewId,
        nozzleId: ids.nozzlePrice,
        meterInstallationId: ids.installationPrice,
        businessDayId,
        shiftId,
        openingBoundaryId: priceChangeBoundaryId,
        closingBoundaryId: finalCloseBoundaryId,
        productId: ids.product,
        responsibleAttendantId: ids.membership,
        startAt: at(priceChangeBoundaryId),
        endAt: at(finalCloseBoundaryId),
        expectedVersion: 0,
      },
      `a3c-price-seal-new-${segmentNewId}`,
    );
    expect(sealNew.status).toBe(201);

    const segmentRows = await client<
      { id: string; litres: string; unit_price: string; expected_sale_value: string }[]
    >`select id, litres, unit_price, expected_sale_value from app.meter_segments
       where id in (${segmentOldId}, ${segmentNewId}) order by segment_start_at`;
    expect(segmentRows).toEqual([
      {
        id: segmentOldId,
        litres: '300.000',
        unit_price: '1.500000',
        expected_sale_value: '450.0000',
      },
      {
        id: segmentNewId,
        litres: '400.000',
        unit_price: '1.800000',
        expected_sale_value: '720.0000',
      },
    ]);

    const closeMeters = await postCommand(
      {
        commandType: 'CloseMeters',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        businessDayId,
        shiftId,
        expectedVersion: 1,
      },
      `a3c-price-closemeters-${shiftId}`,
    );
    expect(closeMeters.status).toBe(200);

    const completeShift = await postCommand(
      {
        commandType: 'CompleteShift',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        businessDayId,
        shiftId,
        expectedVersion: 2,
      },
      `a3c-price-complete-${shiftId}`,
    );
    expect(completeShift.status).toBe(200);

    const reconciliationId = randomUUID();
    const revisionId = randomUUID();
    const createReconciliation = await postCommand(
      {
        commandType: 'CreateReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        businessDayId,
        reconciliationId,
        revisionId,
        expectedVersion: 0,
      },
      `a3c-price-createrecon-${reconciliationId}`,
    );
    expect(createReconciliation.status).toBe(200);

    const revisionRows = await client<{ expected_sales: string; source_segment_ids: string[] }[]>`
      select expected_sales, source_segment_ids from app.reconciliation_revisions where id = ${revisionId}
    `;
    // 450.0000 (old) + 720.0000 (new) = 1170.0000, each segment counted exactly once.
    expect(revisionRows[0]!.expected_sales).toBe('1170.0000');
    expect(new Set(revisionRows[0]!.source_segment_ids)).toEqual(
      new Set([segmentOldId, segmentNewId]),
    );

    const submit = await postCommand(
      {
        commandType: 'SubmitReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        revisionId,
        expectedVersion: 0,
        declarations: [{ category: 'CASH', amount: '1170.00' }],
      },
      `a3c-price-submit-${revisionId}`,
    );
    expect(submit.status).toBe(200);

    const approve = await postCommand(
      {
        commandType: 'ApproveReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        revisionId,
        expectedVersion: 2,
      },
      `a3c-price-approve-recon-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(approve.status).toBe(200);

    const post = await postCommand(
      {
        commandType: 'PostReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationPrice,
        revisionId,
        expectedVersion: 3,
      },
      `a3c-price-post-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(post.status).toBe(200);
  });

  // ---------------------------------------------------------------------
  // Task 3: correction-aware shift through reconciliation
  // ---------------------------------------------------------------------

  it('drives a correction-aware shift where the corrected interpretation is counted exactly once through reconciliation', async () => {
    const businessDayId = randomUUID();
    const shiftId = randomUUID();

    const open = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        businessDayId,
        expectedVersion: 0,
      },
      `a3c-correction-open-${businessDayId}`,
    );
    expect(open.status).toBe(200);
    const { businessDate } = await json<{ businessDate: string }>(open);

    const { plannedStartAt, plannedEndAt } = await businessDayBoundsForStation(
      ids.stationCorrection,
      businessDate,
    );
    const start = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt,
        plannedEndAt,
      },
      `a3c-correction-start-${shiftId}`,
    );
    expect(start.status).toBe(200);

    const openingBoundaryId = randomUUID();
    const openingBoundary = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        boundaryId: openingBoundaryId,
        nozzleId: ids.nozzleCorrection,
        meterInstallationId: ids.installationCorrection,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_OPEN',
        readingStatus: 'AVAILABLE',
        readingValue: '3000.000',
        exceptionReason: 'First reading on a freshly installed meter',
        expectedVersion: 1,
      },
      `a3c-correction-opening-${shiftId}`,
    );
    expect(openingBoundary.status).toBe(200);

    const closingBoundaryId = randomUUID();
    const closingBoundary = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        boundaryId: closingBoundaryId,
        nozzleId: ids.nozzleCorrection,
        meterInstallationId: ids.installationCorrection,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '3300.000',
        expectedVersion: 1,
      },
      `a3c-correction-closing-${shiftId}`,
    );
    expect(closingBoundary.status).toBe(200);

    const boundaryTimes = await client<{ id: string; effective_at: Date }[]>`
      select id, effective_at from app.meter_boundaries where id in (${openingBoundaryId}, ${closingBoundaryId})
    `;
    const at = (id: string) =>
      boundaryTimes.find((row) => row.id === id)!.effective_at.toISOString();

    const originalSegmentId = randomUUID();
    const sealOriginal = await postCommand(
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        segmentId: originalSegmentId,
        nozzleId: ids.nozzleCorrection,
        meterInstallationId: ids.installationCorrection,
        businessDayId,
        shiftId,
        openingBoundaryId,
        closingBoundaryId,
        productId: ids.product,
        responsibleAttendantId: ids.membership,
        startAt: at(openingBoundaryId),
        endAt: at(closingBoundaryId),
        expectedVersion: 0,
      },
      `a3c-correction-seal-original-${originalSegmentId}`,
    );
    expect(sealOriginal.status).toBe(201);

    const originalRows = await client<{ litres: string; state: string }[]>`
      select litres, state from app.meter_segments where id = ${originalSegmentId}
    `;
    expect(originalRows).toEqual([{ litres: '300.000', state: 'SEALED' }]);

    // Real named correction command: the attendant mis-keyed the closing
    // reading (3300 instead of the true 3290) and a supervisor corrects it.
    const correctedSegmentId = randomUUID();
    const correct = await postCommand(
      {
        commandType: 'CorrectMeterSegment',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        sourceSegmentId: originalSegmentId,
        correctedSegmentId,
        responsibleAttendantId: ids.membership,
        correctedClosingReading: '3290.000',
        reason: 'Closing reading was mis-keyed by ten litres',
        expectedVersion: 1,
      },
      `a3c-correction-correct-${correctedSegmentId}`,
      'a3c-approver-session-token',
    );
    expect(correct.status).toBe(200);

    // The original sealed segment remains physically stored and immutable.
    const lineageRows = await client<
      { id: string; state: string; litres: string; correction_of_segment_id: string | null }[]
    >`select id, state, litres, correction_of_segment_id from app.meter_segments
       where id in (${originalSegmentId}, ${correctedSegmentId}) order by id`;
    expect(lineageRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: originalSegmentId, state: 'SEALED', litres: '300.000' }),
        expect.objectContaining({
          id: correctedSegmentId,
          state: 'SEALED',
          litres: '290.000',
          correction_of_segment_id: originalSegmentId,
        }),
      ]),
    );

    const closeMeters = await postCommand(
      {
        commandType: 'CloseMeters',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        businessDayId,
        shiftId,
        expectedVersion: 1,
      },
      `a3c-correction-closemeters-${shiftId}`,
    );
    expect(closeMeters.status).toBe(200);

    const completeShift = await postCommand(
      {
        commandType: 'CompleteShift',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        businessDayId,
        shiftId,
        expectedVersion: 2,
      },
      `a3c-correction-complete-${shiftId}`,
    );
    expect(completeShift.status).toBe(200);

    const reconciliationId = randomUUID();
    const revisionId = randomUUID();
    const createReconciliation = await postCommand(
      {
        commandType: 'CreateReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        businessDayId,
        reconciliationId,
        revisionId,
        expectedVersion: 0,
      },
      `a3c-correction-createrecon-${reconciliationId}`,
    );
    expect(createReconciliation.status).toBe(200);

    const revisionRows = await client<{ expected_sales: string; source_segment_ids: string[] }[]>`
      select expected_sales, source_segment_ids from app.reconciliation_revisions where id = ${revisionId}
    `;
    // The canonical effective-segment projection excludes the superseded
    // original: 290 litres x 1.50 = 435.0000, not 300 x 1.50 = 450 and not
    // both summed (which would double count).
    expect(revisionRows[0]!.expected_sales).toBe('435.0000');
    expect(revisionRows[0]!.source_segment_ids).toEqual([correctedSegmentId]);

    const submit = await postCommand(
      {
        commandType: 'SubmitReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        revisionId,
        expectedVersion: 0,
        declarations: [{ category: 'CASH', amount: '435.00' }],
      },
      `a3c-correction-submit-${revisionId}`,
    );
    expect(submit.status).toBe(200);

    const approve = await postCommand(
      {
        commandType: 'ApproveReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        revisionId,
        expectedVersion: 2,
      },
      `a3c-correction-approve-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(approve.status).toBe(200);

    const post = await postCommand(
      {
        commandType: 'PostReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        revisionId,
        expectedVersion: 3,
      },
      `a3c-correction-post-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(post.status).toBe(200);

    const lockRevision = await postCommand(
      {
        commandType: 'LockReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        revisionId,
        expectedVersion: 4,
      },
      `a3c-correction-lockrev-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(lockRevision.status).toBe(200);

    const close = await postCommand(
      {
        commandType: 'CloseBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        businessDayId,
        expectedVersion: 1,
      },
      `a3c-correction-closeday-${businessDayId}`,
    );
    expect(close.status).toBe(200);

    const lock = await postCommand(
      {
        commandType: 'LockBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationCorrection,
        businessDayId,
        expectedVersion: 3,
      },
      `a3c-correction-lockday-${businessDayId}`,
    );
    expect(lock.status).toBe(200);
  });

  // ---------------------------------------------------------------------
  // Task 4: real midnight-crossing segment + reconciliation
  // ---------------------------------------------------------------------

  it('carries a business day, shift, sealed segment, and reconciliation across a real midnight crossing in Africa/Harare with no UTC drift', async () => {
    const businessDayId = randomUUID();
    const shiftId = randomUUID();

    const open = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        businessDayId,
        expectedVersion: 0,
      },
      `a3c-midnight-open-${businessDayId}`,
    );
    expect(open.status).toBe(200);

    // Fix the day: no ambiguity about "today" server time, deterministic.
    await client.unsafe(`
      update app.station_business_days set business_date = '2026-09-21' where id = '${businessDayId}';
    `);

    // Africa/Harare is UTC+2 year-round (no DST): 22:00 local on 2026-09-21 is
    // 20:00Z; 02:00 local on 2026-09-22 (segment close) is 00:00Z; 06:00 local
    // on 2026-09-22 (shift end) is 04:00Z.
    const plannedStartAt = '2026-09-21T20:00:00.000Z';
    const plannedEndAt = '2026-09-22T04:00:00.000Z';
    const segmentCloseAt = '2026-09-22T00:00:00.000Z';

    const start = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt,
        plannedEndAt,
      },
      `a3c-midnight-start-${shiftId}`,
    );
    expect(start.status).toBe(200);
    const startBody = await json<{ businessDate: string }>(start);
    expect(startBody.businessDate).toBe('2026-09-21');

    const shiftRow = await client<{ business_date: string }[]>`
      select business_date from app.shifts where id = ${shiftId}
    `;
    expect(shiftRow).toEqual([{ business_date: '2026-09-21' }]);

    const openingBoundaryId = randomUUID();
    const openingBoundary = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        boundaryId: openingBoundaryId,
        nozzleId: ids.nozzleMidnight,
        meterInstallationId: ids.installationMidnight,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_OPEN',
        readingStatus: 'AVAILABLE',
        readingValue: '9000.000',
        exceptionReason: 'First reading on a freshly installed meter',
        expectedVersion: 1,
      },
      `a3c-midnight-opening-${shiftId}`,
    );
    expect(openingBoundary.status).toBe(200);

    const closingBoundaryId = randomUUID();
    const closingBoundary = await postCommand(
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        boundaryId: closingBoundaryId,
        nozzleId: ids.nozzleMidnight,
        meterInstallationId: ids.installationMidnight,
        businessDayId,
        shiftId,
        responsibleAttendantId: ids.membership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: '9250.000',
        expectedVersion: 1,
      },
      `a3c-midnight-closing-${shiftId}`,
    );
    expect(closingBoundary.status).toBe(200);

    const segmentId = randomUUID();
    const seal = await postCommand(
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        segmentId,
        nozzleId: ids.nozzleMidnight,
        meterInstallationId: ids.installationMidnight,
        businessDayId,
        shiftId,
        openingBoundaryId,
        closingBoundaryId,
        productId: ids.product,
        responsibleAttendantId: ids.membership,
        startAt: plannedStartAt,
        endAt: segmentCloseAt,
        expectedVersion: 0,
      },
      `a3c-midnight-seal-${segmentId}`,
    );
    expect(seal.status).toBe(201);

    const segmentRows = await client<{ litres: string; business_date: string }[]>`
      select ms.litres, d.business_date from app.meter_segments ms
      join app.station_business_days d on d.tenant_id = ms.tenant_id and d.station_id = ms.station_id and d.id = ms.business_day_id
      where ms.id = ${segmentId}
    `;
    expect(segmentRows).toEqual([{ litres: '250.000', business_date: '2026-09-21' }]);

    const closeMeters = await postCommand(
      {
        commandType: 'CloseMeters',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        businessDayId,
        shiftId,
        expectedVersion: 1,
      },
      `a3c-midnight-closemeters-${shiftId}`,
    );
    expect(closeMeters.status).toBe(200);

    const completeShift = await postCommand(
      {
        commandType: 'CompleteShift',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        businessDayId,
        shiftId,
        expectedVersion: 2,
      },
      `a3c-midnight-complete-${shiftId}`,
    );
    expect(completeShift.status).toBe(200);

    const reconciliationId = randomUUID();
    const revisionId = randomUUID();
    const createReconciliation = await postCommand(
      {
        commandType: 'CreateReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        businessDayId,
        reconciliationId,
        revisionId,
        expectedVersion: 0,
      },
      `a3c-midnight-createrecon-${reconciliationId}`,
    );
    expect(createReconciliation.status).toBe(200);
    const createBody = await json<{ businessDate: string }>(createReconciliation);
    expect(createBody.businessDate).toBe('2026-09-21');

    const submit = await postCommand(
      {
        commandType: 'SubmitReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        revisionId,
        expectedVersion: 0,
        declarations: [{ category: 'CASH', amount: '375.00' }],
      },
      `a3c-midnight-submit-${revisionId}`,
    );
    expect(submit.status).toBe(200);

    const revisionRows = await client<{ expected_sales: string; business_date: string }[]>`
      select r.expected_sales, d.business_date from app.reconciliation_revisions r
      join app.reconciliations c on c.tenant_id = r.tenant_id and c.station_id = r.station_id and c.id = r.reconciliation_id
      join app.station_business_days d on d.tenant_id = c.tenant_id and d.station_id = c.station_id and d.id = c.business_day_id
      where r.id = ${revisionId}
    `;
    expect(revisionRows).toEqual([{ expected_sales: '375.0000', business_date: '2026-09-21' }]);

    const approve = await postCommand(
      {
        commandType: 'ApproveReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        revisionId,
        expectedVersion: 2,
      },
      `a3c-midnight-approve-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(approve.status).toBe(200);

    const post = await postCommand(
      {
        commandType: 'PostReconciliation',
        tenantId: ids.tenant,
        stationId: ids.stationMidnight,
        revisionId,
        expectedVersion: 3,
      },
      `a3c-midnight-post-${revisionId}`,
      'a3c-approver-session-token',
    );
    expect(post.status).toBe(200);
  });
});
