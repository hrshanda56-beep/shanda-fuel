import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as customerCommandPost } from '../../src/app/api/customers/commands/route';
import { GET as customerSummaryGet } from '../../src/app/api/customers/summary/route';
import { GET as customerStatementGet } from '../../src/app/api/customers/statement/route';
import { clerkHeaders, seedActiveStepUp, seedClerkSession } from './auth-session-fixtures';

/**
 * Server-side verification of the Customers module against real PostgreSQL and
 * the real route handlers: step-up on scope changes, exact-decimal writes with
 * audit rows, tenant isolation, single- and multi-account reads, and plain
 * language error responses with stable machine codes.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for customer verification tests. Configure a dedicated PostgreSQL test database.',
  );
}

const p = 'c5e00000-0000-4000-8000-';
const ids = {
  tenant: `${p}000000000001`,
  otherTenant: `${p}000000000002`,
  legal: `${p}000000000011`,
  otherLegal: `${p}000000000012`,
  station: `${p}000000000021`,
  stationTwo: `${p}000000000022`,
  otherStation: `${p}000000000023`,
  product: `${p}000000000031`,
  adminUser: `${p}000000000101`,
  adminMembership: `${p}000000000102`,
  adminSession: `${p}000000000103`,
  noStepUpUser: `${p}000000000111`,
  noStepUpMembership: `${p}000000000112`,
  noStepUpSession: `${p}000000000113`,
  otherUser: `${p}000000000121`,
  otherMembership: `${p}000000000122`,
  otherSession: `${p}000000000123`,
  staleMfaUser: `${p}000000000131`,
  staleMfaMembership: `${p}000000000132`,
  staleMfaSession: `${p}000000000133`,
  noRoleUser: `${p}000000000141`,
  noRoleMembership: `${p}000000000142`,
  noRoleSession: `${p}000000000143`,
};

const tokens = {
  admin: 'c5e-admin-token',
  noStepUp: 'c5e-no-step-up-token',
  other: 'c5e-other-tenant-token',
  staleMfa: 'c5e-stale-mfa-token',
  noRole: 'c5e-no-role-token',
};

let client: Sql;
let sequence = 0;
const uuid = () => `${p}${String(900000000000 + ++sequence).padStart(12, '0')}`;

type Json = Record<string, any>;

async function send(
  input: Record<string, unknown>,
  key: string | null,
  token: string = tokens.admin,
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {
    ...clerkHeaders(token),
    'content-type': 'application/json',
  };
  if (key !== null) headers['idempotency-key'] = key;
  const response = await customerCommandPost(
    new Request('http://127.0.0.1:3000/api/customers/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }),
  );
  return { status: response.status, body: (await response.json()) as Json };
}

async function read(
  path: string,
  query: Record<string, string>,
  token: string = tokens.admin,
): Promise<{ status: number; body: Json }> {
  const handler = path === 'summary' ? customerSummaryGet : customerStatementGet;
  const response = await handler(
    new Request(
      `http://127.0.0.1:3000/api/customers/${path}?${new URLSearchParams(query).toString()}`,
      { headers: clerkHeaders(token) },
    ),
  );
  return { status: response.status, body: (await response.json()) as Json };
}

const STABLE_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'STEP_UP_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'INVARIANT_VIOLATION',
  'IDEMPOTENCY_CONFLICT',
];

/** A failure the person can read: stable code, a sentence, no internals. */
function expectPlainFailure(
  result: { status: number; body: Json },
  status: number,
  code: string,
  messagePattern?: RegExp,
) {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  expect(result.body.error).toBe(code);
  expect(STABLE_CODES).toContain(result.body.error);
  const message = result.body.message;
  expect(typeof message, JSON.stringify(result.body)).toBe('string');
  expect(message.trim().length).toBeGreaterThan(10);
  if (messagePattern) expect(message).toMatch(messagePattern);
  // The whole response, not only the message, must stay free of internals.
  const text = JSON.stringify(result.body);
  expect(text).not.toMatch(
    /\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set|where)\b|violates|constraint|drizzle|postgres|stack|\bat \S+\.(ts|js)|node_modules|\bapp\.|DrizzleQueryError|undefined|\[object|\bNaN\b|\bA5\b/i,
  );
  expect(message).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
  expect(message).not.toMatch(
    /\bstale\b|\bidempotency\b|\bversion\b|\bpayload\b|\bschema\b|\bactor\b|\bmembership\b|\btenant\b|\bledger\b/i,
  );
}

async function auditRows(eventCode: string, subjectId: string) {
  return client.unsafe<{ details: Json }[]>(
    `select details from platform.security_events
      where tenant_id='${ids.tenant}' and event_code='${eventCode}'
        and details->>'subjectId'='${subjectId}'
      order by occurred_at`,
  );
}

async function createCustomer(reference: string, name: string, withLegalEntity = true) {
  const result = await send(
    {
      commandType: 'CreateCustomer',
      tenantId: ids.tenant,
      accountReference: reference,
      displayName: name,
      ...(withLegalEntity ? { legalEntityId: ids.legal } : {}),
    },
    `key-create-${reference}`,
  );
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body as { customerId: string; version: number };
}

async function createAccount(
  customerId: string,
  accountType: 'CREDIT' | 'PREPAID_VALUE' | 'PREPAID_LITRES',
  extra: Record<string, unknown> = {},
) {
  const result = await send(
    {
      commandType: 'CreateCustomerAccount',
      tenantId: ids.tenant,
      customerId,
      accountType,
      currency: 'USD',
      stationScope: 'ALL',
      ...extra,
    },
    `key-account-${customerId}-${accountType}`,
  );
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body as { accountId: string };
}

