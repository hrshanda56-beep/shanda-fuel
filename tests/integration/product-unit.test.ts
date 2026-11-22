import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as setupPost } from '../../src/app/api/setup/commands/route';
import { GET as overviewGet } from '../../src/app/api/setup/overview/route';
import { POST as inventoryPost } from '../../src/app/api/inventory/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for setup integration tests.');

// Fresh identifiers per run: the shared test database is never reset between runs.
const run = randomUUID().slice(0, 8);
const p = (_n: number) => randomUUID();
const ids = {
  tenantA: p(1),
  tenantB: p(2),
  legalA: p(11),
  legalB: p(12),
  stationA: p(21),
  stationB: p(22),
  stationOther: p(23),
  ownerUser: p(31),
  attendantUser: p(32),
  ownerBUser: p(33),
  ownerMembership: p(41),
  attendantMembership: p(42),
  ownerBMembership: p(43),
  ownerSession: p(51),
  attendantSession: p(52),
  ownerBSession: p(53),
  shiftTemplate: p(61),
};
const tokens = {
  owner: `setup-a-owner-${run}`,
  attendant: `setup-a-attendant-${run}`,
  ownerB: `setup-a-ownerb-${run}`,
};

let client: Sql;
const signed = tokens;

async function post(
  handler: (r: Request) => Promise<Response>,
  who: keyof typeof tokens,
  key: string,
  body: Record<string, unknown>,
) {
  const res = await handler(
    new Request('http://127.0.0.1:3000/api/x', {
      method: 'POST',
      headers: {
        ...clerkHeaders(signed[who]),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const A = { tenantId: ids.tenantA, stationId: ids.stationA };

async function overview(
  who: keyof typeof tokens,
  tenantId = ids.tenantA,
  stationId = ids.stationA,
) {
  const res = await overviewGet(
    new Request(
      `http://127.0.0.1:3000/api/setup/overview?tenantId=${tenantId}&stationId=${stationId}`,
      { headers: { ...clerkHeaders(signed[who]) } },
    ),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('Fuel measuring unit (PostgreSQL)', { timeout: 60_000 }, () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';

    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-setup-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-setup-secret';
    client = postgres(databaseUrl, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenantA}', 'Setup Tenant A', 'unit-tenant-${run}'),
        ('${ids.tenantB}', 'Setup Tenant B', 'unit-tenant-b-${run}') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.ownerUser}', 'Setup Owner', 'unit-owner-${run}@example.test'),
        ('${ids.attendantUser}', 'Setup Attendant', 'unit-attendant-${run}@example.test'),
        ('${ids.ownerBUser}', 'Setup Owner B', 'unit-ownerb-${run}@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.ownerMembership}', '${ids.tenantA}', '${ids.ownerUser}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenantA}', '${ids.attendantUser}', 'ACTIVE'),
        ('${ids.ownerBMembership}', '${ids.tenantB}', '${ids.ownerBUser}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legalA}', '${ids.tenantA}', 'Setup Legal A'),
        ('${ids.legalB}', '${ids.tenantB}', 'Setup Legal B') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.stationA}', '${ids.tenantA}', '${ids.legalA}', 'A${run}', 'Setup Station A', 'ONBOARDING'),
        ('${ids.stationB}', '${ids.tenantB}', '${ids.legalB}', 'B${run}', 'Setup Station B', 'ONBOARDING') on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenantA}', '${ids.ownerMembership}', 'OWNER', 'TENANT', null, null),
        ('${ids.tenantA}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legalA}', '${ids.stationA}'),
        ('${ids.tenantB}', '${ids.ownerBMembership}', 'OWNER', 'TENANT', null, null)
        on conflict do nothing;
    `);
    await seedClerkSession(client, ids.ownerSession, tokens.owner, ids.ownerUser, true);
    await seedClerkSession(client, ids.attendantSession, tokens.attendant, ids.attendantUser, true);
    await seedClerkSession(client, ids.ownerBSession, tokens.ownerB, ids.ownerBUser, true);
    await seedActiveStepUp(client, ids.ownerSession, ids.tenantA);
    await seedActiveStepUp(client, ids.attendantSession, ids.tenantA);
    await seedActiveStepUp(client, ids.ownerBSession, ids.tenantB);
  });

  afterAll(async () => {
    await client?.end();
  });

  const state: Record<string, string> = {};
  const unitOf = async (id: string) =>
    (
      (await client`select unit from app.products where id = ${id}`) as unknown as Array<{
        unit: string;
      }>
    )[0]?.unit;

  it('creates a fuel in kilograms and shows the unit in the setup overview', async () => {
    const created = await post(setupPost, 'owner', 'unit-create-1', {
      commandType: 'CreateProduct',
      ...A,
      code: 'LPG',
      name: 'LPG',
      unit: 'KILOGRAMS',
    });
    expect(created.status).toBe(200);
    state.lpg = created.body.productId;
    const plain = await post(setupPost, 'owner', 'unit-create-2', {
      commandType: 'CreateProduct',
      ...A,
      code: 'DSL',
      name: 'Diesel',
    });
    state.diesel = plain.body.productId;
    expect(await unitOf(state.lpg!)).toBe('KILOGRAMS');
    expect(await unitOf(state.diesel!)).toBe('LITRES');
    const ov = await overview('owner');
    const byId = Object.fromEntries(
      ov.body.data.products.map((p: { id: string; unit: string }) => [p.id, p.unit]),
    );
    expect(byId[state.lpg!]).toBe('KILOGRAMS');
    expect(byId[state.diesel!]).toBe('LITRES');
  });

  it('SetProductUnit: changes an unused fuel, audits it, replays, and is a no-op when unchanged', async () => {
    const body = {
      commandType: 'SetProductUnit',
      ...A,
      productId: state.diesel,
      unit: 'KILOGRAMS',
    };
    const changed = await post(setupPost, 'owner', 'unit-set-1', body);
    expect(changed.status).toBe(200);
    expect(await unitOf(state.diesel!)).toBe('KILOGRAMS');
    const replay = await post(setupPost, 'owner', 'unit-set-1', body);
    expect(replay.status).toBe(200);
    const same = await post(setupPost, 'owner', 'unit-set-2', body);
    expect(same.status).toBe(200);
    const audit = await client`
      select event_code from platform.security_events
      where tenant_id = ${ids.tenantA} and details->>'subjectId' = ${state.diesel!}
        and event_code = 'SETUP.PRODUCT_UNIT_CHANGED'`;
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const back = await post(setupPost, 'owner', 'unit-set-3', { ...body, unit: 'LITRES' });
    expect(back.status).toBe(200);
    expect(await unitOf(state.diesel!)).toBe('LITRES');
  });

  it('SetProductUnit: refuses an unknown unit, an attendant, and another tenant', async () => {
    const base = { commandType: 'SetProductUnit', ...A, productId: state.diesel };
    expect(
      (await post(setupPost, 'owner', 'unit-bad-1', { ...base, unit: 'GALLONS' })).status,
    ).toBe(400);
    expect(
      (await post(setupPost, 'attendant', 'unit-bad-2', { ...base, unit: 'KILOGRAMS' })).status,
    ).toBe(403);
    const cross = await post(setupPost, 'ownerB', 'unit-bad-3', { ...base, unit: 'KILOGRAMS' });
    expect([403, 404]).toContain(cross.status);
    expect(await unitOf(state.diesel!)).toBe('LITRES');
  });

  it('SetProductUnit: refuses once the fuel has a tank dip, and says why', async () => {
    const tank = await post(inventoryPost, 'owner', 'unit-tank-1', {
      commandType: 'CreateTank',
      ...A,
      code: 'T1',
      productId: state.diesel,
      capacityLitres: '20000',
      reorderLevelLitres: '3000',
      acceptableVarianceLitres: '50',
    });
    expect(tank.status).toBe(200);
    // A tank with no recorded quantities does not block the change.
    const ok = await post(setupPost, 'owner', 'unit-dip-0', {
      commandType: 'SetProductUnit',
      ...A,
      productId: state.diesel,
      unit: 'KILOGRAMS',
    });
    expect(ok.status).toBe(200);
    const backAgain = await post(setupPost, 'owner', 'unit-dip-0b', {
      commandType: 'SetProductUnit',
      ...A,
      productId: state.diesel,
      unit: 'LITRES',
    });
    expect(backAgain.status).toBe(200);
    const dip = await post(inventoryPost, 'owner', 'unit-dip-1', {
      commandType: 'RecordTankDip',
      ...A,
      tankId: tank.body.tankId,
      measuredAt: new Date().toISOString(),
      physicalLitres: '1000',
    });
    expect(dip.status).toBe(200);
    const refused = await post(setupPost, 'owner', 'unit-dip-2', {
      commandType: 'SetProductUnit',
      ...A,
      productId: state.diesel,
      unit: 'KILOGRAMS',
    });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/already has/i);
    expect(await unitOf(state.diesel!)).toBe('LITRES');
  });
});
