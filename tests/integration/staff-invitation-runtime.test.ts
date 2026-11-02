import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres, { type Sql } from 'postgres';

import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';

// The application connects as `app_runtime`, which has fewer rights than the superuser that seeds
// these fixtures. Staff invitations must work for that role: a query that tried to lock rows it
// may not update (for example `FOR UPDATE` across a join with app.users) failed in production
// with a generic "something went wrong" while every superuser-based test passed.
const runtime = vi.hoisted(() => ({ url: '' }));
vi.mock('../../src/platform/config/env', async (original) => {
  const actual = await original<typeof import('../../src/platform/config/env')>();
  return { ...actual, assertDatabaseConfigured: () => runtime.url };
});

import { POST as staffPost } from '../../src/app/api/staff/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for staff invitation tests.');

const ids = {
  tenant: 'b5710000-0000-4000-8000-000000000001',
  legal: 'b5710000-0000-4000-8000-000000000011',
  active: 'b5710000-0000-4000-8000-000000000021',
  onboarding: 'b5710000-0000-4000-8000-000000000022',
  owner: 'b5710000-0000-4000-8000-000000000031',
  ownerMembership: 'b5710000-0000-4000-8000-000000000041',
  ownerSession: 'b5710000-0000-4000-8000-000000000051',
  member: 'b5710000-0000-4000-8000-000000000032',
  memberMembership: 'b5710000-0000-4000-8000-000000000042',
};
const TOKEN = 'b57-owner-token';
const RUNTIME_PASSWORD = 'staff-invite-runtime-only';
let client: Sql;
let runtimeWasLogin = false;
let key = 0;

async function command(body: Record<string, unknown>) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': `b57-${(key += 1)}`,
  });
  for (const [name, value] of Object.entries(clerkHeaders(TOKEN))) headers.set(name, value);
  const response = await staffPost(
    new Request('http://127.0.0.1:3000/api/staff/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const invitation = (extra: Record<string, unknown> = {}) => ({
  commandType: 'CreateStaffInvitation',
  tenantId: ids.tenant,
  invitedName: 'Probe Person',
  assignedRole: 'SUPERVISOR',
  scopeType: 'STATION',
  legalEntityId: ids.legal,
  stationIds: [ids.active, ids.onboarding],
  deliveryMethod: 'EMAIL',
  ...extra,
});

describe('staff invitations as the application role', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-b57-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-b57-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    const [role] = await client`select rolcanlogin from pg_roles where rolname = 'app_runtime'`;
    runtimeWasLogin = Boolean(role?.rolcanlogin);
    await client.unsafe(`alter role app_runtime login password '${RUNTIME_PASSWORD}'`);
    const url = new URL(databaseUrl!);
    url.username = 'app_runtime';
    url.password = RUNTIME_PASSWORD;
    runtime.url = url.toString();

    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Invite Tenant', 'b57-invite-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.owner}', 'Invite Owner', 'b57-owner@example.test'),
        ('${ids.member}', 'Existing Member', 'b57-member@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.ownerMembership}', '${ids.tenant}', '${ids.owner}', 'ACTIVE'),
        ('${ids.memberMembership}', '${ids.tenant}', '${ids.member}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Invite Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.active}', '${ids.tenant}', '${ids.legal}', 'B57A', 'Live Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.onboarding}', '${ids.tenant}', '${ids.legal}', 'B57B', 'Setting Up Station', 'ONBOARDING', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.ownerMembership}', 'OWNER', 'TENANT', null, null)
        on conflict do nothing;
    `);
    await seedClerkSession(client, ids.ownerSession, TOKEN, ids.owner, true);
    await seedActiveStepUp(client, ids.ownerSession, ids.tenant);
  });

  afterAll(async () => {
    if (!runtimeWasLogin) await client?.unsafe(`alter role app_runtime nologin`);
    await client?.end();
  });

  it('creates an email invitation for several stations, including one still being set up', async () => {
    const result = await command(invitation({ invitedEmail: 'b57-new-person@example.test' }));
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ deliveryMethod: 'EMAIL' });
    const [row] = await client`
      select invited_email, status, delivery_method,
             (select count(*)::int from app.staff_invitation_stations s where s.invitation_id = i.id) as stations
      from app.staff_invitations i where id = ${result.body.invitationId}`;
    expect(row).toMatchObject({
      invited_email: 'b57-new-person@example.test',
      status: 'PENDING',
      delivery_method: 'EMAIL',
      stations: 2,
    });
  });

  it('says plainly when that email already has a pending invitation', async () => {
    const again = await command(invitation({ invitedEmail: 'b57-new-person@example.test' }));
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already has a pending invitation/);
  });

  it('says plainly when that email already belongs to a staff member', async () => {
    const result = await command(invitation({ invitedEmail: 'B57-Member@Example.test' }));
    expect(result.status).toBe(409);
    expect(result.body.message).toMatch(/already has a staff record/);
  });

  it('still creates a manual (staff number) invitation', async () => {
    const result = await command(
      invitation({ deliveryMethod: 'MANUAL', invitedName: 'Manual One' }),
    );
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ deliveryMethod: 'MANUAL' });
    expect(result.body.staffNumber).toBeTruthy();
  });
});
