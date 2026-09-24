import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';
import { POST as customerCommandPost } from '../../src/app/api/customers/commands/route';
import { GET as customerStatementGet } from '../../src/app/api/customers/statement/route';

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

async function body(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
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
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.businessDay}', '${ids.tenant}', '${ids.station}', '2026-09-24', 'OPEN') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values
          ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'TENANT', null, null),
          ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict do nothing;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values ('${ids.session}', '2030-01-01T00:00:00Z', 'a8-session-token', '${ids.actor}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
      insert into app.reconciliations
        (id, tenant_id, station_id, business_day_id, state, version)
        values ('${ids.reconciliation}', '${ids.tenant}', '${ids.station}', '${ids.businessDay}', 'APPROVED', 1)
        on conflict (id) do nothing;
      insert into app.reconciliation_revisions
        (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance, currency, variance_classification, posted_by, posted_at)
        values ('${ids.revision}', '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', 1, 'POSTED', 50.0000, 50.0000, 0.0000, 'USD', 'INFORMATIONAL', '${ids.membership}', '2026-09-24T08:00:00Z')
        on conflict (id) do nothing;
      insert into app.reconciliation_payments
        (id, tenant_id, station_id, reconciliation_id, method, amount, entered_by)
        values ('${ids.creditPayment}', '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', 'CUSTOMER_CREDIT', 50.0000, '${ids.membership}')
        on conflict (id) do nothing;
    `);
  });

  afterAll(async () => client?.end());

  it('persists exact prepaid value balances and retry-safe station authorizations', async () => {
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
          reconciliationRevisionId: ids.revision,
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
      { source_id: ids.creditPayment, source_revision_id: ids.revision },
    ]);
  });
});
