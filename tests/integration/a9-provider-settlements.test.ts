import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';
import { POST as commandPost } from '../../src/app/api/settlements/commands/route';
import { GET as summaryGet } from '../../src/app/api/settlements/summary/route';
import { GET as unmatchedGet } from '../../src/app/api/settlements/unmatched/route';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for A9 provider-settlement integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const ids = {
  tenant: 'a9b00000-0000-4000-8000-000000000001',
  otherTenant: 'a9b00000-0000-4000-8000-000000000002',
  legal: 'a9b00000-0000-4000-8000-000000000011',
  station: 'a9b00000-0000-4000-8000-000000000021',
  otherLegal: 'a9b00000-0000-4000-8000-000000000012',
  otherStation: 'a9b00000-0000-4000-8000-000000000022',
  actor: 'a9b00000-0000-4000-8000-000000000031',
  membership: 'a9b00000-0000-4000-8000-000000000041',
  session: 'a9b00000-0000-4000-8000-000000000051',
  otherActor: 'a9b00000-0000-4000-8000-000000000032',
  supervisorActor: 'a9b00000-0000-4000-8000-000000000033',
  otherMembership: 'a9b00000-0000-4000-8000-000000000042',
  supervisorMembership: 'a9b00000-0000-4000-8000-000000000043',
  otherSession: 'a9b00000-0000-4000-8000-000000000052',
  supervisorSession: 'a9b00000-0000-4000-8000-000000000053',
  day: 'a9b00000-0000-4000-8000-000000000061',
  reconciliation: 'a9b00000-0000-4000-8000-000000000071',
  paymentOne: 'a9b00000-0000-4000-8000-000000000081',
  paymentTwo: 'a9b00000-0000-4000-8000-000000000082',
  cashPayment: 'a9b00000-0000-4000-8000-000000000083',
  paymentThree: 'a9b00000-0000-4000-8000-000000000084',
  otherDay: 'a9b00000-0000-4000-8000-000000000091',
  otherReconciliation: 'a9b00000-0000-4000-8000-000000000092',
  otherPayment: 'a9b00000-0000-4000-8000-000000000093',
};

let client: Sql;

async function signedCookie(token: string): Promise<string> {
  return `${token}.${await makeSignature(token, process.env.BETTER_AUTH_SECRET!)}`;
}

