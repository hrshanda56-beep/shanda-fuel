import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as cashCommandPost } from '../../src/app/api/cash/commands/route';
import { GET as auditGet } from '../../src/app/api/audit/events/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for audit viewer integration tests.');

const ids = {
  tenant: 'a9d00000-0000-4000-8000-000000000001',
  otherTenant: 'a9d00000-0000-4000-8000-000000000002',
  legal: 'a9d00000-0000-4000-8000-000000000011',
  station: 'a9d00000-0000-4000-8000-000000000021',
  supervisorActor: 'a9d00000-0000-4000-8000-000000000031',
  supervisorMembership: 'a9d00000-0000-4000-8000-000000000041',
  supervisorSession: 'a9d00000-0000-4000-8000-000000000051',
  adminActor: 'a9d00000-0000-4000-8000-000000000032',
  adminMembership: 'a9d00000-0000-4000-8000-000000000042',
  adminSession: 'a9d00000-0000-4000-8000-000000000052',
  stationAdminActor: 'a9d00000-0000-4000-8000-000000000033',
  stationAdminMembership: 'a9d00000-0000-4000-8000-000000000043',
  stationAdminSession: 'a9d00000-0000-4000-8000-000000000053',
  till: 'a9d00000-0000-4000-8000-000000000081',
  safe: 'a9d00000-0000-4000-8000-000000000091',
};
const SUPERVISOR = 'a9d-supervisor-token';
const ADMIN = 'a9d-admin-token';
const STATION_ADMIN = 'a9d-station-admin-token';
let client: Sql;
let key = 0;

async function handover(counted: string, reason?: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': `a9d-${(key += 1)}`,
  });
  for (const [name, value] of Object.entries(clerkHeaders(SUPERVISOR))) headers.set(name, value);
  const response = await cashCommandPost(
    new Request('http://127.0.0.1:3000/api/cash/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: {
          organisationId: ids.tenant,
          legalEntityId: ids.legal,
          stationId: ids.station,
          allStations: false,
        },
        commandType: 'SubmitCashHandover',
        fromLocationId: ids.till,
        toLocationId: ids.safe,
        expectedAmount: '100',
        countedAmount: counted,
        ...(reason ? { reason } : {}),
      }),
    }),
  );
  expect(response.status).toBe(201);
}

