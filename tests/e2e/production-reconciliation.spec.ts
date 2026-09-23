import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';

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
  tank: 'a5e00000-0000-4000-8000-000000000141',
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
      update app.shifts set state='OPEN', opened_at=coalesce(opened_at, now())
        where id='${ids.shift}';
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
      values
        ('${ids.tank}', '${ids.tenant}', '${ids.station}', 'A5E2E-D1', '${ids.product}', 10000, 500, 10, 'ACTIVE', '${ids.supervisorMembership}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into auth.session
        (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
      values
        ('${ids.supervisorSession}', '2030-01-01T00:00:00Z', '${supervisorToken}', '${ids.supervisorActor}', true, now()),
        ('${ids.managerSession}', '2030-01-01T00:00:00Z', '${managerToken}', '${ids.managerActor}', true, now())
        on conflict (id) do update set expires_at=excluded.expires_at, strong_authentication_verified=true;
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

  test('persists through refresh, submits, approves, locks, and rejects edits', async ({
    context,
    page,
  }) => {
    const reconciliationId = crypto.randomUUID();
    const query = new URLSearchParams({
      tenantId: ids.tenant,
      businessDayId: ids.day,
      shiftId: ids.shift,
      reconciliationId,
    });
    const supervisorUrl = `/stations/${ids.station}/reconciliations/new?${query}`;
    const reviewUrl = `/stations/${ids.station}/reconciliations/${reconciliationId}/review?${query.toString().replace(`reconciliationId=${reconciliationId}&`, '')}`;

    await authenticate(context, supervisorToken);
    await page.goto(supervisorUrl);
    await page.getByRole('button', { name: 'Create draft' }).click();
    const persistedAfterCreate = await page.request.get(
      `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
    );
    expect(persistedAfterCreate.ok(), await persistedAfterCreate.text()).toBe(true);
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
            shiftId: ids.shift,
            openingReading: '100000.000',
            closingReading: '100500.000',
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
    await expect(page.getByText('750', { exact: true }).first()).toBeVisible();
    await page.getByLabel('Cash counted').fill('750.0000');
    await page.getByRole('button', { name: 'Save persisted draft' }).click();
    await expect(page.getByLabel('Cash counted')).toHaveValue(/750/);

    await page.getByRole('button', { name: 'Submit for management review' }).click();
    await expect(page.getByText('SUBMITTED', { exact: true })).toBeVisible();

    await authenticate(context, managerToken);
    await page.goto(reviewUrl);
    await expect(page.getByText('SUBMITTED', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Approve and lock' }).click();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Approved records are locked. Further changes require a named correction workflow.',
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

    const movements = await client.unsafe<{ count: string; quantity: string }[]>(`
      select count(*)::text as count, coalesce(sum(quantity_litres), 0)::text as quantity
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='RECONCILIATION_SALE' and source_id in (
          select id from app.reconciliation_meter_readings where reconciliation_id='${reconciliationId}'
        )
    `);
    expect(movements[0]).toEqual({ count: '1', quantity: '-500.000' });
  });
});
