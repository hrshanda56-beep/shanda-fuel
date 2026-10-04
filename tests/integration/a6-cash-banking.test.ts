import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { makeSignature } from 'better-auth/crypto';
import { POST as cashCommandPost } from '../../src/app/api/cash/commands/route';
import { GET as cashSummaryGet } from '../../src/app/api/cash/summary/route';
import { ExactDecimal } from '../../src/platform/domain/primitives';
import { seedActiveStepUp } from './auth-session-fixtures';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A6 cash/banking integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const ids = {
  tenant: 'a6b00000-0000-4000-8000-000000000001',
  legal: 'a6b00000-0000-4000-8000-000000000011',
  station: 'a6b00000-0000-4000-8000-000000000021',
  supervisorActor: 'a6b00000-0000-4000-8000-000000000031',
  supervisorMembership: 'a6b00000-0000-4000-8000-000000000041',
  supervisorSession: 'a6b00000-0000-4000-8000-000000000051',
  managerActor: 'a6b00000-0000-4000-8000-000000000032',
  managerMembership: 'a6b00000-0000-4000-8000-000000000042',
  managerSession: 'a6b00000-0000-4000-8000-000000000052',
  day: 'a6b00000-0000-4000-8000-000000000061',
  reconciliation: 'a6b00000-0000-4000-8000-000000000071',
  till: 'a6b00000-0000-4000-8000-000000000081',
  safe: 'a6b00000-0000-4000-8000-000000000091',
  bankAccount: 'a6b00000-0000-4000-8000-000000000101',
};

const stationContext = {
  organisationId: ids.tenant,
  legalEntityId: ids.legal,
  stationId: ids.station,
  allStations: false,
} as const;

let client: Sql;

async function signedCookie(token: string): Promise<string> {
  return `${token}.${await makeSignature(token, process.env.BETTER_AUTH_SECRET!)}`;
}

async function postCashCommand(
  input: Record<string, unknown>,
  key: string,
  token: string | null = 'a6-supervisor-session-token',
) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': key,
  });
  if (token) headers.set('cookie', `shanda-fuel.session_token=${await signedCookie(token)}`);
  return cashCommandPost(
    new Request('http://127.0.0.1:3000/api/cash/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }),
  );
}

async function readCashSummary(token = 'a6-manager-session-token') {
  return cashSummaryGet(
    new Request(
      `http://127.0.0.1:3000/api/cash/summary?tenantId=${ids.tenant}&stationId=${ids.station}`,
      { headers: { cookie: `shanda-fuel.session_token=${await signedCookie(token)}` } },
    ),
  );
}

