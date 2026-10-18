import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';
import { POST as inventoryCommandPost } from '../../src/app/api/inventory/commands/route';
import { GET as reconciliationGet } from '../../src/app/api/forecourt/reconciliations/[id]/route';
import { loadActionCenterFacts } from '../../src/modules/approvals/action-center';
import { DECIMAL_POLICIES, ExactDecimal } from '../../src/platform/domain/primitives';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A5 production reconciliation integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const ids = {
  tenant: 'a5b00000-0000-4000-8000-000000000001',
  legal: 'a5b00000-0000-4000-8000-000000000011',
  station: 'a5b00000-0000-4000-8000-000000000021',
  supervisorActor: 'a5b00000-0000-4000-8000-000000000031',
  supervisorMembership: 'a5b00000-0000-4000-8000-000000000041',
  supervisorSession: 'a5b00000-0000-4000-8000-000000000051',
  managerActor: 'a5b00000-0000-4000-8000-000000000032',
  managerMembership: 'a5b00000-0000-4000-8000-000000000042',
  managerSession: 'a5b00000-0000-4000-8000-000000000052',
  approverActor: 'a5b00000-0000-4000-8000-000000000034',
  approverMembership: 'a5b00000-0000-4000-8000-000000000044',
  approverSession: 'a5b00000-0000-4000-8000-000000000053',
  attendantActor: 'a5b00000-0000-4000-8000-000000000033',
  attendantMembership: 'a5b00000-0000-4000-8000-000000000043',
  product: 'a5b00000-0000-4000-8000-000000000061',
  pump: 'a5b00000-0000-4000-8000-000000000071',
  nozzle: 'a5b00000-0000-4000-8000-000000000081',
  meter: 'a5b00000-0000-4000-8000-000000000091',
  installation: 'a5b00000-0000-4000-8000-000000000101',
  price: 'a5b00000-0000-4000-8000-000000000111',
  day: 'a5b00000-0000-4000-8000-000000000121',
  shift: 'a5b00000-0000-4000-8000-000000000131',
  tank: 'a5b00000-0000-4000-8000-000000000141',
  unvaluedTank: 'a5b00000-0000-4000-8000-000000000142',
  openingSource: 'a5b00000-0000-4000-8000-000000000151',
  unvaluedOpeningSource: 'a5b00000-0000-4000-8000-000000000152',
  delivery: 'a5b00000-0000-4000-8000-000000000161',
  allocation: 'a5b00000-0000-4000-8000-000000000171',
  transitionDelivery: 'a5b00000-0000-4000-8000-000000000162',
  transitionAllocation: 'a5b00000-0000-4000-8000-000000000172',
  unvaluedDelivery: 'a5b00000-0000-4000-8000-000000000164',
  unvaluedAllocation: 'a5b00000-0000-4000-8000-000000000174',
  dip: 'a5b00000-0000-4000-8000-000000000191',
};

let client: Sql;

