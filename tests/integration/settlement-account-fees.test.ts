import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { clerkHeaders } from './auth-session-fixtures';
import { GET as settlementSummaryGet } from '../../src/app/api/settlements/summary/route';
import { createQa1ScenarioContext } from './qa1/fixture';
import { settlement } from './qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for settlement fee tests.');
let client: Sql;

describe('provider account fees and settlement charges (PostgreSQL)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-fee-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-fee-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  it('works out the charge from the account and shows any difference from what was kept', async () => {
    const ctx = await createQa1ScenarioContext(client, 'fees');
    const base = { tenantId: ctx.tenantId, stationId: ctx.stationId };
    const provider = await settlement(
      ctx,
      {
        commandType: 'CreatePaymentProvider',
        ...base,
        code: `ECO-${ctx.runId.slice(0, 6)}`,
        name: 'EcoCash',
        providerType: 'MOBILE_MONEY',
      },
      'fees-provider',
      'admin',
    );
    expect(provider.response.status, JSON.stringify(provider.body)).toBe(201);
    const account = (body: Record<string, unknown>, key: string) =>
      settlement(
        ctx,
        {
          commandType: 'ConfigureProviderAccount',
          ...base,
          providerId: provider.body.providerId,
          currency: 'USD',
          accountStationId: ctx.stationId,
          ...body,
        },
        key,
        'admin',
      );
    // A fee above 100% or a negative fixed fee is refused.
    expect(
      (
        await account(
          { accountReference: 'BAD-1', displayName: 'Bad', feePercent: '101' },
          'fees-bad-1',
        )
      ).response.status,
    ).toBe(400);
    const eco = await account(
      { accountReference: 'ECO-1', displayName: 'EcoCash 1%', feePercent: '1', feeFixed: null },
      'fees-eco',
    );
    expect(eco.response.status, JSON.stringify(eco.body)).toBe(201);
    const pos = await account(
      {
        accountReference: 'POS-1',
        displayName: 'POS 1.5% + 0.10',
        feePercent: '1.5',
        feeFixed: '0.10',
      },
      'fees-pos',
    );
    expect(pos.response.status).toBe(201);

    const record = (providerAccountId: string, key: string, extra: Record<string, unknown>) =>
      settlement(
        ctx,
        {
          commandType: 'RecordProviderSettlement',
          ...base,
          providerAccountId,
          settlementReference: key,
          transactionDate: '2026-10-20',
          settlementDate: '2026-10-21',
          currency: 'USD',
          grossAmount: '200.0000',
          sourceType: 'MANUAL',
          sourceKey: key,
          sourceMetadata: {},
          ...extra,
        },
        key,
        'admin',
      );
    // Nothing typed in: the fee is worked out (1% of 200 = 2.00).
    expect((await record(eco.body.providerAccountId, 'fee-auto', {})).response.status).toBe(201);
    // Provider reports it kept 3.50 on a 1% account: 1.50 more than it should.
    expect(
      (
        await record(eco.body.providerAccountId, 'fee-over', {
          reportedNetAmount: '196.5000',
        })
      ).response.status,
    ).toBe(201);
    // 1.5% of 200 + 0.10 = 3.10, and the provider kept exactly that.
    expect(
      (
        await record(pos.body.providerAccountId, 'fee-exact', {
          providerFeeAmount: '3.1000',
        })
      ).response.status,
    ).toBe(201);

    const summary = await settlementSummaryGet(
      new Request(
        `http://127.0.0.1:3000/api/settlements/summary?tenantId=${ctx.tenantId}&stationId=${ctx.stationId}`,
        { headers: { ...clerkHeaders(ctx.actors.admin.token) } },
      ),
    );
    const rows = (await summary.json()) as Record<string, any>[];
    const by = (ref: string) => rows.find((row) => row.settlementReference === ref)!;
    expect(by('fee-auto')).toMatchObject({
      providerFeeAmount: '2.0000',
      expectedFeeAmount: '2.0000',
      derivedNetAmount: '198.0000',
      feeDifferenceAmount: '0.0000',
    });
    expect(by('fee-over')).toMatchObject({
      expectedFeeAmount: '2.0000',
      feeDifferenceAmount: '1.5000',
    });
    expect(by('fee-exact')).toMatchObject({
      expectedFeeAmount: '3.1000',
      feeDifferenceAmount: '0.0000',
    });
  });
});
