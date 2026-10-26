import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as inventoryCommandPost } from '../../src/app/api/inventory/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for opening cost integration tests.');
}

const ids = {
  tenant: 'a5e80000-0000-4000-8000-000000000001',
  legal: 'a5e80000-0000-4000-8000-000000000011',
  station: 'a5e80000-0000-4000-8000-000000000021',
  admin: 'a5e80000-0000-4000-8000-000000000031',
  membership: 'a5e80000-0000-4000-8000-000000000041',
  session: 'a5e80000-0000-4000-8000-000000000051',
  product: 'a5e80000-0000-4000-8000-000000000061',
  tankWithStock: 'a5e80000-0000-4000-8000-000000000071',
  tankWithoutStock: 'a5e80000-0000-4000-8000-000000000072',
};
let client: Sql;

async function post(payload: Record<string, unknown>, key: string) {
  return inventoryCommandPost(
    new Request('http://127.0.0.1:3000/api/inventory/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders('opening-cost-token'),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    }),
  );
}

const base = { tenantId: ids.tenant, stationId: ids.station, currency: 'USD' };

describe('opening cost per litre (PostgreSQL)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-opening-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-opening-secret';
    client = postgres(databaseUrl!, { max: 4, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug)
      values ('${ids.tenant}', 'Opening Cost Tenant', 'opening-cost-tenant')
      on conflict (id) do nothing;
      insert into app.users (id, name, email)
      values ('${ids.admin}', 'Opening Admin', 'opening-admin@example.test')
      on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status)
      values ('${ids.membership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name)
      values ('${ids.legal}', '${ids.tenant}', 'Opening Cost Legal')
      on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status)
      values ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'OPENCOST', 'Opening Cost Station', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'TENANT', null, null)
      on conflict do nothing;
      insert into app.products (id, tenant_id, code, name)
      values ('${ids.product}', '${ids.tenant}', 'OPENCOST-ULP', 'Opening Cost Unleaded')
      on conflict (id) do nothing;
      insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, acceptable_variance_litres, created_by, updated_by)
      values
        ('${ids.tankWithStock}', '${ids.tenant}', '${ids.station}', 'OC-T1', '${ids.product}', 10000, 25, '${ids.membership}', '${ids.membership}'),
        ('${ids.tankWithoutStock}', '${ids.tenant}', '${ids.station}', 'OC-T2', '${ids.product}', 10000, 25, '${ids.membership}', '${ids.membership}')
      on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.session, 'opening-cost-token', ids.admin, true);
    await seedActiveStepUp(client, ids.session, ids.tenant);
  });

  afterAll(async () => client?.end());

  it('works the opening total out from the litres and the cost per litre, to four decimals', async () => {
    const opening = await post(
      {
        ...base,
        commandType: 'RecordOpeningBalance',
        tankId: ids.tankWithStock,
        quantityLitres: '5000.000',
        effectiveAt: '2026-09-27T06:00:00Z',
      },
      'opening-cost-balance-1',
    );
    expect(opening.status).toBe(200);

    const cost = await post(
      {
        ...base,
        commandType: 'RecordOpeningInventoryCost',
        tankId: ids.tankWithStock,
        unitCost: '1.234567',
      },
      'opening-cost-unit-1',
    );
    expect(cost.status).toBe(200);

    const events = await client.unsafe<{ amount: string; event_type: string }[]>(`
      select amount::text, event_type from app.inventory_cost_events
      where tenant_id = '${ids.tenant}' and tank_id = '${ids.tankWithStock}'
    `);
    // 5000 litres x 1.234567 = 6172.835, held exactly with no floating point.
    expect(events).toEqual([{ amount: '6172.8350', event_type: 'OPENING_COST' }]);
  });

  it('refuses a cost per litre together with a total, or for a tank with no opening litres', async () => {
    const both = await post(
      {
        ...base,
        commandType: 'RecordOpeningInventoryCost',
        tankId: ids.tankWithStock,
        unitCost: '1.20',
        amount: '100.0000',
      },
      'opening-cost-both-1',
    );
    expect(both.status).toBe(400);

    const noLitres = await post(
      {
        ...base,
        commandType: 'RecordOpeningInventoryCost',
        tankId: ids.tankWithoutStock,
        unitCost: '1.20',
      },
      'opening-cost-no-litres-1',
    );
    expect(noLitres.status).toBe(409);
    const body = (await noLitres.json()) as { message: string };
    expect(body.message).toContain('opening litres');
  });
});
