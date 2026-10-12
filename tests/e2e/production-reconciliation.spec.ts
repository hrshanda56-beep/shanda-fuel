import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';
import { ExactDecimal } from '../../src/platform/domain/primitives';

const databaseUrl = process.env.DATABASE_URL;

const ids = {
  tenant: 'a5e00000-0000-4000-8000-000000000001',
  legal: 'a5e00000-0000-4000-8000-000000000011',
  station: 'a5e00000-0000-4000-8000-000000000021',
  supervisorActor: 'a5e00000-0000-4000-8000-000000000031',
  supervisorMembership: 'a5e00000-0000-4000-8000-000000000041',
  supervisorSession: 'a5e00000-0000-4000-8000-000000000051',
  managerActor: 'a5e00000-0000-4000-8000-000000000032',
  managerMembership: 'a5e00000-0000-4000-8000-000000000042',
  managerSession: 'a5e00000-0000-4000-8000-000000000052',
  product: 'a5e00000-0000-4000-8000-000000000061',
  pump: 'a5e00000-0000-4000-8000-000000000071',
  nozzle: 'a5e00000-0000-4000-8000-000000000081',
  meter: 'a5e00000-0000-4000-8000-000000000091',
  installation: 'a5e00000-0000-4000-8000-000000000101',
  price: 'a5e00000-0000-4000-8000-000000000111',
  day: 'a5e00000-0000-4000-8000-000000000121',
  shift: 'a5e00000-0000-4000-8000-000000000131',
  retryShift: 'a5e00000-0000-4000-8000-000000000132',
  retryShiftTwo: 'a5e00000-0000-4000-8000-000000000133',
  retryShiftThree: 'a5e00000-0000-4000-8000-000000000134',
  a11RetryShift: 'a5e00000-0000-4000-8000-000000000135',
  a11RetryShiftTwo: 'a5e00000-0000-4000-8000-000000000136',
  a11RetryShiftThree: 'a5e00000-0000-4000-8000-000000000137',
  controlRoomShift: 'a5e00000-0000-4000-8000-000000000138',
  tank: 'a5e00000-0000-4000-8000-000000000141',
  openingSource: 'a5e00000-0000-4000-8000-000000000151',
  openingCostEvent: 'a5e00000-0000-4000-8000-000000000152',
};

const supervisorToken = 'a5e-supervisor-session-token';
const managerToken = 'a5e-manager-session-token';

