import {
  seedClerkSession,
  seedActiveStepUp,
  setFixtureStrongAuthentication,
  clerkHeaders,
} from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as expenseCommandPost } from '../../src/app/api/expenses/commands/route';
import { GET as expenseListGet } from '../../src/app/api/expenses/list/route';
import { GET as expenseSummaryGet } from '../../src/app/api/expenses/summary/route';
import { GET as expenseReferenceGet } from '../../src/app/api/expenses/reference/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for A6 expense integration tests.');
}

const ids = {
  tenant: 'e6a00000-0000-4000-8000-000000000001',
  legal: 'e6a00000-0000-4000-8000-000000000011',
  station: 'e6a00000-0000-4000-8000-000000000021',
  station2: 'e6a00000-0000-4000-8000-000000000022',
  supervisor: 'e6a00000-0000-4000-8000-000000000031',
  supervisorMembership: 'e6a00000-0000-4000-8000-000000000041',
  supervisorSession: 'e6a00000-0000-4000-8000-000000000051',
  finance: 'e6a00000-0000-4000-8000-000000000032',
  financeMembership: 'e6a00000-0000-4000-8000-000000000042',
  financeSession: 'e6a00000-0000-4000-8000-000000000052',
  admin: 'e6a00000-0000-4000-8000-000000000033',
  adminMembership: 'e6a00000-0000-4000-8000-000000000043',
  adminSession: 'e6a00000-0000-4000-8000-000000000053',
  tenantB: 'e6b00000-0000-4000-8000-000000000001',
  legalB: 'e6b00000-0000-4000-8000-000000000011',
  stationB: 'e6b00000-0000-4000-8000-000000000021',
  financeB: 'e6b00000-0000-4000-8000-000000000032',
  financeBMembership: 'e6b00000-0000-4000-8000-000000000042',
  financeBSession: 'e6b00000-0000-4000-8000-000000000052',
  safe: 'e6a00000-0000-4000-8000-000000000081',
};

const tokens = {
  supervisor: 'e6-supervisor-token',
  finance: 'e6-finance-token',
  admin: 'e6-admin-token',
  financeB: 'e6-finance-b-token',
};

type Json = Record<string, any>;
let client: Sql;

async function command(token: string | null, input: Json, key: string = randomUUID()) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': key,
    'x-real-ip': `e6-${randomUUID()}`,
  });
  if (token)
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

