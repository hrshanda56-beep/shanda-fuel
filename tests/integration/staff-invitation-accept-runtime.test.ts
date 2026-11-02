import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres, { type Sql } from 'postgres';

import { seedClerkSession, clerkHeaders } from './auth-session-fixtures';

// Accepting an invitation runs as the application role. The accept function is security definer,
// so it must work for that role even though a superuser-seeded fixture would pass either way.
const runtime = vi.hoisted(() => ({ url: '' }));
vi.mock('../../src/platform/config/env', async (original) => {
  const actual = await original<typeof import('../../src/platform/config/env')>();
  return { ...actual, assertDatabaseConfigured: () => runtime.url };
});

import { POST as acceptPost } from '../../src/app/api/invite/[token]/accept/route';
import { createInvitationToken } from '../../src/modules/staff/domain';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for staff invitation tests.');

const ids = {
  tenant: 'b5730000-0000-4000-8000-000000000001',
  legal: 'b5730000-0000-4000-8000-000000000011',
  station: 'b5730000-0000-4000-8000-000000000021',
  owner: 'b5730000-0000-4000-8000-000000000030',
  ownerMembership: 'b5730000-0000-4000-8000-000000000040',
  invitee: 'b5730000-0000-4000-8000-000000000031',
  session: 'b5730000-0000-4000-8000-000000000051',
};
const SESSION_TOKEN = 'accept-b-invitee-token';
const RUNTIME_PASSWORD = 'staff-accept-runtime-only';
let client: Sql;
let runtimeWasLogin = false;

async function accept(token: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const [name, value] of Object.entries(clerkHeaders(SESSION_TOKEN))) headers.set(name, value);
  const response = await acceptPost(
    new Request(`http://127.0.0.1:3000/api/invite/${token}/accept`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function seedInvitation(tokenHash: string) {
  const [row] = await client`
    insert into app.staff_invitations
      (tenant_id, invited_email, invited_name, assigned_role, scope_type, legal_entity_id,
       token_hash, expires_at, created_by_user_id, created_by_membership_id)
    values (${ids.tenant}, 'accept-b-new@example.test', 'New Person', 'SUPERVISOR', 'STATION',
            ${ids.legal}, ${tokenHash}, now() + interval '3 days', ${ids.owner},
            ${ids.ownerMembership})
    returning id`;
  await client`
    insert into app.staff_invitation_stations (tenant_id, invitation_id, legal_entity_id, station_id)
    values (${ids.tenant}, ${row!.id}, ${ids.legal}, ${ids.station})`;
  return row!.id as string;
}

describe('accepting a staff invitation as the application role', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-accept-b-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-accept-b-secret';
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
        ('${ids.tenant}', 'Accept Tenant', 'accept-b-accept-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.owner}', 'Accept Owner', 'accept-b-owner@example.test'),
        ('${ids.invitee}', 'New Person', 'accept-b-new@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.ownerMembership}', '${ids.tenant}', '${ids.owner}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Accept Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'B572A', 'Live Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.session, SESSION_TOKEN, ids.invitee, true);
  });

  afterAll(async () => {
    if (!runtimeWasLogin) await client?.unsafe(`alter role app_runtime nologin`);
    await client?.end();
  });

  it('adds the person to the organisation with the invited role', async () => {
    const { token, tokenHash } = createInvitationToken();
    const invitationId = await seedInvitation(tokenHash);

    const result = await accept(token);

    expect(result).toMatchObject({ status: 200, body: { accepted: true, tenantId: ids.tenant } });
    const [row] = await client`
      select i.status, m.status as membership_status, a.role_code, a.station_id
      from app.staff_invitations i
      join app.memberships m on m.id = i.accepted_membership_id
      join app.membership_role_assignments a on a.membership_id = m.id
      where i.id = ${invitationId}`;
    expect(row).toMatchObject({
      status: 'ACCEPTED',
      membership_status: 'ACTIVE',
      role_code: 'SUPERVISOR',
      station_id: ids.station,
    });
  });
});
