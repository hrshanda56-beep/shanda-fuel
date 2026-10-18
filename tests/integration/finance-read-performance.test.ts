import { getDashboardFromRequest } from '../../src/modules/dashboard/queries';
import { getDashboardSalesFromRequest } from '../../src/modules/reporting/queries';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { GET as cashGet } from '../../src/app/api/cash/summary/route';
import { GET as settlementsGet } from '../../src/app/api/settlements/overview/route';
import { GET as customersGet } from '../../src/app/api/customers/summary/route';
import { GET as suppliersGet } from '../../src/app/api/suppliers/summary/route';
import { loadActionCenterFacts } from '../../src/modules/approvals/action-center';
import { getDatabase, closeDatabase } from '../../src/platform/db/client';
const enabled = process.env.RUN_FINANCE_READ_TESTS === '1';
const ids = {
  tenant: randomUUID(),
  other: randomUUID(),
  actor: randomUUID(),
  otherActor: randomUUID(),
  membership: randomUUID(),
  otherMembership: randomUUID(),
  entity: randomUUID(),
  otherEntity: randomUUID(),
  station: randomUUID(),
  otherStation: randomUUID(),
  customer: randomUUID(),
  otherCustomer: randomUUID(),
  account: randomUUID(),
  session: randomUUID(),
};
let client: Sql;
const token = 'finance-read-' + ids.session;
const request = (path: string, query: Record<string, string>) =>
  new Request('http://localhost' + path + '?' + new URLSearchParams(query), {
    headers: clerkHeaders(token),
  });
