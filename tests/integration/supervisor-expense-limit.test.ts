import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as expenseCommandPost } from '../../src/app/api/expenses/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the supervisor limit tests.');

const ids = {
  tenant: '5a000000-0000-4000-8000-000000000001',
  legal: '5a000000-0000-4000-8000-000000000011',
  station: '5a000000-0000-4000-8000-000000000021',
  station2: '5a000000-0000-4000-8000-000000000022',
  sup1: '5a000000-0000-4000-8000-000000000031',
  sup1Membership: '5a000000-0000-4000-8000-000000000041',
  sup1Session: '5a000000-0000-4000-8000-000000000051',
  sup2: '5a000000-0000-4000-8000-000000000032',
  sup2Membership: '5a000000-0000-4000-8000-000000000042',
  sup2Session: '5a000000-0000-4000-8000-000000000052',
  supOther: '5a000000-0000-4000-8000-000000000033',
  supOtherMembership: '5a000000-0000-4000-8000-000000000043',
  supOtherSession: '5a000000-0000-4000-8000-000000000053',
  admin: '5a000000-0000-4000-8000-000000000034',
  adminMembership: '5a000000-0000-4000-8000-000000000044',
  adminSession: '5a000000-0000-4000-8000-000000000054',
  owner1: '5a000000-0000-4000-8000-000000000035',
  owner1Membership: '5a000000-0000-4000-8000-000000000045',
  owner1Session: '5a000000-0000-4000-8000-000000000055',
  owner2: '5a000000-0000-4000-8000-000000000036',
  owner2Membership: '5a000000-0000-4000-8000-000000000046',
  owner2Session: '5a000000-0000-4000-8000-000000000056',
};
const tokens = {
  sup1: 'sl-sup1',
  sup2: 'sl-sup2',
  supOther: 'sl-sup-other',
  admin: 'sl-admin',
  owner1: 'sl-owner1',
  owner2: 'sl-owner2',
};

type Json = Record<string, any>;
let client: Sql;
let categoryId: string;
const station = { tenantId: ids.tenant, stationId: ids.station };

async function command(token: string, input: Json) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': randomUUID(),
    'x-real-ip': `sl-${randomUUID()}`,
  });
  for (const [name, value] of Object.entries(clerkHeaders(token))) headers.set(name, value);
  const response = await expenseCommandPost(
    new Request('http://127.0.0.1:3000/api/expenses/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }),
  );
  return { status: response.status, json: (await response.json()) as Json };
}

async function submit(amount: string, token = tokens.sup1) {
  const submitted = await command(token, {
    ...station,
    commandType: 'SubmitExpense',
    categoryId,
    expenseDate: '2026-10-01',
    description: 'Limit test',
    amount,
  });
  expect(submitted.status).toBe(201);
  return submitted.json.expenseId as string;
}

const approve = (token: string, expenseId: string, stationId = ids.station) =>
  command(token, {
    tenantId: ids.tenant,
    stationId,
    commandType: 'ApproveExpense',
    expenseId,
    expectedVersion: 0,
  });

