import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';
import { POST as customerCommandPost } from '../../src/app/api/customers/commands/route';
import { GET as customerStatementGet } from '../../src/app/api/customers/statement/route';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';
import { POST as inventoryCommandPost } from '../../src/app/api/inventory/commands/route';
import { postInventoryMovementInTransaction } from '../../src/modules/inventory/persistence';
import { createTrustedTenantTransactionContext } from '../../src/platform/db/tenant-context';
import { withTenantTransaction } from '../../src/platform/db/transaction';
import { seedActiveStepUp } from './auth-session-fixtures';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A8 customer-account integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const ids = {
  tenant: 'a8b00000-0000-4000-8000-000000000001',
  legal: 'a8b00000-0000-4000-8000-000000000011',
  station: 'a8b00000-0000-4000-8000-000000000021',
  product: 'a8b00000-0000-4000-8000-000000000301',
  pump: 'a8b00000-0000-4000-8000-000000000302',
  nozzle: 'a8b00000-0000-4000-8000-000000000303',
  meter: 'a8b00000-0000-4000-8000-000000000304',
  installation: 'a8b00000-0000-4000-8000-000000000305',
  price: 'a8b00000-0000-4000-8000-000000000306',
  tank: 'a8b00000-0000-4000-8000-000000000307',
  openingSource: 'a8b00000-0000-4000-8000-000000000312',
  shift: 'a8b00000-0000-4000-8000-000000000308',
  openingBoundary: 'a8b00000-0000-4000-8000-000000000309',
  closingBoundary: 'a8b00000-0000-4000-8000-000000000310',
  segment: 'a8b00000-0000-4000-8000-000000000311',
  businessDay: 'a8b00000-0000-4000-8000-000000000401',
  reconciliation: 'a8b00000-0000-4000-8000-000000000402',
  revision: 'a8b00000-0000-4000-8000-000000000403',
  creditPayment: 'a8b00000-0000-4000-8000-000000000404',
  actor: 'a8b00000-0000-4000-8000-000000000031',
  membership: 'a8b00000-0000-4000-8000-000000000041',
  session: 'a8b00000-0000-4000-8000-000000000051',
};

let client: Sql;

async function signedCookie(token: string): Promise<string> {
  return `${token}.${await makeSignature(token, process.env.BETTER_AUTH_SECRET!)}`;
}

