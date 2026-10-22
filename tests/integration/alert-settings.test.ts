import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as setupPost } from '../../src/app/api/setup/commands/route';
import { GET as settingsGet } from '../../src/app/api/setup/alert-settings/route';
import { loadOperationsFacts } from '../../src/modules/approvals/operations-facts';
import { withInventoryReadContext } from '../../src/modules/inventory/application';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for alert settings tests.');

const ids = {
  tenant: 'a9e00000-0000-4000-8000-000000000001',
  otherTenant: 'a9e00000-0000-4000-8000-000000000002',
  legal: 'a9e00000-0000-4000-8000-000000000011',
  station: 'a9e00000-0000-4000-8000-000000000021',
  adminActor: 'a9e00000-0000-4000-8000-000000000032',
  adminMembership: 'a9e00000-0000-4000-8000-000000000042',
  adminSession: 'a9e00000-0000-4000-8000-000000000052',
  stationAdminActor: 'a9e00000-0000-4000-8000-000000000033',
  stationAdminMembership: 'a9e00000-0000-4000-8000-000000000043',
  stationAdminSession: 'a9e00000-0000-4000-8000-000000000053',
};
const ADMIN = 'a9e-admin-token';
const STATION_ADMIN = 'a9e-station-admin-token';
let client: Sql;
let key = 0;

async function save(token: string, body: Record<string, unknown>) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': `a9e-${(key += 1)}`,
  });
  for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
  const response = await setupPost(
    new Request('http://127.0.0.1:3000/api/setup/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commandType: 'SetAlertSettings',
        tenantId: ids.tenant,
        stationId: ids.station,
        dueSoonDays: 10,
        posSettlementLagDays: 5,
        reportGraceDays: 2,
        cashShortageMinimum: '2.50',
        ...body,
      }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function read(token: string, tenant = ids.tenant) {
  const response = await settingsGet(
    new Request(`http://127.0.0.1:3000/api/setup/alert-settings?tenantId=${tenant}`, {
      headers: { ...clerkHeaders(token) },
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe('alert settings', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a9e-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a9e-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Alert Tenant', 'a9e-alert-tenant'),
        ('${ids.otherTenant}', 'Other Alert Tenant', 'a9e-other-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.adminActor}', 'Alert Admin', 'a9e-admin@example.test'),
        ('${ids.stationAdminActor}', 'Alert Station Admin', 'a9e-station-admin@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.adminActor}', 'ACTIVE'),
        ('${ids.stationAdminMembership}', '${ids.tenant}', '${ids.stationAdminActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Alert Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A9EST', 'Alert Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.stationAdminMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.adminSession, ADMIN, ids.adminActor, true);
    await seedClerkSession(
      client,
      ids.stationAdminSession,
      STATION_ADMIN,
      ids.stationAdminActor,
      true,
    );
    await seedActiveStepUp(client, ids.adminSession, ids.tenant);
    await seedActiveStepUp(client, ids.stationAdminSession, ids.tenant);
  });

  afterAll(async () => client?.end());

  it('starts on the defaults, then saves and versions the organisation’s own numbers', async () => {
    const first = await read(ADMIN);
    expect(first.body).toMatchObject({
      version: null,
      canManage: true,
      settings: { dueSoonDays: 7, posSettlementLagDays: 3, reportGraceDays: 1 },
    });

    expect((await save(ADMIN, {})).status).toBe(200);
    const second = await read(ADMIN);
    expect(second.body).toMatchObject({
      version: 0,
      settings: {
        dueSoonDays: 10,
        posSettlementLagDays: 5,
        reportGraceDays: 2,
        cashShortageMinimum: '2.5',
      },
    });

    const blind = await save(ADMIN, { dueSoonDays: 14 });
    expect(blind.status).toBe(409);
    const stale = await save(ADMIN, { dueSoonDays: 14, expectedVersion: 5 });
    expect(stale.status).toBe(409);
    const ok = await save(ADMIN, { dueSoonDays: 14, expectedVersion: 0 });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(1);
    expect((await read(ADMIN)).body.settings.dueSoonDays).toBe(14);
  });

  it('feeds the numbers into the operations facts the alerts are built from', async () => {
    const facts = await withInventoryReadContext(
      new Request('http://127.0.0.1:3000/x', { headers: clerkHeaders(ADMIN) }),
      ids.tenant,
      ids.station,
      (tx, context) => loadOperationsFacts(tx, context),
    );
    expect(facts.settings).toMatchObject({ dueSoonDays: 14, reportGraceDays: 2 });
  });

  it('keeps out-of-range numbers out', async () => {
    for (const bad of [
      { dueSoonDays: 0 },
      { dueSoonDays: 61 },
      { posSettlementLagDays: -1 },
      { reportGraceDays: 15 },
      { cashShortageMinimum: '-1' },
      { cashShortageMinimum: 'lots' },
    ]) {
      expect((await save(ADMIN, { ...bad, expectedVersion: 1 })).status).toBe(400);
    }
  });

  it('lets only organisation-level managers change them', async () => {
    const attempt = await save(STATION_ADMIN, { expectedVersion: 1 });
    expect(attempt.status).toBe(403);
    expect((await read(STATION_ADMIN)).body.canManage).toBe(false);
  });

  it('never shows or changes another organisation’s settings', async () => {
    expect([403, 404]).toContain((await read(ADMIN, ids.otherTenant)).status);
    const rows = await client.unsafe(
      `select count(*)::int as n from app.alert_settings where tenant_id = '${ids.otherTenant}'`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});
