import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';
import { GET as overviewGet } from '../../src/app/api/setup/overview/route';
import { POST as settlementPost } from '../../src/app/api/settlements/commands/route';
import { seedActiveStepUp } from './auth-session-fixtures';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for setup readiness integration tests.');
}

const ids = {
  tenant: 'a5e70000-0000-4000-8000-000000000001',
  otherTenant: 'a5e70000-0000-4000-8000-000000000002',
  legal: 'a5e70000-0000-4000-8000-000000000011',
  otherLegal: 'a5e70000-0000-4000-8000-000000000012',
  full: 'a5e70000-0000-4000-8000-000000000021',
  empty: 'a5e70000-0000-4000-8000-000000000022',
  otherStation: 'a5e70000-0000-4000-8000-000000000023',
  admin: 'a5e70000-0000-4000-8000-000000000031',
  adminMembership: 'a5e70000-0000-4000-8000-000000000041',
  adminSession: 'a5e70000-0000-4000-8000-000000000051',
  supervisor: 'a5e70000-0000-4000-8000-000000000032',
  supervisorMembership: 'a5e70000-0000-4000-8000-000000000042',
  supervisorSession: 'a5e70000-0000-4000-8000-000000000052',
  otherAdmin: 'a5e70000-0000-4000-8000-000000000033',
  otherMembership: 'a5e70000-0000-4000-8000-000000000043',
  product: 'a5e70000-0000-4000-8000-000000000061',
  otherProduct: 'a5e70000-0000-4000-8000-000000000062',
  pump: 'a5e70000-0000-4000-8000-000000000071',
  price: 'a5e70000-0000-4000-8000-000000000081',
};
let client: Sql;

async function cookie(token: string): Promise<string> {
  const signature = await makeSignature(token, process.env.BETTER_AUTH_SECRET!);
  return `shanda-fuel.session_token=${token}.${signature}`;
}

