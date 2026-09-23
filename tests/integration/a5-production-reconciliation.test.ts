import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { makeSignature } from 'better-auth/crypto';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';
import { GET as reconciliationGet } from '../../src/app/api/forecourt/reconciliations/[id]/route';
import { ExactDecimal } from '../../src/platform/domain/primitives';

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
  openingSource: 'a5b00000-0000-4000-8000-000000000151',
  delivery: 'a5b00000-0000-4000-8000-000000000161',
  allocation: 'a5b00000-0000-4000-8000-000000000171',
  deliverySource: 'a5b00000-0000-4000-8000-000000000181',
  dip: 'a5b00000-0000-4000-8000-000000000191',
};

let client: Sql;

async function postCommand(
  input: Record<string, unknown>,
  key: string,
  token = 'a5-supervisor-session-token',
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

async function readReconciliation(reconciliationId: string) {
  const signedToken = `${'a5-supervisor-session-token'}.${await makeSignature('a5-supervisor-session-token', process.env.BETTER_AUTH_SECRET!)}`;
  return reconciliationGet(
    new Request(
      `http://127.0.0.1:3000/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
      { headers: { cookie: `shanda-fuel.session_token=${signedToken}` } },
    ),
    { params: Promise.resolve({ id: reconciliationId }) },
  );
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

function expectDecimalEqual(actual: string, expected: string) {
  expect(new ExactDecimal(actual).equals(new ExactDecimal(expected))).toBe(true);
}

async function createPopulatedProductionReconciliation(reconciliationId: string) {
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
        shiftId: ids.shift,
        expectedVersion: 0,
      },
      `a5-return-create-${reconciliationId}`,
    ),
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
            shiftId: ids.shift,
            openingReading: '100000.000',
            closingReading: '100500.000',
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
        payments: [{ method: 'CASH', amount: '750.0000' }],
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
        countedCash: '750.0000',
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
  return common;
}

describe('A5 production daily reconciliation persistence and approval', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a5-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a5-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A5 Reconciliation Tenant', 'a5-reconciliation-tenant')
        on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.supervisorActor}', 'A5 Supervisor', 'a5-supervisor@example.test'),
        ('${ids.managerActor}', 'A5 Manager', 'a5-manager@example.test'),
        ('${ids.attendantActor}', 'A5 Attendant', 'a5-attendant@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE'),
        ('${ids.managerMembership}', '${ids.tenant}', '${ids.managerActor}', 'ACTIVE'),
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
        values ('${ids.shift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-22T06:00:00Z', '2026-09-22T14:00:00Z', '2026-09-22')
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
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
        values ('${ids.openingSource}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'OPENING_BALANCE', 1000, '2026-09-22T05:00:00Z', '2026-09-22', 'CUTOVER', '${ids.openingSource}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.fuel_deliveries
        (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date, note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by, confirmed_by, confirmed_at)
        values ('${ids.delivery}', '${ids.tenant}', '${ids.station}', '${ids.product}', 'A5-DN-1', '2026-09-22T07:00:00Z', '2026-09-22', 500, 500, 0, 'CONFIRMED', '${ids.supervisorMembership}', '${ids.managerMembership}', now())
        on conflict (id) do nothing;
      insert into app.fuel_delivery_allocations
        (id, tenant_id, station_id, delivery_id, tank_id, product_id, quantity_litres)
        values ('${ids.allocation}', '${ids.tenant}', '${ids.station}', '${ids.delivery}', '${ids.tank}', '${ids.product}', 500)
        on conflict (id) do nothing;
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
        values ('${ids.deliverySource}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'DELIVERY', 500, '2026-09-22T07:05:00Z', '2026-09-22', 'DELIVERY', '${ids.delivery}', '${ids.managerMembership}')
        on conflict (id) do nothing;
      insert into app.tank_dips
        (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
        values ('${ids.dip}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '2026-09-22T23:00:00Z', '2026-09-22', 1000, '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values
          ('${ids.supervisorSession}', '2030-01-01T00:00:00Z', 'a5-supervisor-session-token', '${ids.supervisorActor}', true, now()),
          ('${ids.managerSession}', '2030-01-01T00:00:00Z', 'a5-manager-session-token', '${ids.managerActor}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
    `);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('creates, reloads, submits, approves, locks, and idempotently posts one A4 sale', async () => {
    const reconciliationId = randomUUID();
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
              nozzleId: ids.nozzle,
              productId: ids.product,
              shiftId: ids.shift,
              openingReading: '100000.000',
              closingReading: '100500.000',
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
    const approval = await postCommand(
      { commandType: 'ApproveProductionReconciliation', ...common, expectedVersion: 10 },
      approvalKey,
      'a5-manager-session-token',
    );
    const approvalBody = await expectOk(approval);
    expect(approvalBody.state).toBe('APPROVED');
    expect(approvalBody.saleMovementIds).toHaveLength(1);
    await expectOk(
      await postCommand(
        { commandType: 'ApproveProductionReconciliation', ...common, expectedVersion: 10 },
        approvalKey,
        'a5-manager-session-token',
      ),
    );

    const approved = await expectOk(await readReconciliation(reconciliationId));
    expect(approved.state).toBe('APPROVED');
    expect(approved.version).toBe(11);
    const lockedWrite = await postCommand(
      { commandType: 'SaveReconciliationDraft', ...common, expectedVersion: 11 },
      `a5-locked-write-${reconciliationId}`,
    );
    expect(lockedWrite.status).toBe(409);

    const rows = await client.unsafe<{ count: string; quantity: string }[]>(`
      select count(*)::text as count, coalesce(sum(quantity_litres), 0)::text as quantity
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='RECONCILIATION_SALE' and source_id in (
          select id from app.reconciliation_meter_readings where reconciliation_id='${reconciliationId}'
        )
    `);
    expect(rows[0]).toEqual({ count: '1', quantity: '-500.000' });

    const auditRows = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count from platform.security_events
      where tenant_id='${ids.tenant}' and event_code='FORECOURT.InventorySalePosted'
        and details->'after'->>'reconciliationId'='${reconciliationId}'
    `);
    expect(auditRows[0]?.count).toBe('1');
  });

  it('preserves a returned revision and approves only its corrected replacement', async () => {
    const reconciliationId = randomUUID();
    const common = await createPopulatedProductionReconciliation(reconciliationId);

    const submitted = await expectOk(
      await postCommand(
        { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 5 },
        `a5-return-submit-${reconciliationId}`,
      ),
    );
    expect(submitted.state).toBe('SUBMITTED');

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
              shiftId: ids.shift,
              openingReading: '100000.000',
              closingReading: '100501.000',
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

    const movements = await client.unsafe<{ count: string; quantity: string }[]>(`
      select count(*)::text as count, coalesce(sum(quantity_litres), 0)::text as quantity
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='RECONCILIATION_SALE' and source_id in (
          select id from app.reconciliation_meter_readings where reconciliation_id='${reconciliationId}'
        )
    `);
    expect(movements[0]).toEqual({ count: '1', quantity: '-501.000' });

    const auditRows = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count from platform.security_events
      where tenant_id='${ids.tenant}' and event_code='FORECOURT.InventorySalePosted'
        and details->'after'->>'reconciliationId'='${reconciliationId}'
    `);
    expect(auditRows[0]?.count).toBe('1');
  });
});
