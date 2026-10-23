import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as expenseCommandPost } from '../../src/app/api/expenses/commands/route';
import { getStaffBenefitExpensePreviewFromRequest } from '../../src/modules/customers/staff-benefit-expense-read';
import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for staff benefit expense integration tests.');
}

const ids = {
  tenant: 'b3f00000-0000-4000-8000-000000000001',
  legal: 'b3f00000-0000-4000-8000-000000000011',
  station: 'b3f00000-0000-4000-8000-000000000021',
  admin: 'b3f00000-0000-4000-8000-000000000031',
  adminMembership: 'b3f00000-0000-4000-8000-000000000041',
  adminSession: 'b3f00000-0000-4000-8000-000000000051',
  finance: 'b3f00000-0000-4000-8000-000000000032',
  financeMembership: 'b3f00000-0000-4000-8000-000000000042',
  financeSession: 'b3f00000-0000-4000-8000-000000000052',
  supervisor: 'b3f00000-0000-4000-8000-000000000033',
  supervisorMembership: 'b3f00000-0000-4000-8000-000000000043',
  supervisorSession: 'b3f00000-0000-4000-8000-000000000053',
  customer: 'b3f00000-0000-4000-8000-000000000061',
  account: 'b3f00000-0000-4000-8000-000000000062',
  emptyCustomer: 'b3f00000-0000-4000-8000-000000000063',
  emptyAccount: 'b3f00000-0000-4000-8000-000000000064',
  product: 'b3f00000-0000-4000-8000-000000000071',
  tenantB: 'b3f10000-0000-4000-8000-000000000001',
  legalB: 'b3f10000-0000-4000-8000-000000000011',
  stationB: 'b3f10000-0000-4000-8000-000000000021',
  adminB: 'b3f10000-0000-4000-8000-000000000031',
  adminBMembership: 'b3f10000-0000-4000-8000-000000000041',
  adminBSession: 'b3f10000-0000-4000-8000-000000000051',
};
const tokens = {
  admin: 'sbe-admin-token',
  finance: 'sbe-finance-token',
  supervisor: 'sbe-supervisor-token',
  adminB: 'sbe-admin-b-token',
};

type Json = Record<string, any>;
let client: Sql;

async function command(token: string | null, input: Json, key: string = randomUUID()) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-real-ip': `sbe-${randomUUID()}`,
  });
  if (token)
    for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
  const response = await expenseCommandPost(
    new Request('http://127.0.0.1:3000/api/expenses/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }),
  );
  return { status: response.status, json: (await response.json()) as Json };
}

const month = '2026-09';
const post = (overrides: Json = {}, token: string | null = tokens.admin) =>
  command(token, {
    commandType: 'SubmitStaffBenefitExpense',
    tenantId: ids.tenant,
    stationId: ids.station,
    accountId: ids.account,
    month,
    expectedAmount: '42.5000',
    ...overrides,
  });

async function fixtureAuthorization(
  accountId: string,
  customerId: string,
  litres: string,
  amount: string,
  requestedAt: string,
) {
  await client`
    insert into app.customer_fuel_authorizations (
      id, tenant_id, station_id, customer_id, account_id, account_type, product_id,
      requested_amount, requested_litres, used_amount, used_litres, remaining_amount,
      remaining_litres, state, source_type, source_id, source_key, requested_by, requested_at
    ) values (
      ${randomUUID()}, ${ids.tenant}, ${ids.station}, ${customerId}, ${accountId}, 'CREDIT',
      ${ids.product}, ${amount}, ${litres}, ${amount}, ${litres}, 0, 0, 'COMPLETED',
      'A5_RECONCILIATION_CUSTOMER_FUEL', ${randomUUID()}, ${`sbe-${randomUUID()}`},
      ${ids.adminMembership}, ${requestedAt}
    )`;
}