function paymentCommand(accountId: string, amount: string, sourceId = uuid()) {
  return {
    commandType: 'RecordCustomerPayment',
    tenantId: ids.tenant,
    accountId,
    receivingStationId: ids.station,
    amount: { amount, currency: 'USD' },
    source: { sourceType: 'CUSTOMER_PAYMENT', sourceId },
    occurredAt: '2026-09-24T08:00:00+02:00',
    businessDate: '2026-09-24',
  };
}

function valueTopUp(accountId: string, amount: string, sourceId = uuid()) {
  return {
    commandType: 'RecordPrepaidTopUp',
    tenantId: ids.tenant,
    accountId,
    accountType: 'PREPAID_VALUE',
    amount: { amount, currency: 'USD' },
    source: { sourceType: 'PREPAID_TOPUP', sourceId },
    occurredAt: '2026-09-24T08:00:00+02:00',
    businessDate: '2026-09-24',
  };
}

function authorizationRequest(accountId: string, amount: string, litres: string) {
  const authorizationId = uuid();
  return {
    authorizationId,
    command: {
      commandType: 'RequestCustomerFuelAuthorization',
      tenantId: ids.tenant,
      stationId: ids.station,
      accountId,
      authorizationId,
      requested: { productId: ids.product, litres, amount: { amount, currency: 'USD' } },
      requestedAt: '2026-09-24T08:10:00+02:00',
      source: {
        sourceType: 'A5_RECONCILIATION_CUSTOMER_FUEL',
        sourceId: uuid(),
        sourceRevisionId: uuid(),
      },
    },
  };
}