async function overview(token: string) {
  const response = await overviewGet(
    new Request(
      `http://127.0.0.1:3000/api/setup/overview?tenantId=${ids.tenant}&legalEntityId=${ids.legal}&stationId=${ids.full}`,
      { headers: { cookie: await cookie(token) } },
    ),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function post(payload: Record<string, unknown>, key: string) {
  return settlementPost(
    new Request('http://127.0.0.1:3000/api/settlements/commands', {
      method: 'POST',
      headers: {
        cookie: await cookie('setup-admin-token'),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    }),
  );
}

describe('setup readiness (PostgreSQL)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-setup-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-setup-secret';
    client = postgres(databaseUrl!, { max: 4, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Setup Tenant', 'setup-readiness-tenant'),
        ('${ids.otherTenant}', 'Setup Other Tenant', 'setup-readiness-other')
      on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.admin}', 'Setup Admin', 'setup-admin@example.test'),
        ('${ids.supervisor}', 'Setup Supervisor', 'setup-supervisor@example.test'),
        ('${ids.otherAdmin}', 'Setup Other Admin', 'setup-other@example.test')
      on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE'),
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisor}', 'ACTIVE'),
        ('${ids.otherMembership}', '${ids.otherTenant}', '${ids.otherAdmin}', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Setup Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'Setup Other Legal')
      on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.full}', '${ids.tenant}', '${ids.legal}', 'SETFULL', 'Setup Full Station', 'ACTIVE'),
        ('${ids.empty}', '${ids.tenant}', '${ids.legal}', 'SETEMPTY', 'Setup Empty Station', 'ONBOARDING'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'SETOTHER', 'Setup Other Station', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.full}'),
        ('${ids.otherTenant}', '${ids.otherMembership}', 'ADMINISTRATOR', 'TENANT', null, null)
      on conflict do nothing;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
      values
        ('${ids.adminSession}', '2030-01-01T00:00:00Z', 'setup-admin-token', '${ids.admin}', true, now()),
        ('${ids.supervisorSession}', '2030-01-01T00:00:00Z', 'setup-supervisor-token', '${ids.supervisor}', true, now())
      on conflict (id) do update set expires_at = excluded.expires_at;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.tenant}', 'SETUP-ULP', 'Setup Unleaded'),
        ('${ids.otherProduct}', '${ids.otherTenant}', 'SETUP-OTHER', 'Setup Other Fuel')
      on conflict (id) do nothing;
      insert into app.selling_prices (id, tenant_id, station_id, product_id, effective_from, unit_price, currency, state, requested_by)
      values ('${ids.price}', '${ids.tenant}', '${ids.full}', '${ids.product}', now() - interval '1 day', 1.500000, 'USD', 'DRAFT', '${ids.adminMembership}')
      on conflict (id) do nothing;
      update app.selling_prices set state = 'PENDING_APPROVAL' where id = '${ids.price}' and state = 'DRAFT';
      update app.selling_prices set state = 'APPROVED' where id = '${ids.price}' and state = 'PENDING_APPROVAL';
      update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id = '${ids.price}' and state = 'APPROVED';
      update app.selling_prices set state = 'BOUNDARIES_IN_PROGRESS' where id = '${ids.price}' and state = 'PENDING_STATION_ACTIVATION';
      update app.selling_prices set state = 'ACTIVE' where id = '${ids.price}' and state = 'BOUNDARIES_IN_PROGRESS';
      insert into app.tanks (tenant_id, station_id, code, product_id, capacity_litres, acceptable_variance_litres, created_by, updated_by)
      values ('${ids.tenant}', '${ids.full}', 'SETUP-T1', '${ids.product}', 10000, 25, '${ids.adminMembership}', '${ids.adminMembership}')
      on conflict do nothing;
      insert into app.pumps (id, tenant_id, station_id, number) values ('${ids.pump}', '${ids.tenant}', '${ids.full}', 'P1')
      on conflict (id) do nothing;
      insert into app.nozzles (tenant_id, station_id, pump_id, number, product_id)
      values ('${ids.tenant}', '${ids.full}', '${ids.pump}', 'N1', '${ids.product}')
      on conflict do nothing;
      insert into app.shift_templates (tenant_id, station_id, code, name, created_by)
      values ('${ids.tenant}', '${ids.full}', 'DAY', 'Day', '${ids.adminMembership}')
      on conflict do nothing;
      insert into app.bank_accounts (tenant_id, legal_entity_id, name, bank_name, account_reference_masked)
      values ('${ids.tenant}', '${ids.legal}', 'Setup Main', 'Setup Bank', '****1234')
      on conflict do nothing;
    `);
  });

  afterAll(async () => client?.end());

  it('reports entered setup as ready and unentered setup as not entered, per station', async () => {
    const { status, body } = await overview('setup-admin-token');
    expect(status).toBe(200);
    expect(body.status).toBe('ready');
    const full = body.stations.find((s: any) => s.stationCode === 'SETFULL');
    const empty = body.stations.find((s: any) => s.stationCode === 'SETEMPTY');
    const state = (station: any) =>
      Object.fromEntries(station.areas.map((a: any) => [a.code, a.status]));
    expect(state(full)).toEqual({
      PRICES: 'READY',
      TANKS: 'READY',
      PUMPS: 'PARTIAL', // nozzle exists but no meter is installed
      SHIFTS: 'READY',
      PAYMENTS: 'PARTIAL', // bank account entered, provider account not yet
      STAFF: 'READY',
    });
    expect(full.ready).toBe(false);
    expect(full.areas.find((a: any) => a.code === 'PUMPS').detail).toContain(
      'current active meter',
    );
    // Products exist for the tenant, so the empty station's prices are "not entered here".
    expect(state(empty)).toEqual({
      PRICES: 'NOT_ENTERED',
      TANKS: 'NOT_ENTERED',
      PUMPS: 'NOT_ENTERED',
      SHIFTS: 'NOT_ENTERED',
      PAYMENTS: 'PARTIAL', // the legal entity's bank account applies to both stations
      STAFF: 'NOT_ENTERED',
    });
    expect(empty.blockedSummary).toMatch(/^Blocked until setup is complete/);
  });

  it('never exposes another tenant stations, providers or bank accounts', async () => {
    const { body } = await overview('setup-admin-token');
    const codes = body.stations.map((s: any) => s.stationCode);
    expect(codes).toEqual(['SETEMPTY', 'SETFULL']);
    expect(JSON.stringify(body)).not.toContain('SETOTHER');
  });

  it('denies setup to a station-scoped supervisor without tenant authority', async () => {
    const { body } = await overview('setup-supervisor-token');
    expect(body.status).toBe('unavailable');
    expect(body.stations).toBeUndefined();
  });

  it('requires a fresh step-up before the existing command creates a provider', async () => {
    const response = await post(
      {
        commandType: 'CreatePaymentProvider',
        tenantId: ids.tenant,
        stationId: ids.full,
        code: 'SETUP-NOSTEPUP',
        name: 'Needs Step Up',
        providerType: 'POS',
        metadata: {},
      },
      'setup-provider-nostepup',
    );
    expect(response.status).toBe(403);
    const { body } = await overview('setup-admin-token');
    expect(body.providers.map((p: any) => p.code)).not.toContain('SETUP-NOSTEPUP');
  });

  it('shows a provider and account created through the existing settlement commands', async () => {
    await seedActiveStepUp(client, ids.adminSession, ids.tenant);
    const providerResponse = await post(
      {
        commandType: 'CreatePaymentProvider',
        tenantId: ids.tenant,
        stationId: ids.full,
        code: 'SETUP-POS',
        name: 'Setup POS Provider',
        providerType: 'POS',
        metadata: {},
      },
      'setup-provider-1',
    );
    expect(providerResponse.status).toBe(201);
    const provider = (await providerResponse.json()) as { providerId: string };
    const accountResponse = await post(
      {
        commandType: 'ConfigureProviderAccount',
        tenantId: ids.tenant,
        stationId: ids.full,
        providerId: provider.providerId,
        accountReference: 'MERCHANT-1',
        displayName: 'Setup POS Terminal',
        currency: 'USD',
        accountStationId: ids.full,
        legalEntityId: ids.legal,
        metadata: {},
      },
      'setup-account-1',
    );
    expect(accountResponse.status).toBe(201);

    const { body } = await overview('setup-admin-token');
    expect(body.providers.map((p: any) => p.code)).toContain('SETUP-POS');
    expect(body.providerAccounts.map((a: any) => a.displayName)).toContain('Setup POS Terminal');
    const full = body.stations.find((s: any) => s.stationCode === 'SETFULL');
    const empty = body.stations.find((s: any) => s.stationCode === 'SETEMPTY');
    expect(full.areas.find((a: any) => a.code === 'PAYMENTS').status).toBe('READY');
    // The account is station-specific, so the other station's provider side stays unentered.
    expect(empty.areas.find((a: any) => a.code === 'PAYMENTS').status).toBe('PARTIAL');
  });
  it('requires an effective active meter and ignores future, ended and inactive installations', async () => {
    const [nozzle] =
      await client`select id from app.nozzles where tenant_id=${ids.tenant} and station_id=${ids.full}`;
    const [meter] = await client`insert into app.meters (tenant_id, serial_number, status)
      values (${ids.tenant}, 'SETUP-READINESS-METER', 'ACTIVE') returning id`;
    const [installation] = await client`insert into app.meter_installations
      (tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
      values (${ids.tenant}, ${ids.full}, ${nozzle!.id}, ${meter!.id}, now() + interval '1 day', ${ids.adminMembership}) returning id`;
    const pumps = async (expectedSerial: string | null = null) => {
      const { status, body } = await overview('setup-admin-token');
      expect(status).toBe(200);
      expect(body.data.nozzles.find((n: any) => n.id === nozzle!.id).meterSerialNumber).toBe(
        expectedSerial,
      );
      return body.stations
        .find((s: any) => s.stationCode === 'SETFULL')
        .areas.find((a: any) => a.code === 'PUMPS').status;
    };
    expect(await pumps()).toBe('PARTIAL');
    await client`update app.meter_installations set effective_from=now() - interval '2 days', effective_to=now() - interval '1 day' where id=${installation!.id}`;
    expect(await pumps()).toBe('PARTIAL');
    await client`update app.meter_installations set effective_to=null where id=${installation!.id}`;
    expect(await pumps('SETUP-READINESS-METER')).toBe('READY');
    await client`update app.meters set status='INACTIVE' where id=${meter!.id}`;
    expect(await pumps()).toBe('PARTIAL');
  });
});
