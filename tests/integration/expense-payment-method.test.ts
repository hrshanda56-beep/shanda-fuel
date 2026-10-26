import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as expenseCommandPost } from '../../src/app/api/expenses/commands/route';
import { POST as cashCommandPost } from '../../src/app/api/cash/commands/route';
import { GET as cashSummaryGet } from '../../src/app/api/cash/summary/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('DATABASE_URL is required for expense payment integration tests.');

const ids = {
  tenant: 'e7a00000-0000-4000-8000-000000000001',
  legal: 'e7a00000-0000-4000-8000-000000000011',
  station: 'e7a00000-0000-4000-8000-000000000021',
  admin: 'e7a00000-0000-4000-8000-000000000031',
  adminMembership: 'e7a00000-0000-4000-8000-000000000041',
  adminSession: 'e7a00000-0000-4000-8000-000000000051',
  day: 'e7a00000-0000-4000-8000-000000000061',
  reconciliation: 'e7a00000-0000-4000-8000-000000000071',
  till: 'e7a00000-0000-4000-8000-000000000081',
};
const TOKEN = 'e7-admin-token';
type Json = Record<string, any>;
let client: Sql;

async function post(
  handler: typeof expenseCommandPost,
  url: string,
  input: Json,
  key = randomUUID(),
) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-real-ip': `e7-${randomUUID()}`,
  });
  for (const [name, value] of Object.entries(clerkHeaders(TOKEN))) headers.set(name, value);
  const response = await handler(
    new Request(url, { method: 'POST', headers, body: JSON.stringify(input) }),
  );
  return { status: response.status, json: (await response.json()) as Json };
}
const expense = (input: Json) =>
  post(expenseCommandPost, 'http://127.0.0.1:3000/api/expenses/commands', input);
const cash = (input: Json) =>
  post(cashCommandPost, 'http://127.0.0.1:3000/api/cash/commands', input);

describe('how an expense was paid, and the cash left to collect', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-e7-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-e7-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'E7 Tenant', 'e7-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values ('${ids.admin}', 'E7 Admin', 'e7-admin@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${ids.legal}', '${ids.tenant}', 'E7 Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone)
        values ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'E7ST', 'E7 Station', 'ACTIVE', 'Africa/Harare') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null) on conflict do nothing;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-10-20', 'NOT_STARTED') on conflict (id) do nothing;
      insert into app.reconciliations (id, tenant_id, station_id, business_day_id, state, version)
        values ('${ids.reconciliation}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'DRAFT', 0) on conflict (id) do nothing;
      insert into app.reconciliation_cash_declarations
        (id, tenant_id, station_id, reconciliation_id, counted_cash, expected_physical_cash, cash_paid_expenses, net_expected_cash, cash_variance, entered_by)
        values ('${randomUUID()}', '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', 1000, 1000, 0, 1000, 0, '${ids.adminMembership}')
        on conflict (tenant_id, station_id, reconciliation_id) do nothing;
      update app.reconciliations set state = 'SUBMITTED', submitted_by = '${ids.adminMembership}', submitted_at = now()
        where id = '${ids.reconciliation}' and state = 'DRAFT';
      update app.reconciliations set state = 'APPROVED', approved_by = '${ids.adminMembership}', approved_at = now()
        where id = '${ids.reconciliation}' and state = 'SUBMITTED';
      insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type)
        values ('${ids.till}', '${ids.tenant}', '${ids.station}', 'E7-TILL', 'E7 till', 'STATION_TILL') on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.adminSession, TOKEN, ids.admin, true);
    await seedActiveStepUp(client, ids.adminSession, ids.tenant);
  });
  afterAll(async () => client?.end());

  it('keeps staff fuel out of the expense categories and the expense form', async () => {
    const make = (code: string, name: string) =>
      expense({
        commandType: 'CreateExpenseCategory',
        tenantId: ids.tenant,
        legalEntityId: ids.legal,
        code,
        name,
        classification: 'OPERATING',
      });
    const refused = await make('E7-STAFF', 'Staff fuel');
    expect(refused.status).toBe(400);
    expect(String(refused.json.message)).toMatch(/staff fuel benefit account/i);
    // The month-end benefit flow creates its own category with the reserved code.
    expect((await make('STAFF_FUEL_BENEFIT', 'Staff fuel benefit')).status).toBe(201);
    const reserved = await client<{ id: string }[]>`
      select id from app.expense_categories where tenant_id = ${ids.tenant} and code = 'STAFF_FUEL_BENEFIT'`;
    const submit = await expense({
      commandType: 'SubmitExpense',
      tenantId: ids.tenant,
      stationId: ids.station,
      categoryId: reserved[0]!.id,
      expenseDate: '2026-10-20',
      description: 'Fuel for staff',
      amount: '10.0000',
    });
    expect(submit.status).toBe(400);
    expect(String(submit.json.message)).toMatch(/staff fuel/i);
  });

  it('takes station cash paid out off the cash that can be collected', async () => {
    const category = await expense({
      commandType: 'CreateExpenseCategory',
      tenantId: ids.tenant,
      legalEntityId: ids.legal,
      code: 'E7-GEN',
      name: 'Generator',
      classification: 'OPERATING',
    });
    expect(category.status).toBe(201);
    const submit = (amount: string, paymentMethod: string, reference: string) =>
      expense({
        commandType: 'SubmitExpense',
        tenantId: ids.tenant,
        stationId: ids.station,
        categoryId: category.json.categoryId,
        expenseDate: '2026-10-20',
        description: 'Generator diesel',
        amount,
        paymentMethod,
        reference,
      });
    // Paid by EcoCash: the till is untouched. Paid from station cash: 50 left the till.
    expect((await submit('30.0000', 'ECOCASH', 'E7-ECO')).status).toBe(201);
    expect((await submit('50.0000', 'STATION_CASH', 'E7-CASH')).status).toBe(201);

    const summary = await cashSummaryGet(
      new Request(
        `http://127.0.0.1:3000/api/cash/summary?tenantId=${ids.tenant}&stationId=${ids.station}`,
        { headers: { ...clerkHeaders(TOKEN) } },
      ),
    );
    const body = (await summary.json()) as Json;
    expect(body.cashPosition).toEqual({
      openToCollect: '1000',
      paidOut: '50',
      cashToCollect: '950',
    });

    const collect = (amount: string, reference: string) =>
      cash({
        commandType: 'RecordCashCollection',
        context: {
          organisationId: ids.tenant,
          legalEntityId: ids.legal,
          stationId: ids.station,
          allStations: false,
        },
        collectionReference: reference,
        sourceLocationId: ids.till,
        sources: [{ reconciliationId: ids.reconciliation, amount }],
      });
    const tooMuch = await collect('1000.00', 'E7-COL-1');
    expect(tooMuch.status).toBe(409);
    expect(String(tooMuch.json.message)).toMatch(/only USD 950 can be collected/);
    expect((await collect('950.00', 'E7-COL-2')).status).toBe(201);
  });
});