async function command(input: Record<string, unknown>, key: string, token = 'a9-session-token') {
  return commandPost(
    new Request('http://127.0.0.1:3000/api/settlements/commands', {
      method: 'POST',
      headers: {
        cookie: `shanda-fuel.session_token=${await signedCookie(token)}`,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function openBusinessDay(
  tenantId: string,
  stationId: string,
  businessDayId: string,
  token: string,
) {
  const response = await forecourtCommandPost(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      method: 'POST',
      headers: {
        cookie: `shanda-fuel.session_token=${await signedCookie(token)}`,
        'content-type': 'application/json',
        'idempotency-key': `a9-open-business-day-${businessDayId}`,
      },
      body: JSON.stringify({
        commandType: 'OpenBusinessDay',
        tenantId,
        stationId,
        businessDayId,
        expectedVersion: 0,
      }),
    }),
  );
  if (response.status !== 200) {
    throw new Error(`A9 fixture could not open business day ${businessDayId}: ${response.status}`);
  }
}

async function responseBody(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

describe('A9 provider settlement PostgreSQL persistence', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.BETTER_AUTH_SECRET ??= 'integration-only-better-auth-secret-32-bytes';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a9-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a9-secret';
    client = postgres(databaseUrl!, { max: 8, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A9 Provider Tenant', 'a9-provider-tenant'),
        ('${ids.otherTenant}', 'A9 Other Tenant', 'a9-other-tenant')
      on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.actor}', 'A9 Finance', 'a9-finance@example.test'),
        ('${ids.otherActor}', 'A9 Other Finance', 'a9-other-finance@example.test'),
        ('${ids.supervisorActor}', 'A9 Supervisor', 'a9-supervisor@example.test')
      on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE'),
        ('${ids.otherMembership}', '${ids.otherTenant}', '${ids.otherActor}', 'ACTIVE'),
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A9 Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'A9 Other Legal')
      on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A9MAIN', 'A9 Main Station', 'ACTIVE'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'A9OTHER', 'A9 Other Station', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.otherTenant}', '${ids.otherMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.otherTenant}', '${ids.otherMembership}', 'ADMINISTRATOR', 'STATION', '${ids.otherLegal}', '${ids.otherStation}'),
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}')
      on conflict do nothing;
      insert into auth.session (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
      values
        ('${ids.session}', '2030-01-01T00:00:00Z', 'a9-session-token', '${ids.actor}', true, now()),
        ('${ids.otherSession}', '2030-01-01T00:00:00Z', 'a9-other-session-token', '${ids.otherActor}', true, now()),
        ('${ids.supervisorSession}', '2030-01-01T00:00:00Z', 'a9-supervisor-session-token', '${ids.supervisorActor}', true, now())
      on conflict (id) do update set expires_at = excluded.expires_at, strong_authentication_verified = true;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
      values
        ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-09-20', 'NOT_STARTED'),
        ('${ids.otherDay}', '${ids.otherTenant}', '${ids.otherStation}', '2026-09-20', 'NOT_STARTED')
      on conflict (id) do nothing;
      insert into app.reconciliations (id, tenant_id, station_id, business_day_id, state)
      values
        ('${ids.reconciliation}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'DRAFT'),
        ('${ids.otherReconciliation}', '${ids.otherTenant}', '${ids.otherStation}', '${ids.otherDay}', 'DRAFT')
      on conflict (id) do nothing;
      insert into app.reconciliation_payments
        (id, tenant_id, station_id, reconciliation_id, method, amount, reference, entered_by)
      values
        ('${ids.paymentOne}', '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', 'POS', 100.0000, 'A9-POS-1', '${ids.membership}'),
        ('${ids.paymentTwo}', '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', 'ECOCASH', 20.0000, 'A9-ECO-1', '${ids.membership}'),
        ('${ids.cashPayment}', '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', 'CASH', 50.0000, 'A9-CASH-1', '${ids.membership}'),
        ('${ids.paymentThree}', '${ids.tenant}', '${ids.station}', '${ids.reconciliation}', 'POS', 10.0000, 'A9-POS-2', '${ids.membership}'),
        ('${ids.otherPayment}', '${ids.otherTenant}', '${ids.otherStation}', '${ids.otherReconciliation}', 'POS', 10.0000, 'A9-OTHER-1', '${ids.otherMembership}')
      on conflict (id) do nothing;
      update app.reconciliations
         set state = 'SUBMITTED', submitted_by = '${ids.membership}', submitted_at = now(), version = version + 1
       where id = '${ids.reconciliation}' and state = 'DRAFT';
      update app.reconciliations
         set state = 'APPROVED', approved_by = '${ids.membership}', approved_at = now(), version = version + 1
       where id = '${ids.reconciliation}' and state = 'SUBMITTED';
      update app.reconciliations
         set state = 'SUBMITTED', submitted_by = '${ids.otherMembership}', submitted_at = now(), version = version + 1
       where id = '${ids.otherReconciliation}' and state = 'DRAFT';
      update app.reconciliations
         set state = 'APPROVED', approved_by = '${ids.otherMembership}', approved_at = now(), version = version + 1
       where id = '${ids.otherReconciliation}' and state = 'SUBMITTED';
    `);
    await openBusinessDay(ids.tenant, ids.station, ids.day, 'a9-session-token');
    await openBusinessDay(
      ids.otherTenant,
      ids.otherStation,
      ids.otherDay,
      'a9-other-session-token',
    );
  });

  afterAll(async () => client?.end());

  it('persists a settlement, allocates across multiple A5 rows, and reloads derived exact totals', async () => {
    const providerResponse = await command(
      {
        commandType: 'CreatePaymentProvider',
        tenantId: ids.tenant,
        stationId: ids.station,
        code: 'A9-POS-PROVIDER',
        name: 'A9 POS Provider',
        providerType: 'CARD_ACQUIRER',
      },
      'a9-create-provider',
    );
    expect(providerResponse.status).toBe(201);
    const provider = await responseBody(providerResponse);
    const accountResponse = await command(
      {
        commandType: 'ConfigureProviderAccount',
        tenantId: ids.tenant,
        stationId: ids.station,
        providerId: provider.providerId,
        accountReference: 'A9-MERCHANT-001',
        displayName: 'A9 Merchant Account',
        currency: 'USD',
        accountStationId: ids.station,
      },
      'a9-create-account',
    );
    expect(accountResponse.status).toBe(201);
    const account = await responseBody(accountResponse);
    const settlementInput = {
      commandType: 'RecordProviderSettlement',
      tenantId: ids.tenant,
      stationId: ids.station,
      providerAccountId: account.providerAccountId,
      settlementReference: 'A9-SETTLEMENT-001',
      batchReference: 'A9-BATCH-001',
      transactionDate: '2026-09-20',
      settlementDate: '2026-09-22',
      currency: 'USD',
      grossAmount: '120.0000',
      providerFeeAmount: '1.2500',
      providerDeductionAmount: '0.1250',
      reportedNetAmount: '118.6250',
      sourceType: 'PROVIDER_IMPORT',
      sourceKey: 'a9-import-001',
      sourceMetadata: { file: 'provider-2026-09-22.csv' },
    };
    const settlementResponse = await command(settlementInput, 'a9-record-settlement');
    expect(settlementResponse.status).toBe(201);
    const settlement = await responseBody(settlementResponse);
    const settlementRetry = await command(settlementInput, 'a9-record-settlement');
    expect((await responseBody(settlementRetry)).settlementId).toBe(settlement.settlementId);

    const firstAllocation = {
      commandType: 'AllocateProviderSettlement',
      tenantId: ids.tenant,
      stationId: ids.station,
      settlementId: settlement.settlementId,
      reconciliationPaymentId: ids.paymentOne,
      amount: '40.0000',
      allocationKey: 'a9-allocation-001',
      expectedVersion: 0,
    };
    const allocationResponse = await command(firstAllocation, 'a9-allocate-001');
    expect(allocationResponse.status).toBe(201);
    const allocationRetry = await command(firstAllocation, 'a9-allocate-001');
    expect((await responseBody(allocationRetry)).allocationId).toBe(
      (await responseBody(allocationResponse)).allocationId,
    );
    const secondAllocation = await command(
      {
        ...firstAllocation,
        amount: '60.0000',
        allocationKey: 'a9-allocation-002',
        expectedVersion: 1,
        reconciliationPaymentId: ids.paymentOne,
      },
      'a9-allocate-002',
    );
    expect(secondAllocation.status).toBe(201);
    const thirdAllocation = await command(
      {
        ...firstAllocation,
        amount: '20.0000',
        allocationKey: 'a9-allocation-003',
        expectedVersion: 2,
        reconciliationPaymentId: ids.paymentTwo,
      },
      'a9-allocate-003',
    );
    expect(thirdAllocation.status).toBe(201);

    const summary = await summaryGet(
      new Request(
        `http://127.0.0.1:3000/api/settlements/summary?tenantId=${ids.tenant}&stationId=${ids.station}`,
        {
          headers: {
            cookie: `shanda-fuel.session_token=${await signedCookie('a9-session-token')}`,
          },
        },
      ),
    );
    expect(summary.status).toBe(200);
    const summaryRows = (await summary.json()) as Record<string, any>[];
    expect(summaryRows[0]).toMatchObject({
      settlementReference: 'A9-SETTLEMENT-001',
      transactionDate: '2026-09-20',
      settlementDate: '2026-09-22',
      grossAmount: '120.0000',
      allocatedAmount: '120.0000',
      varianceAmount: '0',
      providerFeeAmount: '1.2500',
      providerDeductionAmount: '0.1250',
      reportedNetAmount: '118.6250',
      state: 'PARTIALLY_MATCHED',
    });

    const unmatched = await unmatchedGet(
      new Request(
        `http://127.0.0.1:3000/api/settlements/unmatched?tenantId=${ids.tenant}&stationId=${ids.station}`,
        {
          headers: {
            cookie: `shanda-fuel.session_token=${await signedCookie('a9-session-token')}`,
          },
        },
      ),
    );
    expect(unmatched.status).toBe(200);
    expect((await unmatched.json()).map((row: Record<string, any>) => row.paymentId)).not.toContain(
      ids.cashPayment,
    );

    const reconcile = await command(
      {
        commandType: 'ReconcileProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        settlementId: settlement.settlementId,
        expectedVersion: 3,
        reason: null,
      },
      'a9-reconcile-001',
    );
    expect(reconcile.status).toBe(200);
    expect((await responseBody(reconcile)).state).toBe('RECONCILED');
    await expect(
      client.unsafe(
        `update app.provider_settlements set gross_amount = 121.0000 where id = '${settlement.settlementId}'`,
      ),
    ).rejects.toThrow(/immutable|append-only/);

    const auditRows = await client<{ count: string }[]>`
      select count(*)::text as count from platform.security_events
       where tenant_id = ${ids.tenant} and event_code like 'SETTLEMENT.%'
    `;
    expect(Number(auditRows[0]?.count)).toBeGreaterThanOrEqual(8);
  });

  it('rejects cash, cross-tenant evidence, currency mismatch, and over-allocation', async () => {
    const providerRows = await client<{ id: string }[]>`
      select id from app.payment_providers where tenant_id = ${ids.tenant} and code = 'A9-POS-PROVIDER'
    `;
    const accountRows = await client<{ id: string }[]>`
      select id from app.provider_accounts where tenant_id = ${ids.tenant} and account_reference = 'A9-MERCHANT-001'
    `;
    const cashAttempt = await command(
      {
        commandType: 'RecordProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        providerAccountId: accountRows[0]!.id,
        settlementReference: 'A9-CASH-SETTLEMENT',
        transactionDate: '2026-09-20',
        settlementDate: '2026-09-23',
        currency: 'USD',
        grossAmount: '50.0000',
        sourceType: 'MANUAL',
        sourceKey: 'a9-cash-settlement',
      },
      'a9-cash-settlement',
    );
    expect(cashAttempt.status).toBe(201);
    const cashSettlement = await responseBody(cashAttempt);
    const cashAllocation = await command(
      {
        commandType: 'AllocateProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        settlementId: cashSettlement.settlementId,
        reconciliationPaymentId: ids.cashPayment,
        amount: '1.0000',
        allocationKey: 'a9-cash-allocation',
        expectedVersion: 0,
      },
      'a9-cash-allocation',
    );
    expect(cashAllocation.status).toBe(400);

    const crossTenant = await command(
      {
        commandType: 'AllocateProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        settlementId: cashSettlement.settlementId,
        reconciliationPaymentId: ids.otherPayment,
        amount: '1.0000',
        allocationKey: 'a9-cross-tenant-allocation',
        expectedVersion: 0,
      },
      'a9-cross-tenant-allocation',
    );
    expect([400, 404, 403]).toContain(crossTenant.status);

    const currencyAccount = await command(
      {
        commandType: 'ConfigureProviderAccount',
        tenantId: ids.tenant,
        stationId: ids.station,
        providerId: providerRows[0]!.id,
        accountReference: 'A9-EUR-ACCOUNT',
        displayName: 'A9 EUR Account',
        currency: 'EUR',
        accountStationId: ids.station,
      },
      'a9-create-eur-account',
    );
    const eurAccount = await responseBody(currencyAccount);
    const currencyMismatch = await command(
      {
        commandType: 'RecordProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        providerAccountId: eurAccount.providerAccountId,
        settlementReference: 'A9-USD-EUR-MISMATCH',
        transactionDate: '2026-09-20',
        settlementDate: '2026-09-23',
        currency: 'USD',
        grossAmount: '10.0000',
        sourceType: 'MANUAL',
        sourceKey: 'a9-usd-eur-mismatch',
      },
      'a9-usd-eur-mismatch',
    );
    expect(currencyMismatch.status).toBe(400);

    const concurrentSettlementResponse = await command(
      {
        commandType: 'RecordProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        providerAccountId: accountRows[0]!.id,
        settlementReference: 'A9-CONCURRENT-SETTLEMENT',
        transactionDate: '2026-09-20',
        settlementDate: '2026-09-24',
        currency: 'USD',
        grossAmount: '10.0000',
        sourceType: 'MANUAL',
        sourceKey: 'a9-concurrent-settlement',
      },
      'a9-concurrent-settlement',
    );
    expect(concurrentSettlementResponse.status).toBe(201);
    const concurrentSettlement = await responseBody(concurrentSettlementResponse);
    const concurrentResults = await Promise.all([
      command(
        {
          commandType: 'AllocateProviderSettlement',
          tenantId: ids.tenant,
          stationId: ids.station,
          settlementId: concurrentSettlement.settlementId,
          reconciliationPaymentId: ids.paymentThree,
          amount: '7.0000',
          allocationKey: 'a9-concurrent-allocation-1',
          expectedVersion: 0,
        },
        'a9-concurrent-allocation-1',
      ),
      command(
        {
          commandType: 'AllocateProviderSettlement',
          tenantId: ids.tenant,
          stationId: ids.station,
          settlementId: concurrentSettlement.settlementId,
          reconciliationPaymentId: ids.paymentThree,
          amount: '7.0000',
          allocationKey: 'a9-concurrent-allocation-2',
          expectedVersion: 0,
        },
        'a9-concurrent-allocation-2',
      ),
    ]);
    expect(concurrentResults.map((response) => response.status).sort()).toEqual([201, 409]);

    const permissionDenied = await command(
      {
        commandType: 'AllocateProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        settlementId: concurrentSettlement.settlementId,
        reconciliationPaymentId: ids.paymentThree,
        amount: '1.0000',
        allocationKey: 'a9-supervisor-allocation',
        expectedVersion: 1,
      },
      'a9-supervisor-allocation',
      'a9-supervisor-session-token',
    );
    expect(permissionDenied.status).toBe(403);
  });
});
