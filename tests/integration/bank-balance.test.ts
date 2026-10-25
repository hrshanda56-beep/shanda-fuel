import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { POST as setupPost } from '../../src/app/api/setup/commands/route';
import { GET as balancesGet } from '../../src/app/api/setup/bank-balances/route';
import { readOwnerPosition } from '../../src/modules/reporting/owner-position';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for bank balance tests.');

const ids = {
  tenant: 'ba2e0000-0000-4000-8000-000000000001',
  otherTenant: 'ba2e0000-0000-4000-8000-000000000002',
  legal: 'ba2e0000-0000-4000-8000-000000000011',
  station: 'ba2e0000-0000-4000-8000-000000000021',
  bankA: 'ba2e0000-0000-4000-8000-000000000061',
  bankB: 'ba2e0000-0000-4000-8000-000000000062',
  adminActor: 'ba2e0000-0000-4000-8000-000000000032',
  adminMembership: 'ba2e0000-0000-4000-8000-000000000042',
  adminSession: 'ba2e0000-0000-4000-8000-000000000052',
  attendantActor: 'ba2e0000-0000-4000-8000-000000000033',
  attendantMembership: 'ba2e0000-0000-4000-8000-000000000043',
  attendantSession: 'ba2e0000-0000-4000-8000-000000000053',
};
const ADMIN = 'ba2e-admin-token';
const ATTENDANT = 'ba2e-attendant-token';
let client: Sql;
let reader: Sql;
let key = 0;

async function record(token: string, body: Record<string, unknown>) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': `ba2e-${(key += 1)}`,
  });
  for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
  const response = await setupPost(
    new Request('http://127.0.0.1:3000/api/setup/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commandType: 'RecordBankBalance',
        tenantId: ids.tenant,
        stationId: ids.station,
        bankAccountId: ids.bankA,
        balance: '1000.50',
        asOfDate: '2026-10-20',
        ...body,
      }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function read(token: string) {
  const response = await balancesGet(
    new Request(`http://127.0.0.1:3000/api/setup/bank-balances?tenantId=${ids.tenant}`, {
      headers: { ...clerkHeaders(token) },
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

/** Read through a plain connection; the query itself is limited to the tenant. */
async function ownerPosition() {
  return readOwnerPosition(drizzle(reader) as never, { tenantId: ids.tenant, stationIds: [] });
}

describe('typed-in bank balances', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-ba2e-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-ba2e-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    reader = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Bank Tenant', 'ba2e-bank-tenant'),
        ('${ids.otherTenant}', 'Other Bank Tenant', 'ba2e-other-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.adminActor}', 'Bank Admin', 'ba2e-admin@example.test'),
        ('${ids.attendantActor}', 'Bank Attendant', 'ba2e-attendant@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.adminActor}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendantActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Bank Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'BA2EST', 'Bank Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.bank_accounts (id, tenant_id, legal_entity_id, name, bank_name, account_reference_masked) values
        ('${ids.bankA}', '${ids.tenant}', '${ids.legal}', 'Main account', 'CBZ', '****1111'),
        ('${ids.bankB}', '${ids.tenant}', '${ids.legal}', 'Savings', 'CBZ', '****2222')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.adminSession, ADMIN, ids.adminActor, true);
    await seedClerkSession(client, ids.attendantSession, ATTENDANT, ids.attendantActor, true);
    await seedActiveStepUp(client, ids.adminSession, ids.tenant);
    await seedActiveStepUp(client, ids.attendantSession, ids.tenant);
  });

  afterAll(async () => {
    await client?.end();
    await reader?.end();
  });

  it('lists every active account, with or without a balance', async () => {
    const view = await read(ADMIN);
    expect(view.status).toBe(200);
    expect(view.body.canRecord).toBe(true);
    expect(view.body.accounts.map((a: any) => [a.name, a.balance])).toEqual([
      ['Main account', null],
      ['Savings', null],
    ]);
  });

  it('records a balance and shows the newest one, keeping the older line', async () => {
    expect((await record(ADMIN, {})).status).toBe(200);
    expect((await record(ADMIN, { balance: '1200.00', asOfDate: '2026-10-22' })).status).toBe(200);
    const main = (await read(ADMIN)).body.accounts.find((a: any) => a.name === 'Main account');
    expect(main).toMatchObject({ balance: '1200.0000', asOfDate: '2026-10-22' });
    const lines = await client.unsafe(
      `select count(*)::int as n from app.bank_balance_statements where bank_account_id = '${ids.bankA}'`,
    );
    expect(lines[0]!.n).toBe(2);
  });

  it('refuses a balance dated before the one already entered', async () => {
    const stale = await record(ADMIN, { balance: '5.00', asOfDate: '2026-10-21' });
    expect(stale.status).toBe(409);
  });

  it('gives no bank figure until every account has a balance, then adds them exactly', async () => {
    const partial = await ownerPosition();
    expect(partial.bankBalance).toMatchObject({
      amount: null,
      accountsWithBalance: 1,
      accountsTotal: 2,
    });
    expect(
      (await record(ADMIN, { bankAccountId: ids.bankB, balance: '99.25', asOfDate: '2026-10-18' }))
        .status,
    ).toBe(200);
    const complete = await ownerPosition();
    expect(complete.bankBalance).toMatchObject({
      amount: '1299.2500',
      asOfDate: '2026-10-18',
      accountsWithBalance: 2,
      accountsTotal: 2,
    });
  });

  it('rejects bad numbers and dates', async () => {
    for (const bad of [{ balance: 'lots' }, { balance: '1.23456' }, { asOfDate: '20/10/2026' }]) {
      expect((await record(ADMIN, bad)).status).toBe(400);
    }
  });

  it('does not let an attendant type in a balance', async () => {
    expect((await record(ATTENDANT, {})).status).toBe(403);
  });

  it('cannot be edited or deleted by the app role', async () => {
    const privileges = await client.unsafe(`
      select has_table_privilege('app_runtime', 'app.bank_balance_statements', 'UPDATE') as upd,
             has_table_privilege('app_runtime', 'app.bank_balance_statements', 'DELETE') as del
    `);
    expect(privileges[0]).toMatchObject({ upd: false, del: false });
  });
});
