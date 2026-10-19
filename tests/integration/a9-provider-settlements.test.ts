import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  otherStationSameTenant: 'a9b00000-0000-4000-8000-000000000023',
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
  invalidReversal: 'a9b00000-0000-4000-8000-0000000000a1',
};

let client: Sql;

async function signedCookie(token: string): Promise<string> {
  return token;
}

async function command(input: Record<string, unknown>, key: string, token = 'a9-session-token') {
  return commandPost(
    new Request('http://127.0.0.1:3000/api/settlements/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(await signedCookie(token)),
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
        ...clerkHeaders(await signedCookie(token)),
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

    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a9-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a9-secret';
    client = postgres(databaseUrl!, { max: 8, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A9 Provider Tenant', 'a9-provider-tenant'),
        ('${ids.otherTenant}', 'A9 Other Tenant', 'a9-other-tenant')
      on conflict (id) do nothing;
      insert into app.users (id, name, email) values
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
        ('${ids.otherStationSameTenant}', '${ids.tenant}', '${ids.legal}', 'A9OTHER', 'A9 Other Station', 'ACTIVE'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'A9OTHER', 'A9 Other Station', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.otherTenant}', '${ids.otherMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.otherTenant}', '${ids.otherMembership}', 'ADMINISTRATOR', 'STATION', '${ids.otherLegal}', '${ids.otherStation}'),
        ('${ids.tenant}', '${ids.membership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.otherStationSameTenant}'),
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}')
      on conflict do nothing;
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
    await seedClerkSession(client, ids.session, 'a9-session-token', ids.actor, true);
    await seedClerkSession(
      client,
      ids.otherSession,
      'a9-other-session-token',
      ids.otherActor,
      true,
    );
    await seedClerkSession(
      client,
      ids.supervisorSession,
      'a9-supervisor-session-token',
      ids.supervisorActor,
      true,
    );
    await seedActiveStepUp(client, ids.session, ids.tenant);
    await seedActiveStepUp(client, ids.otherSession, ids.otherTenant);
    await seedActiveStepUp(client, ids.supervisorSession, ids.tenant);
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
            ...clerkHeaders(await signedCookie('a9-session-token')),
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
      unallocatedProviderAmount: '0.0000',
      expectedEvidenceAmount: '120.0000',
      unmatchedEvidenceAmount: '0.0000',
      varianceAmount: '0.0000',
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
            ...clerkHeaders(await signedCookie('a9-session-token')),
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

    const auditRows = await client<{ event_code: string; count: string }[]>`
      select event_code, count(*)::text as count
        from platform.security_events
       where tenant_id = ${ids.tenant} and event_code like 'SETTLEMENT.%'
       group by event_code
    `;
    const auditCounts = Object.fromEntries(
      auditRows.map((row) => [row.event_code, Number(row.count)]),
    );
    expect(auditCounts).toMatchObject({
      'SETTLEMENT.CreatePaymentProvider': 1,
      'SETTLEMENT.ConfigureProviderAccount': 1,
      'SETTLEMENT.RecordProviderSettlement': 1,
      'SETTLEMENT.AllocateProviderSettlement': 3,
      'SETTLEMENT.ReconcileProviderSettlement': 1,
    });
  });

  it('reverses the first provider settlement allocation', async () => {
    const providerResponse = await command(
      {
        commandType: 'CreatePaymentProvider',
        tenantId: ids.tenant,
        stationId: ids.station,
        code: 'A9-REVERSAL-PROVIDER',
        name: 'A9 Reversal Provider',
        providerType: 'POS',
      },
      'a9-reversal-create-provider',
    );
    expect(providerResponse.status).toBe(201);
    const provider = await responseBody(providerResponse);

    const accountResponse = await command(
      {
        commandType: 'ConfigureProviderAccount',
        tenantId: ids.tenant,
        stationId: ids.station,
        providerId: provider.providerId,
        accountReference: 'A9-REVERSAL-MERCHANT',
        displayName: 'A9 Reversal Merchant',
        currency: 'USD',
        accountStationId: ids.station,
      },
      'a9-reversal-create-account',
    );
    expect(accountResponse.status).toBe(201);
    const account = await responseBody(accountResponse);

    const settlementResponse = await command(
      {
        commandType: 'RecordProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        providerAccountId: account.providerAccountId,
        settlementReference: 'A9-REVERSAL-SETTLEMENT',
        transactionDate: '2026-09-20',
        settlementDate: '2026-09-25',
        currency: 'USD',
        grossAmount: '10.0000',
        sourceType: 'MANUAL',
        sourceKey: 'a9-reversal-settlement',
      },
      'a9-reversal-record-settlement',
    );
    expect(settlementResponse.status).toBe(201);
    const settlement = await responseBody(settlementResponse);

    const allocationResponse = await command(
      {
        commandType: 'AllocateProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        settlementId: settlement.settlementId,
        reconciliationPaymentId: ids.paymentThree,
        amount: '10.0000',
        allocationKey: 'a9-reversal-allocation',
        expectedVersion: 0,
      },
      'a9-reversal-allocate',
    );
    expect(allocationResponse.status).toBe(201);
    const allocation = await responseBody(allocationResponse);
    const unrelatedBefore = await client<
      {
        id: string;
        amount: string;
        state: string;
        reversal_of_id: string | null;
      }[]
    >`
      select id, amount::text, state, reversal_of_id
        from app.provider_settlement_allocations
       where tenant_id = ${ids.tenant}
         and allocation_key in ('a9-allocation-001', 'a9-allocation-002', 'a9-allocation-003')
       order by allocation_key
    `;

    const reversalResponse = await command(
      {
        commandType: 'ReverseProviderSettlementAllocation',
        tenantId: ids.tenant,
        stationId: ids.station,
        allocationId: allocation.allocationId,
        reversalKey: 'a9-reversal-row',
        expectedVersion: 1,
      },
      'a9-reversal-command',
    );
    expect(reversalResponse.status).toBe(201);
    const reversal = await responseBody(reversalResponse);
    expect(reversal).toMatchObject({
      allocationId: allocation.allocationId,
      state: 'REVERSED',
    });

    const allocationRows = await client<
      {
        id: string;
        settlement_id: string;
        reconciliation_payment_id: string;
        station_id: string;
        amount: string;
        state: string;
        reversal_of_id: string | null;
      }[]
    >`
      select id, settlement_id, reconciliation_payment_id, station_id,
             amount::text, state, reversal_of_id
        from app.provider_settlement_allocations
       where tenant_id = ${ids.tenant}
         and (id = ${allocation.allocationId} or reversal_of_id = ${allocation.allocationId})
       order by state, id
    `;
    expect(allocationRows).toHaveLength(2);
    const original = allocationRows.find((row) => row.id === allocation.allocationId);
    const reversalRow = allocationRows.find(
      (row) => row.reversal_of_id === allocation.allocationId,
    );
    expect(original).toMatchObject({
      settlement_id: settlement.settlementId,
      reconciliation_payment_id: ids.paymentThree,
      station_id: ids.station,
      amount: '10.0000',
      state: 'POSTED',
      reversal_of_id: null,
    });
    expect(reversalRow).toMatchObject({
      settlement_id: settlement.settlementId,
      reconciliation_payment_id: ids.paymentThree,
      station_id: ids.station,
      amount: '10.0000',
      state: 'REVERSED',
      reversal_of_id: allocation.allocationId,
    });
    const netRows = await client<{ net: string }[]>`
      select coalesce(sum(case when state = 'POSTED' then amount else -amount end), 0)::text as net
        from app.provider_settlement_allocations
       where tenant_id = ${ids.tenant}
         and (id = ${allocation.allocationId} or reversal_of_id = ${allocation.allocationId})
    `;
    expect(netRows[0]?.net).toBe('0.0000');

    const duplicateReversal = await command(
      {
        commandType: 'ReverseProviderSettlementAllocation',
        tenantId: ids.tenant,
        stationId: ids.station,
        allocationId: allocation.allocationId,
        reversalKey: 'a9-reversal-row-duplicate',
        expectedVersion: 2,
      },
      'a9-reversal-duplicate-command',
    );
    expect(duplicateReversal.status).toBe(409);

    const crossTenantReversal = await command(
      {
        commandType: 'ReverseProviderSettlementAllocation',
        tenantId: ids.otherTenant,
        stationId: ids.otherStation,
        allocationId: allocation.allocationId,
        reversalKey: 'a9-reversal-cross-tenant',
        expectedVersion: 2,
      },
      'a9-reversal-cross-tenant-command',
      'a9-other-session-token',
    );
    expect(crossTenantReversal.status).toBe(404);

    const crossStationReversal = await command(
      {
        commandType: 'ReverseProviderSettlementAllocation',
        tenantId: ids.tenant,
        stationId: ids.otherStationSameTenant,
        allocationId: allocation.allocationId,
        reversalKey: 'a9-reversal-cross-station',
        expectedVersion: 2,
      },
      'a9-reversal-cross-station-command',
    );
    expect(crossStationReversal.status).toBe(404);

    const secondProviderResponse = await command(
      {
        commandType: 'CreatePaymentProvider',
        tenantId: ids.tenant,
        stationId: ids.station,
        code: 'A9-REVERSAL-OTHER-PROVIDER',
        name: 'A9 Other Reversal Provider',
        providerType: 'MOBILE_MONEY',
      },
      'a9-reversal-create-other-provider',
    );
    expect(secondProviderResponse.status).toBe(201);
    const secondProvider = await responseBody(secondProviderResponse);
    const secondAccountResponse = await command(
      {
        commandType: 'ConfigureProviderAccount',
        tenantId: ids.tenant,
        stationId: ids.station,
        providerId: secondProvider.providerId,
        accountReference: 'A9-REVERSAL-OTHER-MERCHANT',
        displayName: 'A9 Other Reversal Merchant',
        currency: 'USD',
        accountStationId: ids.station,
      },
      'a9-reversal-create-other-account',
    );
    expect(secondAccountResponse.status).toBe(201);
    const secondAccount = await responseBody(secondAccountResponse);
    const secondSettlementResponse = await command(
      {
        commandType: 'RecordProviderSettlement',
        tenantId: ids.tenant,
        stationId: ids.station,
        providerAccountId: secondAccount.providerAccountId,
        settlementReference: 'A9-REVERSAL-OTHER-SETTLEMENT',
        transactionDate: '2026-09-20',
        settlementDate: '2026-09-25',
        currency: 'USD',
        grossAmount: '10.0000',
        sourceType: 'MANUAL',
        sourceKey: 'a9-reversal-other-settlement',
      },
      'a9-reversal-record-other-settlement',
    );
    expect(secondSettlementResponse.status).toBe(201);
    const secondSettlement = await responseBody(secondSettlementResponse);

    await expect(
      client.begin(async (transaction) => {
        await transaction`
          insert into app.provider_settlement_allocations
            (id, tenant_id, station_id, settlement_id, reconciliation_payment_id,
             amount, allocation_key, state, reversal_of_id, allocated_by)
          values
            (${ids.invalidReversal}, ${ids.tenant}, ${ids.station}, ${secondSettlement.settlementId},
             ${ids.paymentThree}, 10.0000, 'a9-reversal-cross-provider', 'REVERSED',
             ${allocation.allocationId}, ${ids.membership})
        `;
      }),
    ).rejects.toThrow(/original settlement|retain the original/);

    const failedReversalRows = await client<{ count: string }[]>`
      select count(*)::text as count
        from app.provider_settlement_allocations
       where tenant_id = ${ids.tenant}
         and allocation_key = 'a9-reversal-cross-provider'
    `;
    expect(failedReversalRows[0]?.count).toBe('0');

    const unrelatedAfter = await client<
      {
        id: string;
        amount: string;
        state: string;
        reversal_of_id: string | null;
      }[]
    >`
      select id, amount::text, state, reversal_of_id
        from app.provider_settlement_allocations
       where tenant_id = ${ids.tenant}
         and allocation_key in ('a9-allocation-001', 'a9-allocation-002', 'a9-allocation-003')
       order by allocation_key
    `;
    expect(unrelatedAfter).toEqual(unrelatedBefore);

    const settlementState = await client<{ state: string; version: number }[]>`
      select state, version
        from app.provider_settlements
       where tenant_id = ${ids.tenant} and id = ${settlement.settlementId}
    `;
    expect(settlementState).toEqual([{ state: 'EXCEPTION', version: 2 }]);
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
