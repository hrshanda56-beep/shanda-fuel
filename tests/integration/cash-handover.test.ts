import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as cashCommandPost } from '../../src/app/api/cash/commands/route';
import { GET as cashSummaryGet } from '../../src/app/api/cash/summary/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for cash handover integration tests.');
}

const ids = {
  tenant: 'a6c00000-0000-4000-8000-000000000001',
  legal: 'a6c00000-0000-4000-8000-000000000011',
  station: 'a6c00000-0000-4000-8000-000000000021',
  supervisorActor: 'a6c00000-0000-4000-8000-000000000031',
  supervisorMembership: 'a6c00000-0000-4000-8000-000000000041',
  supervisorSession: 'a6c00000-0000-4000-8000-000000000051',
  managerActor: 'a6c00000-0000-4000-8000-000000000032',
  managerMembership: 'a6c00000-0000-4000-8000-000000000042',
  managerSession: 'a6c00000-0000-4000-8000-000000000052',
  till: 'a6c00000-0000-4000-8000-000000000081',
  safe: 'a6c00000-0000-4000-8000-000000000091',
};

const stationContext = {
  organisationId: ids.tenant,
  legalEntityId: ids.legal,
  stationId: ids.station,
  allStations: false,
} as const;

const SUPERVISOR = 'a6c-supervisor-session-token';
const MANAGER = 'a6c-manager-session-token';

let client: Sql;
let keyCounter = 0;