async function postCommand(
  input: Record<string, unknown>,
  key: string,
  token = 'a5-supervisor-session-token',
) {
  const signedToken = token;
  return forecourtCommandPost(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
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

async function postInventoryCommand(
  input: Record<string, unknown>,
  key: string,
  token = 'a5-supervisor-session-token',
) {
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

async function readReconciliation(
  reconciliationId: string,
  signedToken = 'a5-supervisor-session-token',
) {
  return reconciliationGet(
    new Request(
      `http://127.0.0.1:3000/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
      { headers: { ...clerkHeaders(signedToken) } },
    ),
    { params: Promise.resolve({ id: reconciliationId }) },
  );
}

async function createSealedSegments(
  shiftId: string,
  readings: readonly string[],
  keyPrefix: string,
  shiftVersion?: number,
) {
  const currentShift = await client.unsafe<
    { version: number; opened_at: Date; planned_end_at: Date }[]
  >(`
    select version, opened_at, planned_end_at
    from app.shifts
    where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${shiftId}'
  `);
  expect(currentShift).toHaveLength(1);
  const expectedShiftVersion = shiftVersion ?? currentShift[0]!.version;
  const boundaryIds: string[] = [];
  for (const [index, readingValue] of readings.entries()) {
    const boundaryId = randomUUID();
    boundaryIds.push(boundaryId);
    await expectOk(
      await postCommand(
        {
          commandType: 'ConfirmBoundary',
          tenantId: ids.tenant,
          stationId: ids.station,
          boundaryId,
          nozzleId: ids.nozzle,
          meterInstallationId: ids.installation,
          businessDayId: ids.day,
          shiftId,
          responsibleAttendantId: ids.attendantMembership,
          reason:
            index === 0 ? 'SHIFT_OPEN' : index === readings.length - 1 ? 'SHIFT_CLOSE' : 'DELIVERY',
          readingStatus: 'AVAILABLE',
          readingValue,
          ...(index === 0
            ? { exceptionReason: 'A5 canonical sale chronology integration fixture' }
            : {}),
          expectedVersion: expectedShiftVersion,
        },
        `${keyPrefix}-boundary-${index}-${boundaryId}`,
      ),
    );
    await client.unsafe('select pg_sleep(0.01)');
  }

  const boundaries = await client.unsafe<{ id: string; effective_at: Date }[]>(`
    select id, effective_at from app.meter_boundaries
    where tenant_id='${ids.tenant}' and station_id='${ids.station}'
      and id in (${boundaryIds.map((id) => `'${id}'`).join(',')})
    order by effective_at, id
  `);
  expect(boundaries).toHaveLength(boundaryIds.length);
  expect(
    boundaries.every(
      (boundary) =>
        boundary.effective_at.getTime() >= currentShift[0]!.opened_at.getTime() &&
        boundary.effective_at.getTime() <= currentShift[0]!.planned_end_at.getTime(),
    ),
  ).toBe(true);

  const segmentIds: string[] = [];
  for (let index = 0; index < readings.length - 1; index += 1) {
    const segmentId = randomUUID();
    segmentIds.push(segmentId);
    const opening = boundaries.find((boundary) => boundary.id === boundaryIds[index]);
    const closing = boundaries.find((boundary) => boundary.id === boundaryIds[index + 1]);
    expect(opening).toBeDefined();
    expect(closing).toBeDefined();
    await expectCreated(
      await postCommand(
        {
          commandType: 'SealSegment',
          tenantId: ids.tenant,
          stationId: ids.station,
          segmentId,
          nozzleId: ids.nozzle,
          meterInstallationId: ids.installation,
          businessDayId: ids.day,
          shiftId,
          openingBoundaryId: opening!.id,
          closingBoundaryId: closing!.id,
          productId: ids.product,
          responsibleAttendantId: ids.attendantMembership,
          startAt: opening!.effective_at.toISOString(),
          endAt: closing!.effective_at.toISOString(),
          expectedVersion: 0,
        },
        `${keyPrefix}-segment-${index}-${segmentId}`,
      ),
    );
  }
  return { openingReading: readings[0]!, closingReading: readings.at(-1)!, segmentIds };
}

type CommandResponse = {
  state?: string;
  version?: number;
  readings?: Array<{ litresSold: string }>;
  saleMovementIds?: string[];
  totals?: {
    expectedSales: string;
    accountedSales: string;
    salesVariance: string;
    cashVariance: string | null;
    stockVariance: Record<string, string>;
  };
  [key: string]: unknown;
};

async function expectOk(response: Response) {
  const body = (await response.json()) as CommandResponse;
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body;
}

async function expectCreated(response: Response) {
  const body = (await response.json()) as CommandResponse;
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body;
}

function expectDecimalEqual(actual: string, expected: string) {
  expect(new ExactDecimal(actual).equals(new ExactDecimal(expected))).toBe(true);
}

async function nextMeterReading(): Promise<string> {
  const rows = await client.unsafe<{ reading_value: string }[]>(`
    select reading_value
    from app.meter_boundaries
    where tenant_id='${ids.tenant}' and station_id='${ids.station}'
      and nozzle_id='${ids.nozzle}' and meter_installation_id='${ids.installation}'
      and reading_status='AVAILABLE'
    order by effective_at desc, id desc
    limit 1
  `);
  return rows[0]?.reading_value ?? '100000.000';
}

async function createPopulatedProductionReconciliation(
  reconciliationId: string,
  saleLitres = '500',
) {
  const reconciliationShiftId = randomUUID();
  const shiftClock = await client.unsafe<{ now: Date }[]>(`select clock_timestamp() as now`);
  expect(shiftClock).toHaveLength(1);
  const plannedEndAt = new Date(shiftClock[0]!.now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  await expectOk(
    await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: ids.day,
        shiftId: reconciliationShiftId,
        expectedVersion: 0,
        plannedStartAt: '2026-09-22T06:00:00.000Z',
        plannedEndAt,
      },
      `a5-start-reconciliation-shift-${reconciliationId}`,
    ),
  );
  const startedShift = await client.unsafe<{ version: number }[]>(`
    select version
    from app.shifts
    where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${reconciliationShiftId}'
  `);
  expect(startedShift).toHaveLength(1);
  const common = {
    tenantId: ids.tenant,
    stationId: ids.station,
    reconciliationId,
  };
  await expectOk(
    await postCommand(
      {
        commandType: 'CreateProductionReconciliation',
        ...common,
        businessDayId: ids.day,
        shiftId: reconciliationShiftId,
        expectedVersion: 0,
      },
      `a5-return-create-${reconciliationId}`,
    ),
  );
  const openingReading = await nextMeterReading();
  const saleValue = new ExactDecimal(saleLitres).multiply(new ExactDecimal('1.5')).toString();
  const originalClosingReading = new ExactDecimal(openingReading)
    .add(new ExactDecimal(saleLitres))
    .toString();
  const correctedClosingReading = new ExactDecimal(openingReading)
    .add(new ExactDecimal(saleLitres))
    .add(new ExactDecimal('1'))
    .toString();
  const sealed = await createSealedSegments(
    reconciliationShiftId,
    [openingReading, originalClosingReading, correctedClosingReading],
    `a5-return-${reconciliationId}`,
    startedShift[0]!.version,
  );
  await expectOk(
    await postCommand(
      {
        commandType: 'SaveMeterReadings',
        ...common,
        expectedVersion: 0,
        readings: [
          {
            nozzleId: ids.nozzle,
            productId: ids.product,
            shiftId: reconciliationShiftId,
            openingReading: sealed.openingReading,
            closingReading: originalClosingReading,
            sellingPriceId: ids.price,
          },
        ],
      },
      `a5-return-readings-${reconciliationId}`,
    ),
  );
  await expectOk(
    await postCommand(
      {
        commandType: 'SavePaymentAllocations',
        ...common,
        expectedVersion: 1,
        payments: [{ method: 'CASH', amount: saleValue }],
      },
      `a5-return-payments-${reconciliationId}`,
    ),
  );
  await expectOk(
    await postCommand(
      { commandType: 'SaveExpenses', ...common, expectedVersion: 2, expenses: [] },
      `a5-return-expenses-${reconciliationId}`,
    ),
  );
  await expectOk(
    await postCommand(
      {
        commandType: 'SaveCashDeclaration',
        ...common,
        expectedVersion: 3,
        countedCash: saleValue,
      },
      `a5-return-cash-${reconciliationId}`,
    ),
  );
  await expectOk(
    await postCommand(
      { commandType: 'SaveVarianceExplanations', ...common, expectedVersion: 4, explanations: {} },
      `a5-return-explanations-${reconciliationId}`,
    ),
  );
  return {
    common,
    shiftId: reconciliationShiftId,
    openingReading: sealed.openingReading,
    correctedClosingReading,
    segmentIds: sealed.segmentIds,
  };
}

describe('A5 production daily reconciliation persistence and approval', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';

    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a5-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a5-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A5 Reconciliation Tenant', 'a5-reconciliation-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.supervisorActor}', 'A5 Supervisor', 'a5-supervisor@example.test'),
        ('${ids.managerActor}', 'A5 Manager', 'a5-manager@example.test'),
        ('${ids.approverActor}', 'A5 Approver', 'a5-approver@example.test'),
        ('${ids.attendantActor}', 'A5 Attendant', 'a5-attendant@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE'),
        ('${ids.managerMembership}', '${ids.tenant}', '${ids.managerActor}', 'ACTIVE'),
        ('${ids.approverMembership}', '${ids.tenant}', '${ids.approverActor}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendantActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A5 Reconciliation Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A5REC', 'A5 Reconciliation Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.managerMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.approverMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.product}', '${ids.tenant}', 'A5-DIESEL', 'A5 Diesel') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number, status)
        values ('${ids.pump}', '${ids.tenant}', '${ids.station}', '1', 'ACTIVE') on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
        values ('${ids.nozzle}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '1', '${ids.product}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values ('${ids.meter}', '${ids.tenant}', 'A5-METER-1') on conflict (id) do nothing;
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values ('${ids.installation}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.meter}', '2020-01-01T00:00:00Z', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
        values ('${ids.price}', '${ids.tenant}', '${ids.station}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-09-22', 'NOT_STARTED') on conflict (id) do nothing;
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
        values ('${ids.shift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z', '2026-09-22')
        on conflict (id) do nothing;
      update app.station_business_days set state='OPEN', opened_at=now()
        where id='${ids.day}' and state='NOT_STARTED';
      update app.shifts set state='OPEN', opened_at=now()
        where id='${ids.shift}' and state='PLANNED';
      update app.selling_prices set state='PENDING_APPROVAL'
        where id='${ids.price}' and state='DRAFT';
      update app.selling_prices set state='APPROVED', approved_by='${ids.managerMembership}', approved_at=now()
        where id='${ids.price}' and state='PENDING_APPROVAL';
      update app.selling_prices set state='PENDING_STATION_ACTIVATION'
        where id='${ids.price}' and state='APPROVED';
      update app.selling_prices set state='BOUNDARIES_IN_PROGRESS'
        where id='${ids.price}' and state='PENDING_STATION_ACTIVATION';
      update app.selling_prices set state='ACTIVE', activated_at=now()
        where id='${ids.price}' and state='BOUNDARIES_IN_PROGRESS';
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
        values ('${ids.tank}', '${ids.tenant}', '${ids.station}', 'A5-D1', '${ids.product}', 10000, 500, 10, 'ACTIVE', '${ids.supervisorMembership}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
        values ('${ids.unvaluedTank}', '${ids.tenant}', '${ids.station}', 'A5-D2', '${ids.product}', 10000, 500, 10, 'INACTIVE', '${ids.supervisorMembership}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      update app.tanks set status='ACTIVE'
        where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${ids.tank}';
      update app.tanks set status='INACTIVE'
        where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${ids.unvaluedTank}';
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
        values ('${ids.openingSource}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'OPENING_BALANCE', 1000, '2026-09-22T05:00:00Z', '2026-09-22', 'CUTOVER', '${ids.openingSource}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
        values ('${ids.unvaluedOpeningSource}', '${ids.tenant}', '${ids.station}', '${ids.unvaluedTank}', '${ids.product}', 'OPENING_BALANCE', 1000, '2026-09-22T05:00:00Z', '2026-09-22', 'CUTOVER', '${ids.unvaluedOpeningSource}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date, note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, unit_landed_cost, total_landed_cost, currency, recorded_by, confirmed_by, confirmed_at)
        values ('${ids.delivery}', '${ids.tenant}', '${ids.station}', '${ids.product}', 'A5-DN-1', '2026-09-22T07:00:00Z', '2026-09-22', 500, 500, 0, 'DRAFT', 9.999, 123.4500, 'USD', '${ids.supervisorMembership}', null, null)
        on conflict (id) do nothing;
      insert into app.fuel_delivery_allocations
        (id, tenant_id, station_id, delivery_id, tank_id, product_id, quantity_litres)
        values ('${ids.allocation}', '${ids.tenant}', '${ids.station}', '${ids.delivery}', '${ids.tank}', '${ids.product}', 500)
        on conflict (id) do nothing;
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date, note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by, confirmed_by, confirmed_at)
        values ('${ids.transitionDelivery}', '${ids.tenant}', '${ids.station}', '${ids.product}', 'A5-DN-TRANSITION', '2026-09-25T09:00:00Z', '2026-09-22', 100, 100, 0, 'DRAFT', '${ids.supervisorMembership}', null, null)
        on conflict (id) do nothing;
      insert into app.fuel_delivery_allocations
        (id, tenant_id, station_id, delivery_id, tank_id, product_id, quantity_litres)
        values ('${ids.transitionAllocation}', '${ids.tenant}', '${ids.station}', '${ids.transitionDelivery}', '${ids.tank}', '${ids.product}', 100)
        on conflict (id) do nothing;
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date, note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by, confirmed_by, confirmed_at)
        values ('${ids.unvaluedDelivery}', '${ids.tenant}', '${ids.station}', '${ids.product}', 'A5-DN-UNVALUED', '2026-09-22T06:30:00Z', '2026-09-22', 100, 100, 0, 'DRAFT', '${ids.supervisorMembership}', null, null)
        on conflict (id) do nothing;
      insert into app.fuel_delivery_allocations
        (id, tenant_id, station_id, delivery_id, tank_id, product_id, quantity_litres)
        values ('${ids.unvaluedAllocation}', '${ids.tenant}', '${ids.station}', '${ids.unvaluedDelivery}', '${ids.unvaluedTank}', '${ids.product}', 100)
        on conflict (id) do nothing;
      insert into app.tank_dips
        (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
        values ('${ids.dip}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '2026-09-22T23:00:00Z', '2026-09-22', 1100, '${ids.supervisorMembership}')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(
      client,
      ids.supervisorSession,
      'a5-supervisor-session-token',
      ids.supervisorActor,
      true,
    );
    await seedClerkSession(
      client,
      ids.managerSession,
      'a5-manager-session-token',
      ids.managerActor,
      true,
    );
    await seedActiveStepUp(client, ids.supervisorSession, ids.tenant);
    await seedActiveStepUp(client, ids.managerSession, ids.tenant);
    await seedClerkSession(
      client,
      ids.approverSession,
      'a5-approver-session-token',
      ids.approverActor,
      true,
    );
    await seedActiveStepUp(client, ids.approverSession, ids.tenant);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('creates, reloads, submits, concurrently approves, retries, and chronologically posts A4 sales', async () => {
    const openingCost = await postInventoryCommand(
      {
        commandType: 'RecordOpeningInventoryCost',
        tenantId: ids.tenant,
        stationId: ids.station,
        tankId: ids.tank,
        amount: '1000.0000',
        currency: 'USD',
      },
      'a5-opening-cost',
      'a5-manager-session-token',
    );
    await expectOk(openingCost);
    const openingValuation = await client.unsafe<
      {
        count: string;
        quantity_litres: string;
        inventory_value: string;
        valuation_status: string;
      }[]
    >(`
      select
        (select count(*)::text from app.inventory_cost_events
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and event_type='OPENING_COST' and source_id='${ids.openingSource}') as count,
        quantity_litres, inventory_value, valuation_status
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.tank}' and product_id='${ids.product}'
    `);
    expect(openingValuation).toEqual([
      {
        count: '1',
        quantity_litres: '1000.000',
        inventory_value: '1000.0000',
        valuation_status: 'VALUED',
      },
    ]);

    const confirmed = await postInventoryCommand(
      {
        commandType: 'ConfirmDelivery',
        tenantId: ids.tenant,
        stationId: ids.station,
        deliveryId: ids.delivery,
      },
      'a5-confirm-delivery',
    );
    await expectOk(confirmed);
    const unvaluedReceipt = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count
      from app.inventory_cost_events
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and event_type='RECEIPT_COST'
        and source_type='FUEL_DELIVERY_ALLOCATION'
        and source_id='${ids.allocation}'
    `);
    expect(unvaluedReceipt[0]).toEqual({ count: '0' });
    const unvaluedProjection = await client.unsafe<
      {
        quantity_litres: string;
        inventory_value: string | null;
        weighted_average_cost: string | null;
        currency: string | null;
        valuation_status: string;
      }[]
    >(`
      select quantity_litres, inventory_value, weighted_average_cost, currency, valuation_status
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.tank}' and product_id='${ids.product}'
    `);
    expect(unvaluedProjection).toEqual([
      {
        quantity_litres: '1500.000',
        inventory_value: null,
        weighted_average_cost: null,
        currency: null,
        valuation_status: 'UNVALUED',
      },
    ]);

    expect(
      (
        await postInventoryCommand(
          {
            commandType: 'RecordReceiptCost',
            tenantId: ids.tenant,
            stationId: ids.station,
            allocationId: ids.allocation,
            currency: 'USD',
          },
          'a5-receipt-cost-missing-amount',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await postInventoryCommand(
          {
            commandType: 'RecordReceiptCost',
            tenantId: ids.tenant,
            stationId: ids.station,
            allocationId: ids.allocation,
            amount: '500.0000',
          },
          'a5-receipt-cost-missing-currency',
        )
      ).status,
    ).toBe(400);

    const receiptCost = await postInventoryCommand(
      {
        commandType: 'RecordReceiptCost',
        tenantId: ids.tenant,
        stationId: ids.station,
        allocationId: ids.allocation,
        amount: '500.0000',
        currency: 'USD',
      },
      'a5-receipt-cost',
    );
    const receiptCostBody = await expectOk(receiptCost);
    const explicitReceipt = await client.unsafe<
      {
        id: string;
        source_type: string;
        source_id: string;
        amount: string;
        currency: string;
        effective_at: string;
      }[]
    >(`
      select id, source_type, source_id, amount::text as amount, currency,
             effective_at::text as effective_at
      from app.inventory_cost_events
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and event_type='RECEIPT_COST'
        and source_type='FUEL_DELIVERY_ALLOCATION'
        and source_id='${ids.allocation}'
    `);
    expect(explicitReceipt).toHaveLength(1);
    expect(explicitReceipt[0]).toMatchObject({
      source_type: 'FUEL_DELIVERY_ALLOCATION',
      source_id: ids.allocation,
      amount: '500.0000',
      currency: 'USD',
    });
    expect(
      await postInventoryCommand(
        {
          commandType: 'RecordReceiptCost',
          tenantId: ids.tenant,
          stationId: ids.station,
          allocationId: ids.allocation,
          amount: '500.0000',
          currency: 'USD',
        },
        'a5-receipt-cost',
      ).then(async (response) => {
        const body = await response.json();
        expect(response.status).toBe(200);
        return body;
      }),
    ).toEqual(receiptCostBody);
    expect(
      await postInventoryCommand(
        {
          commandType: 'RecordReceiptCost',
          tenantId: ids.tenant,
          stationId: ids.station,
          allocationId: ids.allocation,
          amount: '500.0000',
          currency: 'USD',
        },
        'a5-receipt-cost-source-retry',
      ).then(async (response) => {
        const body = await response.json();
        expect(response.status).toBe(200);
        return body;
      }),
    ).toEqual(receiptCostBody);

    const reconciliationId = randomUUID();
    const common = {
      tenantId: ids.tenant,
      stationId: ids.station,
      reconciliationId,
    };
    const openingReading = await nextMeterReading();
    const zeroReading = openingReading;
    const midpointReading = new ExactDecimal(openingReading)
      .add(new ExactDecimal('250'))
      .toString();
    const closingReading = new ExactDecimal(openingReading).add(new ExactDecimal('500')).toString();
    const sealed = await createSealedSegments(
      ids.shift,
      [openingReading, zeroReading, midpointReading, closingReading],
      `a5-${reconciliationId}`,
    );
    const segmentTimes = await client.unsafe<{ id: string; segment_end_at: Date }[]>(`
      select id, segment_end_at
      from app.meter_segments
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and id in ('${sealed.segmentIds[1]}', '${sealed.segmentIds[2]}')
    `);
    const earlySaleEnd = segmentTimes.find(
      (row) => row.id === sealed.segmentIds[1],
    )!.segment_end_at;
    const lateSaleEnd = segmentTimes.find((row) => row.id === sealed.segmentIds[2])!.segment_end_at;
    const transitionAt = new Date((earlySaleEnd.getTime() + lateSaleEnd.getTime()) / 2);
    await client.unsafe(`
      update app.fuel_deliveries
      set delivered_at='${transitionAt.toISOString()}'
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and id='${ids.transitionDelivery}'
    `);
    await expectOk(
      await postInventoryCommand(
        {
          commandType: 'ConfirmDelivery',
          tenantId: ids.tenant,
          stationId: ids.station,
          deliveryId: ids.transitionDelivery,
        },
        'a5-confirm-transition-delivery',
      ),
    );
    await expectOk(
      await postInventoryCommand(
        {
          commandType: 'RecordReceiptCost',
          tenantId: ids.tenant,
          stationId: ids.station,
          allocationId: ids.transitionAllocation,
          amount: '300.0000',
          currency: 'USD',
        },
        'a5-transition-receipt-cost',
      ),
    );
    const transitionMovement = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='FUEL_DELIVERY_ALLOCATION'
        and source_id='${ids.transitionAllocation}'
    `);
    expect(transitionMovement).toEqual([{ count: '1' }]);

    await expectOk(
      await postCommand(
        {
          commandType: 'CreateProductionReconciliation',
          ...common,
          businessDayId: ids.day,
          shiftId: ids.shift,
          expectedVersion: 0,
        },
        `a5-create-${reconciliationId}`,
      ),
    );
    await expectOk(
      await postCommand(
        { commandType: 'SaveReconciliationDraft', ...common, expectedVersion: 0 },
        `a5-draft-${reconciliationId}`,
      ),
    );
    await expectOk(
      await postCommand(
        {
          commandType: 'SetAttendants',
          ...common,
          expectedVersion: 1,
          attendantIds: [ids.attendantMembership],
        },
        `a5-attendants-${reconciliationId}`,
      ),
    );
    await expectOk(
      await postCommand(
        {
          commandType: 'SaveMeterReadings',
          ...common,
          expectedVersion: 2,
          readings: [
            {
              id: 'a5b00000-0000-4000-8000-000000000181',
              nozzleId: ids.nozzle,
              productId: ids.product,
              shiftId: ids.shift,
              openingReading: zeroReading,
              closingReading: sealed.closingReading,
              sellingPriceId: ids.price,
            },
          ],
        },
        `a5-readings-${reconciliationId}`,
      ),
    );
    await expectOk(
      await postCommand(
        {
          commandType: 'SavePaymentAllocations',
          ...common,
          expectedVersion: 3,
          payments: [{ method: 'CASH', amount: '750.0000' }],
        },
        `a5-payments-${reconciliationId}`,
      ),
    );
    await expectOk(
      await postCommand(
        {
          commandType: 'SaveExpenses',
          ...common,
          expectedVersion: 4,
          expenses: [
            {
              category: 'STATION_SUPPLIES',
              description: 'Receipt paper',
              amount: '25.0000',
              paymentMethod: 'CASH',
            },
          ],
        },
        `a5-expenses-${reconciliationId}`,
      ),
    );
    await expectOk(
      await postCommand(
        {
          commandType: 'LinkDeliveries',
          ...common,
          expectedVersion: 5,
          deliveries: [
            {
              deliveryId: ids.delivery,
              allocationId: ids.allocation,
              productId: ids.product,
              tankId: ids.tank,
            },
          ],
        },
        `a5-deliveries-${reconciliationId}`,
      ),
    );
    await expectOk(
      await postCommand(
        {
          commandType: 'LinkTankDips',
          ...common,
          expectedVersion: 6,
          dips: [{ dipId: ids.dip, productId: ids.product, tankId: ids.tank }],
        },
        `a5-dips-${reconciliationId}`,
      ),
    );
    await expectOk(
      await postCommand(
        {
          commandType: 'SaveCashDeclaration',
          ...common,
          expectedVersion: 7,
          countedCash: '725.0000',
        },
        `a5-cash-${reconciliationId}`,
      ),
    );
    await expectOk(
      await postCommand(
        {
          commandType: 'SaveVarianceExplanations',
          ...common,
          expectedVersion: 8,
          explanations: {},
        },
        `a5-explanations-${reconciliationId}`,
      ),
    );

    const draft = await expectOk(await readReconciliation(reconciliationId));
    expect(draft.state).toBe('DRAFT');
    expect(draft.version).toBe(9);
    expect(draft.readings).toHaveLength(1);
    // litresSold is selected directly from numeric(18,3), while monetary totals
    // are normalized through ExactDecimal.toString(). Neither representation's
    // trailing-zero scale is part of the API contract.
    expectDecimalEqual(draft.readings![0]!.litresSold, '500.000');
    expectDecimalEqual(draft.totals!.expectedSales, '750.0000');
    expectDecimalEqual(draft.totals!.accountedSales, '750.0000');
    expectDecimalEqual(draft.totals!.salesVariance, '0.0000');
    expect(draft.totals!.cashVariance).not.toBeNull();
    expectDecimalEqual(draft.totals!.cashVariance!, '0.0000');
    expectDecimalEqual(draft.totals!.stockVariance[ids.tank]!, '0.000');

    await expectOk(
      await postCommand(
        { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 9 },
        `a5-submit-${reconciliationId}`,
      ),
    );
    const submitted = await expectOk(await readReconciliation(reconciliationId));
    expect(submitted.state).toBe('SUBMITTED');
    expect(submitted.version).toBe(10);

    const approvalKey = `a5-approve-${reconciliationId}`;
    const raceKey = `${approvalKey}-race`;
    const approvalPayload = {
      commandType: 'ApproveProductionReconciliation',
      ...common,
      expectedVersion: 10,
    };
    const concurrentApprovals = await Promise.all([
      postCommand(approvalPayload, approvalKey, 'a5-manager-session-token'),
      postCommand(approvalPayload, raceKey, 'a5-manager-session-token'),
    ]);
    const concurrentResults = await Promise.all(
      concurrentApprovals.map(async (response, index) => ({
        key: index === 0 ? approvalKey : raceKey,
        status: response.status,
        body: (await response.json()) as CommandResponse,
      })),
    );
    expect(concurrentResults.filter((result) => result.status === 200)).toHaveLength(1);
    expect(concurrentResults.filter((result) => result.status === 409)).toHaveLength(1);
    const successfulApproval = concurrentResults.find((result) => result.status === 200)!;
    expect(successfulApproval.body.state).toBe('APPROVED');
    expect(successfulApproval.body.saleMovementIds).toHaveLength(2);
    const saleMovements = await client.unsafe<
      { id: string; source_id: string; quantity_litres: string }[]
    >(`
      select id, source_id, quantity_litres
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='METER_SEGMENT_SALE'
        and source_id in ('${sealed.segmentIds[1]}', '${sealed.segmentIds[2]}')
      order by effective_at, id
    `);
    expect(saleMovements).toHaveLength(2);
    expect(saleMovements.map((row) => row.source_id)).toEqual([
      sealed.segmentIds[1],
      sealed.segmentIds[2],
    ]);
    const saleCostRows = await client.unsafe<
      { id: string; source_id: string; amount: string; currency: string }[]
    >(`
      select id, source_id, amount, currency
      from app.inventory_cost_events
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and event_type='SALE_COGS'
        and source_type='METER_SEGMENT_SALE'
        and source_id in ('${sealed.segmentIds[1]}', '${sealed.segmentIds[2]}')
      order by effective_at, id
    `);
    expect(saleCostRows).toHaveLength(2);
    expect(saleCostRows.map((row) => row.source_id)).toEqual([
      sealed.segmentIds[1],
      sealed.segmentIds[2],
    ]);
    expectDecimalEqual(saleCostRows[0]!.amount, '-250.0000');
    expectDecimalEqual(saleCostRows[1]!.amount, '-287.0370');
    expect(saleCostRows.every((row) => row.currency === 'USD')).toBe(true);
    const saleRevenueRows = await client.unsafe<
      {
        id: string;
        source_id: string;
        inventory_sale_movement_id: string;
        quantity_litres: string;
        reconciliation_value: string;
        recognized_revenue_amount: string;
        currency: string;
      }[]
    >(`
      select id, source_id, inventory_sale_movement_id, quantity_litres,
             reconciliation_value, recognized_revenue_amount, currency
      from app.sale_recognition_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='METER_SEGMENT_SALE'
        and source_id in ('${sealed.segmentIds[1]}', '${sealed.segmentIds[2]}')
      order by effective_at, id
    `);
    expect(saleRevenueRows).toHaveLength(2);
    expect(saleRevenueRows.map((row) => row.source_id)).toEqual([
      sealed.segmentIds[1],
      sealed.segmentIds[2],
    ]);
    expect(saleRevenueRows.map((row) => row.inventory_sale_movement_id)).toEqual(
      saleMovements.map((row) => row.id),
    );
    expectDecimalEqual(saleRevenueRows[0]!.quantity_litres, '250.000');
    expectDecimalEqual(saleRevenueRows[0]!.reconciliation_value, '375.0000');
    expectDecimalEqual(saleRevenueRows[0]!.recognized_revenue_amount, '375.0000');
    expectDecimalEqual(saleRevenueRows[1]!.quantity_litres, '250.000');
    expectDecimalEqual(saleRevenueRows[1]!.reconciliation_value, '375.0000');
    expectDecimalEqual(saleRevenueRows[1]!.recognized_revenue_amount, '375.0000');
    expect(saleRevenueRows.every((row) => row.currency === 'USD')).toBe(true);
    const saleAttributionRows = await client.unsafe<
      {
        inventory_movement_id: string;
        meter_segment_id: string;
        sale_cost_event_id: string;
        sale_quantity_litres: string;
        pre_sale_wac: string;
        original_cogs: string;
        valuation_status: string;
        valuation_basis: string;
        replay_fingerprint: string;
      }[]
    >(`
      select inventory_movement_id, meter_segment_id, sale_cost_event_id,
             sale_quantity_litres, pre_sale_wac, original_cogs,
             valuation_status, valuation_basis, replay_fingerprint
      from app.inventory_sale_cost_attributions
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and meter_segment_id in ('${sealed.segmentIds[1]}', '${sealed.segmentIds[2]}')
      order by effective_at, inventory_movement_id
    `);
    expect(saleAttributionRows).toHaveLength(2);
    expect(saleAttributionRows.map((row) => row.meter_segment_id)).toEqual([
      sealed.segmentIds[1],
      sealed.segmentIds[2],
    ]);
    expect(saleAttributionRows.map((row) => row.inventory_movement_id)).toEqual(
      saleMovements.map((row) => row.id),
    );
    expect(saleAttributionRows.map((row) => row.sale_cost_event_id)).toEqual(
      saleCostRows.map((row) => row.id),
    );
    expectDecimalEqual(saleAttributionRows[0]!.sale_quantity_litres, '250.000');
    expectDecimalEqual(saleAttributionRows[0]!.pre_sale_wac, '1.00000000');
    expectDecimalEqual(saleAttributionRows[0]!.original_cogs, '250.0000');
    expectDecimalEqual(saleAttributionRows[1]!.sale_quantity_litres, '250.000');
    expectDecimalEqual(saleAttributionRows[1]!.pre_sale_wac, '1.14814815');
    expectDecimalEqual(saleAttributionRows[1]!.original_cogs, '287.0370');
    expect(saleAttributionRows.every((row) => row.valuation_status === 'VALUED')).toBe(true);
    expect(saleAttributionRows.every((row) => row.valuation_basis === 'PRE_SALE_WAC')).toBe(true);
    expect(saleAttributionRows.every((row) => row.replay_fingerprint.length > 0)).toBe(true);
    const fingerprintsBeforeRetry = saleAttributionRows.map((row) => row.replay_fingerprint);
    await expectOk(
      await postCommand(approvalPayload, successfulApproval.key, 'a5-manager-session-token'),
    );
    const fingerprintsAfterRetry = await client.unsafe<{ replay_fingerprint: string }[]>(`
      select replay_fingerprint
      from app.inventory_sale_cost_attributions
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and meter_segment_id in ('${sealed.segmentIds[1]}', '${sealed.segmentIds[2]}')
      order by effective_at, inventory_movement_id
    `);
    expect(fingerprintsAfterRetry.map((row) => row.replay_fingerprint)).toEqual(
      fingerprintsBeforeRetry,
    );
    const revenueCountAfterRetry = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count
      from app.sale_recognition_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_id in ('${sealed.segmentIds[1]}', '${sealed.segmentIds[2]}')
    `);
    expect(revenueCountAfterRetry).toEqual([{ count: '2' }]);
    await expect(
      client.unsafe(`
        insert into app.sale_recognition_movements (
          id, tenant_id, legal_entity_id, station_id, business_date, product_id,
          tank_id, nozzle_id, shift_id, meter_segment_id,
          inventory_sale_movement_id, reconciliation_id, reconciliation_revision_id,
          reconciliation_meter_reading_id, quantity_litres, reconciliation_value,
          recognized_revenue_amount, currency, effective_at, classification,
          source_type, source_id, actor_membership_id, request_id, replay_fingerprint
        )
        select gen_random_uuid(), tenant_id, legal_entity_id, station_id, business_date, product_id,
               tank_id, nozzle_id, shift_id, meter_segment_id,
               inventory_sale_movement_id, reconciliation_id, reconciliation_revision_id,
               reconciliation_meter_reading_id, quantity_litres,
               reconciliation_value + 1.0000, recognized_revenue_amount + 1.0000,
               currency, effective_at, classification, source_type, source_id,
               actor_membership_id, request_id, replay_fingerprint
        from app.sale_recognition_movements
        where tenant_id='${ids.tenant}' and station_id='${ids.station}'
          and source_id='${sealed.segmentIds[1]}'
      `),
    ).rejects.toThrow('must equal');

    const approved = await expectOk(await readReconciliation(reconciliationId));
    expect(approved.state).toBe('APPROVED');
    expect(approved.version).toBe(11);
    const receiptRetryAfterSales = await postInventoryCommand(
      {
        commandType: 'RecordReceiptCost',
        tenantId: ids.tenant,
        stationId: ids.station,
        allocationId: ids.allocation,
        amount: '500.0000',
        currency: 'USD',
      },
      'a5-receipt-cost-after-sale',
    );
    const receiptRetryAfterSalesBody = await expectOk(receiptRetryAfterSales);
    expect(receiptRetryAfterSalesBody.costEventId).toBe(explicitReceipt[0]!.id);
    const receiptAfterSales = await client.unsafe<
      {
        id: string;
        source_type: string;
        source_id: string;
        amount: string;
        currency: string;
        effective_at: string;
      }[]
    >(`
      select id, source_type, source_id, amount::text as amount, currency,
             effective_at::text as effective_at
      from app.inventory_cost_events
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and event_type='RECEIPT_COST'
        and source_type='FUEL_DELIVERY_ALLOCATION'
        and source_id='${ids.allocation}'
    `);
    expect(receiptAfterSales).toEqual(explicitReceipt);
    const lockedWrite = await postCommand(
      { commandType: 'SaveReconciliationDraft', ...common, expectedVersion: 11 },
      `a5-locked-write-${reconciliationId}`,
    );
    expect(lockedWrite.status).toBe(409);

    const rows = await client.unsafe<{ count: string; quantity: string }[]>(`
      select count(*)::text as count, coalesce(sum(quantity_litres), 0)::text as quantity
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='METER_SEGMENT_SALE'
        and source_id in ('${sealed.segmentIds.join("','")}')
    `);
    expect(rows[0]).toEqual({ count: '2', quantity: '-500.000' });

    const costRows = await client.unsafe<{ count: string; amount: string }[]>(`
      select count(*)::text as count, coalesce(sum(amount), 0)::text as amount
      from app.inventory_cost_events
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and event_type='SALE_COGS'
        and source_type='METER_SEGMENT_SALE'
        and source_id in ('${sealed.segmentIds.join("','")}')
    `);
    expect(costRows[0]).toEqual({ count: '2', amount: '-537.0370' });

    const attributionRows = await client.unsafe<
      { count: string; cogs: string; valuation_basis: string }[]
    >(`
      select count(*)::text as count, coalesce(sum(original_cogs), 0)::text as cogs,
             min(valuation_basis) as valuation_basis
      from app.inventory_sale_cost_attributions
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and meter_segment_id in ('${sealed.segmentIds.join("','")}')
    `);
    expect(attributionRows[0]).toEqual({
      count: '2',
      cogs: '537.0370',
      valuation_basis: 'PRE_SALE_WAC',
    });

    const projectionRows = await client.unsafe<
      {
        quantity_litres: string;
        inventory_value: string;
        weighted_average_cost: string;
        valuation_status: string;
      }[]
    >(`
      select quantity_litres, inventory_value, weighted_average_cost, valuation_status
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.tank}' and product_id='${ids.product}'
    `);
    expect(projectionRows).toEqual([
      {
        quantity_litres: '1100.000',
        inventory_value: '1262.9630',
        weighted_average_cost: '1.14814818',
        valuation_status: 'VALUED',
      },
    ]);

    const bridgeRows = await client.unsafe<{ count: string; litres: string }[]>(`
      select count(*)::text as count, coalesce(sum(allocated_litres), 0)::text as litres
      from app.reconciliation_meter_reading_segments
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and reconciliation_id='${reconciliationId}'
    `);
    expect(bridgeRows[0]).toEqual({ count: '3', litres: '500.000' });

    const chronologicalMovements = await client.unsafe<
      { source_type: string; source_id: string }[]
    >(`
      select source_type, source_id
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type in ('FUEL_DELIVERY_ALLOCATION', 'METER_SEGMENT_SALE')
      order by effective_at, id
    `);
    expect(chronologicalMovements).toEqual([
      { source_type: 'FUEL_DELIVERY_ALLOCATION', source_id: ids.allocation },
      { source_type: 'METER_SEGMENT_SALE', source_id: sealed.segmentIds[1] },
      { source_type: 'FUEL_DELIVERY_ALLOCATION', source_id: ids.transitionAllocation },
      { source_type: 'METER_SEGMENT_SALE', source_id: sealed.segmentIds[2] },
    ]);

    const canonicalMovement = await client.unsafe<
      {
        tank_id: string;
        product_id: string;
        quantity_litres: string;
        effective_at: Date;
        business_date: string;
      }[]
    >(`
      select tank_id, product_id, quantity_litres, effective_at, business_date
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='METER_SEGMENT_SALE' and source_id='${sealed.segmentIds[1]}'
    `);
    await expect(
      client.unsafe(`
        insert into app.inventory_movements
          (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres,
           effective_at, business_date, source_type, source_id, actor_membership_id)
        values
          ('${randomUUID()}', '${ids.tenant}', '${ids.station}', '${canonicalMovement[0]!.tank_id}',
           '${canonicalMovement[0]!.product_id}', 'SALE', '${canonicalMovement[0]!.quantity_litres}',
           '${canonicalMovement[0]!.effective_at.toISOString()}', '${canonicalMovement[0]!.business_date}',
           'METER_SEGMENT_SALE', '${sealed.segmentIds[1]}', '${ids.managerMembership}')
      `),
    ).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'inventory_movements_source_uidx',
    });

    const auditRows = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count from platform.security_events
      where tenant_id='${ids.tenant}' and event_code='FORECOURT.InventorySalePosted'
        and details->'after'->>'reconciliationId'='${reconciliationId}'
    `);
    expect(auditRows[0]?.count).toBe('2');
  });

  it('blocks A5 while a production-created late source is unvalued and resumes after A12.4 revaluation', async () => {
    const phase3TankId = randomUUID();
    const historicalReconciliationId = randomUUID();
    const blockedReconciliationId = randomUUID();

    await client.unsafe(`
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres,
         acceptable_variance_litres, status, created_by, updated_by)
      values
        ('${phase3TankId}', '${ids.tenant}', '${ids.station}', 'A5-P3-${phase3TankId.slice(0, 8)}',
         '${ids.product}', 10000, 500, 10, 'ACTIVE', '${ids.supervisorMembership}', '${ids.supervisorMembership}');
      update app.tanks
      set status='INACTIVE'
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${ids.tank}';
    `);

    try {
      const clock = await client.unsafe<{ now: Date }[]>('select clock_timestamp() as now');
      expect(clock).toHaveLength(1);
      const openingEffectiveAt = new Date(clock[0]!.now.getTime() - 60 * 60 * 1000);
      await expectOk(
        await postInventoryCommand(
          {
            commandType: 'RecordOpeningBalance',
            tenantId: ids.tenant,
            stationId: ids.station,
            tankId: phase3TankId,
            quantityLitres: '1000.000',
            effectiveAt: openingEffectiveAt.toISOString(),
          },
          `a5-phase3-opening-${phase3TankId}`,
          'a5-manager-session-token',
        ),
      );
      await expectOk(
        await postInventoryCommand(
          {
            commandType: 'RecordOpeningInventoryCost',
            tenantId: ids.tenant,
            stationId: ids.station,
            tankId: phase3TankId,
            amount: '1000.0000',
            currency: 'USD',
          },
          `a5-phase3-opening-cost-${phase3TankId}`,
          'a5-manager-session-token',
        ),
      );

      const historical = await createPopulatedProductionReconciliation(
        historicalReconciliationId,
        '500',
      );
      await expectOk(
        await postCommand(
          {
            commandType: 'SubmitProductionReconciliation',
            ...historical.common,
            expectedVersion: 5,
          },
          `a5-phase3-historical-submit-${historicalReconciliationId}`,
        ),
      );
      await expectOk(
        await postCommand(
          {
            commandType: 'ApproveProductionReconciliation',
            ...historical.common,
            expectedVersion: 6,
          },
          `a5-phase3-historical-approve-${historicalReconciliationId}`,
          'a5-manager-session-token',
        ),
      );

      const historicalSale = await client.unsafe<
        {
          movement_id: string;
          quantity_litres: string;
          effective_at: Date;
          cost_event_id: string;
          cogs_amount: string;
          attribution_id: string;
          sale_quantity_litres: string;
          pre_sale_wac: string;
          original_cogs: string;
          replay_fingerprint: string;
        }[]
      >(`
        select movement.id as movement_id,
               movement.quantity_litres,
               movement.effective_at,
               cost.id as cost_event_id,
               cost.amount::text as cogs_amount,
               attribution.id as attribution_id,
               attribution.sale_quantity_litres,
               attribution.pre_sale_wac,
               attribution.original_cogs,
               attribution.replay_fingerprint
        from app.inventory_movements movement
        join app.inventory_cost_events cost
          on cost.tenant_id=movement.tenant_id
         and cost.station_id=movement.station_id
         and cost.source_type='METER_SEGMENT_SALE'
         and cost.source_id=movement.source_id
         and cost.event_type='SALE_COGS'
        join app.inventory_sale_cost_attributions attribution
          on attribution.tenant_id=movement.tenant_id
         and attribution.station_id=movement.station_id
         and attribution.inventory_movement_id=movement.id
        where movement.tenant_id='${ids.tenant}'
          and movement.station_id='${ids.station}'
          and movement.tank_id='${phase3TankId}'
          and movement.product_id='${ids.product}'
          and movement.source_type='METER_SEGMENT_SALE'
          and movement.source_id='${historical.segmentIds[0]}'
      `);
      expect(historicalSale).toHaveLength(1);
      expect(historicalSale[0]).toMatchObject({
        quantity_litres: '-500.000',
        cogs_amount: '-500.0000',
        sale_quantity_litres: '500.000',
        pre_sale_wac: '1.00000000',
        original_cogs: '500.0000',
      });
      const historicalSaleBeforeRevaluation = { ...historicalSale[0]! };
      const lateEffectiveAt = new Date(historicalSale[0]!.effective_at.getTime() - 1);

      const createdDelivery = await expectOk(
        await postInventoryCommand(
          {
            commandType: 'CreateDelivery',
            tenantId: ids.tenant,
            stationId: ids.station,
            productId: ids.product,
            deliveryNoteNumber: `A5-P3-LATE-${phase3TankId.slice(0, 8)}`,
            deliveredAt: lateEffectiveAt.toISOString(),
            noteQuantityLitres: '100.000',
            actualQuantityLitres: '100.000',
            allocations: [{ tankId: phase3TankId, quantityLitres: '100.000' }],
          },
          `a5-phase3-late-delivery-${phase3TankId}`,
        ),
      );
      const lateDeliveryId = createdDelivery.deliveryId as string;
      const lateAllocationId = (createdDelivery.allocationIds as string[])[0]!;
      await expectOk(
        await postInventoryCommand(
          {
            commandType: 'ConfirmDelivery',
            tenantId: ids.tenant,
            stationId: ids.station,
            deliveryId: lateDeliveryId,
          },
          `a5-phase3-confirm-late-delivery-${phase3TankId}`,
        ),
      );

      const lateSource = await client.unsafe<
        { id: string; quantity_litres: string; effective_at: Date; source_id: string }[]
      >(`
        select id, quantity_litres, effective_at, source_id
        from app.inventory_movements
        where tenant_id='${ids.tenant}' and station_id='${ids.station}'
          and tank_id='${phase3TankId}' and product_id='${ids.product}'
          and source_type='FUEL_DELIVERY_ALLOCATION' and source_id='${lateAllocationId}'
      `);
      expect(lateSource).toHaveLength(1);
      expect(lateSource[0]).toMatchObject({
        quantity_litres: '100.000',
        source_id: lateAllocationId,
      });
      expect(lateSource[0]!.effective_at.getTime()).toBe(lateEffectiveAt.getTime());
      const lateSourceBeforeRevaluation = { ...lateSource[0]! };

      const unvaluedProjection = await client.unsafe<
        {
          quantity_litres: string;
          inventory_value: string | null;
          weighted_average_cost: string | null;
          currency: string | null;
          valuation_status: string;
        }[]
      >(`
        select quantity_litres, inventory_value, weighted_average_cost, currency, valuation_status
        from app.inventory_cost_stream_state
        where tenant_id='${ids.tenant}' and station_id='${ids.station}'
          and tank_id='${phase3TankId}' and product_id='${ids.product}'
      `);
      expect(unvaluedProjection).toEqual([
        {
          quantity_litres: '600.000',
          inventory_value: null,
          weighted_average_cost: null,
          currency: null,
          valuation_status: 'UNVALUED',
        },
      ]);
      await expect(
        client.unsafe(`
          select id from app.inventory_cost_events
          where tenant_id='${ids.tenant}' and station_id='${ids.station}'
            and source_type='FUEL_DELIVERY_ALLOCATION' and source_id='${lateAllocationId}'
        `),
      ).resolves.toHaveLength(0);

      const blocked = await createPopulatedProductionReconciliation(blockedReconciliationId, '500');
      await expectOk(
        await postCommand(
          {
            commandType: 'SubmitProductionReconciliation',
            ...blocked.common,
            expectedVersion: 5,
          },
          `a5-phase3-blocked-submit-${blockedReconciliationId}`,
        ),
      );
      const failedApproval = await postCommand(
        {
          commandType: 'ApproveProductionReconciliation',
          ...blocked.common,
          expectedVersion: 6,
        },
        `a5-phase3-blocked-approve-${blockedReconciliationId}`,
        'a5-manager-session-token',
      );
      const failedApprovalBody = (await failedApproval.json()) as {
        error?: string;
        message?: string;
      };
      expect(failedApproval.status, JSON.stringify(failedApprovalBody)).toBe(409);
      expect(failedApprovalBody).toMatchObject({
        error: 'CONFLICT',
        message: 'A sale cannot be costed while the inventory stream is UNVALUED',
      });
      const blockedState = await client.unsafe<{ state: string; version: number }[]>(`
        select state, version
        from app.reconciliations
        where tenant_id='${ids.tenant}' and station_id='${ids.station}'
          and id='${blockedReconciliationId}'
      `);
      expect(blockedState).toEqual([{ state: 'SUBMITTED', version: 6 }]);
      const failedSaleEvidence = await client.unsafe<
        {
          movements: string;
          cogs: string;
          attributions: string;
          bridges: string;
          revenue: string;
        }[]
      >(`
        select
          (select count(*)::text from app.inventory_movements
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and source_type='METER_SEGMENT_SALE'
             and source_id in ('${blocked.segmentIds.join("','")}')) as movements,
          (select count(*)::text from app.inventory_cost_events
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and event_type='SALE_COGS'
             and source_id in ('${blocked.segmentIds.join("','")}')) as cogs,
          (select count(*)::text from app.inventory_sale_cost_attributions
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and meter_segment_id in ('${blocked.segmentIds.join("','")}')) as attributions,
          (select count(*)::text from app.reconciliation_meter_reading_segments
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and reconciliation_id='${blockedReconciliationId}') as bridges,
          (select count(*)::text from app.sale_recognition_movements
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and source_id in ('${blocked.segmentIds.join("','")}')) as revenue
      `);
      expect(failedSaleEvidence).toEqual([
        { movements: '0', cogs: '0', attributions: '0', bridges: '0', revenue: '0' },
      ]);

      const requested = await expectOk(
        await postInventoryCommand(
          {
            commandType: 'RequestInventoryCostRevaluation',
            tenantId: ids.tenant,
            stationId: ids.station,
            tankId: phase3TankId,
            productId: ids.product,
            sourceType: 'FUEL_DELIVERY_ALLOCATION',
            sourceId: lateAllocationId,
            amount: '200.0000',
            currency: 'USD',
            reason: 'A5 Phase 3 late historical receipt cost',
          },
          `a5-phase3-request-revaluation-${phase3TankId}`,
          'a5-manager-session-token',
        ),
      );
      const revaluationId = requested.revaluationId as string;
      await expectOk(
        await postInventoryCommand(
          {
            commandType: 'ApproveInventoryCostRevaluation',
            tenantId: ids.tenant,
            stationId: ids.station,
            revaluationId,
          },
          `a5-phase3-approve-revaluation-${phase3TankId}`,
          'a5-approver-session-token',
        ),
      );
      await expectOk(
        await postInventoryCommand(
          {
            commandType: 'PostInventoryCostRevaluation',
            tenantId: ids.tenant,
            stationId: ids.station,
            revaluationId,
          },
          `a5-phase3-post-revaluation-${phase3TankId}`,
          'a5-manager-session-token',
        ),
      );

      const valuedProjection = await client.unsafe<
        {
          quantity_litres: string;
          inventory_value: string;
          weighted_average_cost: string;
          currency: string;
          valuation_status: string;
        }[]
      >(`
        select quantity_litres, inventory_value, weighted_average_cost, currency, valuation_status
        from app.inventory_cost_stream_state
        where tenant_id='${ids.tenant}' and station_id='${ids.station}'
          and tank_id='${phase3TankId}' and product_id='${ids.product}'
      `);
      expect(valuedProjection).toEqual([
        {
          quantity_litres: '600.000',
          inventory_value: '654.5455',
          weighted_average_cost: '1.09090917',
          currency: 'USD',
          valuation_status: 'VALUED',
        },
      ]);

      const revaluationEvidence = await client.unsafe<
        {
          status: string;
          ordinary_cost_count: string;
          ordinary_cost_amount: string;
          line_count: string;
          cogs_delta: string;
          revaluation_event_count: string;
          inventory_revaluation_event_count: string;
        }[]
      >(`
        select revaluation.status,
               (select count(*)::text from app.inventory_cost_events event
                where event.tenant_id=revaluation.tenant_id and event.station_id=revaluation.station_id
                  and event.event_type='RECEIPT_COST' and event.source_id='${lateAllocationId}') as ordinary_cost_count,
               (select event.amount::text from app.inventory_cost_events event
                where event.tenant_id=revaluation.tenant_id and event.station_id=revaluation.station_id
                  and event.event_type='RECEIPT_COST' and event.source_id='${lateAllocationId}') as ordinary_cost_amount,
               (select count(*)::text from app.inventory_cost_revaluation_lines line
                where line.tenant_id=revaluation.tenant_id and line.station_id=revaluation.station_id
                  and line.revaluation_id=revaluation.id) as line_count,
               (select line.cogs_delta::text from app.inventory_cost_revaluation_lines line
                where line.tenant_id=revaluation.tenant_id and line.station_id=revaluation.station_id
                  and line.revaluation_id=revaluation.id) as cogs_delta,
               (select count(*)::text from app.inventory_cost_events event
                where event.tenant_id=revaluation.tenant_id and event.station_id=revaluation.station_id
                  and event.event_type='COGS_REVALUATION'
                  and event.source_type='INVENTORY_COST_REVALUATION_LINE'
                  and event.source_id in (
                    select line.id from app.inventory_cost_revaluation_lines line
                    where line.tenant_id=revaluation.tenant_id and line.station_id=revaluation.station_id
                      and line.revaluation_id=revaluation.id
                  )) as revaluation_event_count,
               (select count(*)::text from app.inventory_cost_events event
                where event.tenant_id=revaluation.tenant_id and event.station_id=revaluation.station_id
                  and event.event_type='INVENTORY_REVALUATION'
                  and event.source_id='${lateAllocationId}') as inventory_revaluation_event_count
        from app.inventory_cost_revaluations revaluation
        where revaluation.tenant_id='${ids.tenant}' and revaluation.station_id='${ids.station}'
          and revaluation.id='${revaluationId}'
      `);
      expect(revaluationEvidence).toEqual([
        {
          status: 'POSTED',
          ordinary_cost_count: '1',
          ordinary_cost_amount: '200.0000',
          line_count: '1',
          cogs_delta: '45.4545',
          revaluation_event_count: '1',
          inventory_revaluation_event_count: '0',
        },
      ]);

      const historicalSaleAfterRevaluation = await client.unsafe<
        {
          movement_id: string;
          quantity_litres: string;
          cost_event_id: string;
          cogs_amount: string;
          attribution_id: string;
          sale_quantity_litres: string;
          pre_sale_wac: string;
          original_cogs: string;
          replay_fingerprint: string;
        }[]
      >(`
        select movement.id as movement_id,
               movement.quantity_litres,
               cost.id as cost_event_id,
               cost.amount::text as cogs_amount,
               attribution.id as attribution_id,
               attribution.sale_quantity_litres,
               attribution.pre_sale_wac,
               attribution.original_cogs,
               attribution.replay_fingerprint
        from app.inventory_movements movement
        join app.inventory_cost_events cost
          on cost.tenant_id=movement.tenant_id and cost.station_id=movement.station_id
         and cost.event_type='SALE_COGS' and cost.source_type='METER_SEGMENT_SALE'
         and cost.source_id=movement.source_id
        join app.inventory_sale_cost_attributions attribution
          on attribution.tenant_id=movement.tenant_id and attribution.station_id=movement.station_id
         and attribution.inventory_movement_id=movement.id
        where movement.tenant_id='${ids.tenant}' and movement.station_id='${ids.station}'
          and movement.tank_id='${phase3TankId}' and movement.product_id='${ids.product}'
          and movement.source_id='${historical.segmentIds[0]}'
      `);
      expect(historicalSaleAfterRevaluation).toEqual([
        {
          movement_id: historicalSaleBeforeRevaluation.movement_id,
          quantity_litres: historicalSaleBeforeRevaluation.quantity_litres,
          cost_event_id: historicalSaleBeforeRevaluation.cost_event_id,
          cogs_amount: historicalSaleBeforeRevaluation.cogs_amount,
          attribution_id: historicalSaleBeforeRevaluation.attribution_id,
          sale_quantity_litres: historicalSaleBeforeRevaluation.sale_quantity_litres,
          pre_sale_wac: historicalSaleBeforeRevaluation.pre_sale_wac,
          original_cogs: historicalSaleBeforeRevaluation.original_cogs,
          replay_fingerprint: historicalSaleBeforeRevaluation.replay_fingerprint,
        },
      ]);
      const historicalAttributionCount = await client.unsafe<{ count: string }[]>(`
        select count(*)::text as count
        from app.inventory_sale_cost_attributions
        where tenant_id='${ids.tenant}' and station_id='${ids.station}'
          and inventory_movement_id='${historicalSaleBeforeRevaluation.movement_id}'
      `);
      expect(historicalAttributionCount).toEqual([{ count: '1' }]);

      const lateSourceAfterRevaluation = await client.unsafe<
        { id: string; quantity_litres: string; effective_at: Date; source_id: string }[]
      >(`
        select id, quantity_litres, effective_at, source_id
        from app.inventory_movements
        where tenant_id='${ids.tenant}' and station_id='${ids.station}'
          and id='${lateSourceBeforeRevaluation.id}'
      `);
      expect(lateSourceAfterRevaluation).toHaveLength(1);
      expect(lateSourceAfterRevaluation[0]!.id).toBe(lateSourceBeforeRevaluation.id);
      expect(lateSourceAfterRevaluation[0]!.quantity_litres).toBe(
        lateSourceBeforeRevaluation.quantity_litres,
      );
      expect(lateSourceAfterRevaluation[0]!.source_id).toBe(lateSourceBeforeRevaluation.source_id);
      expect(lateSourceAfterRevaluation[0]!.effective_at.getTime()).toBe(
        lateSourceBeforeRevaluation.effective_at.getTime(),
      );

      const approvedAfterRevaluation = await expectOk(
        await postCommand(
          {
            commandType: 'ApproveProductionReconciliation',
            ...blocked.common,
            expectedVersion: 6,
          },
          `a5-phase3-approved-after-revaluation-${blockedReconciliationId}`,
          'a5-manager-session-token',
        ),
      );
      expect(approvedAfterRevaluation.state).toBe('APPROVED');
      const futureSale = await client.unsafe<
        {
          movement_id: string;
          quantity_litres: string;
          cogs_amount: string;
          sale_quantity_litres: string;
          pre_sale_wac: string;
          original_cogs: string;
        }[]
      >(`
        select movement.id as movement_id,
               movement.quantity_litres,
               cost.amount::text as cogs_amount,
               attribution.sale_quantity_litres,
               attribution.pre_sale_wac,
               attribution.original_cogs
        from app.inventory_movements movement
        join app.inventory_cost_events cost
          on cost.tenant_id=movement.tenant_id and cost.station_id=movement.station_id
         and cost.event_type='SALE_COGS' and cost.source_type='METER_SEGMENT_SALE'
         and cost.source_id=movement.source_id
        join app.inventory_sale_cost_attributions attribution
          on attribution.tenant_id=movement.tenant_id and attribution.station_id=movement.station_id
         and attribution.inventory_movement_id=movement.id
        where movement.tenant_id='${ids.tenant}' and movement.station_id='${ids.station}'
          and movement.tank_id='${phase3TankId}' and movement.product_id='${ids.product}'
          and movement.source_id='${blocked.segmentIds[0]}'
      `);
      expect(futureSale).toEqual([
        {
          movement_id: expect.any(String),
          quantity_litres: '-500.000',
          cogs_amount: '-545.4546',
          sale_quantity_litres: '500.000',
          pre_sale_wac: '1.09090917',
          original_cogs: '545.4546',
        },
      ]);
      const totalAttributionCount = await client.unsafe<{ count: string }[]>(`
        select count(*)::text as count
        from app.inventory_sale_cost_attributions
        where tenant_id='${ids.tenant}' and station_id='${ids.station}'
          and tank_id='${phase3TankId}' and product_id='${ids.product}'
      `);
      expect(totalAttributionCount).toEqual([{ count: '2' }]);
    } finally {
      await client.unsafe(`
        update app.tanks
        set status='INACTIVE'
        where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${phase3TankId}';
        update app.tanks
        set status='ACTIVE'
        where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${ids.tank}';
      `);
    }
  });

  it('rejects unvalued approval atomically and leaves no sale evidence', async () => {
    try {
      await client.unsafe(`
      update app.tanks set status='INACTIVE'
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${ids.tank}';
      update app.tanks set status='ACTIVE'
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${ids.unvaluedTank}';
      `);
      await expectOk(
        await postInventoryCommand(
          {
            commandType: 'RecordOpeningInventoryCost',
            tenantId: ids.tenant,
            stationId: ids.station,
            tankId: ids.unvaluedTank,
            amount: '1000.0000',
            currency: 'USD',
          },
          'a5-unvalued-opening-cost',
          'a5-manager-session-token',
        ),
      );
      await expectOk(
        await postInventoryCommand(
          {
            commandType: 'ConfirmDelivery',
            tenantId: ids.tenant,
            stationId: ids.station,
            deliveryId: ids.unvaluedDelivery,
          },
          'a5-confirm-unvalued-delivery',
        ),
      );
      const uncostedMovement = await client.unsafe<{ count: string; quantity_litres: string }[]>(`
      select count(*)::text as count, coalesce(sum(quantity_litres), 0)::text as quantity_litres
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='FUEL_DELIVERY_ALLOCATION'
        and source_id='${ids.unvaluedAllocation}'
    `);
      expect(uncostedMovement).toEqual([{ count: '1', quantity_litres: '100.000' }]);
      const authoritativeRows = await client.unsafe<
        { source_type: string; source_id: string; quantity_litres: string }[]
      >(`
      select source_type, source_id, quantity_litres
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.unvaluedTank}' and product_id='${ids.product}'
        and (
          source_id in (
            '${ids.unvaluedOpeningSource}', '${ids.unvaluedAllocation}', '${ids.unvaluedDelivery}'
          )
          or (
            source_type='METER_SEGMENT_SALE'
          )
        )
      order by effective_at, id
    `);
      expect(authoritativeRows).toHaveLength(2);
      expect(
        authoritativeRows.filter((row) => row.source_type === 'METER_SEGMENT_SALE'),
      ).toHaveLength(0);
      /*
       * This is deliberately derived from the posted A4 movements. It protects
       * the test from asserting a quantity that is not actually authoritative.
       */
      expect(
        authoritativeRows.every(
          (row) =>
            row.source_type === 'METER_SEGMENT_SALE' ||
            [ids.unvaluedOpeningSource, ids.unvaluedAllocation].includes(row.source_id),
        ),
      ).toBe(true);
      expect(authoritativeRows).toEqual(
        expect.arrayContaining([
          {
            source_type: 'CUTOVER',
            source_id: ids.unvaluedOpeningSource,
            quantity_litres: '1000.000',
          },
          {
            source_type: 'FUEL_DELIVERY_ALLOCATION',
            source_id: ids.unvaluedAllocation,
            quantity_litres: '100.000',
          },
        ]),
      );
      const authoritativeQuantity = authoritativeRows.reduce(
        (total, row) => total.add(new ExactDecimal(row.quantity_litres)),
        new ExactDecimal('0'),
      );
      const unvalued = await client.unsafe<
        {
          quantity_litres: string;
          inventory_value: string | null;
          weighted_average_cost: string | null;
          currency: string | null;
          valuation_status: string;
        }[]
      >(`
      select quantity_litres, inventory_value, weighted_average_cost, currency, valuation_status
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.unvaluedTank}' and product_id='${ids.product}'
    `);
      expect(unvalued).toEqual([
        {
          quantity_litres: authoritativeQuantity
            .quantize(DECIMAL_POLICIES.litres)
            .value.toFixed(DECIMAL_POLICIES.litres.scale),
          inventory_value: null,
          weighted_average_cost: null,
          currency: null,
          valuation_status: 'UNVALUED',
        },
      ]);

      const reconciliationId = randomUUID();
      const { common, segmentIds } =
        await createPopulatedProductionReconciliation(reconciliationId);
      await expectOk(
        await postCommand(
          { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 5 },
          `a5-unvalued-submit-${reconciliationId}`,
        ),
      );
      const before = await client.unsafe<
        { projection_version: number; quantity_litres: string; valuation_status: string }[]
      >(`
      select projection_version, quantity_litres, valuation_status
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.unvaluedTank}' and product_id='${ids.product}'
    `);
      const failed = await postCommand(
        { commandType: 'ApproveProductionReconciliation', ...common, expectedVersion: 6 },
        `a5-unvalued-approve-${reconciliationId}`,
        'a5-manager-session-token',
      );
      expect(failed.status).toBe(409);
      const state = await client.unsafe<{ state: string }[]>(`
      select state from app.reconciliations
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${reconciliationId}'
    `);
      expect(state).toEqual([{ state: 'SUBMITTED' }]);
      const failedEvidence = await client.unsafe<
        {
          movements: string;
          cogs: string;
          attributions: string;
          bridges: string;
          revenue: string;
        }[]
      >(`
      select
        (select count(*)::text from app.inventory_movements
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and source_type='METER_SEGMENT_SALE' and source_id in ('${segmentIds.join("','")}')) as movements,
        (select count(*)::text from app.inventory_cost_events
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and event_type='SALE_COGS' and source_id in ('${segmentIds.join("','")}')) as cogs,
        (select count(*)::text from app.inventory_sale_cost_attributions
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and meter_segment_id in ('${segmentIds.join("','")}')) as attributions,
        (select count(*)::text from app.reconciliation_meter_reading_segments
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and reconciliation_id='${reconciliationId}') as bridges,
        (select count(*)::text from app.sale_recognition_movements
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and source_id in ('${segmentIds.join("','")}')) as revenue
    `);
      expect(failedEvidence).toEqual([
        { movements: '0', cogs: '0', attributions: '0', bridges: '0', revenue: '0' },
      ]);
      const after = await client.unsafe<
        { projection_version: number; quantity_litres: string; valuation_status: string }[]
      >(`
      select projection_version, quantity_litres, valuation_status
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.unvaluedTank}' and product_id='${ids.product}'
    `);
      expect(after).toEqual(before);
    } finally {
      await client.unsafe(`
      update app.tanks set status='INACTIVE'
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${ids.unvaluedTank}';
      update app.tanks set status='ACTIVE'
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${ids.tank}';
      `);
    }
  });

  it('forbids the submitter from approving their own reconciliation', async () => {
    const reconciliationId = randomUUID();
    const { common } = await createPopulatedProductionReconciliation(reconciliationId);
    await expectOk(
      await postCommand(
        { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 5 },
        `a5-self-submit-${reconciliationId}`,
        'a5-manager-session-token',
      ),
    );
    const own = await postCommand(
      { commandType: 'ApproveProductionReconciliation', ...common, expectedVersion: 6 },
      `a5-self-approve-${reconciliationId}`,
      'a5-manager-session-token',
    );
    expect(own.status).toBe(403);
    const rows = await client.unsafe<{ state: string }[]>(`
      select state from app.reconciliations
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${reconciliationId}'
    `);
    expect(rows).toEqual([{ state: 'SUBMITTED' }]);
    // The review page hides Approve from the submitter, but not from another approver.
    const asSubmitter = (await (
      await readReconciliation(reconciliationId, 'a5-manager-session-token')
    ).json()) as { approvalBlocked?: boolean };
    expect(asSubmitter.approvalBlocked).toBe(true);
    const asOther = (await (
      await readReconciliation(reconciliationId, 'a5-approver-session-token')
    ).json()) as { approvalBlocked?: boolean };
    expect(asOther.approvalBlocked).toBe(false);
  });

  it('lists a waiting reconciliation in the finance action center, flagged for its submitter', async () => {
    const reconciliationId = randomUUID();
    const { common } = await createPopulatedProductionReconciliation(reconciliationId);
    await expectOk(
      await postCommand(
        { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 5 },
        `a5-center-submit-${reconciliationId}`,
        'a5-manager-session-token',
      ),
    );
    const factsFor = (token: string) =>
      loadActionCenterFacts(
        new Request('http://127.0.0.1:3000/finance', { headers: clerkHeaders(token) }),
        {
          organisationId: ids.tenant,
          legalEntityId: ids.legal,
          stationId: ids.station,
          allStations: false,
        },
      );
    const waiting = async (token: string) => {
      const facts = await factsFor(token);
      if (facts.reconciliations.status !== 'ok') throw new Error('reconciliations not loaded');
      return {
        row: facts.reconciliations.value.rows.find((entry) => entry.id === reconciliationId),
        soleApprover: facts.reconciliations.value.soleApprover,
      };
    };
    const own = await waiting('a5-manager-session-token');
    expect(own.row?.submittedByMe).toBe(true);
    expect(own.soleApprover).toBe(false);
    const other = await waiting('a5-approver-session-token');
    expect(other.row?.submittedByMe).toBe(false);
  });

  it('lets a solo approver approve their own reconciliation when nobody else could', async () => {
    const reconciliationId = randomUUID();
    const { common } = await createPopulatedProductionReconciliation(reconciliationId);
    await expectOk(
      await postCommand(
        { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 5 },
        `a5-solo-submit-${reconciliationId}`,
        'a5-manager-session-token',
      ),
    );
    await client.unsafe(`
      update app.memberships set status='SUSPENDED'
      where tenant_id='${ids.tenant}' and id <> '${ids.managerMembership}'
    `);
    try {
      await expectOk(
        await postCommand(
          { commandType: 'ApproveProductionReconciliation', ...common, expectedVersion: 6 },
          `a5-solo-approve-${reconciliationId}`,
          'a5-manager-session-token',
        ),
      );
    } finally {
      await client.unsafe(`
        update app.memberships set status='ACTIVE'
        where tenant_id='${ids.tenant}' and id <> '${ids.managerMembership}'
      `);
    }
    const rows = await client.unsafe<{ state: string }[]>(`
      select state from app.reconciliations
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${reconciliationId}'
    `);
    expect(rows).toEqual([{ state: 'APPROVED' }]);
  });

  it('rejects insufficient-stock approval atomically', async () => {
    const reconciliationId = randomUUID();
    const { common, segmentIds } = await createPopulatedProductionReconciliation(
      reconciliationId,
      '1101',
    );
    await expectOk(
      await postCommand(
        { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 5 },
        `a5-insufficient-submit-${reconciliationId}`,
      ),
    );
    const before = await client.unsafe<{ projection_version: number; quantity_litres: string }[]>(`
      select projection_version, quantity_litres
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.tank}' and product_id='${ids.product}'
    `);
    const failed = await postCommand(
      { commandType: 'ApproveProductionReconciliation', ...common, expectedVersion: 6 },
      `a5-insufficient-approve-${reconciliationId}`,
      'a5-manager-session-token',
    );
    const failedBody = await failed.json();
    expect(failed.status, JSON.stringify(failedBody)).toBe(422);
    expect(failedBody.error).toBe('INVARIANT_VIOLATION');
    const state = await client.unsafe<{ state: string }[]>(`
      select state from app.reconciliations
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${reconciliationId}'
    `);
    expect(state).toEqual([{ state: 'SUBMITTED' }]);
    const failedEvidence = await client.unsafe<
      { movements: string; cogs: string; attributions: string; bridges: string; revenue: string }[]
    >(`
      select
        (select count(*)::text from app.inventory_movements
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and source_type='METER_SEGMENT_SALE' and source_id in ('${segmentIds.join("','")}')) as movements,
        (select count(*)::text from app.inventory_cost_events
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and event_type='SALE_COGS' and source_id in ('${segmentIds.join("','")}')) as cogs,
        (select count(*)::text from app.inventory_sale_cost_attributions
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and meter_segment_id in ('${segmentIds.join("','")}')) as attributions,
        (select count(*)::text from app.reconciliation_meter_reading_segments
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and reconciliation_id='${reconciliationId}') as bridges,
        (select count(*)::text from app.sale_recognition_movements
         where tenant_id='${ids.tenant}' and station_id='${ids.station}'
           and source_id in ('${segmentIds.join("','")}')) as revenue
    `);
    expect(failedEvidence).toEqual([
      { movements: '0', cogs: '0', attributions: '0', bridges: '0', revenue: '0' },
    ]);
    const after = await client.unsafe<{ projection_version: number; quantity_litres: string }[]>(`
      select projection_version, quantity_litres
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.tank}' and product_id='${ids.product}'
    `);
    expect(after).toEqual(before);
  });

  it('rolls back A4, A12, bridge, and revenue when revenue insertion fails', async () => {
    const reconciliationId = randomUUID();
    const { common, segmentIds } = await createPopulatedProductionReconciliation(
      reconciliationId,
      '1201',
    );
    await expectOk(
      await postCommand(
        { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 5 },
        `a5-revenue-failure-submit-${reconciliationId}`,
      ),
    );

    try {
      await client.unsafe(`
        create or replace function public.a5_fail_sale_revenue() returns trigger
        language plpgsql as $$
        begin
          raise exception 'test-injected revenue insertion failure';
        end;
        $$;
        drop trigger if exists a5_fail_sale_revenue on app.sale_recognition_movements;
        create trigger a5_fail_sale_revenue
          before insert on app.sale_recognition_movements
          for each row execute function public.a5_fail_sale_revenue();
      `);
      const failed = await postCommand(
        { commandType: 'ApproveProductionReconciliation', ...common, expectedVersion: 6 },
        `a5-revenue-failure-approve-${reconciliationId}`,
        'a5-manager-session-token',
      );
      expect(failed.status).not.toBe(200);
      const state = await client.unsafe<{ state: string }[]>(`
        select state from app.reconciliations
        where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${reconciliationId}'
      `);
      expect(state).toEqual([{ state: 'SUBMITTED' }]);
      const revisionState = await client.unsafe<{ state: string }[]>(`
        select state
        from app.reconciliation_revisions
        where tenant_id='${ids.tenant}'
          and station_id='${ids.station}'
          and reconciliation_id='${reconciliationId}'
        order by revision desc, id desc
        limit 1
      `);
      expect(revisionState).toEqual([{ state: 'PENDING_APPROVAL' }]);
      const evidence = await client.unsafe<
        {
          movements: string;
          cogs: string;
          attributions: string;
          bridges: string;
          revenue: string;
        }[]
      >(`
        select
          (select count(*)::text from app.inventory_movements
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and source_type='METER_SEGMENT_SALE' and source_id in ('${segmentIds.join("','")}')) as movements,
          (select count(*)::text from app.inventory_cost_events
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and event_type='SALE_COGS' and source_id in ('${segmentIds.join("','")}')) as cogs,
          (select count(*)::text from app.inventory_sale_cost_attributions
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and meter_segment_id in ('${segmentIds.join("','")}')) as attributions,
          (select count(*)::text from app.reconciliation_meter_reading_segments
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and reconciliation_id='${reconciliationId}') as bridges,
          (select count(*)::text from app.sale_recognition_movements
           where tenant_id='${ids.tenant}' and station_id='${ids.station}'
             and source_id in ('${segmentIds.join("','")}')) as revenue
      `);
      expect(evidence).toEqual([
        { movements: '0', cogs: '0', attributions: '0', bridges: '0', revenue: '0' },
      ]);
    } finally {
      await client.unsafe(`
        drop trigger if exists a5_fail_sale_revenue on app.sale_recognition_movements;
        drop function if exists public.a5_fail_sale_revenue();
      `);
    }
  });

  it('preserves a returned revision and approves only its corrected replacement', async () => {
    const reconciliationId = randomUUID();
    const { common, shiftId, openingReading, correctedClosingReading, segmentIds } =
      await createPopulatedProductionReconciliation(reconciliationId);

    const submitted = await expectOk(
      await postCommand(
        { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 5 },
        `a5-return-submit-${reconciliationId}`,
      ),
    );
    expect(submitted.state).toBe('SUBMITTED');

    await expect(
      client.unsafe(`
        update app.reconciliations
        set state='APPROVED', approved_by='${ids.managerMembership}', approved_at=now()
        where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${reconciliationId}'
      `),
    ).rejects.toThrow('lineage for every meter reading');
    const afterRejectedApproval = await client.unsafe<{ state: string }[]>(`
      select state from app.reconciliations
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${reconciliationId}'
    `);
    expect(afterRejectedApproval[0]?.state).toBe('SUBMITTED');

    const returnRevision = await client.unsafe<{ id: string }[]>(`
      select id from app.reconciliation_revisions
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and reconciliation_id='${reconciliationId}'
        and state='PENDING_APPROVAL'
    `);
    const returnReading = await client.unsafe<{ id: string }[]>(`
      select id from app.reconciliation_meter_readings
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and reconciliation_id='${reconciliationId}'
    `);
    const otherShiftSegment = await client.unsafe<{ id: string; litres: string }[]>(`
      select id, litres from app.meter_segments
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and shift_id='${ids.shift}' and state='SEALED'
      order by segment_start_at, id limit 1
    `);
    await expect(
      client.unsafe(`
        insert into app.reconciliation_meter_reading_segments
          (id, tenant_id, station_id, reconciliation_id, revision_id,
           reconciliation_meter_reading_id, meter_segment_id, allocated_litres)
        values
          ('${randomUUID()}', '${ids.tenant}', '${ids.station}', '${reconciliationId}', '${returnRevision[0]!.id}',
           '${returnReading[0]!.id}', '${otherShiftSegment[0]!.id}', '${otherShiftSegment[0]!.litres}')
      `),
    ).rejects.toThrow('must match shift, nozzle, and product');
    const afterRejectedBridge = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count
      from app.reconciliation_meter_reading_segments
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and reconciliation_id='${reconciliationId}'
    `);
    expect(afterRejectedBridge[0]?.count).toBe('0');

    const firstRevision = await client.unsafe<
      {
        id: string;
        revision: number;
        state: string;
        expected_sales: string;
        accounted_sales: string;
        variance: string;
        version: number;
      }[]
    >(`
      select id, revision, state, expected_sales, accounted_sales, variance, version
      from app.reconciliation_revisions
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and reconciliation_id='${reconciliationId}'
      order by revision
    `);
    expect(firstRevision).toHaveLength(1);
    expect(firstRevision[0]).toMatchObject({
      revision: 1,
      state: 'PENDING_APPROVAL',
      expected_sales: '750.0000',
      accounted_sales: '750.0000',
      variance: '0.0000',
      version: 2,
    });

    const returned = await expectOk(
      await postCommand(
        {
          commandType: 'ReturnProductionReconciliation',
          ...common,
          expectedVersion: submitted.version,
          reason: 'Correct the closing meter reading',
        },
        `a5-return-${reconciliationId}`,
        'a5-manager-session-token',
      ),
    );
    expect(returned.state).toBe('RETURNED');

    const returnedHeader = await client.unsafe<{ state: string; return_reason: string | null }[]>(`
      select state, return_reason from app.reconciliations
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${reconciliationId}'
    `);
    expect(returnedHeader[0]).toEqual({
      state: 'RETURNED',
      return_reason: 'Correct the closing meter reading',
    });
    const returnedRevision = await client.unsafe<
      {
        id: string;
        revision: number;
        state: string;
        expected_sales: string;
        accounted_sales: string;
        variance: string;
        version: number;
      }[]
    >(`
      select id, revision, state, expected_sales, accounted_sales, variance, version
      from app.reconciliation_revisions
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and reconciliation_id='${reconciliationId}'
      order by revision
    `);
    expect(returnedRevision[0]).toMatchObject({
      id: firstRevision[0]!.id,
      revision: 1,
      state: 'RETURNED',
      expected_sales: '750.0000',
      accounted_sales: '750.0000',
      variance: '0.0000',
      version: 3,
    });

    const correctedMeter = await expectOk(
      await postCommand(
        {
          commandType: 'SaveMeterReadings',
          ...common,
          expectedVersion: returned.version,
          readings: [
            {
              nozzleId: ids.nozzle,
              productId: ids.product,
              shiftId,
              openingReading,
              closingReading: correctedClosingReading,
              sellingPriceId: ids.price,
            },
          ],
        },
        `a5-return-corrected-readings-${reconciliationId}`,
      ),
    );
    const correctedPayments = await expectOk(
      await postCommand(
        {
          commandType: 'SavePaymentAllocations',
          ...common,
          expectedVersion: correctedMeter.version,
          payments: [{ method: 'CASH', amount: '751.5000' }],
        },
        `a5-return-corrected-payments-${reconciliationId}`,
      ),
    );
    const correctedCash = await expectOk(
      await postCommand(
        {
          commandType: 'SaveCashDeclaration',
          ...common,
          expectedVersion: correctedPayments.version,
          countedCash: '751.5000',
        },
        `a5-return-corrected-cash-${reconciliationId}`,
      ),
    );
    const resubmitted = await expectOk(
      await postCommand(
        {
          commandType: 'SubmitProductionReconciliation',
          ...common,
          expectedVersion: correctedCash.version,
        },
        `a5-return-resubmit-${reconciliationId}`,
      ),
    );
    expect(resubmitted.state).toBe('SUBMITTED');

    const resubmittedRevisions = await client.unsafe<
      {
        id: string;
        revision: number;
        state: string;
        expected_sales: string;
        accounted_sales: string;
        variance: string;
        version: number;
      }[]
    >(`
      select id, revision, state, expected_sales, accounted_sales, variance, version
      from app.reconciliation_revisions
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and reconciliation_id='${reconciliationId}'
      order by revision
    `);
    expect(resubmittedRevisions).toHaveLength(2);
    expect(resubmittedRevisions[0]).toMatchObject({
      id: firstRevision[0]!.id,
      revision: 1,
      state: 'RETURNED',
      expected_sales: '750.0000',
      accounted_sales: '750.0000',
      variance: '0.0000',
      version: 3,
    });
    expect(resubmittedRevisions[1]).toMatchObject({
      revision: 2,
      state: 'PENDING_APPROVAL',
      expected_sales: '751.5000',
      accounted_sales: '751.5000',
      variance: '0.0000',
      version: 2,
    });

    const correctedReading = await client.unsafe<{ id: string }[]>(`
      select id from app.reconciliation_meter_readings
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and reconciliation_id='${reconciliationId}'
    `);
    await client.unsafe('begin');
    try {
      await client.unsafe(`
        insert into app.reconciliation_meter_reading_segments
          (id, tenant_id, station_id, reconciliation_id, revision_id,
           reconciliation_meter_reading_id, meter_segment_id, allocated_litres)
        select gen_random_uuid(), '${ids.tenant}', '${ids.station}', '${reconciliationId}', '${resubmittedRevisions[1]!.id}',
               '${correctedReading[0]!.id}', segment.id, segment.litres
        from app.meter_segments segment
        where segment.tenant_id='${ids.tenant}' and segment.station_id='${ids.station}'
          and segment.id in ('${segmentIds.join("','")}')
      `);
      const preApprovalLineage = await client.unsafe<
        { source_segment_ids: string[]; bridge_count: string }[]
      >(`
        select revision.source_segment_ids, count(bridge.id)::text as bridge_count
        from app.reconciliation_revisions revision
        left join app.reconciliation_meter_reading_segments bridge
          on bridge.tenant_id=revision.tenant_id
         and bridge.station_id=revision.station_id
         and bridge.reconciliation_id=revision.reconciliation_id
         and bridge.revision_id=revision.id
        where revision.tenant_id='${ids.tenant}' and revision.station_id='${ids.station}'
          and revision.reconciliation_id='${reconciliationId}'
          and revision.id='${resubmittedRevisions[1]!.id}'
        group by revision.source_segment_ids
      `);
      expect(preApprovalLineage).toEqual([{ source_segment_ids: [], bridge_count: '2' }]);
      await client.unsafe('savepoint a5_unchanged_lineage_approval');
      await expect(
        client.unsafe(`
          update app.reconciliation_revisions
          set state='APPROVED', approved_by='${ids.managerMembership}', approved_at=now(), version=version+1
          where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${resubmittedRevisions[1]!.id}'
            and state='PENDING_APPROVAL'
        `),
      ).rejects.toThrow('authoritative reconciliation revision values are immutable');
      await client.unsafe('rollback to savepoint a5_unchanged_lineage_approval');
      await client.unsafe('savepoint a5_bogus_lineage_approval');
      await expect(
        client.unsafe(`
          update app.reconciliation_revisions
          set source_segment_ids='["${randomUUID()}"]'::jsonb,
              state='APPROVED', approved_by='${ids.managerMembership}', approved_at=now(), version=version+1
          where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${resubmittedRevisions[1]!.id}'
            and state='PENDING_APPROVAL'
        `),
      ).rejects.toThrow('authoritative reconciliation revision values are immutable');
      await client.unsafe('rollback to savepoint a5_bogus_lineage_approval');
      await client.unsafe('savepoint a5_same_state_lineage_mutation');
      await expect(
        client.unsafe(`
          update app.reconciliation_revisions
          set source_segment_ids='["${randomUUID()}"]'::jsonb
          where tenant_id='${ids.tenant}' and station_id='${ids.station}' and id='${resubmittedRevisions[1]!.id}'
            and state='PENDING_APPROVAL'
        `),
      ).rejects.toThrow('authoritative reconciliation revision values are immutable');
      await client.unsafe('rollback to savepoint a5_same_state_lineage_mutation');
    } finally {
      await client.unsafe('rollback');
    }

    const approvalKey = `a5-return-approve-${reconciliationId}`;
    const approved = await expectOk(
      await postCommand(
        {
          commandType: 'ApproveProductionReconciliation',
          ...common,
          expectedVersion: resubmitted.version,
        },
        approvalKey,
        'a5-manager-session-token',
      ),
    );
    expect(approved.state).toBe('APPROVED');
    await expectOk(
      await postCommand(
        {
          commandType: 'ApproveProductionReconciliation',
          ...common,
          expectedVersion: resubmitted.version,
        },
        approvalKey,
        'a5-manager-session-token',
      ),
    );

    const finalRevisions = await client.unsafe<
      {
        id: string;
        revision: number;
        state: string;
        expected_sales: string;
        accounted_sales: string;
        variance: string;
        version: number;
      }[]
    >(`
      select id, revision, state, expected_sales, accounted_sales, variance, version
      from app.reconciliation_revisions
      where tenant_id='${ids.tenant}' and station_id='${ids.station}' and reconciliation_id='${reconciliationId}'
      order by revision
    `);
    expect(finalRevisions[0]).toMatchObject({
      id: firstRevision[0]!.id,
      revision: 1,
      state: 'RETURNED',
      expected_sales: '750.0000',
      accounted_sales: '750.0000',
      variance: '0.0000',
      version: 3,
    });
    expect(finalRevisions[1]).toMatchObject({
      revision: 2,
      state: 'APPROVED',
      expected_sales: '751.5000',
      accounted_sales: '751.5000',
      variance: '0.0000',
    });

    const persistedLineage = await client.unsafe<
      { source_segment_ids: string[]; meter_segment_id: string }[]
    >(`
      select revision.source_segment_ids, bridge.meter_segment_id
      from app.reconciliation_revisions revision
      join app.reconciliation_meter_reading_segments bridge
        on bridge.tenant_id=revision.tenant_id
       and bridge.station_id=revision.station_id
       and bridge.reconciliation_id=revision.reconciliation_id
       and bridge.revision_id=revision.id
      where revision.tenant_id='${ids.tenant}' and revision.station_id='${ids.station}'
        and revision.id='${finalRevisions[1]!.id}'
      order by bridge.meter_segment_id
    `);
    expect(persistedLineage).toHaveLength(segmentIds.length);
    expect(persistedLineage[0]?.source_segment_ids).toHaveLength(segmentIds.length);
    expect([...new Set(persistedLineage[0]?.source_segment_ids ?? [])].sort()).toEqual(
      [...segmentIds].sort(),
    );
    expect(persistedLineage.map((row) => row.meter_segment_id).sort()).toEqual(
      [...segmentIds].sort(),
    );

    const movements = await client.unsafe<{ count: string; quantity: string }[]>(`
      select count(*)::text as count, coalesce(sum(quantity_litres), 0)::text as quantity
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='METER_SEGMENT_SALE'
        and source_id in (
          select meter_segment_id
          from app.reconciliation_meter_reading_segments
          where reconciliation_id='${reconciliationId}'
        )
    `);
    expect(movements[0]).toEqual({ count: '2', quantity: '-501.000' });

    const auditRows = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count from platform.security_events
      where tenant_id='${ids.tenant}' and event_code='FORECOURT.InventorySalePosted'
        and details->'after'->>'reconciliationId'='${reconciliationId}'
    `);
    expect(auditRows[0]?.count).toBe('2');
  });

  it('keeps identical cost retries idempotent after sales and rejects new late receipt cost atomically', async () => {
    await expectOk(
      await postInventoryCommand(
        {
          commandType: 'RecordOpeningInventoryCost',
          tenantId: ids.tenant,
          stationId: ids.station,
          tankId: ids.tank,
          amount: '1000.0000',
          currency: 'USD',
        },
        'a5-opening-cost-after-sale',
        'a5-manager-session-token',
      ),
    );
    const before = await client.unsafe<
      { projection_version: number; quantity_litres: string; inventory_value: string | null }[]
    >(`
      select projection_version, quantity_litres, inventory_value
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.tank}' and product_id='${ids.product}'
    `);
    const historicalSale = await client.unsafe<{ effective_at: Date; business_date: string }[]>(`
      select m.effective_at, m.business_date
      from app.inventory_movements m
      join app.inventory_sale_cost_attributions a
        on a.tenant_id=m.tenant_id and a.station_id=m.station_id
       and a.inventory_movement_id=m.id
      where m.tenant_id='${ids.tenant}' and m.station_id='${ids.station}'
        and m.tank_id='${ids.tank}' and m.product_id='${ids.product}'
        and m.movement_type='SALE' and m.source_type='METER_SEGMENT_SALE'
      order by m.effective_at, m.id
      limit 1
    `);
    expect(historicalSale).toHaveLength(1);
    const lateCostEffectiveAt = new Date(
      historicalSale[0]!.effective_at.getTime() - 1,
    ).toISOString();
    const lateCostBusinessDate = historicalSale[0]!.business_date;
    const deliveryId = randomUUID();
    const allocationId = randomUUID();
    await client.unsafe(`
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date,
         note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status,
         recorded_by, confirmed_by, confirmed_at)
      values
        ('${deliveryId}', '${ids.tenant}', '${ids.station}', '${ids.product}', 'A5-DN-LATE',
         '${lateCostEffectiveAt}', '${lateCostBusinessDate}', 50, 50, 0, 'CONFIRMED',
         '${ids.supervisorMembership}', '${ids.managerMembership}', now());
      insert into app.fuel_delivery_allocations
        (id, tenant_id, station_id, delivery_id, tank_id, product_id, quantity_litres)
      values
        ('${allocationId}', '${ids.tenant}', '${ids.station}', '${deliveryId}', '${ids.tank}',
         '${ids.product}', 50);
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres,
         effective_at, business_date, source_type, source_id, actor_membership_id)
      values
        ('${randomUUID()}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}',
         'DELIVERY', 50, '${lateCostEffectiveAt}', '${lateCostBusinessDate}',
         'FUEL_DELIVERY_ALLOCATION', '${allocationId}', '${ids.managerMembership}');
    `);
    const rejected = await postInventoryCommand(
      {
        commandType: 'RecordReceiptCost',
        tenantId: ids.tenant,
        stationId: ids.station,
        allocationId,
        amount: '50.0000',
        currency: 'USD',
      },
      'a5-late-receipt-cost',
    );
    expect(rejected.status).toBe(409);
    const authority = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count
      from app.inventory_cost_events
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and event_type='RECEIPT_COST' and source_id='${allocationId}'
    `);
    expect(authority).toEqual([{ count: '0' }]);
    const after = await client.unsafe<
      { projection_version: number; quantity_litres: string; inventory_value: string | null }[]
    >(`
      select projection_version, quantity_litres, inventory_value
      from app.inventory_cost_stream_state
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and tank_id='${ids.tank}' and product_id='${ids.product}'
    `);
    expect(after).toEqual(before);

    const legacySource = await client.unsafe<
      { tank_id: string; product_id: string; effective_at: Date; business_date: string }[]
    >(`
      select tank_id, product_id, effective_at, business_date
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='METER_SEGMENT_SALE'
      order by effective_at, id
      limit 1
    `);
    await client.unsafe(`
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres,
         effective_at, business_date, source_type, source_id, actor_membership_id)
      values
        ('${randomUUID()}', '${ids.tenant}', '${ids.station}', '${legacySource[0]!.tank_id}',
         '${legacySource[0]!.product_id}', 'SALE', -1,
         '${legacySource[0]!.effective_at.toISOString()}', '${legacySource[0]!.business_date}',
         'RECONCILIATION_SALE', '${randomUUID()}', '${ids.managerMembership}')
    `);
    const legacyMovement = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='RECONCILIATION_SALE'
    `);
    expect(legacyMovement[0]?.count).toBe('1');
  });
});