describe.skipIf(!enabled)('optimized finance reads under app_runtime', { timeout: 30000 }, () => {
  beforeAll(async () => {
    for (const value of [process.env.DATABASE_URL, process.env.FINANCE_RUNTIME_DATABASE_URL]) {
      if (!value || new URL(value).hostname !== '127.0.0.1')
        throw new Error('Dedicated local owner/runtime URLs required');
    }
    client = postgres(process.env.DATABASE_URL!, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    await client.begin(async (tx) => {
      for (const [tenant, actor, membership, entity, station, customer] of [
        [ids.tenant, ids.actor, ids.membership, ids.entity, ids.station, ids.customer],
        [
          ids.other,
          ids.otherActor,
          ids.otherMembership,
          ids.otherEntity,
          ids.otherStation,
          ids.otherCustomer,
        ],
      ] as const) {
        await tx`insert into app.users(id,name) values(${actor},'Finance read fixture')`;
        await tx`insert into app.tenants(id,name,slug) values(${tenant},'Finance read fixture',${tenant})`;
        await tx`insert into app.memberships(id,tenant_id,identity_id,status) values(${membership},${tenant},${actor},'ACTIVE')`;
        await tx`insert into app.legal_entities(id,tenant_id,legal_name) values(${entity},${tenant},'Finance entity')`;
        await tx`insert into app.stations(id,tenant_id,legal_entity_id,code,name,status,timezone) values(${station},${tenant},${entity},'TEST','Finance station','ACTIVE','Africa/Harare')`;
        await tx`insert into app.membership_role_assignments(tenant_id,membership_id,role_code,scope_type) values(${tenant},${membership},'OWNER','TENANT')`;
        await tx`insert into app.customers(id,tenant_id,account_reference,display_name,legal_entity_id,created_by,updated_by) values(${customer},${tenant},'FIN-READ','Finance customer',${entity},${membership},${membership})`;
      }
      await tx`insert into app.customer_accounts(id,tenant_id,customer_id,account_type,legal_entity_id,credit_limit,station_scope,station_scope_configured,created_by,updated_by) values(${ids.account},${ids.tenant},${ids.customer},'CREDIT',${ids.entity},1000.1234,'ALL',true,${ids.membership},${ids.membership})`;
    });
    await seedClerkSession(client, ids.session, token, ids.actor);
    await seedActiveStepUp(client, ids.session, ids.tenant);
  });
  afterAll(async () => {
    await closeDatabase();
    if (!client) return;
    await client.begin(async (tx) => {
      for (const tenant of [ids.tenant, ids.other]) {
        await tx`delete from app.customer_accounts where tenant_id=${tenant}`;
        await tx`delete from app.customers where tenant_id=${tenant}`;
        await tx`delete from app.membership_role_assignments where tenant_id=${tenant}`;
        await tx`delete from app.stations where tenant_id=${tenant}`;
        await tx`delete from app.legal_entities where tenant_id=${tenant}`;
        await tx`delete from app.memberships where tenant_id=${tenant}`;
        await tx`delete from app.tenants where id=${tenant}`;
      }
      await tx`delete from app.auth_identities where internal_user_id in (${ids.actor},${ids.otherActor})`;
      await tx`delete from app.users where id in (${ids.actor},${ids.otherActor})`;
    });
    await client.end();
  });
  it('uses the real application runtime role for read queries', async () => {
    const rows = await getDatabase().execute<{ role: string }>(sql`select current_user as role`);
    expect(rows[0]?.role).toBe('app_runtime');
  });
  it('executes the single-exchange cash query with full station validation', async () => {
    const response = await cashGet(
      request('/api/cash/summary', {
        tenantId: ids.tenant,
        legalEntityId: ids.entity,
        stationId: ids.station,
      }),
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect((await response.json()).totals.availableAtStation).toBe('0');
  });
  it('executes both settlement sections through one endpoint', async () => {
    const response = await settlementsGet(
      request('/api/settlements/overview', { tenantId: ids.tenant, stationId: ids.station }),
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(await response.json()).toEqual({ settlements: [], unmatched: [] });
  });
  it('preserves exact customer limits and excludes the other tenant', async () => {
    const response = await customersGet(
      request('/api/customers/summary', { tenantId: ids.tenant }),
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const data = await response.json();
    expect(data.customers).toHaveLength(1);
    expect(data.customers[0].customerId).toBe(ids.customer);
    expect(data.customers[0].accounts[0].creditLimit).toBe('1000.1234');
  });
  it('executes supplier reads with scoped entity authority', async () => {
    const response = await suppliersGet(
      request('/api/suppliers/summary', { tenantId: ids.tenant, legalEntityId: ids.entity }),
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(await response.json()).toEqual([]);
  });
  it('loads all permission-gated Finance sections successfully', async () => {
    const facts = await loadActionCenterFacts(request('/finance', {}), {
      organisationId: ids.tenant,
      legalEntityId: ids.entity,
      stationId: ids.station,
      allStations: false,
    });
    expect({
      cash: facts.cash.status,
      settlements: facts.settlements.status,
      suppliers: facts.suppliers.status,
      reconciliations: facts.reconciliations.status,
      revaluations: facts.revaluations.status,
    }).toEqual({
      cash: 'ok',
      settlements: 'ok',
      suppliers: 'ok',
      reconciliations: 'ok',
      revaluations: 'ok',
    });
  });
  it('loads dashboard projections directly through runtime-scoped queries', async () => {
    const result = await getDashboardFromRequest(request('/', {}), {
      tenantId: ids.tenant,
      stationId: ids.station,
      fromDate: '2026-10-01',
      toDate: '2026-10-18',
    });
    expect(result.daily.status).toBe('ready');
    expect(result.customers.status).toBe('ready');
    expect(result.operations?.status).toBe('ready');
    expect(result.chart.status).toBe('ready');
  });
  it('rejects foreign station scope in server-loaded chart data', async () => {
    await expect(
      getDashboardSalesFromRequest(request('/', {}), {
        tenantId: ids.tenant,
        stationIds: ids.otherStation,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects a cross-tenant station before returning financial data', async () => {
    const response = await settlementsGet(
      request('/api/settlements/overview', { tenantId: ids.other, stationId: ids.otherStation }),
    );
    expect(response.status).toBe(403);
  });
  it('rejects a mismatched station/legal entity in the cash API', async () => {
    const response = await cashGet(
      request('/api/cash/summary', {
        tenantId: ids.tenant,
        legalEntityId: ids.otherEntity,
        stationId: ids.station,
      }),
    );
    expect(response.status).toBe(403);
  });
});