async function body(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

function expectDecimal(actual: string, expected: string) {
  expect(new ExactDecimal(actual).equals(new ExactDecimal(expected))).toBe(true);
}

describe('A6 cash collection and banking persistence', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a6-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a6-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A6 Cash Tenant', 'a6-cash-tenant')
        on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.supervisorActor}', 'A6 Supervisor', 'a6-supervisor@example.test'),
        ('${ids.managerActor}', 'A6 Manager', 'a6-manager@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE'),
        ('${ids.managerMembership}', '${ids.tenant}', '${ids.managerActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A6 Cash Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A6CASH', 'A6 Cash Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.managerMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict (id) do nothing;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-09-23', 'NOT_STARTED')
        on conflict (id) do nothing;
      insert into app.reconciliations
        (id, tenant_id, station_id, business_day_id, state, version, approved_by, approved_at)
        values ('${ids.reconciliation}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'DRAFT', 0, null, null)
        on conflict (id) do nothing;
      insert into app.reconciliation_cash_declarations
        (id, tenant_id, station_id, reconciliation_id, counted_cash, expected_physical_cash, cash_paid_expenses, net_expected_cash, cash_variance, entered_by)
        values ('${randomUUID()}', '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', 1000, 1000, 0, 1000, 0, '${ids.supervisorMembership}')
        on conflict (tenant_id, station_id, reconciliation_id) do update set counted_cash = 1000, expected_physical_cash = 1000, cash_paid_expenses = 0, net_expected_cash = 1000, cash_variance = 0;
      update app.reconciliations
        set state = 'SUBMITTED', submitted_by = '${ids.supervisorMembership}', submitted_at = now()
        where id = '${ids.reconciliation}' and state = 'DRAFT';
      update app.reconciliations
        set state = 'APPROVED', approved_by = '${ids.managerMembership}', approved_at = now()
        where id = '${ids.reconciliation}' and state = 'SUBMITTED';
      insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type)
        values
          ('${ids.till}', '${ids.tenant}', '${ids.station}', 'A6-TILL', 'A6 station till', 'STATION_TILL'),
          ('${ids.safe}', '${ids.tenant}', '${ids.station}', 'A6-SAFE', 'A6 station safe', 'STATION_SAFE')
        on conflict (id) do nothing;
      insert into app.bank_accounts
        (id, tenant_id, legal_entity_id, name, bank_name, account_reference_masked)
        values ('${ids.bankAccount}', '${ids.tenant}', '${ids.legal}', 'A6 Operating Account', 'Test Bank', '****0101')
        on conflict (id) do nothing;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values
          ('${ids.supervisorSession}', '2030-01-01T00:00:00Z', 'a6-supervisor-session-token', '${ids.supervisorActor}', true, now()),
          ('${ids.managerSession}', '2030-01-01T00:00:00Z', 'a6-manager-session-token', '${ids.managerActor}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
    `);
    await seedActiveStepUp(client, ids.supervisorSession, ids.tenant);
    await seedActiveStepUp(client, ids.managerSession, ids.tenant);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('persists partial collections, multi-collection deposit allocations, confirmation, and retry safety', async () => {
    const first = await postCashCommand(
      {
        commandType: 'RecordCashCollection',
        context: stationContext,
        collectionReference: 'A6-COL-001',
        sourceLocationId: ids.till,
        sources: [{ reconciliationId: ids.reconciliation, amount: '600.00' }],
      },
      'a6-collection-1',
    );
    const firstBody = await body(first);
    expect(first.status).toBe(201);

    const firstRetry = await postCashCommand(
      {
        commandType: 'RecordCashCollection',
        context: stationContext,
        collectionReference: 'A6-COL-001',
        sourceLocationId: ids.till,
        sources: [{ reconciliationId: ids.reconciliation, amount: '600.00' }],
      },
      'a6-collection-1',
    );
    expect((await body(firstRetry)).collectionId).toBe(firstBody.collectionId);

    const second = await postCashCommand(
      {
        commandType: 'RecordCashCollection',
        context: stationContext,
        collectionReference: 'A6-COL-002',
        sourceLocationId: ids.till,
        sources: [{ reconciliationId: ids.reconciliation, amount: '200.00' }],
      },
      'a6-collection-2',
    );
    const secondBody = await body(second);
    expect(second.status).toBe(201);

    for (const [collectionId, key] of [
      [firstBody.collectionId, 'a6-receive-1'],
      [secondBody.collectionId, 'a6-receive-2'],
    ]) {
      const received = await postCashCommand(
        {
          commandType: 'ReceiveCashCollection',
          context: stationContext,
          collectionId,
          targetLocationId: ids.safe,
          expectedVersion: 0,
        },
        key,
        'a6-manager-session-token',
      );
      expect(received.status).toBe(200);
    }

    const depositInput = {
      commandType: 'CreateBankDeposit',
      context: stationContext,
      bankAccountId: ids.bankAccount,
      sourceLocationId: ids.safe,
      depositReference: 'A6-DEP-001',
      allocations: [
        { collectionId: firstBody.collectionId, amount: '600.00' },
        { collectionId: secondBody.collectionId, amount: '100.00' },
      ],
    };
    const deposit = await postCashCommand(depositInput, 'a6-deposit-1', 'a6-manager-session-token');
    const depositBody = await body(deposit);
    expect(deposit.status).toBe(201);
    expectDecimal(depositBody.amount, '700');

    const depositRetry = await postCashCommand(
      depositInput,
      'a6-deposit-1',
      'a6-manager-session-token',
    );
    expect((await body(depositRetry)).depositId).toBe(depositBody.depositId);

    const beforeConfirmation = await body(await readCashSummary());
    expectDecimal(beforeConfirmation.totals.availableAtStation, '100');
    expectDecimal(beforeConfirmation.totals.collectedButUnbanked, '800');
    expectDecimal(beforeConfirmation.totals.pendingBankConfirmation, '700');

    const confirmed = await postCashCommand(
      {
        commandType: 'ConfirmBankDeposit',
        context: stationContext,
        depositId: depositBody.depositId,
        expectedVersion: 0,
        confirmedAmount: '700.00',
        bankReference: 'BANK-A6-001',
      },
      'a6-confirm-1',
      'a6-manager-session-token',
    );
    expect(confirmed.status).toBe(200);

    const confirmedRetry = await postCashCommand(
      {
        commandType: 'ConfirmBankDeposit',
        context: stationContext,
        depositId: depositBody.depositId,
        expectedVersion: 0,
        confirmedAmount: '700.00',
        bankReference: 'BANK-A6-001',
      },
      'a6-confirm-1',
      'a6-manager-session-token',
    );
    expect((await body(confirmedRetry)).state).toBe('CONFIRMED');

    const afterConfirmation = await body(await readCashSummary());
    expectDecimal(afterConfirmation.totals.availableAtStation, '100');
    expectDecimal(afterConfirmation.totals.collectedButUnbanked, '100');
    expectDecimal(afterConfirmation.totals.pendingBankConfirmation, '0');

    const overAllocation = await postCashCommand(
      {
        commandType: 'CreateBankDeposit',
        context: stationContext,
        bankAccountId: ids.bankAccount,
        sourceLocationId: ids.safe,
        depositReference: 'A6-DEP-OVER',
        allocations: [{ collectionId: secondBody.collectionId, amount: '100.01' }],
      },
      'a6-deposit-over',
      'a6-manager-session-token',
    );
    expect(overAllocation.status).toBe(409);

    const unauthorized = await postCashCommand(
      {
        commandType: 'ConfirmBankDeposit',
        context: stationContext,
        depositId: depositBody.depositId,
        expectedVersion: 0,
        confirmedAmount: '700.00',
        bankReference: 'BANK-A6-001',
      },
      'a6-confirm-unauthorized',
    );
    expect(unauthorized.status).toBe(403);

    const crossTenant = await postCashCommand(
      {
        commandType: 'RecordCashCollection',
        context: {
          ...stationContext,
          organisationId: 'a6b00000-0000-4000-8000-000000000099',
        },
        collectionReference: 'A6-CROSS-TENANT',
        sourceLocationId: ids.till,
        sources: [{ reconciliationId: ids.reconciliation, amount: '1.00' }],
      },
      'a6-cross-tenant',
    );
    expect(crossTenant.status).toBe(403);

    const auditRows = await client.unsafe<{ count: string }[]>(`
      select count(*)::text as count
      from platform.security_events
      where tenant_id='${ids.tenant}'
        and event_code='CASH.RecordCashCollection'
        and details ? 'subjectId'
    `);
    expect(Number(auditRows[0]?.count ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('rejects unauthenticated and all-stations cash commands before any mutation', async () => {
    const unauthenticated = await postCashCommand(
      {
        commandType: 'RecordCashCollection',
        context: stationContext,
        collectionReference: 'A6-UNAUTH',
        sourceLocationId: ids.till,
        sources: [{ reconciliationId: ids.reconciliation, amount: '1.00' }],
      },
      'a6-unauthenticated',
      null,
    );
    expect(unauthenticated.status).toBe(401);

    const allStations = await postCashCommand(
      {
        commandType: 'RecordCashCollection',
        context: {
          organisationId: ids.tenant,
          legalEntityId: ids.legal,
          allStations: true,
        },
        collectionReference: 'A6-ALL-STATIONS',
        sourceLocationId: ids.till,
        sources: [{ reconciliationId: ids.reconciliation, amount: '1.00' }],
      },
      'a6-all-stations',
    );
    expect(allStations.status).toBe(403);
  });
});