async function read(token: string, query: Record<string, string> = {}, tenant = ids.tenant) {
  const params = new URLSearchParams({ tenantId: tenant, ...query });
  const response = await auditGet(
    new Request(`http://127.0.0.1:3000/api/audit/events?${params}`, {
      headers: { ...clerkHeaders(token) },
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe('audit viewer', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a9d-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a9d-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Audit Tenant', 'a9d-audit-tenant'),
        ('${ids.otherTenant}', 'Other Audit Tenant', 'a9d-other-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.supervisorActor}', 'Audit Supervisor', 'a9d-supervisor@example.test'),
        ('${ids.adminActor}', 'Audit Admin', 'a9d-admin@example.test'),
        ('${ids.stationAdminActor}', 'Audit Station Admin', 'a9d-station-admin@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE'),
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.adminActor}', 'ACTIVE'),
        ('${ids.stationAdminMembership}', '${ids.tenant}', '${ids.stationAdminActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Audit Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A9DST', 'Audit Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.stationAdminMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict (id) do nothing;
      insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type) values
        ('${ids.till}', '${ids.tenant}', '${ids.station}', 'A9D-TILL', 'Audit till', 'STATION_TILL'),
        ('${ids.safe}', '${ids.tenant}', '${ids.station}', 'A9D-SAFE', 'Audit safe', 'STATION_SAFE')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.supervisorSession, SUPERVISOR, ids.supervisorActor, true);
    await seedClerkSession(client, ids.adminSession, ADMIN, ids.adminActor, true);
    await seedClerkSession(
      client,
      ids.stationAdminSession,
      STATION_ADMIN,
      ids.stationAdminActor,
      true,
    );
    await seedActiveStepUp(client, ids.supervisorSession, ids.tenant);
    await seedActiveStepUp(client, ids.adminSession, ids.tenant);
    await seedActiveStepUp(client, ids.stationAdminSession, ids.tenant);
    await handover('100');
    await handover('90', 'Short at the till');
  });

  afterAll(async () => client?.end());

  it('shows names, never identifiers, for the records and values an event touched', async () => {
    const product = 'a9d00000-0000-4000-8000-0000000000a1';
    const tank = 'a9d00000-0000-4000-8000-0000000000a2';
    const price = 'a9d00000-0000-4000-8000-0000000000a3';
    const supplier = 'a9d00000-0000-4000-8000-0000000000a4';
    const order = 'a9d00000-0000-4000-8000-0000000000a5';
    const unknown = 'a9d00000-0000-4000-8000-0000000000ff';
    await client.unsafe(`
      insert into app.products (id, tenant_id, code, name) values ('${product}', '${ids.tenant}', 'A9D-DSL', 'Audit Diesel') on conflict (id) do nothing;
      insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, created_by, updated_by)
        values ('${tank}', '${ids.tenant}', '${ids.station}', 'A9DT1', '${product}', 10000, '${ids.adminMembership}', '${ids.adminMembership}') on conflict (id) do nothing;
      insert into app.selling_prices (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
        values ('${price}', '${ids.tenant}', '${ids.station}', '${product}', now(), 1.95, 'DRAFT', '${ids.adminMembership}') on conflict (id) do nothing;
      insert into app.suppliers (id, tenant_id, code, legal_name, created_by, updated_by)
        values ('${supplier}', '${ids.tenant}', 'A9D-SUP', 'Audit Supplier', '${ids.adminMembership}', '${ids.adminMembership}') on conflict (id) do nothing;
      insert into platform.security_events (tenant_id, membership_id, actor_id, event_code, request_id, details, key_id, signature)
        values
        ('${ids.tenant}', '${ids.adminMembership}', '${ids.adminActor}', 'AUDITNAMES.TANK_VARIANCE_LIMITS_SET', gen_random_uuid(),
          jsonb_build_object('subjectType', 'Tank', 'subjectId', '${tank}',
            'before', jsonb_build_object('productId', '${unknown}'),
            'after', jsonb_build_object('productId', '${product}', 'supplierId', '${supplier}')),
          'test', 'sig-a9d-1'),
        ('${ids.tenant}', '${ids.adminMembership}', '${ids.adminActor}', 'AUDITNAMES.PRICE_DRAFTED', gen_random_uuid(),
          jsonb_build_object('subjectType', 'SellingPrice', 'subjectId', '${price}'), 'test', 'sig-a9d-2');
    `);
    const { body } = await read(ADMIN, { limit: '10' });
    const tankEvent = body.items.find((item: Record<string, any>) =>
      /variance limits/i.test(item.action),
    );
    expect(tankEvent.subject).toBe('Tank tank A9DT1 (Audit Diesel)');
    expect(tankEvent.changes).toEqual(
      expect.arrayContaining([
        // The old value pointed at nothing we can name; the new ones are names.
        { field: 'Product', before: 'A record', after: 'Audit Diesel' },
        { field: 'Supplier', before: null, after: 'Audit Supplier' },
      ]),
    );
    const priceEvent = body.items.find((item: Record<string, any>) =>
      /price drafted/i.test(item.action),
    );
    expect(priceEvent.subject).toMatch(/^Selling price Audit Diesel at 1\.95/);
    // Only the shown wording is checked: an event's own id is not part of what a manager reads.
    const shown = body.items.map((item: Record<string, any>) =>
      JSON.stringify([item.subject, item.action, item.reason, item.changes]),
    );
    expect(shown.join(' ')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
  });

  it('shows who did what, with the values recorded, to an organisation-level reader', async () => {
    const { status, body } = await read(ADMIN, { area: 'CASH' });
    expect(status).toBe(200);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    const latest = body.items[0];
    expect(latest).toMatchObject({
      who: 'Audit Supervisor',
      area: 'Cash',
      action: 'Cash: submit cash handover',
      created: true,
    });
    expect(latest.changes.map((c: { field: string }) => c.field)).toEqual(
      expect.arrayContaining(['Expected amount', 'Counted amount']),
    );
  });

  it('pages through older events without repeating any', async () => {
    const first = await read(ADMIN, { area: 'CASH', limit: '1' });
    expect(first.body.items).toHaveLength(1);
    expect(first.body.next).toEqual(expect.any(String));
    const second = await read(ADMIN, { area: 'CASH', limit: '1', after: first.body.next });
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  });

  it('filters by area', async () => {
    const { body } = await read(ADMIN, { area: 'INVENTORY' });
    expect(body.items).toEqual([]);
  });

  it('refuses people who only hold station-level access', async () => {
    expect((await read(SUPERVISOR)).status).toBe(403);
    expect((await read(STATION_ADMIN)).status).toBe(403);
  });

  it('never returns another organisation’s history', async () => {
    const { status } = await read(ADMIN, {}, ids.otherTenant);
    expect([403, 404]).toContain(status);
  });

  it('rejects malformed paging input', async () => {
    expect((await read(ADMIN, { after: 'nonsense' })).status).toBe(400);
    expect((await read(ADMIN, { area: 'cash;drop' })).status).toBe(400);
  });
});
