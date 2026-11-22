import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';
import { seedClerkSession, clerkHeaders } from './auth-session-fixtures';
import { addDays } from '../../src/modules/forecourt/past-day-rules';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the past-day entry integration tests.');
}

const ids = {
  tenant: 'a3d00000-0000-4000-8000-000000000001',
  otherTenant: 'a3d00000-0000-4000-8000-000000000002',
  legal: 'a3d00000-0000-4000-8000-000000000011',
  station: 'a3d00000-0000-4000-8000-000000000021',
  supervisor: 'a3d00000-0000-4000-8000-000000000031',
  supervisorMembership: 'a3d00000-0000-4000-8000-000000000041',
  supervisorSession: 'a3d00000-0000-4000-8000-000000000111',
  owner: 'a3d00000-0000-4000-8000-000000000032',
  ownerMembership: 'a3d00000-0000-4000-8000-000000000042',
  ownerSession: 'a3d00000-0000-4000-8000-000000000112',
};
const supervisorToken = 'a3d-supervisor-token';
const ownerToken = 'a3d-owner-token';

let client: Sql;

async function post(input: Record<string, unknown>, token: string) {
  return forecourtCommandPost(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(token, input),
        'content-type': 'application/json',
        'idempotency-key': `a3d-${randomUUID()}`,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function openPast(businessDate: string, token = supervisorToken) {
  return post(
    {
      commandType: 'OpenPastBusinessDay',
      tenantId: ids.tenant,
      stationId: ids.station,
      businessDayId: randomUUID(),
      businessDate,
    },
    token,
  );
}

async function stationToday(): Promise<string> {
  const rows = await client<{ d: string }[]>`
    select to_char((now() at time zone 'Africa/Harare')::date, 'YYYY-MM-DD') as d
  `;
  return rows[0]!.d;
}

describe('past-day entry: OpenPastBusinessDay', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a3-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Past Day Tenant', 'past-day-tenant'),
        ('${ids.otherTenant}', 'Past Day Other Tenant', 'past-day-other-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.supervisor}', 'Past Day Supervisor', 'past-day-supervisor@example.test'),
        ('${ids.owner}', 'Past Day Owner', 'past-day-owner@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisor}', 'ACTIVE'),
        ('${ids.ownerMembership}', '${ids.tenant}', '${ids.owner}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Past Day Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'PDE1', 'Past Day Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.ownerMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict do nothing;
      delete from app.station_business_days where station_id = '${ids.station}';
      update app.stations set go_live_date = null where id = '${ids.station}';
    `);
    await seedClerkSession(client, ids.supervisorSession, supervisorToken, ids.supervisor, true);
    await seedClerkSession(client, ids.ownerSession, ownerToken, ids.owner, true);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('records yesterday as an OPEN day marked entered late, with who and when', async () => {
    const date = addDays(await stationToday(), -1);
    const response = await openPast(date);
    expect(response.status).toBe(200);
    const rows = await client<
      { state: string; entered_late: boolean; entered_late_by: string; entered_late_at: Date }[]
    >`
      select state, entered_late, entered_late_by, entered_late_at
      from app.station_business_days
      where station_id = ${ids.station} and business_date = ${date}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: 'OPEN',
      entered_late: true,
      entered_late_by: ids.supervisorMembership,
    });
    expect(rows[0]!.entered_late_at).toBeInstanceOf(Date);
  });

  it('refuses the same day twice, today, and the future', async () => {
    const today = await stationToday();
    expect((await openPast(addDays(today, -1))).status).toBe(409);
    expect((await openPast(today)).status).toBe(400);
    expect((await openPast(addDays(today, 1))).status).toBe(400);
  });

  it('lets a supervisor go back 7 days but sends older days to the owner', async () => {
    const today = await stationToday();
    expect((await openPast(addDays(today, -7))).status).toBe(200);
    expect((await openPast(addDays(today, -8))).status).toBe(400);
    expect((await openPast(addDays(today, -8), ownerToken)).status).toBe(200);
    expect((await openPast(addDays(today, -91), ownerToken)).status).toBe(400);
  });

  it('refuses days before the station go-live date', async () => {
    const today = await stationToday();
    await client`update app.stations set go_live_date = ${addDays(today, -3)} where id = ${ids.station}`;
    try {
      expect((await openPast(addDays(today, -4), ownerToken)).status).toBe(400);
      expect((await openPast(addDays(today, -3), ownerToken)).status).toBe(200);
    } finally {
      await client`update app.stations set go_live_date = null where id = ${ids.station}`;
    }
  });

  it('does not leave a live day behind: ordinary days stay not entered late', async () => {
    const rows = await client<{ n: number }[]>`
      select count(*)::int as n from app.station_business_days
      where station_id = ${ids.station} and entered_late = false
    `;
    expect(rows[0]!.n).toBe(0);
  });
});