async function read(
  handler: typeof expenseListGet,
  path: string,
  params: Record<string, string>,
  token: string = tokens.finance,
) {
  const url = new URL(`http://127.0.0.1:3000/api/expenses/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await handler(new Request(url, { headers: clerkHeaders(token) }));
  return { status: response.status, json: (await response.json()) as Json };
}

const station = { tenantId: ids.tenant, stationId: ids.station };
const entity = { tenantId: ids.tenant, legalEntityId: ids.legal };

const category: Record<string, string> = {};
async function movementNet(sourceId: string): Promise<string> {
  const rows = await client`
    select coalesce(sum(case when movement_type = 'RECOGNITION' then amount else -amount end), 0)::text as net
    from app.expense_recognition_movements where tenant_id = ${ids.tenant} and source_id = ${sourceId}`;
  return rows[0]!.net as string;
}

async function submit(amount: string, overrides: Json = {}, token = tokens.supervisor) {
  return command(token, {
    ...station,
    commandType: 'SubmitExpense',
    categoryId: category.clean,
    expenseDate: '2026-10-01',
    description: 'Station cleaning',
    amount,
    ...overrides,
  });
}

async function approvedAndPosted(amount: string, overrides: Json = {}) {
  const submitted = await submit(amount, overrides);
  expect(submitted.status).toBe(201);
  const approved = await command(tokens.finance, {
    ...station,
    commandType: 'ApproveExpense',
    expenseId: submitted.json.expenseId,
    expectedVersion: 0,
  });
  expect(approved.status).toBe(200);
  const posted = await command(tokens.admin, {
    ...station,
    commandType: 'PostExpense',
    expenseId: submitted.json.expenseId,
    expectedVersion: approved.json.version,
  });
  expect(posted.status).toBe(200);
  return { expenseId: submitted.json.expenseId as string, version: posted.json.version as number };
}

describe('A6 expenses PostgreSQL persistence', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-e6-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-e6-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'E6 Expense Tenant', 'e6-expense-tenant'),
        ('${ids.tenantB}', 'E6 Expense Tenant B', 'e6-expense-tenant-b')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.supervisor}', 'E6 Supervisor', 'e6-supervisor@example.test'),
        ('${ids.finance}', 'E6 Finance', 'e6-finance@example.test'),
        ('${ids.admin}', 'E6 Admin', 'e6-admin@example.test'),
        ('${ids.financeB}', 'E6 Finance B', 'e6-finance-b@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisor}', 'ACTIVE'),
        ('${ids.financeMembership}', '${ids.tenant}', '${ids.finance}', 'ACTIVE'),
        ('${ids.adminMembership}', '${ids.tenant}', '${ids.admin}', 'ACTIVE'),
        ('${ids.financeBMembership}', '${ids.tenantB}', '${ids.financeB}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'E6 Legal'),
        ('${ids.legalB}', '${ids.tenantB}', 'E6 Legal B')
        on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'E6ST1', 'E6 Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.station2}', '${ids.tenant}', '${ids.legal}', 'E6ST2', 'E6 Station Two', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationB}', '${ids.tenantB}', '${ids.legalB}', 'E6STB', 'E6 Station B', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.financeMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.tenant}', '${ids.adminMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenantB}', '${ids.financeBMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legalB}', null)
        on conflict do nothing;
      insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type) values
        ('${ids.safe}', '${ids.tenant}', '${ids.station}', 'E6SAFE', 'E6 Safe', 'STATION_SAFE')
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.supervisorSession, tokens.supervisor, ids.supervisor, true);
    await seedClerkSession(client, ids.financeSession, tokens.finance, ids.finance, true);
    await seedClerkSession(client, ids.adminSession, tokens.admin, ids.admin, true);
    await seedClerkSession(client, ids.financeBSession, tokens.financeB, ids.financeB, true);
    for (const [session, tenant] of [
      [ids.supervisorSession, ids.tenant],
      [ids.financeSession, ids.tenant],
      [ids.adminSession, ids.tenant],
      [ids.financeBSession, ids.tenantB],
    ] as const) {
      await seedActiveStepUp(client, session, tenant);
    }
  });

  afterAll(async () => client?.end());

  it('denies unauthenticated callers and enforces role permissions', async () => {
    expect((await submit('10.00', {}, '')).status).toBe(401);
    const noPolicyRights = await command(tokens.finance, {
      ...entity,
      commandType: 'SetExpensePolicy',
      stepUpThreshold: '250',
      secondApprovalThreshold: null,
    });
    expect(noPolicyRights.status).toBe(403);
    const categoryAsSupervisor = await command(tokens.supervisor, {
      ...entity,
      commandType: 'CreateExpenseCategory',
      code: 'SUP',
      name: 'Nope',
      classification: 'OPERATING',
    });
    expect(categoryAsSupervisor.status).toBe(403);
  });

  it('creates categories and a versioned policy with optimistic locking', async () => {
    for (const [key, code, classification] of [
      ['clean', 'E6-CLEAN', 'OPERATING'],
      ['rent', 'E6-RENT', 'FIXED_COST'],
      ['freight', 'E6-FREIGHT', 'DIRECT_INVENTORY_COST'],
    ] as const) {
      const created = await command(tokens.finance, {
        ...entity,
        commandType: 'CreateExpenseCategory',
        code,
        name: `${code} name`,
        classification,
      });
      expect(created.status).toBe(201);
      category[key] = created.json.categoryId;
    }
    const duplicate = await command(tokens.finance, {
      ...entity,
      commandType: 'CreateExpenseCategory',
      code: 'E6-CLEAN',
      name: 'again',
      classification: 'OPERATING',
    });
    expect(duplicate.status).toBe(409);

    const body = { ...entity, commandType: 'SetExpensePolicy', secondApprovalThreshold: '1000' };
    const missingVersionFirst = await command(tokens.admin, {
      ...body,
      stepUpThreshold: '250',
      expectedVersion: 3,
    });
    expect(missingVersionFirst.status).toBe(409);
    const first = await command(tokens.admin, { ...body, stepUpThreshold: '250' });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      version: 0,
      stepUpThreshold: '250.0000',
      secondApprovalThreshold: '1000.0000',
    });
    const stale = await command(tokens.admin, {
      ...body,
      stepUpThreshold: '300',
      expectedVersion: 7,
    });
    expect(stale.status).toBe(409);
    const withoutStepUp =
      (setFixtureStrongAuthentication(ids.adminSession, false),
      await command(tokens.admin, { ...body, stepUpThreshold: '300', expectedVersion: 0 }));
    setFixtureStrongAuthentication(ids.adminSession, true);
    expect(withoutStepUp.status).toBe(403);
  });

  it('submits idempotently and validates exact input', async () => {
    const key = randomUUID();
    const input = {
      ...station,
      commandType: 'SubmitExpense',
      categoryId: category.clean,
      expenseDate: '2026-10-01',
      description: 'Mop heads',
      reference: 'E6-REF-1',
      amount: '100.1000',
    };
    const first = await command(tokens.supervisor, input, key);
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ state: 'SUBMITTED', version: 0, amount: '100.1000' });
    const retry = await command(tokens.supervisor, input, key);
    expect(retry.json.expenseId).toBe(first.json.expenseId);
    const rows =
      await client`select count(*)::int as n from app.expenses where reference = 'E6-REF-1'`;
    expect(rows[0]!.n).toBe(1);
    const reused = await command(tokens.supervisor, { ...input, amount: '100.2000' }, key);
    expect(reused.status).toBe(409);
    expect(reused.json.error ?? reused.json.code).toBeDefined();

    expect((await command(tokens.supervisor, { ...input, amount: 100.1 })).status).toBe(400);
    expect(
      (await command(tokens.supervisor, { ...input, reference: 'x', amount: '1.00001' })).status,
    ).toBe(400);
    expect(
      (await command(tokens.supervisor, { ...input, reference: 'x', amount: '0' })).status,
    ).toBe(400);
    expect(
      (await command(tokens.supervisor, { ...input, reference: 'y', expenseDate: '2099-01-01' }))
        .status,
    ).toBe(400);
    expect((await command(tokens.supervisor, { ...input, reference: 'E6-REF-1' })).status).toBe(
      409,
    );
    expect(
      (await command(tokens.supervisor, { ...input, reference: 'z', categoryId: category.freight }))
        .status,
    ).toBe(422);
    expect(
      (await command(tokens.supervisor, { ...input, reference: 'w', categoryId: category.rent }))
        .status,
    ).toBe(422);
    expect((await command(tokens.supervisor, { ...input, commandType: 'Nope' })).status).toBe(400);
    // The supervisor holds no authority at the other station.
    expect(
      (await command(tokens.supervisor, { ...input, reference: 'v', stationId: ids.station2 }))
        .status,
    ).toBe(403);
  });

  it('drives approval with separation of duties, thresholds, step-up and stale versions', async () => {
    const small = await submit('100.0000');
    const supervisorApproves = await command(tokens.supervisor, {
      ...station,
      commandType: 'ApproveExpense',
      expenseId: small.json.expenseId,
      expectedVersion: 0,
    });
    expect(supervisorApproves.status).toBe(403);

    // Below the step-up threshold, approval does not need a fresh step-up.
    setFixtureStrongAuthentication(ids.financeSession, false);
    const stale = await command(tokens.finance, {
      ...station,
      commandType: 'ApproveExpense',
      expenseId: small.json.expenseId,
      expectedVersion: 5,
    });
    expect(stale.status).toBe(409);
    const approved = await command(tokens.finance, {
      ...station,
      commandType: 'ApproveExpense',
      expenseId: small.json.expenseId,
      expectedVersion: 0,
    });
    expect(approved.status).toBe(200);
    expect(approved.json).toMatchObject({ state: 'APPROVED', version: 1, approvals: 1 });

    // At or above the threshold, step-up is required.
    const large = await submit('250.0000');
    const needsStepUp = await command(tokens.finance, {
      ...station,
      commandType: 'ApproveExpense',
      expenseId: large.json.expenseId,
      expectedVersion: 0,
    });
    expect(needsStepUp.status).toBe(403);
    setFixtureStrongAuthentication(ids.financeSession, true);
    expect(
      (
        await command(tokens.finance, {
          ...station,
          commandType: 'ApproveExpense',
          expenseId: large.json.expenseId,
          expectedVersion: 0,
        })
      ).status,
    ).toBe(200);

    // Posting before approval and approving twice are refused.
    const pending = await submit('20.0000');
    expect(
      (
        await command(tokens.finance, {
          ...station,
          commandType: 'PostExpense',
          expenseId: pending.json.expenseId,
          expectedVersion: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await command(tokens.finance, {
          ...station,
          commandType: 'ApproveExpense',
          expenseId: small.json.expenseId,
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);

    // A submitter cannot approve their own expense while another approver exists.
    const own = await submit('30.0000', {}, tokens.finance);
    const selfApprove = await command(tokens.finance, {
      ...station,
      commandType: 'ApproveExpense',
      expenseId: own.json.expenseId,
      expectedVersion: 0,
    });
    expect(selfApprove.status).toBe(403);
    expect(
      (
        await command(tokens.admin, {
          ...station,
          commandType: 'ApproveExpense',
          expenseId: own.json.expenseId,
          expectedVersion: 0,
        })
      ).status,
    ).toBe(200);

    // Rejection needs a reason and is terminal.
    const toReject = await submit('15.0000');
    expect(
      (
        await command(tokens.finance, {
          ...station,
          commandType: 'RejectExpense',
          expenseId: toReject.json.expenseId,
          expectedVersion: 0,
          reason: ' ',
        })
      ).status,
    ).toBe(400);
    const rejected = await command(tokens.finance, {
      ...station,
      commandType: 'RejectExpense',
      expenseId: toReject.json.expenseId,
      expectedVersion: 0,
      reason: 'No receipt',
    });
    expect(rejected.json).toMatchObject({ state: 'REJECTED', version: 1 });
    expect(
      (
        await command(tokens.admin, {
          ...station,
          commandType: 'ApproveExpense',
          expenseId: toReject.json.expenseId,
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);
  });

  it('requires two distinct approvers above the second-approval threshold', async () => {
    const big = await submit('1500.0000');
    expect(big.json.requiredApprovals).toBe(2);
    const approve = (token: string, version: number) =>
      command(token, {
        ...station,
        commandType: 'ApproveExpense',
        expenseId: big.json.expenseId,
        expectedVersion: version,
      });
    const first = await approve(tokens.finance, 0);
    expect(first.json).toMatchObject({ state: 'SUBMITTED', approvals: 1, version: 1 });
    expect((await approve(tokens.finance, 1)).status).toBe(409);
    const postEarly = await command(tokens.admin, {
      ...station,
      commandType: 'PostExpense',
      expenseId: big.json.expenseId,
      expectedVersion: 1,
    });
    expect(postEarly.status).toBe(409);
    const second = await approve(tokens.admin, 1);
    expect(second.json).toMatchObject({ state: 'APPROVED', approvals: 2, version: 2 });
  });

  it('allows a solo approver when nobody else could approve', async () => {
    const created = await command(tokens.financeB, {
      tenantId: ids.tenantB,
      legalEntityId: ids.legalB,
      commandType: 'CreateExpenseCategory',
      code: 'B-OPS',
      name: 'Ops',
      classification: 'OPERATING',
    });
    const submitted = await command(tokens.financeB, {
      tenantId: ids.tenantB,
      stationId: ids.stationB,
      commandType: 'SubmitExpense',
      categoryId: created.json.categoryId,
      expenseDate: '2026-10-01',
      description: 'Solo operator cost',
      amount: '12.5000',
    });
    expect(submitted.status).toBe(201);
    const approved = await command(tokens.financeB, {
      tenantId: ids.tenantB,
      stationId: ids.stationB,
      commandType: 'ApproveExpense',
      expenseId: submitted.json.expenseId,
      expectedVersion: 0,
    });
    expect(approved.status).toBe(200);
  });

  it('posts recognition once and keeps settlement separate, exact and capped', async () => {
    const { expenseId, version } = await approvedAndPosted('100.1000');
    expect(await movementNet(expenseId)).toBe('100.1000');

    const base = { ...station, commandType: 'RecordExpensePayment', expenseId };
    const exceeds = await command(tokens.finance, {
      ...base,
      expectedVersion: version,
      paymentDate: '2026-10-02',
      amount: '100.1001',
      settlementSource: 'BANK',
      externalReference: 'BANK-1',
    });
    expect(exceeds.status).toBe(422);
    const noReference = await command(tokens.finance, {
      ...base,
      expectedVersion: version,
      paymentDate: '2026-10-02',
      amount: '10',
      settlementSource: 'BANK',
    });
    expect(noReference.status).toBe(400);

    const part = await command(tokens.finance, {
      ...base,
      expectedVersion: version,
      paymentDate: '2026-10-02',
      amount: '60.0500',
      settlementSource: 'BANK',
      externalReference: 'BANK-1',
    });
    expect(part.status).toBe(201);
    expect(part.json).toMatchObject({
      paymentStatus: 'PARTIALLY_PAID',
      outstanding: '40.0500',
      version: version + 1,
    });
    const stalePayment = await command(tokens.finance, {
      ...base,
      expectedVersion: version,
      paymentDate: '2026-10-02',
      amount: '40.0500',
      settlementSource: 'BANK',
      externalReference: 'BANK-2',
    });
    expect(stalePayment.status).toBe(409);

    // A cash settlement links an existing cash disbursement and must match it exactly.
    const movementId = randomUUID();
    await client`
      insert into app.cash_movements (id, tenant_id, station_id, movement_type, amount, from_location_id,
        source_type, source_id, business_date, effective_at, actor_membership_id)
      values (${movementId}, ${ids.tenant}, ${ids.station}, 'DISBURSEMENT', 40.05, ${ids.safe},
        'TEST_PETTY_CASH', ${randomUUID()}, '2026-10-02', now(), ${ids.financeMembership})`;
    const wrongAmount = await command(tokens.finance, {
      ...base,
      expectedVersion: version + 1,
      paymentDate: '2026-10-02',
      amount: '40.0400',
      settlementSource: 'CASH',
      cashMovementId: movementId,
    });
    expect(wrongAmount.status).toBe(422);
    const rest = await command(tokens.finance, {
      ...base,
      expectedVersion: version + 1,
      paymentDate: '2026-10-02',
      amount: '40.0500',
      settlementSource: 'CASH',
      cashMovementId: movementId,
    });
    expect(rest.json).toMatchObject({ paymentStatus: 'PAID', outstanding: '0.0000' });
    // Settlement never touches recognition or the cash ledger.
    expect(await movementNet(expenseId)).toBe('100.1000');
    const movementCount = await client`
      select count(*)::int as n from app.cash_movements where tenant_id = ${ids.tenant} and source_type like 'EXPENSE%'`;
    expect(movementCount[0]!.n).toBe(0);
    // A cash movement cannot settle two obligations.
    const other = await approvedAndPosted('40.0500', { description: 'Second' });
    const reuse = await command(tokens.finance, {
      ...station,
      commandType: 'RecordExpensePayment',
      expenseId: other.expenseId,
      expectedVersion: other.version,
      paymentDate: '2026-10-02',
      amount: '40.0500',
      settlementSource: 'CASH',
      cashMovementId: movementId,
    });
    expect(reuse.status).toBe(409);

    // An unposted expense cannot be paid: a payment never creates the expense.
    const unposted = await submit('5.0000');
    const payUnposted = await command(tokens.finance, {
      ...station,
      commandType: 'RecordExpensePayment',
      expenseId: unposted.json.expenseId,
      expectedVersion: 0,
      paymentDate: '2026-10-02',
      amount: '5.0000',
      settlementSource: 'REIMBURSEMENT',
      externalReference: 'VCH-1',
    });
    expect(payUnposted.status).toBe(422);
    const paymentsCreatedExpenses = await client`
      select count(*)::int as n from app.expenses where tenant_id = ${ids.tenant} and state = 'POSTED' and id = ${unposted.json.expenseId}`;
    expect(paymentsCreatedExpenses[0]!.n).toBe(0);
  });

  it('reverses settlements then the expense, never mutating history', async () => {
    const { expenseId, version } = await approvedAndPosted('80.0000');
    const paid = await command(tokens.finance, {
      ...station,
      commandType: 'RecordExpensePayment',
      expenseId,
      expectedVersion: version,
      paymentDate: '2026-10-03',
      amount: '80.0000',
      settlementSource: 'BANK',
      externalReference: 'BANK-R1',
    });
    expect(paid.status).toBe(201);

    const blocked = await command(tokens.finance, {
      ...station,
      commandType: 'ReverseExpense',
      expenseId,
      expectedVersion: version + 1,
      reason: 'Duplicate invoice',
    });
    expect(blocked.status).toBe(422);

    setFixtureStrongAuthentication(ids.financeSession, false);
    const noStepUp = await command(tokens.finance, {
      ...station,
      commandType: 'ReverseExpensePayment',
      paymentId: paid.json.paymentId,
      expectedVersion: version + 1,
      reason: 'Wrong bank ref',
    });
    expect(noStepUp.status).toBe(403);
    setFixtureStrongAuthentication(ids.financeSession, true);

    const reversedPayment = await command(tokens.finance, {
      ...station,
      commandType: 'ReverseExpensePayment',
      paymentId: paid.json.paymentId,
      expectedVersion: version + 1,
      reason: 'Wrong bank ref',
    });
    expect(reversedPayment.status).toBe(200);
    expect(
      (
        await command(tokens.finance, {
          ...station,
          commandType: 'ReverseExpensePayment',
          paymentId: paid.json.paymentId,
          expectedVersion: version + 2,
          reason: 'again',
        })
      ).status,
    ).toBe(409);

    const reversed = await command(tokens.finance, {
      ...station,
      commandType: 'ReverseExpense',
      expenseId,
      expectedVersion: version + 2,
      reason: 'Duplicate invoice',
    });
    expect(reversed.status).toBe(200);
    expect(reversed.json.state).toBe('REVERSED');
    expect(await movementNet(expenseId)).toBe('0.0000');
    const rows = await client`
      select movement_type from app.expense_recognition_movements
      where source_id = ${expenseId} order by movement_type`;
    expect(rows.map((row) => row.movement_type)).toEqual(['RECOGNITION', 'REVERSAL']);
    expect(
      (
        await command(tokens.finance, {
          ...station,
          commandType: 'ReverseExpense',
          expenseId,
          expectedVersion: version + 3,
          reason: 'twice',
        })
      ).status,
    ).toBe(409);
    // Reversal of the reference frees it for a corrected submission.
    expect((await submit('80.0000', { reference: 'E6-REUSE' })).status).toBe(201);
  });

  it('keeps recurring recognition, daily split and payment separate', async () => {
    const wrongCategory = await command(tokens.finance, {
      ...station,
      commandType: 'CreateRecurringCostTemplate',
      categoryId: category.clean,
      name: 'Bad',
      amount: '10',
      startDate: '2026-09-01',
    });
    expect(wrongCategory.status).toBe(422);
    const template = await command(tokens.finance, {
      ...station,
      commandType: 'CreateRecurringCostTemplate',
      categoryId: category.rent,
      name: 'Shop rent',
      amount: '1000.0000',
      startDate: '2026-09-01',
    });
    expect(template.status).toBe(201);
    const midMonth = await command(tokens.finance, {
      ...station,
      commandType: 'GenerateRecurringCostPeriod',
      templateId: template.json.templateId,
      periodStart: '2026-09-15',
    });
    expect(midMonth.status).toBe(400);
    const period = await command(tokens.finance, {
      ...station,
      commandType: 'GenerateRecurringCostPeriod',
      templateId: template.json.templateId,
      periodStart: '2026-09-01',
    });
    expect(period.status).toBe(201);
    expect(period.json).toMatchObject({ periodEnd: '2026-09-30', amount: '1000.0000' });
    expect(
      (
        await command(tokens.finance, {
          ...station,
          commandType: 'GenerateRecurringCostPeriod',
          templateId: template.json.templateId,
          periodStart: '2026-09-01',
        })
      ).status,
    ).toBe(409);

    const recognize = (recognitionDate: string) =>
      command(tokens.finance, {
        ...station,
        commandType: 'RecognizeRecurringCost',
        periodId: period.json.periodId,
        recognitionDate,
      });
    const first = await recognize('2026-09-01');
    expect(first.json.amount).toBe('33.3333');
    const last = await recognize('2026-09-30');
    expect(last.json.amount).toBe('33.3343');
    expect((await recognize('2026-09-01')).status).toBe(409);
    expect((await recognize('2026-10-01')).status).toBe(400);
    expect((await recognize('2099-09-01')).status).toBe(400);

    const movementsBefore = await client`
      select count(*)::int as n from app.expense_recognition_movements where tenant_id = ${ids.tenant}`;
    const expensesBefore =
      await client`select count(*)::int as n from app.expenses where tenant_id = ${ids.tenant}`;
    // Paying the obligation, even in full, does not recognize anything new.
    const paid = await command(tokens.finance, {
      ...station,
      commandType: 'RecordExpensePayment',
      recurringPeriodId: period.json.periodId,
      expectedVersion: 0,
      paymentDate: '2026-09-02',
      amount: '1000.0000',
      settlementSource: 'BANK',
      externalReference: 'RENT-SEP',
    });
    expect(paid.json).toMatchObject({ paymentStatus: 'PAID', outstanding: '0.0000' });
    const movementsAfter = await client`
      select count(*)::int as n from app.expense_recognition_movements where tenant_id = ${ids.tenant}`;
    const expensesAfter =
      await client`select count(*)::int as n from app.expenses where tenant_id = ${ids.tenant}`;
    expect(movementsAfter[0]!.n).toBe(movementsBefore[0]!.n);
    expect(expensesAfter[0]!.n).toBe(expensesBefore[0]!.n);

    setFixtureStrongAuthentication(ids.financeSession, false);
    const noStepUp = await command(tokens.finance, {
      ...station,
      commandType: 'ReverseRecurringCostRecognition',
      periodId: period.json.periodId,
      recognitionDate: '2026-09-01',
      reason: 'Mistake',
    });
    expect(noStepUp.status).toBe(403);
    setFixtureStrongAuthentication(ids.financeSession, true);
    expect(
      (
        await command(tokens.finance, {
          ...station,
          commandType: 'ReverseRecurringCostRecognition',
          periodId: period.json.periodId,
          recognitionDate: '2026-09-01',
          reason: 'Mistake',
        })
      ).status,
    ).toBe(200);
    const net = await client`
      select coalesce(sum(case when movement_type = 'RECOGNITION' then amount else -amount end), 0)::text as net
      from app.expense_recognition_movements
      where tenant_id = ${ids.tenant} and source_type = 'RECURRING_COST_RECOGNITION'`;
    expect(net[0]!.net).toBe('33.3343');
  });

  it('serializes concurrent settlements with optimistic versions', async () => {
    const { expenseId, version } = await approvedAndPosted('100.0000');
    const attempt = (reference: string) =>
      command(tokens.finance, {
        ...station,
        commandType: 'RecordExpensePayment',
        expenseId,
        expectedVersion: version,
        paymentDate: '2026-10-04',
        amount: '60.0000',
        settlementSource: 'BANK',
        externalReference: reference,
      });
    const results = await Promise.all([attempt('C1'), attempt('C2'), attempt('C3')]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(2);
    const total = await client`
      select coalesce(sum(amount), 0)::text as total from app.expense_payments
      where expense_id = ${expenseId} and state = 'RECORDED'`;
    expect(total[0]!.total).toBe('60.0000');

    const submitted = await submit('9.0000');
    const approvals = await Promise.all(
      [1, 2].map(() =>
        command(tokens.finance, {
          ...station,
          commandType: 'ApproveExpense',
          expenseId: submitted.json.expenseId,
          expectedVersion: 0,
        }),
      ),
    );
    expect(approvals.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it('serves list, detail, summary and reference reads with exact decimals', async () => {
    const list = await read(expenseListGet, 'list', { ...station, state: 'POSTED' });
    expect(list.status).toBe(200);
    expect(list.json.items.length).toBeGreaterThan(0);
    const paid = list.json.items.find((item: Json) => item.paymentStatus === 'PAID');
    expect(paid.settledAmount).toBe(paid.amount);
    const detail = await read(expenseListGet, 'list', {
      ...station,
      expenseId: paid.expenseId,
    });
    expect(detail.json.detail.approvals.length).toBeGreaterThan(0);
    expect(detail.json.detail.payments.length).toBeGreaterThan(0);

    const summary = await read(expenseSummaryGet, 'summary', {
      ...entity,
      from: '2026-09-01',
      to: '2026-10-31',
    });
    expect(summary.status).toBe(200);
    expect(summary.json.fixedCostRecognition).toBe('33.3343');
    expect(typeof summary.json.operatingExpenses).toBe('string');
    expect(summary.json.byCategory.length).toBeGreaterThan(0);

    const reference = await read(expenseReferenceGet, 'reference', entity);
    expect(reference.json.categories.map((row: Json) => row.code)).toContain('E6-RENT');
    expect(reference.json.policy).toMatchObject({ stepUpThreshold: '250.0000' });
    expect(reference.json.periods[0].periodStart).toBe('2026-09-01');

    // A supervisor can read their own station but not the whole legal entity.
    expect((await read(expenseListGet, 'list', station, tokens.supervisor)).status).toBe(200);
    expect((await read(expenseListGet, 'list', entity, tokens.supervisor)).status).toBe(403);
    expect(
      (await read(expenseListGet, 'list', { tenantId: ids.tenant }, tokens.finance)).status,
    ).toBe(400);
  });

  it('denies cross-tenant access in the application', async () => {
    const mine = await submit('1.0000');
    // Tenant B's finance user cannot act inside tenant A.
    const foreign = await command(tokens.financeB, {
      ...station,
      commandType: 'ApproveExpense',
      expenseId: mine.json.expenseId,
      expectedVersion: 0,
    });
    expect(foreign.status).toBe(403);
    // Nor can they reach tenant A's expense through their own tenant.
    const ownTenantForeignId = await command(tokens.financeB, {
      tenantId: ids.tenantB,
      stationId: ids.stationB,
      commandType: 'ApproveExpense',
      expenseId: mine.json.expenseId,
      expectedVersion: 0,
    });
    expect(ownTenantForeignId.status).toBe(404);
    // Nor mix tenant B with tenant A's station.
    const mixed = await command(tokens.financeB, {
      tenantId: ids.tenantB,
      stationId: ids.station,
      commandType: 'SubmitExpense',
      categoryId: category.clean,
      expenseDate: '2026-10-01',
      description: 'Cross',
      amount: '1',
    });
    expect(mixed.status).toBe(404);
    expect((await read(expenseListGet, 'list', station, tokens.financeB)).status).toBe(403);
    const ownList = await read(
      expenseListGet,
      'list',
      { tenantId: ids.tenantB, stationId: ids.stationB },
      tokens.financeB,
    );
    expect(ownList.json.items.every((item: Json) => item.stationId === ids.stationB)).toBe(true);
    // A station does not leak through a category from another tenant.
    const foreignCategory = await command(tokens.financeB, {
      tenantId: ids.tenantB,
      stationId: ids.stationB,
      commandType: 'SubmitExpense',
      categoryId: category.clean,
      expenseDate: '2026-10-01',
      description: 'Cross category',
      amount: '1',
    });
    expect(foreignCategory.status).toBe(404);
  });

  it('enforces RLS and append-only grants for the runtime role', async () => {
    const asTenant = async <T>(
      tenantId: string,
      membershipId: string,
      actorId: string,
      work: (sql: Sql) => Promise<T>,
    ): Promise<T> => {
      await client.unsafe('set role app_runtime');
      try {
        await client`select set_config('app.tenant_id', ${tenantId}, false)`;
        await client`select set_config('app.actor_id', ${actorId}, false)`;
        await client`select set_config('app.membership_id', ${membershipId}, false)`;
        return await work(client);
      } finally {
        await client.unsafe('reset role');
        await client`reset app.tenant_id`;
        await client`reset app.actor_id`;
        await client`reset app.membership_id`;
      }
    };
    const tables = [
      'expenses',
      'expense_categories',
      'expense_payments',
      'expense_approvals',
      'expense_recognition_movements',
      'recurring_cost_periods',
      'recurring_cost_recognitions',
      'recurring_cost_templates',
      'expense_policies',
    ];
    for (const table of tables) {
      const visibleToB = await asTenant(ids.tenantB, ids.financeBMembership, ids.financeB, (sql) =>
        sql.unsafe(`select tenant_id from app.${table}`),
      );
      expect(visibleToB.every((row) => row.tenant_id === ids.tenantB)).toBe(true);
      const withoutContext = await (async () => {
        await client.unsafe('set role app_runtime');
        try {
          return await client.unsafe(`select count(*)::int as n from app.${table}`);
        } finally {
          await client.unsafe('reset role');
        }
      })();
      expect(withoutContext[0]!.n).toBe(0);
    }
    const visibleToA = await asTenant(
      ids.tenant,
      ids.financeMembership,
      ids.finance,
      (sql) => sql`select count(*)::int as n from app.expenses`,
    );
    expect(visibleToA[0]!.n).toBeGreaterThan(0);

    // Cross-tenant writes are rejected by the policy, and rows written under B are B's.
    await expect(
      asTenant(
        ids.tenantB,
        ids.financeBMembership,
        ids.financeB,
        (sql) =>
          sql`insert into app.expense_categories (tenant_id, code, name, classification, created_by)
            values (${ids.tenant}, 'E6-X', 'x', 'OPERATING', ${ids.financeBMembership})`,
      ),
    ).rejects.toThrow();
    const crossUpdate = await asTenant(
      ids.tenantB,
      ids.financeBMembership,
      ids.financeB,
      (sql) => sql`update app.expenses set state = 'REVERSED' where tenant_id = ${ids.tenant}`,
    );
    expect(crossUpdate.count).toBe(0);

    // The runtime role can neither delete nor rewrite facts.
    await expect(
      asTenant(
        ids.tenant,
        ids.financeMembership,
        ids.finance,
        (sql) => sql`delete from app.expenses where tenant_id = ${ids.tenant}`,
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(
        ids.tenant,
        ids.financeMembership,
        ids.finance,
        (sql) =>
          sql`update app.expense_recognition_movements set amount = 1 where tenant_id = ${ids.tenant}`,
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(
        ids.tenant,
        ids.financeMembership,
        ids.finance,
        (sql) =>
          sql`update app.expense_approvals set decision = 'REJECTED' where tenant_id = ${ids.tenant}`,
      ),
    ).rejects.toThrow();
  });

  it('guards immutable facts and transitions in PostgreSQL itself', async () => {
    const { expenseId } = await approvedAndPosted('7.0000');
    await expect(
      client`update app.expenses set amount = 1 where id = ${expenseId}`,
    ).rejects.toThrow(/immutable/);
    await expect(
      client`update app.expenses set state = 'SUBMITTED' where id = ${expenseId}`,
    ).rejects.toThrow(/posted expenses can only be reversed/);
    const submitted = await submit('3.0000');
    await expect(
      client`update app.expenses set state = 'APPROVED' where id = ${submitted.json.expenseId}`,
    ).rejects.toThrow(/required number of approvals/);
    await expect(
      client`update app.expenses set state = 'POSTED' where id = ${submitted.json.expenseId}`,
    ).rejects.toThrow();
    await expect(
      client`insert into app.expense_recognition_movements (tenant_id, legal_entity_id, station_id,
        category_id, classification, movement_type, source_type, source_id, recognition_date, amount,
        reversal_of_id, actor_membership_id)
        select tenant_id, legal_entity_id, station_id, category_id, classification, 'REVERSAL',
          source_type, source_id, recognition_date, amount + 1, id, actor_membership_id
        from app.expense_recognition_movements where source_id = ${expenseId}`,
    ).rejects.toThrow(/must identify and match/);
    // Overpaying is impossible even when the application is bypassed.
    await expect(
      client`insert into app.expense_payments (tenant_id, legal_entity_id, station_id, expense_id,
        payment_date, amount, settlement_source, external_reference, recorded_by)
        values (${ids.tenant}, ${ids.legal}, ${ids.station}, ${expenseId}, '2026-10-05', 7.0001,
          'BANK', 'X', ${ids.financeMembership})`,
    ).rejects.toThrow(/exceed/);
  });

  it('writes an audit event for each money-affecting command', async () => {
    const rows = await client`
      select event_code, count(*)::int as n from platform.security_events
      where tenant_id = ${ids.tenant} and event_code like 'EXPENSE.%'
      group by event_code`;
    const codes = new Map(rows.map((row) => [row.event_code as string, row.n as number]));
    for (const code of [
      'EXPENSE.CATEGORY_CREATED',
      'EXPENSE.POLICY_SET',
      'EXPENSE.SUBMITTED',
      'EXPENSE.APPROVED',
      'EXPENSE.REJECTED',
      'EXPENSE.POSTED',
      'EXPENSE.REVERSED',
      'EXPENSE.PAYMENT_RECORDED',
      'EXPENSE.PAYMENT_REVERSED',
      'EXPENSE.RECURRING_TEMPLATE_CREATED',
      'EXPENSE.RECURRING_PERIOD_GENERATED',
      'EXPENSE.RECURRING_COST_RECOGNIZED',
      'EXPENSE.RECURRING_RECOGNITION_REVERSED',
    ]) {
      expect(codes.get(code) ?? 0, code).toBeGreaterThan(0);
    }
    // Failed commands (stale, forbidden) leave no audit event or idempotency residue.
    const submitted = codes.get('EXPENSE.SUBMITTED') ?? 0;
    const expenses =
      await client`select count(*)::int as n from app.expenses where tenant_id = ${ids.tenant}`;
    expect(submitted).toBe(expenses[0]!.n);
  });
});