test.describe('production reconciliation persistence', () => {
  test.skip(!databaseUrl, 'production persistence E2E requires CI PostgreSQL');
  test.describe.configure({ mode: 'serial' });

  let client: Sql;

  test.beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A5 E2E Tenant', 'a5-e2e-tenant')
        on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.supervisorActor}', 'A5 E2E Supervisor', 'a5e-supervisor@example.test'),
        ('${ids.managerActor}', 'A5 E2E Manager', 'a5e-manager@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE'),
        ('${ids.managerMembership}', '${ids.tenant}', '${ids.managerActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A5 E2E Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A5E2E', 'A5 E2E Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.supervisorMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.managerMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.product}', '${ids.tenant}', 'A5E2E-DIESEL', 'A5 E2E Diesel') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number, status)
        values ('${ids.pump}', '${ids.tenant}', '${ids.station}', '1', 'ACTIVE') on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
        values ('${ids.nozzle}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '1', '${ids.product}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values ('${ids.meter}', '${ids.tenant}', 'A5E2E-METER-1') on conflict (id) do nothing;
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
      values
        ('${ids.installation}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.meter}', '2020-01-01T00:00:00Z', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
      values
        ('${ids.price}', '${ids.tenant}', '${ids.station}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
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
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-09-23', 'NOT_STARTED')
        on conflict (id) do nothing;
      update app.station_business_days set state='OPEN', opened_at=coalesce(opened_at, now())
        where id='${ids.day}';
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.shift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T06:00:00Z', '2026-09-23T14:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.retryShift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T14:00:00Z', '2026-09-23T22:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.retryShiftTwo}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T22:00:00Z', '2026-09-24T06:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.retryShiftThree}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T22:00:00Z', '2026-09-24T06:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.a11RetryShift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T06:00:00Z', '2026-09-23T14:00:00Z', '2026-09-23'),
        ('${ids.a11RetryShiftTwo}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T14:00:00Z', '2026-09-23T22:00:00Z', '2026-09-23'),
        ('${ids.a11RetryShiftThree}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T22:00:00Z', '2026-09-24T06:00:00Z', '2026-09-23'),
        ('${ids.controlRoomShift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T14:00:00Z', '2026-09-23T22:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      update app.shifts set state='OPEN', opened_at=coalesce(opened_at, now())
        where id in ('${ids.shift}', '${ids.retryShift}', '${ids.retryShiftTwo}', '${ids.retryShiftThree}', '${ids.a11RetryShift}', '${ids.a11RetryShiftTwo}', '${ids.a11RetryShiftThree}', '${ids.controlRoomShift}');
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
      values
        ('${ids.tank}', '${ids.tenant}', '${ids.station}', 'A5E2E-D1', '${ids.product}', 10000, 500, 10, 'ACTIVE', '${ids.supervisorMembership}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values
        ('${ids.openingSource}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'OPENING_BALANCE', 3000, '2026-09-22T05:00:00Z', '2026-09-22', 'CUTOVER', '${ids.openingSource}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.inventory_cost_events
        (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at, business_date, amount, currency, actor_membership_id)
      values
        ('${ids.openingCostEvent}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'OPENING_COST', 'CUTOVER', '${ids.openingSource}', '2026-09-22T05:00:00Z', '2026-09-22', 3000.0000, 'USD', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into auth.session
        (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at,
         strong_authentication_expires_at, step_up_level, step_up_expires_at, step_up_tenant_id)
      values
        ('${ids.supervisorSession}', '2030-01-01T00:00:00Z', '${supervisorToken}', '${ids.supervisorActor}', true, now(), null, null, null, null),
        ('${ids.managerSession}', '2030-01-01T00:00:00Z', '${managerToken}', '${ids.managerActor}', true, now(), '2030-01-01T00:00:00Z', 1, '2030-01-01T00:00:00Z', '${ids.tenant}')
        on conflict (id) do update set
          expires_at=excluded.expires_at,
          strong_authentication_verified=excluded.strong_authentication_verified,
          strong_authenticated_at=excluded.strong_authenticated_at,
          strong_authentication_expires_at=excluded.strong_authentication_expires_at,
          step_up_level=excluded.step_up_level,
          step_up_expires_at=excluded.step_up_expires_at,
          step_up_tenant_id=excluded.step_up_tenant_id;
    `);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  async function signedCookie(token: string) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error('BETTER_AUTH_SECRET is required for production E2E');
    return `${token}.${await makeSignature(token, secret)}`;
  }

  async function authenticate(context: BrowserContext, token: string) {
    await context.clearCookies();
    await context.addCookies([
      {
        name: 'shanda-fuel.session_token',
        value: await signedCookie(token),
        domain: '127.0.0.1',
        path: '/',
      },
    ]);
  }

  async function command(request: APIRequestContext, input: Record<string, unknown>, key: string) {
    const response = await request.post('/api/forecourt/commands', {
      data: input,
      headers: { 'idempotency-key': key },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json() as Promise<{ version?: number; state?: string }>;
  }

  async function prepareFixtureShift(shiftId: string) {
    const rows = await client.unsafe<{ planned_start_at: Date; planned_end_at: Date }[]>(`
      update app.shifts as fixture_shift
      set planned_start_at = database_clock.current_time - interval '5 minutes',
          planned_end_at = database_clock.current_time + interval '15 minutes'
      from (select clock_timestamp() as current_time) as database_clock
      where fixture_shift.tenant_id='${ids.tenant}'
        and fixture_shift.station_id='${ids.station}'
        and fixture_shift.id='${shiftId}'
        and fixture_shift.state='OPEN'
      returning fixture_shift.planned_start_at, fixture_shift.planned_end_at
    `);
    expect(rows).toHaveLength(1);
    const shift = rows[0];
    if (!shift) throw new Error(`Fixture shift ${shiftId} was not updated`);
    return shift;
  }

  async function createSealedSegmentEvidence(
    request: APIRequestContext,
    shiftId: string,
    keyPrefix: string,
    shiftInterval: { planned_start_at: Date; planned_end_at: Date },
  ) {
    const priorReadingRows = await client.unsafe<{ reading_value: string }[]>(`
      select reading_value
      from app.meter_boundaries
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and nozzle_id='${ids.nozzle}' and meter_installation_id='${ids.installation}'
        and reading_status='AVAILABLE'
      order by effective_at desc, id desc
      limit 1
    `);
    const openingReading = priorReadingRows[0]?.reading_value ?? '100000.000';
    const closingReading = new ExactDecimal(openingReading)
      .add(new ExactDecimal('500.000'))
      .toString();
    const openingBoundaryId = randomUUID();
    const closingBoundaryId = randomUUID();
    const segmentId = randomUUID();

    await command(
      request,
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.station,
        boundaryId: openingBoundaryId,
        nozzleId: ids.nozzle,
        meterInstallationId: ids.installation,
        businessDayId: ids.day,
        shiftId,
        responsibleAttendantId: ids.supervisorMembership,
        reason: 'SHIFT_OPEN',
        readingStatus: 'AVAILABLE',
        readingValue: openingReading,
        exceptionReason: 'A12.1 Playwright canonical opening evidence',
        expectedVersion: 0,
      },
      `${keyPrefix}-opening-${openingBoundaryId}`,
    );
    await client.unsafe('select pg_sleep(0.01)');
    await command(
      request,
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.station,
        boundaryId: closingBoundaryId,
        nozzleId: ids.nozzle,
        meterInstallationId: ids.installation,
        businessDayId: ids.day,
        shiftId,
        responsibleAttendantId: ids.supervisorMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: closingReading,
        expectedVersion: 0,
      },
      `${keyPrefix}-closing-${closingBoundaryId}`,
    );
    const boundaryRows = await client.unsafe<{ id: string; effective_at: Date }[]>(`
      select id, effective_at
      from app.meter_boundaries
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and id in ('${openingBoundaryId}', '${closingBoundaryId}')
      order by effective_at, id
    `);
    expect(boundaryRows).toHaveLength(2);
    const openingBoundary = boundaryRows.find((boundary) => boundary.id === openingBoundaryId);
    const closingBoundary = boundaryRows.find((boundary) => boundary.id === closingBoundaryId);
    if (!openingBoundary || !closingBoundary) {
      throw new Error('The canonical boundary evidence could not be reloaded');
    }
    expect(openingBoundary.effective_at.getTime()).toBeLessThan(
      closingBoundary.effective_at.getTime(),
    );
    expect(openingBoundary.effective_at.getTime()).toBeGreaterThanOrEqual(
      shiftInterval.planned_start_at.getTime(),
    );
    expect(closingBoundary.effective_at.getTime()).toBeLessThanOrEqual(
      shiftInterval.planned_end_at.getTime(),
    );
    await command(
      request,
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.station,
        segmentId,
        nozzleId: ids.nozzle,
        meterInstallationId: ids.installation,
        businessDayId: ids.day,
        shiftId,
        openingBoundaryId,
        closingBoundaryId,
        productId: ids.product,
        responsibleAttendantId: ids.supervisorMembership,
        startAt: openingBoundary.effective_at.toISOString(),
        endAt: closingBoundary.effective_at.toISOString(),
        expectedVersion: 0,
      },
      `${keyPrefix}-segment-${segmentId}`,
    );

    return { openingReading, closingReading, segmentId };
  }

  test('A11 control room exposes authorized actions, station time, restricted audit, and mobile keyboard access', async ({
    context,
    page,
  }) => {
    // beforeAll intentionally preserves existing rows on conflict. Restore this
    // fixed shift because the reconciliation scenario retimes it around now().
    await client.unsafe(`
      update app.shifts
      set planned_start_at = '2026-09-23T06:00:00Z',
          planned_end_at = '2026-09-23T14:00:00Z'
      where tenant_id = '${ids.tenant}'
        and station_id = '${ids.station}'
        and id = '${ids.shift}'
    `);
    await authenticate(context, supervisorToken);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/operations/daily?${new URLSearchParams({
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: ids.day,
      })}`,
    );

    const controlRoom = page.locator('[aria-label="Operations control room"]');
    // This scenario runs with CI's Better Auth provider. Rendering the control
    // room must not require a ClerkProvider or crash before its content loads.
    await expect(controlRoom).toBeVisible();
    await expect(controlRoom.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible();
    await expect(controlRoom.getByRole('button', { name: 'Close meters' }).first()).toBeVisible();
    await expect(controlRoom.getByRole('button', { name: 'Lock business day' })).toHaveCount(0);
    await expect(controlRoom.getByText('Audit history restricted')).toBeVisible();
    await expect(
      controlRoom
        .locator('article.operations-shift-row strong')
        .filter({
          hasText: '08:00 – 16:00',
        })
        .first(),
    ).toBeVisible();

    const closeMeters = controlRoom.getByRole('button', { name: 'Close meters' }).first();
    await closeMeters.focus();
    await expect(closeMeters).toBeFocused();

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.documentWidth).toBe(layout.viewportWidth);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('A11 control room refreshes and explains a stale shift action without retrying it', async ({
    context,
    page,
  }) => {
    await authenticate(context, supervisorToken);
    await page.goto(
      `/operations/daily?${new URLSearchParams({
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: ids.day,
      })}`,
    );

    const shiftRow = page
      // The approved layout no longer prints raw shift ids; rows carry data-shift-id.
      .locator(`article.operations-shift-row[data-shift-id="${ids.controlRoomShift}"]`);
    const closeMeters = shiftRow.getByRole('button', { name: 'Close meters' });
    await expect(closeMeters).toBeVisible();
    await client.unsafe(
      `update app.shifts set version = version + 1 where id = '${ids.controlRoomShift}'`,
    );

    page.once('dialog', (dialog) => void dialog.accept());
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/forecourt/commands') &&
        response.request().method() === 'POST',
    );
    await closeMeters.click();
    const response = await responsePromise;
    expect(response.status()).toBe(409);
    await expect(page.getByRole('heading', { name: 'State changed' })).toBeVisible();
    await expect(
      page.getByText(/authoritative state has been refreshed; review it before trying again/i),
    ).toBeVisible();
  });

  test('persists through refresh, submits, approves, and rejects edits after production approval', async ({
    context,
    page,
  }, testInfo) => {
    const activeShiftId =
      [ids.shift, ids.retryShift, ids.retryShiftTwo, ids.retryShiftThree][testInfo.retry] ??
      ids.retryShiftThree;
    const reconciliationId = crypto.randomUUID();
    const query = new URLSearchParams({
      tenantId: ids.tenant,
      businessDayId: ids.day,
      shiftId: activeShiftId,
      reconciliationId,
    });
    const supervisorUrl = `/stations/${ids.station}/reconciliations/new?${query}`;
    const reviewUrl = `/stations/${ids.station}/reconciliations/${reconciliationId}/review?${query.toString().replace(`reconciliationId=${reconciliationId}&`, '')}`;

    await authenticate(context, supervisorToken);
    const shiftInterval = await prepareFixtureShift(activeShiftId);
    const sealedEvidence = await createSealedSegmentEvidence(
      page.request,
      activeShiftId,
      `a5e-${reconciliationId}`,
      shiftInterval,
    );
    await page.goto(supervisorUrl);
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/forecourt/commands') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create draft' }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    await expect
      .poll(
        async () =>
          (
            await page.request.get(
              `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
            )
          ).status(),
        { timeout: 10_000 },
      )
      .toBe(200);
    await page.reload();
    await expect(
      page.locator('[aria-label="Production daily reconciliation workflow"]'),
    ).toBeVisible();

    const common = {
      tenantId: ids.tenant,
      stationId: ids.station,
      reconciliationId,
    };
    await command(
      page.request,
      {
        commandType: 'SaveMeterReadings',
        ...common,
        expectedVersion: 0,
        readings: [
          {
            nozzleId: ids.nozzle,
            productId: ids.product,
            shiftId: activeShiftId,
            openingReading: sealedEvidence.openingReading,
            closingReading: sealedEvidence.closingReading,
            sellingPriceId: ids.price,
          },
        ],
      },
      `a5e-readings-${reconciliationId}`,
    );
    await command(
      page.request,
      {
        commandType: 'SavePaymentAllocations',
        ...common,
        expectedVersion: 1,
        payments: [{ method: 'CASH', amount: '750.0000' }],
      },
      `a5e-payments-${reconciliationId}`,
    );
    await command(
      page.request,
      { commandType: 'SaveExpenses', ...common, expectedVersion: 2, expenses: [] },
      `a5e-expenses-${reconciliationId}`,
    );

    await page.reload();
    await expect(page.getByText('500.000', { exact: true })).toBeVisible();
    await expect(page.getByText(/750(?:\.0+)? USD/).first()).toBeVisible();
    await page.getByLabel('Cash counted').fill('750.0000');
    await page.getByRole('button', { name: 'Save persisted draft' }).click();
    await expect(page.getByLabel('Cash counted')).toHaveValue(/750/);

    await page.getByRole('button', { name: 'Submit for management review' }).click();
    await expect(page.getByText('SUBMITTED', { exact: true })).toBeVisible();

    await authenticate(context, managerToken);
    await page.goto(reviewUrl);
    await expect(page.getByText('SUBMITTED', { exact: true })).toBeVisible();
    const approveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/forecourt/commands') &&
        response.request().method() === 'POST',
    );
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Approve production reconciliation' }).click();
    const approveResponse = await approveResponsePromise;
    expect(approveResponse.ok(), await approveResponse.text()).toBe(true);
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
          );
          return ((await response.json()) as { state: string }).state;
        },
        { timeout: 10_000 },
      )
      .toBe('APPROVED');
    await page.reload();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Approved records have posted canonical sale evidence. Further changes require a named correction workflow.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save persisted draft' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit for management review' })).toHaveCount(0);
    await expect(page.getByLabel('Cash counted')).toBeDisabled();
    await expect(page.getByLabel('Variance explanation')).toBeDisabled();
    const accessibility = await new AxeBuilder({ page })
      .include('[aria-label="Production daily reconciliation workflow"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);

    const approvedRead = await page.request.get(
      `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
    );
    const approvedBody = (await approvedRead.json()) as { version: number; state: string };
    expect(approvedBody.state).toBe('APPROVED');

    await authenticate(context, supervisorToken);
    const lockedWrite = await page.request.post('/api/forecourt/commands', {
      data: {
        commandType: 'SaveReconciliationDraft',
        ...common,
        expectedVersion: approvedBody.version,
      },
      headers: { 'idempotency-key': `a5e-locked-write-${reconciliationId}` },
    });
    expect(lockedWrite.status()).toBe(409);
    expect((await lockedWrite.json()).error).toBe('CONFLICT');

    const movements = await client.unsafe<
      { source_type: string; source_id: string; movement_type: string; quantity_litres: string }[]
    >(`
      select source_type, source_id, movement_type, quantity_litres::text as quantity_litres
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='METER_SEGMENT_SALE' and source_id='${sealedEvidence.segmentId}'
    `);
    expect(movements).toEqual([
      {
        source_type: 'METER_SEGMENT_SALE',
        source_id: sealedEvidence.segmentId,
        movement_type: 'SALE',
        quantity_litres: '-500.000',
      },
    ]);
  });

  test('A11 workspace captures representative evidence, requires a return reason, and approves production evidence', async ({
    context,
    page,
  }, testInfo) => {
    const activeShiftId =
      [ids.a11RetryShift, ids.a11RetryShiftTwo, ids.a11RetryShiftThree][testInfo.retry] ??
      ids.a11RetryShiftThree;
    const query = new URLSearchParams({
      tenantId: ids.tenant,
      stationId: ids.station,
      businessDayId: ids.day,
      shiftId: activeShiftId,
    });

    await authenticate(context, supervisorToken);
    const shiftInterval = await prepareFixtureShift(activeShiftId);
    const sealedEvidence = await createSealedSegmentEvidence(
      page.request,
      activeShiftId,
      `a11-${randomUUID()}`,
      shiftInterval,
    );
    await page.goto(`/operations/daily?${query.toString()}`);
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/forecourt/commands') &&
        response.request().method() === 'POST' &&
        response.request().postData()?.includes('CreateProductionReconciliation') === true,
    );
    await page.getByRole('button', { name: 'Create daily draft' }).click();
    const createResponse = await createResponsePromise;
    const createResponseText = await createResponse.text();

    expect(
      createResponse.ok(),
      `CreateProductionReconciliation failed: ${createResponse.status()} ${createResponseText}`,
    ).toBe(true);

    const createRequestText = createResponse.request().postData();

    if (!createRequestText) {
      throw new Error('CreateProductionReconciliation request body was unavailable');
    }

    const createRequest = JSON.parse(createRequestText) as {
      commandType?: string;
      reconciliationId?: string;
    };

    expect(createRequest.commandType).toBe('CreateProductionReconciliation');

    if (!createRequest.reconciliationId) {
      throw new Error('CreateProductionReconciliation request did not contain reconciliationId');
    }

    const reconciliationId = createRequest.reconciliationId;

    await expect
      .poll(() => new URL(page.url()).searchParams.get('reconciliationId'), {
        message: 'Daily operations workspace did not persist created reconciliationId in the URL',
        timeout: 5000,
      })
      .toBe(reconciliationId);

    await expect(page.getByRole('heading', { name: 'Daily operations' })).toBeVisible();

    const common = {
      tenantId: ids.tenant,
      stationId: ids.station,
      reconciliationId,
    };

    await page.locator('input[id^="opening-"]').first().fill(sealedEvidence.openingReading);
    await page.locator('input[id^="closing-"]').first().fill(sealedEvidence.closingReading);
    await page.getByRole('button', { name: 'Add payment evidence' }).click();
    await page.locator('input[id^="payment-amount-"]').first().fill('750.0000');
    await page.getByLabel('Counted cash').fill('750.0000');
    await page.getByRole('button', { name: 'Save persisted draft' }).click();
    await expect(page.getByText('Draft saved to the server.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Counted cash')).toHaveValue(/750/);
    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/forecourt/commands') &&
        response.request().method() === 'POST' &&
        response.request().postData()?.includes('SubmitProductionReconciliation') === true,
    );
    await page.getByRole('button', { name: 'Submit for management review' }).click();
    const submitResponse = await submitResponsePromise;
    const submitResponseText = await submitResponse.text();
    const submitRequestText = submitResponse.request().postData();

    if (!submitRequestText) {
      throw new Error('SubmitProductionReconciliation request body was unavailable');
    }

    const submitRequest = JSON.parse(submitRequestText) as { reconciliationId?: string };

    expect(submitRequest.reconciliationId).toBe(reconciliationId);

    expect(
      submitResponse.ok(),
      `SubmitProductionReconciliation failed: ${submitResponse.status()} ${submitResponseText}`,
    ).toBe(true);

    const submittedRecordResponse = await page.request.get(
      `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
    );
    const submittedRecordText = await submittedRecordResponse.text();

    expect(
      submittedRecordResponse.ok(),
      `submitted reconciliation read failed: ${submittedRecordResponse.status()} ${submittedRecordText}`,
    ).toBe(true);

    const submittedRecord = JSON.parse(submittedRecordText) as { state: string; version: number };

    expect(submittedRecord.state).toBe('SUBMITTED');
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();

    await authenticate(context, managerToken);
    await page.goto(`/operations/reconciliations/${reconciliationId}/review?${query.toString()}`);
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return for correction' })).toBeDisabled();
    await page.getByLabel('Return reason').fill('Meter evidence requires supervisor correction.');
    await page.getByRole('button', { name: 'Return for correction' }).click();
    await expect(page.getByText('Returned', { exact: true })).toBeVisible();

    await authenticate(context, supervisorToken);
    await page.goto(`/operations/reconciliations/${reconciliationId}?${query.toString()}`);
    await expect(page.getByText('Returned', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Submit for management review' }).click();
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
    const submittedResponse = await page.request.get(
      `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
    );
    const submittedBody = (await submittedResponse.json()) as { version: number };
    const unauthorizedApproval = await page.request.post('/api/forecourt/commands', {
      data: {
        commandType: 'ApproveProductionReconciliation',
        ...common,
        expectedVersion: submittedBody.version,
      },
      headers: { 'idempotency-key': `a11-unauthorized-approve-${reconciliationId}` },
    });
    expect(unauthorizedApproval.status()).toBe(403);

    await authenticate(context, managerToken);
    await page.goto(`/operations/reconciliations/${reconciliationId}/review?${query.toString()}`);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Approve production reconciliation' }).click();
    await expect(page.getByText('Approved', { exact: true })).toBeVisible();
    await expect(page.getByText(/Canonical sale evidence has been posted/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save persisted draft' })).toBeDisabled();
    const accessibility = await new AxeBuilder({ page })
      .include('[aria-label="Daily station operations workspace"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });
});