describe('Staff fuel benefit month-end expense (PostgreSQL)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-sbe-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-sbe-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'SBE Tenant', 'sbe-tenant'),
        ('${ids.tenantB}', 'SBE Tenant B', 'sbe-tenant-b')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.admin}', 'SBE Admin', 'sbe-admin@example.test'),
        ('${ids.finance}', 'SBE Finance', 'sbe-finance@example.test'),
        ('${ids.supervisor}', 'SBE Supervisor', 'sbe-supervisor@example.test'),
        ('${ids.adminB}', 'SBE Admin B', 'sbe-admin-b@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE'),
        ('${ids.financeMembership}', '${ids.tenant}', '${ids.finance}', 'ACTIVE'),
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisor}', 'ACTIVE'),
        ('${ids.adminBMembership}', '${ids.tenantB}', '${ids.adminB}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'SBE Legal'),
        ('${ids.legalB}', '${ids.tenantB}', 'SBE Legal B')
        on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'SBEST1', 'SBE Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationB}', '${ids.tenantB}', '${ids.legalB}', 'SBESTB', 'SBE Station B', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.financeMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenantB}', '${ids.adminBMembership}', 'ADMINISTRATOR', 'TENANT', null, null)
        on conflict do nothing;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.tenant}', 'SBE-D', 'Diesel')
        on conflict (id) do nothing;
      insert into app.customers (id, tenant_id, account_reference, display_name, created_by, updated_by, legal_entity_id) values
        ('${ids.customer}', '${ids.tenant}', 'SBE-C1', 'Tendai Moyo', '${ids.adminMembership}', '${ids.adminMembership}', '${ids.legal}'),
        ('${ids.emptyCustomer}', '${ids.tenant}', 'SBE-C2', 'Rudo Ncube', '${ids.adminMembership}', '${ids.adminMembership}', '${ids.legal}')
        on conflict (id) do nothing;
      insert into app.customer_accounts (id, tenant_id, customer_id, account_type, credit_limit, created_by, updated_by, legal_entity_id) values
        ('${ids.account}', '${ids.tenant}', '${ids.customer}', 'CREDIT', 100, '${ids.adminMembership}', '${ids.adminMembership}', '${ids.legal}'),
        ('${ids.emptyAccount}', '${ids.tenant}', '${ids.emptyCustomer}', 'CREDIT', 100, '${ids.adminMembership}', '${ids.adminMembership}', '${ids.legal}')
        on conflict (id) do nothing;
      insert into app.customer_staff_benefit_terms (tenant_id, account_id, staff_name, created_by) values
        ('${ids.tenant}', '${ids.account}', 'Tendai Moyo', '${ids.adminMembership}'),
        ('${ids.tenant}', '${ids.emptyAccount}', 'Rudo Ncube', '${ids.adminMembership}')
        on conflict do nothing;
    `);
    // Fuel taken by Tendai, with the station's own time zone deciding the month (Harare is UTC+2):
    //  - 2026-08-31 23:30 UTC is 01:30 on 1 September in Harare: counts in September.
    //  - 2026-09-15 is September.
    //  - 2026-09-30 22:30 UTC is 00:30 on 1 October in Harare: does not count.
    await fixtureAuthorization(
      ids.account,
      ids.customer,
      '10.000',
      '15.0000',
      '2026-08-31T23:30:00Z',
    );
    await fixtureAuthorization(
      ids.account,
      ids.customer,
      '40.000',
      '60.0000',
      '2026-09-15T10:00:00Z',
    );
    await fixtureAuthorization(
      ids.account,
      ids.customer,
      '99.000',
      '150.0000',
      '2026-09-30T22:30:00Z',
    );
    // The station's September costed sales: 1000 litres that cost 850.00 (0.85 a litre). Foreign keys
    // and the append-only guard are bypassed for these fixture rows only.
    await client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      for (const [litres, cogs, date] of [
        ['400.000', '340.0000', '2026-09-03'],
        ['600.000', '510.0000', '2026-09-20'],
        ['500.000', '999.0000', '2026-10-02'],
      ] as const) {
        await tx`
          insert into app.inventory_sale_cost_attributions (
            id, tenant_id, station_id, tank_id, product_id, inventory_movement_id, meter_segment_id,
            sale_quantity_litres, pre_sale_wac, original_cogs, valuation_status, valuation_basis,
            replay_fingerprint, sale_cost_event_id, effective_at, business_date
          ) values (
            ${randomUUID()}, ${ids.tenant}, ${ids.station}, ${randomUUID()}, ${ids.product},
            ${randomUUID()}, ${randomUUID()}, ${litres}, 0.85, ${cogs}, 'VALUED', 'PRE_SALE_WAC',
            'sbe-fingerprint', ${randomUUID()}, ${`${date}T09:00:00Z`}, ${date}
          )`;
      }
    });
    await seedClerkSession(client, ids.adminSession, tokens.admin, ids.admin, true);
    await seedClerkSession(client, ids.financeSession, tokens.finance, ids.finance, true);
    await seedClerkSession(client, ids.supervisorSession, tokens.supervisor, ids.supervisor, true);
    await seedClerkSession(client, ids.adminBSession, tokens.adminB, ids.adminB, true);
    for (const [session, tenant] of [
      [ids.adminSession, ids.tenant],
      [ids.financeSession, ids.tenant],
      [ids.supervisorSession, ids.tenant],
      [ids.adminBSession, ids.tenantB],
    ] as const) {
      await seedActiveStepUp(client, session, tenant);
    }
  });

  afterAll(async () => client?.end());

  it('is only for owners and administrators', async () => {
    expect((await post({}, null)).status).toBe(401);
    expect((await post({}, tokens.finance)).status).toBe(403);
    expect((await post({}, tokens.supervisor)).status).toBe(403);
    const rows = await client`select 1 from app.expenses where tenant_id = ${ids.tenant}`;
    expect(rows).toHaveLength(0);
  });

  it('shows the month at cost before anything is posted', async () => {
    const url = new URL('http://127.0.0.1:3000/customers/staff-benefit/expense');
    const preview = await getStaffBenefitExpensePreviewFromRequest(
      new Request(url, { headers: clerkHeaders(tokens.admin) }),
      { tenantId: ids.tenant, stationId: ids.station, month },
    );
    const tendai = preview.find((row) => row.accountId === ids.account)!;
    expect(tendai).toMatchObject({ staffName: 'Tendai Moyo', closed: true, existingExpense: null });
    expect(tendai.cost).toMatchObject({ status: 'READY', total: '42.5000' });
    expect(tendai.cost.status === 'READY' && tendai.cost.lines).toEqual([
      {
        productId: ids.product,
        productName: 'Diesel',
        litres: '50.000',
        soldValue: '75.0000',
        costPerLitre: '0.85000000',
        cost: '42.5000',
      },
    ]);
    expect(preview.find((row) => row.accountId === ids.emptyAccount)!.cost).toEqual({
      status: 'NO_FUEL',
    });
    await expect(
      getStaffBenefitExpensePreviewFromRequest(
        new Request(url, { headers: clerkHeaders(tokens.finance) }),
        { tenantId: ids.tenant, stationId: ids.station, month },
      ),
    ).rejects.toThrow();
  });

  it('refuses an open month, a changed figure, and an account that took no fuel', async () => {
    const open = await post({ month: '2099-12' });
    expect(open.status).toBe(409);
    const wrongFigure = await post({ expectedAmount: '42.0000' });
    expect(wrongFigure.status).toBe(409);
    expect(wrongFigure.json.details?.currentAmount ?? wrongFigure.json.currentAmount).toBe(
      '42.5000',
    );
    const noFuel = await post({ accountId: ids.emptyAccount, expectedAmount: '1.0000' });
    expect(noFuel.status).toBe(409);
    const missingCost = await post({ month: '2026-08', expectedAmount: '1.0000' });
    expect(missingCost.status).toBe(409);
    const rows = await client`select 1 from app.expenses where tenant_id = ${ids.tenant}`;
    expect(rows).toHaveLength(0);
  });

  it('submits one expense at cost, then refuses a second for the same account and month', async () => {
    const first = await post({}, tokens.admin);
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ state: 'SUBMITTED', amount: '42.5000', month });
    const row = (
      await client`
        select e.state, e.amount::text as amount, e.expense_date, e.reference, e.description,
               c.code, c.classification
        from app.expenses e join app.expense_categories c on c.id = e.category_id
        where e.id = ${first.json.expenseId}`
    )[0]!;
    expect(row).toMatchObject({
      state: 'SUBMITTED',
      amount: '42.5000',
      expense_date: '2026-09-30',
      reference: `STAFF-BENEFIT:${ids.account}:${month}`,
      code: 'STAFF_FUEL_BENEFIT',
      classification: 'OPERATING',
    });
    expect(row.description).toContain('Tendai Moyo');

    const again = await post({}, tokens.admin);
    expect(again.status).toBe(409);
    expect((await client`select 1 from app.expenses where tenant_id = ${ids.tenant}`).length).toBe(
      1,
    );
  });

  it('then follows the ordinary expense workflow, including reversal and a corrected re-entry', async () => {
    const id = (
      await client`select id, version from app.expenses where tenant_id = ${ids.tenant}`
    )[0]!;
    const station = { tenantId: ids.tenant, stationId: ids.station };
    const approved = await command(tokens.finance, {
      ...station,
      commandType: 'ApproveExpense',
      expenseId: id.id,
      expectedVersion: Number(id.version),
    });
    expect(approved.status).toBe(200);
    const posted = await command(tokens.admin, {
      ...station,
      commandType: 'PostExpense',
      expenseId: id.id,
      expectedVersion: approved.json.version,
    });
    expect(posted.status).toBe(200);
    // A posted expense still blocks a duplicate.
    expect((await post({}, tokens.admin)).status).toBe(409);

    const reversed = await command(tokens.admin, {
      ...station,
      commandType: 'ReverseExpense',
      expenseId: id.id,
      expectedVersion: posted.json.version,
      reason: 'Entered against the wrong month',
    });
    expect(reversed.status).toBe(200);
    // Reversing frees the month so it can be entered again.
    const redo = await post({}, tokens.admin);
    expect(redo.status).toBe(201);
    expect(
      (
        await client`select 1 from app.expenses where tenant_id = ${ids.tenant} and state <> 'REVERSED'`
      ).length,
    ).toBe(1);
    const audit = await client`
      select 1 from platform.security_events
      where tenant_id = ${ids.tenant} and event_code = 'EXPENSE.STAFF_BENEFIT_SUBMITTED'`;
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('does not cross organisations', async () => {
    // Another organisation's administrator cannot reach this account, even with their own context.
    const own = await post({ tenantId: ids.tenantB, stationId: ids.stationB }, tokens.adminB);
    expect(own.status).toBe(404);
    // Nor can they name this organisation.
    const foreign = await post({}, tokens.adminB);
    expect(foreign.status).toBe(403);
    expect((await client`select 1 from app.expenses where tenant_id = ${ids.tenantB}`).length).toBe(
      0,
    );
  });
});