describe('supervisor expense approval limit', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-sl-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-sl-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'SL Tenant', 'sl-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.sup1}', 'SL Supervisor One', 'sl-sup1@example.test'),
        ('${ids.sup2}', 'SL Supervisor Two', 'sl-sup2@example.test'),
        ('${ids.supOther}', 'SL Supervisor Other', 'sl-sup-other@example.test'),
        ('${ids.admin}', 'SL Admin', 'sl-admin@example.test'),
        ('${ids.owner1}', 'SL Owner One', 'sl-owner1@example.test'),
        ('${ids.owner2}', 'SL Owner Two', 'sl-owner2@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.sup1Membership}', '${ids.tenant}', '${ids.sup1}', 'ACTIVE'),
        ('${ids.sup2Membership}', '${ids.tenant}', '${ids.sup2}', 'ACTIVE'),
        ('${ids.supOtherMembership}', '${ids.tenant}', '${ids.supOther}', 'ACTIVE'),
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE'),
        ('${ids.owner1Membership}', '${ids.tenant}', '${ids.owner1}', 'ACTIVE'),
        ('${ids.owner2Membership}', '${ids.tenant}', '${ids.owner2}', 'SUSPENDED') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${ids.legal}', '${ids.tenant}', 'SL Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'SLST1', 'SL Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.station2}', '${ids.tenant}', '${ids.legal}', 'SLST2', 'SL Station Two', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.sup1Membership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.sup2Membership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.supOtherMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station2}'),
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.owner1Membership}', 'OWNER', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.owner2Membership}', 'OWNER', 'TENANT', null, null) on conflict do nothing;
    `);
    for (const [session, token, actor] of [
      [ids.sup1Session, tokens.sup1, ids.sup1],
      [ids.sup2Session, tokens.sup2, ids.sup2],
      [ids.supOtherSession, tokens.supOther, ids.supOther],
      [ids.adminSession, tokens.admin, ids.admin],
      [ids.owner1Session, tokens.owner1, ids.owner1],
      [ids.owner2Session, tokens.owner2, ids.owner2],
    ] as const) {
      await seedClerkSession(client, session, token, actor, true);
      await seedActiveStepUp(client, session, ids.tenant);
    }
    const created = await command(tokens.admin, {
      tenantId: ids.tenant,
      legalEntityId: ids.legal,
      commandType: 'CreateExpenseCategory',
      code: 'SL-CLEAN',
      name: 'Cleaning',
      classification: 'OPERATING',
    });
    expect(created.status).toBe(201);
    categoryId = created.json.categoryId;
    const policy = await command(tokens.admin, {
      tenantId: ids.tenant,
      legalEntityId: ids.legal,
      commandType: 'SetExpensePolicy',
      stepUpThreshold: '10000',
      secondApprovalThreshold: null,
    });
    expect(policy.status).toBe(200);
  });

  afterAll(async () => client?.end());

  it('lets a supervisor approve nothing until the owner sets a limit', async () => {
    const expenseId = await submit('10.0000');
    const refused = await approve(tokens.sup2, expenseId);
    expect(refused.status).toBe(403);
  });

  it('lets a supervisor approve up to the limit and no further, and the owner can change it', async () => {
    let current =
      await client`select version from app.expense_policies where tenant_id = ${ids.tenant}`;
    const version = (current[0]?.version ?? 0) as number;
    const set = await command(tokens.admin, {
      tenantId: ids.tenant,
      legalEntityId: ids.legal,
      commandType: 'SetExpensePolicy',
      stepUpThreshold: '10000',
      secondApprovalThreshold: null,
      supervisorApprovalLimit: '200',
      expectedVersion: version,
    });
    expect(set.status).toBe(200);
    expect(set.json.supervisorApprovalLimit).toBe('200.0000');

    const small = await submit('150.0000');
    const big = await submit('250.0000');
    expect((await approve(tokens.sup2, small)).status).toBe(200);
    const tooBig = await approve(tokens.sup2, big);
    expect(tooBig.status).toBe(403);
    expect(JSON.stringify(tooBig.json)).toMatch(/approval limit/i);

    // The owner raises the limit; the same expense can now be approved by the supervisor.
    current =
      await client`select version from app.expense_policies where tenant_id = ${ids.tenant}`;
    const raised = await command(tokens.admin, {
      tenantId: ids.tenant,
      legalEntityId: ids.legal,
      commandType: 'SetExpensePolicy',
      stepUpThreshold: '10000',
      secondApprovalThreshold: null,
      supervisorApprovalLimit: '300',
      expectedVersion: current[0]!.version,
    });
    expect(raised.status).toBe(200);
    expect((await approve(tokens.sup2, big)).status).toBe(200);
  });

  it('keeps the limit when a later policy change omits it', async () => {
    const current =
      await client`select version from app.expense_policies where tenant_id = ${ids.tenant}`;
    const changed = await command(tokens.admin, {
      tenantId: ids.tenant,
      legalEntityId: ids.legal,
      commandType: 'SetExpensePolicy',
      stepUpThreshold: '9000',
      secondApprovalThreshold: null,
      expectedVersion: current[0]!.version,
    });
    expect(changed.status).toBe(200);
    expect(changed.json.supervisorApprovalLimit).toBe('300.0000');
  });

  it('never lets the submitter, or a supervisor from another station, approve', async () => {
    const expenseId = await submit('20.0000');
    expect((await approve(tokens.sup1, expenseId)).status).toBe(403);
    expect((await approve(tokens.supOther, expenseId)).status).toBe(403);
    expect((await approve(tokens.admin, expenseId)).status).toBe(200);
  });

  it('lets an administrator approve any amount', async () => {
    const expenseId = await submit('5000.0000');
    expect((await approve(tokens.admin, expenseId)).status).toBe(200);
  });

  it('lets a sole owner approve their own expense, but not once a second owner is active', async () => {
    // owner2 starts suspended, so owner1 is the only active owner.
    const solo = await submit('900.0000', tokens.owner1);
    expect((await approve(tokens.owner1, solo)).status).toBe(200);
    // A supervisor is never counted as the other approver.
    await client.unsafe(
      `update app.memberships set status = 'ACTIVE' where id = '${ids.owner2Membership}'`,
    );
    const shared = await submit('900.0000', tokens.owner1);
    expect((await approve(tokens.owner1, shared)).status).toBe(403);
    expect((await approve(tokens.owner2, shared)).status).toBe(200);
    await client.unsafe(
      `update app.memberships set status = 'SUSPENDED' where id = '${ids.owner2Membership}'`,
    );
  });

  it('never lets finance or a supervisor approve their own expense, even with no one else', async () => {
    const own = await submit('20.0000', tokens.sup2);
    expect((await approve(tokens.sup2, own)).status).toBe(403);
    expect((await approve(tokens.owner1, own)).status).toBe(200);
  });

  it('does not let a supervisor change the limit', async () => {
    const attempt = await command(tokens.sup2, {
      tenantId: ids.tenant,
      legalEntityId: ids.legal,
      commandType: 'SetExpensePolicy',
      stepUpThreshold: '10000',
      secondApprovalThreshold: null,
      supervisorApprovalLimit: '999999',
    });
    expect(attempt.status).toBe(403);
  });
});
