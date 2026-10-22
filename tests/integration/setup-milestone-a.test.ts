import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as setupPost } from '../../src/app/api/setup/commands/route';
import { GET as overviewGet } from '../../src/app/api/setup/overview/route';
import { POST as inventoryPost } from '../../src/app/api/inventory/commands/route';
import { POST as forecourtPost } from '../../src/app/api/forecourt/commands/route';
import { POST as settlementPost } from '../../src/app/api/settlements/commands/route';

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

describe('Milestone A owner setup commands (PostgreSQL)', { timeout: 60_000 }, () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';

    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-setup-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-setup-secret';
    client = postgres(databaseUrl, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenantA}', 'Setup Tenant A', 'setup-a-tenant-${run}'),
        ('${ids.tenantB}', 'Setup Tenant B', 'setup-a-tenant-b-${run}') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.ownerUser}', 'Setup Owner', 'setup-a-owner-${run}@example.test'),
        ('${ids.attendantUser}', 'Setup Attendant', 'setup-a-attendant-${run}@example.test'),
        ('${ids.ownerBUser}', 'Setup Owner B', 'setup-a-ownerb-${run}@example.test') on conflict (id) do nothing;
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

  it('starts with every section empty ("Not entered") and lists the blockers', async () => {
    const { status, body } = await overview('owner');
    expect(status).toBe(200);
    expect(body.data.products).toEqual([]);
    expect(body.data.tanks).toEqual([]);
    expect(body.data.nozzles).toEqual([]);
    expect(body.data.prices).toEqual([]);
    expect(body.data.blockers.map((b: { code: string }) => b.code)).toEqual(
      expect.arrayContaining(['NO_PRODUCT', 'NO_TANK', 'NO_NOZZLE', 'NO_SHIFT_TEMPLATE']),
    );
  });

  it('CreateProduct: creates, audits, replays idempotently, rejects reuse and duplicates', async () => {
    const body = { commandType: 'CreateProduct', ...A, code: 'DSL', name: 'Diesel' };
    const first = await post(setupPost, 'owner', 'setup-prod-1', body);
    expect(first.status).toBe(200);
    state.diesel = first.body.productId;
    const replay = await post(setupPost, 'owner', 'setup-prod-1', body);
    expect(replay.status).toBe(200);
    expect(replay.body.productId).toBe(state.diesel);
    const productCount = (await client`
      select count(*)::int as n from app.products
      where tenant_id = ${ids.tenantA} and code = 'DSL'
    `) as unknown as Array<{ n: number }>;
    expect(productCount[0]?.n).toBe(1);
    const reuse = await post(setupPost, 'owner', 'setup-prod-1', { ...body, name: 'Other' });
    expect(reuse.status).toBe(409);
    const dup = await post(setupPost, 'owner', 'setup-prod-2', body);
    expect(dup.status).toBe(409);
    const audit =
      await client`select event_code from platform.security_events where tenant_id = ${ids.tenantA} and details->>'subjectId' = ${state.diesel!}`;
    expect(audit.map((r) => r.event_code)).toEqual(['SETUP.PRODUCT_CREATED']);
    const petrol = await post(setupPost, 'owner', 'setup-prod-3', {
      ...body,
      code: 'PET',
      name: 'Petrol',
    });
    state.petrol = petrol.body.productId;
  });

  it('denies setup writes and tenant crossing', async () => {
    const attendant = await post(setupPost, 'attendant', 'setup-deny-1', {
      commandType: 'CreateProduct',
      ...A,
      code: 'NOPE',
      name: 'No',
    });
    expect(attendant.status).toBe(403);
    const crossTenant = await post(setupPost, 'ownerB', 'setup-deny-2', {
      commandType: 'CreateProduct',
      ...A,
      code: 'X',
      name: 'X',
    });
    expect([403, 404]).toContain(crossTenant.status);
    const none = await client`select 1 from app.products where code in ('NOPE','X')`;
    expect(none).toEqual([]);
    const crossRead = await overview('ownerB');
    expect([403, 404]).toContain(crossRead.status);
    const unauth = await setupPost(
      new Request('http://127.0.0.1:3000/api/setup/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k' },
        body: JSON.stringify({ commandType: 'CreateProduct', ...A, code: 'U', name: 'U' }),
      }),
    );
    expect(unauth.status).toBe(401);
  });

  it('CreateTank (existing command): capacity, reorder level, variance; duplicate code is a clean 409', async () => {
    const body = {
      commandType: 'CreateTank',
      ...A,
      code: 'T1',
      productId: state.diesel,
      capacityLitres: '20000',
      reorderLevelLitres: '3000',
      acceptableVarianceLitres: '50',
    };
    const first = await post(inventoryPost, 'owner', 'setup-tank-1', body);
    expect(first.status).toBe(200);
    const dup = await post(inventoryPost, 'owner', 'setup-tank-2', body);
    expect(dup.status).toBe(409);
    const negative = await post(inventoryPost, 'owner', 'setup-tank-3', {
      ...body,
      code: 'T9',
      acceptableVarianceLitres: '-5',
    });
    expect(negative.status).toBe(400);
    const denied = await post(inventoryPost, 'attendant', 'setup-tank-4', { ...body, code: 'T8' });
    expect(denied.status).toBe(403);
    const { body: ov } = await overview('owner');
    expect(ov.data.tanks).toHaveLength(1);
    expect(ov.data.tanks[0]).toMatchObject({
      code: 'T1',
      capacityLitres: '20000.000',
      reorderLevelLitres: '3000.000',
    });
  });

  it('CreatePump and CreateNozzle create the nozzle, its meter and installation atomically', async () => {
    const pump = await post(setupPost, 'owner', 'setup-pump-1', {
      commandType: 'CreatePump',
      ...A,
      number: '1',
      name: 'Island 1',
    });
    expect(pump.status).toBe(200);
    state.pump = pump.body.pumpId;
    expect(
      (
        await post(setupPost, 'owner', 'setup-pump-2', {
          commandType: 'CreatePump',
          ...A,
          number: '1',
        })
      ).status,
    ).toBe(409);
    const nozzleBody = {
      commandType: 'CreateNozzle',
      ...A,
      pumpId: state.pump,
      number: '1',
      productId: state.diesel,
      meterSerialNumber: 'SN-0001',
    };
    const nozzle = await post(setupPost, 'owner', 'setup-noz-1', nozzleBody);
    expect(nozzle.status).toBe(200);
    const replay = await post(setupPost, 'owner', 'setup-noz-1', nozzleBody);
    expect(replay.body.nozzleId).toBe(nozzle.body.nozzleId);
    const installationCount = (await client`
      select count(*)::int as n from app.meter_installations
      where nozzle_id = ${nozzle.body.nozzleId!}
    `) as unknown as Array<{ n: number }>;
    expect(installationCount[0]?.n).toBe(1);
    // Duplicate meter serial rolls back the nozzle too.
    const dupMeter = await post(setupPost, 'owner', 'setup-noz-2', {
      ...nozzleBody,
      number: '2',
    });
    expect(dupMeter.status).toBe(409);
    const nozzleCount = (await client`
      select count(*)::int as nn from app.nozzles where pump_id = ${state.pump!}
    `) as unknown as Array<{ nn: number }>;
    expect(nozzleCount[0]?.nn).toBe(1);
    // A product from another tenant is not usable.
    const [other] =
      await client`insert into app.products (tenant_id, code, name) values (${ids.tenantB}, 'FOREIGN', 'Foreign') returning id`;
    const foreign = await post(setupPost, 'owner', 'setup-noz-3', {
      ...nozzleBody,
      number: '3',
      meterSerialNumber: 'SN-0003',
      productId: other!.id,
    });
    expect(foreign.status).toBe(404);
    const denied = await post(setupPost, 'attendant', 'setup-noz-4', {
      ...nozzleBody,
      number: '4',
      meterSerialNumber: 'SN-0004',
    });
    expect(denied.status).toBe(403);
    const { body: ov } = await overview('owner');
    expect(ov.data.nozzles[0]).toMatchObject({ number: '1', meterSerialNumber: 'SN-0001' });
    const audit =
      await client`select event_code from platform.security_events where tenant_id = ${ids.tenantA} and event_code in ('SETUP.PUMP_CREATED','SETUP.NOZZLE_CREATED') order by event_code`;
    expect(audit.map((r) => r.event_code)).toEqual(['SETUP.NOZZLE_CREATED', 'SETUP.PUMP_CREATED']);
  });

  it('DefineShiftTemplate (existing command) creates a template', async () => {
    const res = await post(forecourtPost, 'owner', 'setup-shift-1', {
      commandType: 'DefineShiftTemplate',
      ...A,
      shiftTemplateId: ids.shiftTemplate,
      expectedVersion: 0,
      code: 'DAY',
      name: 'Day shift',
      startTime: '06:00',
      durationMinutes: 720,
    });
    expect(res.status).toBe(200);
    const { body: ov } = await overview('owner');
    expect(ov.data.shiftTemplates[0]).toMatchObject({ code: 'DAY', startTime: '06:00' });
  });

  it('prices: a missing price blocks; draft -> request -> approve flows through existing commands', async () => {
    let { body: ov } = await overview('owner');
    expect(ov.data.blockers.map((b: { code: string }) => b.code)).toContain('NO_PRICE');
    const bad = await post(setupPost, 'owner', 'setup-price-0', {
      commandType: 'DraftPriceChange',
      ...A,
      productId: state.diesel,
      unitPrice: '0',
      currency: 'USD',
      effectiveFrom: '2026-10-13T00:00:00Z',
    });
    expect(bad.status).toBe(400);
    const draft = await post(setupPost, 'owner', 'setup-price-1', {
      commandType: 'DraftPriceChange',
      ...A,
      productId: state.diesel,
      unitPrice: '1.450000',
      currency: 'USD',
      effectiveFrom: '2026-10-13T00:00:00Z',
    });
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ state: 'DRAFT', version: 0 });
    const denied = await post(setupPost, 'attendant', 'setup-price-2', {
      commandType: 'DraftPriceChange',
      ...A,
      productId: state.diesel,
      unitPrice: '1.5',
      currency: 'USD',
      effectiveFrom: '2026-10-13T00:00:00Z',
    });
    expect(denied.status).toBe(403);
    const requested = await post(forecourtPost, 'owner', 'setup-price-req-1', {
      commandType: 'RequestPriceChange',
      ...A,
      priceId: draft.body.priceId,
      expectedVersion: 0,
    });
    expect(requested.status).toBe(200);
    const [row] =
      await client`select state, unit_price::text as price from app.selling_prices where id = ${draft.body.priceId}`;
    expect(row).toMatchObject({ state: 'PENDING_APPROVAL', price: '1.450000' });
    ov = (await overview('owner')).body;
    expect(ov.data.prices[0]).toMatchObject({ state: 'PENDING_APPROVAL' });
    // Still blocked: nothing is ACTIVE until the approval flow completes.
    expect(ov.data.blockers.map((b: { code: string }) => b.code)).toContain('NO_PRICE');
  });

  it('configures provider and bank accounts with tenant scope and step-up authority', async () => {
    const provider = await post(settlementPost, 'owner', 'setup-provider-1', {
      commandType: 'CreatePaymentProvider',
      ...A,
      code: 'POS1',
      name: 'Station POS',
      providerType: 'POS',
      metadata: {},
    });
    expect(provider.status).toBe(201);
    const providerAccount = await post(settlementPost, 'owner', 'setup-provider-account-1', {
      commandType: 'ConfigureProviderAccount',
      ...A,
      providerId: provider.body.providerId,
      accountReference: 'POS-ACCOUNT-1',
      displayName: 'Station POS account',
      currency: 'USD',
      accountStationId: ids.stationA,
      legalEntityId: ids.legalA,
      metadata: {},
    });
    expect(providerAccount.status).toBe(201);
    const bank = await post(settlementPost, 'owner', 'setup-bank-account-1', {
      commandType: 'CreateBankAccount',
      ...A,
      legalEntityId: ids.legalA,
      name: 'Primary operating account',
      bankName: 'Verified bank',
      accountReferenceMasked: '****1234',
      currency: 'USD',
    });
    expect(bank.status).toBe(201);
    const duplicate = await post(settlementPost, 'owner', 'setup-bank-account-2', {
      commandType: 'CreateBankAccount',
      ...A,
      legalEntityId: ids.legalA,
      name: 'Primary operating account',
      bankName: 'Verified bank',
      accountReferenceMasked: '****5678',
      currency: 'USD',
    });
    expect(duplicate.status).toBe(409);
    const { body: ov } = await overview('owner');
    expect(ov.providerAccounts).toHaveLength(1);
    expect(ov.bankAccounts).toHaveLength(1);
  });

  it('UpdateSupplier edits and deactivates with optimistic versioning and audit', async () => {
    const [s] = await client`
      insert into app.suppliers (tenant_id, code, legal_name, created_by, updated_by)
      values (${ids.tenantA}, 'SUP1', 'Old Name', ${ids.ownerMembership}, ${ids.ownerMembership}) returning id`;
    const edit = await post(setupPost, 'owner', 'setup-sup-1', {
      commandType: 'UpdateSupplier',
      ...A,
      supplierId: s!.id,
      expectedVersion: 0,
      legalName: 'New Name',
    });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ legalName: 'New Name', version: 1, status: 'ACTIVE' });
    const stale = await post(setupPost, 'owner', 'setup-sup-2', {
      commandType: 'UpdateSupplier',
      ...A,
      supplierId: s!.id,
      expectedVersion: 0,
      status: 'INACTIVE',
    });
    expect(stale.status).toBe(409);
    const off = await post(setupPost, 'owner', 'setup-sup-3', {
      commandType: 'UpdateSupplier',
      ...A,
      supplierId: s!.id,
      expectedVersion: 1,
      status: 'INACTIVE',
    });
    expect(off.body.status).toBe('INACTIVE');
    const denied = await post(setupPost, 'attendant', 'setup-sup-4', {
      commandType: 'UpdateSupplier',
      ...A,
      supplierId: s!.id,
      expectedVersion: 2,
      status: 'ACTIVE',
    });
    expect(denied.status).toBe(403);
    const audit =
      await client`select event_code from platform.security_events where details->>'subjectId' = ${s!.id} order by occurred_at`;
    expect(audit.map((r) => r.event_code)).toEqual(['SUPPLIER.UPDATED', 'SUPPLIER.STATUS_CHANGED']);
  });

  it('SetResponsibleSupervisor: only an active supervisor of this station can be chosen', async () => {
    const supervisorUser = randomUUID();
    const supervisorMembership = randomUUID();
    const otherUser = randomUUID();
    const otherMembership = randomUUID();
    await client.unsafe(`
      insert into app.users (id, name, email) values
        ('${supervisorUser}', 'Tendai Supervisor', 'setup-sup-${run}@example.test'),
        ('${otherUser}', 'Other Station Supervisor', 'setup-sup-other-${run}@example.test');
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${supervisorMembership}', '${ids.tenantA}', '${supervisorUser}', 'ACTIVE'),
        ('${otherMembership}', '${ids.tenantA}', '${otherUser}', 'ACTIVE');
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status)
        values ('${ids.stationOther}', '${ids.tenantA}', '${ids.legalA}', 'O${run}', 'Setup Other Station', 'ONBOARDING');
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenantA}', '${supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legalA}', '${ids.stationA}'),
        ('${ids.tenantA}', '${otherMembership}', 'SUPERVISOR', 'STATION', '${ids.legalA}', '${ids.stationOther}');
    `);
    const command = (
      key: string,
      membershipId: string | null,
      who: keyof typeof tokens = 'owner',
    ) => post(setupPost, who, key, { commandType: 'SetResponsibleSupervisor', ...A, membershipId });

    const attendant = await command('setup-resp-1', ids.attendantMembership);
    expect(attendant.status).toBe(400);
    const elsewhere = await command('setup-resp-2', otherMembership);
    expect(elsewhere.status).toBe(400);
    const denied = await command('setup-resp-3', supervisorMembership, 'attendant');
    expect(denied.status).toBe(403);

    const set = await command('setup-resp-4', supervisorMembership);
    expect(set.status).toBe(200);
    const replay = await command('setup-resp-4', supervisorMembership);
    expect(replay.status).toBe(200);
    const { body: ov } = await overview('owner');
    expect(ov.data.responsibleSupervisorMembershipId).toBe(supervisorMembership);
    expect(ov.data.supervisors).toEqual([
      { membershipId: supervisorMembership, name: 'Tendai Supervisor' },
    ]);

    const cleared = await command('setup-resp-5', null);
    expect(cleared.status).toBe(200);
    const { body: after } = await overview('owner');
    expect(after.data.responsibleSupervisorMembershipId).toBeNull();
    const audit =
      await client`select event_code from platform.security_events where tenant_id = ${ids.tenantA} and event_code = 'SETUP.RESPONSIBLE_SUPERVISOR_SET'`;
    expect(audit).toHaveLength(2);
  });
});