async function post(input: Record<string, unknown>, token: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': `a6c-key-${(keyCounter += 1)}`,
  });
  for (const [key, value] of Object.entries(clerkHeaders(token))) headers.set(key, value);
  const response = await cashCommandPost(
    new Request('http://127.0.0.1:3000/api/cash/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify({ context: stationContext, ...input }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const submit = (token: string, counted: string, extra: Record<string, unknown> = {}) =>
  post(
    {
      commandType: 'SubmitCashHandover',
      fromLocationId: ids.till,
      toLocationId: ids.safe,
      expectedAmount: '500.00',
      countedAmount: counted,
      ...extra,
    },
    token,
  );

async function movementsFor(handoverId: string) {
  return client.unsafe(
    `select amount::text as amount, from_location_id, to_location_id
       from app.cash_movements where source_type = 'CASH_HANDOVER' and source_id = '${handoverId}'`,
  );
}

describe('cash handover between people', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a6-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a6-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Handover Tenant', 'a6c-handover-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.supervisorActor}', 'Handover Supervisor', 'a6c-supervisor@example.test'),
        ('${ids.managerActor}', 'Handover Manager', 'a6c-manager@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE'),
        ('${ids.managerMembership}', '${ids.tenant}', '${ids.managerActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Handover Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A6CHO', 'Handover Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.managerMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict (id) do nothing;
      insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type) values
        ('${ids.till}', '${ids.tenant}', '${ids.station}', 'CHO-TILL', 'Handover till', 'STATION_TILL'),
        ('${ids.safe}', '${ids.tenant}', '${ids.station}', 'CHO-SAFE', 'Handover safe', 'STATION_SAFE')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.supervisorSession, SUPERVISOR, ids.supervisorActor, true);
    await seedClerkSession(client, ids.managerSession, MANAGER, ids.managerActor, true);
    await seedActiveStepUp(client, ids.supervisorSession, ids.tenant);
    await seedActiveStepUp(client, ids.managerSession, ids.tenant);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('moves cash only when the receiver accepts a matching handover', async () => {
    const sent = await submit(SUPERVISOR, '500.00');
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ state: 'SUBMITTED', variance: '0' });
    expect(await movementsFor(sent.body.handoverId)).toHaveLength(0);

    const stale = await post(
      {
        commandType: 'AcceptCashHandover',
        handoverId: sent.body.handoverId,
        expectedVersion: 7,
      },
      MANAGER,
    );
    expect(stale.status).toBe(409);

    const accepted = await post(
      {
        commandType: 'AcceptCashHandover',
        handoverId: sent.body.handoverId,
        expectedVersion: 0,
      },
      MANAGER,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.state).toBe('ACCEPTED');
    const moves = await movementsFor(sent.body.handoverId);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ amount: '500.0000', from_location_id: ids.till });

    const again = await post(
      {
        commandType: 'AcceptCashHandover',
        handoverId: sent.body.handoverId,
        expectedVersion: 1,
      },
      MANAGER,
    );
    expect(again.status).toBe(409);
  });

  it('lets the receiving role accept but not the supervisor who hands the cash over', async () => {
    const sent = await submit(SUPERVISOR, '500.00');
    const attempt = await post(
      { commandType: 'AcceptCashHandover', handoverId: sent.body.handoverId, expectedVersion: 0 },
      SUPERVISOR,
    );
    expect(attempt.status).toBe(403);
  });

  it('stops anyone accepting cash they handed over themselves', async () => {
    const sent = await submit(MANAGER, '500.00');
    expect(sent.status).toBe(201);
    const attempt = await post(
      { commandType: 'AcceptCashHandover', handoverId: sent.body.handoverId, expectedVersion: 0 },
      MANAGER,
    );
    expect(attempt.status).toBe(403);
  });

  it('sends a short count to review with a reason and settles it with a note', async () => {
    const noReason = await submit(SUPERVISOR, '450.00');
    expect(noReason.status).toBe(400);

    const sent = await submit(SUPERVISOR, '450.00', { reason: 'Customer short-changed' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ state: 'DISPUTED', variance: '-50' });

    const cannotAccept = await post(
      { commandType: 'AcceptCashHandover', handoverId: sent.body.handoverId, expectedVersion: 0 },
      MANAGER,
    );
    expect(cannotAccept.status).toBe(409);

    const weakNote = await post(
      {
        commandType: 'ResolveCashHandover',
        handoverId: sent.body.handoverId,
        expectedVersion: 0,
        resolutionNote: 'ok',
      },
      MANAGER,
    );
    expect(weakNote.status).toBe(400);

    const resolved = await post(
      {
        commandType: 'ResolveCashHandover',
        handoverId: sent.body.handoverId,
        expectedVersion: 0,
        resolutionNote: 'Short by 50, recovered from payroll',
      },
      MANAGER,
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body.state).toBe('RESOLVED');
    const moves = await movementsFor(sent.body.handoverId);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ amount: '450.0000' });
    const [row] = await client.unsafe(
      `select resolution_note, resolved_by from app.cash_handovers where id = '${sent.body.handoverId}'`,
    );
    expect(row).toMatchObject({
      resolution_note: 'Short by 50, recovered from payroll',
      resolved_by: ids.managerMembership,
    });
  });

  it('lets the sender withdraw a handover before it is accepted, and no one else without authority', async () => {
    const sent = await submit(MANAGER, '500.00');
    const byOther = await post(
      { commandType: 'CancelCashHandover', handoverId: sent.body.handoverId, expectedVersion: 0 },
      SUPERVISOR,
    );
    expect(byOther.status).toBe(403);
    const byOwner = await post(
      { commandType: 'CancelCashHandover', handoverId: sent.body.handoverId, expectedVersion: 0 },
      MANAGER,
    );
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.state).toBe('CANCELLED');
    expect(await movementsFor(sent.body.handoverId)).toHaveLength(0);
  });

  it('shows each person the handovers waiting, with names and what they may do', async () => {
    const sent = await submit(SUPERVISOR, '500.00');
    const read = async (token: string) =>
      (await (
        await cashSummaryGet(
          new Request(
            `http://127.0.0.1:3000/api/cash/summary?tenantId=${ids.tenant}&stationId=${ids.station}`,
            { headers: { ...clerkHeaders(token) } },
          ),
        )
      ).json()) as Record<string, any>;
    const asManager = await read(MANAGER);
    const row = asManager.handovers.find((h: any) => h.handoverId === sent.body.handoverId);
    expect(row).toMatchObject({
      state: 'SUBMITTED',
      deliveredByName: 'Handover Supervisor',
      deliveredByMembershipId: ids.supervisorMembership,
    });
    expect(asManager.currentMembershipId).toBe(ids.managerMembership);
    expect(asManager.capabilities).toMatchObject({
      submitHandover: true,
      acceptHandover: true,
      resolveHandover: true,
    });
    const asSupervisor = await read(SUPERVISOR);
    expect(asSupervisor.capabilities).toMatchObject({
      submitHandover: true,
      acceptHandover: false,
      resolveHandover: false,
    });
  });

  it('refuses a handover to the same place', async () => {
    const result = await post(
      {
        commandType: 'SubmitCashHandover',
        fromLocationId: ids.till,
        toLocationId: ids.till,
        expectedAmount: '10',
        countedAmount: '10',
      },
      SUPERVISOR,
    );
    expect(result.status).toBe(400);
  });
});
