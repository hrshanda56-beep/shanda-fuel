import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { createQa1ScenarioContext, QA1_TIMES, type Qa1ScenarioContext } from './qa1/fixture';
import { createApprovedSale, customer } from './qa1/commands';
import { expectStatus } from './qa1/assertions';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for payment reference tests.');

let client: Sql;

/** A credit-limited customer and a prepaid customer, so every rule has an account to hit. */
async function accountsFor(ctx: Qa1ScenarioContext, creditLimit = '100.0000') {
  const created = await customer(
    ctx,
    {
      commandType: 'CreateCustomer',
      tenantId: ctx.tenantId,
      accountReference: `PAYREF-${ctx.runId.slice(0, 8)}`,
      displayName: 'Pay Reference Customer',
      legalEntityId: ctx.legalEntityId,
    },
    'payref-customer',
  );
  expectStatus(created, 201);
  const customerId = created.body.customerId as string;
  const credit = await customer(
    ctx,
    {
      commandType: 'CreateCustomerAccount',
      tenantId: ctx.tenantId,
      customerId,
      accountType: 'CREDIT',
      currency: 'USD',
      creditLimit,
      stationScope: 'ALL',
    },
    'payref-credit',
  );
  expectStatus(credit, 201);
  const prepaid = await customer(
    ctx,
    {
      commandType: 'CreateCustomerAccount',
      tenantId: ctx.tenantId,
      customerId,
      accountType: 'PREPAID_VALUE',
      currency: 'USD',
      stationScope: 'ALL',
    },
    'payref-prepaid',
  );
  expectStatus(prepaid, 201);
  const prepaidId = prepaid.body.accountId as string;
  expectStatus(
    await customer(
      ctx,
      {
        commandType: 'RecordPrepaidTopUp',
        tenantId: ctx.tenantId,
        accountId: prepaidId,
        accountType: 'PREPAID_VALUE',
        amount: { amount: '40.0000', currency: 'USD' },
        source: { sourceType: 'PREPAID_TOPUP', sourceId: ctx.runId },
        occurredAt: QA1_TIMES.opening,
        businessDate: ctx.businessDate,
      },
      'payref-topup',
    ),
    201,
  );
  return { creditId: credit.body.accountId as string, prepaidId };
}

describe('Customer and beneficiary on reconciliation payments', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-payref-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-payref-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  const sale = (ctx: Qa1ScenarioContext, key: string, payments: Array<Record<string, string>>) =>
    createApprovedSale(client, ctx, key, {
      saleLitres: '30.000',
      payments: payments as never,
      post: true,
      completeShiftAfter: true,
    });

  it('asks for the customer on a credit sale and for the beneficiary on approved fuel', async () => {
    const ctx = await createQa1ScenarioContext(client, 'payref-a');
    await expect(
      sale(ctx, 'payref-a1', [{ method: 'CUSTOMER_CREDIT', amount: '10.0000' }]),
    ).rejects.toThrow(/Choose the customer for this credit sale/);
    const ctxB = await createQa1ScenarioContext(client, 'payref-b');
    await expect(
      sale(ctxB, 'payref-b1', [{ method: 'STAFF_OR_MANAGEMENT_FUEL', amount: '10.0000' }]),
    ).rejects.toThrow(/Say who received the approved fuel/);
  });

  it('rejects a customer without the matching kind of account', async () => {
    const ctx = await createQa1ScenarioContext(client, 'payref-c');
    const { creditId } = await accountsFor(ctx);
    await expect(
      sale(ctx, 'payref-c1', [
        { method: 'PREPAID', amount: '10.0000', customerAccountId: creditId },
      ]),
    ).rejects.toThrow(/does not have a prepaid money account/);
  });

  it('stops a credit sale that would take the customer over their limit, counting every row', async () => {
    const ctx = await createQa1ScenarioContext(client, 'payref-d');
    const { creditId } = await accountsFor(ctx, '100.0000');
    await expect(
      sale(ctx, 'payref-d1', [
        { method: 'CUSTOMER_CREDIT', amount: '60.0000', customerAccountId: creditId },
        { method: 'CUSTOMER_CREDIT', amount: '60.0000', customerAccountId: creditId },
      ]),
    ).rejects.toThrow(/over their credit limit/);
  });

  it('stops a prepaid sale larger than the prepaid balance', async () => {
    const ctx = await createQa1ScenarioContext(client, 'payref-e');
    const { prepaidId } = await accountsFor(ctx);
    await expect(
      sale(ctx, 'payref-e1', [
        { method: 'PREPAID', amount: '41.0000', customerAccountId: prepaidId },
      ]),
    ).rejects.toThrow(/does not have enough prepaid money/);
  });

  it('keeps the customer and the beneficiary with the payment when the sale is within limits', async () => {
    const ctx = await createQa1ScenarioContext(client, 'payref-f');
    const { creditId, prepaidId } = await accountsFor(ctx, '100.0000');
    const posted = await sale(ctx, 'payref-f1', [
      { method: 'CUSTOMER_CREDIT', amount: '35.0000', customerAccountId: creditId },
      { method: 'PREPAID', amount: '30.0000', customerAccountId: prepaidId },
      {
        method: 'STAFF_OR_MANAGEMENT_FUEL',
        amount: '10.0000',
        beneficiaryName: '  Tendai Moyo ',
        // A stray customer on a non-account method is ignored, never stored.
        customerAccountId: creditId,
      },
    ]);
    const stored = await client<
      { method: string; customer_account_id: string | null; beneficiary_name: string | null }[]
    >`select method, customer_account_id, beneficiary_name from app.reconciliation_payments
      where reconciliation_id = ${posted.reconciliationId} order by method`;
    expect(stored).toEqual([
      { method: 'CUSTOMER_CREDIT', customer_account_id: creditId, beneficiary_name: null },
      { method: 'PREPAID', customer_account_id: prepaidId, beneficiary_name: null },
      {
        method: 'STAFF_OR_MANAGEMENT_FUEL',
        customer_account_id: null,
        beneficiary_name: 'Tendai Moyo',
      },
    ]);
  });
});
