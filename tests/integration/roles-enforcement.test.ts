import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { GET as managementReportGet } from '../../src/app/api/reports/management/route';
import { POST as expensePost } from '../../src/app/api/expenses/commands/route';
import { POST as inventoryPost } from '../../src/app/api/inventory/commands/route';
import { POST as setupPost } from '../../src/app/api/setup/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the role enforcement tests.');

/**
 * D2: the extra roles are enforced by the server, on the real routes. The auditor can read the
 * reports and can change nothing; a cash collector and an attendant cannot read the reports; an
 * area manager sees the stations they are assigned and no others.
 */
const ids = {
  tenant: 'd2e00000-0000-4000-8000-000000000001',
  legal: 'd2e00000-0000-4000-8000-000000000011',
  stationA: 'd2e00000-0000-4000-8000-000000000021',
  stationB: 'd2e00000-0000-4000-8000-000000000022',
  stationC: 'd2e00000-0000-4000-8000-000000000023',
  tank: 'd2e00000-0000-4000-8000-000000000061',
};
const people = {
  auditor: { token: 'd2e-auditor-token', n: 1, role: 'AUDITOR' },
  attendant: { token: 'd2e-attendant-token', n: 2, role: 'ATTENDANT' },
  collector: { token: 'd2e-collector-token', n: 3, role: 'CASH_COLLECTOR' },
  areaManager: { token: 'd2e-area-token', n: 4, role: 'AREA_MANAGER' },
} as const;
const idOf = (kind: 'actor' | 'membership' | 'session', n: number) =>
  `d2e00000-0000-4000-8000-0000000${{ actor: '03', membership: '04', session: '05' }[kind]}${String(n).padStart(3, '0')}`;

let client: Sql;
let key = 0;

const headersFor = (token: string, extra: Record<string, string> = {}) => {
  const headers = new Headers({ 'content-type': 'application/json', ...extra });
  for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
  return headers;
};

async function report(token: string, stationId: string) {
  const response = await managementReportGet(
    new Request(
      `http://127.0.0.1:3000/api/reports/management?tenantId=${ids.tenant}&stationIds=${stationId}&fromDate=2026-10-01&toDate=2026-10-31`,
      { headers: headersFor(token) },
    ),
  );
  return response.status;
}

async function post(
  handler: (request: Request) => Promise<Response>,
  path: string,
  token: string,
  body: Record<string, unknown>,
) {
  const response = await handler(
    new Request(`http://127.0.0.1:3000/api/${path}`, {
      method: 'POST',
      headers: headersFor(token, { 'idempotency-key': `d2e-${(key += 1)}` }),
      body: JSON.stringify({ tenantId: ids.tenant, ...body }),
    }),
  );
  return response.status;
}

describe('the extra roles are enforced on the real routes (D2)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-d2e-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-d2e-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'D2 Roles Tenant', 'd2e-roles-tenant') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'D2 Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.stationA}', '${ids.tenant}', '${ids.legal}', 'D2EA', 'D2 Station A', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationB}', '${ids.tenant}', '${ids.legal}', 'D2EB', 'D2 Station B', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationC}', '${ids.tenant}', '${ids.legal}', 'D2EC', 'D2 Station C', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
    `);
    for (const person of Object.values(people)) {
      await client.unsafe(`
        insert into app.users (id, name, email) values
          ('${idOf('actor', person.n)}', 'D2 ${person.role}', 'd2e-${person.n}@example.test')
          on conflict (id) do nothing;
        insert into app.memberships (id, tenant_id, identity_id, status) values
          ('${idOf('membership', person.n)}', '${ids.tenant}', '${idOf('actor', person.n)}', 'ACTIVE')
          on conflict (id) do nothing;
      `);
      await seedClerkSession(
        client,
        idOf('session', person.n),
        person.token,
        idOf('actor', person.n),
        true,
      );
      await seedActiveStepUp(client, idOf('session', person.n), ids.tenant);
    }
    const membership = (n: number) => idOf('membership', n);
    await client.unsafe(`
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${membership(1)}', 'AUDITOR', 'TENANT', null, null),
        ('${ids.tenant}', '${membership(2)}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.stationA}'),
        ('${ids.tenant}', '${membership(3)}', 'CASH_COLLECTOR', 'STATION', '${ids.legal}', '${ids.stationA}'),
        ('${ids.tenant}', '${membership(4)}', 'AREA_MANAGER', 'STATION', '${ids.legal}', '${ids.stationA}'),
        ('${ids.tenant}', '${membership(4)}', 'AREA_MANAGER', 'STATION', '${ids.legal}', '${ids.stationB}')
        on conflict (id) do nothing;
    `);
  });

  afterAll(async () => client?.end());

  it('lets the auditor read every station’s reports', async () => {
    for (const station of [ids.stationA, ids.stationB, ids.stationC]) {
      expect(await report(people.auditor.token, station)).toBe(200);
    }
  });

  it('refuses the attendant and the cash collector the reports', async () => {
    expect(await report(people.attendant.token, ids.stationA)).toBe(403);
    expect(await report(people.collector.token, ids.stationA)).toBe(403);
  });

  it('shows an area manager the stations they are assigned, and only those', async () => {
    expect(await report(people.areaManager.token, ids.stationA)).toBe(200);
    expect(await report(people.areaManager.token, ids.stationB)).toBe(200);
    expect(await report(people.areaManager.token, ids.stationC)).toBe(403);
  });

  it('lets the auditor change nothing: no setting, no category, no dip', async () => {
    const auditor = people.auditor.token;
    expect(
      await post(setupPost, 'setup/commands', auditor, {
        commandType: 'SetAlertSettings',
        stationId: ids.stationA,
        dueSoonDays: 10,
        posSettlementLagDays: 5,
        reportGraceDays: 2,
        cashShortageMinimum: '2.50',
      }),
    ).toBe(403);
    expect(
      await post(expensePost, 'expenses/commands', auditor, {
        commandType: 'CreateExpenseCategory',
        legalEntityId: ids.legal,
        stationId: ids.stationA,
        code: 'D2E_TEST',
        name: 'Test',
        classification: 'OPERATING',
      }),
    ).toBe(403);
    expect(
      await post(inventoryPost, 'inventory/commands', auditor, {
        commandType: 'RecordTankDip',
        stationId: ids.stationA,
        tankId: ids.tank,
        measuredAt: '2026-10-29T10:00:00.000Z',
        physicalLitres: '1000',
      }),
    ).toBe(403);
  });

  it('refuses an attendant and a cash collector the same changes', async () => {
    for (const token of [people.attendant.token, people.collector.token]) {
      expect(
        await post(expensePost, 'expenses/commands', token, {
          commandType: 'CreateExpenseCategory',
          legalEntityId: ids.legal,
          stationId: ids.stationA,
          code: 'D2E_TEST2',
          name: 'Test two',
          classification: 'OPERATING',
        }),
      ).toBe(403);
    }
  });
});