describe('Customers server-side verification (real PostgreSQL, real route handlers)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-customers-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-customers-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Customers Verification Tenant', 'customers-verification'),
        ('${ids.otherTenant}', 'Customers Other Tenant', 'customers-verification-other')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.adminUser}', 'CV Admin', 'cv-admin@example.test'),
        ('${ids.noStepUpUser}', 'CV No Step-up', 'cv-no-step-up@example.test'),
        ('${ids.otherUser}', 'CV Other Tenant Admin', 'cv-other@example.test'),
        ('${ids.staleMfaUser}', 'CV Stale MFA', 'cv-stale-mfa@example.test'),
        ('${ids.noRoleUser}', 'CV No Role', 'cv-no-role@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.adminUser}', 'ACTIVE'),
        ('${ids.noStepUpMembership}', '${ids.tenant}', '${ids.noStepUpUser}', 'ACTIVE'),
        ('${ids.staleMfaMembership}', '${ids.tenant}', '${ids.staleMfaUser}', 'ACTIVE'),
        ('${ids.noRoleMembership}', '${ids.tenant}', '${ids.noRoleUser}', 'ACTIVE'),
        ('${ids.otherMembership}', '${ids.otherTenant}', '${ids.otherUser}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'CV Legal Entity'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'CV Other Legal Entity')
        on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'CVONE', 'CV Station One', 'ACTIVE'),
        ('${ids.stationTwo}', '${ids.tenant}', '${ids.legal}', 'CVTWO', 'CV Station Two', 'ACTIVE'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'CVOTHER', 'CV Other Station', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name, status)
        values ('${ids.product}', '${ids.tenant}', 'CV-PETROL', 'CV Petrol', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values
          ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
          ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}'),
          ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.stationTwo}'),
          ('${ids.tenant}', '${ids.noStepUpMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
          ('${ids.tenant}', '${ids.staleMfaMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
          ('${ids.otherTenant}', '${ids.otherMembership}', 'ADMINISTRATOR', 'TENANT', null, null)
        on conflict do nothing;
    `);
    await seedClerkSession(client, ids.adminSession, tokens.admin, ids.adminUser, true);
    await seedActiveStepUp(client, ids.adminSession, ids.tenant);
    // Strong sign-in but no step-up yet.
    await seedClerkSession(client, ids.noStepUpSession, tokens.noStepUp, ids.noStepUpUser, true);
    await seedClerkSession(client, ids.otherSession, tokens.other, ids.otherUser, true);
    await seedActiveStepUp(client, ids.otherSession, ids.otherTenant);
    // Stale multi-factor sign-in: not even strong authentication.
    await seedClerkSession(client, ids.staleMfaSession, tokens.staleMfa, ids.staleMfaUser, false);
    await seedClerkSession(client, ids.noRoleSession, tokens.noRole, ids.noRoleUser, true);
    await seedActiveStepUp(client, ids.noRoleSession, ids.tenant);
  });

  afterAll(async () => client?.end());

  it('creates a customer and its account in one command, and saves nothing when it is refused', async () => {
    const body = {
      commandType: 'CreateCustomerWithAccount',
      tenantId: ids.tenant,
      accountReference: 'CV-ATOMIC-1',
      displayName: 'Atomic Customer',
      legalEntityId: ids.legal,
      accountType: 'CREDIT',
      currency: 'USD',
      creditLimit: '500.0000',
      creditDays: 14,
      stationScope: 'ALL',
    };
    const created = await send(body, 'key-atomic-1');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { customerId, accountId } = created.body as { customerId: string; accountId: string };
    const rows = await client.unsafe<{ credit_limit: string; credit_days: number }[]>(
      `select credit_limit::text, credit_days from app.customer_accounts where id='${accountId}' and customer_id='${customerId}'`,
    );
    expect(rows).toEqual([{ credit_limit: '500.0000', credit_days: 14 }]);
    expect(await auditRows('CUSTOMER.CREATED_WITH_ACCOUNT', customerId)).toHaveLength(1);
    // A retry with the same key returns the same result and creates nothing more.
    const again = await send(body, 'key-atomic-1');
    expect(again.body).toMatchObject({ customerId, accountId });

    // Without the identity check: refused, and no orphan customer is left behind.
    const refused = await send(
      { ...body, accountReference: 'CV-ATOMIC-2', displayName: 'Orphan Customer' },
      'key-atomic-2',
      tokens.noStepUp,
    );
    expectPlainFailure(refused, 403, 'STEP_UP_REQUIRED', /step-up/i);
    const orphans = await client.unsafe<{ id: string }[]>(
      `select id from app.customers where tenant_id='${ids.tenant}' and account_reference='CV-ATOMIC-2'`,
    );
    expect(orphans).toEqual([]);

    // An account that cannot be opened (credit without a limit) saves no customer either.
    const invalid = await send(
      { ...body, accountReference: 'CV-ATOMIC-3', creditLimit: undefined },
      'key-atomic-3',
    );
    expect(invalid.status).toBe(400);
    expect(
      await client.unsafe(
        `select id from app.customers where tenant_id='${ids.tenant}' and account_reference='CV-ATOMIC-3'`,
      ),
    ).toEqual([]);
  });

  it('adds a staff member as a customer marked Staff with their benefit, in one command', async () => {
    const created = await send(
      {
        commandType: 'CreateCustomerWithAccount',
        tenantId: ids.tenant,
        accountReference: 'CV-STAFF-1',
        displayName: 'Tendai Moyo',
        contactMetadata: { kind: 'STAFF' },
        legalEntityId: ids.legal,
        accountType: 'CREDIT',
        currency: 'USD',
        creditLimit: '60.0000',
        staffBenefit: { staffName: 'Tendai Moyo' },
        stationScope: 'ALL',
      },
      'key-staff-atomic',
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { customerId, accountId } = created.body as { customerId: string; accountId: string };
    const rows = await client.unsafe<{ kind: string; staff_name: string; credit_limit: string }[]>(
      `select c.contact_metadata->>'kind' as kind, t.staff_name, a.credit_limit::text
         from app.customers c
         join app.customer_accounts a on a.customer_id = c.id
         join app.customer_staff_benefit_terms t on t.account_id = a.id
        where c.id = '${customerId}' and a.id = '${accountId}'`,
    );
    expect(rows).toEqual([{ kind: 'STAFF', staff_name: 'Tendai Moyo', credit_limit: '60.0000' }]);

    // A benefit that cannot be opened saves no customer record either.
    const refused = await send(
      {
        commandType: 'CreateCustomerWithAccount',
        tenantId: ids.tenant,
        accountReference: 'CV-STAFF-2',
        displayName: 'No Limit Person',
        contactMetadata: { kind: 'STAFF' },
        legalEntityId: ids.legal,
        accountType: 'PREPAID_VALUE',
        currency: 'USD',
        staffBenefit: { staffName: 'No Limit Person' },
      },
      'key-staff-atomic-bad',
    );
    expect(refused.status).toBe(400);
    expect(
      await client.unsafe(
        `select id from app.customers where tenant_id='${ids.tenant}' and account_reference='CV-STAFF-2'`,
      ),
    ).toEqual([]);
  });

  it('requires a fresh step-up to change an account scope, and the retry is idempotent', async () => {
    const customer = await createCustomer('CV-SCOPE-1', 'Scope Customer');
    // Opening an account without a scope leaves it unconfirmed.
    const account = await send(
      {
        commandType: 'CreateCustomerAccount',
        tenantId: ids.tenant,
        customerId: customer.customerId,
        accountType: 'PREPAID_VALUE',
        currency: 'USD',
      },
      'key-scope-account',
    );
    expect(account.status).toBe(201);
    expect(account.body.stationScopeConfigured).toBe(false);
    const accountId = account.body.accountId as string;

    const scopeChange = {
      commandType: 'SetCustomerAccountStations',
      tenantId: ids.tenant,
      accountId,
      expectedVersion: 0,
      stationScope: 'SELECTED',
      stationIds: [ids.station, ids.stationTwo],
    };

    // 1. Signed in strongly but without a fresh step-up: rejected, nothing changes.
    const denied = await send(scopeChange, 'key-scope-save', tokens.noStepUp);
    expectPlainFailure(denied, 403, 'STEP_UP_REQUIRED', /step-up/i);
    // The UI opens its identity-check dialog for this code (and this wording).
    expect(denied.body.message).toMatch(/step-up/i);
    const untouched = await client.unsafe<{ version: number; station_scope_configured: boolean }[]>(
      `select version, station_scope_configured from app.customer_accounts where id='${accountId}'`,
    );
    expect(untouched).toEqual([{ version: 0, station_scope_configured: false }]);
    expect(await auditRows('CUSTOMER.ACCOUNT_STATIONS_SET', accountId)).toHaveLength(0);

    // 2. After the identity check, the same command succeeds.
    await seedActiveStepUp(client, ids.noStepUpSession, ids.tenant);
    const saved = await send(scopeChange, 'key-scope-save', tokens.noStepUp);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({
      accountId,
      stationScope: 'SELECTED',
      stationScopeConfigured: true,
      version: 1,
    });
    expect([...saved.body.stationIds].sort()).toEqual([ids.station, ids.stationTwo].sort());
    expect(await auditRows('CUSTOMER.ACCOUNT_STATIONS_SET', accountId)).toHaveLength(1);

    // 3. Replaying the identical request returns the stored result and writes nothing new.
    const replay = await send(scopeChange, 'key-scope-save', tokens.noStepUp);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(saved.body);
    expect(await auditRows('CUSTOMER.ACCOUNT_STATIONS_SET', accountId)).toHaveLength(1);
    const afterReplay = await client.unsafe<{ version: number }[]>(
      `select version from app.customer_accounts where id='${accountId}'`,
    );
    expect(afterReplay[0]!.version).toBe(1);
    const activeStations = await client.unsafe<{ count: string }[]>(
      `select count(*)::text as count from app.customer_account_stations
        where account_id='${accountId}' and active`,
    );
    expect(activeStations[0]!.count).toBe('2');

    // 4. Reusing the key for different content is refused in plain words.
    const reused = await send(
      { ...scopeChange, stationScope: 'ALL', stationIds: undefined },
      'key-scope-save',
      tokens.noStepUp,
    );
    expectPlainFailure(reused, 409, 'IDEMPOTENCY_CONFLICT');

    // 5. A saved-over account is reported as changed by someone else.
    const stale = await send(scopeChange, 'key-scope-save-again', tokens.noStepUp);
    expectPlainFailure(stale, 409, 'CONFLICT', /changed|refresh|reload/i);
  });

  it('keeps scope changes behind step-up when the sign-in itself is stale, with a message the UI can act on', async () => {
    const customer = await createCustomer('CV-SCOPE-2', 'Stale MFA Customer');
    const account = await createAccount(customer.customerId, 'CREDIT', {
      creditLimit: '100.0000',
    });
    const result = await send(
      {
        commandType: 'SetCustomerAccountStations',
        tenantId: ids.tenant,
        accountId: account.accountId,
        expectedVersion: 0,
        stationScope: 'ALL',
      },
      'key-stale-mfa',
      tokens.staleMfa,
    );
    expectPlainFailure(result, 403, 'STEP_UP_REQUIRED');
    // The customer screens offer the identity check for this code.
    expect(result.body.message).toMatch(/step-up/i);
  });

  it('records customer payments and prepaid top-ups with exact decimals and audit rows', async () => {
    const customer = await createCustomer('CV-WRITE-1', 'Write Customer');
    const credit = await createAccount(customer.customerId, 'CREDIT', { creditLimit: '1000.0000' });
    const money = await createAccount(customer.customerId, 'PREPAID_VALUE');
    const fuel = await createAccount(customer.customerId, 'PREPAID_LITRES');

    // Prepaid money keeps four decimals.
    const topUpCommand = valueTopUp(money.accountId, '250.7550');
    const topUp = await send(topUpCommand, 'key-write-topup');
    expect(topUp.status, JSON.stringify(topUp.body)).toBe(201);
    const moneyRows = await client.unsafe<
      { amount: string; direction: string; entry_type: string }[]
    >(
      `select amount::text, direction, entry_type from app.customer_ledger_entries
        where account_id='${money.accountId}'`,
    );
    expect(moneyRows).toEqual([
      { amount: '250.7550', direction: 'INCREASE', entry_type: 'PREPAID_TOPUP' },
    ]);
    expect(await auditRows('CUSTOMER.PREPAID_TOPUP_POSTED', topUp.body.entryId)).toHaveLength(1);

    // Prepaid litres keep three decimals and belong to one fuel.
    const litresTopUp = await send(
      {
        commandType: 'RecordPrepaidTopUp',
        tenantId: ids.tenant,
        accountId: fuel.accountId,
        accountType: 'PREPAID_LITRES',
        productId: ids.product,
        litres: '321.125',
        source: { sourceType: 'PREPAID_TOPUP', sourceId: uuid() },
        occurredAt: '2026-09-24T08:00:00+02:00',
        businessDate: '2026-09-24',
      },
      'key-write-topup-litres',
    );
    expect(litresTopUp.status, JSON.stringify(litresTopUp.body)).toBe(201);
    const litreRows = await client.unsafe<{ quantity_litres: string; product_id: string }[]>(
      `select quantity_litres::text, product_id from app.customer_ledger_entries
        where account_id='${fuel.accountId}'`,
    );
    expect(litreRows).toEqual([{ quantity_litres: '321.125', product_id: ids.product }]);
    expect(await auditRows('CUSTOMER.PREPAID_TOPUP_POSTED', litresTopUp.body.entryId)).toHaveLength(
      1,
    );

    // A credit-account payment, received at a named station.
    const paymentCommandBody = paymentCommand(credit.accountId, '40.2500');
    const payment = await send(paymentCommandBody, 'key-write-payment');
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    expect(payment.body.receivingStationId).toBe(ids.station);
    const paymentRows = await client
      .unsafe<
        { amount: string; entry_type: string; direction: string; station_id: string | null }[]
      >(
        `select amount::text, entry_type, direction, receiving_station_id as station_id
         from app.customer_ledger_entries where account_id='${credit.accountId}'`,
      )
      .catch(async () =>
        (
          await client.unsafe<{ amount: string; entry_type: string; direction: string }[]>(
            `select amount::text, entry_type, direction from app.customer_ledger_entries
            where account_id='${credit.accountId}'`,
          )
        ).map((row) => ({ ...row, station_id: null })),
      );
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]).toMatchObject({
      amount: '40.2500',
      entry_type: 'CUSTOMER_PAYMENT',
      direction: 'DECREASE',
    });
    const paymentAudit = await auditRows('CUSTOMER.PAYMENT_POSTED', payment.body.entryId);
    expect(paymentAudit).toHaveLength(1);

    // An identical retry returns the first result and writes nothing more.
    const replay = await send(paymentCommandBody, 'key-write-payment');
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(payment.body);
    const ledgerCount = await client.unsafe<{ count: string }[]>(
      `select count(*)::text as count from app.customer_ledger_entries
        where customer_id='${customer.customerId}'`,
    );
    expect(ledgerCount[0]!.count).toBe('3');
    expect(await auditRows('CUSTOMER.PAYMENT_POSTED', payment.body.entryId)).toHaveLength(1);

    // The same payment sent again under a new key is refused, not posted twice.
    const duplicate = await send(paymentCommandBody, 'key-write-payment-again');
    expectPlainFailure(duplicate, 409, 'IDEMPOTENCY_CONFLICT', /already been posted/i);
    // The same key with different content is refused too.
    const changed = await send(
      { ...paymentCommandBody, amount: { amount: '41.0000', currency: 'USD' } },
      'key-write-payment',
    );
    expectPlainFailure(changed, 409, 'IDEMPOTENCY_CONFLICT');

    // The three-decimal money rules hold: five decimals are not silently rounded into the ledger.
    const tooPrecise = await send(
      valueTopUp(money.accountId, '1.123456'),
      'key-write-topup-too-precise',
    );
    expect(tooPrecise.status).toBeGreaterThanOrEqual(400);
    const afterPrecise = await client.unsafe<{ count: string }[]>(
      `select count(*)::text as count from app.customer_ledger_entries
        where account_id='${money.accountId}'`,
    );
    expect(afterPrecise[0]!.count).toBe('1');
  });

  it('deactivates and reactivates a customer with audit rows, and blocks payments while deactivated', async () => {
    const customer = await createCustomer('CV-LIFE-1', 'Lifecycle Customer');
    const credit = await createAccount(customer.customerId, 'CREDIT', { creditLimit: '300.0000' });

    const deactivate = {
      commandType: 'DeactivateCustomer',
      tenantId: ids.tenant,
      customerId: customer.customerId,
      expectedVersion: 0,
    };
    const suspended = await send(deactivate, 'key-life-deactivate');
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect(suspended.body).toMatchObject({ status: 'SUSPENDED', version: 1 });
    expect(await auditRows('CUSTOMER.DEACTIVATED', customer.customerId)).toHaveLength(1);

    // Retrying the same request does not deactivate (or audit) twice.
    const replay = await send(deactivate, 'key-life-deactivate');
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(suspended.body);
    expect(await auditRows('CUSTOMER.DEACTIVATED', customer.customerId)).toHaveLength(1);

    // A new request against the old version is stale; against the new version it is redundant.
    expectPlainFailure(
      await send(deactivate, 'key-life-deactivate-stale'),
      409,
      'CONFLICT',
      /changed by someone else/i,
    );
    expectPlainFailure(
      await send({ ...deactivate, expectedVersion: 1 }, 'key-life-deactivate-twice'),
      409,
      'CONFLICT',
      /already deactivated/i,
    );

    // While deactivated, money cannot be recorded against its accounts.
    const blocked = await send(
      paymentCommand(credit.accountId, '10.0000'),
      'key-life-payment-blocked',
    );
    expectPlainFailure(blocked, 409, 'CONFLICT', /not active/i);
    const none = await client.unsafe<{ count: string }[]>(
      `select count(*)::text as count from app.customer_ledger_entries where customer_id='${customer.customerId}'`,
    );
    expect(none[0]!.count).toBe('0');
    const summary = await read('summary', {
      tenantId: ids.tenant,
      customerId: customer.customerId,
    });
    expect(summary.body.customers[0]).toMatchObject({ status: 'SUSPENDED', version: 1 });

    // Reactivation restores normal use.
    const reactivated = await send(
      { ...deactivate, commandType: 'ActivateCustomer', expectedVersion: 1 },
      'key-life-activate',
    );
    expect(reactivated.status, JSON.stringify(reactivated.body)).toBe(200);
    expect(reactivated.body).toMatchObject({ status: 'ACTIVE', version: 2 });
    expect(await auditRows('CUSTOMER.ACTIVATED', customer.customerId)).toHaveLength(1);
    expectPlainFailure(
      await send(
        { ...deactivate, commandType: 'ActivateCustomer', expectedVersion: 2 },
        'key-life-activate-twice',
      ),
      409,
      'CONFLICT',
      /already active/i,
    );
    const allowed = await send(paymentCommand(credit.accountId, '10.0000'), 'key-life-payment-ok');
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
  });

  it('keeps tenants apart for reads and writes', async () => {
    const mine = await createCustomer('CV-TENANT-1', 'Tenant One Customer');
    const account = await createAccount(mine.customerId, 'PREPAID_VALUE');
    const topUp = await send(valueTopUp(account.accountId, '75.0000'), 'key-tenant-topup');
    expect(topUp.status).toBe(201);

    const theirs = await send(
      {
        commandType: 'CreateCustomer',
        tenantId: ids.otherTenant,
        accountReference: 'CV-OTHER-1',
        displayName: 'Other Tenant Customer',
      },
      'key-other-create',
      tokens.other,
    );
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);

    // Another tenant's admin cannot act inside this tenant by naming it ...
    const asTenantOne = await send(
      valueTopUp(account.accountId, '5.0000'),
      'key-tenant-cross-1',
      tokens.other,
    );
    expectPlainFailure(asTenantOne, 403, 'FORBIDDEN');
    // ... nor by naming their own tenant with this tenant's ids.
    const withOwnTenant = await send(
      { ...valueTopUp(account.accountId, '5.0000'), tenantId: ids.otherTenant },
      'key-tenant-cross-2',
      tokens.other,
    );
    expectPlainFailure(withOwnTenant, 404, 'NOT_FOUND');
    const deactivate = await send(
      {
        commandType: 'DeactivateCustomer',
        tenantId: ids.otherTenant,
        customerId: mine.customerId,
        expectedVersion: 0,
      },
      'key-tenant-cross-3',
      tokens.other,
    );
    expectPlainFailure(deactivate, 404, 'NOT_FOUND');
    const unchanged = await client.unsafe<{ status: string; version: number }[]>(
      `select status, version from app.customers where id='${mine.customerId}'`,
    );
    expect(unchanged).toEqual([{ status: 'ACTIVE', version: 0 }]);
    const ledger = await client.unsafe<{ count: string }[]>(
      `select count(*)::text as count from app.customer_ledger_entries where account_id='${account.accountId}'`,
    );
    expect(ledger[0]!.count).toBe('1');

    // Reads.
    expect(
      (await read('summary', { tenantId: ids.tenant, customerId: mine.customerId }, tokens.other))
        .status,
    ).toBe(403);
    const foreignDetail = await read(
      'summary',
      { tenantId: ids.otherTenant, customerId: mine.customerId },
      tokens.other,
    );
    expect(foreignDetail.status).toBe(200);
    expect(foreignDetail.body.customers).toEqual([]);
    const theirList = await read('summary', { tenantId: ids.otherTenant }, tokens.other);
    expect(theirList.status).toBe(200);
    expect(theirList.body.customers.map((row: Json) => row.accountReference)).toEqual([
      'CV-OTHER-1',
    ]);
    const myList = await read('summary', { tenantId: ids.tenant });
    expect(myList.body.customers.map((row: Json) => row.accountReference)).not.toContain(
      'CV-OTHER-1',
    );
    expectPlainFailure(
      await read(
        'statement',
        { tenantId: ids.otherTenant, accountId: account.accountId },
        tokens.other,
      ),
      404,
      'NOT_FOUND',
    );
    expect(
      (
        await read(
          'statement',
          { tenantId: ids.tenant, accountId: account.accountId },
          tokens.other,
        )
      ).status,
    ).toBe(403);

    // No session at all.
    const anonymous = await customerCommandPost(
      new Request('http://127.0.0.1:3000/api/customers/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'key-anon' },
        body: JSON.stringify(valueTopUp(account.accountId, '1.0000')),
      }),
    );
    expect(anonymous.status).toBe(401);
  });

  it('reads back a customer with exactly one account and a customer with three accounts', async () => {
    // One account: a credit account only.
    const single = await createCustomer('CV-READ-1', 'Read One Account');
    const singleCredit = await createAccount(single.customerId, 'CREDIT', {
      creditLimit: '500.0000',
    });
    expect(
      (await send(paymentCommand(singleCredit.accountId, '120.5000'), 'key-read-single-payment'))
        .status,
    ).toBe(201);

    // Three accounts: credit, prepaid money and prepaid litres.
    const triple = await createCustomer('CV-READ-3', 'Read Three Accounts');
    const credit = await createAccount(triple.customerId, 'CREDIT', { creditLimit: '1000.0000' });
    const money = await createAccount(triple.customerId, 'PREPAID_VALUE');
    const fuel = await createAccount(triple.customerId, 'PREPAID_LITRES');
    expect(
      (await send(paymentCommand(credit.accountId, '40.2500'), 'key-read-triple-payment')).status,
    ).toBe(201);
    expect(
      (await send(valueTopUp(money.accountId, '250.7550'), 'key-read-triple-topup')).status,
    ).toBe(201);
    expect(
      (
        await send(
          {
            commandType: 'RecordPrepaidTopUp',
            tenantId: ids.tenant,
            accountId: fuel.accountId,
            accountType: 'PREPAID_LITRES',
            productId: ids.product,
            litres: '321.125',
            source: { sourceType: 'PREPAID_TOPUP', sourceId: uuid() },
            occurredAt: '2026-09-24T09:00:00+02:00',
            businessDate: '2026-09-24',
          },
          'key-read-triple-litres',
        )
      ).status,
    ).toBe(201);

    // Reserve some of each so available amounts differ from balances.
    const reserve = async (accountId: string, amount: string, litres: string) => {
      const requested = authorizationRequest(accountId, amount, litres);
      const asked = await send(requested.command, `key-read-ask-${requested.authorizationId}`);
      expect(asked.status, JSON.stringify(asked.body)).toBe(201);
      const approved = await send(
        {
          commandType: 'AuthorizeCustomerFuel',
          tenantId: ids.tenant,
          stationId: ids.station,
          authorizationId: requested.authorizationId,
          expectedVersion: 0,
        },
        `key-read-approve-${requested.authorizationId}`,
      );
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(approved.body.state).toBe('AUTHORIZED');
    };
    await reserve(credit.accountId, '60.0000', '24.000');
    await reserve(money.accountId, '50.0000', '20.000');
    await reserve(fuel.accountId, '30.0000', '21.125');

    // Detail read.
    const detail = await read('summary', { tenantId: ids.tenant, customerId: triple.customerId });
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.customers).toHaveLength(1);
    const detailCustomer = detail.body.customers[0] as Json;
    expect(detailCustomer).toMatchObject({
      customerId: triple.customerId,
      displayName: 'Read Three Accounts',
      status: 'ACTIVE',
      legalEntityId: ids.legal,
      legalEntityName: 'CV Legal Entity',
    });
    expect(detailCustomer.accounts).toHaveLength(3);
    const byType = Object.fromEntries(
      (detailCustomer.accounts as Json[]).map((account) => [account.accountType, account]),
    );
    expect(Object.keys(byType).sort()).toEqual(['CREDIT', 'PREPAID_LITRES', 'PREPAID_VALUE']);
    expect(byType.CREDIT).toMatchObject({
      accountId: credit.accountId,
      creditLimit: '1000.0000',
      balance: '-40.2500',
      reservedAmount: '60.0000',
      availableCredit: '980.2500',
      ready: true,
      stationScope: 'ALL',
    });
    expect(byType.PREPAID_VALUE).toMatchObject({
      accountId: money.accountId,
      balance: '250.7550',
      reservedAmount: '50.0000',
      availableBalance: '200.7550',
    });
    expect(byType.PREPAID_LITRES).toMatchObject({
      accountId: fuel.accountId,
      balance: null,
      productBalances: [
        expect.objectContaining({
          productId: ids.product,
          productCode: 'CV-PETROL',
          balanceLitres: '321.125',
          availableLitres: '300',
        }),
      ],
    });
    // Recent activity covers all three accounts, newest first.
    expect(detailCustomer.recentTransactions).toHaveLength(3);
    const activity = detailCustomer.recentTransactions as Json[];
    expect(activity.map((row) => row.accountType).sort()).toEqual([
      'CREDIT',
      'PREPAID_LITRES',
      'PREPAID_VALUE',
    ]);
    expect(activity.find((row) => row.accountType === 'PREPAID_LITRES')).toMatchObject({
      litres: '321.125',
      productCode: 'CV-PETROL',
      amount: null,
    });
    expect(activity.find((row) => row.accountType === 'CREDIT')).toMatchObject({
      entryType: 'CUSTOMER_PAYMENT',
      amount: '40.2500',
      direction: 'DECREASE',
    });
    expect(detail.body.fuelProducts).toEqual([
      { id: ids.product, code: 'CV-PETROL', name: 'CV Petrol' },
    ]);

    // List read: both customers appear once, with the right number of accounts and no activity detail.
    const list = await read('summary', { tenantId: ids.tenant });
    expect(list.status).toBe(200);
    const listed = (list.body.customers as Json[]).filter((row) =>
      ['CV-READ-1', 'CV-READ-3'].includes(row.accountReference),
    );
    expect(listed.map((row) => [row.accountReference, row.accounts.length])).toEqual([
      ['CV-READ-1', 1],
      ['CV-READ-3', 3],
    ]);
    expect(listed[0]!.recentTransactions).toEqual([]);
    expect(listed[0]!.accounts[0]).toMatchObject({
      accountType: 'CREDIT',
      balance: '-120.5000',
      availableCredit: '620.5000',
      reservedAmount: '0',
    });
    expect(list.body.fuelProducts).toEqual([]);

    // The single-account detail read agrees with the list.
    const singleDetail = await read('summary', {
      tenantId: ids.tenant,
      customerId: single.customerId,
    });
    expect(singleDetail.body.customers[0].accounts).toHaveLength(1);
    expect(singleDetail.body.customers[0].accounts[0]).toMatchObject({
      balance: '-120.5000',
      creditLimit: '500.0000',
    });
    expect(singleDetail.body.customers[0].recentTransactions).toHaveLength(1);

    // Statements agree with the summary balances.
    const statement = await read('statement', {
      tenantId: ids.tenant,
      accountId: money.accountId,
    });
    expect(statement.status).toBe(200);
    expect(statement.body.lines).toHaveLength(1);
    expect(statement.body.balance).toMatchObject({ accountType: 'PREPAID_VALUE' });
  });

  describe('plain-language errors with stable codes', () => {
    it('explains credit-limit, prepaid-money and prepaid-litre shortfalls and leaves the request unapproved', async () => {
      const customer = await createCustomer('CV-ERR-1', 'Error Customer');
      const credit = await createAccount(customer.customerId, 'CREDIT', {
        creditLimit: '100.0000',
      });
      const money = await createAccount(customer.customerId, 'PREPAID_VALUE');
      const fuel = await createAccount(customer.customerId, 'PREPAID_LITRES');
      expect((await send(valueTopUp(money.accountId, '10.0000'), 'key-err-topup')).status).toBe(
        201,
      );
      expect(
        (
          await send(
            {
              commandType: 'RecordPrepaidTopUp',
              tenantId: ids.tenant,
              accountId: fuel.accountId,
              accountType: 'PREPAID_LITRES',
              productId: ids.product,
              litres: '5.000',
              source: { sourceType: 'PREPAID_TOPUP', sourceId: uuid() },
              occurredAt: '2026-09-24T09:00:00+02:00',
              businessDate: '2026-09-24',
            },
            'key-err-topup-litres',
          )
        ).status,
      ).toBe(201);

      const attempt = async (accountId: string, amount: string, litres: string) => {
        const requested = authorizationRequest(accountId, amount, litres);
        expect(
          (await send(requested.command, `key-err-ask-${requested.authorizationId}`)).status,
        ).toBe(201);
        const result = await send(
          {
            commandType: 'AuthorizeCustomerFuel',
            tenantId: ids.tenant,
            stationId: ids.station,
            authorizationId: requested.authorizationId,
            expectedVersion: 0,
          },
          `key-err-approve-${requested.authorizationId}`,
        );
        const state = await client.unsafe<{ state: string; version: number }[]>(
          `select state, version from app.customer_fuel_authorizations where id='${requested.authorizationId}'`,
        );
        expect(state).toEqual([{ state: 'REQUESTED', version: 0 }]);
        return result;
      };

      expectPlainFailure(
        await attempt(credit.accountId, '150.0000', '60.000'),
        409,
        'CONFLICT',
        /credit limit/i,
      );
      expectPlainFailure(
        await attempt(money.accountId, '50.0000', '20.000'),
        409,
        'CONFLICT',
        /enough prepaid money/i,
      );
      expectPlainFailure(
        await attempt(fuel.accountId, '50.0000', '20.000'),
        409,
        'CONFLICT',
        /enough prepaid litres/i,
      );
    });

    it('explains stale versions, suspended customers and permission problems', async () => {
      const customer = await createCustomer('CV-ERR-2', 'Error Customer Two');
      const stale = await send(
        {
          commandType: 'UpdateCustomer',
          tenantId: ids.tenant,
          customerId: customer.customerId,
          expectedVersion: 7,
          displayName: 'Renamed',
        },
        'key-err-stale',
      );
      expectPlainFailure(stale, 409, 'CONFLICT', /changed by someone else/i);
      const legalEntity = await send(
        {
          commandType: 'SetCustomerLegalEntity',
          tenantId: ids.tenant,
          customerId: customer.customerId,
          expectedVersion: 7,
          legalEntityId: ids.legal,
        },
        'key-err-stale-legal',
      );
      expectPlainFailure(legalEntity, 409, 'CONFLICT', /changed by someone else/i);

      const missing = await send(
        {
          commandType: 'UpdateCustomer',
          tenantId: ids.tenant,
          customerId: uuid(),
          expectedVersion: 0,
          displayName: 'Nobody',
        },
        'key-err-missing',
      );
      expectPlainFailure(missing, 404, 'NOT_FOUND', /not found/i);

      // No permission is a different message from a missing identity check.
      const noRole = await send(
        {
          commandType: 'UpdateCustomer',
          tenantId: ids.tenant,
          customerId: customer.customerId,
          expectedVersion: 0,
          displayName: 'Nope',
        },
        'key-err-no-role',
        tokens.noRole,
      );
      expectPlainFailure(noRole, 403, 'FORBIDDEN', /permission/i);
      expect(noRole.body.message).not.toMatch(/not authorized|step-up/i);

      // Missing fresh check: the message must keep matching what the UI looks for.
      const noStepUp = await send(
        {
          commandType: 'CreateCustomerAccount',
          tenantId: ids.tenant,
          customerId: customer.customerId,
          accountType: 'PREPAID_VALUE',
          currency: 'USD',
          stationScope: 'ALL',
        },
        'key-err-no-step-up',
        tokens.staleMfa,
      );
      expectPlainFailure(noStepUp, 403, 'STEP_UP_REQUIRED', /step-up/i);
    });

    it('explains validation problems field by field without library jargon', async () => {
      const customer = await createCustomer('CV-ERR-3', 'Error Customer Three');
      const account = await createAccount(customer.customerId, 'CREDIT', {
        creditLimit: '50.0000',
      });

      const cases: Array<[string, Record<string, unknown>, RegExp]> = [
        [
          'bad id',
          {
            commandType: 'UpdateCustomer',
            tenantId: ids.tenant,
            customerId: 'not-a-uuid',
            expectedVersion: 0,
            displayName: 'x',
          },
          /customer/i,
        ],
        ['negative amount', paymentCommand(account.accountId, '-5'), /digits/i],
        ['text amount', paymentCommand(account.accountId, 'ten'), /digits/i],
        [
          'lowercase currency',
          {
            ...paymentCommand(account.accountId, '5.00'),
            amount: { amount: '5.00', currency: 'usd' },
          },
          /currency/i,
        ],
        ['zero amount', paymentCommand(account.accountId, '0.00'), /more than zero/i],
        [
          'missing amount on prepaid value',
          { ...valueTopUp(account.accountId, '5.00'), amount: undefined },
          /amount/i,
        ],
        [
          'blank name',
          {
            commandType: 'CreateCustomer',
            tenantId: ids.tenant,
            accountReference: 'CV-BLANK',
            displayName: '   ',
          },
          /name/i,
        ],
        [
          'credit account without limit',
          {
            commandType: 'CreateCustomerAccount',
            tenantId: ids.tenant,
            customerId: customer.customerId,
            accountType: 'CREDIT',
            currency: 'USD',
          },
          /credit limit/i,
        ],
        [
          'selected stations without any',
          {
            commandType: 'SetCustomerAccountStations',
            tenantId: ids.tenant,
            accountId: account.accountId,
            expectedVersion: 0,
            stationScope: 'SELECTED',
          },
          /at least one station/i,
        ],
      ];
      for (const [name, payload, pattern] of cases) {
        const result = await send(payload, `key-validate-${name.replaceAll(' ', '-')}`);
        expectPlainFailure(result, 400, 'VALIDATION_FAILED', pattern);
      }
    });

    it('rejects unreadable, unknown and keyless requests with plain messages', async () => {
      const badJson = await customerCommandPost(
        new Request('http://127.0.0.1:3000/api/customers/commands', {
          method: 'POST',
          headers: {
            ...clerkHeaders(tokens.admin),
            'content-type': 'application/json',
            'idempotency-key': 'key-bad-json',
          },
          body: '{ not json',
        }),
      );
      expectPlainFailure(
        { status: badJson.status, body: (await badJson.json()) as Json },
        400,
        'VALIDATION_FAILED',
      );

      const unknown = await send(
        { commandType: 'DropEverything', tenantId: ids.tenant },
        'key-unknown',
      );
      expectPlainFailure(unknown, 400, 'VALIDATION_FAILED');

      const keyless = await send(
        {
          commandType: 'CreateCustomer',
          tenantId: ids.tenant,
          accountReference: 'CV-KEYLESS',
          displayName: 'Keyless',
        },
        null,
      );
      expectPlainFailure(keyless, 400, 'VALIDATION_FAILED');
      const created = await client.unsafe<{ count: string }[]>(
        `select count(*)::text as count from app.customers where account_reference='CV-KEYLESS'`,
      );
      expect(created[0]!.count).toBe('0');
    });
  });
});