async function command(input: Record<string, unknown>, key: string) {
  return customerCommandPost(
    new Request('http://127.0.0.1:3000/api/customers/commands', {
      method: 'POST',
      headers: {
        cookie: `shanda-fuel.session_token=${await signedCookie('a8-session-token')}`,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function forecourtCommand(input: Record<string, unknown>, key: string) {
  return forecourtCommandPost(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      method: 'POST',
      headers: {
        cookie: `shanda-fuel.session_token=${await signedCookie('a8-session-token')}`,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function inventoryCommand(input: Record<string, unknown>, key: string) {
  return inventoryCommandPost(
    new Request('http://127.0.0.1:3000/api/inventory/commands', {
      method: 'POST',
      headers: {
        cookie: `shanda-fuel.session_token=${await signedCookie('a8-session-token')}`,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function body(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

async function expectForecourtOk(response: Response) {
  return expectForecourtStatus(response, 200);
}

async function expectForecourtStatus(response: Response, expectedStatus: number) {
  const result = await body(response);
  expect(response.status, JSON.stringify(result)).toBe(expectedStatus);
  return result;
}

async function createPostedA5Evidence() {
  await expectForecourtStatus(
    await forecourtCommand(
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.station,
        segmentId: ids.segment,
        nozzleId: ids.nozzle,
        meterInstallationId: ids.installation,
        businessDayId: ids.businessDay,
        shiftId: ids.shift,
        openingBoundaryId: ids.openingBoundary,
        closingBoundaryId: ids.closingBoundary,
        productId: ids.product,
        responsibleAttendantId: ids.membership,
        startAt: '2026-09-24T06:00:00.000Z',
        endAt: '2026-09-24T07:00:00.000Z',
        expectedVersion: 0,
      },
      'a8-a5-seal-segment',
    ),
    201,
  );
  await expectForecourtOk(
    await forecourtCommand(
      {
        commandType: 'CloseMeters',
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: ids.businessDay,
        shiftId: ids.shift,
        expectedVersion: 0,
      },
      'a8-a5-close-meters',
    ),
  );
  await expectForecourtOk(
    await forecourtCommand(
      {
        commandType: 'CompleteShift',
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: ids.businessDay,
        shiftId: ids.shift,
        expectedVersion: 1,
      },
      'a8-a5-complete-shift',
    ),
  );
  await client.unsafe(`
    insert into app.reconciliations
      (id, tenant_id, station_id, business_day_id, shift_id, supervisor_id, created_by, state, version)
      values ('${ids.reconciliation}', '${ids.tenant}', '${ids.station}', '${ids.businessDay}', '${ids.shift}', '${ids.membership}', '${ids.membership}', 'DRAFT', 0)
      on conflict (id) do nothing;
    insert into app.reconciliation_revisions
      (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance,
       currency, variance_classification, source_segment_ids, source_shift_ids, version)
      values ('${ids.revision}', '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', 1, 'READY', 0, 0, 0,
       'USD', 'INFORMATIONAL', '["${ids.segment}"]'::jsonb, '["${ids.shift}"]'::jsonb, 0)
      on conflict (id) do nothing;
  `);
  const common = {
    tenantId: ids.tenant,
    stationId: ids.station,
    reconciliationId: ids.reconciliation,
  };
  await expectForecourtOk(
    await forecourtCommand(
      {
        commandType: 'SaveMeterReadings',
        ...common,
        expectedVersion: 0,
        readings: [
          {
            nozzleId: ids.nozzle,
            productId: ids.product,
            shiftId: ids.shift,
            openingReading: '100.000',
            closingReading: '120.000',
            sellingPriceId: ids.price,
          },
        ],
      },
      'a8-a5-readings',
    ),
  );
  await expectForecourtOk(
    await forecourtCommand(
      {
        commandType: 'SavePaymentAllocations',
        ...common,
        expectedVersion: 1,
        payments: [{ id: ids.creditPayment, method: 'CUSTOMER_CREDIT', amount: '50.0000' }],
      },
      'a8-a5-payments',
    ),
  );
  await expectForecourtOk(
    await forecourtCommand(
      { commandType: 'SaveExpenses', ...common, expectedVersion: 2, expenses: [] },
      'a8-a5-expenses',
    ),
  );
  await expectForecourtOk(
    await forecourtCommand(
      { commandType: 'SaveCashDeclaration', ...common, expectedVersion: 3, countedCash: '0.0000' },
      'a8-a5-cash',
    ),
  );
  await expectForecourtOk(
    await forecourtCommand(
      { commandType: 'SaveVarianceExplanations', ...common, expectedVersion: 4, explanations: {} },
      'a8-a5-explanations',
    ),
  );
  await expectForecourtOk(
    await forecourtCommand(
      { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 5 },
      'a8-a5-submit',
    ),
  );
  await expectForecourtOk(
    await forecourtCommand(
      { commandType: 'ApproveProductionReconciliation', ...common, expectedVersion: 6 },
      'a8-a5-approve',
    ),
  );
  await expectForecourtOk(
    await forecourtCommand(
      {
        commandType: 'PostReconciliation',
        tenantId: ids.tenant,
        stationId: ids.station,
        revisionId: ids.revision,
        expectedVersion: 3,
      },
      'a8-a5-post',
    ),
  );
}

describe('A8 customer accounts PostgreSQL persistence', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a8-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a8-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'A8 Customer Tenant', 'a8-customer-tenant') on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values ('${ids.actor}', 'A8 Finance', 'a8-finance@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${ids.legal}', '${ids.tenant}', 'A8 Customer Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A8CUSTOMER', 'A8 Customer Station', 'ACTIVE') on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name, status) values ('${ids.product}', '${ids.tenant}', 'A8-PETROL', 'A8 Petrol', 'ACTIVE') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number, status)
        values ('${ids.pump}', '${ids.tenant}', '${ids.station}', '1', 'ACTIVE') on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
        values ('${ids.nozzle}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '1', '${ids.product}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values ('${ids.meter}', '${ids.tenant}', 'A8-METER-1') on conflict (id) do nothing;
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values ('${ids.installation}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.meter}', '2020-01-01T00:00:00Z', '${ids.membership}') on conflict (id) do nothing;
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
        values ('${ids.price}', '${ids.tenant}', '${ids.station}', '${ids.product}', '2020-01-01T00:00:00Z', 2.500000, 'DRAFT', '${ids.membership}') on conflict (id) do nothing;
      update app.selling_prices set state='PENDING_APPROVAL'
        where id='${ids.price}' and state='DRAFT';
      update app.selling_prices set state='APPROVED', approved_by='${ids.membership}', approved_at=now()
        where id='${ids.price}' and state='PENDING_APPROVAL';
      update app.selling_prices set state='PENDING_STATION_ACTIVATION'
        where id='${ids.price}' and state='APPROVED';
      update app.selling_prices set state='BOUNDARIES_IN_PROGRESS'
        where id='${ids.price}' and state='PENDING_STATION_ACTIVATION';
      update app.selling_prices set state='ACTIVE', activated_at=now()
        where id='${ids.price}' and state='BOUNDARIES_IN_PROGRESS';
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
        values ('${ids.tank}', '${ids.tenant}', '${ids.station}', 'A8-P1', '${ids.product}', 10000, 500, 10, 'ACTIVE', '${ids.membership}', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.businessDay}', '${ids.tenant}', '${ids.station}', '2026-09-24', 'NOT_STARTED') on conflict (id) do nothing;
      update app.station_business_days set state='OPEN', opened_at=now()
        where id='${ids.businessDay}' and state='NOT_STARTED';
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
        values ('${ids.shift}', '${ids.tenant}', '${ids.station}', '${ids.businessDay}', 'PLANNED', '2026-09-24T06:00:00Z', '2026-09-24T14:00:00Z', '2026-09-24')
        on conflict (id) do nothing;
      update app.shifts set state='OPEN', opened_at=now()
        where id='${ids.shift}' and state='PLANNED';
      insert into app.meter_boundaries
        (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
        values
          ('${ids.openingBoundary}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.installation}', '${ids.businessDay}', '${ids.shift}', 'SHIFT_OPEN', 'AVAILABLE', 100.000, '2026-09-24T06:00:00Z', '2026-09-24T06:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}'),
          ('${ids.closingBoundary}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.installation}', '${ids.businessDay}', '${ids.shift}', 'SHIFT_CLOSE', 'AVAILABLE', 120.000, '2026-09-24T07:00:00Z', '2026-09-24T07:00:01Z', '${ids.membership}', '${ids.membership}', '${ids.membership}')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values
          ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'TENANT', null, null),
          ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}'),
          ('${ids.tenant}', '${ids.membership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict do nothing;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values ('${ids.session}', '2030-01-01T00:00:00Z', 'a8-session-token', '${ids.actor}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
    `);
    await seedActiveStepUp(client, ids.session);
    await withTenantTransaction(
      createTrustedTenantTransactionContext({
        tenantId: ids.tenant,
        actorId: ids.actor,
        membershipId: ids.membership,
        legalEntityId: ids.legal,
        stationId: ids.station,
        requestId: 'a8b00000-0000-4000-8000-000000000313',
      }),
      async (transaction) => {
        await postInventoryMovementInTransaction(transaction, {
          tenantId: ids.tenant,
          stationId: ids.station,
          tankId: ids.tank,
          productId: ids.product,
          movementType: 'OPENING_BALANCE',
          quantityLitres: '1000.000',
          effectiveAt: new Date('2026-09-24T05:00:00Z'),
          businessDate: '2026-09-24',
          sourceType: 'OPENING_BALANCE',
          sourceId: ids.openingSource,
          actorMembershipId: ids.membership,
        });
      },
    );

    const openingCost = await inventoryCommand(
      {
        commandType: 'RecordOpeningInventoryCost',
        tenantId: ids.tenant,
        stationId: ids.station,
        tankId: ids.tank,
        amount: '1000.0000',
        currency: 'USD',
      },
      'a8-a12-opening-cost',
    );
    const openingCostBody = await body(openingCost);
    expect(openingCost.status, JSON.stringify(openingCostBody)).toBe(200);
  });

  afterAll(async () => client?.end());

  it('persists exact prepaid value balances and retry-safe station authorizations', async () => {
    await createPostedA5Evidence();
    const revisionRows = await client.unsafe<{ id: string }[]>(`
      select id from app.reconciliation_revisions
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and reconciliation_id='${ids.reconciliation}' and state='POSTED'
      order by revision desc limit 1
    `);
    expect(revisionRows).toHaveLength(1);
    const postedRevisionId = revisionRows[0]!.id;

    const customerResponse = await command(
      {
        commandType: 'CreateCustomer',
        tenantId: ids.tenant,
        accountReference: 'A8-CUST-001',
        displayName: 'A8 Customer',
      },
      'a8-create-customer',
    );
    expect(customerResponse.status).toBe(201);
    const customer = await body(customerResponse);
    const accountResponse = await command(
      {
        commandType: 'CreateCustomerAccount',
        tenantId: ids.tenant,
        customerId: customer.customerId,
        accountType: 'PREPAID_VALUE',
        currency: 'USD',
      },
      'a8-create-prepaid-account',
    );
    expect(accountResponse.status).toBe(201);
    const account = await body(accountResponse);
    const topUp = await command(
      {
        commandType: 'RecordPrepaidTopUp',
        tenantId: ids.tenant,
        accountId: account.accountId,
        accountType: 'PREPAID_VALUE',
        amount: { amount: '125.3750', currency: 'USD' },
        source: { sourceType: 'PREPAID_TOPUP', sourceId: 'a8b00000-0000-4000-8000-000000000101' },
        occurredAt: '2026-09-24T08:00:00+02:00',
        businessDate: '2026-09-24',
      },
      'a8-topup',
    );
    expect(topUp.status).toBe(201);
    expect(
      (
        await body(
          await command(
            {
              commandType: 'RecordPrepaidTopUp',
              tenantId: ids.tenant,
              accountId: account.accountId,
              accountType: 'PREPAID_VALUE',
              amount: { amount: '125.3750', currency: 'USD' },
              source: {
                sourceType: 'PREPAID_TOPUP',
                sourceId: 'a8b00000-0000-4000-8000-000000000101',
              },
              occurredAt: '2026-09-24T08:00:00+02:00',
              businessDate: '2026-09-24',
            },
            'a8-topup',
          ),
        )
      ).entryId,
    ).toBe((await body(topUp)).entryId);

    const statement = await customerStatementGet(
      new Request(
        `http://127.0.0.1:3000/api/customers/statement?tenantId=${ids.tenant}&accountId=${account.accountId}`,
        {
          headers: {
            cookie: `shanda-fuel.session_token=${await signedCookie('a8-session-token')}`,
          },
        },
      ),
    );
    expect(statement.status).toBe(200);
    expect((await body(statement)).lines).toHaveLength(1);

    const creditAccountResponse = await command(
      {
        commandType: 'CreateCustomerAccount',
        tenantId: ids.tenant,
        customerId: customer.customerId,
        accountType: 'CREDIT',
        currency: 'USD',
        creditLimit: '100.0000',
      },
      'a8-create-credit-account',
    );
    const creditAccount = await body(creditAccountResponse);
    const authorization = await command(
      {
        commandType: 'RequestCustomerFuelAuthorization',
        tenantId: ids.tenant,
        stationId: ids.station,
        accountId: creditAccount.accountId,
        authorizationId: 'a8b00000-0000-4000-8000-000000000201',
        requested: {
          productId: ids.product,
          litres: '10.000',
          amount: { amount: '50.0000', currency: 'USD' },
        },
        requestedAt: '2026-09-24T08:10:00+02:00',
        source: {
          sourceType: 'A5_RECONCILIATION_CUSTOMER_FUEL',
          sourceId: 'a8b00000-0000-4000-8000-000000000202',
          sourceRevisionId: 'a8b00000-0000-4000-8000-000000000203',
        },
      },
      'a8-request-auth',
    );
    expect(authorization.status).toBe(201);
    const reserved = await command(
      {
        commandType: 'AuthorizeCustomerFuel',
        tenantId: ids.tenant,
        stationId: ids.station,
        authorizationId: 'a8b00000-0000-4000-8000-000000000201',
        expectedVersion: 0,
      },
      'a8-authorize-auth',
    );
    expect(reserved.status).toBe(200);
    expect((await body(reserved)).state).toBe('AUTHORIZED');

    const completed = await command(
      {
        commandType: 'CompleteCustomerFuelTransaction',
        tenantId: ids.tenant,
        stationId: ids.station,
        accountId: creditAccount.accountId,
        authorizationId: 'a8b00000-0000-4000-8000-000000000201',
        entryId: 'a8b00000-0000-4000-8000-000000000205',
        fuelAllocationId: 'a8b00000-0000-4000-8000-000000000206',
        used: {
          productId: ids.product,
          litres: '10.000',
          amount: { amount: '50.0000', currency: 'USD' },
        },
        evidence: {
          reconciliationId: ids.reconciliation,
          reconciliationRevisionId: postedRevisionId,
          paymentEvidenceId: ids.creditPayment,
        },
        occurredAt: '2026-09-24T08:20:00+02:00',
        businessDate: '2026-09-24',
      },
      'a8-complete-credit-from-a5-evidence',
    );
    expect(completed.status).toBe(200);
    expect((await body(completed)).state).toBe('COMPLETED');
    const linkedLedger = await client.unsafe<{ source_id: string; source_revision_id: string }[]>(`
      select source_id, source_revision_id
      from app.customer_ledger_entries
      where tenant_id='${ids.tenant}' and account_id='${creditAccount.accountId}'
        and source_type='A5_RECONCILIATION_CUSTOMER_FUEL'
    `);
    expect(linkedLedger).toEqual([
      { source_id: ids.creditPayment, source_revision_id: postedRevisionId },
    ]);
  });
});
