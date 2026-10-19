import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { POST as commandPost } from '../../src/app/api/settlements/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for settlement statement integration tests.');
}

const ids = {
  tenant: '5e770000-0000-4000-8000-000000000001',
  otherTenant: '5e770000-0000-4000-8000-000000000002',
  legal: '5e770000-0000-4000-8000-000000000011',
  otherLegal: '5e770000-0000-4000-8000-000000000012',
  station: '5e770000-0000-4000-8000-000000000021',
  otherStation: '5e770000-0000-4000-8000-000000000022',
  finance: '5e770000-0000-4000-8000-000000000031',
  otherFinance: '5e770000-0000-4000-8000-000000000032',
  attendant: '5e770000-0000-4000-8000-000000000033',
  financeMembership: '5e770000-0000-4000-8000-000000000041',
  otherMembership: '5e770000-0000-4000-8000-000000000042',
  attendantMembership: '5e770000-0000-4000-8000-000000000043',
  financeSession: '5e770000-0000-4000-8000-000000000051',
  otherSession: '5e770000-0000-4000-8000-000000000052',
  attendantSession: '5e770000-0000-4000-8000-000000000053',
};

let client: Sql;
let providerAccountId = '';

async function command(
  input: Record<string, unknown>,
  key: string,
  token = 'sst-finance-token',
): Promise<Response> {
  return commandPost(
    new Request('http://127.0.0.1:3000/api/settlements/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(token),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

const body = async (response: Response) => (await response.json()) as Record<string, any>;

function statement(overrides: Record<string, unknown> = {}) {
  return {
    commandType: 'RecordProviderSettlement',
    tenantId: ids.tenant,
    stationId: ids.station,
    providerAccountId,
    settlementReference: 'SST-STMT-001',
    batchReference: 'SST-BATCH-001',
    transactionDate: '2026-10-01',
    settlementDate: '2026-10-03',
    currency: 'USD',
    grossAmount: '1234.5678',
    providerFeeAmount: '12.3457',
    providerDeductionAmount: '0.0001',
    reportedNetAmount: '1222.2220',
    sourceType: 'MANUAL',
    sourceKey: 'sst-manual-001',
    sourceMetadata: {},
    ...overrides,
  };
}

describe('Record provider settlement statement', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-sst-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-sst-secret';
    client = postgres(databaseUrl!, { max: 4, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'SST Tenant', 'sst-tenant'),
        ('${ids.otherTenant}', 'SST Other Tenant', 'sst-other-tenant')
      on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.finance}', 'SST Finance', 'sst-finance@example.test'),
        ('${ids.otherFinance}', 'SST Other Finance', 'sst-other-finance@example.test'),
        ('${ids.attendant}', 'SST Attendant', 'sst-attendant@example.test')
      on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.financeMembership}', '${ids.tenant}', '${ids.finance}', 'ACTIVE'),
        ('${ids.otherMembership}', '${ids.otherTenant}', '${ids.otherFinance}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendant}', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'SST Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'SST Other Legal')
      on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'SSTMAIN', 'SST Main', 'ACTIVE'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'SSTOTH', 'SST Other', 'ACTIVE')
      on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.financeMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${ids.financeMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.otherTenant}', '${ids.otherMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.otherTenant}', '${ids.otherMembership}', 'ADMINISTRATOR', 'STATION', '${ids.otherLegal}', '${ids.otherStation}'),
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}')
      on conflict do nothing;
    `);
    await seedClerkSession(client, ids.financeSession, 'sst-finance-token', ids.finance, true);
    await seedClerkSession(client, ids.otherSession, 'sst-other-token', ids.otherFinance, true);
    await seedClerkSession(
      client,
      ids.attendantSession,
      'sst-attendant-token',
      ids.attendant,
      true,
    );
    await seedActiveStepUp(client, ids.financeSession, ids.tenant);
    await seedActiveStepUp(client, ids.otherSession, ids.otherTenant);
    await seedActiveStepUp(client, ids.attendantSession, ids.tenant);

    const provider = await body(
      await command(
        {
          commandType: 'CreatePaymentProvider',
          tenantId: ids.tenant,
          stationId: ids.station,
          code: 'SST-POS',
          name: 'SST POS',
          providerType: 'POS',
        },
        'sst-provider',
      ),
    );
    const account = await body(
      await command(
        {
          commandType: 'ConfigureProviderAccount',
          tenantId: ids.tenant,
          stationId: ids.station,
          providerId: provider.providerId,
          accountReference: 'SST-MERCHANT',
          displayName: 'SST Merchant',
          currency: 'USD',
          accountStationId: ids.station,
        },
        'sst-account',
      ),
    );
    providerAccountId = account.providerAccountId;
    expect(providerAccountId).toBeTruthy();
  });

  afterAll(async () => client?.end());

  it('records a statement with exact decimals and retries idempotently', async () => {
    const first = await command(statement(), 'sst-record-1');
    expect(first.status).toBe(201);
    const created = await body(first);
    expect(created).toMatchObject({
      settlementReference: 'SST-STMT-001',
      state: 'RECORDED',
    });
    const retry = await command(statement(), 'sst-record-1');
    expect((await body(retry)).settlementId).toBe(created.settlementId);

    const rows = await client<Record<string, string>[]>`
      select gross_amount::text, provider_fee_amount::text, provider_deduction_amount::text,
             reported_net_amount::text
        from app.provider_settlements where tenant_id = ${ids.tenant}
         and settlement_reference = 'SST-STMT-001'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      gross_amount: '1234.5678',
      provider_fee_amount: '12.3457',
      provider_deduction_amount: '0.0001',
      reported_net_amount: '1222.2220',
    });
  });

  it('rejects a reused idempotency key with a different payload', async () => {
    const response = await command(statement({ grossAmount: '1.0000' }), 'sst-record-1');
    expect(response.status).toBe(409);
  });

  it('rejects a duplicate statement reference or source key in plain language', async () => {
    const dupReference = await command(
      statement({ sourceKey: 'sst-manual-other' }),
      'sst-record-dup-ref',
    );
    expect(dupReference.status).toBe(409);
    expect((await body(dupReference)).message).toBe(
      'This provider settlement has already been recorded',
    );
    const dupSource = await command(
      statement({ settlementReference: 'SST-STMT-OTHER' }),
      'sst-record-dup-source',
    );
    expect(dupSource.status).toBe(409);
  });

  it('rejects invalid amounts, dates, currency and unknown accounts with clear messages', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [
        { grossAmount: '0.0000', settlementReference: 'SST-V1', sourceKey: 'sst-v1' },
        'Gross amount must be positive',
      ],
      [
        { grossAmount: '12.00001', settlementReference: 'SST-V2', sourceKey: 'sst-v2' },
        'at most 4 decimal places',
      ],
      [
        {
          transactionDate: '2026-10-05',
          settlementDate: '2026-10-01',
          settlementReference: 'SST-V3',
          sourceKey: 'sst-v3',
        },
        'Settlement date cannot precede transaction date',
      ],
      [
        { currency: 'ZWG', settlementReference: 'SST-V4', sourceKey: 'sst-v4' },
        'Settlement currency must match provider account currency',
      ],
      [
        {
          providerAccountId: '5e770000-0000-4000-8000-0000000000ff',
          settlementReference: 'SST-V5',
          sourceKey: 'sst-v5',
        },
        '',
      ],
    ];
    for (const [index, [override, text]] of cases.entries()) {
      const response = await command(statement(override), `sst-invalid-${index}`);
      expect([400, 404], `case ${index}`).toContain(response.status);
      const payload = await body(response);
      if (text) expect(JSON.stringify(payload)).toContain(text);
    }
    const count = await client`
      select count(*)::int as n from app.provider_settlements
       where tenant_id = ${ids.tenant} and settlement_reference like 'SST-V%'`;
    expect(count[0]!.n).toBe(0);
  });

  it('denies roles without the record permission', async () => {
    const response = await command(
      statement({ settlementReference: 'SST-DENIED', sourceKey: 'sst-denied' }),
      'sst-denied',
      'sst-attendant-token',
    );
    expect(response.status).toBe(403);
  });

  it('isolates tenants: another tenant cannot record against this provider account', async () => {
    const asOther = await command(
      statement({ settlementReference: 'SST-X', sourceKey: 'sst-x' }),
      'sst-cross-1',
      'sst-other-token',
    );
    expect([403, 404]).toContain(asOther.status);
    const spoofed = await command(
      statement({
        tenantId: ids.otherTenant,
        stationId: ids.otherStation,
        settlementReference: 'SST-Y',
        sourceKey: 'sst-y',
      }),
      'sst-cross-2',
      'sst-other-token',
    );
    expect([400, 404]).toContain(spoofed.status);
    const leaked = await client`
      select count(*)::int as n from app.provider_settlements
       where settlement_reference in ('SST-X', 'SST-Y')`;
    expect(leaked[0]!.n).toBe(0);
  });
});
